"use client";

/**
 * 전자서명 통합 대시보드
 * - 전체 서명 요청 현황 (상태별 카운트)
 * - 필터/검색
 * - 일괄 리마인더
 * - 새 서명 요청 (문서 선택 → 다중 서명자 초대)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getDocuments } from "@/lib/queries";
import {
  getSignatureRequests,
  createBulkSignatureRequests,
  sendSignatureReminder,
  bulkSendReminders,
  cancelSignature,
  getSignatureStatusInfo,
  SIGNATURE_STATUS,
  type SignatureStatusValue,
} from "@/lib/signatures";
import { useToast } from "@/components/toast";

type Signer = { name: string; email: string; phone: string };

export default function SignaturesDashboardPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | SignatureStatusValue>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showInviteModal, setShowInviteModal] = useState(false);

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
  });

  const bulkRemindMut = useMutation({
    mutationFn: (ids: string[]) => bulkSendReminders(ids),
    onSuccess: (r) => {
      toast(`발송 ${r.sent} / 실패 ${r.failed}`, r.failed === 0 ? "success" : "error");
      qc.invalidateQueries({ queryKey: ["signature-requests"] });
      setSelectedIds(new Set());
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelSignature(id),
    onSuccess: () => {
      toast("취소되었습니다", "success");
      qc.invalidateQueries({ queryKey: ["signature-requests"] });
    },
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
        <button
          onClick={() => setShowInviteModal(true)}
          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold hover:opacity-90"
        >
          + 새 서명 요청
        </button>
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
              <tr><td colSpan={8} className="p-12 text-center"><div className="text-3xl mb-2">✍️</div><div className="text-sm text-[var(--text-muted)]">서명 요청이 없습니다.</div></td></tr>
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
      toast(e.message || "요청 실패", "error");
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
