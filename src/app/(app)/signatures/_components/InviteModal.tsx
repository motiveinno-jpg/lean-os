"use client";

import { useMemo, useState } from "react";
import { createBulkSignatureRequests } from "@/lib/signatures";
import { materializeDocTemplate } from "@/lib/documents";
import { isHrType } from "@/components/templates-tab";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useModalKeys } from "@/hooks/use-modal-keys";

type Signer = { name: string; email: string; phone: string };

const TPL_PREFIX = "tpl:";

// ── Invite Modal ──
export function InviteModal({
  companyId,
  userId,
  documents,
  docTemplates = [],
  onClose,
  onCreated,
}: {
  companyId: string;
  userId: string;
  documents: any[];
  docTemplates?: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [docId, setDocId] = useState<string>("");
  // 양식 관리(doc_templates)에 등록된 것도 발송 목록에 노출 — 선택 시 실제 documents 행으로 실체화.
  const bizTemplates = useMemo(() => docTemplates.filter((t: any) => !isHrType(t.type)), [docTemplates]);
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
      let realDocId = docId;
      let doc = documents.find((d) => d.id === docId);
      if (!doc && docId.startsWith(TPL_PREFIX)) {
        const tpl = bizTemplates.find((t: any) => `${TPL_PREFIX}${t.id}` === docId);
        if (!tpl) throw new Error("선택한 양식을 찾을 수 없습니다");
        doc = await materializeDocTemplate(companyId, tpl);
        realDocId = doc.id;
      }
      const r = await createBulkSignatureRequests({
        companyId,
        documentId: realDocId,
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

  useModalKeys(true, onClose, submitting || validSigners.length === 0 || !docId ? undefined : submit);

  return (
    <div className="signature-invite-modal fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
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
                const raw = e.target.value;
                const d = documents.find((x) => x.id === raw) || bizTemplates.find((t: any) => `${TPL_PREFIX}${t.id}` === raw);
                if (d && !title) setTitle(d.name || "");
              }}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
            >
              <option value="">— 선택 —</option>
              {documents.length > 0 && (
                <optgroup label="문서">
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.status})
                    </option>
                  ))}
                </optgroup>
              )}
              {bizTemplates.length > 0 && (
                <optgroup label="양식 (선택 시 문서로 생성)">
                  {bizTemplates.map((t: any) => (
                    <option key={t.id} value={`${TPL_PREFIX}${t.id}`}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
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
            <div className="signature-invite-signer-rows space-y-2">
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
          <button onClick={onClose} className="btn-secondary">
            취소
          </button>
          <button
            onClick={submit}
            disabled={submitting || validSigners.length === 0 || !docId}
            className="btn-primary"
          >
            {submitting ? "생성 중..." : `${validSigners.length}건 요청 생성`}
          </button>
        </div>
      </div>
    </div>
  );
}

