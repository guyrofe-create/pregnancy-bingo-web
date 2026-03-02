import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidenceSeed } from "../src/types/myth";

type HarvestTopic =
  | "pregnancy"
  | "period"
  | "fertility"
  | "contraception"
  | "postpartum"
  | "breastfeeding";

type HarvestItem = {
  id: string;
  topic: string;
  candidateMyth: string;
  foundInUrl: string;
  notes: string;
  needsEvidence?: boolean;
};

type DraftMyth = {
  id: string;
  statement: string;
  answer: "myth";
  explanation: string;
  evidenceSeedIds: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_HARVEST_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-output.json");
const SEEDS_PATH = path.join(ROOT_DIR, "src", "sources", "evidence-seeds.json");
const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, "src", "harvest", "draft-myths.json");

const TOPIC_KEYWORDS: Record<HarvestTopic, string[]> = {
  pregnancy: [
    "pregnancy",
    "pregnant",
    "antenatal",
    "obstetric",
    "fetal",
    "fetus",
    "הריון",
    "עובר",
    "לידה",
    "טרימסטר",
    "בחילות",
    "צרבת",
    "קפאין",
    "קפה",
    "חומצה",
    "פולית",
  ],
  period: [
    "period",
    "menstrual",
    "menstruation",
    "menses",
    "bleeding",
    "וסת",
    "מחזור",
    "דימום",
    "טמפון",
    "כאבים",
  ],
  fertility: [
    "fertility",
    "fertile",
    "ovulation",
    "ovulate",
    "cycle",
    "window",
    "ביוץ",
    "פוריות",
    "חלון",
    "מחזור",
  ],
  contraception: [
    "contraception",
    "contraceptive",
    "birth",
    "control",
    "lactational",
    "amenorrhea",
    "lam",
    "מניעה",
    "אמצעי",
    "הנקה",
    "הריון",
  ],
  postpartum: [
    "postpartum",
    "postnatal",
    "after birth",
    "after-birth",
    "לידה",
    "אחרי",
    "לאחר",
  ],
  breastfeeding: [
    "breastfeeding",
    "breastfeed",
    "lactation",
    "lactational",
    "הנקה",
    "חלב",
    "שד",
  ],
};

function parseArgs(argv: string[]): { inputPath: string; outputPath: string } {
  let inputPath = DEFAULT_HARVEST_PATH;
  let outputPath = DEFAULT_OUTPUT_PATH;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--in") {
      inputPath = argv[i + 1] ?? inputPath;
      i += 1;
      continue;
    }

    if (arg.startsWith("--in=")) {
      inputPath = arg.slice("--in=".length);
      continue;
    }

    if (arg === "--out") {
      outputPath = argv[i + 1] ?? outputPath;
      i += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      outputPath = arg.slice("--out=".length);
      continue;
    }
  }

  const resolvePath = (value: string): string =>
    path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);

  return {
    inputPath: resolvePath(inputPath),
    outputPath: resolvePath(outputPath),
  };
}

function readJson<T>(absolutePath: string): T {
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string): Set<string> {
  const tokens = normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  return new Set(tokens);
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) {
      count += 1;
    }
  }
  return count;
}

function getSeedText(seed: EvidenceSeed): string {
  return [seed.title, seed.journal ?? "", seed.notes ?? "", seed.sourceType === "pubmed" ? seed.pubmedUrl : seed.url]
    .filter(Boolean)
    .join(" ");
}

function matchBestSeed(item: HarvestItem, seeds: EvidenceSeed[]): EvidenceSeed | null {
  const candidateTokens = tokenize(item.candidateMyth);
  const topic = (item.topic in TOPIC_KEYWORDS ? item.topic : "pregnancy") as HarvestTopic;
  const topicTokens = tokenize(TOPIC_KEYWORDS[topic].join(" "));

  let bestSeed: EvidenceSeed | null = null;
  let bestScore = 0;

  for (const seed of seeds) {
    const seedTokens = tokenize(getSeedText(seed));
    const candidateOverlap = overlapCount(candidateTokens, seedTokens);
    const topicOverlap = overlapCount(topicTokens, seedTokens);
    const score = candidateOverlap * 2 + topicOverlap;

    if (score > bestScore) {
      bestScore = score;
      bestSeed = seed;
    }
  }

  return bestScore > 0 ? bestSeed : null;
}

function toDraft(item: HarvestItem, seedId: string, index: number): DraftMyth {
  return {
    id: `m_auto_${String(index).padStart(3, "0")}`,
    statement: item.candidateMyth,
    answer: "myth",
    explanation: "Draft explanation – requires medical review.",
    evidenceSeedIds: [seedId],
  };
}

function main(): void {
  const { inputPath, outputPath } = parseArgs(process.argv.slice(2));

  const harvestItems = readJson<HarvestItem[]>(inputPath);
  const seeds = readJson<EvidenceSeed[]>(SEEDS_PATH);

  const pending = harvestItems.filter((item) => item.needsEvidence === true);

  const drafts: DraftMyth[] = [];
  let counter = 1;

  for (const item of pending) {
    const match = matchBestSeed(item, seeds);
    if (!match) {
      continue;
    }

    drafts.push(toDraft(item, match.id, counter));
    counter += 1;
  }

  writeFileSync(outputPath, `${JSON.stringify(drafts, null, 2)}\n`, "utf8");

  console.log(`Harvest items total: ${harvestItems.length}`);
  console.log(`Pending needsEvidence=true: ${pending.length}`);
  console.log(`Draft myths generated: ${drafts.length}`);
  console.log(`Output: ${path.relative(ROOT_DIR, outputPath)}`);
}

main();
