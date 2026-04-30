"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import en from "../../messages/en.json";

type Messages = Record<string, unknown>;

const messageCache: Record<string, Messages> = { en };

const loaders: Record<string, () => Promise<Messages>> = {
  ar: () => import("../../messages/ar.json").then((m) => m.default),
  de: () => import("../../messages/de.json").then((m) => m.default),
  es: () => import("../../messages/es.json").then((m) => m.default),
  fr: () => import("../../messages/fr.json").then((m) => m.default),
  hi: () => import("../../messages/hi.json").then((m) => m.default),
  ja: () => import("../../messages/ja.json").then((m) => m.default),
  ko: () => import("../../messages/ko.json").then((m) => m.default),
  pt: () => import("../../messages/pt.json").then((m) => m.default),
  ru: () => import("../../messages/ru.json").then((m) => m.default),
  zh: () => import("../../messages/zh.json").then((m) => m.default),
};

export const locales = [
  "en",
  "zh",
  "es",
  "hi",
  "ar",
  "pt",
  "fr",
  "de",
  "ja",
  "ko",
  "ru",
] as const;

export type LocaleType = (typeof locales)[number];

export const languageNames: Record<LocaleType, string> = {
  en: "English",
  zh: "中文",
  es: "Español",
  hi: "हिन्दी",
  ar: "العربية",
  pt: "Português",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  ko: "한국어",
  ru: "Русский",
};

interface TranslationContextValue {
  t: (key: string, variables?: Record<string, string | number>) => string;
  setLocale: (locale: LocaleType) => void;
  locale: LocaleType;
}

const TranslationContext = createContext<TranslationContextValue>({
  t: (key) => key,
  setLocale: () => {},
  locale: "en",
});

function resolveMessage(messages: unknown, key: string): string | undefined {
  let value: unknown = messages;
  for (const part of key.split(".")) {
    value = typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[part]
      : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleType>("en");
  const [messages, setMessages] = useState<Messages>(en);

  useEffect(() => {
    const savedLocale = document.cookie
      .split("; ")
      .find((row) => row.startsWith("locale="))
      ?.split("=")[1] as LocaleType | undefined;

    if (savedLocale && locales.includes(savedLocale)) {
      setLocaleState(savedLocale);
    }
  }, []);

  useEffect(() => {
    if (messageCache[locale]) {
      setMessages(messageCache[locale]);
      return;
    }

    loaders[locale]?.().then((loaded) => {
      messageCache[locale] = loaded;
      setMessages(loaded);
    });
  }, [locale]);

  const t = useCallback(
    (key: string, variables?: Record<string, string | number>) => {
      let value = resolveMessage(messages, key) ?? resolveMessage(en, key) ?? key;

      if (variables) {
        for (const [varKey, varValue] of Object.entries(variables)) {
          value = value.replace(new RegExp(`\\{${varKey}\\}`, "g"), String(varValue));
        }
      }

      return value;
    },
    [messages],
  );

  const setLocale = useCallback((newLocale: LocaleType) => {
    setLocaleState(newLocale);
    document.cookie = `locale=${newLocale}; path=/; max-age=31536000`;
    document.documentElement.lang = newLocale;
    document.documentElement.dir = newLocale === "ar" ? "rtl" : "ltr";
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  return React.createElement(
    TranslationContext.Provider,
    { value: { t, setLocale, locale } },
    children,
  );
}

export function useTranslations() {
  return useContext(TranslationContext);
}
