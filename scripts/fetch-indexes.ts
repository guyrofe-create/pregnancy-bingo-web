import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import pLimit from "p-limit";
import robotsParser from "robots-parser";

type HarvestTopic =
  | "pregnancy"
  | "period"
  | "fertility"
  | "contraception"
  | "postpartum"
  | "breastfeeding";

type HarvestItem = {
  id: string;
  topic: HarvestTopic;
  candidateMyth: string;
  foundInUrl: string;
  notes: string;
  needsEvidence: boolean;
};

type HarvestSourceItem = {
  url: string;
  topic: HarvestTopic;
};

type HarvestLogItem = {
  url: string;
  topic: HarvestTopic;
  host: string;
  status: "fetched" | "skipped" | "error";
  httpStatus?: number;
  ms: number;
  bytes: number;
  extractedCount: number;
  reason?: string;
};

type ProcessResult = {
  log: HarvestLogItem;
  messages: number;
  added: number;
  skipped: number;
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 IndexHarvesterBot/1.0";
const RATE_LIMIT_MS = 1000;
const MAX_PAGES_PER_RUN = 500;

const MAIN_LINK_SELECTORS = [
  "main a",
  "[role='main'] a",
  "#main a",
  ".main a",
  "#content a",
  ".content a",
  "article a",
];

const EXTRA_SELECTORS = ["h2", "h3", "li", "summary"];

const BOILERPLATE_WORDS = [
  "כניסה",
  "הרשמה",
  "תגובות",
  "שתף",
  "חיפוש",
  "דף הבית",
  "פורומים",
  "פרסומת",
  "cookie",
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const SOURCES_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-sources.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-output.json");
const LOG_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-log.json");

const robotsCache = new Map<string, ReturnType<typeof robotsParser> | null>();
let nextAllowedRequest = 0;
let requestTimeoutMs = 15000;

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonOrEmptyArray<T>(filePath: string): T[] {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]): { max: number; timeoutMs: number } {
  let max = 500;
  let timeoutMs = 15000;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--max") {
      const value = Number.parseInt(argv[i + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        max = value;
      }
      i += 1;
      continue;
    }

    if (arg.startsWith("--max=")) {
      const value = Number.parseInt(arg.slice("--max=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        max = value;
      }
      continue;
    }

    if (arg === "--timeoutMs") {
      const value = Number.parseInt(argv[i + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        timeoutMs = value;
      }
      i += 1;
      continue;
    }

    if (arg.startsWith("--timeoutMs=")) {
      const value = Number.parseInt(arg.slice("--timeoutMs=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        timeoutMs = value;
      }
      continue;
    }
  }

  return { max, timeoutMs };
}

async function throttledFetch(url: string): Promise<Response> {
  const now = Date.now();
  if (now < nextAllowedRequest) {
    await sleep(nextAllowedRequest - now);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);

  try {
    return await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      credentials: "omit",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    nextAllowedRequest = Date.now() + RATE_LIMIT_MS;
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeUrlForDedupe(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return normalizeWhitespace(parsed.toString()).toLowerCase();
  } catch {
    return normalizeWhitespace(url.split("#")[0] ?? url).toLowerCase();
  }
}

function stripListMarkers(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/^\s*[•●◦▪▫‣◉\-*–—]+\s+/, "")
      .replace(/^\s*\(?\d{1,3}\)?[.)]\s+/, "")
      .replace(/^\s*\(?[A-Za-z]\)?[.)]\s+/, "")
      .replace(/^\s*[א-ת][.)]\s+/, ""),
  );
}

function isPunctuationOnly(value: string): boolean {
  return !/[\p{L}\p{N}\u0590-\u05FF]/u.test(value);
}

function isBoilerplate(value: string): boolean {
  const lower = value.toLowerCase();
  return BOILERPLATE_WORDS.some((word) => lower.includes(word.toLowerCase()));
}

function cleanCandidate(value: string): string | null {
  const stripped = stripListMarkers(value);

  if (stripped.length < 15 || stripped.length > 160) {
    return null;
  }

  if (isPunctuationOnly(stripped)) {
    return null;
  }

  if (isBoilerplate(stripped)) {
    return null;
  }

  return stripped;
}

