import type { IconName } from "@/components/NavIcon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "업무",
    items: [
      { href: "/", label: "홈", icon: "home" },
      { href: "/devices", label: "설비 현황", icon: "device" },
      { href: "/alarms", label: "알람 이력", icon: "bell" },
    ],
  },
  {
    label: "분석",
    items: [
      { href: "/trend", label: "추세 분석", icon: "chart" },
      { href: "/sample", label: "샘플 대시보드", icon: "sample" },
    ],
  },
  {
    label: "관리",
    items: [
      { href: "/settings", label: "설정", icon: "settings", adminOnly: true },
      { href: "/admin", label: "회원관리", icon: "users", adminOnly: true },
      { href: "/login-history", label: "로그인 이력", icon: "history", adminOnly: true },
    ],
  },
];

// 메뉴에 직접 나오지 않는 하위 화면의 탭 이름입니다.
const SUB_LABELS: Record<string, string> = {
  "/settings/notify": "알림 발송",
};

const LABELS = new Map<string, string>([
  ...NAV.flatMap((g) => g.items).map((i) => [i.href, i.label] as [string, string]),
  ...Object.entries(SUB_LABELS),
]);

export function labelFor(pathname: string): string {
  return LABELS.get(pathname) ?? "페이지";
}
