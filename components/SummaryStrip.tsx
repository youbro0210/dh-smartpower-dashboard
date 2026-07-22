import { DeviceEvaluated, Bridge, ThresholdConfig } from "@/lib/types";

export default function SummaryStrip({
  devices,
  bridges,
  alarms24h,
  thresholds,
}: {
  devices: DeviceEvaluated[];
  bridges: Bridge[];
  alarms24h: number;
  thresholds: ThresholdConfig;
}) {
  const total = devices.length;
  const count = (s: string) => devices.filter((d) => d.status === s).length;
  const temps = devices.filter((d) => d.status !== "offline").map((d) => d.temperature);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
  const maxTemp = temps.length ? Math.max(...temps) : 0;
  const gasExceed = devices.filter((d) => d.h2 >= thresholds.h2.warning || d.ch4 >= thresholds.ch4.warning).length;
  const bridgesOnline = bridges.filter((b) => b.online).length;

  return (
    <div className="summary-strip">
      <div className="summary-item total"><span className="n">{total}</span><span className="l">전체 설비</span></div>
      <div className="summary-item normal"><span className="n">{count("normal")}</span><span className="l">정상</span></div>
      <div className="summary-item caution"><span className="n">{count("caution")}</span><span className="l">주의</span></div>
      <div className="summary-item warning"><span className="n">{count("warning")}</span><span className="l">경고</span></div>
      <div className="summary-item danger"><span className="n">{count("danger")}</span><span className="l">위험</span></div>
      <div className="summary-item offline"><span className="n">{count("offline")}</span><span className="l">통신단절</span></div>
      <div className="summary-item total"><span className="n">{alarms24h}</span><span className="l">24h 알람</span></div>
      <div className="summary-item total"><span className="n">{avgTemp.toFixed(1)}℃</span><span className="l">평균온도 (최고 {maxTemp.toFixed(1)}℃)</span></div>
      <div className="summary-item warning"><span className="n">{gasExceed}</span><span className="l">가스 기준초과</span></div>
      <div className="summary-item normal"><span className="n">{bridgesOnline}/{bridges.length}</span><span className="l">브릿지 온라인</span></div>
    </div>
  );
}
