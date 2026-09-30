"use client";
// 업무 › 파일보관함 — 폴더 탐색형.
//   맨 위(전체 폴더)에는 폴더 아래에 폴더 밖 파일(folder_id 없음)이 이어서 보인다.
//   폴더를 누르면 그 안으로 들어가 하위 폴더(위) + 파일(아래). 폴더는 몇 단계든 중첩된다.
//   하위 폴더는 맨 위 폴더의 공개 범위를 따른다(document_folders_tree_guard) — 범위 바꾸기는 맨 위 폴더에서만.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { appConfirm } from "@/components/global-confirm";
import { useToast } from "@/components/toast";
import { FileTypeIcon, fileKindOf } from "@/components/file-type-icon";
import { SelectionBar, TokenField } from "@/components/query-kit";
import { useMyPermissions } from "@/lib/permissions";
import { friendlyError } from "@/lib/friendly-error";
import { logRead } from "@/lib/log-read";
import { supabase } from "@/lib/supabase";
import { getCompanyStorage, fmtBytes as fmtQuotaBytes } from "@/lib/storage-quota";
import { getDepartments } from "@/lib/schedule";
import {
  uploadFile, createFolder, getFolders, deleteFolder, moveFilesToFolder, searchFiles, deleteFile,
  downloadStoredFile, updateFolderVisibility, getFileVersions, getFolderFileCounts, type FolderVisibility,
} from "@/lib/file-storage";

type Folder = {
  id: string; name: string; parent_id: string | null; created_at: string; created_by: string | null;
  visibility: FolderVisibility | null; target_user_ids: string[] | null; target_departments: string[] | null;
};
type VFile = {
  id: string; file_name: string; file_url: string; file_size: number | null; folder_id: string | null;
  uploaded_by: string | null; created_at: string; version: number | null;
};

const ROOT = null;
const VIS_LABEL: Record<FolderVisibility, string> = { company: "회사 전체", departments: "부서", members: "사람", private: "나만" };
const MAX_FILE_MB = 500;

const fmtSize = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
//   DB 트리거가 적은 한국어 문장(순환·하위 폴더 범위·이름 겹침)은 그대로 — 코드별 일반 문구로 덮지 않는다
const errText = (e: any, fb: string) => {
  const m = String(e?.message || "");
  return /[가-힯]/.test(m) && m.length <= 90 ? m : friendlyError(e, fb);
};

function FolderGlyph({ size = 20, muted = false }: { size?: number; muted?: boolean }) {
  return (
    <svg className="vx-folder-glyph" width={size} height={Math.round(size * 0.86)} viewBox="0 0 28 24" aria-hidden>
      <path d="M2 5a2 2 0 0 1 2-2h6.5l2.5 3H24a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" fill={muted ? "var(--border)" : "#E9A91F"} />
      <path d="M2 9h24v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" fill={muted ? "var(--bg-surface)" : "#FFC94A"} />
    </svg>
  );
}

