"use client";

// PC 공동인증서 자동 선택 (CodefCert 로컬 엔진) — 2026-08-04 사장님 지시
//   은행 사이트처럼 PC에 저장된 인증서를 자동으로 찾아 목록에서 고르게 한다.
//   온보딩 3단계(StepCertRegistration)에서 검증된 흐름을 설정 화면에서도 쓰도록 분리한 컴포넌트.
//   브라우저 단독으로는 NPKI 폴더 접근이 불가능하므로, 엔진(CodefCert) 미설치면
//   OS에 맞는 인스톨러 다운로드를 안내한다. 추출 결과는 PFX(base64) — CODEF 등록에 그대로 사용.

import { useEffect, useRef, useState } from "react";
import { Ico } from "@/components/ui-icon";
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const codefcert: any;

type EngineStatus = "loading" | "connected" | "not-installed" | "error";
interface AutoCertItem {
  "cert.subjectname.CN": string;
  "cert.validity.notAfter": number;
  "cert.der.path": string;
  "cert.key.path": string;
  [key: string]: unknown;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

const fmtExpiry = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function CertAutoPicker({ onExtracted }: {
  /** 추출 성공 시 — PFX(base64)·인증서 이름·비밀번호. 호출측이 CODEF 등록에 사용한다. */
  onExtracted: (r: { pfxBase64: string; certName: string; password: string }) => void;
}) {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("loading");
  const [certList, setCertList] = useState<AutoCertItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractedName, setExtractedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  async function initEngine() {
    setEngineStatus("loading");
    setError(null);
    try {
      await loadScript("/scripts/jquery-jsonp-polyfill.js");
      await loadScript("/scripts/codefcert.js");
      codefcert.options.opt1 = false;
      codefcert._show_log = false;

      const { data: { session } } = await supabase.auth.getSession();
      const tokenRes = await fetch("/api/codef/cert-token", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!tokenRes.ok) {
        // 토큰 실패는 프로그램 미설치가 아니다 — 설치 안내로 오인되지 않게 별도 상태로.
        setEngineStatus("error");
        setError(`서버 인증 토큰 발급 실패 (HTTP ${tokenRes.status}) — PC 프로그램 문제가 아닙니다. 잠시 후 다시 시도해주세요.`);
        return;
      }
      const { token } = await tokenRes.json();
      codefcert.options.codefToken = token;

      codefcert.initialization((success: boolean, errorCode?: string) => {
        if (success) {
          setEngineStatus("connected");
          fetchCertList();
        } else {
          setEngineStatus(errorCode === "E010002" ? "not-installed" : "error");
          if (errorCode && errorCode !== "E010002") {
            setError(`인증 프로그램 연결 실패 (코드 ${errorCode}) — 프로그램은 설치돼 있습니다. 잠시 후 "다시 확인"을 눌러주세요.`);
          }
        }
      });
    } catch {
      setEngineStatus("error");
      setError("인증 스크립트 초기화에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.");
    }
  }

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    initEngine();
    return () => {
      try {
        if (typeof codefcert !== "undefined" && codefcert._connected) codefcert.finalization();
      } catch { /* 종료 실패 무시 */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SDK 경합 주의: initialization 성공 콜백은 WebSocket 연결·라이선스 확인이 "끝나기 전"에 불린다
  //   (getPort 성공 직후 callback). 그 시점의 engineGetCertification 은 {SUCCESS:false} — 빈 목록으로
  //   오인됐던 원인(2026-08-04 사장님 재현). 배열이 올 때까지 0.5초 간격 재시도.
  function fetchCertList(attempt = 0) {
    codefcert.engineGetCertification("", (certs: AutoCertItem[] | { SUCCESS: boolean; ERROR_CODE?: string }) => {
      if (Array.isArray(certs)) {
        const now = Math.floor(Date.now() / 1000);
        setCertList(certs.filter((c) => c["cert.validity.notAfter"] > now));
        return;
      }
      if (attempt < 10) {
        setTimeout(() => fetchCertList(attempt + 1), 500);
        return;
      }
      const code = (certs as { ERROR_CODE?: string })?.ERROR_CODE || "";
      setError(code
        ? `인증서 목록 조회 실패 (코드 ${code}) — "다시 검색"을 눌러주세요.`
        : "인증서 목록 조회에 실패했습니다. \"다시 검색\"을 눌러주세요.");
    });
  }

  const handleExtract = () => {
    if (selectedIdx === null) { setError("인증서를 선택해주세요."); return; }
    if (!password) { setError("인증서 비밀번호를 입력해주세요."); return; }
    setExtracting(true);
    setError(null);
    const cert = certList[selectedIdx];
    codefcert.engineGetExportCertificationB64(
      { certPassword: password, certPath: cert["cert.der.path"], keyPath: cert["cert.key.path"] },
      (result: { SUCCESS: boolean; CONVERT?: string; REASON?: string }) => {
        setExtracting(false);
        if (result.SUCCESS && result.CONVERT) {
          const name = cert["cert.subjectname.CN"];
          setExtractedName(name);
          onExtracted({ pfxBase64: result.CONVERT, certName: name, password });
        } else {
          const code = result.REASON || "";
          setExtractedName(null);
          setError(code === "-9997" ? "인증서 비밀번호가 일치하지 않습니다." : `인증서 추출 실패 (${code || "알 수 없는 오류"})`);
        }
      },
    );
  };

  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <div className="cert-picker">
      {engineStatus === "loading" && (
        <div className="cert-picker-status">
          <span className="cert-picker-spinner" /> PC 인증서 프로그램 확인 중...
        </div>
      )}

      {engineStatus === "error" && (
        <div className="cert-picker-status">
          <button type="button" onClick={() => initEngine()} className="cert-picker-retry">다시 확인</button>
        </div>
      )}

      {engineStatus === "not-installed" && (
        <div className="cert-picker-install">
          <div className="text-[13px] font-semibold text-[var(--text)]"><Ico e="💾" /> 인증서 자동 인식 프로그램이 필요합니다</div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            보안 정책상 브라우저는 PC의 인증서 폴더를 직접 읽을 수 없습니다. 아래 프로그램(CodefCert)을
            설치하면 은행 사이트처럼 PC에 저장된 공동인증서를 자동으로 찾아드립니다. 설치는 최초 1회만 필요합니다.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={isMac ? "/downloads/CodefCertInstaller.pkg" : "/downloads/CodefCertInstaller.exe"} download className="btn-primary text-xs px-4">
              {isMac ? "macOS 설치 파일 다운로드" : "Windows 설치 파일 다운로드"}
            </a>
            <a href={isMac ? "/downloads/CodefCertInstaller.exe" : "/downloads/CodefCertInstaller.pkg"} download className="text-[11px] text-[var(--text-muted)] hover:underline">
              {isMac ? "Windows용" : "macOS용"} 받기
            </a>
            <button type="button" onClick={() => initEngine()} className="cert-picker-retry">설치 완료 — 다시 확인</button>
          </div>
        </div>
      )}

      {engineStatus === "connected" && (
        <>
          {certList.length === 0 ? (
            <div className="cert-picker-status">
              PC에서 유효한 공동인증서를 찾지 못했습니다. 인증서가 이동식 디스크에 있다면 연결 후
              <button type="button" onClick={() => initEngine()} className="cert-picker-retry ml-1">다시 검색</button>
            </div>
          ) : (
            <div className="cert-picker-tablewrap">
              <table className="cert-picker-table">
                <thead>
                  <tr>
                    <th className="cert-picker-th w-8" aria-label="선택" />
                    <th className="cert-picker-th text-left">사용자</th>
                    <th className="cert-picker-th text-left w-24">만료일</th>
                    <th className="cert-picker-th text-left w-24">발급기관</th>
                  </tr>
                </thead>
                <tbody>
                  {certList.map((c, i) => (
                    <tr
                      key={`${c["cert.der.path"]}`}
                      onClick={() => { setSelectedIdx(i); setExtractedName(null); }}
                      className={`cert-picker-row ${selectedIdx === i ? "cert-picker-row-active" : ""}`}
                    >
                      <td className="cert-picker-td text-center">
                        <span className={`cert-picker-radio ${selectedIdx === i ? "cert-picker-radio-on" : ""}`} />
                      </td>
                      <td className="cert-picker-td font-semibold text-[var(--text)] truncate max-w-[220px]">{c["cert.subjectname.CN"]}</td>
                      <td className="cert-picker-td mono-number text-[var(--text-muted)]">{fmtExpiry(c["cert.validity.notAfter"])}</td>
                      <td className="cert-picker-td text-[var(--text-muted)]">{String(c["cert.issuername.CN"] || c["cert.issuer.CN"] || "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {certList.length > 0 && (
            <div className="cert-picker-actions">
              <div className="relative flex-1 min-w-[200px]">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setExtractedName(null); }}
                  placeholder="인증서 비밀번호"
                  className="field-input pr-14"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
                  {showPw ? "숨기기" : "보기"}
                </button>
              </div>
              <button type="button" onClick={handleExtract} disabled={extracting || selectedIdx === null || !password} className="btn-primary text-xs px-4 disabled:opacity-50">
                {extracting ? "불러오는 중..." : "인증서 불러오기"}
              </button>
            </div>
          )}

          {extractedName && (
            <div className="cert-picker-ok"><Ico e="✅" /> {extractedName} — 인증서 준비 완료. 아래에서 연결을 진행하세요.</div>
          )}
        </>
      )}

      {error && <div className="cert-picker-error">{error}</div>}
    </div>
  );
}
