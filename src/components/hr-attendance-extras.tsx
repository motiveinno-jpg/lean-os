"use client";

// L 근태 — 화면 (C-2 직원 / C-3 관리자) 보조 컴포넌트.
//   - ExtraPaySummaryCard: 본인 이번 달 연장/야간/휴일/예상 가산수당
//   - AttendanceEditRequestDialog: 직원 → 관리자 수정 요청
//   - EditRequestInbox: 관리자 — pending 요청 승인/반려 + 관리액션 패널
//   - WeeklyCapBanner: 주 12h 연장 cap 초과 직원 표시 (관리자만)

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { DateTimeField } from "@/components/datetime-field";
import { DateField } from "@/components/date-field";
import { kstLocalToIso, kstDateStr } from "@/lib/kst";
import {
  recomputeAttendance,
  recomputeMonthlyExtraPay,
  createAttendanceEditRequest,
  upsertAttendanceRecordAsAdmin,
  getAttendanceCompanySettings,
  listAttendanceEditRequests,
  reviewAttendanceEditRequest,
  type MonthlyPayResult,
} from "@/lib/hr";
import { useModalKeys } from "@/hooks/use-modal-keys";

const fmtKRW = (n: number) => `${(n || 0).toLocaleString("ko-KR")}원`;
const minToH = (m: number) => `${(m / 60).toFixed(1)}h`;

// 수정 요청 인박스 표시용 한글 라벨 (status / attendance_type)
const STATUS_KO: Record<string, string> = {
  present: "정상 출근", late: "지각", remote: "재택", half_day: "반차", absent: "결근",
};
const TYPE_KO: Record<string, string> = {
  field_work: "외근", business_trip: "출장", on_duty: "당직", remote: "원격", normal: "일반",
};

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
      <div className="caption">{label}</div>
      <div className="text-xs font-bold mt-0.5">{value}</div>
      {hint && <div className="text-[9px] text-[var(--text-muted)] mt-0.5">{hint}</div>}
    </div>
  );
}

// ── C-2: 수정 요청 다이얼로그 ──

