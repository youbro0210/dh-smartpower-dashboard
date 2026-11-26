import type { IconName } from "@/components/NavIcon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
  /** DH스마트파워 직원만 (고객사 담당자에게는 숨김) */
  staffOnly?: boolean;
}

export interface NavGroup {
  label: string;
  /** DH 직원 전용 묶음. 메뉴에서 공통 메뉴와 구분해 표시합니다. */
  staffOnly?: boolean;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  // ── 고객사 담당자와 DH 직원이 함께 보는 메뉴 ──
  // 권한 기준(관제 화면 시안): 고객사 담당자는 자기 사업장의 관제·알림 처리와 이력·보고서까지,
  // 설비 등록 정보와 전문 진단(가스 진단·열화 수명)·전국 관제는 DH 직원만 봅니다.
  {
    label: "모니터링",
    items: [
      { href: "/", label: "사업장 관제", icon: "home" },
      { href: "/national", label: "전국 통합 관제", icon: "building", staffOnly: true },
      { href: "/devices", label: "설비 현황", icon: "device", staffOnly: true },
      { href: "/alarms", label: "알람 이력", icon: "bell" },
      { href: "/maintenance", label: "점검 이력", icon: "wrench" },
    ],
  },
  {
    label: "분석",
    items: [
      { href: "/trend", label: "추세 분석", icon: "chart" },
      { href: "/diagnosis", label: "가스 진단", icon: "flask", staffOnly: true },
      { href: "/aging", label: "열화·수명", icon: "thermo", staffOnly: true },
      { href: "/report", label: "운영 보고서", icon: "report" },
    ],
  },
  {
    label: "CS 요청",
    items: [
      { href: "/cs/new", label: "요청 접수", icon: "request" },
      { href: "/cs", label: "반영 확인", icon: "check" },
    ],
  },
  // ── DH스마트파워 직원 전용 ──
  {
    label: "DH 운영",
    staffOnly: true,
    items: [
      { href: "/companies", label: "고객사 관리", icon: "building", staffOnly: true },
      { href: "/readings", label: "계측 이력", icon: "history", staffOnly: true },
    ],
  },
  {
    label: "시스템 관리",
    staffOnly: true,
    items: [
      { href: "/settings", label: "설정", icon: "settings", adminOnly: true },
      { href: "/admin", label: "회원관리", icon: "users", adminOnly: true },
      { href: "/login-history", label: "로그인 이력", icon: "history", adminOnly: true },
      { href: "/app-download", label: "앱 다운로드", icon: "download", staffOnly: true },
    ],
  },
];

// 메뉴에 직접 나오지 않는 하위 화면의 탭 이름입니다.
const SUB_LABELS: Record<string, string> = {
  "/settings/mqtt": "데이터 연결",
  "/settings/ingest": "수집 내역",
  "/settings/commands": "장비 제어",
  "/settings/notify": "알림 발송",
};

const LABELS = new Map<string, string>([
  ...NAV.flatMap((g) => g.items).map((i) => [i.href, i.label] as [string, string]),
  ...Object.entries(SUB_LABELS),
]);

export function labelFor(pathname: string): string {
  return LABELS.get(pathname) ?? "페이지";
}
