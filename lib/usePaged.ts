"use client";

import { useEffect, useMemo, useState } from "react";

/** 이미 받아 둔 목록을 화면에서 나눠 보여 줄 때 씁니다. */
export function usePaged<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const last = Math.max(1, Math.ceil(total / pageSize));
  // 목록이 바뀌어 지금 페이지가 범위를 벗어나면 첫 페이지로 돌아갑니다.
  useEffect(() => {
    if (page > last) setPage(1);
  }, [page, last]);
  const slice = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize]
  );
  return { page, setPage, slice, total, offset: (page - 1) * pageSize };
}
