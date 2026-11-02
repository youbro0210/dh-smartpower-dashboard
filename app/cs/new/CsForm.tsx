"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 요청 접수 입력입니다. 제목을 비우면 내용 첫 줄로 채웁니다.
 * 사진은 붙여넣기·끌어다 놓기·고르기로 넣고, 적다 만 글은 이 브라우저에 남겨 다른 화면에 갔다 와도 그대로 둡니다.
 */
const KINDS: [string, string][] = [
  ["DATA", "데이터 정정"],
  ["PROGRAM", "프로그램 수정"],
  ["QUESTION", "사용 문의"],
  ["OTHER", "기타"],
];
const DRAFT = "dh.cs-draft";
const TABS = "dh-open-tabs";
const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;

export default function CsForm({ screens, initialPage }: { screens: [string, string][]; initialPage: string | null }) {
  const router = useRouter();
  const [kind, setKind] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [page, setPage] = useState(initialPage ?? "");
  const [tabs, setTabs] = useState<{ href: string; label: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: number } | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const known = useMemo(() => new Set(screens.map(([h]) => h)), [screens]);

  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT) ?? "null") as { kind?: string; title?: string; body?: string; page?: string } | null;
      if (d) {
        setKind(d.kind ?? null);
        setTitle(d.title ?? "");
        setBody(d.body ?? "");
        if (!initialPage && d.page) setPage(d.page);
      }
    } catch {
      /* 없으면 빈 칸으로 둡니다. */
    }
    try {
      const t = JSON.parse(sessionStorage.getItem(TABS) ?? "[]") as { href: string; label: string }[];
      if (Array.isArray(t)) setTabs(t.filter((x) => known.has(x?.href)).slice(-6).reverse());
    } catch {
      /* 탭이 없으면 고르기만 씁니다. */
    }
    loaded.current = true;
  }, [initialPage, known]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      if (kind || title || body || page) localStorage.setItem(DRAFT, JSON.stringify({ kind, title, body, page }));
      else localStorage.removeItem(DRAFT);
    } catch {
      /* 못 남겨도 접수에는 지장이 없습니다. */
    }
  }, [kind, title, body, page]);

  const thumbs = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);

  function add(xs: File[]) {
    if (!xs.length) return;
    const notImage = xs.find((x) => !/^image\/(png|jpeg|gif|webp)$/.test(x.type));
    const tooBig = xs.find((x) => x.size > MAX_BYTES);
    if (notImage) return setMsg({ ok: false, text: `사진만 붙일 수 있습니다(${notImage.name}).` });
    if (tooBig) return setMsg({ ok: false, text: `사진은 한 장에 5MB 까지입니다(${tooBig.name}).` });
    setMsg(null);
    setFiles((o) => [...o, ...xs].slice(0, MAX_FILES));
  }

  function clear() {
    setKind(null);
    setTitle("");
    setBody("");
    setPage("");
    setFiles([]);
  }

  const autoTitle = body.split("\n")[0].trim().slice(0, 40);

  async function send() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    const f = new FormData();
    f.set("title", title);
    f.set("body", body);
    f.set("page", page);
    f.set("kind", kind ?? "");
    files.forEach((x) => f.append("files", x));
    const r = await fetch("/api/cs", { method: "POST", body: f })
      .then((x) => x.json())
      .catch(() => null);
    setBusy(false);
    setMsg({ ok: !!r?.ok, text: r?.message ?? "접수하지 못했습니다.", id: r?.id });
    if (r?.ok) {
      clear();
      try {
        localStorage.removeItem(DRAFT);
      } catch {
        /* 무시합니다. */
      }
      router.refresh();
    }
  }

  return (
    <form
      className={`cs-form${drag ? " drag" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      onPaste={(e) => add([...e.clipboardData.files])}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        add([...e.dataTransfer.files]);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void send();
        }
      }}
    >
      <table className="cs-kv">
        <tbody>
          <tr>
            <th>구분</th>
            <td>
              <div className="cs-quick" role="radiogroup" aria-label="구분" style={{ marginTop: 0 }}>
                {KINDS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    className={`btn${kind === k ? " primary" : ""}`}
                    onClick={() => setKind(kind === k ? null : k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </td>
          </tr>
          <tr>
            <th>화면</th>
            <td>
              <select className="field" value={page} aria-label="화면" onChange={(e) => setPage(e.target.value)}>
                <option value="">선택</option>
                {screens.map(([h, label]) => (
                  <option key={h} value={h}>
                    {label}
                  </option>
                ))}
              </select>
              {tabs.length ? (
                <div className="cs-quick">
                  {tabs.map((t) => (
                    <button key={t.href} type="button" className={`btn${page === t.href ? " primary" : ""}`} onClick={() => setPage(t.href)}>
                      {t.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </td>
          </tr>
          <tr>
            <th>
              <span className="cs-bad">*</span>내용
            </th>
            <td>
              <textarea className="field" rows={8} value={body} maxLength={5000} aria-label="내용" onChange={(e) => setBody(e.target.value)} />
              <span className="cs-count cs-muted">{body.length.toLocaleString("ko-KR")} / 5,000</span>
            </td>
          </tr>
          <tr>
            <th>제목</th>
            <td>
              <input className="field" value={title} maxLength={120} aria-label="제목" placeholder={autoTitle} onChange={(e) => setTitle(e.target.value)} />
            </td>
          </tr>
          <tr>
            <th>화면 사진</th>
            <td>
              <div className="cs-files">
                {files.map((x, i) => (
                  <span key={`${x.name}${i}`} className="cs-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbs[i]} alt={x.name} />
                    <button type="button" aria-label={`${x.name} 빼기`} onClick={() => setFiles((o) => o.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </span>
                ))}
                {files.length < MAX_FILES ? (
                  <button type="button" className="btn" onClick={() => pick.current?.click()}>
                    사진 붙이기 {files.length} / {MAX_FILES}
                  </button>
                ) : null}
                <input
                  ref={pick}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  multiple
                  hidden
                  onChange={(e) => {
                    add([...(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="cs-form-acts">
        <button type="submit" className="btn primary" disabled={busy || !body.trim()}>
          {busy ? "접수 중" : "접수"}
        </button>
        {kind || title || body || page || files.length ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              clear();
              setMsg(null);
            }}
          >
            비우기
          </button>
        ) : null}
        {msg ? (
          <span className={msg.ok ? "cs-ok" : "cs-bad"}>
            {msg.text}
            {msg.ok && msg.id ? (
              <>
                {" "}
                <Link href={`/cs?st=&id=${msg.id}`}>#{msg.id} 보기</Link>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
    </form>
  );
}
