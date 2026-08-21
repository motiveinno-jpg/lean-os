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
import { useModalKeys } from "@/hooks/use-modal-keys";
import { friendlyError } from "@/lib/friendly-error";
import { appConfirm } from "@/components/global-confirm";
import {
  API_PROVIDERS, KEY_STATUS_LABEL, LINKED_STATUS_LABEL,
  listApiKeys, saveApiKey, deleteApiKey, testApiKey, retestApiKey, loadLinkedIntegrations,
  type ApiProvider, type LinkedIntegration,
} from "@/lib/api-keys";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

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
  const { data: linked = [] } = useQuery({
    queryKey: ["company-linked-integrations", companyId],
    queryFn: () => loadLinkedIntegrations(companyId),
    enabled: !!companyId,
  });

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
        오너뷰가 바깥과 주고받는 것을 한 곳에 모았습니다. 인증키는 <b>회사 이름으로 발급받아</b> 넣고,
        넣는 순간 암호화되어 화면에는 다시 나오지 않습니다.
      </p>

      {isLoading ? (
        <div className="collect-empty">불러오는 중…</div>
      ) : (
        <div className="apik-list">
          {/* 다른 탭에서 붙이는 연동 — 상태만 보고, 손보는 것은 그 탭에서 */}
          {linked.map((it) => <LinkedRow key={it.key} item={it} />)}

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

      {editing && (
        <KeyDialog provider={editing} companyId={companyId} userId={userId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }} />
      )}
    </div>
  );
}

/**
 * 다른 탭에서 붙이는 연동 한 줄 — 여기서는 **상태만** 보여주고 손보러는 그 탭으로 보낸다.
 *   키를 여기서 받지 않는 이유: 은행은 공동인증서, 광고는 매체별 ID·비밀키라 입력 방식이 전혀 다르다.
 *   한 화면에 다 욱여넣으면 오히려 못 찾는다 — "무엇이 연결됐나" 만 모은다.
 */
function LinkedRow({ item }: { item: LinkedIntegration }) {
  return (
    <div className="apik-row">
      <div className="apik-main">
        <div className="apik-head">
          <b>{item.label}</b>
          <span className={`apik-pill apik-pill-${item.status === "ok" ? "ok" : item.status === "none" ? "none" : item.status === "partial" ? "pending" : "error"}`}>
            {LINKED_STATUS_LABEL[item.status]}
          </span>
        </div>
        <p className="apik-gives">{item.gives}</p>
        <p className="apik-meta">{item.detail}</p>
      </div>
      <div className="apik-acts">
        <Link href={item.href} className="btn-secondary btn-sm">
          {item.status === "none" ? "연결하기 →" : "관리 →"}
        </Link>
      </div>
    </div>
  );
}

/** 키 넣기 — 저장 전에 반드시 한 번 불러 본다 */
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
            저장하면 <b>실제로 한 번 불러 본 뒤</b> 성공했을 때만 등록합니다.
            등록한 키는 암호화되어 화면에 다시 나오지 않습니다.
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
