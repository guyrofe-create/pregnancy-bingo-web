"use client";

import { useMemo, useState } from "react";
import mythsData from "@/data/myths.he.json";
import evidenceSeedsData from "@/sources/evidence-seeds.json";
import { pickRandomOne } from "@/lib/random";
import type { EvidenceSeed, MythAnswer, MythItem, MythTopic } from "@/types/myth";

type MythFilterTopic = MythTopic | "mixed";

type MythQuestionCardProps = {
  compact?: boolean;
  className?: string;
  initialMyth?: MythItem;
};

const myths = mythsData as MythItem[];
const evidenceSeeds = evidenceSeedsData as EvidenceSeed[];
const evidenceById = new Map(evidenceSeeds.map((seed) => [seed.id, seed]));

const topicOptions: Array<{ key: MythFilterTopic; label: string }> = [
  { key: "pregnancy", label: "הריון" },
  { key: "period", label: "וסת" },
  { key: "fertility", label: "פוריות" },
  { key: "contraception", label: "אמצעי מניעה" },
  { key: "postpartum", label: "אחרי לידה" },
  { key: "breastfeeding", label: "הנקה" },
  { key: "mixed", label: "מעורב" },
];

if (myths.length === 0) {
  throw new Error("myths.he.json must include at least one item");
}

function getPoolByTopic(topic: MythFilterTopic): MythItem[] {
  if (topic === "mixed") {
    return myths;
  }
  return myths.filter((myth) => myth.topic === topic);
}

function getRandomMyth(topic: MythFilterTopic, excludeId?: string): MythItem | null {
  const byTopic = getPoolByTopic(topic);
  const pool = excludeId ? byTopic.filter((myth) => myth.id !== excludeId) : byTopic;
  const effectivePool = pool.length > 0 ? pool : byTopic;
  if (effectivePool.length === 0) {
    return null;
  }
  return pickRandomOne(effectivePool);
}

function getLabel(answer: MythAnswer): string {
  if (answer === "truth") {
    return "אמת";
  }
  if (answer === "myth") {
    return "מיתוס";
  }
  return "לא חד-משמעי";
}

function getEvidenceLink(evidence: EvidenceSeed): string {
  return evidence.sourceType === "pubmed" ? evidence.pubmedUrl : evidence.url;
}

function getEvidenceButtonText(evidence: EvidenceSeed): string {
  return evidence.sourceType === "pubmed" ? "פתח ב-PubMed" : "פתח מקור";
}

