"use client";

// 운영자 — 영업사원 영업코드 발급 + 유입 회사 추적 (2026-07-27 가격정책).
//   무료체험은 폐지됐다 — 코드는 어느 영업사원 경로로 가입했는지 추적하는 용도만 남는다(체험 연장 없음).
//   데이터 접근은 RLS/RPC 로 운영자만 가능 — 이 화면은 그 위의 표시 계층이다.
//   2026-09-03 v2 디자인 — 발급·중지·목록·내보내기 동작은 그대로, 표시를 pf 부품 + Bklit 차트로.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { OpsExportButton, OpsCompanySelect, exportCsv } from "../_components/ops-kit";
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
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfSeg, PfSkeleton, PfEmpty, PfBadge, PfBar, PfState } from "../_components/pf/ui";
import { PfBars } from "../_components/pf/charts";


function fmtDate(iso: string | null) {
  if (!iso) return "-";
  try { return kstDateStr(new Date(iso)); } catch { return "-"; }
}

const STATUS_LABEL: Record<string, string> = {
  trialing: "체험중(옛 기록)", active: "결제중", past_due: "결제실패",
  canceled: "해지", paused: "일시정지",
};
const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "info" | "muted"> = {
  trialing: "info", active: "ok", past_due: "danger", canceled: "muted", paused: "warn",
};

const inputCls = "w-full h-9 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] transition";

