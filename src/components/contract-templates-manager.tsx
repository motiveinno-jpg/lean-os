"use client";

// L 견적/계약 — 회사 계약서 양식 관리 패널 (settings 인사관리 탭에 마운트)
//   시스템 양식 3종 (read-only) + 회사 자체 양식 CRUD.
//   본문 입력: HTML/Markdown 텍스트 또는 PDF 업로드(Supabase Storage).
//   변수 토큰 `{변수명}` 자동 추출 + 미리보기.
//   권한: owner/admin 만 (RLS DB 측 admin only, UI 측 친절 안내).

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/lib/supabase";
import {
  listContractTemplates,
  createContractTemplate,
  updateContractTemplate,
  deleteContractTemplate,
  extractVariables,
  type ContractTemplate,
} from "@/lib/contract-templates";

interface Props { companyId: string }

export default function ContractTemplatesManager({ companyId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: templates = [], isLoading } = useQuery<ContractTemplate[]>({
    queryKey: ["contract-templates", companyId],
    queryFn: () => listContractTemplates(companyId),
    enabled: !!companyId,
  });

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ContractTemplate | null>(null);

  const systemTemplates = useMemo(() => templates.filter((t) => t.is_system), [templates]);
  const companyTemplates = useMemo(() => templates.filter((t) => !t.is_system), [templates]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteContractTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract-templates", companyId] });
      toast("계약서 양식 삭제 완료", "success");
    },
    onError: (e: any) => toast(`삭제 실패: ${friendlyError(e, "권한이 없거나 일시 오류")}`, "error"),
  });

  if (isLoading) {
    return (
      <div className="glass-card p-6">
        <div className="text-sm text-[var(--text-muted)] text-center py-4">불러오는 중…</div>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[var(--text)]">계약서 양식 관리</h3>
          <p className="text-xs text-[var(--text-dim)] mt-1">
            견적 승인 후 "계약서 발송"에서 사용할 양식. 시스템 양식 3종 제공 + 회사 자체 양식 자유 추가.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowAdd(true); }}
          className="px-3 py-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-semibold transition"
        >
          + 양식 추가
        </button>
      </div>

      {/* 시스템 양식 */}
      <section>
        <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-2">
          기본 제공 양식 ({systemTemplates.length})
        </div>
        <div className="grid gap-1.5">
          {systemTemplates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border)]/50">
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-bold flex-shrink-0">🔒 시스템</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[var(--text)] truncate">{t.name}</div>
                <div className="caption">변수 {t.variables.length}개 · {t.file_type}</div>
              </div>
              <button
                onClick={() => setEditing(t)}
                className="text-[10px] px-2 py-1 rounded bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
              >
                미리보기
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 회사 자체 양식 */}
      <section>
        <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-2">
          회사 자체 양식 ({companyTemplates.length})
        </div>
        {companyTemplates.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-[var(--text-dim)] bg-[var(--bg-surface)]/40 rounded-lg border border-dashed border-[var(--border)]">
            회사 자체 양식이 없습니다. "+ 양식 추가" 로 등록하세요.
          </div>
        ) : (
          <div className="grid gap-1.5">
            {companyTemplates.map((t) => (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border)]/50">
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold flex-shrink-0">자체</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--text)] truncate">{t.name}</div>
                  <div className="caption">변수 {t.variables.length}개 · {t.file_type}</div>
                </div>
                <button
                  onClick={() => setEditing(t)}
                  className="text-[10px] px-2 py-1 rounded bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
                >
                  수정
                </button>
                <button
                  onClick={() => { if (window.confirm(`'${t.name}' 양식을 삭제하시겠습니까?`)) deleteMut.mutate(t.id); }}
                  className="text-[10px] px-2 py-1 rounded text-red-400 hover:bg-red-500/10 transition"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {(showAdd || editing) && (
        <TemplateEditorModal
          companyId={companyId}
          editing={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["contract-templates", companyId] });
            setShowAdd(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// 양식 편집 모달 — 신규 + 수정 + 시스템 양식 미리보기 (read-only)
// ──────────────────────────────────────────────────────────
function TemplateEditorModal({
  companyId,
  editing,
  onClose,
  onSaved,
}: {
  companyId: string;
  editing: ContractTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const readonly = editing?.is_system === true;

  const [name, setName] = useState(editing?.name || "");
  const [bodyHtml, setBodyHtml] = useState(editing?.body_html || "");
  const [bodyMarkdown, setBodyMarkdown] = useState(editing?.body_markdown || "");
  const [fileUrl, setFileUrl] = useState<string | null>(editing?.file_url || null);
  const [fileType, setFileType] = useState<"html" | "markdown" | "pdf">(editing?.file_type || "html");
  const [uploading, setUploading] = useState(false);

  const detectedVars = useMemo(() => {
    if (fileType === "pdf") return [];
    return extractVariables(fileType === "markdown" ? bodyMarkdown : bodyHtml);
  }, [fileType, bodyHtml, bodyMarkdown]);

  const createMut = useMutation({
    mutationFn: () => createContractTemplate({
      companyId,
      name,
      bodyHtml: fileType === "html" ? bodyHtml : null,
      bodyMarkdown: fileType === "markdown" ? bodyMarkdown : null,
      fileUrl: fileType === "pdf" ? fileUrl : null,
      fileType,
      variables: detectedVars,
    }),
    onSuccess: () => { toast("계약서 양식 추가 완료", "success"); onSaved(); },
    onError: (e: any) => toast(`저장 실패: ${friendlyError(e, "권한이 없거나 일시 오류")}`, "error"),
  });

  const updateMut = useMutation({
    mutationFn: () => updateContractTemplate(editing!.id, {
      name,
      bodyHtml: fileType === "html" ? bodyHtml : null,
      bodyMarkdown: fileType === "markdown" ? bodyMarkdown : null,
      fileUrl: fileType === "pdf" ? fileUrl : null,
      fileType,
      variables: detectedVars,
    }),
    onSuccess: () => { toast("계약서 양식 수정 완료", "success"); onSaved(); },
    onError: (e: any) => toast(`수정 실패: ${friendlyError(e, "권한이 없거나 일시 오류")}`, "error"),
  });

  async function handleFileUpload(file: File) {
    if (!file) return;
    setUploading(true);
    try {
      const path = `${companyId}/contract-templates/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("company-assets").upload(path, file, { upsert: true, contentType: file.type || "application/pdf" });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("company-assets").getPublicUrl(path);
      setFileUrl(urlData.publicUrl);
      setFileType("pdf");
      toast("PDF 업로드 완료", "success");
    } catch (e: any) {
      toast(`업로드 실패: ${friendlyError(e, "Storage 오류")}`, "error");
    } finally {
      setUploading(false);
    }
  }

  function canSave() {
    if (readonly) return false;
    if (!name.trim()) return false;
    if (fileType === "pdf") return !!fileUrl;
    if (fileType === "markdown") return !!bodyMarkdown.trim();
    return !!bodyHtml.trim();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)]">
              {readonly ? "시스템 양식 미리보기" : editing ? "계약서 양식 수정" : "계약서 양식 추가"}
            </h2>
            {readonly && (
              <p className="text-[11px] text-[var(--text-dim)] mt-1">시스템 양식은 수정/삭제할 수 없습니다.</p>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl">×</button>
        </div>

        <div className="space-y-4">
          {/* 이름 */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">양식 이름 *</label>
            <input
              type="text"
              value={name}
              disabled={readonly}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 우리회사 표준 서비스 계약서"
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded text-sm focus:outline-none focus:border-[var(--primary)] disabled:opacity-60"
            />
          </div>

          {/* 본문 입력 모드 */}
          {!readonly && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">본문 입력 방식</label>
              <div className="flex gap-1.5">
                {[
                  { v: "html" as const, label: "HTML 직접 입력" },
                  { v: "markdown" as const, label: "Markdown 입력" },
                  { v: "pdf" as const, label: "PDF 업로드" },
                ].map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setFileType(opt.v)}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
                      fileType === opt.v
                        ? "bg-[var(--primary)] text-white"
                        : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 본문 */}
          {fileType === "html" && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">
                HTML 본문 * <span className="text-[var(--text-dim)] font-normal">— 변수는 {"{변수명}"} 형식</span>
              </label>
              <textarea
                value={bodyHtml}
                disabled={readonly}
                onChange={(e) => setBodyHtml(e.target.value)}
                rows={readonly ? 18 : 14}
                placeholder='예: <h1>서비스 계약서</h1><p>{갑사명}과 {을사명}이 …</p>'
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded text-xs font-mono focus:outline-none focus:border-[var(--primary)] disabled:opacity-60 resize-none"
              />
            </div>
          )}
          {fileType === "markdown" && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">Markdown 본문 *</label>
              <textarea
                value={bodyMarkdown}
                disabled={readonly}
                onChange={(e) => setBodyMarkdown(e.target.value)}
                rows={14}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded text-xs font-mono focus:outline-none focus:border-[var(--primary)] disabled:opacity-60 resize-none"
              />
            </div>
          )}
          {fileType === "pdf" && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">PDF 파일 *</label>
              <input
                type="file"
                accept="application/pdf"
                disabled={readonly || uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                className="text-xs"
              />
              {fileUrl && (
                <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                  업로드됨: <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline">미리보기</a>
                </div>
              )}
              {uploading && <div className="mt-2 text-[11px] text-[var(--text-dim)]">업로드 중…</div>}
              <p className="mt-2 text-[10px] text-amber-400">⚠ PDF 양식은 변수 자동 치환이 불가능합니다. 발송 시 PDF 그대로 전송.</p>
            </div>
          )}

          {/* 변수 미리보기 (html/markdown) */}
          {fileType !== "pdf" && detectedVars.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">감지된 변수 ({detectedVars.length}개)</label>
              <div className="flex flex-wrap gap-1.5">
                {detectedVars.map((v) => (
                  <span key={v} className="text-[10px] px-2 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-mono">{`{${v}}`}</span>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-[var(--text-dim)]">계약서 발송 시 거래처별로 자동 치환됩니다.</p>
            </div>
          )}

          {/* 시스템 양식 본문 미리보기 (read-only HTML 렌더) */}
          {readonly && bodyHtml && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">미리보기</label>
              <div
                className="prose prose-sm max-w-none bg-white text-gray-900 p-4 rounded border border-[var(--border)] text-xs"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            </div>
          )}

          {/* 액션 */}
          {!readonly && (
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => editing ? updateMut.mutate() : createMut.mutate()}
                disabled={!canSave() || createMut.isPending || updateMut.isPending}
                className="px-4 py-2 rounded bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-semibold disabled:opacity-50 transition"
              >
                {createMut.isPending || updateMut.isPending ? "저장 중…" : editing ? "수정" : "추가"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
