import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "בינגו הריון + מיתוס או אמת | ד״ר גיא רופא",
    template: "%s | ד״ר גיא רופא",
  },
  description: "בינגו הריון ומשחק מיתוס או אמת בעברית מבית ד״ר גיא רופא.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen bg-[#eef2f7] text-right text-[17px] leading-[1.5] text-slate-800 antialiased">
        {children}
      </body>
    </html>
  );
}
