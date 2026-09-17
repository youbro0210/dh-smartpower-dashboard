"use client";

import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

const SUGGESTIONS = [
  "지금 위험·경고 상태인 설비 알려줘",
  "4호기 상태 어때?",
  "수소가스 기준 초과한 설비 보여줘",
  "최근 24시간 알람 몇 건이야?",
  "온도 경고 임계치를 70도로 바꿔줘",
];

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [large, setLarge] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const history = [...messages, { role: "user" as const, content: question }];
    setMessages(history);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history
            .filter((m) => m.role !== "tool")
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: json.error ?? "답변을 가져오지 못했습니다." },
        ]);
        return;
      }

      const added: ChatMessage[] = [];
      if (Array.isArray(json.actions) && json.actions.length) {
        added.push({ role: "tool", content: `조회·처리: ${json.actions.join(", ")}` });
      }
      added.push({ role: "assistant", content: json.reply ?? "(응답 없음)" });
      setMessages((prev) => [...prev, ...added]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "서버에 연결할 수 없습니다." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)}>
        <span aria-hidden>💬</span> 챗봇
      </button>
    );
  }

  return (
    <div className={`chat-panel${large ? " large" : ""}`}>
      <div className="chat-head">
        <h2>챗봇</h2>
        <button onClick={() => setLarge((v) => !v)}>{large ? "작게" : "크게"}</button>
        <button onClick={() => setOpen(false)} aria-label="닫기">
          ×
        </button>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <>
            <div className="chat-hint">어떻게 물어보세요</div>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chat-suggest" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === "user" ? "user" : m.role === "tool" ? "tool" : "bot"}`}>
            <div className="chat-bubble">{m.content}</div>
          </div>
        ))}

        {busy && (
          <div className="chat-msg bot">
            <div className="chat-bubble">확인 중...</div>
          </div>
        )}
      </div>

      <form
        className="chat-foot"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="예: 지금 위험 상태인 설비 알려줘"
          disabled={busy}
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
          보내기
        </button>
      </form>
    </div>
  );
}
