"use client";

/**
 * 전자서명 통합 대시보드
 * - 전체 서명 요청 현황 (상태별 카운트)
 * - 필터/검색
 * - 일괄 리마인더
 * - 새 서명 요청 (문서 선택 → 다중 서명자 초대)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { friendlyError } from "@/lib/friendly-error";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getDocuments } from "@/lib/queries";
import {
  getSignatureRequests,
  createBulkSignatureRequests,
  createBulkSignatureRequestsToOrgs,
  type PartnerVarColumn,
  sendSignatureReminder,
  bulkSendReminders,
  cancelSignature,
  getSignatureStatusInfo,
  SIGNATURE_STATUS,
  type SignatureStatusValue,
} from "@/lib/signatures";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";

type Signer = { name: string; email: string; phone: string };

export default function SignaturesDashboardPage() {
  const { role } = useUser();
  if (role === "employee" || role === "partner") {
    return <AccessDenied detail="전자서명 대시보드는 대표·관리자 전용입니다." />;
  }
  const { toast } = useToast();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | SignatureStatusValue>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showOrgBulkWizard, setShowOrgBulkWizard] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setUserId(u.id);
        setCompanyId(u.company_id);
      }
    });
  }, []);

  const { data: requests = [], isLoading, error } = useQuery({
    queryKey: ["signature-requests", companyId],
    queryFn: () => getSignatureRequests(companyId!),
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["documents-for-sign", companyId],
    queryFn: () => getDocuments(companyId!),
    enabled: !!companyId,
  });

  const filtered = useMemo(() => {
    return (requests as any[]).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.title || ""} ${r.signer_name || ""} ${r.signer_email || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [requests, statusFilter, search]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: requests.length };
    for (const s of SIGNATURE_STATUS) map[s.value] = 0;
    for (const r of requests as any[]) {
      map[r.status] = (map[r.status] || 0) + 1;
    }
    return map;
  }, [requests]);

  const reminderMut = useMutation({
    mutationFn: (id: string) => sendSignatureReminder(id),
    onSuccess: (r) => {
      if (r.success) toast("리마인더 발송됨", "success");
      else toast(r.error || "리마인더 실패", "error");
      qc.invalidateQueries({ queryKey: ["signature-requests"] });
    },
    onError: (err: any) => toast("리마인더 발송 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const bulkRemindMut = useMutation({
    mutationFn: (ids: string[]) => bulkSendReminders(ids),
    onSuccess: (r) => {
      toast(`발송 ${r.sent} / 실패 ${r.failed}`, r.failed === 0 ? "success" : "error");
      qc.invalidateQueries({ queryKey: ["signature-requests"] });
      setSelectedIds(new Set());
    },
    onError: (err: any) => toast("일괄 리마인더 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelSignature(id),
    onSuccess: () => {
      toast("취소되었습니다", "success");
      qc.invalidateQueries({ queryKey: ["signature-requests"] });
    },
    onError: (err: any) => toast("서명 취소 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const toggleSel = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const remindableSelected = useMemo(() => {
    return Array.from(selectedIds).filter((id) => {
      const r = (requests as any[]).find((x) => x.id === id);
      return r && r.status !== "signed" && r.status !== "expired" && r.status !== "rejected";
    });
  }, [selectedIds, requests]);

  if (!companyId) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  if (error) return <div className="p-6 text-center text-red-400">데이터를 불러올 수 없습니다. 새로고침해 주세요.</div>;

  return (
    <div className="space-y-5 p-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">전자서명 대시보드</h1>
          <p className="text-sm text-[var(--text-muted)]">서명 요청 발송, 추적, 리마인더를 한곳에서 관리하세요.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOrgBulkWizard(true)}
            className="px-4 py-2 bg-[var(--bg-card)] border border-[var(--primary)] text-[var(--primary)] rounded-lg text-sm font-semibold hover:bg-[var(--primary)]/10"
            title="여러 거래처(미가입 단체)에 같은 계약서를 변수만 바꿔 한 번에 발송"
          >
            + 단체 일괄 발송
          </button>
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold hover:opacity-90"
          >
            + 새 서명 요청
          </button>
        </div>
      </header>

      {/* 상태 카운트 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <button
          onClick={() => setStatusFilter("all")}
          className={`p-3 rounded-lg border text-left transition ${
            statusFilter === "all"
              ? "bg-[var(--primary)]/10 border-[var(--primary)]"
              : "bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--text-muted)]"
          }`}
        >
          <div className="text-[10px] text-[var(--text-muted)]">전체</div>
          <div className="text-xl font-bold text-[var(--text)]">{counts.all || 0}</div>
        </button>
        {SIGNATURE_STATUS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`p-3 rounded-lg border text-left transition ${
              statusFilter === s.value
                ? `${s.bg} border-current ${s.text}`
                : "bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--text-muted)]"
            }`}
          >
            <div className={`text-[10px] flex items-center gap-1 ${s.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
              {s.label}
            </div>
            <div className="text-xl font-bold text-[var(--text)]">{counts[s.value] || 0}</div>
          </button>
        ))}
      </div>

      {/* 검색 / 일괄 액션 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="제목·서명자 검색..."
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-sm text-[var(--text)]"
        />
        {selectedIds.size > 0 && (
          <>
            <span className="text-xs text-[var(--text-muted)]">{selectedIds.size}건 선택됨</span>
            <button
              onClick={() => bulkRemindMut.mutate(remindableSelected)}
              disabled={remindableSelected.length === 0 || bulkRemindMut.isPending}
              className="px-3 py-2 bg-yellow-500/10 text-yellow-500 rounded-lg text-xs font-semibold hover:bg-yellow-500/20 disabled:opacity-50"
            >
              🔔 일괄 리마인더 ({remindableSelected.length})
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-2 bg-[var(--bg-card)] text-[var(--text-muted)] rounded-lg text-xs"
            >
              선택 해제
            </button>
          </>
        )}
      </div>

      {/* 테이블 */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
            <tr className="text-left">
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((r: any) => selectedIds.has(r.id))}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(new Set(filtered.map((r: any) => r.id)));
                    else setSelectedIds(new Set());
                  }}
                />
              </th>
              <th className="p-3 text-xs font-semibold">상태</th>
              <th className="p-3 text-xs font-semibold">제목</th>
              <th className="p-3 text-xs font-semibold">서명자</th>
              <th className="p-3 text-xs font-semibold">요청일</th>
              <th className="p-3 text-xs font-semibold">만료일</th>
              <th className="p-3 text-xs font-semibold">리마인더</th>
              <th className="p-3 text-xs font-semibold text-right">액션</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="p-8 text-center text-[var(--text-muted)]">불러오는 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="p-12 text-center"><div className="text-4xl mb-3">✍️</div><div className="text-sm font-medium text-[var(--text)]">문서에 서명을 요청해보세요</div><div className="text-xs text-[var(--text-muted)] mt-1">계약서, NDA 등 문서에 전자서명을 받을 수 있습니다</div><button onClick={() => setShowInviteModal(true)} className="mt-4 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold hover:opacity-90">+ 서명 요청</button></td></tr>
            ) : (
              filtered.map((r: any) => {
                const info = getSignatureStatusInfo(r.status);
                const expired = r.expires_at && new Date(r.expires_at) < new Date();
                const canRemind = r.status !== "signed" && r.status !== "expired" && r.status !== "rejected";
                return (
                  <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[var(--bg-surface)]/40">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSel(r.id)}
                      />
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${info.bg} ${info.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />
                        {info.label}
                      </span>
                    </td>
                    <td className="p-3">
                      {r.document_id ? (
                        <Link href={`/documents?id=${r.document_id}`} className="text-[var(--text)] hover:text-[var(--primary)] hover:underline">
                          {r.title}
                        </Link>
                      ) : (
                        <span className="text-[var(--text)]">{r.title}</span>
                      )}
                      {r.documents?.name && (
                        <div className="text-[10px] text-[var(--text-dim)]">{r.documents.name}</div>
                      )}
                      {r.batch_id && (
                        <span
                          className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--primary)]/10 text-[var(--primary)]"
                          title={`묶음 발송 #${r.batch_seq ?? "?"}`}
                        >
                          📦 묶음{r.batch_seq ? ` #${r.batch_seq}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="text-[var(--text)]">{r.signer_name}</div>
                      <div className="text-[10px] text-[var(--text-dim)]">{r.signer_email}</div>
                    </td>
                    <td className="p-3 text-xs text-[var(--text-muted)]">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString("ko-KR") : "—"}
                    </td>
                    <td className={`p-3 text-xs ${expired && r.status !== "signed" ? "text-red-500 font-semibold" : "text-[var(--text-muted)]"}`}>
                      {r.expires_at ? new Date(r.expires_at).toLocaleDateString("ko-KR") : "—"}
                    </td>
                    <td className="p-3 text-xs text-[var(--text-muted)]">
                      {r.reminder_count ? `${r.reminder_count}회` : "—"}
                    </td>
                    <td className="p-3 text-right space-x-1">
                      {canRemind && (
                        <button
                          onClick={() => reminderMut.mutate(r.id)}
                          disabled={reminderMut.isPending}
                          className="px-2 py-1 text-xs bg-yellow-500/10 text-yellow-500 rounded hover:bg-yellow-500/20"
                          title="리마인더 발송"
                        >
                          🔔
                        </button>
                      )}
                      {r.sign_token && (
                        <a
                          href={`/sign?token=${r.sign_token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 text-xs bg-[var(--primary)]/10 text-[var(--primary)] rounded hover:bg-[var(--primary)]/20 inline-block"
                          title="서명 링크"
                        >
                          🔗
                        </a>
                      )}
                      {canRemind && (
                        <button
                          onClick={() => {
                            if (confirm("이 서명 요청을 취소하시겠습니까?")) cancelMut.mutate(r.id);
                          }}
                          className="px-2 py-1 text-xs bg-red-500/10 text-red-500 rounded hover:bg-red-500/20"
                          title="취소"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showInviteModal && companyId && userId && (
        <InviteModal
          companyId={companyId}
          userId={userId}
          documents={documents as any[]}
          onClose={() => setShowInviteModal(false)}
          onCreated={() => {
            setShowInviteModal(false);
            qc.invalidateQueries({ queryKey: ["signature-requests"] });
          }}
        />
      )}

      {showOrgBulkWizard && companyId && userId && (
        <OrgBulkWizard
          companyId={companyId}
          userId={userId}
          documents={documents as any[]}
          onClose={() => setShowOrgBulkWizard(false)}
          onCreated={() => {
            setShowOrgBulkWizard(false);
            qc.invalidateQueries({ queryKey: ["signature-requests"] });
          }}
        />
      )}
    </div>
  );
}

// ── Invite Modal ──
function InviteModal({
  companyId,
  userId,
  documents,
  onClose,
  onCreated,
}: {
  companyId: string;
  userId: string;
  documents: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [docId, setDocId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [signers, setSigners] = useState<Signer[]>([{ name: "", email: "", phone: "" }]);
  const [sendNow, setSendNow] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const updateSigner = (i: number, field: keyof Signer, val: string) => {
    setSigners((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: val } : s)));
  };

  const addRow = () => setSigners((prev) => [...prev, { name: "", email: "", phone: "" }]);
  const removeRow = (i: number) => setSigners((prev) => prev.filter((_, idx) => idx !== i));

  const validSigners = signers.filter((s) => s.name.trim() && s.email.trim());

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const submit = async () => {
    if (!docId) {
      toast("문서를 선택하세요", "error");
      return;
    }
    if (validSigners.length === 0) {
      toast("서명자를 1명 이상 입력하세요", "error");
      return;
    }
    setSubmitting(true);
    try {
      const doc = documents.find((d) => d.id === docId);
      const r = await createBulkSignatureRequests({
        companyId,
        documentId: docId,
        title: title.trim() || doc?.name || "서명 요청",
        signers: validSigners.map((s) => ({ name: s.name.trim(), email: s.email.trim(), phone: s.phone.trim() })),
        createdBy: userId,
        sendEmails: sendNow,
      });
      toast(
        `생성 ${r.created} / 발송 ${r.sent}${r.failed ? ` / 실패 ${r.failed}` : ""}`,
        r.failed === 0 ? "success" : "error",
      );
      onCreated();
    } catch (e: any) {
      toast(friendlyError(e, "요청 실패"), "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-[var(--text)]">새 서명 요청</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">문서 선택 *</label>
            <select
              value={docId}
              onChange={(e) => {
                setDocId(e.target.value);
                const d = documents.find((x) => x.id === e.target.value);
                if (d && !title) setTitle(d.name || "");
              }}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
            >
              <option value="">— 선택 —</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">서명 요청 제목</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 2026년 공급계약서 서명"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-[var(--text-muted)]">서명자 ({validSigners.length}명)</label>
              <button onClick={addRow} className="text-xs text-[var(--primary)] hover:underline">+ 서명자 추가</button>
            </div>
            <div className="space-y-2">
              {signers.map((s, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    value={s.name}
                    onChange={(e) => updateSigner(i, "name", e.target.value)}
                    placeholder="이름"
                    className="col-span-3 px-2 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
                  />
                  <input
                    value={s.email}
                    onChange={(e) => updateSigner(i, "email", e.target.value)}
                    placeholder="이메일"
                    type="email"
                    className="col-span-5 px-2 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
                  />
                  <input
                    value={s.phone}
                    onChange={(e) => updateSigner(i, "phone", e.target.value)}
                    placeholder="010-xxxx-xxxx"
                    className="col-span-3 px-2 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
                  />
                  <button
                    onClick={() => removeRow(i)}
                    disabled={signers.length === 1}
                    className="col-span-1 text-[var(--text-dim)] hover:text-red-400 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--text)]">
            <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
            생성 즉시 이메일 발송
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] text-sm">
            취소
          </button>
          <button
            onClick={submit}
            disabled={submitting || validSigners.length === 0 || !docId}
            className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "생성 중..." : `${validSigners.length}건 요청 생성`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 단체(거래처) 일괄 발송 마법사 (5단계) ──
type OrgPartner = {
  id: string;
  name: string;
  type?: string | null;
  representative?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  business_number?: string | null;
  address?: string | null;
};

const PARTNER_COLUMN_LABELS: Record<PartnerVarColumn, string> = {
  name: "단체명",
  representative: "대표자",
  contact_name: "담당자",
  contact_email: "담당자 이메일",
  business_number: "사업자번호",
  address: "주소",
};

function autoMapToken(token: string): PartnerVarColumn | null {
  const t = token.replace(/\s+/g, "").toLowerCase();
  if (/(단체명|회사명|업체명|상호|법인명|partnername|companyname)/i.test(t)) return "name";
  if (/(대표자|대표|representative|ceo)/i.test(t)) return "representative";
  if (/(담당자|담당|contactname)/i.test(t) && !/이메일|email/i.test(t)) return "contact_name";
  if (/(이메일|메일|email|mail)/i.test(t)) return "contact_email";
  if (/(사업자번호|사업자등록번호|businessnumber|brn)/i.test(t)) return "business_number";
  if (/(주소|소재지|address|addr)/i.test(t)) return "address";
  return null;
}

function extractTokens(...sources: any[]): string[] {
  const seen = new Set<string>();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  for (const src of sources) {
    let s: string;
    if (src == null) continue;
    if (typeof src === "string") s = src;
    else {
      try { s = JSON.stringify(src); } catch { continue; }
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const name = m[1].trim();
      if (name) seen.add(name);
    }
  }
  return Array.from(seen);
}

function OrgBulkWizard({
  companyId,
  userId,
  documents,
  onClose,
  onCreated,
}: {
  companyId: string;
  userId: string;
  documents: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: 계약서 선택
  const [docId, setDocId] = useState<string>("");
  const selectedDoc = useMemo(() => documents.find((d) => d.id === docId), [documents, docId]);

  // Step 2: 거래처
  const [partners, setPartners] = useState<OrgPartner[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [pSearch, setPSearch] = useState("");
  const [pType, setPType] = useState("");
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingPartners(true);
      try {
        const { data } = await supabase
          .from("partners")
          .select("id, name, type, representative, contact_name, contact_email, business_number, address")
          .eq("company_id", companyId)
          .order("name", { ascending: true });
        if (alive) setPartners((data || []) as OrgPartner[]);
      } catch (e) {
        if (alive) toast(friendlyError(e, "거래처를 불러오지 못했습니다"), "error");
      } finally {
        if (alive) setLoadingPartners(false);
      }
    })();
    return () => { alive = false; };
  }, [companyId, toast]);

  const partnerTypes = useMemo(() => {
    const s = new Set<string>();
    for (const p of partners) if (p.type) s.add(p.type);
    return Array.from(s);
  }, [partners]);

  const filteredPartners = useMemo(() => {
    return partners.filter((p) => {
      if (pType && p.type !== pType) return false;
      if (pSearch) {
        const q = pSearch.toLowerCase();
        const hay = `${p.name || ""} ${p.contact_name || ""} ${p.representative || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [partners, pType, pSearch]);

  const selectedPartners = useMemo(
    () => partners.filter((p) => selectedPartnerIds.has(p.id)),
    [partners, selectedPartnerIds],
  );

  const togglePartner = (id: string, p?: OrgPartner) => {
    if (p && !p.contact_email) return; // 이메일 없으면 토글 불가
    setSelectedPartnerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Step 3: 변수 매핑
  const [titleTemplate, setTitleTemplate] = useState("");
  useEffect(() => {
    if (selectedDoc && !titleTemplate) {
      setTitleTemplate(`{{단체명}} - ${selectedDoc.name || "계약서"}`);
    }
  }, [selectedDoc, titleTemplate]);

  const tokens = useMemo(() => {
    const body = selectedDoc?.content_json;
    return extractTokens(titleTemplate, body);
  }, [selectedDoc, titleTemplate]);

  // partnerColumn 매핑 ('' 면 공통값)
  const [variableMap, setVariableMap] = useState<Record<string, PartnerVarColumn | "">>({});
  const [commonVariables, setCommonVariables] = useState<Record<string, string>>({});
  const [perPartnerOverrides, setPerPartnerOverrides] = useState<Record<string, Record<string, string>>>({});
  const [showOverrideTable, setShowOverrideTable] = useState(false);

  useEffect(() => {
    setVariableMap((prev) => {
      const next: Record<string, PartnerVarColumn | ""> = { ...prev };
      for (const t of tokens) {
        if (!(t in next)) next[t] = autoMapToken(t) ?? "";
      }
      // 토큰 사라진 키 정리
      for (const k of Object.keys(next)) {
        if (!tokens.includes(k)) delete next[k];
      }
      return next;
    });
    setCommonVariables((prev) => {
      const next: Record<string, string> = {};
      for (const t of tokens) next[t] = prev[t] ?? "";
      return next;
    });
  }, [tokens]);

  // Step 4: 발송자 / 만료
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [sendNow, setSendNow] = useState(true);

  // Step 5: 미리보기
  const previewPartner = selectedPartners[0] || null;
  const previewVars = useMemo(() => {
    if (!previewPartner) return {};
    const mapped: Record<string, string> = {};
    for (const [token, col] of Object.entries(variableMap)) {
      if (col) {
        const v = (previewPartner as any)[col];
        mapped[token] = v == null ? "" : String(v);
      } else {
        mapped[token] = commonVariables[token] ?? "";
      }
    }
    return { ...mapped, ...(perPartnerOverrides[previewPartner.id] || {}) };
  }, [previewPartner, variableMap, commonVariables, perPartnerOverrides]);

  const previewTitle = useMemo(() => {
    let s = titleTemplate;
    for (const [k, v] of Object.entries(previewVars)) {
      s = s.replace(new RegExp(`\\{\\{\\s*${k.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\}\\}`, "g"), v);
    }
    return s;
  }, [titleTemplate, previewVars]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const canNext = (() => {
    if (step === 1) return !!docId;
    if (step === 2) return selectedPartners.length > 0;
    if (step === 3) {
      // 공통값으로 매핑된 토큰은 값이 있어야 함 (덮어쓰기 표에서 일부 단체만 다르면 OK)
      for (const [token, col] of Object.entries(variableMap)) {
        if (!col && !(commonVariables[token] || "").trim()) {
          // 모든 단체에 덮어쓰기 있으면 통과
          const allOverridden = selectedPartners.every((p) => (perPartnerOverrides[p.id] || {})[token]);
          if (!allOverridden) return false;
        }
      }
      return !!titleTemplate.trim();
    }
    if (step === 4) return expiresInDays > 0 && expiresInDays <= 90;
    return true;
  })();

  const submit = async () => {
    if (!docId || selectedPartners.length === 0) return;
    setSubmitting(true);
    try {
      // variableMap → 빈 값('') 키는 commonVariables 쪽으로 보냄
      const finalMap: Record<string, PartnerVarColumn> = {};
      for (const [token, col] of Object.entries(variableMap)) {
        if (col) finalMap[token] = col;
      }
      const r = await createBulkSignatureRequestsToOrgs({
        companyId,
        createdBy: userId,
        documentId: docId,
        titleTemplate: titleTemplate.trim(),
        expiresInDays,
        partnerIds: selectedPartners.map((p) => p.id),
        variableMap: finalMap,
        commonVariables,
        perPartnerOverrides,
        sendEmails: sendNow,
      });
      const msg = `발송 ${r.sent}건 · 실패 ${r.failed}건 · 스킵 ${r.skipped.length}건`;
      toast(msg, r.failed === 0 && r.skipped.length === 0 ? "success" : "error");
      onCreated();
    } catch (e: any) {
      toast(friendlyError(e, "일괄 발송에 실패했습니다"), "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ── 렌더 ──
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 + 단계 인디케이터 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)]">단체 일괄 서명 발송</h2>
            <p className="text-xs text-[var(--text-muted)]">
              여러 거래처(미가입 단체)에 같은 계약서를 변수만 다르게 채워 한 번에 발송합니다.
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl">×</button>
        </div>

        <div className="flex items-center gap-1 mb-5 text-[11px]">
          {[
            { n: 1, label: "계약서" },
            { n: 2, label: "거래처" },
            { n: 3, label: "변수 매핑" },
            { n: 4, label: "발송/만료" },
            { n: 5, label: "미리보기" },
          ].map((s, i) => (
            <div key={s.n} className="flex items-center flex-1">
              <div
                className={`flex-1 px-2 py-1 rounded text-center font-semibold ${
                  step === s.n
                    ? "bg-[var(--primary)] text-white"
                    : step > s.n
                      ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                      : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                }`}
              >
                {s.n}. {s.label}
              </div>
              {i < 4 && <span className="px-1 text-[var(--text-dim)]">›</span>}
            </div>
          ))}
        </div>

        {/* Step 1: 계약서 */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold text-[var(--text)]">발송할 계약서를 선택하세요</div>
            <div className="text-xs text-[var(--text-muted)]">
              이미 작성된 계약서만 선택할 수 있습니다. 새 계약서가 필요하면 먼저{" "}
              <Link href="/documents" className="text-[var(--primary)] hover:underline">문서함</Link>
              에서 작성해 주세요.
            </div>
            <div className="border border-[var(--border)] rounded-lg max-h-[360px] overflow-y-auto">
              {documents.length === 0 ? (
                <div className="p-6 text-center text-sm text-[var(--text-muted)]">작성된 문서가 없습니다.</div>
              ) : (
                documents.map((d) => (
                  <label
                    key={d.id}
                    className={`flex items-center gap-3 p-3 cursor-pointer border-b border-[var(--border)] last:border-b-0 ${
                      docId === d.id ? "bg-[var(--primary)]/10" : "hover:bg-[var(--bg-surface)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="docId"
                      value={d.id}
                      checked={docId === d.id}
                      onChange={() => setDocId(d.id)}
                    />
                    <div className="flex-1">
                      <div className="text-sm text-[var(--text)]">{d.name}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {d.doc_templates?.name || d.doc_templates?.type || "—"} · 상태 {d.status}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        {/* Step 2: 거래처 */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={pSearch}
                onChange={(e) => setPSearch(e.target.value)}
                placeholder="단체명·담당자 검색"
                className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
              />
              {partnerTypes.length > 0 && (
                <select
                  value={pType}
                  onChange={(e) => setPType(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
                >
                  <option value="">전체 타입</option>
                  {partnerTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              <span className="text-xs text-[var(--text-muted)]">{selectedPartnerIds.size}곳 선택</span>
            </div>
            <div className="border border-[var(--border)] rounded-lg max-h-[400px] overflow-y-auto">
              {loadingPartners ? (
                <div className="p-6 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
              ) : filteredPartners.length === 0 ? (
                <div className="p-6 text-center text-sm text-[var(--text-muted)]">거래처가 없습니다.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)] sticky top-0">
                    <tr className="text-left">
                      <th className="p-2 w-10">
                        <input
                          type="checkbox"
                          checked={
                            filteredPartners.filter((p) => p.contact_email).length > 0 &&
                            filteredPartners.filter((p) => p.contact_email).every((p) => selectedPartnerIds.has(p.id))
                          }
                          onChange={(e) => {
                            setSelectedPartnerIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) {
                                for (const p of filteredPartners) if (p.contact_email) next.add(p.id);
                              } else {
                                for (const p of filteredPartners) next.delete(p.id);
                              }
                              return next;
                            });
                          }}
                        />
                      </th>
                      <th className="p-2 text-xs">단체명</th>
                      <th className="p-2 text-xs">대표자</th>
                      <th className="p-2 text-xs">담당자</th>
                      <th className="p-2 text-xs">이메일</th>
                      <th className="p-2 text-xs">사업자번호</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPartners.map((p) => {
                      const noEmail = !p.contact_email;
                      return (
                        <tr
                          key={p.id}
                          className={`border-t border-[var(--border)] ${
                            noEmail ? "opacity-60" : "hover:bg-[var(--bg-surface)]/40 cursor-pointer"
                          }`}
                          onClick={() => !noEmail && togglePartner(p.id, p)}
                        >
                          <td className="p-2">
                            <input
                              type="checkbox"
                              disabled={noEmail}
                              checked={selectedPartnerIds.has(p.id)}
                              onChange={() => togglePartner(p.id, p)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td className="p-2 text-[var(--text)]">{p.name}</td>
                          <td className="p-2 text-[var(--text-muted)]">{p.representative || "—"}</td>
                          <td className="p-2 text-[var(--text-muted)]">{p.contact_name || "—"}</td>
                          <td className="p-2 text-[var(--text-muted)] text-xs">
                            {p.contact_email ? (
                              p.contact_email
                            ) : (
                              <Link
                                href={`/partners?edit=${p.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-yellow-500 hover:underline"
                                title="이메일을 먼저 등록하세요"
                              >
                                ⚠ 이메일 등록 필요
                              </Link>
                            )}
                          </td>
                          <td className="p-2 text-[var(--text-muted)] text-xs">{p.business_number || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Step 3: 변수 매핑 */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">
                서명요청 제목 (토큰 사용 가능, 예: <code>{"{{단체명}}"}</code>)
              </label>
              <input
                value={titleTemplate}
                onChange={(e) => setTitleTemplate(e.target.value)}
                placeholder="{{단체명}} - 용역계약서"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
              />
            </div>

            {tokens.length === 0 ? (
              <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-xs text-[var(--text-muted)]">
                계약서·제목에서 <code>{"{{토큰}}"}</code> 형식 변수를 찾지 못했습니다. 그대로 발송됩니다.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-[var(--text-muted)]">
                  발견된 변수 {tokens.length}개 — 각 변수를 거래처 컬럼 또는 공통값에 연결하세요.
                </div>
                {tokens.map((token) => {
                  const col = variableMap[token] ?? "";
                  return (
                    <div key={token} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-3 px-2 py-1.5 rounded bg-[var(--bg-surface)] text-xs font-mono text-[var(--primary)]">
                        {`{{${token}}}`}
                      </div>
                      <select
                        value={col}
                        onChange={(e) => setVariableMap((prev) => ({ ...prev, [token]: e.target.value as PartnerVarColumn | "" }))}
                        className="col-span-4 px-2 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]"
                      >
                        <option value="">— 공통값 입력 —</option>
                        {(Object.keys(PARTNER_COLUMN_LABELS) as PartnerVarColumn[]).map((k) => (
                          <option key={k} value={k}>거래처 · {PARTNER_COLUMN_LABELS[k]}</option>
                        ))}
                      </select>
                      {col === "" ? (
                        <input
                          value={commonVariables[token] ?? ""}
                          onChange={(e) => setCommonVariables((prev) => ({ ...prev, [token]: e.target.value }))}
                          placeholder="공통값"
                          className="col-span-5 px-2 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]"
                        />
                      ) : (
                        <div className="col-span-5 text-[10px] text-[var(--text-muted)] px-2">
                          단체별 {PARTNER_COLUMN_LABELS[col]} 값으로 자동 치환
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 단체별 덮어쓰기 표 (접기/펴기) */}
                {selectedPartners.length > 0 && tokens.some((t) => !variableMap[t]) && (
                  <div className="mt-3">
                    <button
                      onClick={() => setShowOverrideTable((v) => !v)}
                      className="text-xs text-[var(--primary)] hover:underline"
                    >
                      {showOverrideTable ? "▾" : "▸"} 단체별 값 덮어쓰기 ({selectedPartners.length}곳)
                    </button>
                    {showOverrideTable && (
                      <div className="mt-2 border border-[var(--border)] rounded-lg overflow-x-auto">
                        <table className="text-xs w-full">
                          <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                            <tr>
                              <th className="p-2 text-left">단체</th>
                              {tokens.filter((t) => !variableMap[t]).map((t) => (
                                <th key={t} className="p-2 text-left font-mono">{`{{${t}}}`}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {selectedPartners.map((p) => (
                              <tr key={p.id} className="border-t border-[var(--border)]">
                                <td className="p-2 text-[var(--text)] whitespace-nowrap">{p.name}</td>
                                {tokens.filter((t) => !variableMap[t]).map((t) => (
                                  <td key={t} className="p-2">
                                    <input
                                      value={(perPartnerOverrides[p.id] || {})[t] ?? ""}
                                      onChange={(e) =>
                                        setPerPartnerOverrides((prev) => ({
                                          ...prev,
                                          [p.id]: { ...(prev[p.id] || {}), [t]: e.target.value },
                                        }))
                                      }
                                      placeholder={commonVariables[t] || "공통값과 동일"}
                                      className="w-full px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]"
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 4: 발송/만료 */}
        {step === 4 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">발송자</label>
              <div className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]">
                현재 로그인 사용자 (자동)
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">만료 기간 (일)</label>
              <input
                type="number"
                min={1}
                max={90}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number(e.target.value) || 14)}
                className="w-32 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
              />
              <span className="ml-2 text-xs text-[var(--text-muted)]">기본 14일 · 최대 90일</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text)]">
              <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
              생성 즉시 이메일 발송
            </label>
          </div>
        )}

        {/* Step 5: 미리보기 */}
        {step === 5 && (
          <div className="space-y-4">
            <div className="text-xs text-[var(--text-muted)]">
              아래는 선택한 거래처 중 첫 번째 단체 기준 미리보기입니다. 단체별로 값이 다르게 치환됩니다.
            </div>
            {!previewPartner ? (
              <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-yellow-500 text-sm">
                선택된 거래처가 없습니다.
              </div>
            ) : (
              <>
                <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] space-y-2">
                  <div className="text-[10px] text-[var(--text-muted)]">미리보기 대상</div>
                  <div className="text-sm text-[var(--text)] font-semibold">{previewPartner.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">→ {previewPartner.contact_email}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] mb-1">제목 (치환 결과)</div>
                  <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-sm text-[var(--text)]">
                    {previewTitle || "(빈 제목)"}
                  </div>
                </div>
                {tokens.length > 0 && (
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] mb-1">변수 치환 결과</div>
                    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                          <tr>
                            <th className="p-2 text-left">변수</th>
                            <th className="p-2 text-left">치환값</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tokens.map((t) => (
                            <tr key={t} className="border-t border-[var(--border)]">
                              <td className="p-2 font-mono text-[var(--primary)]">{`{{${t}}}`}</td>
                              <td className="p-2 text-[var(--text)]">{previewVars[t] || <span className="text-[var(--text-dim)]">(빈 값)</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div className="p-3 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5 text-xs text-[var(--text)]">
                  총 <b>{selectedPartners.length}곳</b>에 발송됩니다. (이메일 미등록 거래처는 자동 스킵)
                </div>
              </>
            )}
          </div>
        )}

        {/* 푸터 */}
        <div className="flex items-center justify-between gap-2 mt-6 pt-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] text-sm"
          >
            취소
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                onClick={() => setStep((s) => (s - 1) as 1|2|3|4|5)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text)] text-sm"
              >
                ← 이전
              </button>
            )}
            {step < 5 ? (
              <button
                onClick={() => setStep((s) => (s + 1) as 1|2|3|4|5)}
                disabled={!canNext}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                다음 →
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting || selectedPartners.length === 0}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "발송 중..." : `🚀 ${selectedPartners.length}곳 일괄 발송`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
