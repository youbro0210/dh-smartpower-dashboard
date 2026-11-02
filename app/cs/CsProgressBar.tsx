"use client";

import { useRouter } from "next/navigation";
import Bar from "@/cs-engine/react/CsProgressBar";
import type { CsProgress } from "@/cs-engine/progress";

/** cs-engine 막대에 화면 새로 읽기를 붙입니다. live 인 막대 하나만 새로 읽습니다. */
export default function CsProgressBar({ p, compact = false, live = true }: { p: CsProgress; compact?: boolean; live?: boolean }) {
  const router = useRouter();
  return <Bar p={p} compact={compact} refresh={live ? router.refresh : undefined} />;
}
