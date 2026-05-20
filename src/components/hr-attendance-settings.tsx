"use client";

// L 근태 — 회사 설정 패널 (C-1).
//   - settings/page.tsx 의 '근태/가산수당' 탭으로 마운트
//   - 컬럼: work_start/end_time, lunch_minutes, late_grace_minutes,
//          night_start/end_time, weekly_work_hours, is_under_5_employees,
//          is_inclusive_wage, monthly_standard_hours, on_duty_pay_per_shift,
//          workdays_mask (월=1·화=2·수=4·목=8·금=16·토=32·일=64)
//   - 휴일 캘린더: holidays 테이블 직접 관리 + 한국 법정공휴일 seed RPC

import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import {
  getAttendanceCompanySettings,
  setAttendanceCompanySettings,
  listHolidays,
  upsertHoliday,
  deleteHoliday,
  seedKoreanLegalHolidays,
  recomputeAttendance,
  type AttendanceCompanySettings,
} from "@/lib/hr";
import HrAllowanceCatalogPanel from "@/components/hr-allowance-catalog";

const DOW = [
  { bit: 1, label: "월" },
  { bit: 2, label: "화" },
  { bit: 4, label: "수" },
  { bit: 8, label: "목" },
  { bit: 16, label: "금" },
  { bit: 32, label: "토" },
  { bit: 64, label: "일" },
];

