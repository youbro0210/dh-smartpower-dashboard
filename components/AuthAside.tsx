/**
 * 로그인 · 회원가입 화면의 왼쪽 패널.
 *
 * 무엇을 감시하는 시스템인지 먼저 알리는 자리입니다.
 * 계측 항목 네 가지는 ㈜헤디 측정모듈이 올려 보내는 값과 같습니다.
 */
export default function AuthAside() {
  return (
    <aside className="auth-aside">
      <div className="brand-mark">DH</div>

      <h1>
        변압기 통합
        <br />
        모니터링 시스템
      </h1>

      <p className="auth-tagline">
        유입식 변압기의 상태를 한 화면에서 봅니다. 기준을 넘으면 담당자에게 바로 알립니다.
      </p>

      <hr />

      <ul className="auth-points">
        <li>
          수소가스 (H₂)
          <span>절연유 분해 징후</span>
        </li>
        <li>
          메탄가스 (CH₄)
          <span>과열 진행 징후</span>
        </li>
        <li>
          절연유 온도
          <span>부하·냉각 상태</span>
        </li>
        <li>
          절연유 유면
          <span>누유 여부</span>
        </li>
      </ul>

      <p className="auth-org">DH 스마트파워 · 구축 (주)에스와이유</p>
    </aside>
  );
}