function dedupeKey(candidateMyth: string, foundInUrl: string): string {
  return `${normalizeWhitespace(candidateMyth).toLowerCase()}::${normalizeUrlForDedupe(foundInUrl)}`;
}

function getNextId(items: HarvestItem[]): number {
  let max = 0;
  for (const item of items) {
    const match = /^h(\d+)$/.exec(item.id ?? "");
    if (!match) {
      continue;
    }

    const value = Number.parseInt(match[1], 10);
    if (value > max) {
      max = value;
    }
  }

  return max + 1;
}

async function getRobots(url: URL): Promise<ReturnType<typeof robotsParser> | null> {
  const cacheKey = url.origin;
  if (robotsCache.has(cacheKey)) {
    return robotsCache.get(cacheKey) ?? null;
  }

  const robotsUrl = `${url.origin}/robots.txt`;

  try {
    const response = await throttledFetch(robotsUrl);
    if (!response.ok) {
      if (response.status === 404 || response.status === 401 || response.status === 403) {
        const parser = robotsParser(robotsUrl, "");
        robotsCache.set(cacheKey, parser);
        return parser;
      }

      robotsCache.set(cacheKey, null);
      return null;
    }

    const text = await response.text();
    const parser = robotsParser(robotsUrl, text);
    robotsCache.set(cacheKey, parser);
    return parser;
  } catch {
    robotsCache.set(cacheKey, null);
    return null;
  }
}

function extractCandidates(html: string): string[] {
  const $ = load(html);
  const seen = new Set<string>();
  const results: string[] = [];

  const selectors = [...MAIN_LINK_SELECTORS, ...EXTRA_SELECTORS];

  for (const selector of selectors) {
    $(selector).each((_index: number, element: unknown) => {
      const raw = $(element).text();
      const cleaned = cleanCandidate(raw);
      if (!cleaned) {
        return;
      }

      const key = cleaned.toLowerCase();
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      results.push(cleaned);
    });
  }

  return results;
}

function canonicalizeDoctorsMessageUrl(href: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(href, baseUrl);
    if (parsed.hostname !== "www.doctors.co.il") {
      return null;
    }

    parsed.protocol = "https:";
    parsed.hash = "";
    parsed.search = "";

    const pathMatch = /^\/forum-\d+\/message-\d+\/?$/.exec(parsed.pathname);
    if (!pathMatch) {
      return null;
    }

    const normalizedPath = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    return `https://www.doctors.co.il${normalizedPath}`;
  } catch {
    return null;
  }
}

function collectDoctorsMessageUrls(indexHtml: string, indexUrl: string): string[] {
  const $ = load(indexHtml);
  const out: string[] = [];
  const seen = new Set<string>();

  $("a").each((_index: number, element: unknown) => {
    const href = (element as { attribs?: { href?: string } })?.attribs?.href;
    if (!href || !href.includes("/forum-") || !href.includes("/message-")) {
      return;
    }

    const canonical = canonicalizeDoctorsMessageUrl(href, indexUrl);
    if (!canonical || seen.has(canonical)) {
      return;
    }

    seen.add(canonical);
    out.push(canonical);
  });

  return out;
}

function extractDoctorsMessageTitle(messageHtml: string): string | null {
  const $ = load(messageHtml);

  let title = "";

  $("meta[property='og:title']").each((_index: number, element: unknown) => {
    if (title) {
      return;
    }
    const content = (element as { attribs?: { content?: string } })?.attribs?.content;
    if (content) {
      title = content;
    }
  });

  if (!title) {
    title = $("h1").text() || "";
  }

  if (!title) {
    title = $("title").text() || "";
  }

  const cleaned = normalizeWhitespace(title).replace(/\s*[-|]\s*Doctors.*$/i, "").trim();
  if (cleaned.length < 8) {
    return null;
  }

  return cleaned;
}

