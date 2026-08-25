"use client";

// 광고 계정 연동 — 회사가 쓰는 광고 계정을 여기 한 번만 등록하고, 프로젝트에서는 골라 쓴다
//   (2026-08-06 사장님 지시: "대행사면 클라이언트마다 광고계정을 등록할 수도 있다").
//
// ⚠️ 키는 저장하는 순간 DB 안에서 암호화되고, **다시는 화면으로 내려오지 않는다**.
//    (등록돼 있는지 여부만 보여 준다. 바꾸려면 새로 넣는다.)

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";

const db = supabase as any;

/** 지금 붙는 매체 — 검색광고부터. 나머지는 키 발급 절차가 끝나는 대로 연다 */
const PLATFORMS: { key: string; label: string; idLabel: string; idHint: string; ready: boolean }[] = [
  { key: "naver_sa", label: "네이버 검색광고", idLabel: "CUSTOMER ID", idHint: "검색광고 > 도구 > API 사용 관리에서 확인", ready: true },
  { key: "naver_gfa", label: "네이버 GFA(성과형 디스플레이)", idLabel: "고객 ID", idHint: "검색광고와 다른 키입니다", ready: false },
  { key: "google_ads", label: "구글 애즈", idLabel: "고객 ID", idHint: "개발자 토큰 승인 후", ready: false },
  { key: "meta_ads", label: "메타(페이스북·인스타)", idLabel: "광고계정 ID", idHint: "act_ 로 시작", ready: false },
];
const platformLabel = (k: string) => PLATFORMS.find((p) => p.key === k)?.label || k;

type AdAccount = {
  id: string; platform: string; label: string; external_id: string;
  status: string; last_synced_at: string | null; sync_error: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "확인 전", cls: "ad-acc-badge-wait" },
  connected: { label: "연결됨", cls: "ad-acc-badge-ok" },
  error: { label: "오류", cls: "ad-acc-badge-bad" },
  disabled: { label: "중지", cls: "ad-acc-badge-off" },
};

