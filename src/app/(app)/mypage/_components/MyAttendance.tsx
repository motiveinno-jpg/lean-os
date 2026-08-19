"use client";
import { logRead } from "@/lib/log-read";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { AttendanceBadges } from "@/components/attendance-badges";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { createAttendanceEditRequest } from "@/lib/hr";
import { kstLocalToIso } from "@/lib/kst";
import { QueryBar, ConditionPanel, ConditionRow, AppliedChips, ResultStrip, Stat, type AppliedChip } from "@/components/query-kit";

// 내 출퇴근 기록 — 인사관리>근태관리가 "전 직원"이라면 여기는 "나"만.
//   월 단위로 내 attendance_records 를 조회해 요약(근무일·총 근무시간·지각·연장) + 일별 목록을 보여준다.
//   출퇴근 찍기는 상단 MyAttendanceCard(오늘 카드) 담당.
//   2026-08-05 사장님: 출근시간이 잘못 찍힌 날은 여기서 바로 "정정 요청" — 관리자 승인 후 반영
//   (AI 참모의 request_attendance_edit 과 동일 인프라: attendance_edit_requests + KST ISO 변환).

// "HH:MM" — check_in/out 은 timestamptz 또는 'HH:MM' 형 모두 방어 (flex-work-board 와 동일 규칙)
function timeOf(v: string | null): string | null {
  if (!v) return null;
  if (/^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
}
function fmtHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  present: { label: "출근", color: "text-[var(--success)]" },
  late: { label: "지각", color: "text-[var(--danger)]" },
  absent: { label: "결근", color: "text-[var(--text-muted)]" },
  half_day: { label: "반차", color: "text-[var(--info)]" },
  remote: { label: "재택", color: "text-[var(--info)]" },
};

