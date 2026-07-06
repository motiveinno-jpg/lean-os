"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { AccessDenied } from "@/components/access-denied";

function isPlatformOperator(email?: string | null): boolean {
  return !!email && /@mo-tive\.com$/i.test(email.trim());
}

type LookupResult = {
  found: boolean;
  user?: any;
  company?: any;
  auth?: any;
  candidates?: { id: string; email: string; name: string; role: string }[];
};

async function callEF(payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("인증 세션이 없습니다");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const res = await fetch(`${url}/functions/v1/operator-user-admin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.error) throw new Error(j?.error || `HTTP ${res.status}`);
  return j;
}

export default function OperatorUsersPage() {
  const { user, loading } = useUser();
  const { toast } = useToast();
  const isOperator = isPlatformOperator(user?.email);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [edit, setEdit] = useState({ name: "", email: "", role: "" });
  const [adminKey, setAdminKey] = useState("");
  const [saving, setSaving] = useState(false);
  // OP-A: 회원 조회 ↔ 계정 수정 탭 분리 + 에러 로그 동시 조회
  const [tab, setTab] = useState<"view" | "edit">("view");
  const [errors, setErrors] = useState<{ logs: any[]; stats: any } | null>(null);
  const [errLoading, setErrLoading] = useState(false);

  if (loading) return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  if (!isOperator) {
    return <AccessDenied title="서비스 운영자 전용 페이지" detail="사용자 관리는 OwnerView 운영자만 가능합니다." />;
  }

  const doLookup = async (q?: string) => {
    const term = (q ?? query).trim();
    if (!term) return;
    setSearching(true);
    setResult(null);
    setErrors(null);
    try {
      const r = await callEF({ mode: "lookup", query: term });
      setResult(r);
      if (r.found) {
        setEdit({ name: r.user.name || "", email: r.user.email || "", role: r.user.role || "" });
        // 에러 로그 병행 조회 (실패해도 메인 흐름 영향 없음)
        if (r.user.email) {
          setErrLoading(true);
          try {
            const e = await callEF({ mode: "errors", email: r.user.email });
            setErrors(e);
          } catch (err) {
            // EF 배포 누락 등은 조용히 실패 — 메인 정보는 정상
            console.warn("errors lookup failed", err);
          }
          setErrLoading(false);
        }
      }
    } catch (e: any) {
      toast("조회 실패: " + (e?.message || ""), "error");
    }
    setSearching(false);
  };

  const doSave = async () => {
    if (!result?.user) return;
    if (!adminKey.trim()) { toast("관리자 키를 입력하세요.", "error"); return; }
    setSaving(true);
    try {
      const r = await callEF({
        mode: "update",
        adminKey: adminKey.trim(),
        userId: result.user.id,
        updates: { name: edit.name, email: edit.email, role: edit.role },
      });
      toast("계정 정보가 수정되었습니다.", "success");
      setResult({ ...result, user: r.after });
      setAdminKey("");
    } catch (e: any) {
      toast("수정 실패: " + (e?.message || ""), "error");
    }
    setSaving(false);
  };

  const u = result?.user;
  const dirty = u && (edit.name !== (u.name || "") || edit.email !== (u.email || "") || edit.role !== (u.role || ""));

  return (
    <div className="bg-[var(--bg)] text-[var(--text)] -mx-6 -my-6 px-6 py-6 min-h-screen rounded-none">
      {/* 툴바 — 탭(좌) + 검색(우) */}
      <div className="page-sticky-header mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="seg-bar">
            {[
              { k: "view" as const, label: "회원 조회" },
              { k: "edit" as const, label: "계정 수정" },
            ].map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`seg-item ${tab === t.k ? "seg-item-active" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-1 sm:flex-none sm:min-w-[340px]">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doLookup(); }}
              placeholder="user@example.com 또는 계정 UUID"
              className="flex-1 px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            />
            <button
              onClick={() => doLookup()}
              disabled={searching || !query.trim()}
              className="btn-primary px-5"
            >
              {searching ? "조회 중..." : "조회"}
            </button>
          </div>
        </div>
      </div>

      {/* 후보 목록 */}
      {result && !result.found && (
        <div className="glass-card p-5">
          {result.candidates && result.candidates.length > 0 ? (
            <>
              <div className="text-xs text-[var(--text-muted)] mb-2">정확히 일치하는 계정이 없습니다. 유사 계정:</div>
              <div className="space-y-1">
                {result.candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setQuery(c.email); doLookup(c.email); }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition text-sm"
                  >
                    <span className="font-medium">{c.email}</span>
                    <span className="text-[var(--text-dim)] ml-2 text-xs">{c.name || "-"} · {c.role}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-[var(--text-muted)] text-center py-4">일치하는 계정이 없습니다.</div>
          )}
        </div>
      )}

      {/* 계정 정보 + 수정 — 탭별 분리 */}
      {result?.found && u && (
        <div className="space-y-4">
          {/* 회원 조회 탭 */}
          {tab === "view" && (
            <>
              <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold">계정 정보</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Info label="이름" value={u.name || "-"} />
                  <Info label="이메일" value={u.email || "-"} />
                  <Info label="역할" value={u.role || "-"} />
                  <Info label="계정 ID" value={u.id} mono />
                  <Info label="auth_id" value={u.auth_id || "-"} mono />
                  <Info label="회사" value={result.company?.name || "-"} />
                  <Info label="회사 사업자번호" value={result.company?.business_number || "-"} />
                  <Info label="회사 대표자" value={result.company?.representative || "-"} />
                  <Info label="가입일" value={u.created_at ? new Date(u.created_at).toLocaleString("ko-KR") : "-"} />
                  <Info label="마지막 로그인" value={result.auth?.last_sign_in_at ? new Date(result.auth.last_sign_in_at).toLocaleString("ko-KR") : "-"} />
                  <Info label="auth 가입일" value={result.auth?.created_at ? new Date(result.auth.created_at).toLocaleString("ko-KR") : "-"} />
                  <Info label="이메일 인증" value={result.auth?.email_confirmed_at ? `완료 (${new Date(result.auth.email_confirmed_at).toLocaleString("ko-KR")})` : "미완료"} />
                  {result.auth?.banned_until && (
                    <Info label="🚫 정지 상태" value={`정지됨 (해제: ${new Date(result.auth.banned_until).toLocaleString("ko-KR")})`} />
                  )}
                </div>
              </div>

              {/* 에러 발생 이력 */}
              <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h3 className="text-sm font-bold">에러 발생 이력</h3>
                  {errors?.stats && (
                    <div className="text-[11px] text-[var(--text-dim)]">
                      총 <span className="text-[var(--text)] font-semibold">{errors.stats.total}</span>건 ·
                      미해결 <span className="text-[var(--danger)] font-semibold">{errors.stats.unresolved}</span>건 ·
                      7일 <span className="text-[var(--warning)] font-semibold">{errors.stats.last_7d}</span>건 ·
                      30일 <span className="text-[var(--text-muted)] font-semibold">{errors.stats.last_30d}</span>건
                    </div>
                  )}
                </div>
                {errLoading ? (
                  <div className="text-center py-6 text-sm text-[var(--text-muted)]">에러 로그 조회 중...</div>
                ) : !errors || errors.logs.length === 0 ? (
                  <div className="text-center py-6 text-sm text-[var(--text-muted)]">
                    🎉 이 회원이 일으킨 에러가 없습니다
                  </div>
                ) : (
                  <>
                    {Object.keys(errors.stats?.by_type || {}).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {Object.entries(errors.stats.by_type)
                          .sort((a, b) => (b[1] as number) - (a[1] as number))
                          .slice(0, 6)
                          .map(([t, c]) => (
                            <span key={t} className="text-[10px] px-2 py-1 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">
                              {t} · <b className="text-[var(--text)]">{c as number}</b>
                            </span>
                          ))}
                      </div>
                    )}
                    <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
                      {errors.logs.slice(0, 20).map((l: any) => (
                        <div key={l.id} className={`rounded-lg border px-3 py-2 ${l.resolved ? "border-[var(--border)] opacity-60" : "border-red-500/30 bg-red-500/5"}`}>
                          <div className="flex items-center gap-2 mb-1 text-[11px] flex-wrap">
                            <span className="font-semibold text-[var(--text)]">{l.error_type || "unknown"}</span>
                            <span className="text-[var(--text-dim)]">·</span>
                            <span className="text-[var(--text-muted)]">{l.source || "-"}</span>
                            <span className="text-[var(--text-dim)]">·</span>
                            <span className="text-[var(--text-dim)]">{new Date(l.created_at).toLocaleString("ko-KR")}</span>
                            {l.resolved && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--success-dim)] text-[var(--success)]">해결됨</span>}
                          </div>
                          <div className="text-xs text-[var(--text-muted)] truncate" title={l.message}>{l.message}</div>
                          {(l.url || l.context?.action || l.context?.page) && (
                            <div className="text-[10px] text-[var(--text-dim)] mt-1 truncate">
                              {l.context?.action && <span>🛠 {String(l.context.action)} </span>}
                              {(l.context?.page || l.url) && (
                                <span>📄 {l.context?.page || (() => { try { return new URL(l.url).pathname; } catch { return l.url; } })()}</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {errors.logs.length > 20 && (
                      <div className="text-[11px] text-[var(--text-dim)] mt-2 text-center">
                        · 최근 50건 중 20건 표시. 전체는 /error-logs 에서 사용자 필터.
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {/* 계정 수정 탭 */}
          {tab === "edit" && (
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-[var(--primary)]">정보 수정</h3>
              </div>
              <div className="space-y-3">
                <Field label="이름">
                  <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
                </Field>
                <Field label="이메일">
                  <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
                </Field>
                <Field label="역할">
                  <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
                    {["owner", "admin", "employee", "partner"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
                <div className="border-t border-[var(--border)] pt-3">
                  <Field label="관리자 키 (수정 시 필수)">
                    <input
                      type="password"
                      value={adminKey}
                      onChange={(e) => setAdminKey(e.target.value)}
                      placeholder="OPERATOR_ADMIN_KEY"
                      className="w-full px-3 py-2 bg-[var(--bg)] border border-amber-500/30 rounded-lg text-sm focus:outline-none focus:border-amber-500"
                    />
                  </Field>
                </div>
                <button
                  onClick={doSave}
                  disabled={saving || !dirty || !adminKey.trim()}
                  className="btn-primary w-full"
                >
                  {saving ? "저장 중..." : dirty ? "변경사항 저장" : "변경된 항목 없음"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-[var(--text-dim)] uppercase">{label}</div>
      <div className={`text-sm text-[var(--text)] truncate ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-[var(--text-muted)] mb-1">{label}</label>
      {children}
    </div>
  );
}
