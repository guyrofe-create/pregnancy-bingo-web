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

type HarvestLogItem = {
  url: string;
  fetched: boolean;
  skippedReason?: string;
  extractedCount: number;
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 MythHarvesterBot/1.0";
const REQUEST_INTERVAL_MS = 1000;
const MAX_PAGES_PER_RUN = 300;

const SELECTORS = [
  "li",
  "h2",
  "h3",
  "details > summary",
  "article",
  ".post",
  ".message",
  ".comment",
];

const BOILERPLATE_WORDS = [
  "כניסה",
  "הרשמה",
  "תגובות",
  "שתף",
  "שתפו",
  "חיפוש",
  "פרסומת",
  "תפריט",
  "ניווט",
  "skip to",
  "read more",
  "sign in",
  "sign up",
  "subscribe",
  "cookie",
  "privacy",
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const SOURCES_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-sources.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-output.json");
const LOG_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-log.json");

const robotsCache = new Map<string, ReturnType<typeof robotsParser> | null>();
let nextRequestAt = 0;

function readJson<T>(absolutePath: string): T {
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
}

function writeJson(absolutePath: string, value: unknown): void {
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttledFetch(url: string): Promise<Response> {
  const now = Date.now();
  if (now < nextRequestAt) {
    await sleep(nextRequestAt - now);
  }

  try {
    return await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      credentials: "omit",
    });
  } finally {
    nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
  }
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function stripListMarker(input: string): string {
  return normalizeWhitespace(
    input
      .replace(/^\s*[•●◦▪▫‣◉\-*–—]+\s+/, "")
      .replace(/^\s*\(?\d{1,3}\)?[.)]\s+/, "")
      .replace(/^\s*\(?[A-Za-z]\)?[.)]\s+/, "")
      .replace(/^\s*[א-ת][.)]\s+/, ""),
  );
}

function hasTextLanguageChars(input: string): boolean {
  return /[A-Za-z\u0590-\u05FF]/.test(input);
}

function isBoilerplate(input: string): boolean {
  const normalized = input.toLowerCase();
  return BOILERPLATE_WORDS.some((word) => normalized.includes(word));
}

function inferTopic(urlString: string): HarvestTopic {
  const lower = decodeURIComponent(urlString).toLowerCase();

  if (
    lower.includes("postpartum") ||
    lower.includes("after-birth") ||
    lower.includes("אחרי-לידה") ||
    lower.includes("לאחר-לידה")
  ) {
    return "postpartum";
  }

  if (
    lower.includes("breast") ||
    lower.includes("lactation") ||
    lower.includes("lactational") ||
    lower.includes("הנקה")
  ) {
    return "breastfeeding";
  }

  if (
    lower.includes("contraception") ||
    lower.includes("birth-control") ||
    lower.includes("amenorrhea") ||
    lower.includes("מניעה")
  ) {
    return "contraception";
  }

  if (
    lower.includes("fertility") ||
    lower.includes("ovulation") ||
    lower.includes("פוריות") ||
    lower.includes("ביוץ")
  ) {
    return "fertility";
  }

  if (
    lower.includes("period") ||
    lower.includes("menstrual") ||
    lower.includes("menstruation") ||
    lower.includes("ווסת") ||
    lower.includes("מחזור")
  ) {
    return "period";
  }

  return "pregnancy";
}

function dedupeKey(candidateMyth: string, foundInUrl: string): string {
  return `${normalizeWhitespace(candidateMyth).toLowerCase()}::${normalizeWhitespace(foundInUrl).toLowerCase()}`;
}

