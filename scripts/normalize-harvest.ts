import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type HarvestItem = {
  id: string;
  topic: string;
  candidateMyth: string;
  foundInUrl: string;
  notes?: string;
  needsEvidence?: boolean;
  [key: string]: unknown;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const HARVEST_PATH = path.join(ROOT_DIR, "src", "harvest", "harvest-output.json");

function main(): void {
  const raw = readFileSync(HARVEST_PATH, "utf8");
  const items = JSON.parse(raw) as HarvestItem[];

  if (!Array.isArray(items)) {
    throw new Error("harvest-output.json must be an array");
  }

  let updatedCount = 0;

  const normalized = items.map((item) => {
    let changed = false;
    const next: HarvestItem = { ...item };

    if (typeof next.needsEvidence === "undefined") {
      next.needsEvidence = true;
      changed = true;
    }

    if (typeof next.notes === "undefined") {
      next.notes = "";
      changed = true;
    }

    if (changed) {
      updatedCount += 1;
    }

    return next;
  });

  writeFileSync(HARVEST_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  console.log(`Updated ${updatedCount} items.`);
}

main();
