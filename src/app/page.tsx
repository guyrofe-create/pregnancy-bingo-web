import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "בינגו הריון + מיתוס או אמת",
  description: "משחקי בינגו הריון ומיתוס או אמת בעברית מבית ד״ר גיא רופא.",
};

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[720px] flex-col px-4 py-10 sm:px-6 sm:py-12">
      <section className="rounded-3xl border border-slate-300/90 bg-white p-6 text-center shadow-md sm:p-8">
        <p className="text-sm font-medium text-slate-600">משחקים קצרים</p>
        <h1 className="mt-2 break-words text-3xl font-extrabold leading-[1.15] text-slate-900 sm:text-5xl">
          בינגו הריון +
          <br />
          מיתוס או אמת
        </h1>
        <p className="mt-4 text-lg leading-[1.45] text-slate-700">משחק קצר, קליל וחווייתי.</p>

        <div className="mt-8 grid gap-3 sm:mt-10">
          <Link
            href="/bingo"
            className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-sky-600 px-5 py-3 text-center text-xl font-semibold text-white shadow-sm transition duration-200 hover:bg-sky-700 active:translate-y-px"
          >
            בינגו הריון
          </Link>
          <Link
            href="/myth"
            className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-emerald-600 px-5 py-3 text-center text-xl font-semibold text-white shadow-sm transition duration-200 hover:bg-emerald-700 active:translate-y-px"
          >
            מיתוס או אמת
          </Link>
        </div>
      </section>

      <footer className="mt-8 pb-2 text-center text-sm font-medium text-slate-500">ד״ר גיא רופא</footer>
    </main>
  );
}