function getNextId(items: HarvestItem[]): number {
  let max = 0;
  for (const item of items) {
    const match = /^h(\d+)$/.exec(item.id);
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

async function getRobotsForUrl(url: URL): Promise<ReturnType<typeof robotsParser> | null> {
  const key = url.origin;
  if (robotsCache.has(key)) {
    return robotsCache.get(key) ?? null;
  }

  const robotsUrl = `${url.origin}/robots.txt`;

  try {
    const response = await throttledFetch(robotsUrl);

    if (!response.ok) {
      if (response.status === 404 || response.status === 403 || response.status === 401) {
        const parser = robotsParser(robotsUrl, "");
        robotsCache.set(key, parser);
        return parser;
      }

      robotsCache.set(key, null);
      return null;
    }

    const body = await response.text();
    const parser = robotsParser(robotsUrl, body);
    robotsCache.set(key, parser);
    return parser;
  } catch {
    robotsCache.set(key, null);
    return null;
  }
}

function extractCandidatesFromHtml(html: string): string[] {
  const $ = load(html);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const selector of SELECTORS) {
    $(selector).each((_index: number, element: unknown) => {
      const text = stripListMarker($(element).text());

      if (text.length < 15 || text.length > 180) {
        return;
      }

      if (!hasTextLanguageChars(text)) {
        return;
      }

      if (isBoilerplate(text)) {
        return;
      }

      const key = text.toLowerCase();
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      out.push(text);
    });
  }

  return out;
}

async function processUrl(
  urlString: string,
  existing: HarvestItem[],
  keySet: Set<string>,
  nextIdRef: { current: number },
): Promise<{ log: HarvestLogItem; added: HarvestItem[] }> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(urlString);
  } catch {
    return {
      log: { url: urlString, fetched: false, skippedReason: "invalid_url", extractedCount: 0 },
      added: [],
    };
  }

  const robots = await getRobotsForUrl(parsedUrl);

  if (!robots) {
    return {
      log: { url: urlString, fetched: false, skippedReason: "robots_unavailable", extractedCount: 0 },
      added: [],
    };
  }

  const allowed = robots.isAllowed(urlString, USER_AGENT);
  if (allowed === false) {
    return {
      log: { url: urlString, fetched: false, skippedReason: "robots_disallowed", extractedCount: 0 },
      added: [],
    };
  }

  let response: Response;
  try {
    response = await throttledFetch(urlString);
  } catch {
    return {
      log: { url: urlString, fetched: false, skippedReason: "fetch_failed", extractedCount: 0 },
      added: [],
    };
  }

  if (!response.ok) {
    return {
      log: {
        url: urlString,
        fetched: false,
        skippedReason: `http_${response.status}`,
        extractedCount: 0,
      },
      added: [],
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) {
    return {
      log: {
        url: urlString,
        fetched: false,
        skippedReason: "not_html",
        extractedCount: 0,
      },
      added: [],
    };
  }

  const html = await response.text();
  const candidates = extractCandidatesFromHtml(html);
  const topic = inferTopic(urlString);

  const added: HarvestItem[] = [];
  for (const line of candidates) {
    const key = dedupeKey(line, urlString);
    if (keySet.has(key)) {
      continue;
    }

    const id = `h${String(nextIdRef.current).padStart(3, "0")}`;
    nextIdRef.current += 1;

    const item: HarvestItem = {
      id,
      topic,
      candidateMyth: line,
      foundInUrl: urlString,
      notes: "",
      needsEvidence: true,
    };

    existing.push(item);
    keySet.add(key);
    added.push(item);
  }

  return {
    log: {
      url: urlString,
      fetched: true,
      extractedCount: added.length,
    },
    added,
  };
}

async function main(): Promise<void> {
  const sourceUrls = readJson<string[]>(SOURCES_PATH);
  if (!Array.isArray(sourceUrls)) {
    throw new Error("harvest-sources.json must be an array of URLs");
  }

  const existingOutput = readJson<HarvestItem[]>(OUTPUT_PATH);
  if (!Array.isArray(existingOutput)) {
    throw new Error("harvest-output.json must be an array");
  }

  const limitedUrls = sourceUrls.slice(0, MAX_PAGES_PER_RUN);
  const keySet = new Set(existingOutput.map((item) => dedupeKey(item.candidateMyth, item.foundInUrl)));
  const nextIdRef = { current: getNextId(existingOutput) };

  const limit = pLimit(1);
  const tasks = limitedUrls.map((url) =>
    limit(() => processUrl(url, existingOutput, keySet, nextIdRef)),
  );

  const results = await Promise.all(tasks);
  const logs = results.map((result) => result.log);

  writeJson(OUTPUT_PATH, existingOutput);
  writeJson(LOG_PATH, logs);

  const addedCount = results.reduce((sum, result) => sum + result.added.length, 0);
  const skippedCount = logs.filter((log) => !log.fetched).length;

  console.log(`Sources listed: ${sourceUrls.length}`);
  console.log(`Processed (capped): ${limitedUrls.length}`);
  console.log(`Added candidates: ${addedCount}`);
  console.log(`Skipped URLs: ${skippedCount}`);
  console.log(`Log file: ${path.relative(ROOT_DIR, LOG_PATH)}`);
}

void main();
