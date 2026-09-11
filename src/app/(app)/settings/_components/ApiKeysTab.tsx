"use client";

// 연동 · API 키 — 회사가 직접 발급받은 인증키를 여기 한 번 등록한다 (2026-08-21 사장님 지시)
//
// ★ 화면의 주인공은 입력칸이 아니라 **연결 상태**다.
//   사람이 여기 오는 이유는 키를 넣으려고가 아니라 "왜 안 되지?" 를 보려고다.
// ★ 키는 저장하는 순간 암호화되고 **다시는 화면으로 내려오지 않는다.** 앞뒤 몇 글자만 남는다.
// ★ 저장 전에 실제로 한 번 호출해 본다 — 틀린 키를 저장해 두면 "왜 안 되지"가 그대로 남는다.

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { useMyPermissions } from "@/lib/permissions";
import { useUser } from "@/components/user-context";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { friendlyError } from "@/lib/friendly-error";
import { appConfirm } from "@/components/global-confirm";
import { AdAccountsTab } from "./AdAccountsTab";
import { supabase } from "@/lib/supabase";
import {
  API_PROVIDERS, KEY_STATUS_LABEL,
  listApiKeys, saveApiKey, deleteApiKey, testApiKey, retestApiKey,
  type ApiProvider,
} from "@/lib/api-keys";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;