export default function HrAttendanceSettingsPanel({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery<AttendanceCompanySettings>({
    queryKey: ["hr-attendance-settings", companyId],
    queryFn: () => getAttendanceCompanySettings(companyId),
    enabled: !!companyId,
  });

  const [form, setForm] = useState<AttendanceCompanySettings | null>(null);
  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);

  const saveMut = useMutation({
    mutationFn: (patch: Partial<AttendanceCompanySettings>) =>
      setAttendanceCompanySettings(companyId, patch),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["hr-attendance-settings", companyId] });
      // L 근태 — 설정 변경 시 최근 30일 attendance_records 자동 재계산.
      //   회사 출퇴근 기준·야간/휴일·포괄임금 토글이 바뀌어도 과거 행에 반영되게.
      //   allowance_entries chain 도 recomputeAttendance 안에 내장.
      //   실패해도 저장 자체는 성공 처리.
      try {
        const today = new Date();
        const from = new Date(today);
        from.setDate(from.getDate() - 30);
        await recomputeAttendance({
          companyId,
          from: from.toISOString().slice(0, 10),
          to: today.toISOString().slice(0, 10),
        });
        queryClient.invalidateQueries({ queryKey: ["attendance"] });
        queryClient.invalidateQueries({ queryKey: ["attendance-summary"] });
        toast("근태 설정 저장 + 최근 30일 자동 재계산 완료", "success");
      } catch (e: any) {
        // 권한 부족 (admin only) 또는 일시 오류 — 저장은 성공
        toast(`근태 설정 저장 완료 (자동 재계산은 실패: ${e?.message || "알 수 없음"})`, "success");
      }
    },
    onError: (err: any) =>
      toast(friendlyError(err, "저장에 실패했습니다. 잠시 후 다시 시도해 주세요."), "error"),
  });

  // 휴일
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays", companyId, year],
    queryFn: () => listHolidays(companyId, year),
    enabled: !!companyId,
  });

  const seedMut = useMutation({
    mutationFn: () => seedKoreanLegalHolidays(year),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["holidays", companyId, year] });
      toast(`${year}년 법정공휴일 ${count}건 추가됨`, "success");
    },
    onError: (err: any) =>
      toast(friendlyError(err, "법정공휴일 적용에 실패했습니다."), "error"),
  });

  const [newHoliday, setNewHoliday] = useState({ date: "", name: "", type: "company" as "company" | "substitute" | "legal" });
  const addHolidayMut = useMutation({
    mutationFn: () => upsertHoliday({ company_id: companyId, ...newHoliday }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays", companyId, year] });
      setNewHoliday({ date: "", name: "", type: "company" });
      toast("휴일 추가됨", "success");
    },
    onError: (err: any) =>
      toast(friendlyError(err, "휴일 추가에 실패했습니다."), "error"),
  });

  const delHolidayMut = useMutation({
    mutationFn: (id: string) => deleteHoliday(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["holidays", companyId, year] }),
    onError: (err: any) =>
      toast(friendlyError(err, "휴일 삭제에 실패했습니다."), "error"),
  });

  if (!form) {
    return (
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <p className="text-sm text-[var(--text-muted)]">불러오는 중…</p>
      </div>
    );
  }

  const toggleDow = (bit: number) => {
    setForm({ ...form, workdays_mask: (form.workdays_mask & bit) ? form.workdays_mask & ~bit : form.workdays_mask | bit });
  };

  const onSave = () => saveMut.mutate(form);

  return (
    <div className="space-y-4">
      {/* 근무시간 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold">근무시간</h2>
          <span className="text-[10px] text-[var(--text-dim)]">
            저장 후 다음 출근부터 즉시 반영 · 지각 임계 = 출근시각 + 유예분
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">출근 시각</label>
            <input
              type="time"
              value={form.work_start_time}
              onChange={(e) => setForm({ ...form, work_start_time: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">퇴근 시각</label>
            <input
              type="time"
              value={form.work_end_time}
              onChange={(e) => setForm({ ...form, work_end_time: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">점심 (분)</label>
            <input
              type="number" min={0} max={240}
              value={form.lunch_minutes}
              onChange={(e) => setForm({ ...form, lunch_minutes: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">지각 유예 (분)</label>
            <input
              type="number" min={0} max={240}
              value={form.late_grace_minutes}
              onChange={(e) => setForm({ ...form, late_grace_minutes: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">야간 시작</label>
            <input
              type="time"
              value={form.night_start_time}
              onChange={(e) => setForm({ ...form, night_start_time: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">야간 종료</label>
            <input
              type="time"
              value={form.night_end_time}
              onChange={(e) => setForm({ ...form, night_end_time: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
        </div>
        <p className="text-[10px] text-[var(--text-dim)] mt-2">
          야간 종료가 시작보다 작으면 자정을 넘긴 것으로 자동 계산합니다 (예: 22:00 ~ 06:00).
        </p>

        <div className="mt-4">
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">근무 요일</label>
          <div className="flex gap-1.5">
            {DOW.map((d) => (
              <button
                key={d.bit}
                onClick={() => toggleDow(d.bit)}
                className={`w-9 h-9 rounded-lg text-xs font-semibold transition ${
                  form.workdays_mask & d.bit
                    ? "bg-[var(--primary)] text-white"
                    : "bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 가산수당 정책 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">가산수당 정책</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">주 소정근로시간</label>
            <input
              type="number" min={1} max={80}
              value={form.weekly_work_hours}
              onChange={(e) => setForm({ ...form, weekly_work_hours: Number(e.target.value) || 40 })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">통상시급 분모 (월 시간)</label>
            <input
              type="number" min={1} max={400}
              value={form.monthly_standard_hours}
              onChange={(e) => setForm({ ...form, monthly_standard_hours: Number(e.target.value) || 209 })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-[var(--text-muted)] mb-1">당직 1회 단가 (원)</label>
            <input
              type="number" min={0}
              value={form.on_duty_pay_per_shift}
              onChange={(e) => setForm({ ...form, on_duty_pay_per_shift: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
            {form.on_duty_pay_per_shift === 0 && (
              <p className="text-[10px] text-[var(--text-dim)] mt-1">0 이면 당직 수당이 자동 계산되지 않습니다.</p>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_under_5_employees}
              onChange={(e) => setForm({ ...form, is_under_5_employees: e.target.checked })}
            />
            <span className="text-xs">5인 미만 사업장</span>
          </label>
          {form.is_under_5_employees && (
            <p className="text-[10px] text-yellow-400 ml-6">연장·야간·휴일 가산수당 법정 적용 대상이 아닙니다 (통상시급만 지급).</p>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_inclusive_wage}
              onChange={(e) => setForm({ ...form, is_inclusive_wage: e.target.checked })}
            />
            <span className="text-xs">포괄임금제</span>
          </label>
          {form.is_inclusive_wage && (
            <p className="text-[10px] text-yellow-400 ml-6">약정 범위 내 가산수당은 별도 지급되지 않습니다 (cap 초과 시 별도 협의).</p>
          )}
        </div>
      </div>

      <button
        onClick={onSave}
        disabled={saveMut.isPending}
        className="w-full py-3 bg-[var(--primary)] hover:opacity-90 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
      >
        {saveMut.isPending ? "저장 중…" : "근태 설정 저장"}
      </button>

      {/* L 수당 카탈로그 — 법정 4종 + 회사 커스텀 */}
      <HrAllowanceCatalogPanel companyId={companyId} />

      {/* 휴일 캘린더 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold">휴일 관리 ({year}년)</h2>
          <div className="flex items-center gap-2">
            <input
              type="number" min={2020} max={2099}
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
              className="w-24 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs"
            />
            <button
              onClick={() => seedMut.mutate()}
              disabled={seedMut.isPending}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-40"
            >
              {seedMut.isPending ? "추가 중…" : `${year}년 법정공휴일 일괄 추가`}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-3">
          <input
            type="date"
            value={newHoliday.date}
            onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })}
            className="px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs"
          />
          <input
            placeholder="휴일명"
            value={newHoliday.name}
            onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
            className="px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs"
          />
          <select
            value={newHoliday.type}
            onChange={(e) => setNewHoliday({ ...newHoliday, type: e.target.value as any })}
            className="px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs"
          >
            <option value="company">회사 지정</option>
            <option value="substitute">대체공휴일</option>
            <option value="legal">법정공휴일</option>
          </select>
          <button
            onClick={() => newHoliday.date && newHoliday.name && addHolidayMut.mutate()}
            disabled={!newHoliday.date || !newHoliday.name || addHolidayMut.isPending}
            className="px-2 py-1.5 bg-[var(--primary)] text-white rounded text-xs font-semibold disabled:opacity-40"
          >
            추가
          </button>
        </div>

        <div className="space-y-1 max-h-72 overflow-y-auto">
          {holidays.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-6">등록된 휴일이 없습니다.</p>
          ) : (
            holidays.map((h: any) => (
              <div key={h.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-[var(--text-muted)] w-24">{h.date}</span>
                  <span className="font-medium">{h.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg)] text-[var(--text-dim)]">
                    {h.type === "legal" ? "법정" : h.type === "substitute" ? "대체" : "회사"}
                  </span>
                </div>
                <button
                  onClick={() => h.id && delHolidayMut.mutate(h.id)}
                  className="text-[10px] text-red-400 hover:text-red-300"
                >
                  삭제
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
