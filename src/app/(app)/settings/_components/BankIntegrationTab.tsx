"use client";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { encryptCredential } from "@/lib/crypto";
import { BANK_ROLES } from "@/lib/routing";
import type { BankAccount } from "@/types/models";
import { useToast } from "@/components/toast";

const CODEF_BANKS: Record<string, string> = {
  "0003": "기업은행", "0004": "국민은행", "0011": "농협은행",
  "0020": "우리은행", "0023": "SC제일은행", "0031": "대구은행",
  "0032": "부산은행", "0034": "광주은행", "0035": "제주은행",
  "0037": "전북은행", "0039": "경남은행", "0045": "새마을금고",
  "0048": "신협", "0071": "우체국", "0081": "하나은행",
  "0088": "신한은행", "0089": "케이뱅크", "0090": "카카오뱅크",
  "0092": "토스뱅크",
};

const CODEF_CARDS: Record<string, string> = {
  "0301": "KB국민카드", "0302": "현대카드", "0303": "삼성카드",
  "0304": "NH농협카드", "0305": "BC카드", "0306": "신한카드",
  "0309": "하나카드", "0311": "롯데카드", "0313": "우리카드",
};

// 공공기관 organization codes (CODEF API)
// 백엔드 codef-sync 의 HOMETAX_ORG 와 일치해야 함.
const CODEF_PUBLIC: Record<string, string> = {
  "0001": "국세청 홈택스",
};

