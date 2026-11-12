/**
 * CS 요청 분석에 넘기는 화면 목록과 사용 문의 근거입니다.
 * 메뉴가 바뀌면 lib/nav.ts 와 함께 고칩니다.
 */
export const SCREENS: [string, string][] = [
  ["/", "홈"],
  ["/devices", "설비 현황"],
  ["/alarms", "알람 이력"],
  ["/maintenance", "점검 이력"],
  ["/trend", "추세 분석"],
  ["/readings", "계측 이력"],
  ["/diagnosis", "가스 진단"],
  ["/aging", "열화·수명"],
  ["/report", "운영 보고서"],
  ["/sample", "샘플 대시보드"],
  ["/settings", "설정"],
  ["/settings/mqtt", "설정 › 데이터 연결"],
  ["/settings/ingest", "설정 › 수집 내역"],
  ["/settings/commands", "설정 › 장비 제어"],
  ["/settings/notify", "설정 › 알림 발송"],
  ["/admin", "회원관리"],
  ["/login-history", "로그인 이력"],
];

/** 관리 메뉴는 여각과 같이 CS 요청 대상에서 뺍니다. .autofix.yml forbidden 과 맞춥니다. */
export const ADMIN_PREFIXES = ["/settings", "/admin", "/login-history"];

export const isAdminScreen = (u: string | null | undefined) =>
  !!u &&
  ADMIN_PREFIXES.some((p) => {
    const path = u.split("?")[0];
    return path === p || path.startsWith(`${p}/`);
  });

export const screenName = (u: string | null | undefined) => {
  if (!u) return "";
  const p = u.split("?")[0];
  return (
    SCREENS.filter(([h]) => p === h || (h !== "/" && p.startsWith(`${h}/`))).sort(
      (a, b) => b[0].length - a[0].length
    )[0]?.[1] ?? p
  );
};

export const HOWTO = `
- 설비 상태 확인: 업무 › 설비 현황
- 알람 확인: 업무 › 알람 이력
- 점검·시료 분석·보충·수리·교체 기록: 업무 › 점검 이력. 등록과 삭제는 관리자 [이력 등록]
- 수소·메탄·온도 추이: 분석 › 추세 분석
- 측정값 한 건씩 보기·재전송(일괄전송) 확인: 분석 › 계측 이력
- 가스 진단: 분석 › 가스 진단
- 열화·수명: 분석 › 열화·수명
- 운영 보고서: 분석 › 운영 보고서
- 임계치·설비 등록: 관리 › 설정(관리자)
- 알림 수신자·발송 경로: 관리 › 설정 › 알림 발송(관리자)
- 회원 등록·등급·비밀번호: 관리 › 회원관리(관리자)
- 수정 요청: 어느 화면에서든 위 [수정 요청] → CS 요청 › 요청 접수. 진행은 CS 요청 › 반영 확인
`.trim();