export function AttendanceEditRequestDialog({
  open,
  onClose,
  companyId,
  attendanceRecordId,
  userId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  attendanceRecordId: string;
  userId: string;
  initial?: { check_in?: string; check_out?: string; status?: string };
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // 빈 칸으로 시작 — 변경할 항목만 입력(출근/퇴근 따로 요청 가능). 입력한 항목만 전송·적용된다.
  const [form, setForm] = useState({
    check_in: "",
    check_out: "",
    status: initial?.status || "",
    reason: "",
  });
  const fmtCur = (iso?: string) => {
    if (!iso) return "기록 없음";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "기록 없음" : d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  // '근무중' 선택(2026-07-31 사장님) — 퇴근 전 상태를 유지한 채 출근 시각만 정정.
  //   status 로 보내지 않고(DB status 에 '근무중' 없음) 퇴근 필드를 잠가 check_in 만 요청한다.
  const isWorkingOnly = form.status === "working";
  const mut = useMutation({
    mutationFn: () =>
      createAttendanceEditRequest({
        companyId,
        attendanceRecordId,
        requestedBy: userId,
        requestedChanges: {
          // 픽커 값은 KST 로 해석 — 브라우저 타임존이 KST 가 아니면 시각이 밀렸다.
          ...(kstLocalToIso(form.check_in) ? { check_in: kstLocalToIso(form.check_in)! } : {}),
          ...(!isWorkingOnly && kstLocalToIso(form.check_out) ? { check_out: kstLocalToIso(form.check_out)! } : {}),
          // 외근/출장은 status 가 아니라 attendance_type (DB CHECK: field_work/business_trip 허용)
          ...(form.status && !isWorkingOnly
            ? form.status.startsWith("type:")
              ? { attendance_type: form.status.slice(5) }
              : { status: form.status }
            : {}),
        },
        reason: form.reason || undefined,
      }),
    onSuccess: () => {
      toast("수정 요청을 보냈습니다. 관리자 승인 후 반영됩니다.", "success");
      queryClient.invalidateQueries({ queryKey: ["attendance-edit-requests"] });
      onClose();
    },
    onError: (err: any) =>
      toast(friendlyError(err, "요청 전송에 실패했습니다."), "error"),
  });

  // '근무중'은 출근 시각이 있어야 보낼 게 있음. 그 외엔 셋 중 하나라도 입력돼야 함.
  const cannotSubmit = isWorkingOnly
    ? !form.check_in
    : !form.check_in && !form.check_out && !form.status;
  // ESC 닫기 · Enter 확인(요청 보내기 — 변경 항목 없거나 전송 중이면 비활성). Hook 규칙상 early return 이전에 항상 호출.
  useModalKeys(open, onClose, mut.isPending || cannotSubmit ? undefined : () => mut.mutate());

  if (!open) return null;

  return (
    <div className="attendance-edit-dialog-overlay fixed inset-0">
      <div
        className="attendance-edit-dialog-panel glass-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="section-title">근태 수정 요청</h3>
        <p className="text-[10px] text-[var(--text-dim)] mb-4">
          잘못 찍은 출퇴근 기록의 변경을 관리자에게 요청합니다(직접 수정 불가). <b className="text-[var(--text-muted)]">변경할 항목만 입력</b>하세요 — 출근·퇴근을 따로 요청할 수 있습니다.
        </p>
        <div className="attendance-edit-form">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">출근 시각 변경 <span className="text-[10px] text-[var(--text-dim)] font-normal">· 현재: {fmtCur(initial?.check_in)}</span></label>
            <DateTimeField
              value={form.check_in}
              onChange={(e) => setForm({ ...form, check_in: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">퇴근 시각 변경 <span className="text-[10px] text-[var(--text-dim)] font-normal">· {isWorkingOnly ? "근무중은 출근 시각만 변경할 수 있습니다" : `현재: ${fmtCur(initial?.check_out)}`}</span></label>
            <DateTimeField
              value={isWorkingOnly ? "" : form.check_out}
              onChange={(e) => setForm({ ...form, check_out: e.target.value })}
              disabled={isWorkingOnly}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">출근 유형 변경 <span className="text-[10px] text-[var(--text-dim)] font-normal">· 재택/외근/출장/근무중 등</span></label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value, ...(e.target.value === "working" ? { check_out: "" } : {}) })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            >
              <option value="">변경 안 함</option>
              {/* 근무중 — 아직 퇴근 전. 출근 시각만 정정하고 상태는 그대로 둔다 (2026-07-31 사장님) */}
              <option value="working">근무중 (출근 시각만 변경)</option>
              <option value="present">정상 출근</option>
              <option value="late">지각</option>
              <option value="remote">재택</option>
              {/* 외근/출장 — attendance_type 으로 기록 (배지: 🚗외근 ✈️출장) */}
              <option value="type:field_work">외근</option>
              <option value="type:business_trip">출장</option>
              <option value="half_day">반차</option>
              <option value="absent">결근</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">사유</label>
            <textarea
              rows={3}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs resize-none"
              placeholder="예: 출근 버튼을 깜빡 누르지 못했습니다."
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 bg-[var(--bg)] text-[var(--text-muted)] rounded-lg text-xs">
            취소
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || cannotSubmit}
            className="flex-1 btn-primary btn-sm"
          >
            {mut.isPending ? "전송 중…" : "요청 보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 관리자 대행 출퇴근 기록 (2026-07-27) ──
//   "직원이 실수로 출근하기를 안 눌렀을 때 대신 눌러줄 수 있게" — 사장님 요청.
//   기록이 아예 없는 날짜도 만들 수 있고, 이미 있으면 그 날 기록을 덮어쓴다.

export function ManualAttendanceDialog({
  open, onClose, companyId, userId, employees, defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  userId?: string | null;
  employees: {
    id: string; name?: string | null; status?: string | null;
    work_start_time?: string | null; work_end_time?: string | null;
  }[];
  defaultDate: string; // 'YYYY-MM-DD' — 캘린더에서 선택한 날짜
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // 재직 판정은 AttendanceTab 의 activeEmployees 와 동일 규칙 — 실데이터는 대부분 'joined'(초대 수락)
  //   이라 'active' 만 통과시키면 목록이 통째로 비어 보인다(2026-07-28 사장님 제보).
  const activeEmployees = (employees || []).filter((e) => e.status === "active" || e.status === "joined");
  // 날짜는 위 '날짜' 칸 하나로만 고른다 — 출퇴근까지 날짜 픽커를 두면 같은 날짜를
  //   세 번 고르게 되고 서로 어긋날 수도 있었다(2026-07-28 사장님 제보). 시각만 입력.
  const [form, setForm] = useState({
    employeeId: "",
    date: defaultDate,
    checkInTime: "",   // 'HH:MM'
    checkOutTime: "",  // 'HH:MM'
    nextDayOut: false, // 자정을 넘겨 퇴근한 경우
    stillWorking: false, // 아직 퇴근 전 — 퇴근 시각을 비워 저장
    status: "",
    note: "",
  });
  // 시각을 손으로 고친 뒤에는 기본값이 다시 덮어쓰지 않도록.
  const [timesTouched, setTimesTouched] = useState(false);

  // 회사 근무시간 — 출퇴근 시각 기본값 (2026-07-28 사장님 요청).
  const { data: companySettings } = useQuery({
    queryKey: ["attendance-company-settings", companyId],
    queryFn: () => getAttendanceCompanySettings(companyId),
    enabled: !!companyId && open,
  });

  const hhmm = (v?: string | null) => (typeof v === "string" && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : "");
  // 직원 개인 출퇴근시간 override 가 있으면 회사 기본값보다 우선.
  const defaultTimes = (employeeId: string) => {
    const emp = activeEmployees.find((e) => e.id === employeeId);
    return {
      checkInTime: hhmm(emp?.work_start_time) || hhmm(companySettings?.work_start_time),
      checkOutTime: hhmm(emp?.work_end_time) || hhmm(companySettings?.work_end_time),
    };
  };

  // 열 때마다 캘린더에서 고른 날짜 + 회사 근무시간으로 초기화.
  //   다이얼로그가 상시 마운트라 useState 초기값만으로는 두 번째 열 때 갱신되지 않는다.
  React.useEffect(() => {
    if (!open) return;
    setTimesTouched(false);
    setForm((f) => ({
      ...f,
      date: defaultDate,
      checkInTime: hhmm(companySettings?.work_start_time),
      checkOutTime: hhmm(companySettings?.work_end_time),
      nextDayOut: false,
      stillWorking: false,
    }));
    // defaultDate·회사설정이 바뀌었을 때만 재초기화 (입력 중 리셋 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, companySettings?.work_start_time, companySettings?.work_end_time]);

  /** 'YYYY-MM-DD' + 'HH:MM' → 저장용 ISO (KST 해석) */
  const toIso = (date: string, time: string, plusDay = false) => {
    if (!date || !time) return null;
    const d = plusDay ? new Date(`${date}T00:00:00+09:00`) : null;
    if (d) d.setUTCDate(d.getUTCDate() + 1);
    const day = d ? kstDateStr(d) : date;
    return kstLocalToIso(`${day}T${time}`);
  };

  // 외근/출장은 status 가 아니라 attendance_type — 지각 판정은 출근 시각으로 자동('type:' 접두)
  const isTypeChoice = form.status.startsWith("type:");
  const mut = useMutation({
    mutationFn: async () => {
      const rec = await upsertAttendanceRecordAsAdmin({
        companyId,
        employeeId: form.employeeId,
        date: form.date,
        checkIn: toIso(form.date, form.checkInTime),
        checkOut: toIso(form.date, form.checkOutTime, form.nextDayOut),
        status: isTypeChoice ? undefined : form.status || undefined,
        attendanceType: isTypeChoice ? form.status.slice(5) : undefined,
        note: form.note || null,
        editedBy: userId || null,
      });
      // 분 컬럼(정규/연장/야간/휴일)은 recompute 가 채운다 — 저장 즉시 화면 수치가 맞도록.
      await recomputeAttendance({ companyId, from: form.date, to: form.date, employeeId: form.employeeId });
      return rec;
    },
    onSuccess: () => {
      toast("출퇴근 기록을 저장했습니다.", "success");
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-summary"] });
      onClose();
    },
    onError: (err: any) => toast(friendlyError(err, "기록 저장에 실패했습니다."), "error"),
  });

  // 출근 시각 없이 저장하면 "기록만 있고 시간이 없는" 행이 생겨 결근과 구분이 안 된다.
  const canSave = !!form.employeeId && !!form.date && !!form.checkInTime && !mut.isPending;
  // 같은 날인데 퇴근이 출근보다 빠르면 근무시간이 0 으로 저장돼버린다 — 저장 전에 막는다.
  //   자정을 넘긴 근무는 '익일 퇴근' 을 켜면 되므로 그때는 정상.
  const outBeforeIn = !form.nextDayOut && !!form.checkInTime && !!form.checkOutTime
    && form.checkOutTime <= form.checkInTime;

  useModalKeys(open, onClose, canSave && !outBeforeIn ? () => mut.mutate() : undefined);

  if (!open) return null;

  return (
    <div className="attendance-edit-dialog-overlay fixed inset-0">
      <div className="attendance-edit-dialog-panel glass-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title">출퇴근 기록 추가</h3>
        <p className="text-[10px] text-[var(--text-dim)] mb-4">
          직원이 출근·퇴근 버튼을 누르지 못한 날을 관리자가 대신 기록합니다.
          <b className="text-[var(--text-muted)]"> 같은 날 기록이 이미 있으면 덮어씁니다.</b>
        </p>
        <div className="attendance-edit-form">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">직원</label>
            <select
              value={form.employeeId}
              onChange={(e) => {
                const employeeId = e.target.value;
                // 개인 출퇴근시간이 따로 설정된 직원이면 그 값으로 다시 채운다.
                //   단, 관리자가 이미 시각을 손봤으면 건드리지 않는다.
                setForm((f) => ({ ...f, employeeId, ...(timesTouched ? {} : defaultTimes(employeeId)) }));
              }}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            >
              <option value="">직원 선택</option>
              {activeEmployees.map((e) => (
                <option key={e.id} value={e.id}>{e.name || "이름 없음"}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">날짜</label>
            <DateField
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div className="manual-attendance-times">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">출근 시각</label>
              <input
                type="time"
                value={form.checkInTime}
                onChange={(e) => { setTimesTouched(true); setForm({ ...form, checkInTime: e.target.value }); }}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">퇴근 시각</label>
              <input
                type="time"
                value={form.checkOutTime}
                onChange={(e) => { setTimesTouched(true); setForm({ ...form, checkOutTime: e.target.value }); }}
                disabled={form.stillWorking}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs disabled:opacity-40"
                placeholder={form.stillWorking ? "근무 중" : undefined}
              />
            </div>
          </div>
          <div>
            {/* 근무 중(퇴근 전) — 회사 근무시간이 자동으로 채워져 매번 지워야 했다 (2026-08-06 사장님) */}
            <label className="manual-attendance-nextday">
              <input
                type="checkbox"
                checked={form.stillWorking}
                onChange={(e) => {
                  const on = e.target.checked;
                  setTimesTouched(true);
                  setForm((f) => ({
                    ...f,
                    stillWorking: on,
                    // 켜면 퇴근 시각을 비우고(익일 퇴근도 해제), 끄면 기본 퇴근시각을 되살린다
                    checkOutTime: on ? "" : (defaultTimes(f.employeeId).checkOutTime || f.checkOutTime),
                    nextDayOut: on ? false : f.nextDayOut,
                  }));
                }}
              />
              <span>근무 중 (아직 퇴근 전 — 퇴근 시각 비움)</span>
            </label>
            {/* 자정을 넘겨 퇴근한 날은 날짜 픽커 없이 표현할 수 없어 토글로 둔다. */}
            <label className="manual-attendance-nextday">
              <input
                type="checkbox"
                checked={form.nextDayOut}
                onChange={(e) => setForm({ ...form, nextDayOut: e.target.checked })}
                disabled={!form.checkOutTime || form.stillWorking}
              />
              <span>익일 퇴근 (자정 넘김)</span>
            </label>
            {outBeforeIn && (
              <div className="text-[10px] text-[var(--danger)] mt-1">
                퇴근 시각이 출근 시각보다 빠릅니다. 자정을 넘겨 퇴근했다면 &lsquo;익일 퇴근&rsquo;을 체크하세요.
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">
              출근 유형 <span className="text-[10px] text-[var(--text-dim)] font-normal">· 비우면 출근 시각으로 자동 판정</span>
            </label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            >
              <option value="">자동 (정상 출근 / 지각)</option>
              <option value="present">정상 출근</option>
              <option value="late">지각</option>
              <option value="remote">재택</option>
              {/* 외근/출장 — attendance_type 으로 기록, 지각 판정은 출근 시각으로 자동 (2026-07-31 사장님) */}
              <option value="type:field_work">외근</option>
              <option value="type:business_trip">출장</option>
              <option value="half_day">반차</option>
              <option value="absent">결근</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">사유 · 메모</label>
            <textarea
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs resize-none"
              placeholder="예: 외근 직행으로 출근 버튼을 누르지 못함"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 bg-[var(--bg)] text-[var(--text-muted)] rounded-lg text-xs">
            취소
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={!canSave || outBeforeIn}
            className="flex-1 btn-primary btn-sm"
          >
            {mut.isPending ? "저장 중…" : "기록 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── C-3: 관리자 — 수정 요청 인박스 ──

export function EditRequestInbox({ companyId, reviewerId }: { companyId: string; reviewerId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: requests = [], refetch } = useQuery({
    queryKey: ["attendance-edit-requests", companyId, "pending"],
    queryFn: () => listAttendanceEditRequests(companyId, "pending"),
    enabled: !!companyId,
  });

  const reviewMut = useMutation({
    mutationFn: (params: { requestId: string; decision: "approved" | "rejected"; applyChanges: boolean }) =>
      reviewAttendanceEditRequest({
        requestId: params.requestId,
        reviewerId,
        decision: params.decision,
        applyChanges: params.applyChanges,
      }),
    onSuccess: () => {
      // 승인+적용 시 근태 기록이 즉시 화면에 반영되도록 근태 관련 쿼리 전체 무효화
      //   (기록/요약/워크보드/대시보드 등 키가 다양해 한두 개만 무효화하면 미반영으로 보임)
      queryClient.invalidateQueries();
      refetch();
    },
    onError: (err: any) =>
      toast(friendlyError(err, "처리에 실패했습니다."), "error"),
  });

  if (requests.length === 0) return null;

  return (
    <div className="edit-request-inbox glass-card">
      <h3 className="text-sm font-bold mb-3">근태 수정 요청 ({requests.length}건)</h3>
      <div className="space-y-2">
        {requests.map((r: any) => {
          const rec = r.attendance_records;
          const changes = r.requested_changes || {};
          return (
            <div key={r.id} className="edit-request-row">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-semibold">
                  {rec?.employees?.name || "직원"} — {rec?.date}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => reviewMut.mutate({ requestId: r.id, decision: "approved", applyChanges: true })}
                    disabled={reviewMut.isPending}
                    className="px-2.5 py-1 bg-[var(--success)] hover:brightness-110 text-white rounded text-[10px] font-semibold disabled:opacity-40"
                  >
                    승인+적용
                  </button>
                  <button
                    onClick={() => reviewMut.mutate({ requestId: r.id, decision: "rejected", applyChanges: false })}
                    disabled={reviewMut.isPending}
                    className="px-2.5 py-1 bg-[var(--danger)] hover:brightness-110 text-white rounded text-[10px] font-semibold disabled:opacity-40"
                  >
                    반려
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                기존: {rec?.check_in ? new Date(rec.check_in).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                {" / "}
                {rec?.check_out ? new Date(rec.check_out).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                {" → 요청: "}
                {changes.check_in ? new Date(changes.check_in as string).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                {" / "}
                {changes.check_out ? new Date(changes.check_out as string).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                {/* 상태·출근유형 변경 요청도 표시 — 시각만 보이면 외근/재택 요청이 안 보였다 */}
                {changes.status ? ` · 상태→${STATUS_KO[String(changes.status)] || changes.status}` : ""}
                {changes.attendance_type ? ` · 유형→${TYPE_KO[String(changes.attendance_type)] || changes.attendance_type}` : ""}
              </div>
              {r.reason && <div className="text-[10px] text-[var(--text-dim)] mt-1">"{r.reason}"</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── C-3: 관리자 — 월 일괄 재계산 액션 ──

export function MonthlyRecomputeButton({ companyId, from, to }: { companyId: string; from: string; to: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mut = useMutation({
    mutationFn: () => recomputeAttendance({ companyId, from, to }),
    onSuccess: (res) => {
      toast(`재계산 완료 (${res.updated}/${res.total}건)`, "success");
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-summary"] });
    },
    onError: (err: any) =>
      toast(friendlyError(err, "재계산에 실패했습니다."), "error"),
  });

  return (
    <button
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      className="btn-secondary btn-sm"   /* 2026-08-19 월간 요약 조회 줄의 검색조건이 파란 채움 — 파란 버튼은 화면에 하나 */
      title="해당 기간의 가산수당(연장·야간·휴일) 시간을 회사 정책과 휴일 기준으로 다시 계산합니다."
    >
      {mut.isPending ? "재계산 중…" : "가산수당 재계산"}
    </button>
  );
}
