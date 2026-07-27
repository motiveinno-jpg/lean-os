"use client";

// 운영자 — 영업사원 영업코드 발급 + 유입 회사 추적 (2026-07-27 가격정책).
//   코드를 입력하고 가입한 회사는 기본 체험 14일 + 보너스(기본 30일) = 44일.
//   데이터 접근은 RLS/RPC 로 운영자만 가능 — 이 화면은 그 위의 표시 계층이다.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import {
  listSalesCodes,
  listSalesCodeSignups,
  createSalesCode,
  setSalesCodeActive,
  normalizeSalesCode,
  SALES_CODE_PATTERN,
  type SalesCode,
  type SalesCodeSignup,
} from "@/lib/sales-codes";
import { kstDateStr } from "@/lib/kst";

const BASE_TRIAL_DAYS = 14;

function fmtDate(iso: string | null) {
  if (!iso) return "-";
  try { return kstDateStr(new Date(iso)); } catch { return "-"; }
}

const STATUS_LABEL: Record<string, string> = {
  trialing: "체험중", active: "결제중", past_due: "결제실패",
  canceled: "해지", paused: "일시정지",
};

export default function SalesCodesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"signups" | "codes">("signups");
  const [form, setForm] = useState({ code: "", ownerName: "", ownerEmail: "", ownerPhone: "", memo: "", bonusTrialDays: "30" });
  const [codeFilter, setCodeFilter] = useState("");

  const { data: codes = [], isLoading: codesLoading } = useQuery({
    queryKey: ["sales-codes"],
    queryFn: listSalesCodes,
  });
  const { data: signups = [], isLoading: signupsLoading } = useQuery({
    queryKey: ["sales-code-signups"],
    queryFn: listSalesCodeSignups,
  });

  const createMut = useMutation({
    mutationFn: () =>
      createSalesCode({
        code: form.code,
        ownerName: form.ownerName,
        ownerEmail: form.ownerEmail,
        ownerPhone: form.ownerPhone,
        memo: form.memo,
        bonusTrialDays: Math.max(0, Math.min(365, Number(form.bonusTrialDays) || 30)),
      }),
    onSuccess: () => {
      toast("영업코드를 발급했습니다.", "success");
      setForm({ code: "", ownerName: "", ownerEmail: "", ownerPhone: "", memo: "", bonusTrialDays: "30" });
      queryClient.invalidateQueries({ queryKey: ["sales-codes"] });
    },
    onError: (e: any) => toast(e?.message || "발급에 실패했습니다.", "error"),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setSalesCodeActive(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-codes"] });
      queryClient.invalidateQueries({ queryKey: ["sales-code-signups"] });
    },
    onError: (e: any) => toast(e?.message || "변경에 실패했습니다.", "error"),
  });

  // 코드별 집계 — 가입 수 / 유료 전환 수
  const statsByCode = useMemo(() => {
    const m = new Map<string, { signups: number; converted: number }>();
    (signups as SalesCodeSignup[]).forEach((s) => {
      const cur = m.get(s.code) || { signups: 0, converted: 0 };
      cur.signups += 1;
      if (s.converted_at) cur.converted += 1;
      m.set(s.code, cur);
    });
    return m;
  }, [signups]);

  const filteredSignups = useMemo(() => {
    const q = codeFilter.trim().toUpperCase();
    if (!q) return signups as SalesCodeSignup[];
    return (signups as SalesCodeSignup[]).filter(
      (s) => s.code.includes(q) || s.owner_name.toUpperCase().includes(q) || s.company_name.toUpperCase().includes(q),
    );
  }, [signups, codeFilter]);

  const canSubmit =
    SALES_CODE_PATTERN.test(normalizeSalesCode(form.code)) && form.ownerName.trim().length > 0 && !createMut.isPending;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">영업코드</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          영업사원별 코드를 발급하고, 그 코드로 가입한 회사를 추적합니다. 코드 입력 시 무료체험이 기본
          {" "}{BASE_TRIAL_DAYS}일 + 보너스일 만큼 늘어납니다.
        </p>
      </div>

      <div className="seg-bar w-fit">
        {([["signups", "유입 회사"], ["codes", "코드 관리"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`seg-item ${tab === k ? "seg-item-active" : ""}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "signups" && (
        <div className="glass-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h2 className="text-sm font-bold">어떤 영업코드로 어떤 회사가 가입했는지</h2>
            <input
              value={codeFilter}
              onChange={(e) => setCodeFilter(e.target.value)}
              placeholder="코드·영업사원·회사명 검색"
              className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm w-[260px] focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          {signupsLoading ? (
            <div className="py-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : filteredSignups.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--text-muted)]">
              아직 영업코드로 가입한 회사가 없습니다.
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="table-head-row">
                    <th className="th-cell text-left">영업코드</th>
                    <th className="th-cell text-left">영업사원</th>
                    <th className="th-cell text-left">회사</th>
                    <th className="th-cell text-left">사업자번호</th>
                    <th className="th-cell text-center">적용 체험일</th>
                    <th className="th-cell text-left">가입일</th>
                    <th className="th-cell text-center">구독상태</th>
                    <th className="th-cell text-left">유료전환일</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSignups.map((s) => (
                    <tr key={`${s.code}-${s.company_id}`} className="border-b border-[var(--border)]/50">
                      <td className="px-4 py-3 font-mono text-xs font-bold">{s.code}</td>
                      <td className="px-4 py-3">{s.owner_name}</td>
                      <td className="px-4 py-3 font-medium">{s.company_name}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)] mono-number">{s.business_number || "-"}</td>
                      <td className="px-4 py-3 text-center mono-number">{s.applied_trial_days ?? "-"}일</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{fmtDate(s.redeemed_at)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-surface)]">
                          {STATUS_LABEL[s.subscription_status || ""] || s.subscription_status || "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{fmtDate(s.converted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "codes" && (
        <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
          <div className="glass-card p-5">
            <h2 className="text-sm font-bold mb-4">코드 발급</h2>
            <div className="space-y-3">
              <Field label="영업코드">
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="예: KIM-01"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                />
                <div className="text-[11px] text-[var(--text-dim)] mt-1">영문 대문자·숫자·하이픈 4~24자</div>
              </Field>
              <Field label="영업사원 이름">
                <input
                  value={form.ownerName}
                  onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                />
              </Field>
              <Field label="이메일 (선택)">
                <input
                  value={form.ownerEmail}
                  onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                />
              </Field>
              <Field label="연락처 (선택)">
                <input
                  value={form.ownerPhone}
                  onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                />
              </Field>
              <Field label="보너스 체험일">
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={form.bonusTrialDays}
                  onChange={(e) => setForm({ ...form, bonusTrialDays: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                />
                <div className="text-[11px] text-[var(--text-dim)] mt-1">
                  기본 {BASE_TRIAL_DAYS}일 + {Number(form.bonusTrialDays) || 0}일 ={" "}
                  <b className="text-[var(--text)]">{BASE_TRIAL_DAYS + (Number(form.bonusTrialDays) || 0)}일</b>
                </div>
              </Field>
              <Field label="메모 (선택)">
                <input
                  value={form.memo}
                  onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                />
              </Field>
              <button onClick={() => createMut.mutate()} disabled={!canSubmit} className="btn-primary w-full">
                {createMut.isPending ? "발급 중..." : "코드 발급"}
              </button>
            </div>
          </div>

          <div className="glass-card p-5">
            <h2 className="text-sm font-bold mb-4">발급된 코드</h2>
            {codesLoading ? (
              <div className="py-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
            ) : codes.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--text-muted)]">발급된 코드가 없습니다.</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="table-head-row">
                      <th className="th-cell text-left">코드</th>
                      <th className="th-cell text-left">영업사원</th>
                      <th className="th-cell text-center">체험일</th>
                      <th className="th-cell text-center">가입</th>
                      <th className="th-cell text-center">전환</th>
                      <th className="th-cell text-center">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(codes as SalesCode[]).map((c) => {
                      const st = statsByCode.get(c.code) || { signups: 0, converted: 0 };
                      return (
                        <tr key={c.id} className="border-b border-[var(--border)]/50">
                          <td className="px-4 py-3 font-mono text-xs font-bold">{c.code}</td>
                          <td className="px-4 py-3">
                            {c.owner_name}
                            {c.owner_email && (
                              <div className="text-[11px] text-[var(--text-dim)]">{c.owner_email}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center mono-number">
                            {BASE_TRIAL_DAYS + c.bonus_trial_days}일
                          </td>
                          <td className="px-4 py-3 text-center mono-number">{st.signups}</td>
                          <td className="px-4 py-3 text-center mono-number">{st.converted}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => toggleMut.mutate({ id: c.id, active: !c.is_active })}
                              disabled={toggleMut.isPending}
                              className={`text-xs px-2.5 py-1 rounded-lg border transition ${
                                c.is_active
                                  ? "border-[var(--success)]/30 text-[var(--success)] bg-[var(--success-dim)]"
                                  : "border-[var(--border)] text-[var(--text-dim)]"
                              }`}
                              title={c.is_active ? "클릭하면 사용 중지" : "클릭하면 다시 사용"}
                            >
                              {c.is_active ? "사용중" : "중지됨"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
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