async function processDoctorsIndex(
  indexUrl: string,
  topic: HarvestTopic,
  indexHtml: string,
  output: HarvestItem[],
  seenKeys: Set<string>,
  nextId: { value: number },
): Promise<{ messages: number; added: number; skipped: number; bytes: number }> {
  const messageUrls = collectDoctorsMessageUrls(indexHtml, indexUrl);
  const limit = pLimit(5);

  let added = 0;
  let skipped = 0;
  let bytes = 0;

  await Promise.all(
    messageUrls.map((messageUrl) =>
      limit(async () => {
        let response: Response;
        try {
          response = await throttledFetch(messageUrl);
        } catch {
          skipped += 1;
          return;
        }

        if (!response.ok) {
          skipped += 1;
          return;
        }

        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("text/html")) {
          skipped += 1;
          return;
        }

        const html = await response.text();
        bytes += Buffer.byteLength(html, "utf8");

        const title = extractDoctorsMessageTitle(html);
        if (!title) {
          skipped += 1;
          return;
        }

        const key = dedupeKey(title, messageUrl);
        if (seenKeys.has(key)) {
          skipped += 1;
          return;
        }

        const id = `h${String(nextId.value).padStart(3, "0")}`;
        nextId.value += 1;

        output.push({
          id,
          topic,
          candidateMyth: title,
          foundInUrl: messageUrl,
          notes: "",
          needsEvidence: true,
        });

        seenKeys.add(key);
        added += 1;
      }),
    ),
  );

  return {
    messages: messageUrls.length,
    added,
    skipped,
    bytes,
  };
}

async function processUrl(
  source: HarvestSourceItem,
  output: HarvestItem[],
  seenKeys: Set<string>,
  nextId: { value: number },
): Promise<ProcessResult> {
  const { url, topic } = source;
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  })();
  const startedAt = Date.now();

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return {
      log: {
        url,
        topic,
        host,
        status: "skipped",
        ms: Date.now() - startedAt,
        bytes: 0,
        extractedCount: 0,
        reason: "invalid_url",
      },
      messages: 0,
      added: 0,
      skipped: 1,
    };
  }

  const robots = await getRobots(parsed);
  if (!robots) {
    return {
      log: {
        url,
        topic,
        host,
        status: "skipped",
        ms: Date.now() - startedAt,
        bytes: 0,
        extractedCount: 0,
        reason: "robots_unavailable",
      },
      messages: 0,
      added: 0,
      skipped: 1,
    };
  }

  const allowed = robots.isAllowed(url, USER_AGENT);
  if (allowed === false) {
    return {
      log: {
        url,
        topic,
        host,
        status: "skipped",
        ms: Date.now() - startedAt,
        bytes: 0,
        extractedCount: 0,
        reason: "robots_disallowed",
      },
      messages: 0,
      added: 0,
      skipped: 1,
    };
  }

  let response: Response;
  try {
    response = await throttledFetch(url);
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_failed";
    return {
      log: {
        url,
        topic,
        host,
        status: "error",
        ms: Date.now() - startedAt,
        bytes: 0,
        extractedCount: 0,
        reason,
      },
      messages: 0,
      added: 0,
      skipped: 1,
    };
  }

  if (!response.ok) {
    return {
      log: {
        url,
        topic,
        host,
        status: "error",
        httpStatus: response.status,
        ms: Date.now() - startedAt,
        bytes: 0,
        extractedCount: 0,
        reason: `http_${response.status}`,
      },
      messages: 0,
      added: 0,
      skipped: 1,
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) {
    return {
      log: {
        url,
        topic,
        host,
        status: "skipped",
        httpStatus: response.status,
        ms: Date.now() - startedAt,
        bytes: 0,
        extractedCount: 0,
        reason: "not_html",
      },
      messages: 0,
      added: 0,
      skipped: 1,
    };
  }

  const html = await response.text();
  const indexBytes = Buffer.byteLength(html, "utf8");

  if (parsed.hostname === "www.doctors.co.il") {
    const doctors = await processDoctorsIndex(url, topic, html, output, seenKeys, nextId);

    return {
      log: {
        url,
        topic,
        host,
        status: "fetched",
        httpStatus: response.status,
        ms: Date.now() - startedAt,
        bytes: indexBytes + doctors.bytes,
        extractedCount: doctors.added,
      },
      messages: doctors.messages,
      added: doctors.added,
      skipped: doctors.skipped,
    };
  }

  const candidates = extractCandidates(html);
  let extractedCount = 0;

  for (const candidate of candidates) {
    const key = dedupeKey(candidate, url);
    if (seenKeys.has(key)) {
      continue;
    }

    const id = `h${String(nextId.value).padStart(3, "0")}`;
    nextId.value += 1;

    output.push({
      id,
      topic,
      candidateMyth: candidate,
      foundInUrl: url,
      notes: "",
      needsEvidence: true,
    });

    seenKeys.add(key);
    extractedCount += 1;
  }

  return {
    log: {
      url,
      topic,
      host,
      status: "fetched",
      httpStatus: response.status,
      ms: Date.now() - startedAt,
      bytes: indexBytes,
      extractedCount,
    },
    messages: 0,
    added: extractedCount,
    skipped: Math.max(candidates.length - extractedCount, 0),
  };
}