export function VaultExplorer({ companyId, userId }: { companyId: string; userId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isMaster, hasPerm } = useMyPermissions();
  const canDeleteOthers = isMaster || hasPerm("/documents:delete");
  const canDeleteFile = (f: { uploaded_by?: string | null }) => canDeleteOthers || f.uploaded_by === userId;
  const canEditFolder = (f: Folder) => (f.created_by ? f.created_by === userId || canDeleteOthers : canDeleteOthers);

  const [current, setCurrent] = useState<string | null>(ROOT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "grid">("list");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState("");
  const [moving, setMoving] = useState(false);
  const [upProg, setUpProg] = useState<{ name: string; pct: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [verFile, setVerFile] = useState<VFile | null>(null);
  const [visFolder, setVisFolder] = useState<Folder | null>(null);
  const [visDraft, setVisDraft] = useState<{ visibility: FolderVisibility; depts: string[]; members: string[] }>({ visibility: "company", depts: [], members: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(t); }, [query]);
  useEffect(() => { if (!menuFor) return; const close = () => setMenuFor(null); window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, [menuFor]);

  // ── 데이터 ──
  const { data: folders = [] } = useQuery<Folder[]>({
    queryKey: ["document-folders", companyId],
    queryFn: () => getFolders(companyId) as Promise<Folder[]>,
    enabled: !!companyId,
  });
  const { data: fileCounts = {} } = useQuery({
    queryKey: ["vault-folder-counts", companyId],
    queryFn: () => getFolderFileCounts(companyId),
    enabled: !!companyId,
  });
  const { data: userNames = {} } = useQuery<Record<string, string>>({
    queryKey: ["document-user-names", companyId],
    queryFn: async () => {
      const data = logRead("documents:users", await supabase.from("users").select("id, name").eq("company_id", companyId));
      const m: Record<string, string> = {};
      for (const u of ((data as any[]) || [])) m[u.id] = u.name || "";
      return m;
    },
    enabled: !!companyId, staleTime: 300_000,
  });
  const { data: storageInfo } = useQuery({
    queryKey: ["company-storage", companyId], enabled: !!companyId, staleTime: 60_000,
    queryFn: () => getCompanyStorage(companyId),
  });
  const { data: deptOpts = [] } = useQuery({
    queryKey: ["schedule-departments", companyId], enabled: !!companyId, staleTime: 300_000,
    queryFn: () => getDepartments(companyId),
  });
  //   지금 폴더의 파일(최신 판만, 파일보관함에 직접 올린 것만). 맨 위면 폴더 밖 파일.
  const { data: folderFiles = [], isLoading: filesLoading } = useQuery<VFile[]>({
    queryKey: ["storage-files", companyId, current],
    enabled: !!companyId,
    queryFn: async () => {
      const base = supabase.from("document_files").select("*");
      const data = logRead("documents/vault:files", await (current ? base.eq("folder_id", current) : base.eq("company_id", companyId).is("folder_id", null))
        .is("parent_file_id", null)
        .is("document_id", null).is("vault_doc_id", null).is("deal_id", null)
        .order("created_at", { ascending: false }));
      return (data as VFile[]) || [];
    },
  });
  const { data: foundFiles = [] } = useQuery<VFile[]>({
    queryKey: ["storage-files", companyId, "search", debounced],
    enabled: !!companyId && debounced.length > 0,
    queryFn: () => searchFiles(companyId, debounced) as Promise<VFile[]>,
  });
  const { data: verList = [] } = useQuery({
    queryKey: ["file-versions", verFile?.id], enabled: !!verFile?.id,
    queryFn: () => getFileVersions(verFile!.id),
  });

  // ── 트리 ──
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const children = useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders) {
      //   부모가 내 눈에 안 보이면(옛 데이터) 맨 위에 둔다 — 트리에서 사라지지 않게
      const p = f.parent_id && byId.has(f.parent_id) ? f.parent_id : null;
      (m.get(p) || m.set(p, []).get(p)!).push(f);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return m;
  }, [folders, byId]);
  const pathTo = (id: string | null): Folder[] => {
    const out: Folder[] = [];
    let n = id ? byId.get(id) : undefined;
    for (let i = 0; n && i < 200; i++) { out.unshift(n); n = n.parent_id ? byId.get(n.parent_id) : undefined; }
    return out;
  };
  const topOf = (f: Folder) => pathTo(f.id)[0] ?? f;
  const flatFolders = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (pid: string | null, depth: number) => {
      for (const f of children.get(pid) || []) { out.push({ id: f.id, label: `${"　".repeat(depth)}${f.name}` }); walk(f.id, depth + 1); }
    };
    walk(null, 0);
    return out;
  }, [children]);

  //   지금 폴더가 지워졌거나 안 보이게 되면 맨 위로
  useEffect(() => { if (current && folders.length && !byId.has(current)) setCurrent(ROOT); }, [current, folders, byId]);

  const open = (id: string | null) => {
    if (id) setExpanded((prev) => { const n = new Set(prev); for (const p of pathTo(id)) n.add(p.id); return n; });
    setCurrent(id); setQuery(""); setCreating(false); setNewName(""); setSelectedIds(new Set());
  };
  const cur = current ? byId.get(current) : undefined;
  const crumbs = [{ id: null as string | null, name: "파일보관함" }, ...pathTo(current).map((f) => ({ id: f.id as string | null, name: f.name }))];
  const locOf = (folderId: string | null) => `위치: ${["파일보관함", ...pathTo(folderId).map((f) => f.name)].join(" › ")}`;
  const folderSub = (f: Folder) => {
    const nf = (children.get(f.id) || []).length;
    const nd = (fileCounts as Record<string, number>)[f.id] || 0;
    if (!nf && !nd) return "비어 있음";
    return [nf ? `폴더 ${nf}개` : "", nd ? `파일 ${nd}개` : ""].filter(Boolean).join(" · ");
  };

  // ── 보이는 목록 ──
  const q = debounced.toLowerCase();
  const searching = q.length > 0;
  const shownFolders: Folder[] = searching
    ? folders.filter((f) => f.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, "ko"))
    : children.get(current) || [];
  const shownFiles: VFile[] = searching ? foundFiles : folderFiles;
  const selectable = shownFiles.filter(canDeleteFile);
  const allOn = selectable.length > 0 && selectable.every((f) => selectedIds.has(f.id));
  const summary = searching
    ? `‘${debounced}’ 검색 결과 ${shownFolders.length + shownFiles.length}건`
    : `폴더 ${shownFolders.length}개 · 파일 ${shownFiles.length}개`;
  const isEmpty = !shownFolders.length && !shownFiles.length && !creating && !filesLoading;
  const storagePct = storageInfo && storageInfo.quotaBytes > 0 ? Math.min(100, Math.floor((storageInfo.usedBytes / storageInfo.quotaBytes) * 100)) : 0;

  const refreshFiles = () => {
    qc.invalidateQueries({ queryKey: ["storage-files"] });
    qc.invalidateQueries({ queryKey: ["vault-folder-counts"] });
    qc.invalidateQueries({ queryKey: ["company-storage"] });
  };
  const refreshFolders = () => {
    qc.invalidateQueries({ queryKey: ["document-folders"] });
    qc.invalidateQueries({ queryKey: ["vault-folder-counts"] });
  };

  // ── 폴더 만들기 — 지금 보고 있는 폴더 안에 ──
  const startCreate = () => { setQuery(""); setCreating(true); setNewName(""); };
  const confirmCreate = async () => {
    const name = newName.trim();
    if (!name || savingFolder) return;
    setSavingFolder(true);
    try {
      await createFolder(companyId, name, current || undefined, { visibility: "company", createdBy: userId });
      if (current) setExpanded((p) => new Set(p).add(current));
      setCreating(false); setNewName("");
      refreshFolders();
    } catch (e) { toast("폴더를 만들지 못했습니다: " + errText(e, "알 수 없는 오류"), "error"); }
    finally { setSavingFolder(false); }
  };

  const removeFolder = async (f: Folder) => {
    if (!(await appConfirm(`"${f.name}" 폴더를 삭제할까요? 비어 있는 폴더만 지울 수 있습니다.`, { danger: true }))) return;
    try {
      await deleteFolder(f.id, userId, companyId);
      if (current === f.id) setCurrent(f.parent_id);
      refreshFolders();
      toast("폴더를 삭제했습니다", "success");
    } catch (e) { toast(errText(e, "폴더를 지우지 못했습니다"), "error"); }
  };

  // ── 올리기 — 지금 폴더로(맨 위면 폴더 밖) ──
  const uploadedRef = useRef<WeakSet<File>>(new WeakSet());
  const uploadMany = async (list: File[]) => {
    const files = list.filter((f) => !uploadedRef.current.has(f));
    if (!files.length) return;
    const failed: string[] = [];
    for (const file of files) {
      uploadedRef.current.add(file);
      try {
        await uploadFile({
          companyId, bucket: "document-files", file, context: { folderId: current || undefined }, userId,
          register: true,
          onProgress: (pct) => setUpProg({ name: file.name, pct }),
        });
      } catch (err) { failed.push(`${file.name} · ${friendlyError(err, "알 수 없는 오류")}`); }
    }
    setUpProg(null);
    refreshFiles();
    if (failed.length) toast(`${failed.length}개 파일을 올리지 못했습니다: ${failed.slice(0, 3).join(" / ")}${failed.length > 3 ? " 외" : ""}`, "error");
    else toast(`${files.length}개 파일을 올렸습니다`, "success");
  };

  // ── 고른 파일 옮기기·지우기 ──
  const moveSelected = async () => {
    if (!moveTarget || !selectedIds.size) return;
    setMoving(true);
    try {
      const target = moveTarget === "__root" ? null : moveTarget;
      const r = await moveFilesToFolder([...selectedIds], target, companyId);
      const where = target ? `"${byId.get(target)?.name || "폴더"}"` : "폴더 밖(맨 위)";
      if (r.failed.length) toast(`${r.moved}개는 ${where}(으)로 옮겼고 ${r.failed.length}개는 실패했습니다: ${r.failed.slice(0, 3).join(", ")}${r.failed.length > 3 ? " …" : ""}`, "error");
      else if (r.moved === 0) toast("이미 그 폴더에 있는 파일입니다", "info");
      else toast(`파일 ${r.moved}개를 ${where}(으)로 옮겼습니다`, "success");
      setSelectedIds(new Set()); setMoveTarget("");
      refreshFiles();
    } catch (e) { toast("이동 실패: " + friendlyError(e, "알 수 없는 오류"), "error"); }
    finally { setMoving(false); }
  };
  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (!(await appConfirm(`선택한 파일 ${ids.length}개를 삭제할까요? 삭제하면 복구할 수 없습니다.`, { danger: true }))) return;
    for (const id of ids) {
      try { await deleteFile(id, userId, companyId, { canDeleteOthers }); }
      catch (e: any) { toast("삭제 실패: " + (e?.message || e), "error"); }
    }
    setSelectedIds(new Set());
    refreshFiles();
  };
  const toggleSel = (id: string) => setSelectedIds((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const onNewKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) void confirmCreate();
    if (e.key === "Escape") { setCreating(false); setNewName(""); }
  };

  // ── 조각 ──
  const createRow = creating && (
    <div className={view === "list" ? "vx-create-row" : "vx-create-card"}>
      {view === "list" && <FolderGlyph size={30} />}
      <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={onNewKey}
        aria-label="새 폴더 이름" placeholder="새 폴더 이름" className="vx-create-input" maxLength={100} />
      <button type="button" className="btn-primary btn-sm" disabled={!newName.trim() || savingFolder} onClick={() => void confirmCreate()}>만들기</button>
      <button type="button" className="btn-secondary btn-sm" onClick={() => { setCreating(false); setNewName(""); }}>취소</button>
    </div>
  );

  const folderMenu = (f: Folder) => {
    const editable = canEditFolder(f);
    const isTop = !f.parent_id;
    if (!editable) return null;
    return (
      <div className="vx-menu-wrap" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="vx-more" aria-label={`${f.name} 폴더 메뉴`} onClick={() => setMenuFor(menuFor === f.id ? null : f.id)}>⋯</button>
        {menuFor === f.id && (
          <div className="vx-menu" role="menu">
            {isTop ? (
              <button type="button" role="menuitem" className="vx-menu-item" onClick={() => {
                setMenuFor(null); setVisFolder(f);
                setVisDraft({ visibility: (f.visibility as FolderVisibility) || "company", depts: f.target_departments || [], members: f.target_user_ids || [] });
              }}>공개 범위 · {VIS_LABEL[(f.visibility as FolderVisibility) || "company"]}</button>
            ) : (
              <span className="vx-menu-note">공개 범위는 맨 위 폴더 「{topOf(f).name}」를 따릅니다</span>
            )}
            <button type="button" role="menuitem" className="vx-menu-item vx-menu-danger" onClick={() => { setMenuFor(null); void removeFolder(f); }}>폴더 삭제</button>
          </div>
        )}
      </div>
    );
  };

  const verLabel = (f: VFile) => Number(f.version || 1) > 1
    ? <button type="button" className="vx-ver-btn" title="지난 판을 봅니다." onClick={(e) => { e.stopPropagation(); setVerFile(f); }}>v{f.version}</button>
    : <>v1</>;

  const renderTree = (pid: string | null, depth: number): React.ReactNode =>
    (children.get(pid) || []).map((f) => {
      const kids = children.get(f.id) || [];
      const isOpen = expanded.has(f.id);
      const active = f.id === current;
      return (
        <div key={f.id}>
          <div className={active ? "vx-tree-row vx-tree-row-on" : "vx-tree-row"} style={{ paddingLeft: 4 + depth * 18 }}>
            {kids.length > 0 ? (
              <button type="button" className="vx-tree-toggle" aria-label={`${isOpen ? "접기" : "펼치기"}: ${f.name}`}
                onClick={() => setExpanded((p) => { const n = new Set(p); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}>
                <svg className={isOpen ? "vx-chev vx-chev-open" : "vx-chev"} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            ) : <span className="vx-tree-spacer" />}
            <button type="button" className="vx-tree-open" title={f.name} onClick={() => open(f.id)}>
              <FolderGlyph size={20} />
              <span className="vx-tree-name">{f.name}</span>
              {f.visibility && f.visibility !== "company" && !f.parent_id && <span className="vx-vis-dot" title={`공개 범위: ${VIS_LABEL[f.visibility]}`}>{f.visibility === "private" ? "🔒" : "👥"}</span>}
            </button>
          </div>
          {kids.length > 0 && isOpen && renderTree(f.id, depth + 1)}
        </div>
      );
    });

  return (
    <div className="vx-root">
      {/* ── 왼쪽: 폴더 트리 ── */}
      <aside className="vx-side">
        <div className="vx-side-head">
          <div className="vx-side-title">파일보관함</div>
          <button type="button" className="vx-icon-btn" aria-label="지금 폴더에 새 폴더 만들기" title="지금 폴더에 새 폴더 만들기" onClick={startCreate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
        <nav className="vx-tree" aria-label="폴더">
          <button type="button" className={current === ROOT ? "vx-tree-root vx-tree-row-on" : "vx-tree-root"} onClick={() => open(ROOT)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" /></svg>
            <span>전체 폴더</span>
          </button>
          {renderTree(null, 0)}
        </nav>
        {storageInfo && (
          <div className="vx-storage" title="회사가 올린 모든 파일의 합계입니다.">
            <div className="vx-storage-line">
              <span>회사 저장공간</span>
              <span className="mono-number">{fmtQuotaBytes(storageInfo.usedBytes)} / {fmtQuotaBytes(storageInfo.quotaBytes)}</span>
            </div>
            <div className="vx-storage-track"><div className="vx-storage-bar" style={{ width: `${Math.max(storagePct, storageInfo.usedBytes > 0 ? 1 : 0)}%`, background: storagePct >= 100 ? "var(--danger)" : storagePct >= 80 ? "var(--warning)" : "var(--primary)" }} /></div>
            {storagePct >= 80 && <Link href="/billing" className="vx-storage-more">{storageInfo.usedBytes >= storageInfo.quotaBytes ? "가득 찼습니다" : "거의 찼습니다"} · 저장공간 늘리기</Link>}
          </div>
        )}
      </aside>

      {/* ── 오른쪽: 경로 · 도구 · 목록 ── */}
      <section className="vx-main">
        <div className="vx-crumbs-row">
          <button type="button" className="vx-up-btn" aria-label="상위 폴더로" disabled={current === ROOT} onClick={() => open(cur?.parent_id && byId.has(cur.parent_id) ? cur.parent_id : ROOT)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div className="vx-crumbs">
            {crumbs.map((c, i) => (
              <span key={c.id ?? "root"} className="vx-crumb-wrap">
                {i > 0 && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="vx-crumb-sep"><path d="m9 6 6 6-6 6" /></svg>}
                <button type="button" className={i === crumbs.length - 1 ? "vx-crumb vx-crumb-last" : "vx-crumb"} onClick={() => open(c.id)}>{c.name}</button>
              </span>
            ))}
          </div>
        </div>

        <div className="vx-tools">
          <label className="vx-search">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <span className="sr-only">파일 검색</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="모든 폴더에서 파일·폴더 이름 검색" className="vx-search-input" />
            {query && <button type="button" className="vx-search-clear" aria-label="검색 지우기" onClick={() => setQuery("")}>✕</button>}
          </label>
          <div className="vx-seg" role="group" aria-label="보기">
            <button type="button" aria-label="목록 보기" aria-pressed={view === "list"} className={view === "list" ? "vx-seg-btn vx-seg-on" : "vx-seg-btn"} onClick={() => setView("list")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>목록
            </button>
            <button type="button" aria-label="바둑판 보기" aria-pressed={view === "grid"} className={view === "grid" ? "vx-seg-btn vx-seg-on" : "vx-seg-btn"} onClick={() => setView("grid")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>바둑판
            </button>
          </div>
          <button type="button" className="btn-secondary btn-sm vx-tool-btn" onClick={startCreate}>
            <svg width="18" height="16" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M2 5a2 2 0 0 1 2-2h6.5l2.5 3H24a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" /><path d="M14 10.5v7M10.5 14h7" strokeLinecap="round" /></svg>새 폴더
          </button>
          <button type="button" className="btn-primary btn-sm vx-tool-btn"
            title={current ? `「${cur?.name}」 폴더에 올립니다` : "폴더 밖(맨 위)에 올립니다"}
            onClick={() => fileInputRef.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>올리기
          </button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { const l = Array.from(e.target.files || []); e.target.value = ""; void uploadMany(l); }} />
        </div>

        <div className={dragOver ? "vx-box vx-box-drop" : "vx-box"}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void uploadMany(Array.from(e.dataTransfer.files || [])); }}>
          <div className="vx-box-head">
            <div className="vx-summary">
              {view === "list" && shownFiles.length > 0 && (
                <button type="button" aria-label="보이는 파일 전체 선택" disabled={selectable.length === 0}
                  onClick={() => setSelectedIds((p) => { const n = new Set(p); for (const f of selectable) { if (allOn) n.delete(f.id); else n.add(f.id); } return n; })}
                  className={allOn ? "collect-chk collect-chk-on" : "collect-chk"}>{allOn ? "✓" : ""}</button>
              )}
              {summary}
              {upProg && <span className="vx-progress">{upProg.name} 올리는 중 <b className="mono-number">{upProg.pct}%</b></span>}
            </div>
            <div className="vx-hint">{searching ? "결과를 누르면 그 폴더로 갑니다" : "폴더를 누르면 안으로 들어갑니다"}</div>
          </div>

          {view === "list" ? (
            <>
              <div className="vx-cols vx-cols-head">
                <div>이름</div><div>올린 사람</div><div>날짜</div><div className="vx-num">크기</div><div />
              </div>
              <div className="vx-scroll">
                {createRow}
                {shownFolders.map((f) => (
                  <div key={f.id} role="button" tabIndex={0} className="vx-cols vx-row vx-row-folder" onClick={() => open(f.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") open(f.id); }}>
                    <div className="vx-name-cell">
                      <span className="vx-chk-space" />
                      <FolderGlyph size={30} />
                      <div className="vx-name-stack">
                        <span className="vx-folder-title" title={f.name}>{f.name}</span>
                        <span className="vx-sub">{searching ? locOf(f.parent_id) : folderSub(f)}</span>
                      </div>
                    </div>
                    <div className="vx-cell">{(f.created_by && userNames[f.created_by]) || "—"}</div>
                    <div className="vx-cell mono-number">{String(f.created_at || "").slice(0, 10)}</div>
                    <div className="vx-cell vx-num vx-dim">—</div>
                    <div className="vx-actions">
                      {folderMenu(f)}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="vx-go"><path d="m9 6 6 6-6 6" /></svg>
                    </div>
                  </div>
                ))}
                {shownFiles.map((f) => {
                  const mine = canDeleteFile(f);
                  const on = selectedIds.has(f.id);
                  const k = fileKindOf(f.file_name);
                  return (
                    <div key={f.id} className={on ? "vx-cols vx-row vx-row-on" : "vx-cols vx-row"}>
                      <div className="vx-name-cell">
                        <button type="button" aria-label={mine ? "선택" : "다른 사람이 올린 파일 · 삭제 권한 없음"} disabled={!mine}
                          title={mine ? undefined : `${(f.uploaded_by && userNames[f.uploaded_by]) || "다른 사람"} 님이 올린 파일입니다`}
                          onClick={() => toggleSel(f.id)}
                          className={on ? "collect-chk collect-chk-on" : mine ? "collect-chk" : "collect-chk doc-file-chk-locked"}>{on ? "✓" : ""}</button>
                        <FileTypeIcon name={f.file_name} size={32} />
                        <div className="vx-name-stack">
                          <button type="button" className="vx-file-title" title={f.file_name} onClick={() => void downloadStoredFile(f.file_url, f.file_name)}>{f.file_name}</button>
                          <span className="vx-sub">
                            {searching
                              ? <button type="button" className="vx-loc-btn" onClick={() => open(f.folder_id)}>{locOf(f.folder_id)}</button>
                              : <>{k.label} · {verLabel(f)}</>}
                          </span>
                        </div>
                      </div>
                      <div className="vx-cell">{(f.uploaded_by && userNames[f.uploaded_by]) || "—"}</div>
                      <div className="vx-cell mono-number">{String(f.created_at || "").slice(0, 10)}</div>
                      <div className="vx-cell vx-num mono-number">{fmtSize(Number(f.file_size || 0))}</div>
                      <div className="vx-actions">
                        <button type="button" className="btn-secondary btn-sm vx-get-btn" aria-label={`${f.file_name} 내려받기`} onClick={() => void downloadStoredFile(f.file_url, f.file_name)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12M6 10l6 6 6-6M4 20h16" /></svg>받기
                        </button>
                      </div>
                    </div>
                  );
                })}
                {filesLoading && !searching && <div className="collect-empty">불러오는 중…</div>}
                {isEmpty && (
                  <div className="vx-empty">
                    <FolderGlyph size={56} muted />
                    <div className="vx-empty-title">{searching ? "검색 결과가 없습니다" : current ? "이 폴더는 비어 있습니다" : "아직 폴더도 파일도 없습니다"}</div>
                    <div className="vx-empty-text">{searching ? "다른 이름으로 검색해 보세요." : current ? "‘새 폴더’로 하위 폴더를 만들거나, 파일을 끌어다 놓아 올리세요." : "‘새 폴더’로 폴더를 만들거나, 파일을 끌어다 놓아 올리세요."}</div>
                  </div>
                )}
                {!searching && (
                  <div className="vx-drop-hint">여기에 파일을 끌어다 놓으면 {current ? <><b>{cur?.name}</b> 폴더에</> : <>폴더 밖(맨 위)에</>} 올라갑니다 · 파일당 {MAX_FILE_MB}MB까지</div>
                )}
              </div>
            </>
          ) : (
            <div className="vx-scroll vx-grid-wrap">
              {createRow}
              <div className="vx-grid">
                {shownFolders.map((f) => (
                  <div key={f.id} role="button" tabIndex={0} className="vx-card" onClick={() => open(f.id)} onKeyDown={(e) => { if (e.key === "Enter") open(f.id); }}>
                    <div className="vx-card-menu">{folderMenu(f)}</div>
                    <FolderGlyph size={64} />
                    <span className="vx-card-title" title={f.name}>{f.name}</span>
                    <span className="vx-sub">{searching ? locOf(f.parent_id) : folderSub(f)}</span>
                  </div>
                ))}
                {shownFiles.map((f) => {
                  const mine = canDeleteFile(f);
                  const on = selectedIds.has(f.id);
                  return (
                    <div key={f.id} className={on ? "vx-card vx-card-file vx-card-on" : "vx-card vx-card-file"}
                      onClick={() => void downloadStoredFile(f.file_url, f.file_name)} title={`${f.file_name} · 눌러서 내려받기`}>
                      {mine && (
                        <button type="button" aria-label="선택" onClick={(e) => { e.stopPropagation(); toggleSel(f.id); }}
                          className={on ? "collect-chk collect-chk-on vx-card-chk" : "collect-chk vx-card-chk"}>{on ? "✓" : ""}</button>
                      )}
                      <FileTypeIcon name={f.file_name} size={56} />
                      <span className="vx-card-title vx-card-file-title">{f.file_name}</span>
                      <span className="vx-sub">
                        {searching
                          ? <button type="button" className="vx-loc-btn" onClick={(e) => { e.stopPropagation(); open(f.folder_id); }}>{locOf(f.folder_id)}</button>
                          : <>{fmtSize(Number(f.file_size || 0))} · {String(f.created_at || "").slice(0, 10)}</>}
                      </span>
                    </div>
                  );
                })}
              </div>
              {isEmpty && (
                <div className="vx-empty">
                  <div className="vx-empty-title">{searching ? "검색 결과가 없습니다" : current ? "이 폴더는 비어 있습니다" : "아직 폴더도 파일도 없습니다"}</div>
                  <div className="vx-empty-text">{searching ? "다른 이름으로 검색해 보세요." : current ? "‘새 폴더’로 하위 폴더를 만들거나, 파일을 끌어다 놓아 올리세요." : "‘새 폴더’로 폴더를 만들거나, 파일을 끌어다 놓아 올리세요."}</div>
                </div>
              )}
              {!searching && (
                <div className="vx-drop-hint">여기에 파일을 끌어다 놓으면 {current ? <><b>{cur?.name}</b> 폴더에</> : <>폴더 밖(맨 위)에</>} 올라갑니다 · 파일당 {MAX_FILE_MB}MB까지</div>
              )}
            </div>
          )}

          <SelectionBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}>
            <select className="qk-input vx-move-select" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} aria-label="옮길 폴더">
              <option value="">옮길 폴더…</option>
              <option value="__root">폴더 밖(맨 위)</option>
              {flatFolders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <button type="button" className="btn-secondary btn-sm" disabled={!moveTarget || moving} onClick={() => void moveSelected()}>
              {moving ? "옮기는 중…" : `폴더로 이동 (${selectedIds.size})`}
            </button>
            <button type="button" className="btn-secondary btn-sm vx-danger-btn" onClick={() => void deleteSelected()}>삭제 ({selectedIds.size})</button>
          </SelectionBar>
        </div>
      </section>

      {/* ── 폴더 공개 범위(맨 위 폴더만) — 아래 폴더 전체가 같이 바뀐다 ── */}
      {visFolder && (
        <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) setVisFolder(null); }}>
          <div className="phv3-modal" role="dialog" aria-modal="true" aria-label="폴더 공개 범위">
            <h3 className="phv3-modal-title">&quot;{visFolder.name}&quot; 폴더 · 누가 보나</h3>
            <div className="vx-vis-opts">
              {(["company", "departments", "members", "private"] as FolderVisibility[]).map((v) => (
                <button key={v} type="button" onClick={() => setVisDraft((d) => ({ ...d, visibility: v }))}
                  className={visDraft.visibility === v ? "vx-vis-opt vx-vis-opt-on" : "vx-vis-opt"}>{VIS_LABEL[v]}</button>
              ))}
            </div>
            {visDraft.visibility === "departments" && (
              <TokenField items={deptOpts.map((d) => ({ value: d.name, label: `${d.name} (${d.count}명)` }))}
                value={visDraft.depts} onChange={(v) => setVisDraft((d) => ({ ...d, depts: v }))} placeholder="부서 이름 일부" />
            )}
            {visDraft.visibility === "members" && (
              <TokenField items={Object.entries(userNames).map(([id, name]) => ({ value: id, label: name || id.slice(0, 6) }))}
                value={visDraft.members} onChange={(v) => setVisDraft((d) => ({ ...d, members: v }))} placeholder="이름 일부" />
            )}
            <p className="phv3-modal-desc !mt-2">
              {visDraft.visibility === "company" ? "회사 구성원 모두가 봅니다." : visDraft.visibility === "private" ? "나만 봅니다." : "고른 대상만 봅니다."}
              {" "}안에 든 하위 폴더도 모두 같은 범위가 됩니다.
            </p>
            <div className="phv3-modal-actions">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setVisFolder(null)}>닫기</button>
              <button type="button" className="btn-primary btn-sm" onClick={async () => {
                try {
                  //   '사람'으로 좁힐 때 만든 사람과 나를 포함 — 빼면 저장 결과가 내 눈에 안 보여 서버가 거절한다(42501)
                  const members = visDraft.visibility === "members"
                    ? [...new Set([...visDraft.members, ...(visFolder.created_by ? [visFolder.created_by] : []), userId].filter(Boolean))]
                    : visDraft.members;
                  await updateFolderVisibility(visFolder.id, visDraft.visibility, { targetDepartments: visDraft.depts, targetUserIds: members });
                  refreshFolders(); refreshFiles();
                  setVisFolder(null);
                  toast("공개 범위를 바꿨습니다", "success");
                } catch (err) { toast("변경 실패: " + errText(err, "알 수 없는 오류"), "error"); }
              }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 지난 판 — 같은 이름을 다시 올리면 덮지 않고 판이 쌓인다 ── */}
      {verFile && (
        <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) setVerFile(null); }}>
          <div className="phv3-modal" role="dialog" aria-modal="true" aria-label="지난 판">
            <h3 className="phv3-modal-title">&quot;{verFile.file_name}&quot; · 지난 판</h3>
            <p className="phv3-modal-desc">지금 판은 v{verFile.version}입니다.</p>
            {(verList as any[]).length === 0 && <div className="collect-empty">지난 판이 없습니다.</div>}
            {(verList as any[]).map((v) => (
              <div key={v.id} className="vx-ver-row">
                <FileTypeIcon name={v.file_name} size={26} />
                <b className="mono-number">v{v.version}</b>
                <span className="mono-number vx-dim">{String(v.created_at || "").slice(0, 10)}</span>
                <span className="mono-number vx-dim">{fmtSize(Number(v.file_size || 0))}</span>
                <button type="button" className="btn-secondary btn-sm vx-ver-get" onClick={() => void downloadStoredFile(v.file_url, `${v.file_name.replace(/(\.[^.]+)?$/, ` (v${v.version})$1`)}`)}>내려받기</button>
              </div>
            ))}
            <div className="phv3-modal-actions">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setVerFile(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
