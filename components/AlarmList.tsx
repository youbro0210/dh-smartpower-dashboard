import { AlarmEvent } from "@/lib/types";

const LEVEL_LABEL: Record<string, string> = { caution: "주의", warning: "경고", danger: "위험" };
const LEVEL_COLOR: Record<string, string> = { caution: "var(--caution)", warning: "var(--warning)", danger: "var(--danger)" };

export default function AlarmList({ alarms }: { alarms: AlarmEvent[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title"><span className="accent-bar" />최근 알람 이력</div>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th style={{ width: 120 }}>발생 시각</th>
            <th>설비 · 항목</th>
            <th style={{ width: 60 }}>등급</th>
          </tr>
        </thead>
        <tbody>
          {alarms.length === 0 ? (
            <tr>
              <td className="empty" colSpan={3}>조회된 데이터가 없습니다.</td>
            </tr>
          ) : (
            alarms.map((a, i) => (
              <tr key={i}>
                <td className="center">{a.time}</td>
                <td>{a.unit} · {a.item}</td>
                <td className="center" style={{ color: LEVEL_COLOR[a.level], fontWeight: 600 }}>{LEVEL_LABEL[a.level]}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
