"use client";

// 세무사 파트너 포털 — 랜딩(로그인·가입·프로필 등록·승인 대기) (2026-08-11)
//   상태 흐름: 비로그인(로그인/가입) → 로그인 + 프로필 없음(등록) → pending(승인 대기)
//   → active(대시보드로) / suspended(안내). 데이터 접근은 전부 SECDEF RPC — 여기선 상태 분기만.

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Advisor = { id: string; name: string; office_name: string | null; status: string };

const COVER_POINTS = [
  "연결된 고객사의 통장 잔고·거래 내역을 자료 요청 없이 바로 봅니다.",
  "매출·매입 세금계산서와 분기 부가세 흐름이 신고 기준으로 정리되어 있습니다.",
  "월별 인건비와 원천세 내역까지 — 기장에 필요한 지면이 한 곳에 인쇄됩니다.",
];

export default function AdvisorLandingPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "auth" | "register" | "pending" | "suspended">("loading");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // 프로필 등록 폼
  const [name, setName] = useState("");
  const [office, setOffice] = useState("");
  const [phone, setPhone] = useState("");
  const [specialty, setSpecialty] = useState("");

  const resolvePhase = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setPhase("auth"); return; }
    const { data: advisor } = await (supabase as any)
      .from("tax_advisors").select("id, name, office_name, status")
      .eq("auth_id", session.user.id).maybeSingle();
    const a = advisor as Advisor | null;
    if (!a) { setPhase("register"); return; }
    if (a.status === "active") { router.replace("/advisor/dashboard"); return; }
    setPhase(a.status === "suspended" ? "suspended" : "pending");
  }, [router]);

  useEffect(() => { resolvePhase(); }, [resolvePhase]);

  const submitAuth = async () => {
    setError(""); setNote(""); setBusy(true);
    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (err) throw new Error("이메일 또는 비밀번호가 올바르지 않습니다.");
        await resolvePhase();
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(), password: pw,
          options: { emailRedirectTo: `${location.origin}/advisor` },
        });
        if (err) throw new Error(err.message.includes("already") ? "이미 가입된 이메일입니다. 로그인해 주세요." : err.message);
        // 이미 존재하는 이메일이면 Supabase 가 (계정 존재 노출 방지로) 메일 없이 성공한 척한다 —
        //   identities 빈 배열이 그 신호. "메일 보냈다"고 안내하면 영영 기다리게 된다 (2026-08-11 사장님 제보).
        if (data.session) { await resolvePhase(); }
        else if (data.user && (data.user.identities || []).length === 0) {
          setMode("login");
          throw new Error("이미 이 이메일로 오너뷰 계정이 있습니다. 그 비밀번호로 로그인하면 세무사 등록으로 이어집니다. 비밀번호를 모르면 오너뷰 로그인 화면의 '비밀번호 재설정'을 이용하세요.");
        }
        else setNote("확인 메일을 보냈습니다. 메일함(스팸함 포함)의 링크를 누른 뒤 이 페이지에서 로그인해 주세요.");
      }
    } catch (e: any) {
      setError(e.message || "요청에 실패했습니다.");
    } finally { setBusy(false); }
  };

  const submitRegister = async () => {
    if (!name.trim()) { setError("성함을 입력해 주세요."); return; }
    setError(""); setBusy(true);
    try {
      const { error: err } = await (supabase as any).rpc("advisor_register", {
        p_name: name.trim(), p_office_name: office.trim() || null,
        p_phone: phone.trim() || null, p_specialty: specialty.trim() || null,
      });
      if (err) throw err;
      setPhase("pending");
    } catch (e: any) {
      setError(e?.message || "등록에 실패했습니다.");
    } finally { setBusy(false); }
  };

  const logout = async () => {
    await supabase.auth.signOut({ scope: "local" });
    setPhase("auth"); setMode("login");
  };

  if (phase === "loading") return <div className="adv-loading">불러오는 중…</div>;

  if (phase === "pending" || phase === "suspended") {
    return (
      <div className="min-h-dvh flex flex-col">
        <Topbar onLogout={logout} />
        <div className="adv-notice">
          <div className="adv-notice-stamp">{phase === "pending" ? "심사 대기" : "이용 중지"}</div>
          <div className="adv-notice-title">
            {phase === "pending" ? "가입 확인 중입니다" : "계정이 중지되었습니다"}
          </div>
          <p className="adv-notice-desc">
            {phase === "pending"
              ? "오너뷰 운영팀이 제휴 확인 후 승인해 드립니다. 승인되면 등록하신 이메일로 안내드리며, 이후 이 페이지에서 담당 고객사를 볼 수 있습니다."
              : "자세한 내용은 오너뷰 운영팀(creative@mo-tive.com)으로 문의해 주세요."}
          </p>
        </div>
      </div>
    );
  }

  if (phase === "register") {
    return (
      <div className="min-h-dvh flex flex-col">
        <Topbar onLogout={logout} />
        <div className="adv-auth-side flex-1">
          <div className="adv-auth-card">
            <div className="adv-auth-title">세무사 정보 등록</div>
            <p className="adv-auth-desc">제휴 확인에 사용됩니다. 승인 후 고객사가 연결됩니다.</p>
            <label className="adv-field">
              <span className="adv-field-label">성함 *</span>
              <input className="adv-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
            </label>
            <label className="adv-field">
              <span className="adv-field-label">사무소명</span>
              <input className="adv-input" value={office} onChange={(e) => setOffice(e.target.value)} placeholder="길동세무회계" />
            </label>
            <label className="adv-field">
              <span className="adv-field-label">연락처</span>
              <input className="adv-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" />
            </label>
            <label className="adv-field">
              <span className="adv-field-label">전문 분야</span>
              <input className="adv-input" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="법인·부가세·원천세 등" />
            </label>
            {error && <div className="adv-form-error">{error}</div>}
            <button className="adv-btn-primary" onClick={submitRegister} disabled={busy}>
              {busy ? "등록 중…" : "등록하고 심사 요청"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 비로그인 — 표지/인증 스플릿
  return (
    <div className="adv-hero">
      <div className="adv-cover">
        <div>
          <div className="adv-cover-label">OwnerView Partners</div>
          <h1 className="adv-cover-title">고객사의 장부가,<br />펼치면 바로 보입니다</h1>
          <p className="adv-cover-desc">
            오너뷰 파트너 포털은 제휴 세무사·회계사 전용 열람 공간입니다.
            고객사가 오너뷰에 쌓아 둔 금융 기록을 신고 업무 기준으로 정리해 보여드립니다.
          </p>
          <div className="adv-cover-rule" />
          <div className="adv-cover-points">
            {COVER_POINTS.map((p, i) => (
              <div key={i} className="adv-cover-point">
                <span className="adv-cover-point-no">{String(i + 1).padStart(2, "0")}</span>
                <span>{p}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="adv-cover-foot">
          제휴 문의 · creative@mo-tive.com — 가입 후 오너뷰 운영팀의 확인을 거쳐 고객사가 연결됩니다.
        </div>
      </div>
      <div className="adv-auth-side">
        <div className="adv-auth-card">
          <div className="adv-auth-title">{mode === "login" ? "파트너 로그인" : "파트너 가입"}</div>
          <p className="adv-auth-desc">
            {mode === "login" ? "세무사·회계사 전용 계정으로 로그인하세요." : "업무용 이메일로 가입해 주세요."}
          </p>
          <label className="adv-field">
            <span className="adv-field-label">이메일</span>
            <input className="adv-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="tax@office.co.kr" onKeyDown={(e) => e.key === "Enter" && submitAuth()} />
          </label>
          <label className="adv-field">
            <span className="adv-field-label">비밀번호</span>
            <input className="adv-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="8자 이상" onKeyDown={(e) => e.key === "Enter" && submitAuth()} />
          </label>
          {error && <div className="adv-form-error">{error}</div>}
          {note && <div className="adv-form-note">{note}</div>}
          <button className="adv-btn-primary" onClick={submitAuth} disabled={busy || !email.trim() || pw.length < 8}>
            {busy ? "확인 중…" : mode === "login" ? "로그인" : "가입하기"}
          </button>
          <div className="adv-auth-switch">
            {mode === "login" ? (
              <>처음이신가요? <button onClick={() => { setMode("signup"); setError(""); }}>파트너 가입</button></>
            ) : (
              <>이미 계정이 있으신가요? <button onClick={() => { setMode("login"); setError(""); }}>로그인</button></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Topbar({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="adv-topbar">
      <div className="adv-topbar-inner">
        <div className="adv-brand">
          <span className="adv-brand-mark">오너뷰</span>
          <span className="adv-brand-sub">Partners</span>
        </div>
        <div className="adv-topbar-user">
          <button className="adv-topbar-btn" onClick={onLogout}>로그아웃</button>
        </div>
      </div>
    </header>
  );
}
