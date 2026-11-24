/**
 * 화면 번역기.
 *
 * 화면 코드는 한국어로 쓰고, 영어·일본어로 볼 때는 화면에 그려진 글자를 사전으로 바꿉니다.
 *   1) 사전에 그대로 있는 문장 → 바로 바꿈
 *   2) 숫자·이름이 끼어 있는 문장 → 틀({0}, {1} …)로 맞춰 바꾸고, 끼어 있는 값도 사전에 있으면 바꿈
 *   3) " · " 로 이어 붙인 문장 → 조각마다 바꿈
 * 사전에 없는 글(설비명·사업장명처럼 사용자가 입력한 자료)은 그대로 둡니다.
 *
 * 사전은 scripts/i18n 으로 화면 코드에서 뽑아 만든 dict.generated.ts 입니다.
 */

export type Lang = "ko" | "en" | "ja";
export const LANGS: { code: Lang; label: string }[] = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
];
export const LANG_KEY = "dh.lang";

type Entry = [string, string, string];

interface Template {
  re: RegExp;
  en: string;
  ja: string;
  weight: number;
}

const HANGUL = /[가-힣]/;

export class Translator {
  private exact = new Map<string, [string, string]>();
  private templates: Template[] = [];
  private cache = new Map<string, string>();

  constructor(entries: Entry[], private lang: Exclude<Lang, "ko">) {
    for (const [ko, en, ja] of entries) {
      const key = norm(ko);
      if (/\{\d+\}/.test(key)) {
        const parts = key.split(/\{(\d+)\}/);
        let src = "^";
        let weight = 0;
        const order: number[] = [];
        parts.forEach((p, i) => {
          if (i % 2) {
            src += "(.*?)";
            order.push(Number(p));
          } else {
            src += esc(p);
            weight += p.length;
          }
        });
        src += "$";
        // 자리 번호가 원문 순서와 다를 수 있어 번역문 쪽에서 원래 번호로 찾습니다.
        this.templates.push({ re: new RegExp(src, "s"), en: remap(en, order), ja: remap(ja, order), weight });
      } else {
        this.exact.set(key, [en, ja]);
      }
    }
    // 고정 글자가 많은 틀부터 맞춥니다. 짧은 틀이 긴 문장을 먼저 잡아먹지 않게 합니다.
    this.templates.sort((a, b) => b.weight - a.weight);
  }

  /** 글 한 덩어리. 앞뒤 공백은 그대로 둡니다. */
  text(value: string): string {
    if (!value || !HANGUL.test(value)) return value;
    const hit = this.cache.get(value);
    if (hit !== undefined) return hit;
    const lead = value.match(/^\s*/)?.[0] ?? "";
    const trail = value.match(/\s*$/)?.[0] ?? "";
    const core = value.slice(lead.length, value.length - trail.length);
    const out = lead + this.core(core, 0) + trail;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(value, out);
    return out;
  }

  private pick(pair: [string, string]): string {
    return this.lang === "en" ? pair[0] : pair[1];
  }

  private core(raw: string, depth: number): string {
    const key = norm(raw);
    if (!HANGUL.test(key)) return raw;
    const exact = this.exact.get(key);
    if (exact) return this.pick(exact);
    if (depth > 4) return raw;

    for (const t of this.templates) {
      const m = key.match(t.re);
      if (!m) continue;
      // "{0}건"·"{0}시" 처럼 고정 글자가 짧은 틀은 숫자가 끼어 있을 때만 씁니다("다시" 같은 낱말을 잘못 잡지 않게).
      if (t.weight <= 3 && m.slice(1).some((c) => !/^[\d.,:\s~+-]+$/.test(c))) continue;
      // 끼어 있는 값에 한글이 있는데 그 값을 못 바꾸면 이 틀은 맞는 틀이 아닙니다(사용자 자료는 예외 없이 그대로 둠).
      const caps = m.slice(1).map((c) => this.core(c ?? "", depth + 1));
      if (m.slice(1).some((c, i) => HANGUL.test(c ?? "") && caps[i] === c && (c ?? "").includes(" · "))) continue;
      const tpl = this.lang === "en" ? t.en : t.ja;
      return tpl.replace(/\{(\d+)\}/g, (_, n: string) => caps[Number(n)] ?? "");
    }

    // 앞에 붙은 구분 기호(· — ›)
    const lead = key.match(/^([·—›]\s*)(.+)$/s);
    if (lead) return lead[1] + this.core(lead[2], depth + 1);
    // " · " 로 이어 붙인 문장
    if (key.includes(" · ")) {
      return key
        .split(" · ")
        .map((p) => this.core(p, depth + 1))
        .join(" · ");
    }
    // 괄호 안팎
    const paren = key.match(/^(.*?)\s*\((.+)\)$/s);
    if (paren && paren[1]) {
      return `${this.core(paren[1], depth + 1)} (${this.core(paren[2], depth + 1)})`;
    }
    return raw;
  }
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 틀의 {n} 을 정규식 캡처 순서 번호로 바꿉니다. */
function remap(tpl: string, order: number[]): string {
  return tpl.replace(/\{(\d+)\}/g, (_, n: string) => {
    const idx = order.indexOf(Number(n));
    return `{${idx < 0 ? n : idx}}`;
  });
}

/** 저장된 언어. 서버 렌더 중에는 한국어 */
export function storedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en" || v === "ja" || v === "ko") return v;
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return "ko";
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* 무시 */
  }
  document.cookie = `${LANG_KEY}=${lang}; path=/; max-age=31536000; samesite=lax`;
}