export default function MythQuestionCard({
  compact = false,
  className = "",
  initialMyth,
}: MythQuestionCardProps) {
  const initialTopic: MythFilterTopic = initialMyth?.topic ?? "mixed";
  const initialCurrentMyth = initialMyth ?? getRandomMyth(initialTopic);

  const [selectedTopic, setSelectedTopic] = useState<MythFilterTopic>(initialTopic);
  const [currentMyth, setCurrentMyth] = useState<MythItem | null>(initialCurrentMyth);
  const [selectedAnswer, setSelectedAnswer] = useState<MythAnswer | null>(null);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);

  const isAnswered = selectedAnswer !== null;
  const isCorrect =
    selectedAnswer !== null && currentMyth !== null && selectedAnswer === currentMyth.answer;

  const resolvedEvidence = useMemo(() => {
    if (!currentMyth) {
      return [] as EvidenceSeed[];
    }

    return currentMyth.evidenceSeedIds
      .map((seedId) => evidenceById.get(seedId))
      .filter((seed): seed is EvidenceSeed => Boolean(seed));
  }, [currentMyth]);

  const onSelectTopic = (topic: MythFilterTopic) => {
    setSelectedTopic(topic);
    setCurrentMyth(getRandomMyth(topic));
    setSelectedAnswer(null);
    setIsSourcesOpen(false);
  };

  const onSelect = (answer: MythAnswer) => {
    if (isAnswered || !currentMyth) {
      return;
    }
    setSelectedAnswer(answer);
  };

  const onNextQuestion = () => {
    if (!currentMyth) {
      setCurrentMyth(getRandomMyth(selectedTopic));
      return;
    }

    setCurrentMyth(getRandomMyth(selectedTopic, currentMyth.id));
    setSelectedAnswer(null);
    setIsSourcesOpen(false);
  };

  return (
    <div className={`rounded-3xl border border-slate-300 bg-white p-5 text-slate-800 shadow-md sm:p-7 ${className}`}>
      <p className="text-base font-bold text-slate-800">נושא שאלות</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {topicOptions.map((topic) => {
          const isActive = selectedTopic === topic.key;
          return (
            <button
              key={topic.key}
              type="button"
              onClick={() => onSelectTopic(topic.key)}
              className={`inline-flex min-h-12 items-center justify-center rounded-2xl border px-3 py-2.5 text-base font-semibold transition duration-200 active:translate-y-px ${
                isActive
                  ? "border-sky-500 bg-sky-50 text-sky-800 shadow-sm"
                  : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
              }`}
            >
              {topic.label}
            </button>
          );
        })}
      </div>

      {!currentMyth && (
        <div className="mt-4 rounded-2xl border border-slate-300 bg-slate-50 p-4 text-base font-medium leading-7 text-slate-800">
          אין כרגע שאלות זמינות לנושא הזה.
        </div>
      )}

      {currentMyth && (
        <>
          <p className={`${compact ? "text-xl" : "text-2xl sm:text-3xl"} mt-6 break-words font-bold leading-[1.25] tracking-tight text-slate-900`}>
            {currentMyth.statement}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onSelect("myth")}
              disabled={isAnswered}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-300 bg-white px-3 py-3 text-lg font-bold text-slate-900 shadow-sm transition duration-200 hover:bg-slate-100 active:translate-y-px disabled:opacity-75"
            >
              מיתוס
            </button>
            <button
              type="button"
              onClick={() => onSelect("truth")}
              disabled={isAnswered}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-300 bg-white px-3 py-3 text-lg font-bold text-slate-900 shadow-sm transition duration-200 hover:bg-slate-100 active:translate-y-px disabled:opacity-75"
            >
              אמת
            </button>
          </div>

          {isAnswered && (
            <div className="mt-5 rounded-2xl border border-slate-300 bg-slate-50 p-4">
              <p className={`text-lg font-bold ${isCorrect ? "text-emerald-700" : "text-rose-700"}`}>
                {isCorrect ? "נכון!" : "לא נכון"} התשובה היא {getLabel(currentMyth.answer)}.
              </p>
              <p className="mt-2 whitespace-pre-line text-[17px] font-medium leading-[1.5] text-slate-800">
                {currentMyth.explanation}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIsSourcesOpen(true)}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-base font-semibold text-slate-800 shadow-sm transition duration-200 hover:bg-slate-100 active:translate-y-px"
                >
                  מקורות
                </button>
                <button
                  type="button"
                  onClick={onNextQuestion}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-sky-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition duration-200 hover:bg-sky-700 active:translate-y-px"
                >
                  שאלה נוספת
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {isSourcesOpen && currentMyth && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-900/35 p-2">
          <section className="max-h-[85vh] w-full overflow-hidden rounded-t-3xl border border-slate-300 bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-xl font-bold text-slate-900">מקורות</h3>
              <button
                type="button"
                onClick={() => setIsSourcesOpen(false)}
                className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition duration-200 hover:bg-slate-100 active:translate-y-px"
              >
                סגירה
              </button>
            </header>

            <div className="max-h-[72vh] space-y-3 overflow-y-auto p-4">
              {resolvedEvidence.map((entry) => (
                <article
                  key={`${currentMyth.id}-${entry.id}`}
                  className="rounded-2xl border border-slate-300 bg-slate-50 p-4"
                >
                  <h4 className="text-base font-semibold leading-7 text-slate-900">{entry.title}</h4>
                  <p className="mt-1 text-sm font-medium text-slate-700">{entry.year}</p>
                  {entry.journal && <p className="mt-1 text-sm font-medium text-slate-700">{entry.journal}</p>}
                  <blockquote className="mt-2 rounded-xl border-r-4 border-sky-300 bg-white p-3 text-sm leading-7 text-slate-700">
                    {entry.abstractQuote ?? "אין ציטוט תקציר זמין."}
                  </blockquote>
                  {entry.notes && <p className="mt-2 text-sm font-medium leading-6 text-slate-700">{entry.notes}</p>}

                  <a
                    href={getEvidenceLink(entry)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-sky-700 active:translate-y-px"
                  >
                    {getEvidenceButtonText(entry)}
                  </a>
                </article>
              ))}
              {resolvedEvidence.length === 0 && (
                <p className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm font-medium text-slate-700">
                  אין מקורות זמינים לשאלה זו.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
