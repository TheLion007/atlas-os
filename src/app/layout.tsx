import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale } from "@/i18n/core";
import { I18nProvider } from "@/i18n/I18nProvider";
import { PREFS_KEY } from "@/lib/feedback/prefs";
import "./globals.css";

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atlas OS",
  description: "A Personal Project Intelligence OS.",
};

/**
 * Runs before first paint: puts the chosen theme (and "animations off") on <html> so a dark-mode
 * viewer never sees a flash of paper. It reads the same localStorage key the preferences store
 * writes, and quietly does nothing if storage is unavailable.
 */
const THEME_SCRIPT = `try{var p=(JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})||"{}").state)||{};var t=p.theme||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.dataset.pair=p.pair||"indigo";r.dataset.motion=p.motion===false?"off":"on"}catch(e){}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The interface language is a per-browser preference kept in a cookie, so the very first
  // paint is already in the right language.
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${sans.variable} ${display.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <I18nProvider initial={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
