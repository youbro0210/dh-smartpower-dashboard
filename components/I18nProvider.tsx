"use client";

import { useEffect } from "react";
import { Lang, storedLang, Translator } from "@/lib/i18n/translate";

const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT", "CODE", "PRE"]);

/**
 * 영어·일본어를 고르면 화면 글자를 사전으로 바꿉니다.
 * React 가 글자를 다시 그리면(값 변경·새 화면) 감시자가 받아 다시 바꿉니다.
 * 바꾸는 동안 화면을 가려 한국어가 잠깐 보였다가 바뀌는 깜빡임을 막습니다(layout 의 head 스크립트).
 */
export default function I18nProvider() {
  useEffect(() => {
    const lang: Lang = storedLang();
    document.documentElement.lang = lang;
    const reveal = () => document.documentElement.classList.remove("i18n-pending");
    if (lang === "ko") {
      reveal();
      return;
    }

    let observer: MutationObserver | null = null;
    let cancelled = false;

    (async () => {
      const { ENTRIES } = await import("@/lib/i18n/dict.generated");
      if (cancelled) return;
      const tr = new Translator(ENTRIES, lang);
      // 이미 바꾼 노드: 원문과 번역문. 바뀐 글자가 우리 번역문이면 다시 손대지 않습니다.
      const done = new WeakMap<Node, string>();
      const attrDone = new WeakMap<Element, Record<string, string>>();

      const skipped = (el: Element | null): boolean => {
        for (let e = el; e; e = e.parentElement) {
          if (SKIP.has(e.tagName) || e.hasAttribute("data-no-i18n") || (e as HTMLElement).isContentEditable) return true;
        }
        return false;
      };

      const doText = (node: Text) => {
        const v = node.nodeValue ?? "";
        if (done.get(node) === v) return;
        if (skipped(node.parentElement)) return;
        const out = tr.text(v);
        if (out !== v) node.nodeValue = out;
        done.set(node, out);
      };

      const doAttrs = (el: Element) => {
        const rec = attrDone.get(el) ?? {};
        let touched = false;
        for (const a of ATTRS) {
          const v = el.getAttribute(a);
          if (v === null || rec[a] === v) continue;
          const out = tr.text(v);
          if (out !== v) el.setAttribute(a, out);
          rec[a] = out;
          touched = true;
        }
        if (el instanceof HTMLInputElement && (el.type === "button" || el.type === "submit") && el.value) {
          const out = tr.text(el.value);
          if (out !== el.value) el.value = out;
        }
        if (touched) attrDone.set(el, rec);
      };

      const walk = (root: Node) => {
        if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
        if (root.nodeType !== Node.ELEMENT_NODE) return;
        const el = root as Element;
        if (skipped(el)) return;
        doAttrs(el);
        const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let n = it.nextNode();
        while (n) {
          if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
          else doAttrs(n as Element);
          n = it.nextNode();
        }
      };

      const doTitle = () => {
        const t = tr.text(document.title);
        if (t !== document.title) document.title = t;
      };

      walk(document.body);
      doTitle();
      reveal();

      observer = new MutationObserver((list) => {
        for (const m of list) {
          if (m.type === "characterData") doText(m.target as Text);
          else if (m.type === "attributes") doAttrs(m.target as Element);
          else m.addedNodes.forEach((n) => walk(n));
        }
        doTitle();
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS,
      });
    })().catch(reveal);

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, []);

  return null;
}
