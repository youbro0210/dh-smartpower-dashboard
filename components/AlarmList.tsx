import { AlarmEvent } from "@/lib/types";

const LEVEL_LABEL: Record<string, string> = { caution: "주의", warning: "경고", danger: "위험" };
const LEVEL_COLOR: Record<string, string> = { caution: "var(--caution)", warning: "var(--warning)", danger: "var(--danger)" };

export default function AlarmList({ alarms }: { alarms: AlarmEvent[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title"><span className="accent-bar" />최근 알람 이력</div>
      </div>
      <div>
        {alarms.map((a, i) => (
          <div className="alarm-item" key={i}>
            <span className="time">{a.time}</span>
            <span className="desc">{a.unit} · {a.item}</span>
            <span className="lvl" style={{ color: LEVEL_COLOR[a.level] }}>{LEVEL_LABEL[a.level]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
