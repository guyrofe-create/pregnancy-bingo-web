import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type HarvestTopic = "pregnancy" | "period" | "fertility" | "contraception";

type HarvestItem = {
  id: string;
  topic: HarvestTopic;
  candidateMyth: string;
  foundInUrl: string;
  notes: string;
  needsEvidence: boolean;
};

const VALID_TOPICS = new Set<HarvestTopic>([
  "pregnancy",
  "period",
  "fertility",
  "contraception",
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-output.json");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): { inputPath: string; sourceUrl: string; topic: HarvestTopic } {
  let inputPath = "";
  let sourceUrl = "";
  let topic: HarvestTopic = "pregnancy";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--in") {
      inputPath = argv[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg.startsWith("--in=")) {
      inputPath = arg.slice("--in=".length);
      continue;
    }

    if (arg === "--url") {
      sourceUrl = argv[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      sourceUrl = arg.slice("--url=".length);
      continue;
    }

    if (arg === "--topic") {
      const value = (argv[i + 1] ?? "") as HarvestTopic;
      topic = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--topic=")) {
      topic = arg.slice("--topic=".length) as HarvestTopic;
      continue;
    }
  }

  if (!inputPath) {
    fail('Missing required flag: --in <path>. Example: --in src/harvest/raw/source1.txt');
  }

  if (!sourceUrl) {
    fail('Missing required flag: --url "https://example.com"');
  }

  if (!VALID_TOPICS.has(topic)) {
    fail(`Invalid topic \"${topic}\". Allowed: ${[...VALID_TOPICS].join(", ")}`);
  }

  return { inputPath, sourceUrl, topic };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function removeListMarker(line: string): string {
  return normalizeWhitespace(
    line
      .replace(/^\s*[•●◦▪▫‣◉\-*–—]+\s+/, "")
      .replace(/^\s*\(?\d{1,3}\)?[.)]\s+/, "")
      .replace(/^\s*\(?[A-Za-z]\)?[.)]\s+/, "")
      .replace(/^\s*[א-ת][.)]\s+/, ""),
  );
}

function isListLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return (
    /^\s*[•●◦▪▫‣◉\-*–—]+\s+/.test(trimmed) ||
    /^\s*\(?\d{1,3}\)?[.)]\s+/.test(trimmed) ||
    /^\s*\(?[A-Za-z]\)?[.)]\s+/.test(trimmed) ||
    /^\s*[א-ת][.)]\s+/.test(trimmed)
  );
}

function extractCandidates(rawText: string): string[] {
  const candidates: string[] = [];

  for (const line of rawText.split(/\r?\n/)) {
    if (!isListLikeLine(line)) {
      continue;
    }

    const cleaned = removeListMarker(line);
    if (cleaned.length < 3) {
      continue;
    }

    candidates.push(cleaned);
  }

  return candidates;
}

function readOutputFile(filePath: string): HarvestItem[] {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      fail("harvest-output.json must contain a JSON array.");
    }
    return parsed as HarvestItem[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function getNextNumericId(items: HarvestItem[]): number {
  let maxId = 0;

  for (const item of items) {
    const match = /^h(\d+)$/.exec(item.id ?? "");
    if (!match) {
      continue;
    }

    const numeric = Number.parseInt(match[1], 10);
    if (Number.isFinite(numeric) && numeric > maxId) {
      maxId = numeric;
    }
  }

  return maxId + 1;
}

function buildDedupKey(candidateMyth: string, foundInUrl: string): string {
  return `${normalizeWhitespace(candidateMyth).toLowerCase()}::${normalizeWhitespace(foundInUrl).toLowerCase()}`;
}

function main(): void {
  const { inputPath, sourceUrl, topic } = parseArgs(process.argv.slice(2));

  const absoluteInputPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.join(ROOT_DIR, inputPath);

  const rawText = readFileSync(absoluteInputPath, "utf8");
  const extracted = extractCandidates(rawText);

  const existingItems = readOutputFile(DEFAULT_OUTPUT_PATH);
  const seen = new Set(existingItems.map((item) => buildDedupKey(item.candidateMyth, item.foundInUrl)));

  let nextId = getNextNumericId(existingItems);
  const added: HarvestItem[] = [];

  for (const candidate of extracted) {
    const key = buildDedupKey(candidate, sourceUrl);
    if (seen.has(key)) {
      continue;
    }

    const id = `h${String(nextId).padStart(3, "0")}`;
    nextId += 1;

    const newItem: HarvestItem = {
      id,
      topic,
      candidateMyth: candidate,
      foundInUrl: sourceUrl,
      notes: "",
      needsEvidence: true,
    };

    added.push(newItem);
    seen.add(key);
  }

  const updated = [...existingItems, ...added];
  writeFileSync(DEFAULT_OUTPUT_PATH, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

  console.log(`Extracted ${extracted.length} list candidates.`);
  console.log(`Added ${added.length} new harvest items.`);
  console.log(`Output file: ${path.relative(ROOT_DIR, DEFAULT_OUTPUT_PATH)}`);
}

main();