export default function SalesCodesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"signups" | "codes">("signups");
  const [form, setForm] = useState({ code: "", ownerName: "", ownerEmail: "", ownerPhone: "", memo: "" });
  const [codeFilter, setCodeFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");

  const { data: codes = [], isLoading: codesLoading, error: codesError, refetch: refetchCodes } = useQuery({
    queryKey: ["sales-codes"],
    queryFn: listSalesCodes,
    refetchInterval: 60_000,
  });
  const { data: signups = [], isLoading: signupsLoading, error: signupsError, refetch: refetchSignups } = useQuery({
    queryKey: ["sales-code-signups"],
    queryFn: listSalesCodeSignups,
    refetchInterval: 60_000,
  });

  const createMut = useMutation({
    mutationFn: () =>
      createSalesCode({
        code: form.code,
        ownerName: form.ownerName,
        ownerEmail: form.ownerEmail,
        ownerPhone: form.ownerPhone,
        memo: form.memo,
        bonusTrialDays: 0,   // 체험 폐지 — 칸은 옛 기록 호환용으로만 남음
      }),
    onSuccess: () => {
      toast("영업코드를 발급했습니다.", "success");
      setForm({ code: "", ownerName: "", ownerEmail: "", ownerPhone: "", memo: "" });
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

  const signupCompanyOptions = useMemo(() => {
    const set = new Set<string>();
    (signups as SalesCodeSignup[]).forEach((r: any) => { if (r.company_name) set.add(r.company_name); });
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [signups]);
  const filteredSignups = useMemo(() => {
    const q = codeFilter.trim().toUpperCase();
    if (!q) return signups as SalesCodeSignup[];
    return (signups as SalesCodeSignup[]).filter(
      (s) => s.code.includes(q) || s.owner_name.toUpperCase().includes(q) || s.company_name.toUpperCase().includes(q),
    );
  }, [signups, codeFilter]).filter((r: any) => companyFilter === "all" || r.company_name === companyFilter);

  const canSubmit =
    SALES_CODE_PATTERN.test(normalizeSalesCode(form.code)) && form.ownerName.trim().length > 0 && !createMut.isPending;

  // ── 요약 KPI · 차트용 파생값 ──
  const totalSignups = (signups as SalesCodeSignup[]).length;
  const totalConverted = (signups as SalesCodeSignup[]).filter((s) => !!s.converted_at).length;
  const activeCodes = (codes as SalesCode[]).filter((c) => c.is_active).length;
  const convRate = totalSignups > 0 ? Math.round((totalConverted / totalSignups) * 100) : 0;
  const codeBars = useMemo(() =>
    [...statsByCode.entries()]
      .sort((a, b) => b[1].signups - a[1].signups)
      .slice(0, 10)
      .map(([code, st]) => ({ name: code, 가입: st.signups, 유료전환: st.converted })),
  [statsByCode]);
  const loading = codesLoading || signupsLoading;

  return (
    <PfPage>
      <PfPageHead
        eyebrow="매출"
        title="영업코드"
        desc="영업사원별 코드를 발급하고, 그 코드로 가입한 회사와 유료 전환을 추적합니다."
        actions={<PfSeg value={tab} onChange={setTab} options={[{ value: "signups", label: "유입 회사" }, { value: "codes", label: "코드 관리" }]} />}
      />

      {/* 요약 KPI */}
      <div className="pf-kpi-grid">
        <PfCard i={1} className="pf-kpi-tile"><PfKpi label="사용 중인 코드" value={activeCodes} unit="개" accent /><div className="text-[10.5px] text-[var(--text-dim)] mt-1.5">발급 {codes.length}개 중</div></PfCard>
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label="코드로 가입한 회사" value={totalSignups} unit="곳" /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="그중 유료 전환" value={totalConverted} unit="곳" /><div className="mt-1.5"><PfBadge tone={convRate >= 20 ? "ok" : convRate > 0 ? "warn" : "muted"}>전환율 {convRate}%</PfBadge></div></PfCard>
      </div>

      {/* 코드별 가입 vs 전환 */}
      <PfCard i={5}>
        <PfCardHead title="코드별 가입과 유료 전환" sub="가입이 많은 코드 상위 10개 · 막대 위에 마우스를 올리면 숫자가 보입니다" />
        <PfCardBody>
          {loading || codesError || signupsError ? <PfState loading={loading} error={codesError || signupsError} onRetry={() => { refetchCodes(); refetchSignups(); }} pad={false} skeletonRows={1} skeletonH={200} /> : codeBars.length === 0 ? <PfEmpty>아직 영업코드로 가입한 회사가 없습니다</PfEmpty> : (
            <PfBars data={codeBars} xKey="name" height={200} series={[{ key: "가입", label: "가입" }, { key: "유료전환", label: "유료 전환" }]} />
          )}
        </PfCardBody>
      </PfCard>

      {tab === "signups" && (
        <PfCard i={6} hover={false}>
          <PfCardHead
            title="어떤 영업코드로 어떤 회사가 가입했는지"
            sub={`${filteredSignups.length.toLocaleString()}곳`}
            action={
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <OpsCompanySelect value={companyFilter} onChange={setCompanyFilter} options={signupCompanyOptions} />
                <input
                  value={codeFilter}
                  onChange={(e) => setCodeFilter(e.target.value)}
                  placeholder="코드·영업사원·회사명 검색"
                  className="h-9 px-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm w-[240px] focus:outline-none focus:border-[var(--primary)]"
                />
                <OpsExportButton
                  disabled={filteredSignups.length === 0}
                  onClick={() => exportCsv((filteredSignups as any[]).map((r: any) => ({
                    코드: r.code || "", 영업사원: r.owner_name || "", 회사: r.company_name || "",
                    유입일: r.redeemed_at ? String(r.redeemed_at).slice(0, 10) : "",
                    유료전환: r.converted_at ? String(r.converted_at).slice(0, 10) : "미전환",
                  })), "영업코드_유입회사")}
                />
              </div>
            }
          />
          {signupsLoading || signupsError || filteredSignups.length === 0 ? (
            <PfState loading={signupsLoading} error={signupsError} onRetry={() => refetchSignups()} empty={filteredSignups.length === 0} emptyText={signups.length === 0 ? "아직 영업코드로 가입한 회사가 없습니다." : "조건에 맞는 회사가 없습니다."} skeletonRows={5} />
          ) : (
            <div className="pf-table-wrap">
              <table className="pf-table min-w-[860px]">
                <thead>
                  <tr>
                    <th>영업코드</th>
                    <th>영업사원</th>
                    <th>회사</th>
                    <th>사업자번호</th>
                    <th>가입일</th>
                    <th className="text-center">구독상태</th>
                    <th>유료전환일</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSignups.map((s) => (
                    <tr key={`${s.code}-${s.company_id}`}>
                      <td className="font-mono text-xs font-bold">{s.code}</td>
                      <td>{s.owner_name}</td>
                      <td className="font-medium">{s.company_name}</td>
                      <td className="text-[var(--text-muted)] mono-number">{s.business_number || "-"}</td>
                      <td className="text-[var(--text-muted)]">{fmtDate(s.redeemed_at)}</td>
                      <td className="text-center">
                        <PfBadge tone={STATUS_TONE[s.subscription_status || ""] || "muted"}>
                          {STATUS_LABEL[s.subscription_status || ""] || s.subscription_status || "-"}
                        </PfBadge>
                      </td>
                      <td className="text-[var(--text-muted)]">{s.converted_at ? fmtDate(s.converted_at) : <span className="text-[var(--text-dim)]">미전환</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PfCard>
      )}

      {tab === "codes" && (
        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <PfCard i={6} hover={false}>
            <PfCardHead title="코드 발급" sub="영업사원에게 줄 코드를 만듭니다" />
            <PfCardBody className="space-y-3">
              <Field label="영업코드">
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="예: KIM-01"
                  className={inputCls}
                />
                <div className="text-[11px] text-[var(--text-dim)] mt-1">영문 대문자·숫자·하이픈 4~24자</div>
              </Field>
              <Field label="영업사원 이름">
                <input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className={inputCls} />
              </Field>
              <Field label="이메일 (선택)">
                <input value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} className={inputCls} />
              </Field>
              <Field label="연락처 (선택)">
                <input value={form.ownerPhone} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} className={inputCls} />
              </Field>
              <Field label="메모 (선택)">
                <input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} className={inputCls} />
              </Field>
              <button onClick={() => createMut.mutate()} disabled={!canSubmit} className="pf-btn pf-btn-primary w-full justify-center disabled:opacity-50">
                {createMut.isPending ? "발급 중..." : "코드 발급"}
              </button>
            </PfCardBody>
          </PfCard>

          <PfCard i={7} hover={false}>
            <PfCardHead title="발급된 코드" sub="상태 버튼을 누르면 사용 중지 / 다시 사용" />
            {codesLoading || codesError || codes.length === 0 ? (
              <PfState loading={codesLoading} error={codesError} onRetry={() => refetchCodes()} empty={codes.length === 0} emptyText="발급된 코드가 없습니다." />
            ) : (
              <div className="pf-table-wrap">
                <table className="pf-table min-w-[680px]">
                  <thead>
                    <tr>
                      <th>코드</th>
                      <th>영업사원</th>
                      <th className="text-center">가입</th>
                      <th>유료 전환</th>
                      <th className="text-center">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(codes as SalesCode[]).map((c) => {
                      const st = statsByCode.get(c.code) || { signups: 0, converted: 0 };
                      const pct = st.signups > 0 ? Math.round((st.converted / st.signups) * 100) : 0;
                      return (
                        <tr key={c.id}>
                          <td className="font-mono text-xs font-bold">{c.code}</td>
                          <td>
                            {c.owner_name}
                            {c.owner_email && (
                              <div className="text-[11px] text-[var(--text-dim)]">{c.owner_email}</div>
                            )}
                          </td>
                          <td className="text-center mono-number">{st.signups}</td>
                          <td className="min-w-[160px]">
                            <div className="flex items-center gap-2">
                              <PfBar pct={pct} tone={pct >= 20 ? "ok" : pct > 0 ? "warn" : "info"} className="flex-1" />
                              <span className="mono-number text-[11px] text-[var(--text-muted)] w-14 text-right">{st.converted}곳 · {pct}%</span>
                            </div>
                          </td>
                          <td className="text-center">
                            <button
                              onClick={() => toggleMut.mutate({ id: c.id, active: !c.is_active })}
                              disabled={toggleMut.isPending}
                              className={`pf-badge ${c.is_active ? "pf-badge-ok" : "pf-badge-muted"} cursor-pointer disabled:opacity-60`}
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
          </PfCard>
        </div>
      )}
    </PfPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">{label}</label>
      {children}
    </div>
  );
}
