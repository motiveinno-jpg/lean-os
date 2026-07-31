"use client";

// 직원 엑셀 대량 초대 (2026-07-31 사장님)
//   흐름: ① 표준 양식(xlsx) 다운로드 → ② 채워서 업로드 → ③ 행별 검증 미리보기(오류 사유 표시)
//   → ④ 정상 행만 순차 초대(진행률) → ⑤ 결과 요약.
//   초대 경로는 단건 초대(EmployeeInviteSection)와 완전히 동일하다 —
//   employee_invitations 생성 → employees(status=invited) 행 생성 → 초대 메일 발송.
//   검증 규칙도 단건과 동일(이메일·부서 필수, 연봉은 연 단위 입력 → 월급으로 저장).

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { createEmployeeInvitation, getEmployeeInvitations, sendInviteEmail } from "@/lib/invitations";
import { todayKst } from "@/lib/kst";

type ParsedRow = {
  rowNo: number;        // 엑셀 행 번호(안내용)
  email: string;
  name: string;
  department: string;
  position: string;
  hireDate: string;     // YYYY-MM-DD (비면 초대 시 오늘)
  salary: number;       // 연봉(원). 0 = 미입력
  errors: string[];     // 비면 정상
};

type InviteResult = { row: ParsedRow; ok: boolean; warn?: string; error?: string };

const HEADERS = ["이메일*", "이름", "부서*", "직위", "입사일(YYYY-MM-DD)", "연봉(원)"];
const EXAMPLE = ["hong@company.com", "홍길동", "경영지원팀", "대리", "2026-08-01", 36000000];
const EXAMPLE_EMAIL = String(EXAMPLE[0]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 엑셀 셀 → YYYY-MM-DD (문자열/엑셀 직렬값/Date 모두 허용) */
function toYmd(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 20000) {
    // 엑셀 날짜 직렬값 (1900 기준)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim().replace(/[./]/g, "-");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return realDate(m[1], m[2], m[3]);
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return realDate(m2[1], m2[2], m2[3]);
  return null;
}

/** 실제로 존재하는 날짜만 통과 — 2026-13-45 같은 값이 그대로 DB(date)로 넘어가지 않게 한다. */
function realDate(y: string, mo: string, d: string): string | null {
  const ymd = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(`${ymd}T00:00:00Z`);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10) === ymd ? ymd : null;
}

/** 파일 내 중복·기존 직원/초대 대기와의 충돌까지 한 번에 검증한다. */
function parseRows(ws: XLSX.WorkSheet, taken: { employees: Set<string>; invited: Set<string> }): ParsedRow[] {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  const out: ParsedRow[] = [];
  const seen = new Set<string>();
  // 1행 = 헤더. 양식에 들어있는 예시 행은 자동 제외.
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] as unknown[];
    if (!r || r.every((c) => c == null || String(c).trim() === "")) continue;
    const [emailRaw, nameRaw, deptRaw, posRaw, hireRaw, salaryRaw] = r;
    const email = String(emailRaw ?? "").trim().toLowerCase();
    if (email === EXAMPLE_EMAIL) continue;

    const errors: string[] = [];
    if (!email) errors.push("이메일 누락");
    else if (!EMAIL_RE.test(email)) errors.push("이메일 형식 오류");
    else if (seen.has(email)) errors.push("파일 안에서 중복된 이메일");
    else if (taken.employees.has(email)) errors.push("이미 등록된 직원");
    else if (taken.invited.has(email)) errors.push("이미 초대 대기중인 이메일");
    if (email) seen.add(email);

    const department = String(deptRaw ?? "").trim();
    if (!department) errors.push("부서 누락");

    let hireDate = "";
    if (hireRaw != null && String(hireRaw).trim() !== "") {
      const ymd = toYmd(hireRaw);
      if (!ymd) errors.push("입사일 형식(YYYY-MM-DD) 오류");
      else hireDate = ymd;
    }

    let salary = 0;
    if (salaryRaw != null && String(salaryRaw).trim() !== "") {
      const n = Number(String(salaryRaw).replace(/[,원\s₩]/g, ""));
      if (!Number.isFinite(n) || n < 0) errors.push("연봉이 숫자가 아님");
      else salary = Math.round(n);
    }

    out.push({
      rowNo: i + 1,
      email,
      name: String(nameRaw ?? "").trim(),
      department,
      position: String(posRaw ?? "").trim(),
      hireDate,
      salary,
      errors,
    });
  }
  return out;
}

export function downloadBulkInviteTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, EXAMPLE]);
  ws["!cols"] = [26, 12, 16, 12, 20, 14].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "직원초대");
  XLSX.writeFile(wb, "직원_대량초대_양식.xlsx");
}

