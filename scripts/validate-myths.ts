import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidenceLevel, EvidenceSeed, MythItem } from "../src/types/myth";

type QuestionStatus = "approved" | "rejected";

type QuestionRejectReason =
  | "too_short_or_unclear"
  | "noise_or_reply"
  | "personal_case"
  | "duplicate_exact"
  | "duplicate_near";

type QuestionAuditItem = {
  sourceFile: string;
  id: string;
  originalStatement: string;
  cleanedStatement: string;
  questionStatus: QuestionStatus;
  questionRejectReason?: QuestionRejectReason;
};

type ValidationViolation = {
  id: string;
  file: string;
  field: string;
  reason: string;
};

type ValidationReport = {
  generatedAt: string;
  counts: {
    total: number;
    approvedQuestions: number;
    rejectedQuestions: number;
    truth: number;
    myth: number;
    unknown: number;
  };
  datasets: Array<{
    file: string;
    total: number;
    approvedQuestions: number;
    rejectedQuestions: number;
    truth: number;
    myth: number;
    unknown: number;
    violations: number;
  }>;
  questionQualitySummary: Record<string, number>;
  violations: ValidationViolation[];
  questionStatuses: QuestionAuditItem[];
  problematicExamples: QuestionAuditItem[];
  samplePass: Array<{
    id: string;
    statement: string;
    answer: MythItem["answer"];
    evidenceLevel: EvidenceLevel;
    evidenceSeedIds: string[];
  }>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const MYTHS_PATH = path.join(ROOT_DIR, "src", "data", "myths.he.json");
const SEEDS_PATH = path.join(ROOT_DIR, "src", "sources", "evidence-seeds.json");
const ALLOWLIST_PATH = path.join(ROOT_DIR, "src", "sources", "allowlist.json");
const DRAFT_TOP_PATH = path.join(ROOT_DIR, "src", "harvest", "draft-myths-top5000.json");
const DRAFT_ALL_PATH = path.join(ROOT_DIR, "src", "harvest", "draft-myths.json");

const REPORT_JSON_PATH = path.join(ROOT_DIR, "report.json");
const REPORT_MD_PATH = path.join(ROOT_DIR, "report.md");

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

const PLACEHOLDER_PATTERNS = [
  /draft explanation/i,
  /requires medical review/i,
  /\btodo\b/i,
  /placeholder/i,
];

const VALID_EVIDENCE_LEVELS: EvidenceLevel[] = [
  "strong",
  "moderate",
  "limited",
  "mixed",
  "insufficient",
];

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

function readJsonRequired<T>(absolutePath: string): T {
  return JSON.parse(readRequiredFile(absolutePath)) as T;
}

function readJsonOptional<T>(absolutePath: string): T | null {
  if (!existsSync(absolutePath)) {
    return null;
  }
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanStatement(raw: string): string {
  let statement = raw ?? "";
  statement = statement.replace(/^\s*re:\s*/i, "");
  statement = statement.replace(/\(לת\)/g, "");
  statement = statement.replace(/\[\s*לת\s*\]/g, "");
  statement = statement.replace(/[?]{2,}/g, "?");
  statement = statement.replace(/[!]{2,}/g, "!");
  statement = normalizeWhitespace(statement);
  statement = statement.replace(/\s+([?.!,])/g, "$1");

  if (statement && !/[.!?]$/.test(statement)) {
    statement += ".";
  }

  return statement;
}

function statementSignature(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[.,!?:"'(){}\[\]|/\\־–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function statementNearSignature(statement: string): string {
  const tokens = statementSignature(statement)
    .split(" ")
    .filter((token) => token.length > 1);
  const unique = [...new Set(tokens)].sort();
  return unique.slice(0, 12).join("|");
}

function detectQuestionRejectReason(cleaned: string): QuestionRejectReason | null {
  const noPunctuation = cleaned.replace(/[.?!]/g, "").trim();
  if (noPunctuation.length < 12) {
    return "too_short_or_unclear";
  }

  if (/^(נכון|תודה|תודה רבה|תודה לך|תודה דוקטור)/.test(noPunctuation)) {
    return "noise_or_reply";
  }

  if (/(^|\s)(אני|לי|שלי|בעלי|קרה לי|עברתי|הייתי|הילד שלי)(\s|$)/.test(noPunctuation)) {
    return "personal_case";
  }

  return null;
}

function isHighQualitySeed(seed: EvidenceSeed): boolean {
  if (seed.sourceKind === "guideline" || seed.sourceKind === "government") {
    return true;
  }

  const reviewLike = seed.articleType === "systematic_review" || seed.articleType === "meta_analysis";
  if (reviewLike) {
    return true;
  }

  const hasIdentifier = Boolean(seed.identifiers?.pmid || seed.identifiers?.doi);
  return seed.sourceKind === "paper" && hasIdentifier;
}

function validateSeed(
  seed: EvidenceSeed,
  allowlist: Set<string>,
  violations: ValidationViolation[],
): void {
  const file = "src/sources/evidence-seeds.json";
  const id = seed.id || "unknown-seed";

  if (!seed.id || !seed.id.trim()) {
    violations.push({ id, file, field: "id", reason: "missing id" });
    return;
  }

  if (!seed.title?.trim()) {
    violations.push({ id, file, field: "title", reason: "missing title" });
  }

  if (!seed.publisher?.trim()) {
    violations.push({ id, file, field: "publisher", reason: "missing publisher" });
  }

  if (!seed.sourceKind) {
    violations.push({ id, file, field: "sourceKind", reason: "missing sourceKind" });
  }

  if (seed.sourceType === "pubmed") {
    if (!seed.pmid || !/^\d+$/.test(seed.pmid)) {
      violations.push({ id, file, field: "pmid", reason: "pubmed seed must include numeric pmid" });
    }

    if (!seed.identifiers?.pmid) {
      violations.push({
        id,
        file,
        field: "identifiers.pmid",
        reason: "pubmed seed must include identifiers.pmid",
      });
    }

    if (!seed.pubmedUrl || typeof seed.pubmedUrl !== "string") {
      violations.push({ id, file, field: "pubmedUrl", reason: "pubmed seed must include pubmedUrl" });
      return;
    }

    const parsed = parseUrl(seed.pubmedUrl);
    if (!parsed) {
      violations.push({ id, file, field: "pubmedUrl", reason: "pubmedUrl is invalid" });
      return;
    }

    if (seed.pmid && !seed.pubmedUrl.includes(seed.pmid)) {
      violations.push({ id, file, field: "pubmedUrl", reason: `pubmedUrl must include pmid ${seed.pmid}` });
    }

    if (!isAllowedDomain(parsed.hostname, allowlist)) {
      violations.push({
        id,
        file,
        field: "pubmedUrl",
        reason: `pubmed domain ${parsed.hostname} is not in allowlist`,
      });
    }

    if (!seed.abstractQuote?.trim()) {
      violations.push({ id, file, field: "abstractQuote", reason: "pubmed seed must include abstractQuote" });
    } else if (countWords(seed.abstractQuote) > 25) {
      violations.push({ id, file, field: "abstractQuote", reason: "abstractQuote exceeds 25 words" });
    }

    return;
  }

  if (!seed.url || typeof seed.url !== "string") {
    violations.push({ id, file, field: "url", reason: "guideline/government seed must include url" });
    return;
  }

  const parsed = parseUrl(seed.url);
  if (!parsed) {
    violations.push({ id, file, field: "url", reason: "url is invalid" });
    return;
  }

  if (!isAllowedDomain(parsed.hostname, allowlist)) {
    violations.push({
      id,
      file,
      field: "url",
      reason: `domain ${parsed.hostname} is not in allowlist`,
    });
  }
}

function validateMyth(
  myth: MythItem,
  evidenceById: Map<string, EvidenceSeed>,
  violations: ValidationViolation[],
): void {
  const file = "src/data/myths.he.json";
  const id = myth.id || "unknown-myth";

  if (!myth.id?.trim()) {
    violations.push({ id, file, field: "id", reason: "missing id" });
    return;
  }

  if (!myth.explanation?.trim()) {
    violations.push({ id, file, field: "explanation", reason: "missing explanation" });
  } else {
    for (const phrase of BANNED_EXPLANATION_SUBSTRINGS) {
      if (myth.explanation.includes(phrase)) {
        violations.push({
          id,
          file,
          field: "explanation",
          reason: `contains banned phrase "${phrase}"`,
        });
      }
    }

    if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(myth.explanation))) {
      violations.push({ id, file, field: "explanation", reason: "placeholder explanation is not allowed" });
    }
  }

  if (!VALID_EVIDENCE_LEVELS.includes(myth.evidenceLevel)) {
    violations.push({
      id,
      file,
      field: "evidenceLevel",
      reason: "missing or invalid evidenceLevel (strong|moderate|limited|mixed|insufficient)",
    });
  }

  if (!Array.isArray(myth.evidenceSeedIds) || myth.evidenceSeedIds.length === 0) {
    violations.push({ id, file, field: "evidenceSeedIds", reason: "must include at least one seed id" });
    return;
  }

  const resolvedSeeds: EvidenceSeed[] = [];
  myth.evidenceSeedIds.forEach((seedId, index) => {
    if (!seedId?.trim()) {
      violations.push({ id, file, field: `evidenceSeedIds[${index}]`, reason: "empty seed id" });
      return;
    }

    const seed = evidenceById.get(seedId);
    if (!seed) {
      violations.push({
        id,
        file,
        field: `evidenceSeedIds[${index}]`,
        reason: `seed "${seedId}" was not found in evidence-seeds.json`,
      });
      return;
    }

    resolvedSeeds.push(seed);
  });

  const isUnknown = myth.answer === "unknown";
  const isTruthMyth = myth.answer === "truth" || myth.answer === "myth";
  const isMixedOrInsufficient = myth.evidenceLevel === "mixed" || myth.evidenceLevel === "insufficient";

  if (isTruthMyth && isMixedOrInsufficient) {
    violations.push({
      id,
      file,
      field: "answer",
      reason: "truth/myth is forbidden when evidenceLevel is mixed/insufficient; must be unknown",
    });
  }

  if (isUnknown && !isMixedOrInsufficient) {
    violations.push({
      id,
      file,
      field: "answer",
      reason: "unknown answer must use evidenceLevel mixed or insufficient",
    });
  }

  if (isTruthMyth) {
    const hasStrongSource = resolvedSeeds.some((seed) => isHighQualitySeed(seed));
    if (!hasStrongSource) {
      violations.push({
        id,
        file,
        field: "evidenceSeedIds",
        reason:
          "truth/myth requires at least one high-quality source (guideline/government/review or paper with PMID/DOI)",
      });
    }

    const hasQuoteOrSummary =
      Boolean(myth.evidenceQuote?.trim()) ||
      Boolean(myth.evidenceSummary?.trim());

    if (!hasQuoteOrSummary) {
      violations.push({
        id,
        file,
        field: "evidenceSummary|evidenceQuote",
        reason: "truth/myth requires evidenceQuote or evidenceSummary; otherwise answer must be unknown",
      });
    }
  }
}

function asAuditItem(sourceFile: string, raw: unknown, index: number): QuestionAuditItem {
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : `${path.basename(sourceFile)}-${index + 1}`;
  const statementRaw =
    typeof record.statement === "string"
      ? record.statement
      : typeof record.candidateMyth === "string"
        ? record.candidateMyth
        : "";

  const cleanedStatement = cleanStatement(statementRaw);
  const rejectReason = detectQuestionRejectReason(cleanedStatement);

  return {
    sourceFile,
    id,
    originalStatement: statementRaw,
    cleanedStatement,
    questionStatus: rejectReason ? "rejected" : "approved",
    questionRejectReason: rejectReason ?? undefined,
  };
}

function applyQuestionDedup(audits: QuestionAuditItem[]): void {
  const exactSeen = new Map<string, string>();
  const nearSeen = new Map<string, string>();

  for (const item of audits) {
    if (item.questionStatus === "rejected") {
      continue;
    }

    const exact = statementSignature(item.cleanedStatement);
    if (exactSeen.has(exact)) {
      item.questionStatus = "rejected";
      item.questionRejectReason = "duplicate_exact";
      continue;
    }
    exactSeen.set(exact, item.id);

    const near = statementNearSignature(item.cleanedStatement);
    if (near && nearSeen.has(near)) {
      item.questionStatus = "rejected";
      item.questionRejectReason = "duplicate_near";
      continue;
    }
    if (near) {
      nearSeen.set(near, item.id);
    }
  }
}

function buildMarkdownReport(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push("# Myths Validation Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Total myths: ${report.counts.total}`);
  lines.push(`- Approved questions: ${report.counts.approvedQuestions}`);
  lines.push(`- Rejected questions: ${report.counts.rejectedQuestions}`);
  lines.push(`- Answer counts: truth=${report.counts.truth}, myth=${report.counts.myth}, unknown=${report.counts.unknown}`);
  lines.push("");

  lines.push("## Datasets Scanned");
  lines.push("");
  report.datasets.forEach((dataset) => {
    lines.push(
      `- ${dataset.file}: total=${dataset.total}, truth=${dataset.truth}, myth=${dataset.myth}, unknown=${dataset.unknown}, approved=${dataset.approvedQuestions}, rejected=${dataset.rejectedQuestions}, violations=${dataset.violations}`,
    );
  });
  lines.push("");

  lines.push("## Question Quality Summary");
  lines.push("");
  Object.entries(report.questionQualitySummary).forEach(([reason, count]) => {
    lines.push(`- ${reason}: ${count}`);
  });
  lines.push("");

  lines.push("## Violations");
  lines.push("");
  if (report.violations.length === 0) {
    lines.push("- none");
  } else {
    report.violations.forEach((v) => {
      lines.push(`- ${v.id} | ${v.file} | ${v.field} | ${v.reason}`);
    });
  }
  lines.push("");

  lines.push("## 50 Problematic Examples");
  lines.push("");
  if (report.problematicExamples.length === 0) {
    lines.push("- none");
  } else {
    report.problematicExamples.forEach((item) => {
      lines.push(`- ${item.id} (${item.sourceFile}) -> ${item.questionRejectReason ?? "unknown_reason"}`);
      lines.push(`  - "${item.originalStatement}"`);
      lines.push(`  - cleaned: "${item.cleanedStatement}"`);
    });
  }
  lines.push("");

  lines.push("## 20 Passed Samples");
  lines.push("");
  report.samplePass.forEach((item) => {
    lines.push(`- ${item.id} | ${item.answer} | ${item.evidenceLevel} | ${item.evidenceSeedIds.join(", ")}`);
    lines.push(`  - ${item.statement}`);
  });
  lines.push("");

  return lines.join("\n");
}

function main(): void {
  const myths = readJsonRequired<MythItem[]>(MYTHS_PATH);
  const seeds = readJsonRequired<EvidenceSeed[]>(SEEDS_PATH);
  const allowlistDomains = readJsonRequired<string[]>(ALLOWLIST_PATH);
  const draftTop = readJsonOptional<unknown[]>(DRAFT_TOP_PATH) ?? [];
  const draftAll = readJsonOptional<unknown[]>(DRAFT_ALL_PATH) ?? [];

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
  const violations: ValidationViolation[] = [];
  const evidenceById = new Map<string, EvidenceSeed>();

  for (const seed of seeds) {
    if (seed.id && evidenceById.has(seed.id)) {
      violations.push({
        id: seed.id,
        file: "src/sources/evidence-seeds.json",
        field: "id",
        reason: "duplicate seed id",
      });
      continue;
    }
    validateSeed(seed, allowlist, violations);
    evidenceById.set(seed.id, seed);
  }

  myths.forEach((myth) => validateMyth(myth, evidenceById, violations));

  const audits: QuestionAuditItem[] = [];
  myths.forEach((item, index) => audits.push(asAuditItem("src/data/myths.he.json", item, index)));
  if (Array.isArray(draftTop)) {
    draftTop.forEach((item, index) =>
      audits.push(asAuditItem("src/harvest/draft-myths-top5000.json", item, index)),
    );
  }
  if (Array.isArray(draftAll)) {
    draftAll.forEach((item, index) =>
      audits.push(asAuditItem("src/harvest/draft-myths.json", item, index)),
    );
  }
  applyQuestionDedup(audits);

  const approvedQuestions = audits.filter((a) => a.questionStatus === "approved").length;
  const rejected = audits.filter((a) => a.questionStatus === "rejected");
  const rejectedQuestions = rejected.length;

  const questionQualitySummary: Record<string, number> = {
    approved: approvedQuestions,
    rejected: rejectedQuestions,
  };
  rejected.forEach((item) => {
    const key = item.questionRejectReason ?? "unknown_reason";
    questionQualitySummary[key] = (questionQualitySummary[key] ?? 0) + 1;
  });

  const truth = myths.filter((m) => m.answer === "truth").length;
  const myth = myths.filter((m) => m.answer === "myth").length;
  const unknown = myths.filter((m) => m.answer === "unknown").length;

  const samplePass = myths
    .filter((m) => !violations.some((v) => v.id === m.id && v.file === "src/data/myths.he.json"))
    .slice(0, 20)
    .map((m) => ({
      id: m.id,
      statement: m.statement,
      answer: m.answer,
      evidenceLevel: m.evidenceLevel,
      evidenceSeedIds: m.evidenceSeedIds,
    }));

  const byDataset = new Map<
    string,
    {
      total: number;
      approvedQuestions: number;
      rejectedQuestions: number;
      truth: number;
      myth: number;
      unknown: number;
      violations: number;
    }
  >();
  audits.forEach((a) => {
    const current = byDataset.get(a.sourceFile) ?? {
      total: 0,
      approvedQuestions: 0,
      rejectedQuestions: 0,
      truth: 0,
      myth: 0,
      unknown: 0,
      violations: 0,
    };
    current.total += 1;
    if (a.questionStatus === "approved") {
      current.approvedQuestions += 1;
    } else {
      current.rejectedQuestions += 1;
    }
    byDataset.set(a.sourceFile, current);
  });
  myths.forEach((m) => {
    const key = "src/data/myths.he.json";
    const current = byDataset.get(key) ?? {
      total: 0,
      approvedQuestions: 0,
      rejectedQuestions: 0,
      truth: 0,
      myth: 0,
      unknown: 0,
      violations: 0,
    };
    if (m.answer === "truth") {
      current.truth += 1;
    } else if (m.answer === "myth") {
      current.myth += 1;
    } else if (m.answer === "unknown") {
      current.unknown += 1;
    }
    byDataset.set(key, current);
  });
  violations.forEach((v) => {
    const current = byDataset.get(v.file) ?? {
      total: 0,
      approvedQuestions: 0,
      rejectedQuestions: 0,
      truth: 0,
      myth: 0,
      unknown: 0,
      violations: 0,
    };
    current.violations += 1;
    byDataset.set(v.file, current);
  });
  const datasets = [...byDataset.entries()].map(([file, stats]) => ({ file, ...stats }));

  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    counts: {
      total: myths.length,
      approvedQuestions,
      rejectedQuestions,
      truth,
      myth,
      unknown,
    },
    datasets,
    questionQualitySummary,
    violations,
    questionStatuses: audits,
    problematicExamples: rejected.slice(0, 50),
    samplePass,
  };

  writeFileSync(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(REPORT_MD_PATH, `${buildMarkdownReport(report)}\n`);

  if (violations.length > 0) {
    console.error("Myths validation failed:");
    violations.forEach((v) => {
      console.error(`- ${v.id} (${v.file}:${v.field}) ${v.reason}`);
    });
    process.exit(1);
  }

  console.log(
    `Myths validation passed (${myths.length} myths, ${seeds.length} seeds). Reports: report.json, report.md`,
  );
}

main();
