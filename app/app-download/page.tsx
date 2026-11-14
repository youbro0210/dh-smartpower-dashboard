"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import PageHeader from "@/components/PageHeader";
import { fmtDateTime } from "@/lib/format";

interface BuildInfo {
  version: string;
  size: number;
  sha256: string;
  builtAt: string;
}

const ANDROID_PATH = "/downloads/dhsp-android.apk";

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 안드로이드·아이폰 앱 내려받기. 설치 파일은 로그인 없이 받을 수 있어 휴대폰에서 QR 로 바로 엽니다. */
export default function AppDownloadPage() {
  const [android, setAndroid] = useState<BuildInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/downloads/android.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setAndroid(j))
      .catch(() => setAndroid(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!android) return;
    const url = `${window.location.origin}${ANDROID_PATH}?v=${encodeURIComponent(android.version)}`;
    QRCode.toDataURL(url, { margin: 1, width: 168, color: { dark: "#1d2939", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [android]);

  return (
    <>
      <PageHeader title="앱 다운로드" breadcrumb="시스템 관리 › 앱 다운로드" />

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            모바일 앱
          </div>
        </div>
        <div className="table-wrap">
          <table className="fixed app-table">
            <colgroup>
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "30%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>구분</th>
                <th>버전</th>
                <th>크기</th>
                <th>배포일</th>
                <th>내려받기</th>
                <th>QR</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <b>안드로이드</b>
                  <span className="cell-sub">APK · Android 6.0 이상</span>
                </td>
                <td className="center">{android?.version ?? "-"}</td>
                <td className="num">{android ? mb(android.size) : "-"}</td>
                <td className="center">{android ? fmtDateTime(android.builtAt) : loaded ? "빌드 대기" : "-"}</td>
                <td className="center">
                  {android ? (
                    <a className="btn primary" href={`${ANDROID_PATH}?v=${encodeURIComponent(android.version)}`} download>
                      APK 다운로드
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="center app-qr">{qr ? <img src={qr} alt="안드로이드 앱 내려받기 QR" /> : "-"}</td>
              </tr>
              <tr>
                <td>
                  <b>아이폰</b>
                  <span className="cell-sub">iOS</span>
                </td>
                <td className="center">-</td>
                <td className="num">-</td>
                <td className="center">준비 중</td>
                <td className="center">-</td>
                <td className="center t-muted">App Store·TestFlight 배포 (Apple 개발자 계정 필요)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
