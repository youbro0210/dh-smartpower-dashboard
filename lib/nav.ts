export interface NavItem {
  href: string;
  label: string;
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
      { href: "/", label: "홈" },
      { href: "/devices", label: "설비 현황" },
      { href: "/alarms", label: "알람 이력" },
    ],
  },
  {
    label: "분석",
    items: [{ href: "/trend", label: "추세 분석" }],
  },
  {
    label: "관리",
    items: [
      { href: "/settings", label: "설정", adminOnly: true },
      { href: "/admin", label: "회원관리", adminOnly: true },
      { href: "/login-history", label: "로그인 이력", adminOnly: true },
    ],
  },
];

const LABELS = new Map(NAV.flatMap((g) => g.items).map((i) => [i.href, i.label]));

export function labelFor(pathname: string): string {
  return LABELS.get(pathname) ?? "페이지";
}
