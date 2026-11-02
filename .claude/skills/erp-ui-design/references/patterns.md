# 화면 패턴 모음

모든 예시는 `tokens.css`의 클래스를 사용한다. Tailwind만 쓰는 프로젝트라도 표·폼은 이 클래스를 그대로 쓰는 것이 정렬이 가장 안정적이다.

---

## 1. 앱 골격 (layout.tsx)

```tsx
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr', height: '100vh' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                       padding: '0 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/logo.svg" alt="" height={22} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>생산관리시스템</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--text-sub)' }}>
          <span>홍길동 (관리팀)</span>
          <button className="btn">로그아웃</button>
        </div>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', minHeight: 0 }}>
        <Sidebar />
        <main style={{ padding: '0 16px 16px', overflow: 'auto' }}>{children}</main>
      </div>
    </div>
  );
}
```

## 2. 좌측 메뉴

```tsx
function Sidebar() {
  return (
    <nav style={{ borderRight: '1px solid var(--line)', overflowY: 'auto', fontSize: 13 }}>
      <div className="menu-group">기준정보</div>
      <a className="menu-item">거래처 관리</a>
      <a className="menu-item active">품목 관리</a>
      <div className="menu-group">구매</div>
      <a className="menu-item">발주 등록</a>
    </nav>
  );
}
```

```css
.menu-group { padding: 12px 16px 4px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
.menu-item { display: block; height: 32px; line-height: 32px; padding: 0 16px 0 13px;
             border-left: 3px solid transparent; color: var(--text); cursor: pointer; }
.menu-item:hover { background: var(--bg-hover); }
.menu-item.active { border-left-color: var(--primary); background: var(--primary-soft);
                    color: var(--primary); font-weight: 600; }
```

## 3. 목록 화면 (조회조건 + 데이터 표)

```tsx
<div className="page-head">
  <h1>발주 현황</h1>
  <div className="toolbar">
    <button className="btn btn-primary">조회</button>
    <button className="btn">신규</button>
  </div>
</div>

{/* 조회조건: 한 줄 격자 */}
<table className="form-grid" style={{ marginBottom: 12 }}>
  <tbody>
    <tr>
      <th>발주일자</th>
      <td>
        <input className="input" type="date" style={{ width: 130 }} />
        <span style={{ margin: '0 6px' }}>~</span>
        <input className="input" type="date" style={{ width: 130 }} />
      </td>
      <th>거래처</th>
      <td><input className="input" style={{ width: 180 }} /></td>
      <th>상태</th>
      <td>
        <select className="select" style={{ width: 120 }}>
          <option>전체</option><option>진행</option><option>완료</option>
        </select>
      </td>
    </tr>
  </tbody>
</table>

{/* 건수 + 보조 버튼 */}
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              height: 32, fontSize: 13 }}>
  <span>총 <b>{rows.length.toLocaleString()}</b>건</span>
  <div className="toolbar">
    <button className="btn">엑셀</button>
    <button className="btn">인쇄</button>
  </div>
</div>

<div style={{ maxHeight: 'calc(100vh - 260px)', overflow: 'auto', borderTop: '1px solid var(--line)' }}>
  <table className="grid">
    <colgroup>
      <col style={{ width: 48 }} /><col style={{ width: 110 }} /><col style={{ width: 120 }} />
      <col /><col style={{ width: 100 }} /><col style={{ width: 120 }} /><col style={{ width: 80 }} />
    </colgroup>
    <thead>
      <tr>
        <th>No</th><th>발주번호</th><th>발주일자</th><th>거래처</th>
        <th>수량</th><th>금액</th><th>상태</th>
      </tr>
    </thead>
    <tbody>
      {rows.length === 0 ? (
        <tr><td className="empty" colSpan={7}>조회된 데이터가 없습니다.</td></tr>
      ) : rows.map((r, i) => (
        <tr key={r.id} className={r.id === selectedId ? 'selected' : ''} onClick={() => select(r.id)}>
          <td className="center">{i + 1}</td>
          <td className="center">{r.no}</td>
          <td className="center">{r.date}</td>
          <td>{r.vendor}</td>
          <td className="num">{r.qty.toLocaleString()}</td>
          <td className="num">{r.amount.toLocaleString()}</td>
          <td className={'center ' + (r.delayed ? 't-danger' : '')}>{r.status}</td>
        </tr>
      ))}
    </tbody>
    <tfoot>
      <tr>
        <td colSpan={4} className="center">합계</td>
        <td className="num">{sumQty.toLocaleString()}</td>
        <td className="num">{sumAmount.toLocaleString()}</td>
        <td />
      </tr>
    </tfoot>
  </table>
</div>
```

## 4. 등록·수정 화면

```tsx
<div className="page-head">
  <h1>품목 등록</h1>
  <div className="toolbar">
    <button className="btn btn-primary">저장</button>
    <button className="btn btn-danger">삭제</button>
    <button className="btn">목록</button>
  </div>
</div>

<div className="section-title">기본정보</div>
<table className="form-grid">
  <tbody>
    <tr>
      <th className="req">품목코드</th><td><input className="input" style={{ width: '100%' }} /></td>
      <th className="req">품목명</th><td><input className="input" style={{ width: '100%' }} /></td>
    </tr>
    <tr>
      <th>규격</th><td><input className="input" style={{ width: '100%' }} /></td>
      <th>단가</th><td><input className="input num" style={{ width: 160 }} /></td>
    </tr>
    <tr>
      <th>비고</th><td colSpan={3}><textarea className="input" style={{ width: '100%', height: 60, padding: 6 }} /></td>
    </tr>
  </tbody>
</table>
```

```css
.section-title { font-size: 14px; font-weight: 600; padding: 12px 0 6px;
                 border-bottom: 2px solid var(--text); margin-bottom: -1px; }
```

## 5. 모달

- 너비는 내용에 맞게(480·720·960px), 모서리 2px, 그림자는 `0 2px 6px rgba(16,24,40,.10)`만.
- 머리글 44px(제목 + 오른쪽 닫기 ×), 하단 버튼 영역 52px 오른쪽 정렬, 각 영역 1px 선으로 구분.
- 배경 딤: `rgba(0,0,0,.3)`. 열고 닫을 때 애니메이션 없음.

## 6. 대시보드 지표

카드 대신 요약 표를 쓴다.

```tsx
<table className="grid" style={{ marginBottom: 16 }}>
  <thead><tr><th>구분</th><th>금월</th><th>전월</th><th>증감</th></tr></thead>
  <tbody>
    <tr><td>매출액</td><td className="num">128,450,000</td><td className="num">117,200,000</td>
        <td className="num t-success">+9.6%</td></tr>
    <tr><td>발주건수</td><td className="num">342</td><td className="num">365</td>
        <td className="num t-danger">-6.3%</td></tr>
  </tbody>
</table>
```

## 7. 페이지 이동

```tsx
<div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 8 }}>
  <button className="btn">〈</button>
  {pages.map(p => (
    <button key={p} className={'btn' + (p === page ? ' btn-primary' : '')} style={{ minWidth: 30, padding: 0 }}>{p}</button>
  ))}
  <button className="btn">〉</button>
</div>
```

## 8. 알림 메시지

- 저장 완료 등은 화면 오른쪽 위에 2초간 표시되는 작은 사각 상자(흰 바탕, 1px 선, 13px 글자).
- 오류는 `alert` 대신 같은 상자에 빨간 글자. 아이콘·이모지 없음.
