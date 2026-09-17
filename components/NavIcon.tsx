/**
 * 메뉴 아이콘.
 * 해림 생산공정관리(haerim.ai.kr)와 같은 규격의 라인 아이콘입니다.
 * 24 격자, 선만 사용(fill: none), 선 굵기 1.8, 끝·꺾임 둥글게, 색은 currentColor.
 */

export type IconName =
  | "home"
  | "device"
  | "bell"
  | "chart"
  | "settings"
  | "users"
  | "history"
  | "sample"
  | "menu"
  | "logout"
  | "close";

const PATHS: Record<IconName, JSX.Element> = {
  // 집
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  // 변압기·설비 (공장 실루엣)
  device: (
    <>
      <path d="M3 21V10l6 4v-4l6 4V6l6 4v11z" />
      <path d="M7 17h2M11 17h2M15 17h2" />
    </>
  ),
  // 알람 (종)
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  // 추세 (막대 그래프)
  chart: (
    <>
      <path d="M3 21h18" />
      <path d="M6 17v-5M11 17V6M16 17v-8M21 17v-3" />
    </>
  ),
  // 설정 (슬라이더)
  settings: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </>
  ),
  // 회원관리 (승인된 사용자)
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0" />
      <path d="m16 11 2 2 4-4" />
    </>
  ),
  // 로그인 이력 (되감기 시계)
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  // 샘플 대시보드 (레이아웃 미리보기)
  sample: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11" />
      <path d="M12.5 16.5v-3M15.5 16.5v-5M18.5 16.5v-2" />
    </>
  ),
  // 햄버거
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  // 로그아웃
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>
  ),
  // 탭 닫기
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export default function NavIcon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
