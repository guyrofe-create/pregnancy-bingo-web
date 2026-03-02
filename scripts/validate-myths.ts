import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidenceSeed, MythItem } from "../src/types/myth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const MYTHS_PATH = path.join(ROOT_DIR, "src", "data", "myths.he.json");
const SEEDS_PATH = path.join(ROOT_DIR, "src", "sources", "evidence-seeds.json");
const ALLOWLIST_PATH = path.join(ROOT_DIR, "src", "sources", "allowlist.json");

const BANNED_EXPLANATION_SUBSTRINGS = [
  "פני",
  "גש",
  "מייד",
  "דחוף",
  "חדר מיון",
  "להיבדק",
  "ליצור קשר",
  "להתייעץ",
] as const;

function readJson<T>(absolutePath: string): T {
  return JSON.parse(readRequiredFile(absolutePath)) as T;
}

function readRequiredFile(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const relativePath = path.relative(ROOT_DIR, absolutePath).replace(/\\/g, "/");
      console.error(`Missing required file: ${relativePath}`);
      process.exit(1);
    }

    throw error;
  }
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isAllowedDomain(hostname: string, allowlist: Set<string>): boolean {
  const normalized = hostname.toLowerCase();
  for (const domain of allowlist) {
    if (normalized === domain || normalized.endsWith(`.${domain}`)) {
      return true;
    }
  }
  return false;
}

function validateSeed(seed: EvidenceSeed, allowlist: Set<string>, errors: string[]): void {
  const prefix = `seed ${seed.id}`;

  if (!seed.id || !seed.id.trim()) {
    errors.push(`${prefix}: missing id.`);
    return;
  }

  if (seed.sourceType === "pubmed") {
    if (!seed.pmid || !/^\d+$/.test(seed.pmid)) {
      errors.push(`${prefix}: pubmed seed must include numeric pmid.`);
    }

    if (!seed.pubmedUrl || typeof seed.pubmedUrl !== "string") {
      errors.push(`${prefix}: pubmed seed must include pubmedUrl.`);
    } else {
      const parsed = parseUrl(seed.pubmedUrl);
      if (!parsed) {
        errors.push(`${prefix}: pubmedUrl is invalid.`);
      }

      if (seed.pmid && !seed.pubmedUrl.includes(seed.pmid)) {
        errors.push(`${prefix}: pubmedUrl must include pmid ${seed.pmid}.`);
      }
    }

    if (!seed.abstractQuote || !seed.abstractQuote.trim()) {
      errors.push(`${prefix}: pubmed seed must include abstractQuote.`);
    } else if (countWords(seed.abstractQuote) > 25) {
      errors.push(`${prefix}: abstractQuote exceeds 25 words.`);
    }

    return;
  }

  if (seed.sourceType === "guideline") {
    if (!seed.url || typeof seed.url !== "string") {
      errors.push(`${prefix}: guideline seed must include url.`);
      return;
    }

    const parsed = parseUrl(seed.url);
    if (!parsed) {
      errors.push(`${prefix}: guideline url is invalid.`);
      return;
    }

    if (!isAllowedDomain(parsed.hostname, allowlist)) {
      errors.push(`${prefix}: guideline domain ${parsed.hostname} is not in allowlist.`);
    }
  }
}

function validateMyth(
  myth: MythItem,
  evidenceById: Map<string, EvidenceSeed>,
  errors: string[],
): void {
  const prefix = myth.id || "unknown-myth";

  if (!myth.id || !myth.id.trim()) {
    errors.push("myth: missing id.");
    return;
  }

  if (!myth.explanation || !myth.explanation.trim()) {
    errors.push(`${prefix}: missing explanation.`);
  }

  for (const phrase of BANNED_EXPLANATION_SUBSTRINGS) {
    if (myth.explanation.includes(phrase)) {
      errors.push(`${prefix}: explanation contains banned phrase "${phrase}".`);
    }
  }

  if (!Array.isArray(myth.evidenceSeedIds) || myth.evidenceSeedIds.length === 0) {
    errors.push(`${prefix}: evidenceSeedIds must include at least one id.`);
    return;
  }

  myth.evidenceSeedIds.forEach((seedId, index) => {
    if (!seedId || !seedId.trim()) {
      errors.push(`${prefix}: evidenceSeedIds[${index}] is empty.`);
      return;
    }

    if (!evidenceById.has(seedId)) {
      errors.push(`${prefix}: evidenceSeedId "${seedId}" was not found in evidence-seeds.json.`);
    }
  });
}

function main(): void {
  const myths = readJson<MythItem[]>(MYTHS_PATH);
  const seeds = readJson<EvidenceSeed[]>(SEEDS_PATH);
  const allowlistDomains = readJson<string[]>(ALLOWLIST_PATH);

  if (!Array.isArray(myths)) {
    console.error("Validation failed: myths.he.json must be an array.");
    process.exit(1);
  }

  if (!Array.isArray(seeds)) {
    console.error("Validation failed: evidence-seeds.json must be an array.");
    process.exit(1);
  }

  if (!Array.isArray(allowlistDomains) || allowlistDomains.length === 0) {
    console.error("Validation failed: allowlist.json must be a non-empty array.");
    process.exit(1);
  }

  const allowlist = new Set(allowlistDomains.map((d) => d.toLowerCase()));
  const errors: string[] = [];
  const evidenceById = new Map<string, EvidenceSeed>();

  for (const seed of seeds) {
    if (seed.id && evidenceById.has(seed.id)) {
      errors.push(`seed ${seed.id}: duplicate seed id.`);
      continue;
    }

    validateSeed(seed, allowlist, errors);
    evidenceById.set(seed.id, seed);
  }

  myths.forEach((myth) => validateMyth(myth, evidenceById, errors));

  if (errors.length > 0) {
    console.error("Myths validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Myths validation passed (${myths.length} myths, ${seeds.length} seeds).`);
}

main();
