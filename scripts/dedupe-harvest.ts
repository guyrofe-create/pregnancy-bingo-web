import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

type DedupeReport = {
  total: number;
  unique: number;
  removed: number;
  topReasons: Array<{ reason: string; count: number }>;
  perTopic: Record<
    string,
    {
      total: number;
      unique: number;
      removed: number;
    }
  >;
  top5000Count: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const INPUT_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-output.json");
const UNIQUE_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-unique.json");
const TOP5000_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-unique-top5000.json");
const REPORT_PATH = path.join(ROOT_DIR, "src", "harvest", "dedupe-report.json");

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "be",
  "with",
  "as",
  "by",
  "from",
  "that",
  "this",
  "it",
  "can",
  "cant",
  "cannot",
  "צריך",
  "צריכה",
  "אפשר",
  "אי",
  "לא",
  "כן",
  "של",
  "על",
  "עם",
  "בלי",
  "גם",
  "רק",
  "כל",
  "אם",
  "זה",
  "זו",
  "זאת",
  "אותו",
  "אותה",
  "יש",
  "אין",
  "כי",
  "או",
  "האם",
]);

const MYTH_MARKERS = [
  "מיתוס",
  "נכון",
  "לא נכון",
  "אסור",
  "מותר",
  "מסוכן",
  "בטוח",
  "גורם",
  "מעלה",
  "מוריד",
  "אי אפשר",
  "תמיד",
  "אף פעם",
];

const BOILERPLATE_WORDS = [
  "login",
  "register",
  "cookie",
  "newsletter",
  "share",
  "כניסה",
  "הרשמה",
  "שתף",
  "קוקי",
  "ניוזלטר",
];

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stripPunctuation(value: string): string {
  return value.replace(/[.,!?;:"'()\[\]{}|/\\״׳־…`~<>+=_*^%$#@]/g, " ");
}

function normalizeText(value: string): string {
  return normalizeSpaces(stripPunctuation(value.toLowerCase()));
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .filter((token) => !STOPWORDS.has(token));
}

function normalizedKey(value: string): string {
  return tokenize(value).join(" ");
}

function signature(value: string): string {
  const uniqueSorted = [...new Set(tokenize(value))].sort();
  return uniqueSorted.slice(0, 12).join("|");
}

function scoreCandidate(value: string): number {
  const normalized = value.toLowerCase();
  let score = 0;

  for (const marker of MYTH_MARKERS) {
    if (normalized.includes(marker)) {
      score += 2;
    }
  }

  if (normalized.trim().endsWith("?")) {
    score += 1;
  }

  const len = value.trim().length;
  if (len >= 25 && len <= 110) {
    score += 2;
  }

  for (const word of BOILERPLATE_WORDS) {
    if (normalized.includes(word)) {
      score -= 3;
      break;
    }
  }

  const digits = (value.match(/\d/g) ?? []).length;
  if (digits >= 4 || digits > value.length * 0.15) {
    score -= 2;
  }

  return score;
}

function ensureNeedsEvidence(item: HarvestItem): HarvestItem {
  return {
    ...item,
    notes: typeof item.notes === "string" ? item.notes : "",
    needsEvidence: true,
  };
}

function pickShortest(items: HarvestItem[]): HarvestItem {
  let best = items[0];
  for (const item of items.slice(1)) {
    if (item.candidateMyth.length < best.candidateMyth.length) {
      best = item;
    }
  }
  return best;
}

function main(): void {
  const input = readJson<HarvestItem[]>(INPUT_PATH);
  if (!Array.isArray(input)) {
    throw new Error("harvest-output.json must be an array");
  }

  const reasonCounts = new Map<string, number>();
  const incReason = (reason: string): void => {
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  };

  const topicStats = new Map<string, { total: number; unique: number; removed: number }>();
  const ensureTopicStat = (topic: string) => {
    if (!topicStats.has(topic)) {
      topicStats.set(topic, { total: 0, unique: 0, removed: 0 });
    }
    return topicStats.get(topic)!;
  };

  const sanitizedInput = input.map(ensureNeedsEvidence);

  for (const item of sanitizedInput) {
    ensureTopicStat(item.topic).total += 1;
  }

  const exactSeen = new Map<string, HarvestItem>();
  const exactPass: HarvestItem[] = [];

  for (const item of sanitizedInput) {
    const key = normalizedKey(item.candidateMyth);
    if (!key) {
      incReason("empty_after_normalization");
      ensureTopicStat(item.topic).removed += 1;
      continue;
    }

    if (exactSeen.has(key)) {
      incReason("exact_normalized_duplicate");
      ensureTopicStat(item.topic).removed += 1;
      continue;
    }

    exactSeen.set(key, item);
    exactPass.push(item);
  }

  const buckets = new Map<string, HarvestItem[]>();
  for (const item of exactPass) {
    const key = signature(item.candidateMyth);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key)!.push(item);
  }

  const uniqueItems: HarvestItem[] = [];

  for (const [, bucketItems] of buckets) {
    if (bucketItems.length === 1) {
      uniqueItems.push(bucketItems[0]);
      continue;
    }

    const kept = pickShortest(bucketItems);
    uniqueItems.push(kept);

    for (const dropped of bucketItems) {
      if (dropped.id === kept.id) {
        continue;
      }
      incReason("near_signature_duplicate");
      ensureTopicStat(dropped.topic).removed += 1;
    }
  }

  uniqueItems.sort((a, b) => a.id.localeCompare(b.id));

  for (const item of uniqueItems) {
    ensureTopicStat(item.topic).unique += 1;
  }

  const top5000 = [...uniqueItems]
    .sort((a, b) => {
      const scoreDiff = scoreCandidate(b.candidateMyth) - scoreCandidate(a.candidateMyth);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, 5000)
    .map(ensureNeedsEvidence);

  const topReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));

  const perTopic = Object.fromEntries(
    [...topicStats.entries()].map(([topic, stats]) => [topic, stats]),
  );

  const report: DedupeReport = {
    total: sanitizedInput.length,
    unique: uniqueItems.length,
    removed: sanitizedInput.length - uniqueItems.length,
    topReasons,
    perTopic,
    top5000Count: top5000.length,
  };

  writeJson(UNIQUE_PATH, uniqueItems.map(ensureNeedsEvidence));
  writeJson(TOP5000_PATH, top5000);
  writeJson(REPORT_PATH, report);

  console.log(`total: ${report.total}`);
  console.log(`unique: ${report.unique}`);
  console.log(`removed: ${report.removed}`);
  console.log(`top5000: ${report.top5000Count}`);
  console.log("per-topic:");
  for (const [topic, stats] of Object.entries(report.perTopic)) {
    console.log(`  ${topic}: total=${stats.total}, unique=${stats.unique}, removed=${stats.removed}`);
  }
}

main();
