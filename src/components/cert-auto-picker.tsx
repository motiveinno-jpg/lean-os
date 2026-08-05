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

// CodefCert 엔진이 내보내는 PFX 는 구식 RC2-40 암호가 섞인 표준 PKCS#12 (2026-08-05 진단:
//   der-ok, pbeSHA_3DES, pbeSHA_RC2_40). CODEF 계정등록 서버가 RC2 를 못 열어 CF-04009 가 났고,
//   홈택스류 국세청 API 는 아예 der/key 파일 2개를 요구한다.
//   → 브라우저에서 forge 로 해체해 ①3DES 로 재포장한 PFX(은행/카드 계정등록용)
//     ②cert DER + 암호화 PKCS#8 key(홈택스 der/key 등록용) 를 모두 만들어 넘긴다.
async function convertPfx(rawB64: string, password: string): Promise<{
  pfxBase64: string; derB64: string; keyB64: string;
}> {
  const forge = (await import("node-forge")).default;
  const asn1 = forge.asn1.fromDer(forge.util.decode64(rawB64));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);

  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const plainKeys = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const key = (shrouded[0] || plainKeys[0])?.key;
  const certs = certBags.map((b) => b.cert).filter(Boolean) as import("node-forge").pki.Certificate[];
  if (!key || certs.length === 0) throw new Error("인증서 해석 실패 (key/cert 누락)");

  // 사용자(leaf) 인증서 = 개인키와 모듈러스가 일치하는 것. 체인만 있고 못 찾으면 첫 번째.
  const rsaKey = key as import("node-forge").pki.rsa.PrivateKey;
  const leaf = certs.find((c) => {
    const pub = c.publicKey as import("node-forge").pki.rsa.PublicKey;
    return pub?.n && rsaKey?.n && pub.n.compareTo(rsaKey.n) === 0;
  }) || certs[0];

  // ① 재포장 PFX — AES-256/PBES2 (QA 실증 2026-08-05: 이 프로파일이 CODEF 계정등록 해독 통과)
  const newP12 = forge.pkcs12.toPkcs12Asn1(rsaKey, certs, password, { algorithm: "aes256" });
  const pfxBase64 = forge.util.encode64(forge.asn1.toDer(newP12).getBytes());

  // ② der/key — signCert.der(인증서 DER) + signPri.key(암호화 PKCS#8, 같은 비밀번호)
  const derB64 = forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes());
  const keyInfo = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(rsaKey));
  const encKeyInfo = forge.pki.encryptPrivateKeyInfo(keyInfo, password, { algorithm: "aes256" });
  const keyB64 = forge.util.encode64(forge.asn1.toDer(encKeyInfo).getBytes());

  return { pfxBase64, derB64, keyB64 };
}

export function CertAutoPicker({ onExtracted, purpose = "register" }: {
  /**
   * 추출·변환 성공 시 — 재포장 PFX(은행/카드 계정등록용)와 der/key(홈택스 등록용)를 모두 전달.
   * 호출측이 accountType 에 맞는 쪽을 골라 쓴다.
   */
  onExtracted: (r: { pfxBase64: string; relayPfxB64?: string; derB64: string; keyB64: string; certName: string; password: string }) => void;
  /** register(기본): 추출·변환까지. locate: 파일 위치 안내만(예비 — 현재 미사용). */
  purpose?: "register" | "locate";
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
      async (result: { SUCCESS: boolean; CONVERT?: string; REASON?: string }) => {
        if (result.SUCCESS && result.CONVERT) {
          const name = cert["cert.subjectname.CN"];
          try {
            const converted = await convertPfx(result.CONVERT, password);
            // 공식 샘플 흐름: 엔진 산출 PFX 를 CODEF 중계 서버(relay.codef.io)에 왕복시켜
            // CODEF 가 반환하는 pfxFile 을 계정등록에 사용한다 (엔진 산출물 직접 등록은 CF-04009).
            // 왕복 실패 시 der/key 변환본 경로로 폴백 — 등록 자체는 계속 진행 가능.
            let relayPfxB64: string | undefined;
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/codef-cert-relay`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
                body: JSON.stringify({ pfxFile: result.CONVERT }),
              });
              const body = await res.json();
              if (res.ok && body?.pfxFile) relayPfxB64 = body.pfxFile;
              else console.warn("[cert-relay] 실패 — der/key 폴백:", body?.error);
            } catch (relayErr) {
              console.warn("[cert-relay] 호출 오류 — der/key 폴백:", relayErr);
            }
            setExtracting(false);
            setExtractedName(name + (relayPfxB64 ? " · 중계 정규화 완료" : ""));
            onExtracted({ ...converted, relayPfxB64, certName: name, password });
          } catch (e) {
            setExtracting(false);
            setExtractedName(null);
            setError(`인증서 변환 실패 (${e instanceof Error ? e.message : String(e)}) — "파일 직접 업로드"를 이용해주세요.`);
          }
        } else {
          const code = result.REASON || "";
          setExtracting(false);
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

          {purpose === "locate" && certList.length > 0 && selectedIdx !== null && (
            <div className="cert-picker-locate">
              <div className="text-[12px] font-semibold text-[var(--text)]">이 인증서의 파일 위치</div>
              <code className="cert-picker-locate-path">{String(certList[selectedIdx]["cert.der.path"]).replace(/[\\/][^\\/]*$/, "")}</code>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                은행·카드 연결은 규격상 인증서 파일 2개(signCert.der, signPri.key)가 필요합니다.
                아래 &quot;파일 직접 업로드&quot;에서 위 폴더의 두 파일을 함께 선택해주세요.
              </p>
            </div>
          )}

          {purpose === "register" && certList.length > 0 && (
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
            <div className="cert-picker-ok"><Ico e="✅" /> {extractedName} — 인증서 준비 완료 (변환 vAES). 아래에서 연결을 진행하세요.</div>
          )}
        </>
      )}

      {error && <div className="cert-picker-error">{error}</div>}
    </div>
  );
}
