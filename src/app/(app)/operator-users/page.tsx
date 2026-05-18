"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

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

  if (loading) return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  if (!isOperator) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-[var(--text-muted)]">
        <div className="text-center">
          <p className="text-lg font-medium">접근 권한이 없습니다</p>
          <p className="text-sm mt-1">서비스 운영자 전용 페이지입니다.</p>
        </div>
      </div>
    );
  }

  const doLookup = async (q?: string) => {
    const term = (q ?? query).trim();
    if (!term) return;
    setSearching(true);
    setResult(null);
    try {
      const r = await callEF({ mode: "lookup", query: term });
      setResult(r);
      if (r.found) {
        setEdit({ name: r.user.name || "", email: r.user.email || "", role: r.user.role || "" });
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
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold">유저 계정 관리</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          이메일 또는 계정 ID 로 조회 후 정보 확인·수정 (수정 시 관리자 키 필요)
        </p>
      </div>

      {/* 검색 */}
      <div className="flex gap-2 mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") doLookup(); }}
          placeholder="user@example.com 또는 계정 UUID"
          className="flex-1 px-3 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
        />
        <button
          onClick={() => doLookup()}
          disabled={searching || !query.trim()}
          className="px-5 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-[var(--primary-hover)] transition"
        >
          {searching ? "조회 중..." : "조회"}
        </button>
      </div>

      {/* 후보 목록 */}
      {result && !result.found && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
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

      {/* 계정 정보 + 수정 */}
      {result?.found && u && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
            <div className="text-xs font-bold text-[var(--text-muted)] uppercase mb-3">계정 정보</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="계정 ID" value={u.id} mono />
              <Info label="auth_id" value={u.auth_id || "-"} mono />
              <Info label="회사" value={result.company?.name || u.company_id || "-"} />
              <Info label="가입일" value={u.created_at ? new Date(u.created_at).toLocaleString("ko-KR") : "-"} />
              <Info label="마지막 로그인" value={result.auth?.last_sign_in_at ? new Date(result.auth.last_sign_in_at).toLocaleString("ko-KR") : "-"} />
              <Info label="이메일 인증" value={result.auth?.email_confirmed_at ? "완료" : "미완료"} />
            </div>
          </div>

          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--primary)]/20 p-5">
            <div className="text-xs font-bold text-[var(--primary)] uppercase mb-3">정보 수정</div>
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
                className="w-full py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-[var(--primary-hover)] transition"
              >
                {saving ? "저장 중..." : dirty ? "변경사항 저장" : "변경된 항목 없음"}
              </button>
            </div>
          </div>
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
