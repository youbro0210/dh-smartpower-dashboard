/**
 * 화면 공통 날짜·시각 표기.
 * 브라우저 지역 설정(ko-KR)에 맡기면 "2026. 10. 29. 오전 9:46:58" 처럼 화면마다 길이가
 * 달라지고 표의 칸이 들쭉날쭉해집니다. 모든 표는 YYYY-MM-DD HH:mm(:ss) 로 통일합니다.
 */

const pad = (n: number) => String(n).padStart(2, "0");

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD */
export function fmtDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "-";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD HH:mm, seconds 를 주면 HH:mm:ss */
export function fmtDateTime(
  value: string | number | Date | null | undefined,
  seconds = false
): string {
  const d = toDate(value);
  if (!d) return "-";
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ""}`;
  return `${fmtDate(d)} ${time}`;
}

/** 표에서 자리를 아낄 때 쓰는 MM-DD HH:mm */
export function fmtShort(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "-";
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 표 내용을 CSV 로 내려받습니다. 엑셀에서 한글이 깨지지 않도록 BOM 을 붙입니다.
 */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