export function EmployeeBulkInviteModal({ companyId, userId, companyName, onClose, onDone }: {
  companyId: string;
  userId: string;
  companyName?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<InviteResult[] | null>(null);

  // 중복 검증 기준 — 이미 등록된 직원 + 초대 대기중 이메일
  const { data: existingEmails = [] } = useQuery({
    queryKey: ["employee-emails", companyId],
    queryFn: async () => {
      const data = logRead('employee-bulk-invite:emails', await supabase
        .from("employees").select("email").eq("company_id", companyId));
      return ((data as any[]) || []).map((e) => String(e.email || "").toLowerCase()).filter(Boolean);
    },
    enabled: !!companyId,
  });
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["employee-invitations", companyId],
    queryFn: () => getEmployeeInvitations(companyId),
    enabled: !!companyId,
  });
  const taken = useMemo(() => ({
    employees: new Set<string>(existingEmails as string[]),
    invited: new Set<string>((pendingInvites as any[]).map((i) => String(i.email || "").toLowerCase()).filter(Boolean)),
  }), [existingEmails, pendingInvites]);

  const valid = useMemo(() => (rows || []).filter((r) => r.errors.length === 0), [rows]);
  const invalid = useMemo(() => (rows || []).filter((r) => r.errors.length > 0), [rows]);

  useModalKeys(true, () => { if (!inviting) onClose(); });

  const onFile = async (f: File) => {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const parsed = parseRows(wb.Sheets[wb.SheetNames[0]], taken);
      if (parsed.length === 0) { toast("엑셀에 데이터 행이 없습니다. 양식을 확인해주세요.", "error"); return; }
      setRows(parsed);
      setResults(null);
      setFileName(f.name);
    } catch {
      toast("엑셀 파일을 읽지 못했습니다. 양식 파일(.xlsx)인지 확인해주세요.", "error");
    }
  };

  const run = async () => {
    if (valid.length === 0) { toast("초대 가능한 정상 행이 없습니다.", "error"); return; }
    setInviting(true);
    setProgress(0);
    const out: InviteResult[] = [];
    for (let i = 0; i < valid.length; i++) {
      const r = valid[i];
      setProgress(i + 1);
      try {
        const invitation: any = await createEmployeeInvitation({
          companyId, email: r.email, name: r.name || undefined,
          role: "employee", invitedBy: userId,
        });
        const { error: empErr } = await supabase.from("employees").insert({
          company_id: companyId,
          name: r.name || r.email.split("@")[0],
          email: r.email,
          department: r.department || null,
          position: r.position || null,
          salary: Math.round(r.salary / 12),
          hire_date: r.hireDate || todayKst(),
          status: "invited",
        });
        // 직원 행 생성 실패는 초대 자체를 무효화하지 않는다(초대 수락 시 합류는 가능) — 경고로 표시.
        let warn = empErr ? `직원 정보 등록 실패: ${empErr.message}` : undefined;
        if (invitation?.invite_token) {
          const mail = await sendInviteEmail({
            email: invitation.email, name: invitation.name || undefined,
            role: invitation.role || "employee", inviteToken: invitation.invite_token,
            companyName: companyName || undefined,
          });
          if (!mail.success) {
            warn = [warn, `메일 발송 실패(${mail.error || "원인 미상"}) — 목록에서 재발송하세요`].filter(Boolean).join(" · ");
          }
        }
        out.push({ row: r, ok: true, warn });
      } catch (err: any) {
        const msg = String(err?.message || err || "");
        const dup = msg.includes("duplicate") || msg.includes("unique") || msg.includes("23505");
        out.push({ row: r, ok: false, error: dup ? "이미 초대된 이메일" : (msg || "초대 실패") });
      }
    }
    setResults(out);
    setInviting(false);
    onDone();
    const ok = out.filter((x) => x.ok).length;
    const fail = out.length - ok;
    toast(fail === 0 ? `${ok}명 초대 완료` : `${ok}명 초대 · ${fail}명 실패`, fail === 0 ? "success" : "info");
  };

  const won = (n: number) => "₩" + n.toLocaleString("ko-KR");

  return (
    <div className="bulk-invite-overlay" onClick={() => { if (!inviting) onClose(); }}>
      <div className="bulk-invite-modal glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="bulk-invite-head">
          <div>
            <h3 className="bulk-invite-title">엑셀로 직원 대량 초대</h3>
            <p className="bulk-invite-sub">
              양식을 내려받아 채운 뒤 업로드하면, 행별 검증 → 초대 메일 발송까지 한 번에 진행됩니다.
              초대받은 직원이 가입하면 구성원으로 합류합니다.
            </p>
          </div>
          <button onClick={() => { if (!inviting) onClose(); }} className="bulk-invite-close" aria-label="닫기">✕</button>
        </div>

        {/* 1단계 — 양식 안내 / 업로드 */}
        {!rows && !results && (
          <div className="bulk-invite-step1">
            <div className="bulk-invite-guide">
              <div className="bulk-invite-guide-title">엑셀 양식 (첫 줄은 머리글, 두 번째 줄부터 직원 1명 = 1행)</div>
              <div className="bulk-invite-guide-table-wrap">
                <table className="bulk-invite-table">
                  <thead>
                    <tr>{HEADERS.map((h) => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr>{EXAMPLE.map((v, i) => <td key={i}>{typeof v === "number" ? v.toLocaleString("ko-KR") : v}</td>)}</tr>
                  </tbody>
                </table>
              </div>
              <ul className="bulk-invite-rules">
                <li><b>이메일</b>·<b>부서</b>는 필수입니다. 나머지는 비워두어도 됩니다.</li>
                <li><b>이름</b>을 비우면 이메일 앞부분이 이름으로 임시 등록됩니다(합류 후 수정 가능).</li>
                <li><b>입사일</b>은 YYYY-MM-DD (예: 2026-08-01). 비우면 초대일(오늘)로 설정됩니다.</li>
                <li><b>연봉</b>은 연 단위 금액을 숫자로 (콤마 있어도 됩니다). 월급은 12로 나눠 자동 계산됩니다.</li>
                <li>이미 등록된 직원·초대 대기중인 이메일, 파일 안 중복은 업로드 시 자동으로 걸러집니다.</li>
                <li>양식의 <b>예시 행(홍길동)</b>은 지우지 않아도 초대되지 않습니다.</li>
              </ul>
            </div>
            <div className="bulk-invite-step1-actions">
              <button onClick={downloadBulkInviteTemplate} className="btn-secondary">① 엑셀 양식 다운로드</button>
              <label className="btn-primary cursor-pointer">
                ② 채운 양식 업로드
                <input type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
              </label>
            </div>
          </div>
        )}

        {/* 2단계 — 검증 미리보기 */}
        {rows && !results && (
          <>
            <div className="bulk-invite-summary">
              <span className="bulk-invite-file">{fileName}</span>
              <span className="bulk-invite-count-ok">정상 {valid.length}명</span>
              {invalid.length > 0 && <span className="bulk-invite-count-bad">오류 {invalid.length}명 (초대 제외)</span>}
              <button className="bulk-invite-reset" onClick={() => { setRows(null); setFileName(""); }}>다른 파일</button>
            </div>
            <div className="bulk-invite-table-wrap">
              <table className="bulk-invite-table">
                <thead>
                  <tr>
                    <th>행</th><th>이메일</th><th>이름</th><th>부서</th><th>직위</th>
                    <th>입사일</th><th className="text-right">연봉</th><th>검증</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNo} className={r.errors.length ? "bulk-invite-row-bad" : ""}>
                      <td>{r.rowNo}</td>
                      <td>{r.email || "—"}</td>
                      <td>{r.name || "—"}</td>
                      <td>{r.department || "—"}</td>
                      <td>{r.position || "—"}</td>
                      <td>{r.hireDate || "오늘"}</td>
                      <td className="text-right mono-number">{r.salary ? won(r.salary) : "—"}</td>
                      <td>{r.errors.length ? <span className="bulk-invite-err">{r.errors.join(" · ")}</span> : <span className="bulk-invite-ok">정상</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bulk-invite-actions">
              {inviting ? (
                <div className="bulk-invite-progress">
                  <div className="bulk-invite-progress-bar"><div style={{ width: `${(progress / Math.max(1, valid.length)) * 100}%` }} /></div>
                  <span>{progress} / {valid.length} 초대 중… 창을 닫지 마세요</span>
                </div>
              ) : (
                <>
                  <button onClick={() => { setRows(null); setFileName(""); }} className="btn-secondary">취소</button>
                  <button onClick={run} className="btn-primary" disabled={valid.length === 0}>
                    {valid.length}명 초대 메일 발송
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* 3단계 — 결과 */}
        {results && (
          <>
            <div className="bulk-invite-summary">
              <span className="bulk-invite-count-ok">성공 {results.filter((r) => r.ok).length}명</span>
              {results.some((r) => !r.ok) && <span className="bulk-invite-count-bad">실패 {results.filter((r) => !r.ok).length}명</span>}
            </div>
            <div className="bulk-invite-table-wrap">
              <table className="bulk-invite-table">
                <thead><tr><th>행</th><th>이메일</th><th>이름</th><th>결과</th></tr></thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.row.rowNo} className={r.ok ? "" : "bulk-invite-row-bad"}>
                      <td>{r.row.rowNo}</td>
                      <td>{r.row.email}</td>
                      <td>{r.row.name || "—"}</td>
                      <td>{r.ok
                        ? (r.warn ? <span className="bulk-invite-warn">초대됨 · {r.warn}</span> : <span className="bulk-invite-ok">초대 메일 발송 완료</span>)
                        : <span className="bulk-invite-err">{r.error}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bulk-invite-actions">
              <button onClick={onClose} className="btn-primary">닫기</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
