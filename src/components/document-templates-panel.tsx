"use client";

// 재사용 계약서 문서 관리 — "단체 일괄 발송"·"새 서명 요청"에서 실제로 골라 쓰는 documents
// 테이블 원본을 여기서 검색·확인하고 "열기"로 바로 이 화면 안에서 수정(모달)한다.
// 온라인홍보사업 개별계약서·소상공인 포기신청서처럼 문서함(파일보관함, 순수 파일 저장소로 단순화됨)
// 에서는 찾을 수 없던 "재사용 양식" 문서들이 이 목록에 뜬다.
// 사장님 요청(2026-07-13): 파일보관함으로 연동시키지 말고 전자계약 화면 안에서 완결되게 해달라 —
// /documents?id= 이동 대신 모달로 편집(RichEditor + saveRevision, 기존 저장 로직 재사용).

import { useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/lib/supabase";
import { saveRevision, DOC_STATUS } from "@/lib/documents";
import { RichEditor } from "@/components/rich-editor";
import { useModalKeys } from "@/hooks/use-modal-keys";

const TYPE_LABELS: Record<string, string> = {
  contract: "계약서",
  invoice: "견적서",
  quote: "제안서",
  nda: "비밀유지계약(NDA)",
  mou: "양해각서(MOU)",
  agreement: "업무제휴계약서",
};

export function DocumentTemplatesPanel({ userId, documents, onSaved }: {
  companyId: string;
  userId: string | null;
  documents: any[];
  onSaved?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = documents.filter((d: any) => !term || (d.name || "").toLowerCase().includes(term));
    return rows.sort((a: any, b: any) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [documents, search]);

  const visible = expanded ? filtered : filtered.slice(0, 8);

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-[var(--text)]">재사용 계약서 문서</h3>
          <p className="text-xs text-[var(--text-dim)] mt-1">
            "단체 일괄 발송"·"새 서명 요청"에서 고르는 문서 원본을 여기서 검색하고 수정합니다. (예: 온라인홍보사업 개별계약서, 소상공인 포기신청서)
          </p>
        </div>
        <span className="text-xs text-[var(--text-dim)]">{documents.length}건</span>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="문서명으로 검색... (예: 온라인홍보사업)"
        className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
      />

      {filtered.length === 0 ? (
        <div className="px-3 py-8 text-center text-[11px] text-[var(--text-dim)] bg-[var(--bg-surface)]/40 rounded-lg border border-dashed border-[var(--border)]">
          {search ? "검색 결과가 없습니다" : "등록된 문서가 없습니다"}
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)]/50">
          {visible.map((d: any) => {
            const contentType = d.content_json?.type || d.auto_classified_type || "contract";
            const typeLabel = TYPE_LABELS[contentType] || contentType;
            const sc = (DOC_STATUS as any)[d.status] || DOC_STATUS.draft;
            return (
              <div key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--text)] truncate">{d.name || "(제목 없음)"}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{typeLabel}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                    <span className="text-[10px] text-[var(--text-dim)]">
                      {d.created_at ? new Date(d.created_at).toLocaleDateString("ko") : "—"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(d)}
                  className="text-xs font-semibold text-[var(--primary)] hover:underline flex-shrink-0"
                >
                  열기 →
                </button>
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > 8 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] font-medium"
        >
          {expanded ? "접기" : `전체 ${filtered.length}건 보기`}
        </button>
      )}

      {editing && (
        <DocumentEditModal
          doc={editing}
          userId={userId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onSaved?.(); }}
        />
      )}
    </div>
  );
}

// ── 문서 편집 모달 — 이름·본문(RichEditor) 수정 후 saveRevision 으로 저장 ──
function DocumentEditModal({ doc, userId, onClose, onSaved }: {
  doc: any;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(doc.name || "");
  const [body, setBody] = useState((doc.content_json as any)?.body || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!userId || saving) return;
    setSaving(true);
    try {
      if (name.trim() && name !== doc.name) {
        const { error } = await (supabase as any).from("documents").update({ name: name.trim() }).eq("id", doc.id);
        if (error) throw error;
      }
      await saveRevision({
        documentId: doc.id,
        authorId: userId,
        contentJson: { ...(doc.content_json as any || {}), body },
        comment: "전자계약 양식 관리에서 수정",
      });
      toast("문서 저장 완료", "success");
      onSaved();
    } catch (e: any) {
      toast(`저장 실패: ${friendlyError(e, "권한이 없거나 일시 오류")}`, "error");
    } finally {
      setSaving(false);
    }
  };

  // 리치에디터(Tiptap, contenteditable) 안에서 줄바꿈용 Enter 는 저장으로 새지 않게 제외.
  useModalKeys(true, onClose, saving || !name.trim() ? undefined : () => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae?.isContentEditable) return;
    handleSave();
  });

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--text)]">문서 수정</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">문서 이름 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">
              본문 <span className="text-[var(--text-dim)] font-normal">— 변수는 {"{{변수명}}"} 형식</span>
            </label>
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <RichEditor content={body} onChange={setBody} placeholder="문서 본문을 입력하세요..." />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <button type="button" onClick={onClose} className="btn-ghost">취소</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="btn-primary"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
