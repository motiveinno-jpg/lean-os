"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getPrograms,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  getProgramStats,
  getProgramDeals,
  bulkCreateDeals,
  bulkUpdateDealStatus,
  parseProgramCsv,
  updateDealColumnValue,
  getDealColumnValue,
  updateProgramColumns,
  generateColumnId,
  exportProgramToCsv,
  type Program,
  type DealTemplate,
  type BulkDealRow,
  type ColumnConfig,
  type LabelOption,
  type ColumnType,
} from "@/lib/programs";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";

// ─── Status Config ───────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  active: "진행중",
  pending: "대기",
  completed: "완료",
  archived: "아카이브",
  negotiation: "협상중",
  proposal: "제안",
  contract_signed: "계약완료",
  in_progress: "진행중",
  closed_won: "수주",
  closed_lost: "실주",
  dormant: "휴면",
};

const STATUS_OPTIONS = [
  { value: "pending", label: "대기" },
  { value: "active", label: "진행중" },
  { value: "in_progress", label: "작업중" },
  { value: "contract_signed", label: "계약완료" },
  { value: "completed", label: "완료" },
  { value: "closed_won", label: "수주" },
  { value: "closed_lost", label: "실주" },
];

const DEFAULT_LABEL_COLORS = [
  "#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#F97316", "#6366F1", "#14B8A6",
];

function formatAmount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return n.toLocaleString();
}

// ─── Program Cards (List View) ───────────────────────────

interface ProgramCardsProps {
  companyId: string;
  onSelectProgram: (id: string) => void;
  onCreateProgram: () => void;
}

export function ProgramCards({
  companyId,
  onSelectProgram,
  onCreateProgram,
}: ProgramCardsProps) {
  const { data: programs = [], isLoading } = useQuery({
    queryKey: ["programs", companyId],
    queryFn: () => getPrograms(companyId),
    enabled: !!companyId,
  });

  if (isLoading) return null;
  if (programs.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-[var(--text-muted)]">
          프로젝트 ({programs.length}) <span className="text-[10px] font-medium text-[var(--text-dim)] ml-1">· 프로젝트 안에 프로젝트가 들어갑니다</span>
        </h2>
        <button
          onClick={onCreateProgram}
          className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold transition"
        >
          + 새 프로젝트
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {programs.map((p) => (
          <ProgramCard key={p.id} program={p} onClick={() => onSelectProgram(p.id)} />
        ))}
      </div>
    </div>
  );
}

function ProgramCard({
  program,
  onClick,
}: {
  program: Program;
  onClick: () => void;
}) {
  const { data: stats } = useQuery({
    queryKey: ["program-stats", program.id],
    queryFn: () => getProgramStats(program.id),
  });

  const progress =
    stats && stats.totalDeals > 0
      ? Math.round((stats.completedDeals / stats.totalDeals) * 100)
      : 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 hover:border-[var(--primary)]/40 transition group"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold group-hover:text-[var(--primary)] transition truncate">
            {program.name}
          </h3>
          {program.description && (
            <p className="text-xs text-[var(--text-dim)] mt-0.5 truncate">
              {program.description}
            </p>
          )}
        </div>
        <span
          className={`ml-2 text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
            program.status === "active"
              ? "bg-green-500/10 text-green-400"
              : program.status === "completed"
                ? "bg-blue-500/10 text-blue-400"
                : "bg-gray-500/10 text-gray-400"
          }`}
        >
          {program.status === "active"
            ? "진행중"
            : program.status === "completed"
              ? "완료"
              : "아카이브"}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] mb-2">
        <span>
          총 <strong className="text-[var(--text)]">{formatAmount(program.total_budget)}원</strong>
        </span>
        {stats && (
          <>
            <span>
              <strong className="text-[var(--text)]">{stats.totalDeals}</strong>개사
            </span>
            <span>
              파트너 <strong className="text-[var(--text)]">{stats.partners.length}</strong>곳
            </span>
          </>
        )}
      </div>

      {stats && stats.totalDeals > 0 && (
        <div>
          <div className="flex items-center justify-between text-[10px] text-[var(--text-dim)] mb-1">
            <span>
              완료 {stats.completedDeals}/{stats.totalDeals}
            </span>
            <span className="font-semibold text-[var(--primary)]">{progress}%</span>
          </div>
          <div className="h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--primary)] rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </button>
  );
}

// ─── Create Program Modal ────────────────────────────────

interface CreateProgramModalProps {
  companyId: string;
  onClose: () => void;
}

