"use client";

import {
  languageNames,
  locales,
  useTranslations,
  type LocaleType,
} from "../../lib/hooks/use-translations";

export default function LanguageSelector() {
  const { t, locale, setLocale } = useTranslations();

  return (
    <label
      data-buddy-interactive
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/85 pl-2.5 pr-2 text-zinc-600 shadow-md ring-1 ring-zinc-200 backdrop-blur-md hover:bg-white hover:text-zinc-900 dark:bg-zinc-900/85 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      aria-label={t("language.label")}
      title={t("language.label")}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 0 20" />
        <path d="M12 2a15.3 15.3 0 0 0 0 20" />
      </svg>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as LocaleType)}
        aria-label={t("language.label")}
        className="max-w-20 bg-transparent text-xs font-semibold text-zinc-900 outline-none dark:text-zinc-50"
      >
        {locales.map((item) => (
          <option key={item} value={item}>
            {languageNames[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