export function AdAccountsTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ platform: "naver_sa", label: "", externalId: "", apiKey: "", apiSecret: "" });
  const [reveal, setReveal] = useState(false);      // 붙여넣은 키가 맞는지 눈으로 확인할 때만
  const veilDown = useRef(false);                   // 누르기 시작한 자리가 배경이었는지
  const [syncing, setSyncing] = useState<string | null>(null);
  //   창을 열 때마다 빈 칸에서 시작한다 — 앞서 넣다 만 값이 남아 있으면 다른 계정에 잘못 들어간다
  const openForm = () => {
    setForm({ platform: "naver_sa", label: "", externalId: "", apiKey: "", apiSecret: "" });
    setReveal(false);
    setOpen(true);
  };

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["ad-accounts", companyId],
    queryFn: async () => {
      const data = logRead("AdAccountsTab:accounts", await db.from("ad_accounts")
        .select("id, platform, label, external_id, status, last_synced_at, sync_error")
        .order("created_at", { ascending: true }));
      return (data || []) as AdAccount[];
    },
    enabled: !!companyId,
  });

  const save = async () => {
    if (busy) return;
    if (!form.label.trim() || !form.externalId.trim() || !form.apiKey.trim() || !form.apiSecret.trim()) {
      toast("이름 · ID · API 키 · 비밀키를 모두 채워 주세요.", "error");
      return;
    }
    setBusy(true);
    try {
      const { error } = await db.rpc("ad_account_save", {
        p_id: null, p_platform: form.platform, p_label: form.label.trim(),
        p_external_id: form.externalId.trim(), p_api_key: form.apiKey.trim(), p_api_secret: form.apiSecret.trim(),
      });
      if (error) throw new Error(error.message);
      setForm({ platform: "naver_sa", label: "", externalId: "", apiKey: "", apiSecret: "" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["ad-accounts", companyId] });
      toast("광고 계정을 등록했습니다. '지금 가져오기'로 연결을 확인하세요.", "success");
    } catch (e: any) {
      toast(e?.message || "저장 실패", "error");
    } finally { setBusy(false); }
  };

  //   실제로 불러 봐야 키가 맞는지 안다 — 연결 확인과 첫 수집을 같은 단추로 한다
  const syncNow = async (acc: AdAccount) => {
    if (syncing) return;
    setSyncing(acc.id);
    try {
      const { data, error } = await supabase.functions.invoke("ads-sync", { body: { accountId: acc.id } });
      if (error) throw new Error(error.message);
      const r = (data as any)?.results?.[0];
      qc.invalidateQueries({ queryKey: ["ad-accounts", companyId] });
      if (r?.ok) toast(`${acc.label} — 캠페인 ${r.campaigns}개, 최근 3일치 ${r.rows}줄을 가져왔습니다.`, "success");
      else toast(r?.error || "가져오지 못했습니다.", "error");
    } catch (e: any) {
      toast(e?.message || "가져오기 실패", "error");
    } finally { setSyncing(null); }
  };

  const remove = async (acc: AdAccount) => {
    if (!window.confirm(`'${acc.label}' 연결을 지울까요? 이미 가져온 성과 기록도 함께 지워집니다.`)) return;
    const { error } = await db.from("ad_accounts").delete().eq("id", acc.id);
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["ad-accounts", companyId] });
    toast("지웠습니다.", "success");
  };

  const picked = PLATFORMS.find((p) => p.key === form.platform)!;

  return (
    <div className="ad-acc-wrap">
      {/*   상자 안 상자 금지 (2026-08-24 정리) — 줄들이 탭 바닥 위에 바로 놓인다.
            옆 탭(연동·API 키)이 이미 그 모양이라 셋이 같은 결로 읽힌다. */}
      <div className="ad-acc-head">
        <div>
          <h3 className="ad-acc-title">광고 계정</h3>
          <p className="ad-acc-desc">
            여기 한 번 등록하면 프로젝트마다 골라 씁니다. 대행이라 클라이언트별 계정이 여럿이면 여러 개 등록하세요.
            <b> API 키는 저장 즉시 암호화되고 다시 화면에 나오지 않습니다.</b>
          </p>
        </div>
        <button type="button" className="btn-primary btn-sm ml-auto shrink-0" onClick={openForm}>＋ 계정 등록</button>
      </div>

      {isLoading ? <p className="ad-acc-empty">불러오는 중…</p>
        : accounts.length === 0 ? (
          <p className="ad-acc-empty">아직 등록한 광고 계정이 없습니다. 네이버 검색광고부터 붙여 보세요.</p>
        ) : (
          <div className="ad-acc-list">
            {accounts.map((a) => (
              <div key={a.id} className="ad-acc-card">
                <div className="ad-acc-card-main">
                  <span className="ad-acc-name">{a.label}</span>
                  <span className="ad-acc-meta">{platformLabel(a.platform)} · {a.external_id}</span>
                  {a.sync_error && <span className="ad-acc-err">{a.sync_error}</span>}
                  {a.last_synced_at && !a.sync_error && (
                    <span className="ad-acc-meta">마지막 수집 {String(a.last_synced_at).slice(0, 16).replace("T", " ")}</span>
                  )}
                </div>
                <span className={`ad-acc-badge ${STATUS[a.status]?.cls || ""}`}>{STATUS[a.status]?.label || a.status}</span>
                <button type="button" className="ad-acc-sync" disabled={syncing === a.id} onClick={() => syncNow(a)}>
                  {syncing === a.id ? "가져오는 중…" : "지금 가져오기"}
                </button>
                <button type="button" className="ad-acc-del" onClick={() => remove(a)}>삭제</button>
              </div>
            ))}
          </div>
        )}

      {open && (
        //   ⚠️ 배경을 '눌렀을 때'가 아니라 '누른 자리가 배경일 때'만 닫는다 — 입력칸 안에서 글자를
        //   끌어 고르다 바깥에서 손을 떼면 브라우저가 그 클릭을 배경 것으로 쳐서 창이 닫혔다
        //   (2026-08-06 사장님 제보).
        <div className="ad-acc-modal"
          onMouseDown={(e) => { veilDown.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (veilDown.current && e.target === e.currentTarget) setOpen(false); }}>
          <div className="ad-acc-box">
            <b className="ad-acc-box-h">광고 계정 등록</b>
            <label className="ad-acc-field">
              <span>매체</span>
              <select value={form.platform} onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}>
                {PLATFORMS.map((p) => (
                  <option key={p.key} value={p.key} disabled={!p.ready}>
                    {p.label}{p.ready ? "" : " — 준비 중"}
                  </option>
                ))}
              </select>
            </label>
            {/* ⚠️ type="password" 로 두면 브라우저가 '로그인 양식'으로 보고 저장해 둔 아이디·비밀번호를
                자동으로 채워 넣는다(2026-08-06 사장님 제보: 커스터머ID·API 가 저절로 차 있었다).
                API 키가 브라우저 비밀번호 관리자에 저장되는 것 자체가 바람직하지 않아,
                일반 입력칸으로 두고 글자만 가린다(보기 단추로 확인 가능). */}
            <label className="ad-acc-field">
              <span>이름</span>
              <input value={form.label} autoComplete="off" data-1p-ignore data-lpignore="true"
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="우리 회사 / A 클라이언트처럼 알아볼 이름" />
            </label>
            <label className="ad-acc-field">
              <span>{picked.idLabel}</span>
              <input value={form.externalId} autoComplete="off" data-1p-ignore data-lpignore="true" inputMode="numeric"
                onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))}
                placeholder={picked.idHint} />
            </label>
            <label className="ad-acc-field">
              <span>API 키 <em className="ad-acc-hint">액세스 라이선스</em></span>
              <input value={form.apiKey} autoComplete="off" data-1p-ignore data-lpignore="true" spellCheck={false}
                className={reveal ? "" : "ad-acc-secret"}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value.trim() }))} placeholder="0100000000…" />
            </label>
            <label className="ad-acc-field">
              <span>비밀키 <em className="ad-acc-hint">시크릿 키 — API 키와 헷갈리기 쉽습니다</em></span>
              <input value={form.apiSecret} autoComplete="off" data-1p-ignore data-lpignore="true" spellCheck={false}
                className={reveal ? "" : "ad-acc-secret"}
                onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value.trim() }))} placeholder="0100000000…" />
            </label>
            <button type="button" className="ad-acc-reveal" onClick={() => setReveal((v) => !v)}>
              {reveal ? "키 가리기" : "붙여넣은 키 확인하기"}
            </button>
            <p className="ad-acc-note">
              넣은 키는 암호화해 보관하고 서버(수집 함수)에서만 풉니다. 화면·기록 어디에도 평문으로 남지 않고,
              브라우저에도 저장되지 않습니다.
            </p>
            <span className="ad-acc-foot">
              <button type="button" onClick={() => setOpen(false)}>취소</button>
              <button type="button" className="ad-acc-go" disabled={busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