export function CreateProgramModal({
  companyId,
  onClose,
}: CreateProgramModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    description: "",
    totalBudget: "",
    classification: "B2B",
    defaultAmount: "",
    serviceScope: "",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("프로젝트명을 입력하세요");
      return createProgram({
        companyId,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        totalBudget: Number(form.totalBudget) || 0,
        dealTemplate: {
          classification: form.classification,
          defaultAmount: Number(form.defaultAmount) || undefined,
          serviceScope: form.serviceScope || undefined,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["programs"] });
      toast("프로젝트가 생성되었습니다", "success");
      onClose();
    },
    onError: (err: Error) => toast(friendlyError(err, "처리에 실패했습니다."), "error"),
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">새 프로젝트 생성</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">
              프로젝트명 *
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="예: 네이버 광고대행 정부사업"
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">설명</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="프로젝트 설명 (선택)"
              rows={2}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                총 예산 (원)
              </label>
              <input
                type="number"
                value={form.totalBudget}
                onChange={(e) => setForm({ ...form, totalBudget: e.target.value })}
                placeholder="1000000000"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">분류</label>
              <select
                value={form.classification}
                onChange={(e) => setForm({ ...form, classification: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              >
                <option value="B2B">B2B</option>
                <option value="B2C">B2C</option>
                <option value="B2G">B2G</option>
              </select>
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-4">
            <h3 className="text-xs font-bold text-[var(--text-muted)] mb-3">
              프로젝트 템플릿 (일괄 등록 시 기본값)
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  기본 금액 (원)
                </label>
                <input
                  type="number"
                  value={form.defaultAmount}
                  onChange={(e) =>
                    setForm({ ...form, defaultAmount: e.target.value })
                  }
                  placeholder="3000000"
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  서비스 범위
                </label>
                <textarea
                  value={form.serviceScope}
                  onChange={(e) =>
                    setForm({ ...form, serviceScope: e.target.value })
                  }
                  placeholder="예: 네이버 검색광고 세팅 + 키워드 최적화 + 월간 리포트"
                  rows={2}
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.name.trim() || mutation.isPending}
            className="flex-1 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            {mutation.isPending ? "생성 중..." : "프로젝트 생성"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-[var(--text-muted)] hover:text-[var(--text)] rounded-xl text-sm transition"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Monday-Style Spreadsheet Cell Components ───────────

function LabelCell({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: LabelOption[];
  onChange: (v: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const current = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className="w-full text-left px-2 py-1 rounded text-[10px] font-semibold transition hover:opacity-80"
        style={
          current
            ? { backgroundColor: current.color + "20", color: current.color }
            : { backgroundColor: "var(--bg-surface)", color: "var(--text-dim)" }
        }
      >
        {current?.label || "선택"}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg z-30 min-w-[120px] py-1">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={(e) => {
                e.stopPropagation();
                onChange(opt.value);
                setIsOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-surface)] transition flex items-center gap-2"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: opt.color }}
              />
              {opt.label}
            </button>
          ))}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setIsOpen(false);
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-surface)] transition"
          >
            선택 해제
          </button>
        </div>
      )}
    </div>
  );
}

function InlineEditCell({
  value,
  type,
  onSave,
}: {
  value: string | number | null;
  type: ColumnType;
  onSave: (v: string | number | null) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(String(value ?? ""));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isEditing, value]);

  const commit = () => {
    setIsEditing(false);
    if (type === "number") {
      const num = Number(draft.replace(/[^0-9.-]/g, ""));
      if (!isNaN(num) && draft.trim()) onSave(num);
      else if (!draft.trim()) onSave(null);
    } else {
      onSave(draft.trim() || null);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type={type === "date" ? "date" : type === "number" ? "text" : "text"}
        inputMode={type === "number" ? "numeric" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setIsEditing(false); }}
        onClick={(e) => e.stopPropagation()}
        className="w-full px-1.5 py-1 bg-[var(--bg)] border border-[var(--primary)] rounded text-xs focus:outline-none"
      />
    );
  }

  const display = type === "number" && value != null
    ? Number(value).toLocaleString()
    : type === "date" && value
      ? String(value).slice(0, 10)
      : String(value ?? "");

  return (
    <div
      onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
      className="w-full px-1.5 py-1 rounded text-xs cursor-text hover:bg-[var(--bg-surface)] transition min-h-[24px] truncate"
      title={display || "클릭하여 편집"}
    >
      {display || <span className="text-[var(--text-dim)] italic">-</span>}
    </div>
  );
}

// ─── Monday-Style Spreadsheet Table ─────────────────────

