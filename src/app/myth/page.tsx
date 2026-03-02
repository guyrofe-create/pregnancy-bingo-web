import type { Metadata } from "next";
import Link from "next/link";
import MythQuestionCard from "@/components/MythQuestionCard";
import mythsData from "@/data/myths.he.json";
import { pickRandomOne } from "@/lib/random";
import type { MythItem } from "@/types/myth";

const myths = mythsData as MythItem[];

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "מיתוס או אמת",
  description: "שאלות מיתוס או אמת בהריון בעברית מבית ד״ר גיא רופא.",
};

export default function MythPage() {
  const initialMyth = pickRandomOne(myths);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[720px] px-4 py-10 sm:px-6 sm:py-12">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="break-words text-3xl font-extrabold leading-[1.15] text-slate-900 sm:text-5xl">מיתוס או אמת</h1>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-base font-medium text-slate-700 shadow-sm transition duration-200 hover:bg-slate-100 active:translate-y-px"
        >
          בית
        </Link>
      </div>

      <MythQuestionCard initialMyth={initialMyth} />
    </main>
  );
}
