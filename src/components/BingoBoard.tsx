"use client";

import { useMemo, useState } from "react";
import bingoData from "@/data/bingo.he.json";
import { pickRandomUnique } from "@/lib/random";

const BOARD_SIZE = 25;
const GRID_SIZE = 5;

type BingoItem = {
  id: string;
  topic: "pregnancy" | "period" | "fertility" | "contraception" | "postpartum" | "breastfeeding";
  text: string;
};

type BingoBoardProps = {
  initialBoardItems: string[];
};

const allPregnancyItems = (bingoData as BingoItem[])
  .filter((item) => item.topic === "pregnancy")
  .map((item) => item.text);

function hasCompletedLine(selected: boolean[]): boolean {
  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowStart = row * GRID_SIZE;
    if (selected.slice(rowStart, rowStart + GRID_SIZE).every(Boolean)) {
      return true;
    }
  }

  for (let col = 0; col < GRID_SIZE; col += 1) {
    let fullColumn = true;
    for (let row = 0; row < GRID_SIZE; row += 1) {
      if (!selected[row * GRID_SIZE + col]) {
        fullColumn = false;
        break;
      }
    }
    if (fullColumn) {
      return true;
    }
  }

  let fullDiagonalA = true;
  let fullDiagonalB = true;

  for (let i = 0; i < GRID_SIZE; i += 1) {
    if (!selected[i * GRID_SIZE + i]) {
      fullDiagonalA = false;
    }
    if (!selected[i * GRID_SIZE + (GRID_SIZE - 1 - i)]) {
      fullDiagonalB = false;
    }
  }

  return fullDiagonalA || fullDiagonalB;
}

export default function BingoBoard({ initialBoardItems }: BingoBoardProps) {
  const safeInitialBoard =
    initialBoardItems.length === BOARD_SIZE
      ? initialBoardItems
      : pickRandomUnique(allPregnancyItems, BOARD_SIZE);

  const [boardItems, setBoardItems] = useState<string[]>(safeInitialBoard);
  const [selected, setSelected] = useState<boolean[]>(() => Array(BOARD_SIZE).fill(false));
  const [hasLine, setHasLine] = useState(false);
  const [showBingoModal, setShowBingoModal] = useState(false);
  const [shareFeedback, setShareFeedback] = useState("");

  const selectedCount = useMemo(() => selected.filter(Boolean).length, [selected]);

  const createNewBoard = () => {
    setBoardItems(pickRandomUnique(allPregnancyItems, BOARD_SIZE));
    setSelected(Array(BOARD_SIZE).fill(false));
    setHasLine(false);
    setShowBingoModal(false);
    setShareFeedback("");
  };

  const toggleCell = (index: number) => {
    setSelected((prev) => {
      const next = [...prev];
      next[index] = !next[index];

      const lineCompleted = hasCompletedLine(next);
      setHasLine((wasCompleted) => {
        const nowCompleted = wasCompleted || lineCompleted;
        if (!wasCompleted && lineCompleted) {
          setShowBingoModal(true);
        }
        return nowCompleted;
      });

      return next;
    });
  };

  const onShare = async () => {
    const url = window.location.href;
    const shareText = `בינגו הריון - מתוך המשחק של ד״ר גיא רופא\n${url}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "בינגו!",
          text: shareText,
          url,
        });
        setShareFeedback("שותף בהצלחה");
        return;
      }
    } catch {
      // Ignore and continue to clipboard fallback.
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        setShareFeedback("הטקסט הועתק ללוח");
      } else {
        setShareFeedback("לא ניתן לשתף במכשיר הזה");
      }
    } catch {
      setShareFeedback("לא ניתן לשתף במכשיר הזה");
    }
  };

  return (
    <>
      <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-md sm:p-7">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-base font-semibold tracking-tight text-slate-700">מסומן: {selectedCount}/25</p>
          <button
            type="button"
            onClick={createNewBoard}
            className="inline-flex min-h-11 items-center rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-base font-semibold text-slate-700 shadow-sm transition duration-200 hover:bg-slate-100 active:translate-y-px"
          >
            חדש
          </button>
        </div>

        <div className="grid grid-cols-5 gap-2 sm:gap-3">
          {boardItems.map((item, index) => {
            const isSelected = selected[index];
            return (
              <button
                key={`${item}-${index}`}
                type="button"
                onClick={() => toggleCell(index)}
                className={`flex aspect-square min-h-[74px] items-center justify-center rounded-2xl border p-3 text-center text-sm font-medium leading-[1.45] shadow-sm transition duration-200 sm:min-h-[88px] sm:text-[15px] ${
                  isSelected
                    ? "border-emerald-500 bg-emerald-400/90 font-semibold text-white"
                    : "border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100"
                }`}
              >
                {item}
              </button>
            );
          })}
        </div>

        {hasLine && !showBingoModal && (
          <p className="mt-4 text-base font-semibold text-emerald-700">יש לך בינגו!</p>
        )}
      </section>

      {showBingoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-3xl border border-slate-300 bg-white p-7 text-center shadow-xl">
            <h2 className="text-4xl font-extrabold tracking-tight text-slate-900">בינגו!</h2>
            <p className="mt-2 text-base leading-7 text-slate-700">סימנת שורה מלאה.</p>

            <div className="mt-6 grid gap-2">
              <button
                type="button"
                onClick={onShare}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-sky-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition duration-200 hover:bg-sky-700 active:translate-y-px"
              >
                שיתוף
              </button>
              <button
                type="button"
                onClick={() => setShowBingoModal(false)}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-700 transition duration-200 hover:bg-slate-100 active:translate-y-px"
              >
                סגירה
              </button>
            </div>

            {shareFeedback && <p className="mt-4 text-xs leading-5 text-slate-500">{shareFeedback}</p>}
          </div>
        </div>
      )}
    </>
  );
}