async function main(): Promise<void> {
  const { max, timeoutMs } = parseArgs(process.argv.slice(2));
  requestTimeoutMs = timeoutMs;

  const sourceItems = readJson<HarvestSourceItem[]>(SOURCES_PATH);
  if (!Array.isArray(sourceItems)) {
    throw new Error("harvest-sources.json must be a JSON array");
  }

  const output = readJson<HarvestItem[]>(OUTPUT_PATH);
  if (!Array.isArray(output)) {
    throw new Error("harvest-output.json must be a JSON array");
  }

  const urls = sourceItems.slice(0, Math.min(MAX_PAGES_PER_RUN, max));
  const seenKeys = new Set(output.map((item) => dedupeKey(item.candidateMyth, item.foundInUrl)));
  const nextId = { value: getNextId(output) };

  console.log(
    `start listed=${sourceItems.length} max=${Math.min(MAX_PAGES_PER_RUN, max)} timeoutMs=${timeoutMs}`,
  );

  const logs: HarvestLogItem[] = [];

  for (let i = 0; i < urls.length; i += 1) {
    const source = urls[i];

    if (typeof source?.url !== "string" || typeof source?.topic !== "string") {
      const invalidLog: HarvestLogItem = {
        url: String(source?.url ?? ""),
        topic: "pregnancy",
        host: "",
        status: "error",
        ms: 0,
        bytes: 0,
        extractedCount: 0,
        reason: "invalid_source_item",
      };

      logs.push(invalidLog);
      console.log(
        `${i + 1}/${urls.length} pregnancy - error bytes=0 messages=0 added=0 skipped=1`,
      );
      continue;
    }

    const result = await processUrl(source, output, seenKeys, nextId);
    logs.push(result.log);

    const host = result.log.host || "-";
    console.log(
      `${i + 1}/${urls.length} ${result.log.topic} ${host} ${result.log.status} bytes=${result.log.bytes} messages=${result.messages} added=${result.added} skipped=${result.skipped}`,
    );
  }

  const existingLog = readJsonOrEmptyArray<HarvestLogItem>(LOG_PATH);
  const combinedLog = Array.isArray(existingLog) ? [...existingLog, ...logs] : logs;

  writeJson(OUTPUT_PATH, output);
  writeJson(LOG_PATH, combinedLog);

  const added = logs.reduce((sum, entry) => sum + entry.extractedCount, 0);
  const skipped = logs.filter((entry) => entry.status === "skipped").length;
  const errors = logs.filter((entry) => entry.status === "error").length;

  const topicCounts: Record<HarvestTopic, number> = {
    pregnancy: 0,
    period: 0,
    fertility: 0,
    contraception: 0,
    postpartum: 0,
    breastfeeding: 0,
  };

  for (const source of urls) {
    if (source?.topic in topicCounts) {
      topicCounts[source.topic as HarvestTopic] += 1;
    }
  }

  console.log(`Listed URLs: ${sourceItems.length}`);
  console.log(`Processed URLs (max ${Math.min(MAX_PAGES_PER_RUN, max)}): ${urls.length}`);
  console.log(`Added candidates: ${added}`);
  console.log(`Skipped: ${skipped}, Errors: ${errors}`);
  console.log("Per-topic source counts:");
  for (const [topic, count] of Object.entries(topicCounts)) {
    console.log(`  ${topic}: ${count}`);
  }
}

void main();
