"use client";

import { useEffect, useState } from "react";
import { Lang, LANGS, saveLang, storedLang } from "@/lib/i18n/translate";

/** 언어 선택. 고르면 저장하고 화면을 새로 읽어 그 언어로 그립니다. 언어 이름은 번역하지 않습니다. */
export default function LangSwitch({ compact }: { compact?: boolean }) {
  const [lang, setLang] = useState<Lang>("ko");
  useEffect(() => setLang(storedLang()), []);

  function choose(next: Lang) {
    if (next === lang) return;
    saveLang(next);
    window.location.reload();
  }

  if (compact) {
    return (
      <select
        className="field lang-select"
        data-no-i18n
        aria-label="Language"
        value={lang}
        onChange={(e) => choose(e.target.value as Lang)}
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="lang-switch" role="group" aria-label="Language" data-no-i18n>
      {LANGS.map((l) => (
        <button key={l.code} type="button" aria-pressed={lang === l.code} onClick={() => choose(l.code)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