function SpreadsheetTable({
  deals,
  columns,
  selectedDeals,
  onToggleDeal,
  onToggleAll,
  onSelectDeal,
  onCellChange,
  onStatusChange,
}: {
  deals: any[];
  columns: ColumnConfig[];
  selectedDeals: Set<string>;
  onToggleDeal: (id: string) => void;
  onToggleAll: () => void;
  onSelectDeal?: (id: string) => void;
  onCellChange: (dealId: string, columnId: string, value: string | number | null) => void;
  onStatusChange: (dealId: string, status: string) => void;
}) {
  const [statusDropdown, setStatusDropdown] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!statusDropdown) return;
    const handler = (e: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusDropdown(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusDropdown]);

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[600px]">
          <thead>
            <tr className="bg-[var(--bg-surface)]">
              <th className="w-10 px-3 py-3 sticky left-0 bg-[var(--bg-surface)] z-10">
                <input
                  type="checkbox"
                  checked={selectedDeals.size === deals.length && deals.length > 0}
                  onChange={onToggleAll}
                  className="w-4 h-4 rounded border-[var(--border)] accent-[var(--primary)]"
                />
              </th>
              <th className="text-left px-3 py-3 font-semibold text-[var(--text-muted)] min-w-[140px] sticky left-10 bg-[var(--bg-surface)] z-10">
                업체명
              </th>
              <th className="text-left px-3 py-3 font-semibold text-[var(--text-muted)] min-w-[90px]">
                파트너
              </th>
              <th className="text-right px-3 py-3 font-semibold text-[var(--text-muted)] min-w-[100px]">
                금액
              </th>
              <th className="text-center px-3 py-3 font-semibold text-[var(--text-muted)] min-w-[80px]">
                상태
              </th>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className="text-left px-3 py-3 font-semibold text-[var(--text-muted)]"
                  style={{ minWidth: col.width || (col.type === "label" ? 100 : col.type === "number" ? 90 : 120) }}
                >
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deals.map((d: any) => {
              const scope = d.custom_scope || {};
              const colValues = scope.columns || {};
              return (
                <tr
                  key={d.id}
                  onClick={() => onSelectDeal?.(d.id)}
                  className="border-t border-[var(--border)] hover:bg-[var(--bg-surface)]/50 transition cursor-pointer group"
                >
                  <td className="px-3 py-2.5 sticky left-0 bg-[var(--bg-card)] group-hover:bg-[var(--bg-surface)]/50 z-10" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedDeals.has(d.id)}
                      onChange={() => onToggleDeal(d.id)}
                      className="w-4 h-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                  </td>
                  <td className="px-3 py-2.5 sticky left-10 bg-[var(--bg-card)] group-hover:bg-[var(--bg-surface)]/50 z-10">
                    <div className="font-semibold truncate max-w-[180px]">
                      {d.counterparty || d.name}
                    </div>
                    {scope.contactEmail && (
                      <div className="text-[var(--text-dim)] mt-0.5 truncate text-[10px]">
                        {scope.contactEmail}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--text-muted)]">
                    {scope.partnerName || "-"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold">
                    ₩{Number(d.contract_total || 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="relative" ref={statusDropdown === d.id ? statusRef : undefined}>
                      <button
                        onClick={() => setStatusDropdown(statusDropdown === d.id ? null : d.id)}
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer hover:opacity-80 transition ${
                          d.status === "completed" || d.status === "closed_won"
                            ? "bg-green-500/10 text-green-400"
                            : d.status === "active" || d.status === "in_progress"
                              ? "bg-yellow-500/10 text-yellow-400"
                              : "bg-gray-500/10 text-gray-400"
                        }`}
                      >
                        {STATUS_LABEL[d.status] || d.status || "대기"}
                      </button>
                      {statusDropdown === d.id && (
                        <div className="absolute top-full right-0 mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg z-30 min-w-[110px] py-1">
                          {STATUS_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => {
                                onStatusChange(d.id, opt.value);
                                setStatusDropdown(null);
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-surface)] transition ${
                                d.status === opt.value ? "text-[var(--primary)] font-semibold" : ""
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  {columns.map((col) => (
                    <td key={col.id} className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {col.type === "label" || col.type === "select" ? (
                        <LabelCell
                          value={colValues[col.id] ?? null}
                          options={col.options || []}
                          onChange={(v) => onCellChange(d.id, col.id, v || null)}
                        />
                      ) : (
                        <InlineEditCell
                          value={colValues[col.id] ?? null}
                          type={col.type}
                          onSave={(v) => onCellChange(d.id, col.id, v)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Label Filter Bar ───────────────────────────────────

function LabelFilterBar({
  columns,
  activeFilters,
  onToggleFilter,
  onClearAll,
}: {
  columns: ColumnConfig[];
  activeFilters: Record<string, Set<string>>;
  onToggleFilter: (columnId: string, value: string) => void;
  onClearAll: () => void;
}) {
  const labelColumns = columns.filter((c) => c.type === "label" && c.options && c.options.length > 0);
  if (labelColumns.length === 0) return null;

  const hasActiveFilter = Object.values(activeFilters).some((s) => s.size > 0);

  return (
    <div className="flex items-center gap-3 mb-3 flex-wrap">
      {labelColumns.map((col) => (
        <div key={col.id} className="flex items-center gap-1">
          <span className="text-[10px] text-[var(--text-dim)] font-semibold mr-1">{col.name}:</span>
          {col.options!.map((opt) => {
            const isActive = activeFilters[col.id]?.has(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() => onToggleFilter(col.id, opt.value)}
                className="px-2 py-0.5 rounded text-[10px] font-semibold transition"
                style={
                  isActive
                    ? { backgroundColor: opt.color + "30", color: opt.color, border: `1px solid ${opt.color}50` }
                    : { backgroundColor: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid transparent" }
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ))}
      {hasActiveFilter && (
        <button
          onClick={onClearAll}
          className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text)] underline"
        >
          필터 초기화
        </button>
      )}
    </div>
  );
}

// ─── Column Settings Panel ──────────────────────────────

function ColumnSettingsPanel({
  columns,
  onSave,
  onClose,
}: {
  columns: ColumnConfig[];
  onSave: (cols: ColumnConfig[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ColumnConfig[]>(
    columns.map((c) => ({ ...c, options: c.options?.map((o) => ({ ...o })) })),
  );
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<ColumnType>("text");

  const addColumn = () => {
    if (!newColName.trim()) return;
    const col: ColumnConfig = {
      id: generateColumnId(),
      name: newColName.trim(),
      type: newColType,
      options:
        newColType === "label"
          ? [
              { value: "todo", label: "할일", color: DEFAULT_LABEL_COLORS[0] },
              { value: "in_progress", label: "진행중", color: DEFAULT_LABEL_COLORS[1] },
              { value: "done", label: "완료", color: DEFAULT_LABEL_COLORS[2] },
            ]
          : undefined,
    };
    setDraft([...draft, col]);
    setNewColName("");
    setNewColType("text");
  };

  const removeColumn = (id: string) => {
    setDraft(draft.filter((c) => c.id !== id));
  };

  const moveColumn = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[idx], next[target]] = [next[target], next[idx]];
    setDraft(next);
  };

  const updateColumnName = (id: string, name: string) => {
    setDraft(draft.map((c) => (c.id === id ? { ...c, name } : c)));
  };

  const addLabelOption = (colId: string) => {
    setDraft(
      draft.map((c) => {
        if (c.id !== colId) return c;
        const opts = c.options || [];
        const colorIdx = opts.length % DEFAULT_LABEL_COLORS.length;
        return {
          ...c,
          options: [
            ...opts,
            { value: `opt_${Date.now()}`, label: "새 라벨", color: DEFAULT_LABEL_COLORS[colorIdx] },
          ],
        };
      }),
    );
  };

  const updateLabelOption = (colId: string, optIdx: number, field: "label" | "color", value: string) => {
    setDraft(
      draft.map((c) => {
        if (c.id !== colId) return c;
        const opts = (c.options || []).map((o, i) =>
          i === optIdx ? { ...o, [field]: value, value: field === "label" ? value.toLowerCase().replace(/\s+/g, "_") : o.value } : o,
        );
        return { ...c, options: opts };
      }),
    );
  };

  const removeLabelOption = (colId: string, optIdx: number) => {
    setDraft(
      draft.map((c) => {
        if (c.id !== colId) return c;
        return { ...c, options: (c.options || []).filter((_, i) => i !== optIdx) };
      }),
    );
  };

  const typeLabel: Record<ColumnType, string> = {
    text: "텍스트",
    number: "숫자",
    date: "날짜",
    label: "라벨",
    select: "선택",
  };

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold">컬럼 설정</h3>
        <button onClick={onClose} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
          닫기
        </button>
      </div>

      {draft.length > 0 && (
        <div className="space-y-3 mb-4">
          {draft.map((col, idx) => (
            <div key={col.id} className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex gap-0.5">
                  <button
                    onClick={() => moveColumn(idx, -1)}
                    disabled={idx === 0}
                    className="p-1 text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30"
                    aria-label="위로"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button
                    onClick={() => moveColumn(idx, 1)}
                    disabled={idx === draft.length - 1}
                    className="p-1 text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30"
                    aria-label="아래로"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                </div>
                <input
                  value={col.name}
                  onChange={(e) => updateColumnName(col.id, e.target.value)}
                  className="flex-1 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]"
                />
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg)] text-[var(--text-dim)]">
                  {typeLabel[col.type]}
                </span>
                <button
                  onClick={() => removeColumn(col.id)}
                  className="p-1 text-red-400 hover:text-red-300"
                  aria-label="삭제"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {col.type === "label" && (
                <div className="ml-8 space-y-1.5">
                  {(col.options || []).map((opt, optIdx) => (
                    <div key={optIdx} className="flex items-center gap-2">
                      <input
                        type="color"
                        value={opt.color}
                        onChange={(e) => updateLabelOption(col.id, optIdx, "color", e.target.value)}
                        className="w-5 h-5 rounded border-0 cursor-pointer bg-transparent"
                      />
                      <input
                        value={opt.label}
                        onChange={(e) => updateLabelOption(col.id, optIdx, "label", e.target.value)}
                        className="flex-1 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]"
                      />
                      <button
                        onClick={() => removeLabelOption(col.id, optIdx)}
                        className="p-0.5 text-[var(--text-dim)] hover:text-red-400"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addLabelOption(col.id)}
                    className="text-[10px] text-[var(--primary)] hover:underline"
                  >
                    + 라벨 추가
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--bg)] border border-dashed border-[var(--border)]">
        <input
          value={newColName}
          onChange={(e) => setNewColName(e.target.value)}
          placeholder="새 컬럼명"
          className="flex-1 px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]"
          onKeyDown={(e) => { if (e.key === "Enter") addColumn(); }}
        />
        <select
          value={newColType}
          onChange={(e) => setNewColType(e.target.value as ColumnType)}
          className="px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]"
        >
          <option value="text">텍스트</option>
          <option value="number">숫자</option>
          <option value="date">날짜</option>
          <option value="label">라벨</option>
        </select>
        <button
          onClick={addColumn}
          disabled={!newColName.trim()}
          className="px-3 py-1.5 bg-[var(--primary)] text-white rounded text-xs font-semibold disabled:opacity-50"
        >
          추가
        </button>
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={() => onSave(draft)}
          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold"
        >
          저장
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg text-xs"
        >
          취소
        </button>
      </div>
    </div>
  );
}

// ─── Program Detail Dashboard ────────────────────────────

interface ProgramDashboardProps {
  programId: string;
  companyId: string;
  onBack: () => void;
  onSelectDeal?: (dealId: string) => void;
}

export function ProgramDashboard({
  programId,
  companyId,
  onBack,
  onSelectDeal,
}: ProgramDashboardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<"all" | "partner" | "status" | "billing">("all");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterPartner, setFilterPartner] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());
  const [showCsvUpload, setShowCsvUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<BulkDealRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [isBulkCreating, setIsBulkCreating] = useState(false);
  const [bulkStatusAction, setBulkStatusAction] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [labelFilters, setLabelFilters] = useState<Record<string, Set<string>>>({});

  const { data: program } = useQuery({
    queryKey: ["program", programId],
    queryFn: () => getProgram(programId),
    enabled: !!programId,
  });

  const { data: stats } = useQuery({
    queryKey: ["program-stats", programId],
    queryFn: () => getProgramStats(programId),
    enabled: !!programId,
  });

  const {
    data: deals = [],
    isLoading,
  } = useQuery({
    queryKey: ["program-deals", programId, filterStatus, filterPartner, search],
    queryFn: () =>
      getProgramDeals(programId, {
        status: filterStatus || undefined,
        partnerCompanyId: filterPartner || undefined,
        search: search || undefined,
      }),
    enabled: !!programId,
  });

  const progress =
    stats && stats.totalDeals > 0
      ? Math.round((stats.completedDeals / stats.totalDeals) * 100)
      : 0;

  const template = (program?.deal_template as DealTemplate) || {};
  const customColumns: ColumnConfig[] = template.columns || [];

  // Apply label filters to deals
  const filteredDeals = deals.filter((d: any) => {
    const colValues = d.custom_scope?.columns || {};
    for (const [colId, filterValues] of Object.entries(labelFilters)) {
      if (filterValues.size === 0) continue;
      const cellValue = colValues[colId];
      if (!cellValue || !filterValues.has(String(cellValue))) return false;
    }
    return true;
  });

  // ── CSV Upload ──

  const handleCsvFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".csv")) {
        toast("CSV 파일만 업로드 가능합니다", "error");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const { rows, errors } = parseProgramCsv(text);
        setCsvRows(rows);
        setCsvErrors(errors);
      };
      reader.readAsText(file, "utf-8");
    },
    [toast],
  );

  const handleBulkCreate = async () => {
    if (!program || csvRows.length === 0) return;
    setIsBulkCreating(true);
    try {
      const result = await bulkCreateDeals({
        programId: program.id,
        companyId,
        template: (program.deal_template as DealTemplate) || {},
        rows: csvRows,
      });
      toast(
        `${result.success}건 생성 완료${result.failed > 0 ? `, ${result.failed}건 실패` : ""}`,
        result.failed > 0 ? "error" : "success",
      );
      setCsvRows([]);
      setCsvErrors([]);
      setShowCsvUpload(false);
      queryClient.invalidateQueries({ queryKey: ["program-deals"] });
      queryClient.invalidateQueries({ queryKey: ["program-stats"] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    } catch (err: any) {
      toast(friendlyError(err, "일괄 등록에 실패했습니다."), "error");
    }
    setIsBulkCreating(false);
  };

  // ── Bulk Status Change ──

  const handleBulkStatusChange = async (status: string) => {
    if (selectedDeals.size === 0) return;
    const ids = Array.from(selectedDeals);
    const { success } = await bulkUpdateDealStatus(ids, status);
    toast(`${success}건 상태 변경 완료`, "success");
    setSelectedDeals(new Set());
    setBulkStatusAction(null);
    queryClient.invalidateQueries({ queryKey: ["program-deals"] });
    queryClient.invalidateQueries({ queryKey: ["program-stats"] });
    queryClient.invalidateQueries({ queryKey: ["deals"] });
  };

  const toggleDeal = (id: string) => {
    setSelectedDeals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedDeals.size === filteredDeals.length && filteredDeals.length > 0) {
      setSelectedDeals(new Set());
    } else {
      setSelectedDeals(new Set(filteredDeals.map((d: any) => d.id)));
    }
  };

  // ── Cell value change ──

  const handleCellChange = async (dealId: string, columnId: string, value: string | number | null) => {
    try {
      await updateDealColumnValue(dealId, columnId, value);
      queryClient.invalidateQueries({ queryKey: ["program-deals"] });
    } catch {
      toast("값 저장 실패", "error");
    }
  };

  // ── Inline status change ──

  const handleStatusChange = async (dealId: string, status: string) => {
    const { success } = await bulkUpdateDealStatus([dealId], status);
    if (success) {
      queryClient.invalidateQueries({ queryKey: ["program-deals"] });
      queryClient.invalidateQueries({ queryKey: ["program-stats"] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    }
  };

  // ── Label filter toggle ──

  const handleToggleLabelFilter = (columnId: string, value: string) => {
    setLabelFilters((prev) => {
      const next = { ...prev };
      const set = new Set(prev[columnId] || []);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      next[columnId] = set;
      return next;
    });
  };

  // ── Column settings save ──

  const handleSaveColumns = async (cols: ColumnConfig[]) => {
    try {
      await updateProgramColumns(programId, cols);
      queryClient.invalidateQueries({ queryKey: ["program"] });
      toast("컬럼 설정이 저장되었습니다", "success");
      setShowColumnSettings(false);
    } catch {
      toast("컬럼 설정 저장 실패", "error");
    }
  };

  // ── Excel export ──

  const handleExport = () => {
    if (!program) return;
    exportProgramToCsv(program.name, filteredDeals, customColumns);
    toast("CSV 파일이 다운로드됩니다", "success");
  };

  // ── Program Settings (inline edit) ──

  const updateMut = useMutation({
    mutationFn: (updates: Parameters<typeof updateProgram>[1]) =>
      updateProgram(programId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["program"] });
      queryClient.invalidateQueries({ queryKey: ["programs"] });
      toast("프로젝트 정보가 수정되었습니다", "success");
      setShowSettings(false);
    },
    onError: (err: Error) => toast(friendlyError(err, "처리에 실패했습니다."), "error"),
  });

  if (!program) {
    return (
      <div className="text-center py-20 text-[var(--text-muted)] text-sm">
        로딩 중...
      </div>
    );
  }

  return (
    <div className="max-w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-[var(--bg-surface)] transition"
          aria-label="뒤로"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-extrabold truncate">{program.name}</h1>
          {program.description && (
            <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
              {program.description}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text)] bg-[var(--bg-surface)] rounded-lg transition"
        >
          설정
        </button>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <ProgramSettings
          program={program}
          onSave={(updates) => updateMut.mutate(updates)}
          onClose={() => setShowSettings(false)}
          isPending={updateMut.isPending}
        />
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="전체"
          value={`${stats?.totalDeals || 0}개사`}
          sub={`예산 ${formatAmount(program.total_budget)}원`}
        />
        <StatCard
          label="진행중"
          value={`${stats?.inProgressDeals || 0}`}
          color="text-yellow-400"
        />
        <StatCard
          label="완료"
          value={`${stats?.completedDeals || 0}`}
          sub={`${progress}%`}
          color="text-green-400"
        />
        <StatCard
          label="미수금"
          value={`${formatAmount(stats?.totalOutstanding || 0)}원`}
          color="text-red-400"
        />
      </div>

      {/* Progress Bar */}
      {stats && stats.totalDeals > 0 && (
        <div className="mb-6">
          <div className="h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--primary)] rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto">
        {(
          [
            { key: "all", label: "전체 프로젝트" },
            { key: "partner", label: "파트너별" },
            { key: "status", label: "상태별" },
            { key: "billing", label: "정산현황" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setFilterStatus(null);
              setFilterPartner(null);
            }}
            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
              tab === t.key
                ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"
            }`}
          >
            {t.label}
          </button>
        ))}

        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="업체명 검색..."
            className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs w-40 focus:outline-none focus:border-[var(--primary)]"
          />
          <button
            onClick={() => setShowColumnSettings(!showColumnSettings)}
            className="px-3 py-2 bg-[var(--bg-surface)] hover:bg-[var(--border)] rounded-lg text-xs font-semibold transition"
            title="컬럼 설정"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
          </button>
          <button
            onClick={handleExport}
            disabled={filteredDeals.length === 0}
            className="px-3 py-2 bg-[var(--bg-surface)] hover:bg-[var(--border)] rounded-lg text-xs font-semibold transition disabled:opacity-50"
            title="엑셀 내보내기"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </button>
          <button
            onClick={() => setShowCsvUpload(!showCsvUpload)}
            className="px-3 py-2 bg-[var(--bg-surface)] hover:bg-[var(--border)] rounded-lg text-xs font-semibold transition"
          >
            CSV 일괄등록
          </button>
        </div>
      </div>

      {/* Column Settings */}
      {showColumnSettings && (
        <ColumnSettingsPanel
          columns={customColumns}
          onSave={handleSaveColumns}
          onClose={() => setShowColumnSettings(false)}
        />
      )}

      {/* CSV Upload Section */}
      {showCsvUpload && (
        <CsvUploadSection
          fileInputRef={fileInputRef}
          csvRows={csvRows}
          csvErrors={csvErrors}
          isBulkCreating={isBulkCreating}
          template={(program.deal_template as DealTemplate) || {}}
          onFileChange={handleCsvFile}
          onBulkCreate={handleBulkCreate}
          onClose={() => {
            setShowCsvUpload(false);
            setCsvRows([]);
            setCsvErrors([]);
          }}
        />
      )}

      {/* Label Filters */}
      {tab === "all" && customColumns.length > 0 && (
        <LabelFilterBar
          columns={customColumns}
          activeFilters={labelFilters}
          onToggleFilter={handleToggleLabelFilter}
          onClearAll={() => setLabelFilters({})}
        />
      )}

      {/* Partner View */}
      {tab === "partner" && stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          <button
            onClick={() => setFilterPartner(null)}
            className={`text-left p-4 rounded-xl border transition ${
              !filterPartner
                ? "border-[var(--primary)] bg-[var(--primary)]/5"
                : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--primary)]/40"
            }`}
          >
            <div className="text-xs text-[var(--text-muted)]">전체</div>
            <div className="text-lg font-bold">{stats.totalDeals}개사</div>
          </button>
          {stats.partners.map((p) => (
            <button
              key={p.id}
              onClick={() =>
                setFilterPartner(filterPartner === p.id ? null : p.id)
              }
              className={`text-left p-4 rounded-xl border transition ${
                filterPartner === p.id
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--primary)]/40"
              }`}
            >
              <div className="text-xs text-[var(--text-muted)]">{p.name}</div>
              <div className="text-lg font-bold">{p.dealCount}개사</div>
            </button>
          ))}
          {stats.partners.length === 0 && (
            <div className="col-span-full text-center py-8 text-xs text-[var(--text-dim)]">
              배정된 파트너가 없습니다
            </div>
          )}
        </div>
      )}

      {/* Status View */}
      {tab === "status" && stats && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setFilterStatus(null)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
              !filterStatus
                ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
            }`}
          >
            전체 ({stats.totalDeals})
          </button>
          <button
            onClick={() => setFilterStatus("pending")}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
              filterStatus === "pending"
                ? "bg-gray-500/15 text-gray-400"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
            }`}
          >
            대기 ({stats.pendingDeals})
          </button>
          <button
            onClick={() => setFilterStatus("active")}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
              filterStatus === "active"
                ? "bg-yellow-500/15 text-yellow-400"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
            }`}
          >
            진행중 ({stats.inProgressDeals})
          </button>
          <button
            onClick={() => setFilterStatus("completed")}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
              filterStatus === "completed"
                ? "bg-green-500/15 text-green-400"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
            }`}
          >
            완료 ({stats.completedDeals})
          </button>
        </div>
      )}

      {/* Billing View */}
      {tab === "billing" && stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="text-xs text-[var(--text-muted)]">총 예산</div>
            <div className="text-lg font-bold mt-1">
              {formatAmount(program.total_budget)}원
            </div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="text-xs text-green-400">수금 완료</div>
            <div className="text-lg font-bold mt-1 text-green-400">
              {formatAmount(stats.totalCollected)}원
            </div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="text-xs text-red-400">미수금</div>
            <div className="text-lg font-bold mt-1 text-red-400">
              {formatAmount(stats.totalOutstanding)}원
            </div>
          </div>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selectedDeals.size > 0 && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-[var(--primary)]/5 border border-[var(--primary)]/20 rounded-xl">
          <span className="text-xs font-semibold text-[var(--primary)]">
            {selectedDeals.size}건 선택
          </span>
          <div className="relative">
            <button
              onClick={() =>
                setBulkStatusAction(bulkStatusAction ? null : "open")
              }
              className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold"
            >
              일괄 상태변경 ▾
            </button>
            {bulkStatusAction && (
              <div className="absolute top-full left-0 mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-lg z-20 min-w-[140px]">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleBulkStatusChange(opt.value)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-surface)] transition"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setSelectedDeals(new Set())}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            선택 해제
          </button>
        </div>
      )}

      {/* Deals Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-[var(--text-muted)]">
          로딩 중...
        </div>
      ) : filteredDeals.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-12 text-center">
          <div className="text-3xl mb-3">📋</div>
          <div className="text-sm font-bold mb-2">
            {search || Object.values(labelFilters).some((s) => s.size > 0)
              ? "검색/필터 결과가 없습니다"
              : "등록된 프로젝트가 없습니다"}
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            CSV로 업체를 일괄 등록하세요
          </p>
          <button
            onClick={() => setShowCsvUpload(true)}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold"
          >
            CSV 일괄등록
          </button>
        </div>
      ) : (
        <>
          {/* Desktop: Monday-style Spreadsheet */}
          <div className="hidden sm:block">
            <SpreadsheetTable
              deals={filteredDeals}
              columns={customColumns}
              selectedDeals={selectedDeals}
              onToggleDeal={toggleDeal}
              onToggleAll={toggleAll}
              onSelectDeal={onSelectDeal}
              onCellChange={handleCellChange}
              onStatusChange={handleStatusChange}
            />
          </div>

          {/* Mobile Cards */}
          <div className="sm:hidden space-y-2">
            {filteredDeals.map((d: any) => {
              const scope = d.custom_scope || {};
              const colValues = scope.columns || {};
              return (
                <div
                  key={d.id}
                  onClick={() => onSelectDeal?.(d.id)}
                  className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 cursor-pointer hover:border-[var(--primary)]/40 transition"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedDeals.has(d.id)}
                      onChange={() => toggleDeal(d.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-[var(--border)] accent-[var(--primary)] mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold truncate">
                          {d.counterparty || d.name}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ml-2 ${
                            d.status === "completed" || d.status === "closed_won"
                              ? "bg-green-500/10 text-green-400"
                              : d.status === "active" || d.status === "in_progress"
                                ? "bg-yellow-500/10 text-yellow-400"
                                : "bg-gray-500/10 text-gray-400"
                          }`}
                        >
                          {STATUS_LABEL[d.status] || d.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                        <span>₩{Number(d.contract_total || 0).toLocaleString()}</span>
                        {scope.partnerName && (
                          <span>파트너: {scope.partnerName}</span>
                        )}
                      </div>
                      {customColumns.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {customColumns.map((col) => {
                            const val = colValues[col.id];
                            if (!val) return null;
                            if (col.type === "label") {
                              const opt = col.options?.find((o) => o.value === val);
                              if (!opt) return null;
                              return (
                                <span
                                  key={col.id}
                                  className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                                  style={{ backgroundColor: opt.color + "20", color: opt.color }}
                                >
                                  {opt.label}
                                </span>
                              );
                            }
                            return (
                              <span key={col.id} className="text-[10px] text-[var(--text-dim)]">
                                {col.name}: {String(val)}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 text-xs text-[var(--text-dim)] text-right">
            총 {filteredDeals.length}건
            {filteredDeals.length !== deals.length && ` (전체 ${deals.length}건 중 필터됨)`}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-Components ──────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className={`text-lg font-bold mt-1 ${color || ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{sub}</div>}
    </div>
  );
}

function ProgramSettings({
  program,
  onSave,
  onClose,
  isPending,
}: {
  program: Program;
  onSave: (updates: any) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(program.name);
  const [description, setDescription] = useState(program.description || "");
  const [totalBudget, setTotalBudget] = useState(String(program.total_budget));
  const [status, setStatus] = useState(program.status);

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 mb-6">
      <h3 className="text-sm font-bold mb-4">프로젝트 설정</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">프로젝트명</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">총 예산</label>
          <input
            type="number"
            value={totalBudget}
            onChange={(e) => setTotalBudget(e.target.value)}
            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">상태</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
          >
            <option value="active">진행중</option>
            <option value="completed">완료</option>
            <option value="archived">아카이브</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">설명</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() =>
            onSave({
              name,
              description,
              total_budget: Number(totalBudget) || 0,
              status,
            })
          }
          disabled={isPending}
          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          {isPending ? "저장 중..." : "저장"}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg text-sm"
        >
          취소
        </button>
      </div>
    </div>
  );
}

function CsvUploadSection({
  fileInputRef,
  csvRows,
  csvErrors,
  isBulkCreating,
  template,
  onFileChange,
  onBulkCreate,
  onClose,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  csvRows: BulkDealRow[];
  csvErrors: string[];
  isBulkCreating: boolean;
  template: DealTemplate;
  onFileChange: (file: File) => void;
  onBulkCreate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold">CSV 일괄 등록</h3>
        <button
          onClick={onClose}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          닫기
        </button>
      </div>

      {/* Format Guide */}
      <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 mb-4 space-y-1">
        <p className="font-semibold">CSV 형식</p>
        <p>
          열 순서:{" "}
          <code className="bg-blue-500/20 px-1 rounded">
            업체명,담당자,이메일,금액,파트너명
          </code>
        </p>
        <div className="mt-1 p-2 rounded-lg bg-[var(--bg)] text-[var(--text-muted)] font-mono text-[10px] leading-relaxed">
          업체명,담당자,이메일,금액,파트너명
          <br />
          A전자,김철수,kim@a.co.kr,3000000,콘텐츠팀X
          <br />
          B상사,이영희,lee@b.com,5000000,디자인팀Y
        </div>
        {template.defaultAmount && (
          <p className="mt-1">
            금액 미입력 시 기본값:{" "}
            <strong>{Number(template.defaultAmount).toLocaleString()}원</strong>
          </p>
        )}
      </div>

      {/* File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFileChange(f);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
        className="hidden"
      />

      {csvRows.length === 0 ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-8 border-2 border-dashed border-[var(--border)] rounded-xl text-sm text-[var(--text-muted)] hover:border-[var(--primary)] transition"
        >
          CSV 파일을 클릭하여 선택
        </button>
      ) : (
        <div>
          {csvErrors.length > 0 && (
            <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              {csvErrors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}

          <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--border)] mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--bg-surface)] sticky top-0">
                  <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">
                    업체명
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">
                    담당자
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-[var(--text-muted)]">
                    금액
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">
                    파트너
                  </th>
                </tr>
              </thead>
              <tbody>
                {csvRows.map((r, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-semibold">{r.counterparty}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {r.contactName || "-"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.amount
                        ? `₩${r.amount.toLocaleString()}`
                        : template.defaultAmount
                          ? `₩${Number(template.defaultAmount).toLocaleString()} (기본)`
                          : "-"}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {r.partnerName || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {csvRows.length}건 등록 예정
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                다시 선택
              </button>
              <button
                onClick={onBulkCreate}
                disabled={isBulkCreating}
                className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              >
                {isBulkCreating ? "등록 중..." : `${csvRows.length}건 일괄 등록`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
