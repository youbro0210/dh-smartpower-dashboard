/**
 * 서버(EC2)의 시계는 UTC 입니다. 화면·알림에 찍는 시각은 모두 한국 시각으로 맞춥니다.
 * 브라우저가 아닌 서버 코드에서 getHours() 를 쓰면 9시간이 어긋나므로 이 함수를 씁니다.
 */
const FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type KstParts = { year: number; month: number; day: number; hour: number; minute: number };

export function kstParts(d: Date): KstParts {
  const p: Record<string, string> = {};
  for (const part of FMT.formatToParts(d)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}