// 외부 자동화(n8n 등) 인입 키 · 회사별 비밀키. 발급 즉시 한 번만 보이고, 다시 발급하면 이전 키는 즉시 막힌다.
function IngestKeyCard({ companyId }: { companyId: string }) {
  //   인입 키는 DB 가 대표·관리자만 받는다(company_ingest_keys 정책 + rotate_ingest_key).
  //   탭은 /settings:api-keys·/settings:ads 로 열려, 위임받은 사람 눈에는 목록이 빈 채로 '발급' 버튼만
  //   활성으로 보이고 누르면 권한 오류만 났다 (2026-09-11). 할 수 없는 일은 버튼으로 보여 주지 않는다.
  const { isMaster } = useMyPermissions();
  const { user: meUser } = useUser();
  const canIssue = isMaster || ["owner", "admin"].includes(String((meUser as any)?.role || ""));
  const { toast } = useToast();
  const qc = useQueryClient();
  const [issued, setIssued] = useState<string | null>(null);
  const { data: keys = [] } = useQuery({
    queryKey: ["ingest-keys", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("company_ingest_keys").select("id, key_hint, created_at, revoked_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(5);
      return (data || []) as { id: string; key_hint: string; created_at: string; revoked_at: string | null }[];
    },
    enabled: !!companyId,
  });
  const active = keys.find((k) => !k.revoked_at);
  const rotate = async () => {
    const yes = await appConfirm(active ? "새 키를 발급하면 지금 쓰는 키는 바로 막힙니다. 자동화 도구의 키도 함께 바꿔야 합니다." : "외부 자동화가 통장·계산서·급여 배치를 밀어 넣을 때 쓰는 비밀키를 발급합니다.", { title: active ? "인입 키를 다시 발급할까요?" : "인입 키를 발급할까요?", confirmLabel: "발급" });
    if (!yes) return;
    const { data, error } = await (supabase as any).rpc("rotate_ingest_key");
    if (error) { toast(friendlyError(error, "발급하지 못했습니다"), "error"); return; }
    setIssued(String(data));
    qc.invalidateQueries({ queryKey: ["ingest-keys", companyId] });
  };
  return (
    <div className="apik-section">
      <div className="apik-main">
        <div className="apik-head"><b>외부 자동화 인입 키</b></div>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          외부 자동화가 <code>x-api-key</code> 헤더에 넣는 회사 전용 비밀키입니다.
          {active ? <> 현재 키 끝자리 <b>…{active.key_hint}</b>, {new Date(active.created_at).toLocaleDateString("ko-KR")} 발급.</> : " 아직 발급하지 않았습니다."}
        </p>
        {issued && (
          <div className="mt-2 p-3 rounded-lg bg-[var(--warning-dim)] text-xs">
            <div className="font-bold mb-1">지금 한 번만 표시됩니다. 복사해 두세요.</div>
            <code className="break-all select-all">{issued}</code>
          </div>
        )}
      </div>
      <div className="apik-acts">
        {canIssue
          ? <button type="button" className="btn-secondary btn-sm" onClick={rotate}>{active ? "다시 발급" : "발급"}</button>
          : <span className="text-[11px] text-[var(--text-dim)]">대표·관리자만 발급할 수 있습니다</span>}
      </div>
    </div>
  );
}

export function ApiKeysTab({ companyId, userId }: { companyId: string; userId: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<ApiProvider | null>(null);
  const [guide, setGuide] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["company-api-keys", companyId],
    queryFn: () => listApiKeys(companyId),
    enabled: !!companyId,
  });

  //   다른 탭에서 붙이는 연동(은행·카드·홈택스·광고)의 상태 — 손보러는 그 탭으로 보낸다.
  //   "무엇이 연결됐나" 는 한 곳에서 봐야 한다 (2026-08-21 사장님 지적).

  const byProvider = new Map(keys.map((k) => [k.provider, k]));
  const invalidate = () => qc.invalidateQueries({ queryKey: ["company-api-keys", companyId] });

  const retest = async (p: ApiProvider) => {
    setBusy(p.key);
    try {
      const r = await retestApiKey(p.key);
      invalidate();
      toast(r.ok ? r.message || "연결됐습니다" : r.message, r.ok ? "success" : "error");
    } catch (e) {
      toast(friendlyError(e, "확인하지 못했습니다"), "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (p: ApiProvider) => {
    const yes = await appConfirm(
      "지우면 다시 볼 수 없습니다. 계속하려면 키를 새로 넣어야 합니다.",
      { title: `${p.label} 인증키를 지울까요?`, confirmLabel: "지우기", danger: true },
    );
    if (!yes) return;
    try {
      await deleteApiKey(companyId, p.key);
      invalidate();
      toast("인증키를 지웠습니다", "success");
    } catch (e) {
      toast(friendlyError(e, "지우지 못했습니다"), "error");
    }
  };

  return (
    <div className="apik-wrap">
      <p className="apik-intro">
        광고 매체·쇼핑몰·공공기관에서 <b>회사 이름으로 발급받은 키</b>를 등록합니다.
        은행·카드·홈택스는 <Link href="/settings/integration?tab=bank" className="apik-link">은행연동</Link> 탭에서 연결합니다.
      </p>

      {isLoading ? (
        <div className="collect-empty">불러오는 중…</div>
      ) : (
        <div className="apik-list">
          {/*   ★ 2026-08-24 사장님 지시로 **은행·홈택스·광고 줄을 여기서 뺐다.**
                8-21 에는 "연결 현황을 한 목록으로 모으라"였는데, 막상 쓰니 같은 것이 두 탭에 나와
                "여기서 하는 건가, 저기서 하는 건가"로 헷갈렸다("사용자가 헷갈려").
                → **탭은 자기 것만 한다**: 이 탭은 인증키를 여기서 받는 것만(등록 + 목록).
                  "무엇이 연결됐나"는 버리지 않고 **탭 줄 배지**로 옮겼다(SettingsShell bandStatus) —
                  탭 줄 자체가 연결 현황판이 되어 조망은 남고 중복만 사라진다. */}
          {API_PROVIDERS.map((p) => {
            const row = byProvider.get(p.key);
            const status = row?.status ?? "none";
            return (
              <div key={p.key} className="apik-row">
                <div className="apik-main">
                  <div className="apik-head">
                    <b>{p.label}</b>
                    <span className={`apik-pill apik-pill-${status}`}>
                      {status === "none" ? "키 없음" : KEY_STATUS_LABEL[status]}
                    </span>
                    {row?.key_hint && <span className="apik-hint">{row.key_hint}</span>}
                  </div>
                  <p className="apik-gives">{p.gives}</p>
                  {row?.status === "error" && row.last_error && (
                    <p className="apik-err">{row.last_error}</p>
                  )}
                  <p className="apik-meta">
                    {row?.last_tested_at ? `마지막 확인 ${fmt(row.last_tested_at)}` : "아직 확인하지 않았습니다"}
                    {" · "}
                    <Link href={p.usedBy.href} className="apik-link">{p.usedBy.label}에서 씁니다 →</Link>
                  </p>
                </div>

                <div className="apik-acts">
                  <button type="button" className="btn-secondary btn-sm"
                    onClick={() => setGuide(guide === p.key ? null : p.key)}>발급 안내</button>
                  {row ? (
                    <>
                      <button type="button" className="btn-secondary btn-sm" disabled={busy === p.key}
                        onClick={() => retest(p)}>{busy === p.key ? "확인 중…" : "연결 테스트"}</button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(p)}>키 바꾸기</button>
                      <button type="button" className="apik-del" onClick={() => remove(p)}>지우기</button>
                    </>
                  ) : (
                    <button type="button" className="btn-primary btn-sm" onClick={() => setEditing(p)}>키 넣기</button>
                  )}
                </div>

                {guide === p.key && (
                  <div className="apik-guide">
                    <div className="apik-guide-h">
                      <b>{p.issuer}에서 받습니다</b>
                      <a href={p.issueUrl} target="_blank" rel="noreferrer noopener" className="btn-secondary btn-sm">
                        발급 사이트 열기 ↗
                      </a>
                    </div>
                    <ol className="apik-steps">
                      {p.steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                    {p.caution && <p className="apik-caution">⚠️ {p.caution}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/*   광고 계정 — 2026-08-24 별도 탭에서 여기로 합쳤다(사장님: "광고 계정도 API인데 앞에 API 탭이랑
            다른 것도 사용자가 혼동될 수가 있음"). 매체에서 받은 키를 넣는 일이라 성격이 같다.
            다만 **계정마다 여러 개**(대행이면 클라이언트별)라 목록·등록은 자기 부품이 그대로 그린다. */}
      <div className="apik-section">
        <AdAccountsTab companyId={companyId} />
      </div>

      {editing && (
        <KeyDialog provider={editing} companyId={companyId} userId={userId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }} />
      )}
      <IngestKeyCard companyId={companyId} />
    </div>
  );
}



/** 키 넣기 · 저장 전에 반드시 한 번 불러 본다 */
function KeyDialog({ provider, companyId, userId, onClose, onSaved }: {
  provider: ApiProvider; companyId: string; userId: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useModalKeys(true, onClose);

  const run = async () => {
    const v = key.trim();
    if (!v) { toast("인증키를 넣어 주세요", "error"); return; }
    setBusy(true);
    setResult(null);
    try {
      const r = await testApiKey(provider.key, v);
      setResult(r);
      if (!r.ok) return;                 // 실패면 저장하지 않는다 — 사람이 키를 고칠 기회를 준다
      await saveApiKey(companyId, userId, provider.key, v, r);
      toast("인증키를 저장했습니다", "success");
      onSaved();
    } catch (e) {
      toast(friendlyError(e, "저장하지 못했습니다"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sp-modal" role="dialog" aria-label={`${provider.label} 인증키`}>
        <div className="sp-modal-head">
          <div>
            <b className="sp-modal-title">{provider.label}</b>
            <p className="sp-modal-desc">{provider.issuer}에서 발급받은 인증키를 붙여넣으세요.</p>
          </div>
          <a href={provider.issueUrl} target="_blank" rel="noreferrer noopener" className="btn-secondary btn-sm">
            발급 사이트 ↗
          </a>
        </div>

        <div className="sp-modal-body">
          <label className="apik-field">
            <span>인증키</span>
            <input type={reveal ? "text" : "password"} className="field-input" autoComplete="off"
              value={key} onChange={(e) => { setKey(e.target.value); setResult(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); run(); } }}
              placeholder="발급받은 인증키를 그대로 붙여넣으세요" />
          </label>
          <label className="apik-reveal">
            <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
            붙여넣은 값 보기
          </label>

          {result && (
            <p className={result.ok ? "apik-result apik-result-ok" : "apik-result apik-result-bad"}>
              {result.message}
            </p>
          )}

          <div className="apik-guide apik-guide-modal">
            <div className="apik-guide-h"><b>받는 방법</b></div>
            <ol className="apik-steps">
              {provider.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            {provider.caution && <p className="apik-caution">⚠️ {provider.caution}</p>}
          </div>

          <p className="apik-note">
            <b>연결을 확인한 뒤</b> 저장하며, 키는 다시 표시하지 않습니다.
          </p>
        </div>

        <div className="sp-modal-foot">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={run}>
            {busy ? "확인 중…" : "확인하고 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
