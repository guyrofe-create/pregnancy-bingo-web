import type { Metadata } from "next";
import Link from "next/link";
import BingoBoard from "@/components/BingoBoard";
import bingoData from "@/data/bingo.he.json";
import { pickRandomUnique } from "@/lib/random";

const BOARD_SIZE = 16;

type BingoItem = {
  id: string;
  topic: "pregnancy" | "period" | "fertility" | "contraception" | "postpartum" | "breastfeeding";
  text: string;
};

const allPregnancyItems = (bingoData as BingoItem[])
  .filter((item) => item.topic === "pregnancy")
  .map((item) => item.text);

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "בינגו הריון",
  description: "לוח בינגו הריון בעברית מבית ד״ר גיא רופא.",
};

export default function BingoPage() {
  const initialBoardItems = pickRandomUnique(allPregnancyItems, BOARD_SIZE);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[720px] px-4 py-10 sm:px-6 sm:py-12">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="break-words text-3xl font-extrabold leading-[1.15] text-slate-900 sm:text-5xl">בינגו הריון</h1>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-base font-medium text-slate-700 shadow-sm transition duration-200 hover:bg-slate-100 active:translate-y-px"
        >
          בית
        </Link>
      </div>

      <BingoBoard initialBoardItems={initialBoardItems} />
    </main>
  );
}
