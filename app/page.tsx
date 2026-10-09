"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/lib/configStore";
import PageHeader from "@/components/PageHeader";
import AttentionPanel from "@/components/AttentionPanel";
import { DeviceStatus, STATUS_LABEL } from "@/lib/types";

/**
 * 홈 화면.
 *
 * 이 화면은 "지금 손봐야 할 설비가 있는가"에 답하는 자리입니다.
 * 전체 설비를 줄줄이 늘어놓는 표는 두지 않습니다 — 그건 [설비 현황] 화면의 일이고,
 * 여기서 되풀이하면 정작 이상이 난 설비가 묻힙니다.
 *
 *   ① 지금 상태   한 줄 요약 + 비율 막대
 *   ② 확인할 설비 이상이 난 설비만, 측정값·추세·알람까지 펼쳐서
 *   ③ 나머지     정상 설비는 이름만 한 줄로
 *   ④ 최근 알람   시간 순 목록
 */

const ORDER: DeviceStatus[] = ["danger", "warning", "caution", "offline", "normal"];

export default function DashboardPage() {
  const { devices, bridges, thresholds, alarms, alarms24h, connected, loading, error, refresh } =
    useDashboard();

  const [now, setNow] = useState("");

  useEffect(() => {
    const update = () => setNow(new Date().toLocaleString("ko-KR", { hour12: false }));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  const count = (s: DeviceStatus) => devices.filter((d) => d.status === s).length;

  const online = devices.filter((d) => d.status !== "offline");
  const temps = online.map((d) => d.temperature);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
  const maxTemp = temps.length ? Math.max(...temps) : 0;
  const bridgesOnline = bridges.filter((b) => b.online).length;

  const normalDevices = devices.filter((d) => d.status === "normal");
  const attention = devices.filter((d) => d.status !== "normal");

  // 한 줄 요약 문장. 이상이 없으면 굳이 등급을 늘어놓지 않습니다.
  const headline = useMemo(() => {
    if (loading) return "불러오는 중입니다.";
    if (!devices.length) return "등록된 설비가 없습니다.";
    if (!attention.length) return `설비 ${devices.length}대 모두 정상입니다.`;
    const parts = ORDER.filter((s) => s !== "normal" && count(s)).map(
      (s) => `${STATUS_LABEL[s]} ${count(s)}대`
    );
    return `설비 ${devices.length}대 가운데 ${parts.join(" · ")}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, loading, attention.length]);

  const worst: DeviceStatus = attention.length
    ? (ORDER.find((s) => s !== "normal" && count(s)) as DeviceStatus)
    : "normal";

  return (
    <>
      <PageHeader
        title="변압기 통합 모니터링"
        breadcrumb="홈"
        subtitle={`${loading ? "불러오는 중" : connected ? "실시간 연결됨" : "재연결 중"} · ${now || "-"}`}
        actions={
          <>
            <Link href="/devices" className="btn">
              설비 현황
            </Link>
            <button className="btn primary" onClick={() => void refresh()}>
              새로고침
            </button>
          </>
        }
      />

      {error && (
        <div className="banner error">
          <b>데이터를 불러오지 못했습니다</b> — {error}
        </div>
      )}

      {/* ① 지금 상태 ------------------------------------------------------- */}
      <section className="now">
        <p className={`now-line ${worst}`}>{headline}</p>

        {devices.length > 0 && (
          <div className="now-bar" role="img" aria-label="상태별 비율">
            {ORDER.map((s) =>
              count(s) ? (
                <span
                  key={s}
                  className={s}
                  style={{ width: `${(count(s) / devices.length) * 100}%` }}
                  title={`${STATUS_LABEL[s]} ${count(s)}대`}
                />
              ) : null
            )}
          </div>
        )}

        <dl className="now-facts">
          <div>
            <dt>평균 절연유 온도</dt>
            <dd>{avgTemp.toFixed(1)}℃</dd>
          </div>
          <div>
            <dt>최고 절연유 온도</dt>
            <dd className={maxTemp >= thresholds.temperature.warning ? "t-danger" : undefined}>
              {maxTemp.toFixed(1)}℃
            </dd>
          </div>
          <div>
            <dt>24시간 알람</dt>
            <dd>{alarms24h.toLocaleString()}건</dd>
          </div>
          <div>
            <dt>브릿지·게이트웨이</dt>
            <dd className={bridgesOnline < bridges.length ? "t-danger" : undefined}>
              {bridgesOnline} / {bridges.length} 접속
            </dd>
          </div>
        </dl>
      </section>

      {/* ② 확인할 설비 ----------------------------------------------------- */}
      <AttentionPanel devices={devices} alarms={alarms} thresholds={thresholds} />

      {/* ③ 나머지 설비 — 이름만 한 줄로 */}
      {normalDevices.length > 0 && (
        <section className="rest">
          <span className="rest-count">정상 {normalDevices.length}대</span>
          <span className="rest-names">{normalDevices.map((d) => d.name).join(" · ")}</span>
          <Link href="/devices" className="rest-link">
            설비 현황에서 전체 보기
          </Link>
        </section>
      )}

      {/* ④ 최근 알람 ------------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            최근 알람
          </div>
          <Link href="/alarms" className="btn">
            알람 이력
          </Link>
        </div>

        {alarms.length === 0 ? (
          <p className="feed-empty">최근 7일 사이 발생한 알람이 없습니다.</p>
        ) : (
          <ul className="feed">
            {alarms.slice(0, 8).map((a, i) => (
              <li key={a.id ?? i} className={a.level}>
                <span className="feed-time">{a.time}</span>
                <span className="feed-body">
                  <b>{a.unit}</b>
                  <span className="feed-item">{a.item}</span>
                  {a.detail && <span className="feed-detail">{a.detail}</span>}
                </span>
                <span className={`badge ${a.level}`}>{STATUS_LABEL[a.level]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
