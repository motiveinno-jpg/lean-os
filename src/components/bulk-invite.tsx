"use client";

import { useState, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createPartnerInvitation,
  createEmployeeInvitation,
  sendInviteEmail,
} from "@/lib/invitations";
import { useUser } from "@/components/user-context";

interface CsvRow {
  email: string;
  name: string;
  role: "partner" | "employee";
  isValid: boolean;
  error?: string;
}

interface InviteResult {
  email: string;
  isSuccess: boolean;
  message: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ["partner", "employee"] as const;

function parseCsvContent(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return [];

  const startIndex = lines[0].toLowerCase().includes("email") ? 1 : 0;
  const rows: CsvRow[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
    const [email = "", name = "", roleRaw = ""] = parts;
    const role = roleRaw.toLowerCase() as "partner" | "employee";

    let isValid = true;
    let error: string | undefined;

    if (!email) {
      isValid = false;
      error = "이메일 누락";
    } else if (!EMAIL_REGEX.test(email)) {
      isValid = false;
      error = "이메일 형식 오류";
    } else if (!VALID_ROLES.includes(role)) {
      isValid = false;
      error = `역할은 partner 또는 employee만 가능 (입력값: ${roleRaw || "없음"})`;
    }

    rows.push({ email, name, role, isValid, error });
  }

  return rows;
}

interface BulkInviteProps {
  companyId: string;
  companyName?: string;
}

export default function BulkInvite({ companyId, companyName }: BulkInviteProps) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [results, setResults] = useState<InviteResult[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const validRows = csvRows.filter((r) => r.isValid);
  const invalidRows = csvRows.filter((r) => !r.isValid);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      alert("CSV 파일만 업로드할 수 있습니다.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCsvContent(text);
      setCsvRows(rows);
      setResults([]);
      setProgress(0);
    };
    reader.readAsText(file, "utf-8");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFile],
  );

  const sendInvitations = async () => {
    if (!user || !companyId || validRows.length === 0) return;

    setIsSending(true);
    setResults([]);
    setProgress(0);
    setTotalCount(validRows.length);

    const batchResults: InviteResult[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        let data: any;

        if (row.role === "partner") {
          data = await createPartnerInvitation({
            companyId,
            email: row.email,
            name: row.name || undefined,
          });
        } else {
          data = await createEmployeeInvitation({
            companyId,
            email: row.email,
            name: row.name || undefined,
            role: "employee",
            invitedBy: user.id,
          });
        }

        if (data?.invite_token) {
          await sendInviteEmail({
            email: row.email,
            name: row.name || undefined,
            role: row.role,
            inviteToken: data.invite_token,
            companyName: companyName || undefined,
          });
        }

        batchResults.push({
          email: row.email,
          isSuccess: true,
          message: "초대 완료",
        });
      } catch (err: any) {
        const msg = err.message || "초대 실패";
        const isDuplicate =
          msg.includes("duplicate") || msg.includes("unique") || msg.includes("23505");
        batchResults.push({
          email: row.email,
          isSuccess: false,
          message: isDuplicate ? "이미 초대된 이메일" : msg,
        });
      }

      setProgress(i + 1);
      setResults([...batchResults]);
    }

    setIsSending(false);
    queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
    queryClient.invalidateQueries({ queryKey: ["partner-invitations"] });
  };

  const reset = () => {
    setCsvRows([]);
    setResults([]);
    setProgress(0);
    setTotalCount(0);
  };

  const successCount = results.filter((r) => r.isSuccess).length;
  const failureCount = results.filter((r) => !r.isSuccess).length;

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 space-y-5">
      <div>
        <h2 className="text-sm font-bold">대량 초대</h2>
        <p className="text-xs text-[var(--text-dim)] mt-0.5">
          CSV 파일로 여러 명을 한 번에 초대합니다
        </p>
      </div>

      {/* CSV Format Guide */}
      <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 space-y-1.5">
        <p className="font-semibold">CSV 형식 안내</p>
        <p>
          열 순서: <code className="bg-blue-500/20 px-1 rounded">email,name,role</code>
        </p>
        <p>
          role 값: <code className="bg-blue-500/20 px-1 rounded">partner</code> 또는{" "}
          <code className="bg-blue-500/20 px-1 rounded">employee</code>
        </p>
        <div className="mt-1 p-2 rounded-lg bg-[var(--bg)] text-[var(--text-muted)] font-mono text-[10px] leading-relaxed">
          email,name,role
          <br />
          hong@company.com,홍길동,employee
          <br />
          kim@partner.co.kr,김파트너,partner
        </div>
      </div>

      {/* Upload Area */}
      {csvRows.length === 0 && results.length === 0 && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition cursor-pointer ${
            isDragOver
              ? "border-[var(--primary)] bg-[var(--primary-light)]"
              : "border-[var(--border)] hover:border-[var(--text-muted)]"
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileInput}
            className="hidden"
          />
          <svg
            className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
          <p className="text-sm text-[var(--text-muted)] font-medium">
            CSV 파일을 여기에 드래그하거나 클릭하여 업로드
          </p>
          <p className="text-xs text-[var(--text-dim)] mt-1">.csv 파일만 지원</p>
        </div>
      )}

      {/* Preview Table */}
      {csvRows.length > 0 && results.length === 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-muted)]">
              전체 <strong>{csvRows.length}</strong>건 / 유효{" "}
              <strong className="text-green-500">{validRows.length}</strong>건
              {invalidRows.length > 0 && (
                <>
                  {" "}
                  / 오류{" "}
                  <strong className="text-red-400">{invalidRows.length}</strong>건
                </>
              )}
            </p>
            <button
              onClick={reset}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              초기화
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--bg-surface)] sticky top-0">
                  <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">
                    이메일
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">
                    이름
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">
                    역할
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">
                    상태
                  </th>
                </tr>
              </thead>
              <tbody>
                {csvRows.map((row, idx) => (
                  <tr
                    key={idx}
                    className={`border-t border-[var(--border)] ${
                      !row.isValid ? "bg-red-500/5" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono">{row.email || "-"}</td>
                    <td className="px-3 py-2">{row.name || "-"}</td>
                    <td className="px-3 py-2">
                      {row.role === "partner" ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#7C3AED] text-white">
                          파트너
                        </span>
                      ) : row.role === "employee" ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#059669] text-white">
                          직원
                        </span>
                      ) : (
                        <span className="text-red-400">{row.role || "-"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.isValid ? (
                        <span className="text-green-500">OK</span>
                      ) : (
                        <span className="text-red-400">{row.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={sendInvitations}
            disabled={validRows.length === 0 || isSending}
            className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            {validRows.length}명에게 초대 전송
          </button>
        </div>
      )}

      {/* Progress */}
      {isSending && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>초대 전송 중...</span>
            <span>
              {progress} / {totalCount}
            </span>
          </div>
          <div className="h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--primary)] rounded-full transition-all duration-300"
              style={{ width: `${totalCount > 0 ? (progress / totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Results */}
      {!isSending && results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-500 font-semibold">
                성공 {successCount}건
              </span>
              {failureCount > 0 && (
                <span className="text-red-400 font-semibold">
                  실패 {failureCount}건
                </span>
              )}
            </div>
            <button
              onClick={reset}
              className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold"
            >
              새로 업로드
            </button>
          </div>

          <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--bg-surface)] sticky top-0">
                  <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">
                    이메일
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">
                    결과
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, idx) => (
                  <tr key={idx} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-mono">{r.email}</td>
                    <td className="px-3 py-2">
                      {r.isSuccess ? (
                        <span className="text-green-500">{r.message}</span>
                      ) : (
                        <span className="text-red-400">{r.message}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