// KST 기준 'YYYY-MM'
const kstMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).slice(0, 7);
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export function MyAttendance({ employeeId }: { employeeId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [month, setMonth] = useState(kstMonth());
  const isCurrentMonth = month === kstMonth();

  // ── 정정 요청 모달 상태 ──
  const [editTarget, setEditTarget] = useState<any | null>(null); // attendance_records 행
  const [editCheckIn, setEditCheckIn] = useState("");
  const [editCheckOut, setEditCheckOut] = useState("");
  const [editReason, setEditReason] = useState("");

  const openEdit = (r: any) => {
    setEditTarget(r);
    setEditCheckIn(timeOf(r.check_in) || "");
    setEditCheckOut(timeOf(r.check_out) || "");
    setEditReason("");
  };

  // 내 대기 중 정정 요청 — 중복 요청 방지 + "정정 대기중" 표시 (RLS: requested_by 본인 행 select 허용)
  const { data: pendingReqs = [] } = useQuery({
    queryKey: ["my-attendance-edit-requests", user?.id],
    queryFn: async () => {
      const data = logRead('_components/MyAttendance:pendingReqs', await supabase
        .from("attendance_edit_requests")
        .select("attendance_record_id")
        .eq("requested_by", user!.id)
        .eq("status", "pending"));
      return (data || []).map((r: any) => r.attendance_record_id as string);
    },
    enabled: !!user?.id,
  });
  const pendingSet = new Set(pendingReqs);

  const editReqMut = useMutation({
    mutationFn: async () => {
      const r = editTarget;
      const origCi = timeOf(r.check_in) || "";
      const origCo = timeOf(r.check_out) || "";
      const changes: Record<string, string> = {};
      // 시각은 KST 로 해석 — AI 참모 정정 요청과 동일 규칙 (브라우저 타임존 무관)
      if (editCheckIn && editCheckIn !== origCi) {
        const iso = kstLocalToIso(`${r.date}T${editCheckIn}`);
        if (iso) changes.check_in = iso;
      }
      if (editCheckOut && editCheckOut !== origCo) {
        const iso = kstLocalToIso(`${r.date}T${editCheckOut}`);
        if (iso) changes.check_out = iso;
      }
      if (Object.keys(changes).length === 0) throw new Error("바뀐 시각이 없습니다 — 출근 또는 퇴근 시각을 수정해 주세요.");
      if (!editReason.trim()) throw new Error("정정 사유를 입력해 주세요.");
      await createAttendanceEditRequest({
        companyId: user!.company_id!,
        attendanceRecordId: r.id,
        requestedBy: user!.id,
        requestedChanges: changes,
        reason: editReason.trim(),
      });
    },
    onSuccess: () => {
      toast(`${editTarget?.date} 정정 요청을 보냈습니다 — 관리자 승인 후 반영됩니다`, "success");
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["my-attendance-edit-requests", user?.id] });
    },
    onError: (e: any) => toast(friendlyError(e, "정정 요청 실패"), "error"),
  });

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["mypage-attendance-records", employeeId, month],
    queryFn: async () => {
      const [y, m] = month.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const data = logRead('_components/MyAttendance:data', await supabase
        .from("attendance_records")
        .select("*")
        .eq("employee_id", employeeId!)
        .gte("date", `${month}-01`)
        .lte("date", `${month}-${String(lastDay).padStart(2, "0")}`)
        .order("date", { ascending: false }));
      return (data || []) as any[];
    },
    enabled: !!employeeId,
  });

  // 요약 — 근태관리(getMonthlyAttendanceSummary)와 동일 규칙: 지각은 is_late 하나만 본다.
  const workDays = records.filter((r) => r.status !== "absent").length;
  const totalMinutes = records.reduce(
    (sum, r) => sum + (Number(r.regular_minutes || 0) + Number(r.overtime_minutes || 0) || Math.round(Number(r.work_hours || 0) * 60)),
    0,
  );
  const lateDays = records.filter((r) => r.is_late).length;
  const overtimeMinutes = records.reduce((sum, r) => sum + Number(r.overtime_minutes || 0), 0);

  //   검색조건 — 상태(다중) · 정정 요청 있음 · 연장 있음 (2026-08-19 조회 표준: 갈래 안 표는 조회 줄+검색조건+결과 요약+표)
  const [cond, setCond] = useState<{ st: string[]; flags: string[] }>({ st: [], flags: [] });
  const [draft, setDraft] = useState(cond);
  const [panel, setPanel] = useState(false);
  const shown = records.filter((r) => {
    const st = r.is_late ? "late" : (r.status || "present");
    if (cond.st.length && !cond.st.includes(st) && !cond.st.includes(r.status)) return false;
    if (cond.flags.includes("edit") && !pendingSet.has(r.id)) return false;
    if (cond.flags.includes("ot") && !(Number(r.overtime_minutes || 0) > 0)) return false;
    return true;
  });
  const chips: AppliedChip[] = [
    ...(cond.st.length ? [{ group: "상태", label: cond.st.map((k) => STATUS_LABEL[k]?.label || k).join(" · "), onRemove: () => setCond((c) => ({ ...c, st: [] })) }] : []),
    ...(cond.flags.length ? [{ group: "표시", label: cond.flags.map((f) => (f === "edit" ? "정정 대기" : "연장 있음")).join(" · "), onRemove: () => setCond((c) => ({ ...c, flags: [] })) }] : []),
  ];

  return (
    <div className="mypage-attendance-card bz-body">
      {/* 조회 줄 — [월 이동 · 검색조건 ▾] ‖ (오늘 찍기는 내 현황) */}
      <QueryBar right={<span className="text-[11px] text-[var(--text-dim)]">출근·퇴근 시각이 잘못 찍힌 날은 줄의 '정정 요청' — 관리자 승인 후 반영</span>}>
        <span className="inline-flex items-center gap-1">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="btn-secondary btn-sm" aria-label="이전 달">‹</button>
          <span className="text-xs font-bold mono-number w-[86px] text-center">{month.replace("-", "년 ")}월</span>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={isCurrentMonth} className="btn-secondary btn-sm disabled:opacity-30" aria-label="다음 달">›</button>
        </span>
        <ConditionPanel open={panel} onOpenChange={(v) => { if (v) setDraft(cond); setPanel(v); }} activeCount={(cond.st.length ? 1 : 0) + (cond.flags.length ? 1 : 0)}
          foot={<>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setDraft({ st: [], flags: [] })}>기본으로</button>
            <span className="ml-auto" />
            <button type="button" className="btn-primary btn-sm" onClick={() => { setCond(draft); setPanel(false); }}>조회</button>
          </>}>
          <ConditionRow label="상태" hint="여러 개">
            <span className="qk-quicks">{Object.entries(STATUS_LABEL).map(([k, v]) => <button key={k} type="button" onClick={() => setDraft((d) => ({ ...d, st: d.st.includes(k) ? d.st.filter((x) => x !== k) : [...d.st, k] }))} className={draft.st.includes(k) ? "qk-quick qk-quick-on" : "qk-quick"}>{v.label}</button>)}</span>
          </ConditionRow>
          <ConditionRow label="표시">
            <span className="qk-quicks">{([["edit", "정정 대기 있음"], ["ot", "연장 있음"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setDraft((d) => ({ ...d, flags: d.flags.includes(k) ? d.flags.filter((x) => x !== k) : [...d.flags, k] }))} className={draft.flags.includes(k) ? "qk-quick qk-quick-on" : "qk-quick"}>{l}</button>)}</span>
          </ConditionRow>
        </ConditionPanel>
      </QueryBar>
      <AppliedChips chips={chips} onClearAll={() => setCond({ st: [], flags: [] })} />
      <ResultStrip>
        <Stat label="근무일" value={`${workDays}일`} />
        <Stat label="총 근무" value={`${Math.floor(totalMinutes / 60)}시간 ${Math.round(totalMinutes % 60)}분`} />
        <Stat label="지각" value={`${lateDays}회`} tone={lateDays > 0 ? "minus" : undefined} />
        <Stat label="연장" value={fmtHM(overtimeMinutes)} />
        <Stat label="정정 대기" value={`${records.filter((r) => pendingSet.has(r.id)).length}건`} />
      </ResultStrip>

      {isLoading ? (
        <div className="collect-empty">불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div className="collect-empty">{records.length === 0 ? "이 달의 출퇴근 기록이 없습니다 — 출근을 기록하면 여기 일자별로 쌓입니다" : "조건에 맞는 날이 없습니다"}</div>
      ) : (
        <table className="ev-table ev-lined mypage-att-table">
          <thead><tr><th>날짜</th><th>요일</th><th>출근</th><th>퇴근</th><th>근무</th><th>연장</th><th>상태</th><th className="text-left">비고</th><th>정정</th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const st = STATUS_LABEL[r.status as string] || STATUS_LABEL.present;
              const ci = timeOf(r.check_in);
              const co = timeOf(r.check_out);
              const dayMinutes = Number(r.regular_minutes || 0) + Number(r.overtime_minutes || 0) || Math.round(Number(r.work_hours || 0) * 60);
              const d = new Date(`${r.date}T00:00:00`);
              const ot = Number(r.overtime_minutes || 0);
              return (
                <tr key={r.id}>
                  <td className="text-center mono-number font-semibold">{Number(r.date.slice(5, 7))}/{Number(r.date.slice(8, 10))}</td>
                  <td className={`text-center ${d.getDay() === 0 ? "text-[var(--danger)]" : d.getDay() === 6 ? "text-[var(--info)]" : "text-[var(--text-muted)]"}`}>{WEEKDAYS[d.getDay()]}</td>
                  <td className={`text-center mono-number ${r.is_late ? "text-[var(--warning)] font-bold" : ""}`}>{ci || "—"}</td>
                  <td className="text-center mono-number">{co || (ci ? <span className="text-[var(--text-dim)]">근무 중</span> : "—")}</td>
                  <td className="text-right mono-number">{dayMinutes > 0 ? fmtHM(dayMinutes) : "—"}</td>
                  <td className={`text-right mono-number ${ot > 0 ? "text-[var(--warning)]" : "text-[var(--text-dim)]"}`}>{ot > 0 ? fmtHM(ot) : "—"}</td>
                  <td className="text-center"><span className={`ol-sure ${r.status === "present" && !r.is_late ? "ol-sure-ok" : r.is_late || r.status === "absent" ? "" : "ol-sure-est"}`}>{r.is_late ? `지각${r.late_minutes ? ` ${r.late_minutes}분` : ""}` : st.label}</span></td>
                  <td className="text-left"><span className="inline-flex flex-wrap gap-1"><AttendanceBadges record={r} compact /></span></td>
                  <td className="text-center">
                    {pendingSet.has(r.id) ? <span className="ol-sure ol-sure-est" title="관리자 승인 대기 중인 정정 요청이 있습니다">정정 대기</span>
                      : <button type="button" onClick={() => openEdit(r)} className="btn-secondary btn-sm" title="출근·퇴근 시각이 잘못 기록됐다면 관리자에게 정정을 요청하세요">정정 요청</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ── 정정 요청 모달 ── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <div className="text-sm font-bold text-[var(--text)]">출퇴근 시각 정정 요청</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5 mono-number">{editTarget.date} — 직접 수정이 아니라 관리자 승인 요청입니다</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">출근 시각</span>
                <input type="time" value={editCheckIn} onChange={(e) => setEditCheckIn(e.target.value)} className="field-input-sm" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">퇴근 시각</span>
                <input type="time" value={editCheckOut} onChange={(e) => setEditCheckOut(e.target.value)} className="field-input-sm" />
              </label>
            </div>
            <label className="block">
              <span className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">정정 사유 <span className="text-red-500">*</span></span>
              <textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                rows={2}
                placeholder="예: 출근 직후 태깅을 깜빡해서 실제 출근은 08:55입니다"
                className="field-input-sm resize-y"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditTarget(null)} className="btn-secondary btn-sm">취소</button>
              <button
                type="button"
                onClick={() => editReqMut.mutate()}
                disabled={editReqMut.isPending}
                className="btn-primary btn-sm disabled:opacity-50"
              >
                {editReqMut.isPending ? "요청 중..." : "정정 요청 보내기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
