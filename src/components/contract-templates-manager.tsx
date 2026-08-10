"use client";

// L 견적/계약 — 회사 계약서 양식 관리 패널 (settings 인사관리 탭에 마운트)
//   시스템 양식 3종 (read-only) + 회사 자체 양식 CRUD.
//   본문 입력: HTML/Markdown 텍스트 또는 PDF 업로드(Supabase Storage).
//   변수 토큰 `{변수명}` 자동 추출 + 미리보기.
//   권한: owner/admin 만 (RLS DB 측 admin only, UI 측 친절 안내).

import { appConfirm } from "@/components/global-confirm";
import { Ico } from "@/components/ui-icon";
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
  getHiddenContractTemplateIds,
  setContractTemplateHidden,
  getContractTemplateOrder,
  setContractTemplateOrder,
  sortTemplatesByOrder,
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

  // 표준/회사 양식을 탭으로 분리 (2026-08-06 사장님: "회사 양식 찾으려면 너무 밑으로 내려가야 해").
  //   기본은 '우리 회사 양식' — 실제로 매일 쓰는 쪽이 먼저 보이게.
  const [listTab, setListTab] = useState<"company" | "system">("company");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ContractTemplate | null>(null);
  // 표준 양식 '복제해서 수정' 원본 — 신규 폼에 본문을 실어 연다 (2026-08-05 사장님 제보: 빈 페이지가 뜨던 문제)
  const [duplicateFrom, setDuplicateFrom] = useState<ContractTemplate | null>(null);
  // '양식 추가' → 먼저 방식 선택(근로계약과 동일): PDF 업로드 / 직접 작성 → 그 모드로 편집기 오픈.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [initialMode, setInitialMode] = useState<"html" | "pdf">("html");
  const startAdd = (mode: "html" | "pdf") => { setInitialMode(mode); setEditing(null); setDuplicateFrom(null); setShowAdd(true); setChooserOpen(false); };

  // 회사가 정한 노출 순서 — 양식관리·발송 목록이 같은 배열을 본다(2026-08-03 사장님: "순서도 내가 변경할 수 있게").
  const { data: templateOrder = [] } = useQuery({
    queryKey: ["contract-template-order", companyId],
    queryFn: () => getContractTemplateOrder(companyId),
    enabled: !!companyId,
  });
  const systemTemplates = useMemo(
    () => sortTemplatesByOrder(templates.filter((t) => t.is_system), templateOrder),
    [templates, templateOrder],
  );
  const companyTemplates = useMemo(
    () => sortTemplatesByOrder(templates.filter((t) => !t.is_system), templateOrder),
    [templates, templateOrder],
  );
  const orderMut = useMutation({
    mutationFn: (ids: string[]) => setContractTemplateOrder(companyId, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contract-template-order", companyId] }),
    onError: (e: any) => toast(`순서 저장 실패: ${friendlyError(e, "일시 오류")}`, "error"),
  });
  // 섹션 안에서 한 칸 이동 — 저장은 두 섹션의 현재 표시 순서를 합친 전체 id 배열(정렬은 섹션별 index 비교라 안전)
  const moveTemplate = (section: "system" | "company", index: number, dir: -1 | 1) => {
    const list = [...(section === "system" ? systemTemplates : companyTemplates)];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    const combined = section === "system"
      ? [...companyTemplates.map((t) => t.id), ...list.map((t) => t.id)]
      : [...list.map((t) => t.id), ...systemTemplates.map((t) => t.id)];
    orderMut.mutate(combined);
  };

  // 드래그로 순서 변경 (2026-08-06 사장님 요청) — ▲▼ 는 그대로 두고 손잡이 드래그를 추가.
  //   결재 '새 요청' 화면의 블록 정렬과 같은 HTML5 드래그 규약.
  //   저장 배열은 moveTemplate 과 동일하게 두 섹션의 현재 표시 순서를 합쳐 만든다.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragSection, setDragSection] = useState<"system" | "company" | null>(null);
  const dropOnTemplate = (section: "system" | "company", targetId: string) => {
    if (!dragId || dragId === targetId || dragSection !== section) return; // 섹션을 넘나드는 이동은 막는다
    const list = (section === "system" ? systemTemplates : companyTemplates).map((t) => t.id);
    const next = list.filter((id) => id !== dragId);
    const at = next.indexOf(targetId);
    if (at < 0) return;
    next.splice(at, 0, dragId);
    const other = (section === "system" ? companyTemplates : systemTemplates).map((t) => t.id);
    orderMut.mutate(section === "system" ? [...other, ...next] : [...next, ...other]);
  };
  // 행에 붙일 드래그 속성 — 두 섹션이 같은 동작을 쓰도록 한곳에서 만든다
  const dragProps = (section: "system" | "company", id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const t = e.target as HTMLElement;
      // 버튼 위에서 시작한 드래그는 이동이 아니다
      if (t !== e.currentTarget && t.closest("button, a, input")) { e.preventDefault(); return; }
      setDragId(id); setDragSection(section);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => { setDragId(null); setDragSection(null); },
    onDragOver: (e: React.DragEvent) => { if (dragId && dragSection === section) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); dropOnTemplate(section, id); },
  });

  // 표준 양식 숨김 목록(회사 단위) — 발송 목록과 같은 쿼리 키를 써서 숨기면 양쪽이 함께 갱신된다.
  const { data: hiddenList = [] } = useQuery({
    queryKey: ["hidden-contract-templates", companyId],
    queryFn: () => getHiddenContractTemplateIds(companyId),
    enabled: !!companyId,
  });
  const hiddenIds = useMemo(() => new Set(hiddenList), [hiddenList]);
  const hideMut = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => setContractTemplateHidden(companyId, id, hidden),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["hidden-contract-templates", companyId] });
      toast(v.hidden ? "표준 양식을 숨겼습니다 — 발송 목록에도 나오지 않습니다" : "다시 표시합니다", "success");
    },
    onError: (e: any) => toast(`변경 실패: ${friendlyError(e, "일시 오류")}`, "error"),
  });

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
        <div className="relative">
          <button onClick={() => setChooserOpen((o) => !o)} className="btn-primary">+ 양식 추가 ▾</button>
          {chooserOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setChooserOpen(false)} />
              <div className="absolute right-0 mt-1.5 z-20 w-72 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-lg p-1.5">
                <button onClick={() => startAdd("html")}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-[var(--bg-surface)] transition">
                  <div className="text-sm font-semibold text-[var(--text)]"><Ico e="✍" /> 직접 작성</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">편집기에서 계약서를 작성 (표준 계약서에서 시작 가능)</div>
                </button>
                <button onClick={() => startAdd("pdf")}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-[var(--bg-surface)] transition">
                  <div className="text-sm font-semibold text-[var(--text)]"><Ico e="📄" /> PDF 업로드</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">완성된 PDF 계약서를 올려 그대로 사용</div>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 두 목록을 탭으로 분리 — 표준 양식이 길어 회사 양식이 화면 아래로 밀리던 문제(2026-08-06 사장님) */}
      <div className="template-section-tabs seg-bar">
        <button
          onClick={() => setListTab("company")}
          className={`seg-item ${listTab === "company" ? "seg-item-active" : ""}`}
        >
          우리 회사 양식 <span className="template-section-count">{companyTemplates.length}</span>
        </button>
        <button
          onClick={() => setListTab("system")}
          className={`seg-item ${listTab === "system" ? "seg-item-active" : ""}`}
        >
          표준 양식 <span className="template-section-count">{systemTemplates.length}</span>
        </button>
      </div>

      {/* 표준(시스템) 양식 — 2026-08-03 사장님: 발송하기엔 나오는데 양식관리엔 안 보여 관리가 안 됐다.
          전 회사 공유 행이라 삭제는 불가 → 우리 회사 목록에서만 숨긴다(숨기면 발송 목록에서도 빠짐). */}
      {listTab === "system" && (
        <div className="mb-4">
          <div className="text-[11px] font-semibold text-[var(--text-dim)] mb-1.5">
            오너뷰가 제공하는 양식입니다 — 수정하려면 복제하세요. 숨기면 발송 목록에도 안 나옵니다.
          </div>
          {systemTemplates.length === 0 ? (
            <div className="templates-empty">제공되는 표준 양식이 없습니다.</div>
          ) : (
          <div className="grid gap-1.5">
            {systemTemplates.map((t, i) => {
              const isHidden = hiddenIds.has(t.id);
              return (
                <div
                  key={t.id}
                  {...dragProps("system", t.id)}
                  className={`template-row ${isHidden ? "opacity-50" : ""} ${dragId === t.id ? "template-row-dragging" : ""}`}
                >
                  <span className="template-drag-handle" title="끌어서 순서 변경">⠿</span>
                  <div className="template-order-buttons">
                    <button onClick={() => moveTemplate("system", i, -1)} disabled={i === 0 || orderMut.isPending} title="위로">▲</button>
                    <button onClick={() => moveTemplate("system", i, 1)} disabled={i === systemTemplates.length - 1 || orderMut.isPending} title="아래로">▼</button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--text)] truncate">
                      {t.name} <span className="template-standard-badge">표준</span>
                      {isHidden && <span className="text-[10px] text-[var(--text-dim)] ml-1">숨김</span>}
                    </div>
                    <div className="caption">변수 {t.variables.length}개 · {t.file_type === "pdf" ? "PDF" : "직접 작성"}</div>
                  </div>
                  <button
                    onClick={() => { setInitialMode(t.file_type === "pdf" ? "pdf" : "html"); setEditing(null); setDuplicateFrom(t); setShowAdd(true); }}
                    className="text-[10px] px-2 py-1 rounded bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
                    title="표준 양식은 직접 수정할 수 없습니다 — 복제해서 우리 회사 양식으로 만드세요"
                  >
                    복제해서 수정
                  </button>
                  <button
                    onClick={() => hideMut.mutate({ id: t.id, hidden: !isHidden })}
                    disabled={hideMut.isPending}
                    className={`text-[10px] px-2 py-1 rounded transition ${isHidden ? "text-[var(--primary)] hover:bg-[var(--primary)]/10" : "text-red-400 hover:bg-red-500/10"}`}
                  >
                    {isHidden ? "다시 표시" : "숨기기"}
                  </button>
                </div>
              );
            })}
          </div>
          )}
        </div>
      )}

      {/* 우리 회사가 만든 계약 양식 */}
      {listTab === "company" && (companyTemplates.length === 0 ? (
        <div className="templates-empty">
          아직 만든 계약 양식이 없습니다. <b>+ 양식 추가</b>로 만들어 보세요. (표준 계약서에서 시작할 수 있어요)
        </div>
      ) : (
        <div className="grid gap-1.5">
          {companyTemplates.map((t, i) => (
            <div
              key={t.id}
              {...dragProps("company", t.id)}
              className={`template-row ${dragId === t.id ? "template-row-dragging" : ""}`}
            >
              <span className="template-drag-handle" title="끌어서 순서 변경">⠿</span>
              <div className="template-order-buttons">
                <button onClick={() => moveTemplate("company", i, -1)} disabled={i === 0 || orderMut.isPending} title="위로">▲</button>
                <button onClick={() => moveTemplate("company", i, 1)} disabled={i === companyTemplates.length - 1 || orderMut.isPending} title="아래로">▼</button>
              </div>
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
      ))}

      {(showAdd || editing) && (
        <TemplateEditorModal
          key={duplicateFrom?.id || editing?.id || "new"}
          companyId={companyId}
          editing={editing}
          duplicateFrom={duplicateFrom}
          systemTemplates={systemTemplates}
          initialMode={initialMode}
          onClose={() => { setShowAdd(false); setEditing(null); setDuplicateFrom(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["contract-templates", companyId] });
            setShowAdd(false);
            setEditing(null);
            setDuplicateFrom(null);
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
  duplicateFrom,
  systemTemplates,
  initialMode,
  onClose,
  onSaved,
}: {
  companyId: string;
  editing: ContractTemplate | null;
  /** 표준 양식 '복제해서 수정' 진입 시 원본 — 신규 작성 폼에 본문·변수를 미리 채운다 */
  duplicateFrom: ContractTemplate | null;
  systemTemplates: ContractTemplate[];
  initialMode: "html" | "pdf";
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const readonly = editing?.is_system === true;

  // 표준 양식 '복제해서 수정' — 원본 내용을 그대로 싣고 이름만 사본으로 (2026-08-05 사장님:
  //   "복제해서 수정하면 빈 여백 페이지가 나온다"). 종전엔 모드만 넘기고 본문을 안 실어 빈 편집기가 떴다.
  const [name, setName] = useState(editing?.name || (duplicateFrom ? `${duplicateFrom.name} 사본` : ""));
  const [bodyHtml, setBodyHtml] = useState(editing?.body_html || duplicateFrom?.body_html || "");
  const [bodyMarkdown, setBodyMarkdown] = useState(editing?.body_markdown || duplicateFrom?.body_markdown || "");
  const [fileUrl, setFileUrl] = useState<string | null>(editing?.file_url || duplicateFrom?.file_url || null);
  const [fileType, setFileType] = useState<"html" | "markdown" | "pdf">(editing?.file_type || duplicateFrom?.file_type || initialMode);
  const [uploading, setUploading] = useState(false);
  const [starterId, setStarterId] = useState(duplicateFrom?.id || "");
  const [newVar, setNewVar] = useState("");
  // '변수 추가'로 쌓아 둔 목록 (2026-08-07 사장님 시안) — 종전엔 입력하면 곧바로 본문에 꽂혀
  //   "변수를 만든다"와 "본문에 넣는다"가 한 동작이라 헷갈렸다. 이제 추가는 목록에만 쌓고,
  //   본문 작성 중 그 변수를 눌러 원하는 자리에 넣는다. 수정/복제 진입 시 기존 변수로 시작.
  const [addedVars, setAddedVars] = useState<string[]>(
    (editing?.variables || duplicateFrom?.variables || []) as string[],
  );
  const addVar = () => {
    const v = newVar.trim().replace(/[{}]/g, "");
    if (!v) return;
    setAddedVars((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setNewVar("");
  };
  // 변수 삭제 (2026-08-10 사장님 요청) — 본문에 이미 넣은 변수면 본문 토큰까지 함께 지운다.
  const removeVar = async (v: string) => {
    const token = `{{${v}}}`;
    const body = fileType === "markdown" ? bodyMarkdown : bodyHtml;
    const usedCount = body.split(token).length - 1;
    if (usedCount > 0) {
      const ok = await appConfirm(`{{${v}}} 변수가 본문 ${usedCount}곳에 들어 있습니다. 본문에서도 함께 지울까요?`, { danger: true, confirmLabel: "함께 삭제" });
      if (!ok) return;
      if (fileType === "markdown") {
        setBodyMarkdown(body.split(token).join(""));
      } else {
        const next = body.split(token).join("");
        setBodyHtml(next);
        editorRef.current?.setContent(next);
      }
    } else if (detectedVars.includes(v)) {
      // 본문에 있긴 한데 서식 태그로 토큰이 쪼개져 통째로 못 지우는 경우 — 목록에서만 지우면
      //   감지 목록으로 다시 나타나므로 정직하게 안내한다.
      toast("본문에 서식이 섞인 채 들어간 변수입니다. 본문에서 직접 지워주세요.", "info");
      return;
    }
    setAddedVars((prev) => (prev.filter((x) => x !== v)));
  };
  // 표 열 너비를 본문 HTML 에 굽는다 (2026-08-10) — 편집기 밖(미리보기·발송 스냅샷·PDF)은
  //   TipTap 의 colwidth 속성을 모르므로, 저장 시 style width 로 변환해야 조절한 너비가 유지된다.
  const bakeTableColWidths = (html: string): string => {
    if (typeof window === "undefined" || !html.includes("colwidth")) return html;
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("td[colwidth], th[colwidth]").forEach((el) => {
        const w = (el.getAttribute("colwidth") || "").split(",").reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
        if (w > 0) (el as HTMLElement).style.width = `${w}px`;
      });
      doc.querySelectorAll("table").forEach((t) => {
        if (t.querySelector("td[colwidth], th[colwidth]")) (t as HTMLElement).style.tableLayout = "fixed";
      });
      return doc.body.innerHTML;
    } catch { return html; }
  };
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
  // 화면에 보여줄 변수 = 선언한 것 + 본문에서 감지된 것 (중복 제거, 선언 순서 우선)
  const paletteVars = useMemo(
    () => [...new Set([...addedVars, ...detectedVars])],
    [addedVars, detectedVars],
  );

  const createMut = useMutation({
    mutationFn: () => createContractTemplate({
      companyId,
      name,
      bodyHtml: fileType === "html" ? bakeTableColWidths(bodyHtml) : null,
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
      bodyHtml: fileType === "html" ? bakeTableColWidths(bodyHtml) : null,
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
            <h2 className="text-sm font-bold text-[var(--text)]">{readonly ? "시스템 양식 미리보기" : editing ? "계약 양식 수정" : duplicateFrom ? "표준 양식 복제" : "계약 양식 추가"}</h2>
            {readonly && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">시스템 양식은 수정/삭제할 수 없습니다.</p>}
            {!readonly && !editing && duplicateFrom && (
              <p className="text-[11px] text-[var(--text-dim)] mt-0.5">‘{duplicateFrom.name}’ 내용을 그대로 불러왔습니다. 고쳐서 저장하면 우리 회사 양식이 됩니다.</p>
            )}
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

            {/* 변수 (html/markdown) — 클릭 시 본문 삽입 */}
            {fileType !== "pdf" && (
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">변수 {fileType === "html" && <span className="text-[var(--text-dim)] font-normal">— 클릭하면 본문 커서 위치에 삽입</span>}</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {paletteVars.map((v) => (
                    fileType === "html" && !readonly ? (
                      <span key={v} className="inline-flex items-center rounded bg-[var(--primary)]/10 overflow-hidden">
                        <button type="button" onClick={() => editorRef.current?.insertText(`{{${v}}}`)} title="본문 커서 위치에 삽입"
                          className="text-[10px] pl-2 pr-1 py-0.5 text-[var(--primary)] font-mono hover:bg-[var(--primary)]/20 transition">{`{{${v}}}`}</button>
                        <button type="button" onClick={() => void removeVar(v)} title="변수 삭제"
                          className="text-[10px] px-1 py-0.5 text-[var(--primary)]/60 hover:text-red-500 hover:bg-red-500/10 transition" aria-label={`${v} 변수 삭제`}>×</button>
                      </span>
                    ) : (
                      <span key={v} className="text-[10px] px-2 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-mono">{`{{${v}}}`}</span>
                    )
                  ))}
                  {paletteVars.length === 0 && <span className="text-[11px] text-[var(--text-dim)]">아래에서 변수를 추가하면 여기에 쌓입니다. 본문 작성 중 변수를 누르면 그 자리에 삽입됩니다.</span>}
                </div>
                {fileType === "html" && !readonly && (
                  <div className="flex gap-1.5">
                    <input value={newVar} onChange={(e) => setNewVar(e.target.value)}
                      placeholder="예: 갑사명"
                      // 한글 입력 중 엔터는 '조합 확정'이지 '추가'가 아니다 — 막지 않으면 마지막 글자가
                      //   한 번 더 변수로 들어간다(가나다 → 가나다, 다). 조합이 끝난 뒤 엔터만 추가로 본다.
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        addVar();
                      }}
                      className="flex-1 min-w-0 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded text-sm focus:outline-none focus:border-[var(--primary)]" />
                    <button type="button" onClick={addVar} disabled={!newVar.trim()}
                      className="px-3 py-2 bg-[var(--primary)]/10 text-[var(--primary)] rounded text-xs font-semibold hover:bg-[var(--primary)]/20 transition shrink-0 disabled:opacity-40">변수 추가</button>
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-[var(--text-dim)]">추가한 변수는 위 목록에 쌓입니다. 본문에 넣은 변수만 발송 시 거래처별로 치환됩니다.</p>
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
                <p className="mt-2 text-[10px] text-amber-400"><Ico e="⚠" /> PDF 양식은 변수 자동 치환이 불가능합니다. 발송 시 PDF 그대로 전송.</p>
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
                  <div className="flex-1 min-h-0 contract-tpl-editor">
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