function CodefAccountRegister({ companyId, onRegistered }: { companyId: string | null; onRegistered: () => void }) {
  const { toast } = useToast();
  const [accountType, setAccountType] = useState<"bank" | "card" | "hometax">("bank");
  const [clientType, setClientType] = useState<"P" | "B">("B");
  const [authMethod, setAuthMethod] = useState<"cert" | "idpw">("cert");
  const [organization, setOrganization] = useState("");
  // ID/PW states
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  // Certificate states
  const [certPassword, setCertPassword] = useState("");
  const [showCertPw, setShowCertPw] = useState(false);
  const [derFileB64, setDerFileB64] = useState("");
  const [keyFileB64, setKeyFileB64] = useState("");
  const [certFileName, setCertFileName] = useState("");
  // Hometax 전용 — 대표자 주민번호 앞 7자리 (선택)
  const [hometaxIdentity, setHometaxIdentity] = useState("");
  // Common
  const [registering, setRegistering] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const orgList = accountType === "bank" ? CODEF_BANKS : accountType === "card" ? CODEF_CARDS : CODEF_PUBLIC;

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleCertFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    let derDone = false;
    let keyDone = false;
    const names: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const b64 = await readFileAsBase64(file);
      const lower = file.name.toLowerCase();
      if (lower.includes("signcert") || lower.endsWith(".der")) {
        setDerFileB64(b64);
        derDone = true;
        names.push(file.name);
      } else if (lower.includes("signpri") || lower.endsWith(".key")) {
        setKeyFileB64(b64);
        keyDone = true;
        names.push(file.name);
      } else if (lower.endsWith(".pfx") || lower.endsWith(".p12")) {
        // PFX contains both cert and key
        setDerFileB64(b64);
        setKeyFileB64(b64);
        derDone = true;
        keyDone = true;
        names.push(file.name);
      }
    }
    setCertFileName(names.join(", ") || "");
    if (!derDone || !keyDone) {
      setResult({ ok: false, msg: "signCert.der + signPri.key 두 파일을 함께 선택하거나, .pfx 파일 하나를 선택하세요." });
    } else {
      setResult(null);
    }
  }

  async function handleRegister() {
    if (!companyId || registering || !organization) return;
    setRegistering(true);
    setResult(null);
    try {
      // ── 홈택스 (공공 0002) — register/connectedId 흐름 사용 안 함 ──
      // 인증서 파일은 storage 에 업로드, 비밀번호는 automation_credentials 에 저장.
      // verify API 로 회원 등록여부 확인.
      if (accountType === "hometax") {
        if (authMethod === "cert") {
          if (!derFileB64 || !keyFileB64 || !certPassword) {
            setResult({ ok: false, msg: "인증서 파일과 비밀번호를 모두 입력하세요" });
            setRegistering(false);
            return;
          }
          // 1. 인증서 파일을 storage 에 업로드 (codef-sync 가 거기서 가져감)
          const derBytes = Uint8Array.from(atob(derFileB64), (c) => c.charCodeAt(0));
          const keyBytes = Uint8Array.from(atob(keyFileB64), (c) => c.charCodeAt(0));
          await supabase.storage.from("certificates").upload(
            `${companyId}/signCert.der`, new Blob([derBytes]), { upsert: true },
          );
          await supabase.storage.from("certificates").upload(
            `${companyId}/signPri.key`, new Blob([keyBytes]), { upsert: true },
          );
          // 2. 인증서 비밀번호를 암호화하여 automation_credentials 에 저장 (sync 시 사용)
          const { encryptCredential } = await import("@/lib/crypto");
          const enc = await encryptCredential(certPassword);
          await (supabase as any).from("automation_credentials").upsert({
            company_id: companyId,
            service: "hometax",
            credentials: { login_method: "certificate", cert_password: enc || "" },
            updated_at: new Date().toISOString(),
          }, { onConflict: "company_id,service" });
          // 3. verify API 호출 (회원 등록여부)
          const { verifyHometaxRegistration } = await import("@/lib/data-sync");
          const res = await verifyHometaxRegistration(companyId, {
            loginType: "0",
            certPassword,
            identity: hometaxIdentity || undefined,
          });
          if (res.success && res.registered) {
            setResult({ ok: true, msg: "홈택스 등록 확인 완료. 이제 세금계산서 동기화를 사용할 수 있습니다." });
            toast("홈택스 연결 완료", "success");
            setCertPassword("");
            onRegistered();
          } else if (res.success && !res.registered) {
            setResult({ ok: false, msg: "홈택스 미등록 사용자입니다. 홈택스 사이트에서 회원가입 후 다시 시도하세요." });
          } else {
            setResult({ ok: false, msg: (res.error || "검증 실패") + (res.hint ? `\n→ ${res.hint}` : "") });
          }
        } else {
          if (!loginId || !loginPw) {
            setResult({ ok: false, msg: "아이디와 비밀번호를 모두 입력하세요" });
            setRegistering(false);
            return;
          }
          // ID/PW 정보를 automation_credentials 에 저장 (sync 시 사용)
          const { encryptCredential } = await import("@/lib/crypto");
          const encPw = await encryptCredential(loginPw);
          await (supabase as any).from("automation_credentials").upsert({
            company_id: companyId,
            service: "hometax",
            credentials: { login_method: "id_pw", login_id: loginId, login_password: encPw || "" },
            updated_at: new Date().toISOString(),
          }, { onConflict: "company_id,service" });
          const { verifyHometaxRegistration } = await import("@/lib/data-sync");
          const res = await verifyHometaxRegistration(companyId, {
            loginType: "1",
            id: loginId,
            userPassword: loginPw,
            identity: hometaxIdentity || undefined,
          });
          if (res.success && res.registered) {
            setResult({ ok: true, msg: "홈택스 등록 확인 완료." });
            toast("홈택스 연결 완료", "success");
            setLoginId("");
            setLoginPw("");
            onRegistered();
          } else if (res.success && !res.registered) {
            setResult({ ok: false, msg: "홈택스 미등록 사용자입니다." });
          } else {
            setResult({ ok: false, msg: (res.error || "검증 실패") + (res.hint ? `\n→ ${res.hint}` : "") });
          }
        }
        setRegistering(false);
        return;
      }

      // ── 은행/카드 — 기존 register/connectedId 흐름 ──
      if (authMethod === "cert") {
        if (!derFileB64 || !keyFileB64 || !certPassword) {
          setResult({ ok: false, msg: "인증서 파일과 비밀번호를 모두 입력하세요" });
          setRegistering(false);
          return;
        }
        const { registerCodefCertificate } = await import("@/lib/data-sync");
        const res = await registerCodefCertificate(companyId, accountType, organization, derFileB64, keyFileB64, certPassword, undefined, clientType);
        if (res.success) {
          setResult({ ok: true, msg: "금융기관 연결 성공!" });
          toast("금융기관 연결 완료", "success");
          setCertPassword("");
          onRegistered();
        } else {
          setResult({ ok: false, msg: res.error || "연결 실패" });
        }
      } else {
        if (!loginId || !loginPw) {
          setResult({ ok: false, msg: "아이디와 비밀번호를 모두 입력하세요" });
          setRegistering(false);
          return;
        }
        const { registerCodefAccount } = await import("@/lib/data-sync");
        const res = await registerCodefAccount(companyId, accountType, organization, loginId, loginPw, clientType);
        if (res.success) {
          setResult({ ok: true, msg: "금융기관 연결 성공!" });
          toast("금융기관 연결 완료", "success");
          setLoginId("");
          setLoginPw("");
          onRegistered();
        } else {
          setResult({ ok: false, msg: res.error || "연결 실패" });
        }
      }
    } catch (err: any) {
      setResult({ ok: false, msg: err.message || "오류 발생" });
    }
    setRegistering(false);
  }

  const isCertReady = !!derFileB64 && !!keyFileB64 && !!certPassword && !!organization;
  const isIdPwReady = !!loginId && !!loginPw && !!organization;
  const isReady = authMethod === "cert" ? isCertReady : isIdPwReady;

  return (
    <div className="glass-card p-6">
      <h2 className="text-sm font-bold mb-1">금융기관 연결</h2>
      <p className="text-xs text-[var(--text-dim)] mb-4">공동인증서 또는 인터넷뱅킹 아이디로 계좌를 연결하면 거래내역이 자동 수집됩니다.</p>

      {/* 데모 체험 */}
      <button
        onClick={async () => {
          if (!companyId || registering) return;
          setRegistering(true);
          setResult(null);
          try {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const { data: { session } } = await (await import("@/lib/supabase")).supabase.auth.getSession();
            if (!session || !supabaseUrl) throw new Error("로그인 필요");
            const res = await fetch(`${supabaseUrl}/functions/v1/codef-sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ companyId, action: "sandbox-connect" }),
            });
            const data = await res.json();
            if (data.success) {
              setResult({ ok: true, msg: `데모 연결 완료! 은행 ${data.bankAccounts || 0}개 + 카드 ${data.cardAccounts || 0}개 확인됨` });
              toast("데모 금융 데이터 연결 완료", "success");
              onRegistered();
            } else {
              setResult({ ok: false, msg: data.error || "연결 실패" });
            }
          } catch (err: any) {
            setResult({ ok: false, msg: err.message || "오류" });
          }
          setRegistering(false);
        }}
        disabled={registering}
        className="mb-4 w-full py-2.5 bg-blue-500/10 text-blue-600 border border-blue-500/20 rounded-xl text-xs font-semibold hover:bg-blue-500/20 transition disabled:opacity-50"
      >
        {registering ? "연결 중..." : "데모 데이터로 바로 체험하기"}
      </button>

      <div className="border-t border-[var(--border)] pt-4 mb-4">
        <p className="text-xs font-semibold text-[var(--text)] mb-3">실제 금융기관 연결</p>

        {/* 은행/카드/홈택스 선택 */}
        <div className="flex gap-2 mb-3">
          <button onClick={() => { setAccountType("bank"); setOrganization(""); }} className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${accountType === "bank" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)]"}`}>은행</button>
          <button onClick={() => { setAccountType("card"); setOrganization(""); }} className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${accountType === "card" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)]"}`}>카드</button>
          <button onClick={() => { setAccountType("hometax"); setOrganization("0001"); }} className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${accountType === "hometax" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)]"}`}>홈택스</button>
        </div>

        {/* 개인/법인 선택 */}
        <div className="flex gap-2 mb-3">
          <button onClick={() => setClientType("P")} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition border ${clientType === "P" ? "bg-orange-500/10 text-orange-600 border-orange-500/30" : "bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)]"}`}>
            개인
          </button>
          <button onClick={() => setClientType("B")} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition border ${clientType === "B" ? "bg-orange-500/10 text-orange-600 border-orange-500/30" : "bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)]"}`}>
            법인/기업
          </button>
        </div>

        {/* 인증 방식 선택 */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setAuthMethod("cert")} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition border ${authMethod === "cert" ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)]"}`}>
            공동인증서
          </button>
          <button onClick={() => setAuthMethod("idpw")} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition border ${authMethod === "idpw" ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)]"}`}>
            아이디/비밀번호
          </button>
        </div>

        {/* 금융기관 선택 */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">{accountType === "bank" ? "은행" : accountType === "card" ? "카드사" : "공공기관"} 선택</label>
            <select value={organization} onChange={(e) => setOrganization(e.target.value)} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
              <option value="">선택하세요</option>
              {Object.entries(orgList).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>

          {accountType === "hometax" && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">대표자 주민번호 앞 7자리 <span className="caption">(선택, ID/PW 방식 또는 검증 필요시)</span></label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={7}
                value={hometaxIdentity}
                onChange={(e) => setHometaxIdentity(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="예: 8001011 (생년월일 6 + 성별 1)"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
              <p className="text-[10px] text-[var(--text-dim)] mt-1">
                개인사업자: 본인 주민번호 앞 7자리 / 법인: 대표자 주민번호 앞 7자리.
                안전한 보관을 위해 바로 CODEF 호출 후 즉시 폐기됩니다 (DB 저장 X).
              </p>
            </div>
          )}

          {authMethod === "cert" ? (
            <>
              {/* 공동인증서 입력 */}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">공동인증서 파일</label>
                <div className="relative">
                  <input
                    type="file"
                    multiple
                    onChange={(e) => handleCertFiles(e.target.files)}
                    className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--primary)]/10 file:text-[var(--primary)]"
                  />
                </div>
                {certFileName && <p className="text-[10px] text-green-600 mt-1">선택됨: {certFileName}</p>}
                <p className="text-[10px] text-[var(--text-dim)] mt-1">signCert.der + signPri.key 또는 .pfx 파일을 선택하세요</p>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">인증서 비밀번호</label>
                <div className="relative">
                  <input type={showCertPw ? "text" : "password"} value={certPassword} onChange={(e) => setCertPassword(e.target.value)} placeholder="인증서 비밀번호" className="w-full px-4 py-3 pr-16 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  <button type="button" onClick={() => setShowCertPw(!showCertPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text)]">{showCertPw ? "숨기기" : "보기"}</button>
                </div>
                <p className="text-[10px] text-[var(--text-dim)] mt-1">인증서와 비밀번호는 보안 서버에서 암호화 처리됩니다. 오너뷰는 저장하지 않습니다.</p>
              </div>
            </>
          ) : (
            <>
              {/* ID/PW 입력 */}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">인터넷뱅킹 아이디</label>
                <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder={accountType === "bank" ? "인터넷뱅킹 아이디" : "카드 홈페이지 아이디"} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">비밀번호</label>
                <div className="relative">
                  <input type={showPw ? "text" : "password"} value={loginPw} onChange={(e) => setLoginPw(e.target.value)} placeholder="비밀번호" className="w-full px-4 py-3 pr-16 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text)]">{showPw ? "숨기기" : "보기"}</button>
                </div>
                <p className="text-[10px] text-[var(--text-dim)] mt-1">보안 서버를 통해 암호화 전송됩니다. 오너뷰는 비밀번호를 저장하지 않습니다.</p>
              </div>
            </>
          )}
        </div>
      </div>

      {result && (
        <div className={`mt-3 p-3 rounded-xl text-xs font-medium whitespace-pre-wrap break-all ${result.ok ? "bg-green-500/10 text-green-600 border border-green-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20"}`}>
          {result.msg}
        </div>
      )}

      <button
        onClick={handleRegister}
        disabled={registering || !isReady}
        className="mt-4 w-full py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
      >
        {registering ? "연결 중..." : `${orgList[organization] || (accountType === "bank" ? "은행" : "카드사")} 연결하기`}
      </button>
    </div>
  );
}

