function seededSeries(seed: number, base: number, driftUp: boolean) {
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const pts: number[] = [];
  let v = base * 0.55;
  for (let i = 0; i < 24; i++) {
    const drift = driftUp ? (i / 24) * (base * 0.5) : 0;
    v = v + (rand() - 0.45) * base * 0.08 + drift * 0.08;
    pts.push(Math.max(0, v));
  }
  pts.push(base);
  return pts;
}

function pathFromSeries(pts: number[], w: number, h: number, min: number, max: number) {
  const n = pts.length;
  return pts
    .map((p, i) => {
      const x = (i / (n - 1)) * w;
      const y = h - ((p - min) / (max - min || 1)) * h;
      return (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    })
    .join(" ");
}

export default function Sparkline({ deviceId, temp, h2, isDanger, compact }: { deviceId: string; temp: number; h2: number; isDanger: boolean; compact?: boolean }) {
  const seed = parseInt(deviceId, 10) || 1;
  const tempSeries = seededSeries(seed * 7 + 1, temp, isDanger);
  const h2Series = seededSeries(seed * 13 + 3, h2, isDanger);
  const tMax = Math.max(...tempSeries) * 1.15, tMin = Math.min(...tempSeries) * 0.85;
  const hMax = Math.max(...h2Series) * 1.15 || 1, hMin = Math.min(...h2Series) * 0.85;

  const h = compact ? 26 : 70;

  return (
    <svg viewBox={`0 0 300 ${h}`} width="100%" height={h} preserveAspectRatio="none" className={compact ? "mini-spark" : undefined}>
      <path d={pathFromSeries(tempSeries, 300, h, tMin, tMax)} fill="none" stroke="#d93a3a" strokeWidth={compact ? 1.5 : 2} />
      <path d={pathFromSeries(h2Series, 300, h, hMin, hMax)} fill="none" stroke="#0e8f9c" strokeWidth={compact ? 1.5 : 2} opacity="0.9" />
    </svg>
  );
}
