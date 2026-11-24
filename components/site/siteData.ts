"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DeviceEvaluated, SiteEvent } from "@/lib/types";

export interface SiteRow {
  id: number;
  name: string;
  region: string;
  company_id: number | null;
  company_name: string | null;
  devices: number;
}

/** 화면에서 쓰는 사업장 묶음. 사업장에 배정되지 않은 설비는 'none' 묶음에 모읍니다. */
export interface SiteGroup {
  key: string;
  id: number | null;
  name: string;
  region: string;
  companyName: string | null;
  devices: DeviceEvaluated[];
}

export const UNASSIGNED_NAME = "사업장 미지정 설비";

export function useSites() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sites", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setSites(json.sites ?? []);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { sites, loaded, reload: load };
}

export function groupSites(sites: SiteRow[], all: DeviceEvaluated[]): SiteGroup[] {
  // 관제 화면은 실제로 연결돼 값을 보낸 장비만 보여 줍니다. 등록만 되고 수신 기록이 없는 설비는 뺍니다.
  const devices = all.filter((d) => d.has_data !== false);
  const groups: SiteGroup[] = sites
    .filter((s) => devices.some((d) => d.site_id === s.id) || !all.some((d) => d.site_id === s.id))
    .map((s) => ({
    key: String(s.id),
    id: s.id,
    name: s.name,
    region: s.region,
    companyName: s.company_name,
    devices: devices.filter((d) => d.site_id === s.id),
  }));
  const known = new Set(sites.map((s) => s.id));
  const rest = devices.filter((d) => !d.site_id || !known.has(d.site_id));
  if (rest.length) {
    groups.push({ key: "none", id: null, name: UNASSIGNED_NAME, region: "", companyName: null, devices: rest });
  }
  return groups;
}

/** 이벤트 목록. 새 이벤트가 기록되면(seq 증가) 다시 읽습니다. */
export function useEvents(site: string | null, seq: number) {
  const [events, setEvents] = useState<SiteEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (site === null) return;
    const res = await fetch(`/api/events?site=${encodeURIComponent(site)}&filter=all`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setEvents(json.events ?? []);
      setError(null);
    } else setError(json.error ?? "이벤트를 불러오지 못했습니다.");
  }, [site]);
  useEffect(() => {
    void load();
  }, [load, seq]);
  return { events, error, reload: load };
}

export const isPending = (e: SiteEvent) => e.status === "open" || e.status === "acked";

/** 오늘 것은 HH:mm:ss, 지난 것은 MM-DD HH:mm */
export function fmtWhen(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useGrouped(sites: SiteRow[], devices: DeviceEvaluated[]) {
  return useMemo(() => groupSites(sites, devices), [sites, devices]);
}
