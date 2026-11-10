"use client";

/**
 * 표 아래에 두는 공통 페이지 이동 줄입니다.
 * 처음 · 이전 · 번호(최대 10개) · 다음 · 끝 과 전체 건수를 보여 줍니다.
 */
export default function Pager({
  page,
  total,
  pageSize,
  onPage,
  loading = false,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  loading?: boolean;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const blockStart = Math.floor((page - 1) / 10) * 10 + 1;
  const blockEnd = Math.min(last, blockStart + 9);
  const nums: number[] = [];
  for (let n = blockStart; n <= blockEnd; n++) nums.push(n);
  const go = (n: number) => {
    if (n < 1 || n > last || n === page || loading) return;
    onPage(n);
  };

  return (
    <div className="pager">
      <button className="btn sm" disabled={page <= 1 || loading} onClick={() => go(1)}>
        처음
      </button>
      <button className="btn sm" disabled={page <= 1 || loading} onClick={() => go(page - 1)}>
        이전
      </button>
      {nums.map((n) => (
        <button
          key={n}
          className={`btn sm pager-num${n === page ? " on" : ""}`}
          disabled={loading}
          onClick={() => go(n)}
        >
          {n}
        </button>
      ))}
      <button className="btn sm" disabled={page >= last || loading} onClick={() => go(page + 1)}>
        다음
      </button>
      <button className="btn sm" disabled={page >= last || loading} onClick={() => go(last)}>
        끝
      </button>
      <span className="pager-total">
        총 {total.toLocaleString()}건 · {page} / {last}
      </span>
    </div>
  );
}
