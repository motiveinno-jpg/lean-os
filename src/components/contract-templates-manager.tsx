"use client";

// L 견적/계약 — 회사 계약서 양식 관리 패널 (settings 인사관리 탭에 마운트)
//   시스템 양식 3종 (read-only) + 회사 자체 양식 CRUD.
//   본문 입력: HTML/Markdown 텍스트 또는 PDF 업로드(Supabase Storage).
//   변수 토큰 `{변수명}` 자동 추출 + 미리보기.
//   권한: owner/admin 만 (RLS DB 측 admin only, UI 측 친절 안내).

import { appConfirm } from "@/components/global-confirm";
import { useMemo, useState, useRef } from "react";
import dynamic from "next/dynamic";
import type { RichEditorRef } from "@/components/rich-editor";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import { createPortal } from "react-dom";

// 계약 양식 '직접 작성'용 리치 에디터 — 표·서식·이미지 + {변수}. body_html 저장(발송 substitution과 동일).
const RichEditor = dynamic(() => import("@/components/rich-editor").then((m) => ({ default: m.RichEditor })), {
  ssr: false,
  loading: () => <div className="h-48 bg-[var(--bg-surface)] rounded-xl animate-pulse" />,
});
import { useModalKeys } from "@/hooks/use-modal-keys";
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
    <div className="contract-templates-manager glass-card">
      <div className="panel-header-compact">
        <div>
          <h3 className="text-sm font-bold text-[var(--text)]">계약 양식</h3>
          <p className="text-xs text-[var(--text-dim)] mt-1">
            우리 회사 계약서 양식입니다. 서명 요청·견적 발송 시 사용됩니다. 새로 만들 때 오너뷰 표준 계약서에서 시작할 수 있어요.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowAdd(true); }}
          className="btn-primary"
        >
          + 양식 추가
        </button>
      </div>

      {/* 우리 회사가 만든 계약 양식만 노출 (시스템 양식은 '양식 추가 › 직접 작성'의 시작점으로만 사용) */}
      {companyTemplates.length === 0 ? (
        <div className="templates-empty">
          아직 만든 계약 양식이 없습니다. <b>+ 양식 추가</b>로 만들어 보세요. (표준 계약서에서 시작할 수 있어요)
        </div>
      ) : (
        <div className="grid gap-1.5">
          {companyTemplates.map((t) => (
            <div key={t.id} className="template-row">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[var(--text)] truncate">{t.name}</div>
                <div className="caption">변수 {t.variables.length}개 · {t.file_type === "pdf" ? "PDF" : "직접 작성"}</div>
              </div>
              <button
                onClick={() => setEditing(t)}
                className="text-[10px] px-2 py-1 rounded bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
              >
                수정
              </button>
              <button
                onClick={async () => { if (await appConfirm(`'${t.name}' 양식을 삭제하시겠습니까?`, { danger: true })) deleteMut.mutate(t.id); }}
                className="text-[10px] px-2 py-1 rounded text-red-400 hover:bg-red-500/10 transition"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      {(showAdd || editing) && (
        <TemplateEditorModal
          companyId={companyId}
          editing={editing}
          systemTemplates={systemTemplates}
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
  systemTemplates,
  onClose,
  onSaved,
}: {
  companyId: string;
  editing: ContractTemplate | null;
  systemTemplates: ContractTemplate[];
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
  const [starterId, setStarterId] = useState("");
  const [newVar, setNewVar] = useState("");
  const editorRef = useRef<RichEditorRef>(null);

  // 표준 계약서에서 시작 — 시스템 양식을 골라 본문을 채워넣고 직접 편집(신규 작성 시에만).
  const applyStarter = (id: string) => {
    setStarterId(id);
    const sys = systemTemplates.find((s) => s.id === id);
    if (!sys) return;
    setFileType("html");
    const body = sys.body_html || "";
    setBodyHtml(body);
    setBodyMarkdown(sys.body_markdown || "");
    if (!name.trim()) setName(sys.name);
    setTimeout(() => editorRef.current?.setContent(body), 50);
  };

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

  useModalKeys(
    true,
    onClose,
    readonly || !canSave() || createMut.isPending || updateMut.isPending
      ? undefined
      : () => (editing ? updateMut.mutate() : createMut.mutate()),
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="template-editor-modal fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 md:p-5"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-card w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] shrink-0">
          <div>
            <h2 className="text-sm font-bold text-[var(--text)]">{readonly ? "시스템 양식 미리보기" : editing ? "계약 양식 수정" : "계약 양식 추가"}</h2>
            {readonly && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">시스템 양식은 수정/삭제할 수 없습니다.</p>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-ghost">{readonly ? "닫기" : "취소"}</button>
            {!readonly && (
              <button type="button" onClick={() => (editing ? updateMut.mutate() : createMut.mutate())}
                disabled={!canSave() || createMut.isPending || updateMut.isPending} className="btn-primary">
                {createMut.isPending || updateMut.isPending ? "저장 중…" : editing ? "수정 저장" : "저장"}
              </button>
            )}
          </div>
        </div>

        {/* Body: 좌 설정 / 우 본문 편집기 */}
        <div className="flex-1 flex min-h-0">
          {/* 좌 — 기본 양식·이름·방식·변수 */}
          <aside className="w-72 shrink-0 overflow-y-auto p-4 space-y-4 border-r border-[var(--border)]">
            {!editing && !readonly && systemTemplates.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">기본 양식 선택 <span className="text-[var(--text-dim)] font-normal">(표준에서 시작)</span></label>
                <select value={starterId} onChange={(e) => applyStarter(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded text-sm focus:outline-none focus:border-[var(--primary)]">
                  <option value="">빈 문서로 시작</option>
                  {systemTemplates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">양식 이름 *</label>
              <input type="text" value={name} disabled={readonly} onChange={(e) => setName(e.target.value)}
                placeholder="예: 우리회사 표준 서비스 계약서"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded text-sm focus:outline-none focus:border-[var(--primary)] disabled:opacity-60" />
            </div>

            {!readonly && (
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">본문 방식</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { v: "html" as const, label: "직접 작성" },
                    { v: "markdown" as const, label: "Markdown" },
                    { v: "pdf" as const, label: "PDF 업로드" },
                  ].map((opt) => (
                    <button key={opt.v} type="button" onClick={() => setFileType(opt.v)}
                      className={`px-3 py-1.5 rounded text-xs font-semibold transition ${fileType === opt.v ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 변수 (html/markdown) — 클릭 시 본문 삽입 */}
            {fileType !== "pdf" && (
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">변수 {fileType === "html" && <span className="text-[var(--text-dim)] font-normal">클릭 시 본문 삽입</span>}</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {detectedVars.map((v) => (
                    fileType === "html" && !readonly ? (
                      <button key={v} type="button" onClick={() => editorRef.current?.insertText(`{${v}}`)} title="본문 커서 위치에 삽입"
                        className="text-[10px] px-2 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-mono hover:bg-[var(--primary)]/20 transition">{`{${v}}`}</button>
                    ) : (
                      <span key={v} className="text-[10px] px-2 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-mono">{`{${v}}`}</span>
                    )
                  ))}
                  {detectedVars.length === 0 && <span className="text-[11px] text-[var(--text-dim)]">본문에 {"{변수명}"} 을 넣으면 자동 감지됩니다.</span>}
                </div>
                {fileType === "html" && !readonly && (
                  <div className="flex gap-1.5">
                    <input value={newVar} onChange={(e) => setNewVar(e.target.value)}
                      placeholder="예: 갑사명"
                      onKeyDown={(e) => { if (e.key === "Enter" && newVar.trim()) { e.preventDefault(); editorRef.current?.insertText(`{${newVar.trim()}}`); setNewVar(""); } }}
                      className="flex-1 min-w-0 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded text-sm focus:outline-none focus:border-[var(--primary)]" />
                    <button type="button" onClick={() => { if (newVar.trim()) { editorRef.current?.insertText(`{${newVar.trim()}}`); setNewVar(""); } }}
                      className="px-3 py-2 bg-[var(--primary)]/10 text-[var(--primary)] rounded text-xs font-semibold hover:bg-[var(--primary)]/20 transition shrink-0">삽입</button>
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-[var(--text-dim)]">발송 시 거래처별로 자동 치환됩니다.</p>
              </div>
            )}

            {/* PDF 업로드 */}
            {fileType === "pdf" && !readonly && (
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">PDF 파일 *</label>
                <input type="file" accept="application/pdf" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} className="text-xs" />
                {fileUrl && (
                  <div className="mt-2 text-[11px] text-[var(--text-muted)]">업로드됨: <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline">미리보기</a></div>
                )}
                {uploading && <div className="mt-2 text-[11px] text-[var(--text-dim)]">업로드 중…</div>}
                <p className="mt-2 text-[10px] text-amber-400">⚠ PDF 양식은 변수 자동 치환이 불가능합니다. 발송 시 PDF 그대로 전송.</p>
              </div>
            )}
          </aside>

          {/* 우 — 본문 편집기 */}
          <main className="flex-1 min-w-0 flex flex-col p-4">
            {fileType === "html" && (
              readonly ? (
                <div className="flex-1 min-h-0 overflow-y-auto prose prose-sm max-w-none bg-white text-gray-900 p-4 rounded border border-[var(--border)] text-xs"
                  dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(bodyHtml) }} />
              ) : (
                <>
                  <label className="block text-xs text-[var(--text-muted)] mb-1.5 shrink-0">본문 <span className="text-[var(--text-dim)] font-normal">표·굵기·정렬·색·이미지 지원 · 변수는 {"{변수명}"} 형식</span></label>
                  <div className="flex-1 min-h-0">
                    <RichEditor ref={editorRef} content={bodyHtml} onChange={setBodyHtml} fillHeight
                      placeholder="계약서 내용을 입력하세요… 왼쪽 변수 버튼으로 {갑사명}·{을사명} 등을 삽입할 수 있습니다." />
                  </div>
                </>
              )
            )}
            {fileType === "markdown" && (
              <>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5 shrink-0">Markdown 본문</label>
                <textarea value={bodyMarkdown} disabled={readonly} onChange={(e) => setBodyMarkdown(e.target.value)}
                  className="flex-1 min-h-0 w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded text-xs font-mono focus:outline-none focus:border-[var(--primary)] disabled:opacity-60 resize-none" />
              </>
            )}
            {fileType === "pdf" && (
              <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-dim)] border border-dashed border-[var(--border)] rounded-xl">
                {fileUrl ? <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline">업로드된 PDF 미리보기 →</a> : "왼쪽에서 PDF 파일을 업로드하세요."}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}