// P0-C: CODEF 동기화 에러 1건을 사용자 친화적으로 surface.
//   - 큼지막한 사용자 언어 hint 우선 노출 (codef-sync 의 codefErrorHint()
//     결과를 작은 회색 한 줄이 아니라 박스 내 강조 영역으로)
//   - code 별 다음 액션 버튼: 인증서 재등록 / 카드 비밀번호 재등록 / 다시 시도
function codefAction(code?: string): { label: string; tab?: string; retry?: boolean } | null {
  if (!code) return { label: "다시 시도", retry: true };
  if (code === "CF-00401") return { label: "🔑 인증서 다시 등록", tab: "certificate" };
  if (code === "CF-12838" || code === "CF-12839") return { label: "🔁 ConnectedID 재등록", tab: "bank" };
  if (code === "CF-13021") return { label: "다시 시도", retry: true }; // 외부(은행) 처리 필요 — UI에서 할 일 없음
  if (code === "NO_DEMAND_DEPOSIT") return { label: "🔁 다시 시도", retry: true };
  if (code === "CHUNK_FAIL") return { label: "🔁 다시 시도", retry: true };
  return { label: "🔁 다시 시도", retry: true };
}

function CodefErrorCard({ item, onRetry, retrying }: { item: any; onRetry: () => void; retrying: boolean }) {
  const code: string | undefined = item.code;
  const action = codefAction(code);
  const heading = item.accountNo || item.organization || "기관";
  // codef-sync 가 만들어준 hint 가 사용자 친화 텍스트 — 큰 글씨로 surface.
  const friendlyMain = item.hint || item.message || "동기화에 실패했습니다.";

  return (
    <li className="p-3 rounded-xl bg-red-500/8 border border-red-500/15">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-red-500/70 font-mono mb-0.5">
            {code || "ERROR"} · {heading}
          </div>
          <div className="text-sm text-red-600 dark:text-red-300 font-semibold leading-snug">
            {friendlyMain}
          </div>
          {item.hint && item.message && item.hint !== item.message && (
            <div className="text-[11px] text-[var(--text-muted)] mt-1">상세: {item.message}</div>
          )}
        </div>
        {action && (
          <div className="flex flex-col gap-1 shrink-0">
            {action.retry && (
              <button
                onClick={onRetry}
                disabled={retrying}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white transition whitespace-nowrap"
              >
                {retrying ? "처리 중…" : action.label}
              </button>
            )}
            {action.tab && (
              <a
                href={`/settings?tab=${action.tab}`}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition whitespace-nowrap text-center"
              >
                {action.label}
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ═══════════════════════════════════════════
// Bank Integration Tab — 사용자 친화적 금융 연결
// CODEF API 키는 서버 환경변수로만 관리 (사용자 노출 X)
// ═══════════════════════════════════════════
export function BankIntegrationTab({ companyId, bankAccounts }: { companyId: string | null; bankAccounts: BankAccount[] }) {
  const db2 = supabase as any;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState({
    auto_transfer_enabled: false, auto_transfer_limit: 5000000, transfer_schedule: "immediate",
    retry_count: 3, retry_interval_hours: 1,
    ceo_telegram_chat_id: "",
  });
  const [telegramTestResult, setTelegramTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sendingTelegramTest, setSendingTelegramTest] = useState(false);

  // 연결 상태 확인 — 은행/카드는 ConnectedID, 홈택스는 automation_credentials.hometax 존재 여부.
  const { data: connectionStatus, refetch: refetchConnection } = useQuery({
    queryKey: ["codef-connection", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const [{ data: cs }, { data: ht }] = await Promise.all([
        db2.from("company_settings").select("codef_connected_id, codef_connected_at").eq("company_id", companyId).maybeSingle(),
        db2.from("automation_credentials").select("id, updated_at, credentials").eq("company_id", companyId).eq("service", "hometax").maybeSingle(),
      ]);
      return {
        codef_connected_id: cs?.codef_connected_id || null,
        codef_connected_at: cs?.codef_connected_at || null,
        hometax_registered: !!ht?.id,
        hometax_method: ht?.credentials?.login_method || null,
        hometax_registered_at: ht?.updated_at || null,
      };
    },
    enabled: !!companyId,
  });

  // 연결된 CODEF 계좌 목록
  const [codefAccounts, setCodefAccounts] = useState<{ bank: any[]; card: any[] }>({ bank: [], card: [] });
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string; errors?: any[]; notes?: any[] } | null>(null);
  // 기간 선택 sync (과거 데이터 채워넣기용)
  const [showRangeSync, setShowRangeSync] = useState(false);
  const [rangeFrom, setRangeFrom] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [rangeTo, setRangeTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [recentSyncLogs, setRecentSyncLogs] = useState<any[]>([]);

  // 은행/카드 ConnectedID 또는 홈택스 자격증명 등록 시 모두 "연결됨" 표시.
  const hasCodefConnection = !!connectionStatus?.codef_connected_id;
  const hasHometaxConnection = !!connectionStatus?.hometax_registered;
  const isConnected = hasCodefConnection || hasHometaxConnection;

  // CODEF 계좌 목록 조회 — ConnectedID 가 있을 때만 (holetax 단독 등록은 의미 없음).
  useEffect(() => {
    if (!companyId || !hasCodefConnection) return;
    setLoadingAccounts(true);
    Promise.all([
      import("@/lib/data-sync").then(m => m.listCodefAccounts(companyId, "bank")),
      import("@/lib/data-sync").then(m => m.listCodefAccounts(companyId, "card")),
    ]).then(([bankRes, cardRes]) => {
      setCodefAccounts({
        bank: bankRes.success ? (bankRes.accounts || []) : [],
        card: cardRes.success ? (cardRes.accounts || []) : [],
      });
    }).finally(() => setLoadingAccounts(false));
  }, [companyId, isConnected]);

  // 최근 CODEF 동기화 이력 로드 (오류 모니터링)
  async function loadRecentSyncLogs() {
    if (!companyId) return;
    const { getRecentCodefSyncLogs } = await import("@/lib/data-sync");
    const logs = await getRecentCodefSyncLogs(companyId, 5);
    setRecentSyncLogs(logs);
  }
  useEffect(() => { if (isConnected) loadRecentSyncLogs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId, isConnected]);

  // YYYY-MM-DD → YYYYMMDD (CODEF format)
  function toCodefDate(iso: string): string { return iso.replace(/-/g, ''); }

  // 거래내역 동기화 — bank/card 와 hometax 를 분리 호출 (각자 Edge Function 150s timeout 회피).
  // 첫 sync 자동 감지 — bank_transactions 0건 이면 1년 전부터 가져옴 (default 3개월 제약 회피).
  async function handleSync() {
    if (!companyId || syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const { syncCodefData } = await import("@/lib/data-sync");

      // 첫 sync 감지 — bank_transactions 0건 → 1년치 자동 가져옴 (3개월씩 4번 chunked)
      let isFirstSync = false;
      if (hasCodefConnection) {
        const { count } = await db2.from('bank_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId);
        if ((count || 0) === 0) isFirstSync = true;
      }

      // 1단계: 은행/카드만 동기화. 첫 sync 면 1년치 3개월씩 분할, 일반 sync 는 default (3개월).
      let bankCardRes: any;
      if (hasCodefConnection && isFirstSync) {
        toast('첫 동기화 — 1년치 데이터를 4구간으로 나눠 가져오는 중', 'info');
        let totalBank = 0, totalCard = 0;
        const allErrors: any[] = [], allNotes: any[] = [];
        const today = new Date();
        for (let i = 3; i >= 0; i--) {
          const cEnd = new Date(today); cEnd.setMonth(cEnd.getMonth() - i * 3);
          const cStart = new Date(cEnd); cStart.setMonth(cStart.getMonth() - 3); cStart.setDate(cStart.getDate() + 1);
          const startStr = toCodefDate(cStart.toISOString().slice(0, 10));
          const endStr = toCodefDate(cEnd.toISOString().slice(0, 10));
          const r: any = await syncCodefData(companyId, 'bank_card', startStr, endStr);
          totalBank += r.bankSynced || 0;
          totalCard += r.cardSynced || 0;
          if (r.errors) allErrors.push(...r.errors);
          if (r.notes) allNotes.push(...r.notes);
        }
        bankCardRes = {
          success: allErrors.length === 0,
          status: allErrors.length === 0 ? 'success' : 'partial',
          errors: allErrors,
          notes: allNotes,
          bankSynced: totalBank, cardSynced: totalCard,
          message: `은행 ${totalBank}건 + 카드 ${totalCard}건 (1년치)`,
        };
      } else {
        bankCardRes = hasCodefConnection
          ? await syncCodefData(companyId, 'bank_card')
          : { success: true, errors: [], status: 'success' as const, message: '은행/카드 미등록' };
      }

      // 1.5단계: 카드 승인내역(실시간) — 반드시 별도 호출 (bank_card 와 묶으면 Edge 150s 초과 HTTP 546).
      //   청구 마감 전 결제건을 즉시 반영. billing 과 동일 external_id 로 중복 없이 수렴.
      const approvalRes = hasCodefConnection
        ? await syncCodefData(companyId, 'card_approval').catch(() => null)
        : null;

      // 2단계: 홈택스 동기화 (느림, 인증서 storage 필요) — 등록된 경우만
      const hometaxRes = hasHometaxConnection
        ? await syncCodefData(companyId, "hometax")
        : null;

      const allErrors = [...(bankCardRes.errors || []), ...((approvalRes as any)?.errors || []), ...((hometaxRes as any)?.errors || [])];
      const allNotes = [...((bankCardRes as any).notes || []), ...((approvalRes as any)?.notes || []), ...((hometaxRes as any)?.notes || [])];
      const totalSuccess = (bankCardRes.success ?? false) && (approvalRes ? approvalRes.success : true) && (hometaxRes ? hometaxRes.success : true);

      if (totalSuccess && allErrors.length === 0) {
        // 진짜 에러 없음 — 성공. notes(외부 안내)가 있어도 빨간 알림 안 뜸.
        const parts = [];
        if (hasCodefConnection) parts.push(bankCardRes.message || "은행/카드 동기화 완료");
        if (approvalRes && ((approvalRes as any).cardSynced ?? 0) > 0) parts.push(`카드 승인내역 ${(approvalRes as any).cardSynced}건`);
        if (hometaxRes) parts.push(hometaxRes.message || "홈택스 동기화 완료");
        setSyncResult({
          ok: true,
          msg: parts.join(" + ") || "동기화 완료",
          notes: allNotes.length > 0 ? allNotes : undefined,
        });
        toast("거래내역 동기화 완료", "success");
      } else if (allErrors.length > 0) {
        setSyncResult({
          ok: false,
          msg: `부분 동기화 (오류 ${allErrors.length}건)`,
          errors: allErrors,
          notes: allNotes.length > 0 ? allNotes : undefined,
        });
        toast("일부 동기화 실패", "info");
      } else {
        setSyncResult({ ok: false, msg: bankCardRes.error || "동기화 실패", errors: allErrors });
        toast("동기화 실패", "error");
      }
      await loadRecentSyncLogs();
    } catch (err: any) {
      setSyncResult({ ok: false, msg: err.message || "오류 발생" });
    }
    setSyncing(false);
    if (!syncResult?.errors?.length) setTimeout(() => setSyncResult((prev) => (prev?.errors?.length ? prev : null)), 5000);
  }

  const [rangeProgress, setRangeProgress] = useState<string>('');

  // 사용자가 명시한 기간으로 다시 sync — 3개월씩 분할 sequential 호출 (HTTP 546 timeout 회피)
  async function handleRangeSync() {
    if (!companyId || syncing) return;
    if (!rangeFrom || !rangeTo) { toast('기간을 지정하세요', 'error'); return; }
    if (rangeFrom > rangeTo) { toast('시작일이 종료일보다 늦습니다', 'error'); return; }
    setSyncing(true);
    setSyncResult(null);
    setRangeProgress('');
    try {
      const { syncCodefData } = await import('@/lib/data-sync');

      // 3개월(약 90일) 단위로 chunks 생성
      const chunks: Array<{ from: string; to: string }> = [];
      const startD = new Date(rangeFrom);
      const endD = new Date(rangeTo);
      let cursor = new Date(startD);
      while (cursor.getTime() <= endD.getTime()) {
        const chunkEnd = new Date(cursor);
        chunkEnd.setMonth(chunkEnd.getMonth() + 3);
        chunkEnd.setDate(chunkEnd.getDate() - 1);
        if (chunkEnd.getTime() > endD.getTime()) chunkEnd.setTime(endD.getTime());
        chunks.push({
          from: cursor.toISOString().slice(0, 10),
          to: chunkEnd.toISOString().slice(0, 10),
        });
        cursor = new Date(chunkEnd);
        cursor.setDate(cursor.getDate() + 1);
      }

      toast(`${rangeFrom} ~ ${rangeTo} (${chunks.length}개 구간) 동기화 시작`, 'info');

      let totalBank = 0, totalCard = 0;
      const allErrors: any[] = [];
      const allNotes: any[] = [];
      const failedChunks: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        setRangeProgress(`${i + 1}/${chunks.length} — ${c.from} ~ ${c.to}`);
        try {
          const res = await syncCodefData(companyId, 'bank_card', toCodefDate(c.from), toCodefDate(c.to));
          totalBank += res.bankSynced || 0;
          totalCard += res.cardSynced || 0;
          if ((res as any).errors) allErrors.push(...(res as any).errors);
          if ((res as any).notes) allNotes.push(...(res as any).notes);
          if (!res.success && (res as any).errors?.length === 0) {
            // HTTP 546 등 timeout — 더 작은 chunk 도 고려 대상
            failedChunks.push(`${c.from} ~ ${c.to}: ${(res as any).error || 'timeout'}`);
          }
        } catch (e: any) {
          failedChunks.push(`${c.from} ~ ${c.to}: ${e.message || '오류'}`);
        }
      }

      setRangeProgress('');
      const msgParts = [`은행 ${totalBank}건 + 카드 ${totalCard}건 sync`];
      if (allNotes.length > 0) msgParts.push(`안내 ${allNotes.length}건`);
      if (allErrors.length > 0) msgParts.push(`오류 ${allErrors.length}건`);
      if (failedChunks.length > 0) msgParts.push(`timeout ${failedChunks.length}개 구간`);

      const ok = allErrors.length === 0 && failedChunks.length === 0;
      setSyncResult({
        ok,
        msg: `${rangeFrom} ~ ${rangeTo} (${chunks.length}구간 처리) — ${msgParts.join(' · ')}`,
        errors: [...allErrors, ...failedChunks.map(f => ({ message: f, code: 'CHUNK_FAIL' }))].slice(0, 50),
        notes: allNotes.length > 0 ? allNotes : undefined,
      });
      toast(ok ? '기간 동기화 완료' : `부분 완료 — 자세히는 결과 확인`, ok ? 'success' : 'info');
      await loadRecentSyncLogs();
    } catch (err: any) {
      setSyncResult({ ok: false, msg: err.message || '오류 발생' });
    }
    setSyncing(false);
    setRangeProgress('');
  }

  const { data: companySettings } = useQuery({
    queryKey: ["automation-settings", companyId],
    queryFn: async () => { if (!companyId) return null; const { data } = await db2.from("companies").select("automation_settings").eq("id", companyId).maybeSingle(); return data?.automation_settings || {}; },
    enabled: !!companyId,
  });
  useEffect(() => { if (companySettings) setSettings((prev) => ({ ...prev, ...companySettings })); }, [companySettings]);
  async function saveSettings() {
    if (!companyId) return;
    const { error } = await db2.from("companies").update({ automation_settings: settings }).eq("id", companyId);
    if (error) { toast("설정 저장 실패: " + error.message, "error"); return; }
    queryClient.invalidateQueries({ queryKey: ["automation-settings"] });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  if (!companyId) return <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;

  return (
    <div className="space-y-6">
      {/* 금융 연결 상태 */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold">금융 데이터 연동</h2>
            {isConnected ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-500">연결됨</span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-500/10 text-gray-400">미연결</span>
            )}
          </div>
          {isConnected && (
            <div className="flex items-center gap-2">
              {hasCodefConnection && (
                <button
                  onClick={() => setShowRangeSync(v => !v)}
                  disabled={syncing}
                  className="px-3 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-xl text-xs font-semibold transition disabled:opacity-50 border border-[var(--border)]"
                  title="원하는 기간으로 과거 거래 다시 가져오기 (누락분 채워넣기)"
                >
                  📅 기간 선택 sync
                </button>
              )}
              <button onClick={handleSync} disabled={syncing} className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition disabled:opacity-50">
                {syncing ? "동기화 중..." : hasCodefConnection && hasHometaxConnection ? "전체 동기화" : hasHometaxConnection ? "홈택스 동기화" : "거래내역 동기화"}
              </button>
            </div>
          )}
        </div>

        {/* 기간 선택 sync — 펼침 */}
        {showRangeSync && hasCodefConnection && (
          <div className="mb-4 p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs font-bold text-[var(--text)]">📅 기간 선택해서 다시 동기화</div>
                <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                  CODEF default 는 최근 3개월만 가져옵니다. 과거 누락분이 있으면 시작일/종료일을 지정해 다시 sync 하세요.
                </div>
              </div>
              <button onClick={() => setShowRangeSync(false)}
                className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">✕</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-3">
              <label className="text-xs text-[var(--text-muted)]">시작일</label>
              <input type="date" value={rangeFrom} max={rangeTo} onChange={e => setRangeFrom(e.target.value)}
                className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg" />
              <span className="text-xs text-[var(--text-dim)]">~</span>
              <label className="text-xs text-[var(--text-muted)]">종료일</label>
              <input type="date" value={rangeTo} min={rangeFrom} max={new Date().toISOString().slice(0,10)} onChange={e => setRangeTo(e.target.value)}
                className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg" />
              <div className="flex items-center gap-1 ml-2">
                {[
                  { label: '최근 6개월', months: 6 },
                  { label: '최근 1년',   months: 12 },
                  { label: '최근 2년',   months: 24 },
                ].map(p => (
                  <button key={p.label} type="button"
                    onClick={() => {
                      const d = new Date(); d.setMonth(d.getMonth() - p.months);
                      setRangeFrom(d.toISOString().slice(0, 10));
                      setRangeTo(new Date().toISOString().slice(0, 10));
                    }}
                    className="px-2 py-1 text-[10px] rounded bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)]">
                    {p.label}
                  </button>
                ))}
              </div>
              <button onClick={handleRangeSync} disabled={syncing}
                className="ml-auto px-3 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg text-xs font-semibold transition disabled:opacity-50">
                {syncing ? '동기화 중...' : '이 기간 sync'}
              </button>
            </div>
            {rangeProgress && (
              <div className="mt-2 px-3 py-1.5 rounded-lg bg-[var(--primary)]/10 text-[11px] text-[var(--primary)] font-semibold">
                ⏳ {rangeProgress}
              </div>
            )}
            <div className="text-[10px] text-[var(--text-dim)] mt-2">
              ⚠ 3개월씩 분할 호출 (Edge Function 150초 timeout 회피). 1년 = 4번, 2년 = 8번 호출.
              <br />
              ⚠ 한국 은행 API 는 등록일 이전 거래를 못 가져올 수 있습니다. 누락분이 계속 있으면 은행 거래내역서를 CSV 로 직접 업로드하세요.
            </div>
          </div>
        )}

        {isConnected ? (
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/20">
              <p className="text-xs text-green-600 font-semibold">
                {hasCodefConnection && hasHometaxConnection
                  ? "은행/카드 + 홈택스가 모두 연결되었습니다. 거래내역과 세금계산서가 자동으로 수집됩니다."
                  : hasCodefConnection
                    ? "은행/카드가 연결되었습니다. 거래내역이 자동으로 수집됩니다."
                    : "홈택스가 연결되었습니다. 세금계산서가 자동으로 수집됩니다."}
              </p>
              {connectionStatus?.codef_connected_at && (
                <p className="text-[10px] text-[var(--text-dim)] mt-1">은행/카드 연결일: {new Date(connectionStatus.codef_connected_at).toLocaleDateString("ko-KR")}</p>
              )}
              {hasHometaxConnection && connectionStatus?.hometax_registered_at && (
                <p className="caption">
                  홈택스 연결일: {new Date(connectionStatus.hometax_registered_at).toLocaleDateString("ko-KR")}
                  {connectionStatus.hometax_method === "certificate" && " (공동인증서)"}
                  {connectionStatus.hometax_method === "id_pw" && " (ID/PW)"}
                </p>
              )}
            </div>

            {/* 연결된 계좌 목록 */}
            {loadingAccounts ? (
              <div className="text-center py-4 text-xs text-[var(--text-muted)]">계좌 정보 불러오는 중...</div>
            ) : (
              <>
                {codefAccounts.bank.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--text-muted)] mb-2">연결된 은행 계좌</h3>
                    <div className="space-y-1.5">
                      {codefAccounts.bank.map((acc: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 text-xs font-bold">B</div>
                            <div>
                              <div className="text-sm font-medium">{acc.displayName || acc.resAccountName || acc.organization || "계좌"}</div>
                              <div className="text-xs text-[var(--text-dim)]">{acc.resAccount || acc.resAccountDisplay || acc.organization || ""}</div>
                            </div>
                          </div>
                          {acc.resAccountBalance && (
                            <div className="text-sm font-bold">{Number(acc.resAccountBalance).toLocaleString()}원</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {codefAccounts.card.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--text-muted)] mb-2">연결된 카드</h3>
                    <div className="space-y-1.5">
                      {codefAccounts.card.map((card: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500 text-xs font-bold">C</div>
                            <div>
                              <div className="text-sm font-medium">{card.displayName || card.resCardName || card.organization || "카드"}</div>
                              <div className="text-xs text-[var(--text-dim)]">{card.resCardNo || card.organization || ""}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {codefAccounts.bank.length === 0 && codefAccounts.card.length === 0 && (
                  <p className="text-xs text-[var(--text-dim)] text-center py-2">연결된 계좌/카드 정보를 불러올 수 없습니다. 아래에서 추가로 연결하세요.</p>
                )}
              </>
            )}

            {syncResult && (
              // P0-C: CODEF 연결 에러 친절도 — code 별로 사용자 언어 안내 + 다음
              //   액션 버튼. 작은 회색 hint 한 줄에 묻혀 사용자가 "무엇을 하면 되는지"
              //   모르던 문제 해소. codefErrorHint() 가 만든 메시지를 큰 박스로 노출.
              <div className={`p-3 rounded-xl text-xs font-medium ${syncResult.ok ? "bg-green-500/10 text-green-600 border border-green-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20"}`}>
                <div>{syncResult.msg}</div>
                {syncResult.errors && syncResult.errors.length > 0 && (
                  <ul className="mt-3 space-y-2 text-xs font-normal">
                    {syncResult.errors.map((e: any, idx: number) => (
                      <CodefErrorCard key={idx} item={e} onRetry={handleSync} retrying={syncing} />
                    ))}
                  </ul>
                )}
                {syncResult.notes && syncResult.notes.length > 0 && (
                  <div className="mt-3 p-2.5 rounded-xl bg-blue-500/8 border border-blue-500/15">
                    <div className="text-xs font-semibold text-blue-600 dark:text-blue-300 mb-1.5">
                      💡 CODEF 설정 안내 {syncResult.notes.length}건
                    </div>
                    <ul className="space-y-1.5 text-[11px] font-normal text-[var(--text-muted)]">
                      {syncResult.notes.map((n: any, idx: number) => (
                        <li key={idx} className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
                          <div className="font-semibold text-[var(--text)] text-xs">{n.accountNo || n.organization}</div>
                          <div className="mt-0.5">{n.hint || n.message}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {recentSyncLogs.length > 0 && (
              <div className="mt-2 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold">최근 CODEF 동기화 이력</div>
                  <button onClick={loadRecentSyncLogs} className="text-[10px] text-[var(--primary)] hover:underline">새로고침</button>
                </div>
                <ul className="space-y-1.5">
                  {recentSyncLogs.map((log) => {
                    const errorCount = Number(log.details?.errorCount ?? 0);
                    const dot =
                      log.status === "success" ? "bg-green-500" : log.status === "partial" ? "bg-yellow-500" : "bg-red-500";
                    return (
                      <li key={log.id} className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
                          <span className="text-[var(--text-muted)] truncate">
                            {new Date(log.created_at).toLocaleString("ko-KR")}
                          </span>
                          <span className="text-[var(--text-dim)]">· {log.sync_type}</span>
                        </div>
                        <div className="text-[var(--text-muted)] whitespace-nowrap">
                          {log.status === "success" ? "정상" : log.status === "partial" ? `부분 (오류 ${errorCount})` : `실패 (오류 ${errorCount})`}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-dim)]">아래에서 은행 또는 카드를 연결하면 거래내역이 자동으로 수집됩니다.</p>
        )}
      </div>

      {/* 금융기관 연결 (계정 등록) — 항상 표시 */}
      <CodefAccountRegister companyId={companyId} onRegistered={() => { refetchConnection(); }} />

      {/* 수동 등록 계좌 */}
      <div className="glass-card p-6">
        <h2 className="section-title">수동 등록 계좌</h2>
        {bankAccounts.length === 0 ? (
          <div className="text-center py-6 text-sm text-[var(--text-muted)]">등록된 계좌가 없습니다. 일반 설정에서 통장을 추가하세요.</div>
        ) : (
          <div className="space-y-2">
            {bankAccounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)] text-xs font-bold">B</div>
                  <div>
                    <div className="text-sm font-medium">{acc.alias || acc.bank_name}</div>
                    <div className="text-xs text-[var(--text-dim)]">{acc.bank_name} {acc.account_number}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold">{Number(acc.balance || 0).toLocaleString()}원</div>
                  <div className="caption">{BANK_ROLES.find(r => r.value === acc.role)?.label || acc.role}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 이체 자동화 설정 */}
      <div className="glass-card p-6">
        <h2 className="section-title">이체 자동화 설정</h2>
        <div className="space-y-4">
          <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] cursor-pointer">
            <div><div className="text-sm font-medium">승인완료 건 자동이체</div><div className="text-xs text-[var(--text-dim)] mt-0.5">결재 승인 완료 시 자동 이체 실행</div></div>
            <input type="checkbox" checked={settings.auto_transfer_enabled} onChange={(e) => setSettings({ ...settings, auto_transfer_enabled: e.target.checked })} className="w-5 h-5 rounded accent-[var(--primary)]" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">자동이체 한도 (원)</label><input type="number" value={settings.auto_transfer_limit} onChange={(e) => setSettings({ ...settings, auto_transfer_limit: Number(e.target.value) || 0 })} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /><p className="text-[10px] text-[var(--text-dim)] mt-1">초과 금액은 수동 확인 필요</p></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">이체 실행 시점</label><select value={settings.transfer_schedule} onChange={(e) => setSettings({ ...settings, transfer_schedule: e.target.value })} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"><option value="immediate">즉시 실행</option><option value="daily_10">매일 10:00</option><option value="daily_14">매일 14:00</option><option value="weekly_mon">매주 월요일</option></select></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">실패 시 재시도</label><input type="number" value={settings.retry_count} onChange={(e) => setSettings({ ...settings, retry_count: Number(e.target.value) || 0 })} min={0} max={10} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">재시도 간격 (시간)</label><input type="number" value={settings.retry_interval_hours} onChange={(e) => setSettings({ ...settings, retry_interval_hours: Number(e.target.value) || 1 })} min={1} max={24} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
          </div>
          <div className="mt-2 p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <div className="text-sm font-medium mb-1">대표 텔레그램 승인 알림</div>
            <p className="text-[11px] text-[var(--text-dim)] mb-3">자동이체 한도 초과 결제는 여기서 등록한 텔레그램으로 승인 요청이 전송됩니다. <a href="https://t.me/motive_hajun_bot" target="_blank" rel="noreferrer" className="underline text-[var(--primary)]">@motive_hajun_bot</a>에게 <code>/start</code>를 입력하면 Chat ID가 발급됩니다.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="text" value={settings.ceo_telegram_chat_id} onChange={(e) => setSettings({ ...settings, ceo_telegram_chat_id: e.target.value })} placeholder="예: 1234567890" className="flex-1 px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              <button type="button" disabled={sendingTelegramTest || !settings.ceo_telegram_chat_id.trim()} onClick={async () => {
                setSendingTelegramTest(true); setTelegramTestResult(null);
                try {
                  const m = await import("@/lib/telegram");
                  const res = await m.sendTelegramMessage({ chatId: settings.ceo_telegram_chat_id.trim(), message: "[오너뷰] 테스트 — 자동이체 승인 알림이 이 채널로 전송됩니다." });
                  setTelegramTestResult({ ok: !!res.success, msg: res.success ? "테스트 메시지 전송됨" : (res.error || "전송 실패") });
                } finally { setSendingTelegramTest(false); }
              }} className="px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-semibold hover:bg-[var(--bg-surface)] disabled:opacity-50">{sendingTelegramTest ? "전송중..." : "테스트 발송"}</button>
            </div>
            {telegramTestResult && (
              <div className={`mt-2 text-xs ${telegramTestResult.ok ? "text-green-400" : "text-red-400"}`}>{telegramTestResult.ok ? "✅ " : "⚠️ "}{telegramTestResult.msg}</div>
            )}
          </div>
        </div>
      </div>
      <button onClick={saveSettings} className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">{saved ? "저장 완료" : "은행연동 설정 저장"}</button>
    </div>
  );
}
