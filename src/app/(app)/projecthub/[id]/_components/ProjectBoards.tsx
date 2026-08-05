"use client";

// 프로젝트 표(보드) 화면 — 새 프로젝트 구조 1단계 (2026-08-03 기획 v2).
//   상단 탭에서 표를 고르고(＋로 추가), 그룹 안에 행을 쌓고, 셀을 눌러 바로 고친다.
//   숫자 컬럼은 그룹마다 합계가 자동으로 붙는다.
//
// 설계 메모
//   · 값은 행의 values(jsonb)에 컬럼ID로 담는다 — 컬럼을 더해도 DB 구조를 안 바꾼다.
//   · 저장은 셀 단위 즉시 반영(낙관적 갱신 없이 서버 응답 후 무효화) — 입력 중 화면이 튀지 않게
//     텍스트·숫자는 blur/Enter 에서만 저장한다.
//   · 정렬은 position 오름차순. 새 행은 그룹 맨 아래.

import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { DateField } from "@/components/date-field";
import { getPartners, upsertPartner } from "@/lib/partners";
import { createQuoteForDeal, createContractFromQuoteDoc } from "@/lib/documents";
import { BoardItemDrawer } from "./BoardItemDrawer";
import { BoardDocModal, type DocKind } from "./BoardDocModal";
import { BoardTrash } from "./BoardTrash";
import { BoardCalendar } from "./BoardCalendar";
import { ProjectMoneyReport } from "./ProjectMoneyReport";
import { todayKst } from "@/lib/kst";
import {
  BOARD_TEMPLATES, BLANK_TEMPLATE, findTemplate, ITEM_LABEL, sumColumn, buildBoardSummary, DOC_VALUE_KEY,
  flowColumnOf, spanColumnsOf, CONTRACT_VALUE_KEY, payTermsOf, INPUT_MODES, isDoneRow, START_DATE_RE,
  type InputMode, type PayTermRow,
  type BoardColumn, type BoardGroup, type BoardItem, type ColType, type SummaryCard,
} from "@/lib/project-boards";

// ⚠️ 새 표(project_board*)는 아직 생성된 DB 타입(src/types/database.ts)에 없다 —
//   타입 재생성(supabase gen types)은 CLI 가 있는 PC 에서 돌려야 해서, 그때까지는 느슨한 클라이언트를 쓴다.
//   (레포에 이미 쓰이는 방식: (supabase as any).from/rpc)
const db = supabase as any;
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const VIEW_KEY = "ov.board.view.";   // + boardId
const GROUP_COLORS = ["#5559DF", "#00C875", "#FDAB3D", "#A25DDC", "#579BFC", "#E2445C", "#C4C4C4"];

export function ProjectBoards({ dealId, companyId, users, dealName, userId, dealPartnerId }: {
  dealId: string; companyId: string; users: { id: string; name: string }[];
  /** '매출 · 청구' 행에서 견적서·계약서를 만들 때 쓴다 */
  dealName?: string; userId?: string; dealPartnerId?: string | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState<string>("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showSummary, setShowSummary] = useState(false);   // 마지막 탭 '정리'
  const [renaming, setRenaming] = useState(false);
  const [tplMenu, setTplMenu] = useState(false);          // 템플릿 ⋯ (이름 · 삭제)
  const [groupMenu, setGroupMenu] = useState<string | null>(null);   // 그룹 ⋯
  const [trashOpen, setTrashOpen] = useState(false);
  //   필터 — 표·칸반이 같이 쓴다. 켜진 게 없으면 아무것도 거르지 않는다.
  const [filters, setFilters] = useState<{ mine: boolean; week: boolean; open: boolean }>({ mine: false, week: false, open: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  //   지운 직후 한 번 뜨는 되돌리기 줄 — 놓쳐도 '지운 항목'에서 30일 안에 되살릴 수 있다
  const [undo, setUndo] = useState<{ table: string; id: string; label: string } | null>(null);
  // 정렬 — 컬럼 이름을 누르면 그 컬럼 기준. 표마다 따로 기억한다(저장은 안 한다, 보기 상태일 뿐).
  const [sort, setSort] = useState<{ colId: string; dir: "asc" | "desc" } | null>(null);
  // 입력화면 — 템플릿이 정한 기본값에서 시작하고, 사용자가 바꾸면 그걸 따른다(2026-08-03 기획 1단계).
  //   null = 아직 손대지 않음 → 템플릿 기본값을 쓴다.
  const [viewPick, setViewPick] = useState<InputMode | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);   // 행 상세 서랍
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const { data: boards = [], isLoading } = useQuery({
    queryKey: ["pb-boards", dealId],
    queryFn: async () => {
      const data = logRead("ProjectBoards:boards", await db.from("project_boards")
        .select("id, name, template_key, position").eq("deal_id", dealId).is("archived_at", null)
        .order("position", { ascending: true }));
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });

  const boardId = activeId && boards.some((b) => b.id === activeId) ? activeId : (boards[0]?.id || "");
  const board = boards.find((b) => b.id === boardId);
  //   '매출 · 청구' 만 문서 체인을 쓴다 — 조회 조건에서도 보므로 여기서 먼저 정한다
  const isBilling = board?.template_key === "billing";

  const { data: cols = [] } = useQuery({
    queryKey: ["pb-cols", boardId],
    queryFn: async () => {
      const data = logRead("ProjectBoards:cols", await db.from("project_board_columns")
        .select("id, board_id, name, type, settings, position").eq("board_id", boardId)
        .is("archived_at", null).order("position", { ascending: true }));
      return (data || []) as BoardColumn[];
    },
    enabled: !!boardId,
  });
  const { data: groups = [] } = useQuery({
    queryKey: ["pb-groups", boardId],
    queryFn: async () => {
      const data = logRead("ProjectBoards:groups", await db.from("project_board_groups")
        .select("id, board_id, name, color, position").eq("board_id", boardId)
        .is("archived_at", null).order("position", { ascending: true }));
      return (data || []) as BoardGroup[];
    },
    enabled: !!boardId,
  });
  const { data: items = [] } = useQuery({
    queryKey: ["pb-items", boardId],
    queryFn: async () => {
      const data = logRead("ProjectBoards:items", await db.from("project_board_items")
        .select("id, board_id, group_id, parent_item_id, name, values, position").eq("board_id", boardId)
        .is("archived_at", null).order("position", { ascending: true }));
      return (data || []) as BoardItem[];
    },
    enabled: !!boardId,
  });

  // ── 정리는 **프로젝트 전체** 를 본다(2026-08-03 시연: 표 3개짜리 프로젝트에서
  //    보고 있던 표 하나만 요약돼 "프로젝트 정리" 라는 이름과 어긋났다).
  //    누르기 전에는 안 불러온다 — 표 화면은 지금 보는 표만 있으면 된다.
  const boardIds = useMemo(() => boards.map((b) => b.id), [boards]);
  const { data: allCols = [] } = useQuery({
    queryKey: ["pb-all-cols", dealId, boardIds.length],
    queryFn: async () => {
      const data = logRead("ProjectBoards:allCols", await db.from("project_board_columns")
        .select("id, board_id, name, type, settings, position").in("board_id", boardIds)
        .is("archived_at", null).order("position", { ascending: true }));
      return (data || []) as BoardColumn[];
    },
    enabled: showSummary && boardIds.length > 0,
  });
  const { data: allGroups = [] } = useQuery({
    queryKey: ["pb-all-groups", dealId, boardIds.length],
    queryFn: async () => {
      const data = logRead("ProjectBoards:allGroups", await db.from("project_board_groups")
        .select("id, board_id, name, color, position").in("board_id", boardIds)
        .is("archived_at", null).order("position", { ascending: true }));
      return (data || []) as BoardGroup[];
    },
    enabled: showSummary && boardIds.length > 0,
  });
  const { data: allItems = [] } = useQuery({
    queryKey: ["pb-all-items", dealId, boardIds.length],
    queryFn: async () => {
      const data = logRead("ProjectBoards:allItems", await db.from("project_board_items")
        .select("id, board_id, group_id, parent_item_id, name, values, position").in("board_id", boardIds)
        .is("archived_at", null).order("position", { ascending: true }).limit(2000));
      return (data || []) as BoardItem[];
    },
    enabled: showSummary && boardIds.length > 0,
  });

  // 이 프로젝트의 문서(견적·계약) — '매출 · 청구' 템플릿에서만 쓴다.
  //   행에 붙은 연결(예약 키)과 별개로, 계약서의 결제조건을 읽어 청구 행을 제안하는 데 쓴다.
  const { data: dealDocs = [] } = useQuery({
    queryKey: ["pb-docs", dealId],
    queryFn: async () => {
      const data = logRead("ProjectBoards:docs", await db.from("documents")
        .select("id, name, document_number, content_type, content_json, source_document_id, created_at")
        .eq("deal_id", dealId).order("created_at", { ascending: false }));
      return (data || []) as any[];
    },
    enabled: !!dealId && isBilling,
  });

  // 거래처 컬럼이 있는 표에서만 목록을 불러온다(620개 규모 — 필요할 때만)
  const hasPartnerCol = cols.some((c) => c.type === "partner");
  const { data: partners = [] } = useQuery({
    queryKey: ["pb-partners", companyId],
    queryFn: () => getPartners(companyId),
    enabled: !!companyId && hasPartnerCol,
    staleTime: 5 * 60 * 1000,
  });

  // 계약서에 결제조건이 있는데 아직 청구 행이 없는 회차 — 있으면 한 줄로 제안한다.
  //   ⚠️ 훅은 아래 조기 반환(불러오는 중 · 템플릿 고르기)보다 **반드시 앞**에 둔다.
  //      뒤에 두면 렌더마다 훅 개수가 달라져 React #310 이 난다(2026-08-04 실제 발생).
  const proposal = useMemo(() => {
    if (!isBilling) return null;
    const have = new Set((items as BoardItem[]).map((i) => (i.name || "").trim()).filter(Boolean));
    for (const doc of dealDocs as any[]) {
      if (doc.content_type !== "contract") continue;
      const terms = payTermsOf(doc).filter((t) => !have.has(t.label.trim()));
      if (terms.length > 0) return { doc, terms };
    }
    return null;
  }, [isBilling, dealDocs, items]);

  // 마지막에 고른 보기를 템플릿마다 기억한다 — 기본값은 안전하게 두고 습관은 따라오게(2026-08-04).
  useEffect(() => {
    if (!boardId || typeof window === "undefined") return;
    const saved = window.localStorage.getItem(`${VIEW_KEY}${boardId}`) as InputMode | null;
    setViewPick(saved === "grid" || saved === "board" || saved === "timeline" ? saved : null);
  }, [boardId]);
  const pickView = (v: InputMode) => {
    setViewPick(v);
    if (typeof window !== "undefined") window.localStorage.setItem(`${VIEW_KEY}${boardId}`, v);
  };

  // 필터 — 셋 다 '켜면 좁아지는' 방향으로만 동작한다(AND). 무엇이 걸러졌는지 줄로 알려준다.
  const shown = useMemo(() => {
    if (!filters.mine && !filters.week && !filters.open) return items as BoardItem[];
    const today = todayKst();
    const week = new Date(new Date(`${today}T00:00:00`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const personCols = cols.filter((c) => c.type === "person");
    const dueCols = cols.filter((c) => c.type === "date" && !START_DATE_RE.test(c.name));
    return (items as BoardItem[]).filter((it) => {
      if (filters.mine && !(userId && personCols.some((c) => it.values?.[c.id] === userId))) return false;
      if (filters.week && !dueCols.some((c) => {
        const v = String(it.values?.[c.id] || "");
        return /^\d{4}-\d{2}-\d{2}/.test(v) && v >= today && v <= week;
      })) return false;
      if (filters.open && isDoneRow(it as any, cols as any, groups as any)) return false;
      return true;
    });
  }, [items, cols, groups, filters, userId]);
  const hiddenCount = items.length - shown.length;

  const itemsByGroup = useMemo(() => {
    const m: Record<string, BoardItem[]> = {};
    for (const it of shown) {
      const k = it.group_id || "__none__";
      (m[k] = m[k] || []).push(it);
    }
    return m;
  }, [shown]);

  // ── 표 만들기 — 템플릿의 컬럼·그룹을 그대로 심는다 ──
  const createBoard = async (key: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const tpl = key === "blank" ? BLANK_TEMPLATE : findTemplate(key);
      const { data: b, error } = await db.from("project_boards").insert({
        company_id: companyId, deal_id: dealId, name: tpl.name, template_key: tpl.key, position: boards.length,
      }).select("id").single();
      if (error) throw new Error(error.message);
      const bid = b!.id as string;
      const colRows = tpl.columns.map((c, i) => ({ board_id: bid, name: c.name, type: c.type, settings: c.settings || {}, position: i }));
      const grpRows = tpl.groups.map((g, i) => ({ board_id: bid, name: g.name, color: g.color, position: i }));
      const [cRes, gRes] = await Promise.all([
        db.from("project_board_columns").insert(colRows),
        db.from("project_board_groups").insert(grpRows),
      ]);
      if (cRes.error) throw new Error(cRes.error.message);
      if (gRes.error) throw new Error(gRes.error.message);
      setActiveId(bid);
      setPicking(false);
      qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
      toast(`'${tpl.name}' 템플릿을 만들었습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "템플릿 생성 실패", "error");
    } finally {
      setBusy(false);
    }
  };

  const renameBoard = async (name: string) => {
    setRenaming(false);
    if (!board || !name.trim() || name === board.name) return;
    await db.from("project_boards").update({ name: name.trim() }).eq("id", boardId);
    qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
  };
  // 템플릿 복제 — 매달 같은 표를 새로 만드는 수고를 없앤다. **구조만** 복사하고 행은 안 가져온다.
  const duplicateBoard = async () => {
    if (!board || busy) return;
    setTplMenu(false);
    setBusy(true);
    try {
      const { data: nb, error } = await db.from("project_boards").insert({
        company_id: companyId, deal_id: dealId, name: `${board.name} 사본`,
        template_key: board.template_key, position: boards.length,
      }).select("id").single();
      if (error) throw new Error(error.message);
      const bid = nb!.id as string;
      const [cRes, gRes] = await Promise.all([
        db.from("project_board_columns").insert(cols.map((c) => ({
          board_id: bid, name: c.name, type: c.type, settings: c.settings || {}, position: c.position,
        }))),
        db.from("project_board_groups").insert(groups.map((g) => ({
          board_id: bid, name: g.name, color: g.color, position: g.position,
        }))),
      ]);
      if (cRes.error) throw new Error(cRes.error.message);
      if (gRes.error) throw new Error(gRes.error.message);
      setActiveId(bid);
      qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
      toast("템플릿 구조를 복제했습니다(행은 안 가져왔어요).", "success");
    } catch (e: any) {
      toast(e?.message || "복제 실패", "error");
    } finally { setBusy(false); }
  };

  // 고른 줄을 다른 템플릿으로 — **컬럼 이름이 같은 칸만** 옮긴다. 못 옮긴 칸은 몇 개인지 말해 준다.
  const moveToBoard = async (targetId: string) => {
    const ids = [...selected];
    if (ids.length === 0 || !targetId) return;
    const tCols = logRead("ProjectBoards:moveCols", await db.from("project_board_columns")
      .select("id, name").eq("board_id", targetId).is("archived_at", null)) as { id: string; name: string }[] | null;
    const tGroup = logRead("ProjectBoards:moveGroup", await db.from("project_board_groups")
      .select("id").eq("board_id", targetId).is("archived_at", null).order("position").limit(1)) as { id: string }[] | null;
    const map = new Map<string, string>();          // 원본 컬럼 id → 대상 컬럼 id
    for (const c of cols) {
      const hit = (tCols || []).find((x) => x.name.trim() === c.name.trim());
      if (hit) map.set(c.id, hit.id);
    }
    let dropped = 0;
    for (const id of ids) {
      const it = items.find((x) => x.id === id);
      if (!it) continue;
      const next: Record<string, any> = {};
      for (const [k, v] of Object.entries(it.values || {})) {
        if (k.startsWith("__")) continue;           // 문서 연결은 표를 넘어가면 뜻을 잃는다
        const to = map.get(k);
        if (to) next[to] = v; else if (v !== null && v !== "") dropped++;
      }
      await db.from("project_board_items")
        .update({ board_id: targetId, group_id: tGroup?.[0]?.id || null, values: next, updated_at: new Date().toISOString() })
        .eq("id", id);
    }
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
    qc.invalidateQueries({ queryKey: ["pb-items", targetId] });
    setSelected(new Set());
    toast(dropped > 0
      ? `${ids.length}건을 옮겼습니다. 이름이 같은 칸만 따라갔고 ${dropped}칸은 비웠어요.`
      : `${ids.length}건을 옮겼습니다.`, "success");
  };

  const removeBoard = async () => {
    if (!board) return;
    // 확인창을 띄우지 않는다 — 되돌리기가 있으면 확인창은 손만 늦춘다(2026-08-04 기획 2차)
    await softDelete("project_boards", boardId, `템플릿 '${board.name}'`, ["pb-boards"]);
    setActiveId("");
  };
  const renameGroup = async (g: BoardGroup, name: string) => {
    if (!name.trim() || name === g.name) return;
    await db.from("project_board_groups").update({ name: name.trim() }).eq("id", g.id);
    qc.invalidateQueries({ queryKey: ["pb-groups", boardId] });
  };
  const renameColumn = async (c: BoardColumn, name: string) => {
    if (!name.trim() || name === c.name) return;
    await db.from("project_board_columns").update({ name: name.trim() }).eq("id", c.id);
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
  };

  // 행 → 견적서. '매출 · 청구' 템플릿에서만 쓴다(2026-08-03 사장님: "입력은 무조건 템플릿으로").
  //   문서 자체는 기존 편집기가 맡는다 — 여기서는 만들고 연결한 뒤 그리로 보낸다.
  const [makingDoc, setMakingDoc] = useState<string | null>(null);
  //   문서는 팝업으로 연다 — 화면을 옮기면 업무 흐름이 끊긴다(2026-08-04 사장님 지시)
  const [docModal, setDocModal] = useState<{ itemId: string; kind: DocKind } | null>(null);
  const openQuote = async (it: BoardItem) => {
    const linked = (it.values || {})[DOC_VALUE_KEY] as { id?: string } | undefined;
    if (linked?.id) { setDocModal({ itemId: it.id, kind: "quote" }); return; }
    if (!userId || makingDoc) return;
    setMakingDoc(it.id);
    try {
      const doc = await createQuoteForDeal({
        companyId, dealId, userId,
        name: `${it.name?.trim() || dealName || "프로젝트"} 견적서`,
      });
      await db.from("project_board_items")
        .update({ values: { ...(it.values || {}), [DOC_VALUE_KEY]: { id: doc.id, no: doc.document_number } }, updated_at: new Date().toISOString() })
        .eq("id", it.id);
      qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
      qc.invalidateQueries({ queryKey: ["pb-docs", dealId] });
      setDocModal({ itemId: it.id, kind: "quote" });
    } catch (e: any) {
      toast(e?.message || "견적서 생성 실패", "error");
    } finally { setMakingDoc(null); }
  };

  // 카드를 다른 열로 — 흐름 컬럼이 있으면 그 값을, 없으면 그룹을 바꾼다.
  //   단계 이동이 셀 편집·칸반 드래그 어느 쪽이든 **같은 값**을 만지게 한다.
  const moveCard = async (itemId: string, colKey: string) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    const patch: any = { updated_at: new Date().toISOString() };
    if (flowCol) {
      if (it.values?.[flowCol.id] === colKey) return;
      patch.values = { ...(it.values || {}), [flowCol.id]: colKey };
    } else {
      if (it.group_id === colKey) return;
      patch.group_id = colKey;
    }
    await db.from("project_board_items").update(patch).eq("id", itemId);
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
  };

  // 행의 견적서 → 계약서. 견적이 있어야 만들 수 있다(근거 없는 계약을 만들지 않게).
  const makeContract = async (it: BoardItem) => {
    const linked = (it.values || {})[CONTRACT_VALUE_KEY] as { id?: string } | undefined;
    if (linked?.id) { setDocModal({ itemId: it.id, kind: "contract" }); return; }
    const q = (it.values || {})[DOC_VALUE_KEY] as { id?: string } | undefined;
    const quoteDoc = (dealDocs as any[]).find((d) => d.id === q?.id);
    if (!quoteDoc || !userId || makingDoc) return;
    setMakingDoc(it.id);
    try {
      const amountCol = cols.find((c) => c.type === "number" && (c.settings?.unit || "") === "원");
      const doc = await createContractFromQuoteDoc({
        companyId, dealId, userId, quoteDoc,
        dealName: dealName || "",
        partnerName: (partners as any[]).find((p) => p.id === (it.values || {})[partnerColId || ""])?.name,
        amount: amountCol ? Number(it.values?.[amountCol.id]) || 0 : 0,
      });
      await db.from("project_board_items")
        .update({ values: { ...(it.values || {}), [CONTRACT_VALUE_KEY]: { id: doc.id, no: "계약서" } }, updated_at: new Date().toISOString() })
        .eq("id", it.id);
      qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
      qc.invalidateQueries({ queryKey: ["pb-docs", dealId] });
      setDocModal({ itemId: it.id, kind: "contract" });
    } catch (e: any) {
      toast(e?.message || "계약서 생성 실패", "error");
    } finally { setMakingDoc(null); }
  };

  // 계약서의 결제조건대로 청구 행을 만든다 — **제안만 하고, 만드는 건 사람이 누른다**.
  const [proposing, setProposing] = useState(false);
  const addTermRows = async (terms: PayTermRow[]) => {
    if (proposing || terms.length === 0) return;
    setProposing(true);
    try {
      const amountCol = cols.find((c) => c.type === "number" && (c.settings?.unit || "") === "원");
      const memoCol = cols.find((c) => c.type === "text");
      const stageId = flowCol
        ? (((flowCol.settings?.options || []) as any[]).find((o) => /계약/.test(String(o.label)))?.id
          || ((flowCol.settings?.options || []) as any[])[0]?.id)
        : null;
      const base = items.length;
      const rows = terms.map((t, i) => ({
        board_id: boardId, group_id: groups[0]?.id || null, name: t.label, position: base + i,
        values: {
          ...(flowCol && stageId ? { [flowCol.id]: stageId } : {}),
          ...(amountCol && t.amount ? { [amountCol.id]: t.amount } : {}),
          ...(memoCol && t.condition ? { [memoCol.id]: t.condition } : {}),
          ...(partnerColId && dealPartnerId ? { [partnerColId]: dealPartnerId } : {}),
        },
      }));
      const { error } = await db.from("project_board_items").insert(rows);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
      toast(`청구 행 ${rows.length}건을 만들었습니다. 예정일은 직접 채워 주세요.`, "success");
    } catch (e: any) {
      toast(e?.message || "청구 행 생성 실패", "error");
    } finally { setProposing(false); }
  };

  // 문서에서 무언가 하면 그 줄의 단계도 따라 움직인다 — 안 그러면 단계를 손으로 또 바꿔야 한다.
  //   (2026-08-04 사장님: "견적서를 보내면 단계가 제대로 넘어가는지도 확인이 필요하고")
  //   사람이 누른 결과만 반영한다. 뒤로 되돌리지는 않는다(이미 앞선 단계면 그대로 둔다).
  const markStage = async (it: BoardItem, re: RegExp) => {
    if (!flowCol) return;
    const options = ((flowCol.settings?.options || []) as any[]);
    const idx = options.findIndex((o) => re.test(String(o.label)));
    if (idx < 0) return;
    const curIdx = options.findIndex((o) => o.id === it.values?.[flowCol.id]);
    if (curIdx >= idx) return;           // 이미 더 간 단계면 되돌리지 않는다
    await db.from("project_board_items")
      .update({ values: { ...(it.values || {}), [flowCol.id]: options[idx].id }, updated_at: new Date().toISOString() })
      .eq("id", it.id);
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
  };

  const removeColumn = async (c: BoardColumn) => {
    if (sort?.colId === c.id) setSort(null);
    // 값은 행의 jsonb 에 그대로 남는다 — 컬럼을 되살리면 값도 같이 돌아온다
    await softDelete("project_board_columns", c.id, `컬럼 '${c.name}'`, ["pb-cols"]);
  };
  // 숫자 컬럼 단위 — 단위를 알아야 '정리'가 합계를 제대로 읽는다(원끼리만 빼고, %는 평균을 낸다)
  const setUnit = async (c: BoardColumn, unit: string) => {
    const next = { ...(c.settings || {}), unit: unit.trim() || undefined };
    await db.from("project_board_columns").update({ settings: next }).eq("id", c.id);
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
  };

  // 지우는 동작은 전부 이 한 곳을 지난다 — 되돌리기가 빠지는 경로를 만들지 않으려고.
  const softDelete = async (table: string, id: string, label: string, keys: string[]) => {
    const { error } = await db.from(table).update({ archived_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    keys.forEach((k) => qc.invalidateQueries({ queryKey: [k, k === "pb-boards" ? dealId : boardId] }));
    setUndo({ table, id, label });
    window.setTimeout(() => setUndo((u) => (u && u.id === id ? null : u)), 6000);
  };
  const runUndo = async () => {
    if (!undo) return;
    await db.from(undo.table).update({ archived_at: null }).eq("id", undo.id);
    ["pb-boards", "pb-cols", "pb-groups", "pb-items"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k, k === "pb-boards" ? dealId : boardId] }));
    qc.invalidateQueries({ queryKey: ["pb-trash"] });
    setUndo(null);
    toast("되돌렸습니다.", "success");
  };

  const addItem = async (groupId: string, values?: Record<string, any>, name?: string) => {
    const pos = (itemsByGroup[groupId] || []).length;
    const { error } = await db.from("project_board_items").insert({ board_id: boardId, group_id: groupId, name: name || "", position: pos, values: values || {} });
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
  };
  // 행 복제 — 정기 지출·매달 청구는 복제가 가장 빠른 입력이다(2026-08-04 기획 3차).
  const duplicateItem = async (it: BoardItem) => {
    const { [DOC_VALUE_KEY]: _q, [CONTRACT_VALUE_KEY]: _c, ...values } = (it.values || {}) as any;
    const { error } = await db.from("project_board_items").insert({
      board_id: boardId, group_id: it.group_id, name: it.name ? `${it.name} 사본` : "",
      values, position: (it.position ?? 0) + 1,
    });
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
    toast("한 줄 복제했습니다. 문서 연결은 새로 만드세요.", "success");
  };

  // ── 고른 줄에 한 번에 ──
  const bulkPatch = async (patch: Record<string, any>) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    await db.from("project_board_items").update({ ...patch, updated_at: new Date().toISOString() }).in("id", ids);
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
    setSelected(new Set());
  };
  const bulkValue = async (colId: string, v: any) => {
    const ids = [...selected];
    for (const id of ids) {
      const it = items.find((x) => x.id === id);
      if (!it) continue;
      await db.from("project_board_items")
        .update({ values: { ...(it.values || {}), [colId]: v }, updated_at: new Date().toISOString() }).eq("id", id);
    }
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
    setSelected(new Set());
  };
  const bulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    await db.from("project_board_items").update({ archived_at: new Date().toISOString() }).in("id", ids);
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
    setSelected(new Set());
    toast(`${ids.length}건을 지웠습니다. '지운 항목'에서 되살릴 수 있어요.`, "success");
  };

  const saveName = async (item: BoardItem, name: string) => {
    if (name === item.name) return;
    await db.from("project_board_items").update({ name, updated_at: new Date().toISOString() }).eq("id", item.id);
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
  };
  const saveValue = async (item: BoardItem, colId: string, value: any) => {
    const next = { ...(item.values || {}), [colId]: value };
    await db.from("project_board_items").update({ values: next, updated_at: new Date().toISOString() }).eq("id", item.id);
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
  };
  const removeItem = async (item: BoardItem) =>
    softDelete("project_board_items", item.id, `${nameLabelOf(board?.template_key)} '${item.name || "이름 없음"}'`, ["pb-items"]);
  // 그룹 삭제 — 안에 행이 있으면 다른 그룹으로 옮기고 지운다(값을 잃지 않게).
  const removeGroup = async (g: BoardGroup) => {
    setGroupMenu(null);
    if (groups.length <= 1) { toast("그룹이 하나뿐이라 지울 수 없어요.", "error"); return; }
    const rows = itemsByGroup[g.id] || [];
    const to = groups.find((x) => x.id !== g.id)!;
    if (rows.length > 0 && !window.confirm(`'${g.name}' 을 지우면 안에 있는 ${rows.length}건이 '${to.name}' 으로 옮겨집니다. 계속할까요?`)) return;
    if (rows.length > 0) await db.from("project_board_items").update({ group_id: to.id }).eq("group_id", g.id);
    await softDelete("project_board_groups", g.id, `그룹 '${g.name}'`, ["pb-groups", "pb-items"]);
  };
  const recolorGroup = async (g: BoardGroup, color: string) => {
    setGroupMenu(null);
    await db.from("project_board_groups").update({ color }).eq("id", g.id);
    qc.invalidateQueries({ queryKey: ["pb-groups", boardId] });
  };

  const addGroup = async () => {
    const { error } = await db.from("project_board_groups").insert({ board_id: boardId, name: `그룹 ${groups.length + 1}`, position: groups.length });
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-groups", boardId] });
  };
  const addColumn = async (type: ColType) => {
    const label = { text: "텍스트", number: "숫자", date: "날짜", status: "상태", person: "사람", partner: "거래처" }[type];
    const settings = type === "status"
      ? { options: [{ id: "a", label: "미정", color: "#C4C4C4" }, { id: "b", label: "진행", color: "#FDAB3D" }, { id: "c", label: "완료", color: "#00C875" }] }
      : {};
    const { error } = await db.from("project_board_columns").insert({ board_id: boardId, name: label, type, settings, position: cols.length });
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
  };

  if (isLoading) return <p className="pj-sec-empty">불러오는 중…</p>;

  // ── 템플릿이 하나도 없을 때 — 고르는 화면부터 띄운다(빈 표 앞에서 막히지 않게) ──
  if (boards.length === 0 || picking) {
    return (
      <div className="pb-pick">
        <div className="pb-pick-head">
          <b>{boards.length === 0 ? "어떤 템플릿으로 시작할까요?" : "템플릿 추가"}</b>
          <span>부서가 아니라 <b>일의 형태</b>로 고릅니다 · 나중에 얼마든지 더 붙일 수 있어요</span>
          {boards.length > 0 && <button type="button" className="pb-pick-close" onClick={() => setPicking(false)}>닫기</button>}
        </div>
        <div className="pb-tpls">
          {BOARD_TEMPLATES.map((t) => (
            <button key={t.key} type="button" className="pb-tpl" disabled={busy} onClick={() => createBoard(t.key)}>
              <b>{t.name}</b>
              <span>{t.desc}</span>
              <em>{t.uses}</em>
              {/* 무슨 칸이 생기는지 미리 보여준다 — 이름보다 이게 고르는 기준이다 */}
              <span className="pb-tpl-cols">
                {[ITEM_LABEL[t.key] || "이름", ...t.columns.map((c) => c.name)].slice(0, 6).map((n) => (
                  <i key={n}>{n}</i>
                ))}
                {t.columns.length + 1 > 6 && <i className="pb-tpl-more">+{t.columns.length + 1 - 6}</i>}
              </span>
            </button>
          ))}
          <button type="button" className="pb-tpl pb-tpl-blank" disabled={busy} onClick={() => createBoard("blank")}>
            <b>빈 템플릿</b>
            <span>컬럼을 직접 만들어 씁니다</span>
            <em>위 형태에 안 맞는 일</em>
          </button>
        </div>
      </div>
    );
  }

  const nameLabel = ITEM_LABEL[board?.template_key || "blank"] || "이름";
  // 칸반이 열로 쓸 컬럼 — 흐름 상태 컬럼. 없으면 그룹으로 열을 만든다.
  const flowCol = flowColumnOf(cols);
  const span = spanColumnsOf(cols);
  const hasDate = cols.some((c) => c.type === "date");
  const wanted: InputMode = viewPick || (findTemplate(board?.template_key).input || "grid");
  //   근거가 되는 칸을 지웠는데 읽는 보기가 걸려 있으면 표로 떨어뜨린다(빈 화면을 만들지 않는다)
  const view: InputMode = (wanted === "timeline" && !span) || (wanted === "calendar" && !hasDate) ? "grid" : wanted;
  // 칸반 열 — 흐름 컬럼의 옵션 순서, 없으면 그룹 순서
  const kanbanCols = flowCol
    ? ((flowCol.settings?.options || []) as any[]).map((o) => ({ key: String(o.id), label: String(o.label), color: String(o.color || "#C4C4C4") }))
    : groups.map((g) => ({ key: g.id, label: g.name, color: g.color }));
  const cardsOf = (key: string) => (flowCol
    ? shown.filter((it) => String(it.values?.[flowCol.id] ?? "") === key)
    : shown.filter((it) => it.group_id === key));
  // 어느 열에도 안 잡힌 행(값이 비었거나 지운 옵션) — 숨기면 영영 안 보인다
  const loose = flowCol ? shown.filter((it) => !kanbanCols.some((c) => String(it.values?.[flowCol.id] ?? "") === c.key)) : [];
  const partnerColId = cols.find((c) => c.type === "partner")?.id || null;
  const openItem = items.find((i) => i.id === openItemId) || null;
  // 문서 팝업이 볼 것들 — 행, 그 행에 붙은 문서, 금액(원 단위 숫자 칸), 거래처
  const docModalItem = docModal ? items.find((i) => i.id === docModal.itemId) || null : null;
  const docModalDoc = (() => {
    if (!docModalItem) return null;
    const key = docModal!.kind === "quote" ? DOC_VALUE_KEY : CONTRACT_VALUE_KEY;
    const linked = (docModalItem.values || {})[key] as { id?: string } | undefined;
    return (dealDocs as any[]).find((d) => d.id === linked?.id) || null;
  })();
  const docModalAmount = (() => {
    if (!docModalItem) return 0;
    const c = cols.find((x) => x.type === "number" && (x.settings?.unit || "") === "원");
    return c ? Number(docModalItem.values?.[c.id]) || 0 : 0;
  })();
  const docModalPartner = (() => {
    if (!docModalItem || !partnerColId) return null;
    const pid = docModalItem.values?.[partnerColId];
    return (partners as any[]).find((x) => x.id === pid) || null;
  })();
  // 계획 대비 실적 — 같은 단위 숫자 컬럼이 둘이면 그 비율을 행에 바로 보여준다
  //   (예산 대비 집행, 예상 대비 확정). 정리 탭의 '차이' 카드와 같은 두 컬럼을 쓴다.
  const ratioPair = (() => {
    const nums = cols.filter((c) => c.type === "number");
    if (nums.length < 2) return null;
    const [a, b] = nums;
    if ((a.settings?.unit || "") !== (b.settings?.unit || "")) return null;
    return { plan: a, real: b };
  })();
  const numberCols = cols.filter((c) => c.type === "number");

  return (
    <div className="pb">
      {/* ── 툴바 3층 (2026-08-04 사장님 지시) ──
          성격이 다른 동작을 한 줄에 섞어 두니 버튼이 뭘 하는지 안 읽혔다. 층으로 가른다:
            ① 템플릿 줄 — 무엇을 볼지 + 템플릿 자체 관리(⋯)
            ② 보기 줄   — 입력(표·칸반) / 보기(타임라인·정리) 를 라벨로 나눠 묶는다
            ③ 그룹 아래 — ＋ 그룹 추가(무엇에 대한 추가인지 위치로 말한다) */}
      <div className="pb-bar1">
        {boards.map((b) => (
          <button key={b.id} type="button"
            onClick={() => { setActiveId(b.id); setShowSummary(false); setSort(null); setOpenItemId(null); }}
            onDoubleClick={() => { if (b.id === boardId) setRenaming(true); }}
            title="더블클릭하면 이름을 바꿉니다"
            className={`pb-tab ${b.id === boardId && !showSummary ? "pb-tab-on" : ""}`}>{b.name}</button>
        ))}
        <button type="button" className="pb-tab pb-tab-add" onClick={() => setPicking(true)} title="템플릿 추가">＋ 템플릿</button>
        <span className="pb-tplmenu">
          <button type="button" className={`pb-dots ${tplMenu ? "pb-dots-on" : ""}`} onClick={() => setTplMenu((v) => !v)}
            title="이 템플릿 관리" aria-label="템플릿 메뉴">⋯</button>
          {tplMenu && (<>
            <span className="pb-menu-veil" onClick={() => setTplMenu(false)} />
            <span className="pb-menu">
              <button type="button" onClick={() => { setTplMenu(false); setRenaming(true); }}>이름 바꾸기</button>
              <button type="button" onClick={duplicateBoard}>템플릿 복제</button>
              <button type="button" onClick={() => { setTplMenu(false); setTrashOpen(true); }}>지운 항목</button>
              <button type="button" className="pb-menu-danger" onClick={() => { setTplMenu(false); removeBoard(); }}>템플릿 삭제</button>
            </span>
          </>)}
        </span>
      </div>

      <div className="pb-bar2">
        {/* 한 상자 안에 '입력'과 '보기' 를 구분선으로 가른다. 라벨은 상자 안쪽에 두고
            눌리지 않는 모양으로 — 라벨이 버튼처럼 보여 헛클릭이 났다(2026-08-05 사장님 지적). */}
        <div className="pb-views" role="group" aria-label="보는 방식">
          <span className="pb-views-sec">
            <b>입력</b>
            {INPUT_MODES.map((v) => (
              <button key={v} type="button" onClick={() => { setShowSummary(false); pickView(v); }}
                aria-pressed={!showSummary && view === v}
                className={`pb-viewbtn ${!showSummary && view === v ? "pb-viewbtn-on" : ""}`}>
                {v === "board" ? "칸반" : "표"}
              </button>
            ))}
          </span>
          <span className="pb-views-sep" aria-hidden="true" />
          <span className="pb-views-sec">
            <b>보기</b>
            {span && (
              <button type="button" onClick={() => { setShowSummary(false); pickView("timeline"); }}
                aria-pressed={!showSummary && view === "timeline"}
                className={`pb-viewbtn ${!showSummary && view === "timeline" ? "pb-viewbtn-on" : ""}`}>타임라인</button>
            )}
            {hasDate && (
              <button type="button" onClick={() => { setShowSummary(false); pickView("calendar"); }}
                aria-pressed={!showSummary && view === "calendar"}
                className={`pb-viewbtn ${!showSummary && view === "calendar" ? "pb-viewbtn-on" : ""}`}>캘린더</button>
            )}
            <button type="button" onClick={() => setShowSummary(true)} aria-pressed={showSummary}
              className={`pb-viewbtn ${showSummary ? "pb-viewbtn-on" : ""}`}>정리</button>
          </span>
        </div>
        {!showSummary && (
          <span className="pb-filters">
            {([["mine", "내 담당"], ["week", "이번 주"], ["open", "미완료만"]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={filters[k]}
                onClick={() => setFilters((f) => ({ ...f, [k]: !f[k] }))}
                className={`pb-filter ${filters[k] ? "pb-filter-on" : ""}`}>{label}</button>
            ))}
            {hiddenCount > 0 && <em>{hiddenCount}건 숨김</em>}
          </span>
        )}
      </div>

      {renaming && board && (
        <input autoFocus defaultValue={board.name} className="pb-rename"
          onBlur={(e) => renameBoard(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(false); }} />
      )}

      {/* 계약 결제조건 → 청구 행 제안. 규칙대로 **만드는 건 사람이 누른다**(2026-08-04 기획 3단계) */}
      {proposal && !showSummary && (
        <div className="pb-propose">
          <b>계약서 결제조건대로 청구 줄을 만들까요?</b>
          <span>
            {proposal.terms.map((t) => `${t.label}${t.ratio ? ` ${t.ratio}%` : ""}${t.amount ? ` ${Math.round(t.amount).toLocaleString("ko-KR")}원` : ""}`).join(" · ")}
            {" — 회차마다 한 줄씩 생기고 금액·조건이 채워집니다."}
          </span>
          <button type="button" disabled={proposing} onClick={() => addTermRows(proposal.terms)}>
            {proposing ? "만드는 중…" : `${proposal.terms.length}줄 만들기`}
          </button>
        </div>
      )}

      {/* 고른 줄에 한 번에 — 비용 정리·단계 이동처럼 여러 건을 같이 만질 때 */}
      {selected.size > 0 && !showSummary && (
        <div className="pb-bulk" role="status">
          <b>{selected.size}건 선택</b>
          {flowCol && (
            <select value="" onChange={(e) => { if (e.target.value) bulkValue(flowCol.id, e.target.value); }}>
              <option value="">{flowCol.name} 바꾸기</option>
              {((flowCol.settings?.options || []) as any[]).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}
          {cols.filter((c) => c.type === "person")[0] && (
            <select value="" onChange={(e) => { if (e.target.value) bulkValue(cols.filter((c) => c.type === "person")[0].id, e.target.value); }}>
              <option value="">담당 지정</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          {groups.length > 1 && (
            <select value="" onChange={(e) => { if (e.target.value) bulkPatch({ group_id: e.target.value }); }}>
              <option value="">그룹 옮기기</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          {boards.length > 1 && (
            <select value="" onChange={(e) => { if (e.target.value) moveToBoard(e.target.value); }}>
              <option value="">다른 템플릿으로</option>
              {boards.filter((b) => b.id !== boardId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button type="button" className="pb-bulk-x" onClick={bulkDelete}>삭제</button>
          <button type="button" className="pb-bulk-off" onClick={() => setSelected(new Set())}>선택 해제</button>
        </div>
      )}

      {/* 지운 직후 한 번 — 놓쳐도 ⋯ > 지운 항목에서 되살릴 수 있다 */}
      {undo && (
        <div className="pb-undo" role="status">
          <span>{undo.label} 을 지웠어요.</span>
          <button type="button" onClick={runUndo}>되돌리기</button>
          <button type="button" className="pb-undo-x" onClick={() => setUndo(null)} aria-label="닫기">✕</button>
        </div>
      )}

      {trashOpen && (
        <BoardTrash dealId={dealId} boardIds={boardIds}
          boardNames={Object.fromEntries(boards.map((b) => [b.id, b.name]))}
          onClose={() => setTrashOpen(false)} />
      )}

      {/* 문서 팝업 — 견적·계약·발행. 화면을 옮기지 않고 여기서 끝낸다 */}
      {docModalItem && (
        <BoardDocModal
          kind={docModal!.kind}
          rowName={docModalItem.name}
          doc={docModalDoc}
          amount={docModalAmount}
          partnerName={docModalPartner?.name || ""}
          partnerId={docModalPartner?.id || null}
          companyId={companyId} dealId={dealId} userId={userId}
          onClose={() => setDocModal(null)}
          onSent={() => markStage(docModalItem, /견적/)}
          onApproved={() => markStage(docModalItem, /계약/)}
          onIssued={() => markStage(docModalItem, /발행/)} />
      )}

      {/* 행 상세 — 표·칸반 어디서 열어도 같은 서랍. 칸 편집기는 같은 Cell 을 넘겨준다 */}
      {openItem && (
        <BoardItemDrawer
          item={openItem} cols={cols} companyId={companyId} userId={userId} users={users}
          nameLabel={nameLabel}
          onClose={() => setOpenItemId(null)}
          onSaveName={(v) => saveName(openItem, v)}
          renderCell={(c) => (
            <Cell col={c} item={openItem} users={users} partners={partners as any[]} companyId={companyId}
              onPartnerCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })}
              onSave={(v) => saveValue(openItem, c.id, v)} />
          )} />
      )}

      {showSummary ? (
        <ProjectSummary boards={boards} cols={allCols} groups={allGroups} items={allItems} users={users} />
      ) : view === "calendar" && hasDate ? (
        <BoardCalendar items={shown} cols={cols} flowCol={flowCol} onOpen={(id) => setOpenItemId(id)} />
      ) : view === "timeline" && span ? (
        <BoardTimeline items={shown} span={span} flowCol={flowCol} nameLabel={nameLabel}
          onAdd={() => addItem(groups[0]?.id || "")} />
      ) : view === "board" ? (
        /* 칸반 — 카드를 끌어 다음 단계로. 단계는 라벨이므로 셀에서 바꾸는 것과 같은 값을 만진다
           (2026-08-03 사장님: "굳이 섹션까지 나눌 필요 없이 기본 라벨로"). */
        <div className="pb-kanban">
          {kanbanCols.map((kc) => {
            const cards = cardsOf(kc.key);
            const sum = numberCols.length > 0 ? sumColumn(cards, numberCols[0].id) : 0;
            return (
              <section key={kc.key}
                onDragOver={(e) => { e.preventDefault(); setDragOver(kc.key); }}
                onDragLeave={() => setDragOver((v) => (v === kc.key ? null : v))}
                onDrop={(e) => { e.preventDefault(); if (dragId) moveCard(dragId, kc.key); setDragId(null); setDragOver(null); }}
                className={`pb-kcol ${dragOver === kc.key ? "pb-kcol-over" : ""}`}>
                <div className="pb-kcol-head">
                  <i style={{ background: kc.color }} />
                  <b>{kc.label}</b>
                  <span>{cards.length}</span>
                  {sum > 0 && <em>{won(sum)}</em>}
                </div>
                <div className="pb-kcol-body">
                  {cards.map((it) => (
                    <article key={it.id} draggable
                      onDragStart={() => setDragId(it.id)} onDragEnd={() => { setDragId(null); setDragOver(null); }}
                      className={`pb-card ${dragId === it.id ? "pb-card-drag" : ""}`}>
                      <input defaultValue={it.name} placeholder={`${nameLabel} 입력`}
                        onBlur={(e) => saveName(it, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        className="pb-card-name" />
                      <div className="pb-card-fields">
                        {cols.filter((c) => c.id !== flowCol?.id).slice(0, 4).map((c) => (
                          <span key={c.id} className="pb-card-field">
                            <label>{c.name}</label>
                            <Cell col={c} item={it} users={users} partners={partners as any[]} companyId={companyId}
                              onPartnerCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })}
                              onSave={(v) => saveValue(it, c.id, v)} />
                          </span>
                        ))}
                      </div>
                      {ratioPair && <RatioBar plan={Number(it.values?.[ratioPair.plan.id]) || 0} real={Number(it.values?.[ratioPair.real.id]) || 0} />}
                      {isBilling && (
                        <DocChain it={it} busy={makingDoc === it.id} canMake={!!userId}
                          onQuote={() => openQuote(it)} onContract={() => makeContract(it)}
                          onIssue={() => setDocModal({ itemId: it.id, kind: "issue" })} />
                      )}
                      <span className="pb-card-tools">
                        <button type="button" className="pb-open" title="열기 — 메모·파일" onClick={() => setOpenItemId(it.id)}>⤢</button>
                        <button type="button" className="pb-card-x" title="행 삭제" onClick={() => removeItem(it)}>✕</button>
                      </span>
                    </article>
                  ))}
                  <button type="button" className="pb-kadd"
                    onClick={() => addItem(groups[0]?.id || "", flowCol ? { [flowCol.id]: kc.key } : undefined)}>
                    ＋ {nameLabel}
                  </button>
                </div>
              </section>
            );
          })}
          {loose.length > 0 && (
            <section className="pb-kcol pb-kcol-loose">
              <div className="pb-kcol-head"><i style={{ background: "#C4C4C4" }} /><b>단계 미지정</b><span>{loose.length}</span></div>
              <div className="pb-kcol-body">
                {loose.map((it) => (
                  <article key={it.id} draggable onDragStart={() => setDragId(it.id)} onDragEnd={() => setDragId(null)} className="pb-card">
                    <input defaultValue={it.name} placeholder={`${nameLabel} 입력`}
                      onBlur={(e) => saveName(it, e.target.value)} className="pb-card-name" />
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (<>

      {groups.map((g) => {
        const rows = sortRows(itemsByGroup[g.id] || [], sort, cols, users);
        return (
          <section key={g.id} className="pb-group">
            {/* 그룹이 하나뿐이면 머리줄을 숨긴다 — '요청 목록 6건' 한 줄이 뜻 없이 자리를 먹었다 */}
            {groups.length > 1 && (
              <div className="pb-group-head">
                <span className="pb-group-dot" style={{ background: g.color }} />
                <input defaultValue={g.name} className="pb-group-name"
                  onBlur={(e) => renameGroup(g, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                <span className="pb-group-n">{rows.length}건</span>
                <span className="pb-gmenu">
                  <button type="button" className="pb-dots" onClick={() => setGroupMenu(groupMenu === g.id ? null : g.id)}
                    title="그룹 관리" aria-label="그룹 메뉴">⋯</button>
                  {groupMenu === g.id && (<>
                    <span className="pb-menu-veil" onClick={() => setGroupMenu(null)} />
                    <span className="pb-menu">
                      <span className="pb-menu-colors">
                        {GROUP_COLORS.map((c) => (
                          <button key={c} type="button" style={{ background: c }} title="색 바꾸기" onClick={() => recolorGroup(g, c)} />
                        ))}
                      </span>
                      <button type="button" className="pb-menu-danger" onClick={() => removeGroup(g)}>그룹 삭제</button>
                    </span>
                  </>)}
                </span>
              </div>
            )}
            <div className="pb-scroll">
              <table className="pb-table">
                <thead>
                  <tr>
                    <th className="pb-th-sel">
                      <input type="checkbox" aria-label="이 그룹 모두 선택"
                        checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                        onChange={(e) => setSelected((prev) => {
                          const n = new Set(prev);
                          rows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id)));
                          return n;
                        })} />
                    </th>
                    <th className="pb-th-name">{nameLabel}</th>
                    {cols.map((c) => (
                      <th key={c.id} className={c.type === "number" ? "pb-th-num" : ""}>
                        <span className="pb-th-in">
                          <input defaultValue={c.name} className="pb-col-name"
                            onBlur={(e) => renameColumn(c, e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                          {/* 정렬 — 화살표를 눌러야 정렬된다(이름 칸은 이름 고치는 자리라 겹치면 안 된다) */}
                          <button type="button" className={`pb-col-sort ${sort?.colId === c.id ? "pb-col-sort-on" : ""}`}
                            title="이 컬럼으로 정렬"
                            onClick={() => setSort((s0) => s0?.colId === c.id ? (s0.dir === "asc" ? { colId: c.id, dir: "desc" } : null) : { colId: c.id, dir: "asc" })}>
                            {sort?.colId === c.id ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                          </button>
                          {/* 숫자 컬럼은 단위를 직접 정한다 — 정리가 원끼리만 빼고 %는 평균을 낸다 */}
                          {c.type === "number" && (
                            <input defaultValue={c.settings?.unit || ""} placeholder="단위" className="pb-col-unit"
                              onBlur={(e) => setUnit(c, e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                          )}
                          <button type="button" className="pb-col-x" title="이 컬럼 지우기" onClick={() => removeColumn(c)}>✕</button>
                        </span>
                      </th>
                    ))}
                    {ratioPair && <th className="pb-th-ratio">{ratioPair.real.name}률</th>}
                    {isBilling && <th className="pb-th-doc">견적서</th>}
                    <th className="pb-th-x">
                      {/* 컬럼은 표의 일부다 — 툴바가 아니라 표 머리 끝에 둔다 */}
                      <span className="pb-addcol">
                        <select value="" title="컬럼 추가" onChange={(e) => { if (e.target.value) addColumn(e.target.value as ColType); }}>
                          <option value="">＋</option>
                          <option value="text">텍스트</option>
                          <option value="number">숫자</option>
                          <option value="date">날짜</option>
                          <option value="status">상태</option>
                          <option value="person">사람</option>
                          <option value="partner">거래처</option>
                        </select>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => (
                    <tr key={it.id}>
                      <td className="pb-td-sel">
                        <input type="checkbox" aria-label="줄 선택" checked={selected.has(it.id)}
                          onChange={(e) => setSelected((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(it.id); else n.delete(it.id);
                            return n;
                          })} />
                      </td>
                      <td className="pb-td-name">
                        <span className="pb-name-cell">
                          <input defaultValue={it.name} placeholder={`${nameLabel} 입력`}
                            onBlur={(e) => saveName(it, e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            className="pb-in" />
                          <button type="button" className="pb-open" title="열기 — 메모·파일" onClick={() => setOpenItemId(it.id)}>⤢</button>
                          <button type="button" className="pb-open" title="한 줄 복제" onClick={() => duplicateItem(it)}>⧉</button>
                        </span>
                      </td>
                      {cols.map((c) => (
                        <td key={c.id} className={c.type === "number" ? "pb-td-num" : ""}>
                          <Cell col={c} item={it} users={users} partners={partners as any[]} companyId={companyId}
                            onPartnerCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })}
                            onFillDown={() => {
                              // 엑셀 습관 그대로 — 바로 윗줄 값을 끌어온다
                              const idx = rows.findIndex((r) => r.id === it.id);
                              const above = idx > 0 ? rows[idx - 1] : null;
                              if (above) saveValue(it, c.id, above.values?.[c.id] ?? null);
                            }}
                            onSave={(v) => saveValue(it, c.id, v)} />
                        </td>
                      ))}
                      {ratioPair && (
                        <td className="pb-td-ratio">
                          <RatioBar plan={Number(it.values?.[ratioPair.plan.id]) || 0} real={Number(it.values?.[ratioPair.real.id]) || 0} />
                        </td>
                      )}
                      {isBilling && (
                        <td className="pb-td-doc">
                          <DocChain it={it} busy={makingDoc === it.id} canMake={!!userId}
                            onQuote={() => openQuote(it)} onContract={() => makeContract(it)}
                            onIssue={() => setDocModal({ itemId: it.id, kind: "issue" })} />
                        </td>
                      )}
                      <td className="pb-td-x">
                        <button type="button" className="pb-x" title="행 삭제" onClick={() => removeItem(it)}>✕</button>
                      </td>
                    </tr>
                  ))}
                  <QuickAddRow key={`qa-${g.id}`} nameLabel={nameLabel} cols={cols}
                    span={cols.length + (isBilling ? 3 : 2) + (ratioPair ? 1 : 0) + 1}
                    onAdd={(name, values) => addItem(g.id, values, name)} />
                  {rows.length > 0 && numberCols.length > 0 && (
                    <tr className="pb-sum">
                      <td />
                      <td>합계</td>
                      {cols.map((c) => (
                        <td key={c.id} className={c.type === "number" ? "pb-td-num" : ""}>
                          {c.type === "number" ? won(sumColumn(rows, c.id)) : ""}
                        </td>
                      ))}
                      {ratioPair && <td />}
                      {isBilling && <td />}
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {/* 무엇에 대한 추가인지 위치로 말한다 — 마지막 그룹 바로 아래 */}
      <button type="button" className="pb-addgroup" onClick={addGroup}>＋ 그룹 추가</button>
      </>)}
    </div>
  );
}

// ── 빠른 입력 줄 — 빈 행을 만들고 칸을 옮겨 다니는 대신 한 줄에서 끝낸다 (2026-08-04 기획 5단계) ──
//   이름 + 첫 숫자 + 첫 날짜만 받는다. 나머지는 만들어진 행에서 채우면 된다.
//   Enter 를 치면 저장하고 이름 칸으로 커서가 돌아온다 — 비용처럼 여러 건을 연달아 넣을 때가 많다.
function QuickAddRow({ nameLabel, cols, span, onAdd }: {
  nameLabel: string; cols: BoardColumn[]; span: number;
  onAdd: (name: string, values: Record<string, any>) => Promise<void> | void;
}) {
  const numCol = cols.find((c) => c.type === "number") || null;
  const dateCol = cols.find((c) => c.type === "date") || null;
  const [name, setName] = useState("");
  const [num, setNum] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const values: Record<string, any> = {};
      if (numCol && num.trim()) values[numCol.id] = Number(num.replace(/[^0-9.-]/g, "")) || 0;
      if (dateCol && date) values[dateCol.id] = date;
      await onAdd(name.trim(), values);
      setName(""); setNum(""); setDate("");
      nameRef.current?.focus();
    } finally { setBusy(false); }
  };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };

  return (
    <tr className="pb-quick">
      <td colSpan={span}>
        <span className="pb-quick-row">
          <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey}
            placeholder={`＋ ${nameLabel} 입력하고 Enter`} className="pb-quick-name" />
          {numCol && (
            <input value={num} onChange={(e) => setNum(e.target.value)} onKeyDown={onKey} inputMode="numeric"
              placeholder={numCol.name} className="pb-quick-num" />
          )}
          {dateCol && (
            <span onKeyDown={onKey}>
              <DateField value={date} onChange={(e) => setDate(e.target.value)} className="pb-quick-date" />
            </span>
          )}
          <button type="button" onClick={submit} disabled={busy || !name.trim()} className="pb-quick-go">
            {busy ? "…" : "추가"}
          </button>
        </span>
      </td>
    </tr>
  );
}

// ── 계획 대비 실적 막대 — 예산 대비 집행, 예상 대비 확정 ──
function RatioBar({ plan, real }: { plan: number; real: number }) {
  if (!plan && !real) return <span className="pb-ratio-none">—</span>;
  const pct = plan > 0 ? Math.round((real / plan) * 100) : null;
  const over = pct != null && pct > 100;
  return (
    <span className="pb-ratio" title={pct == null ? "계획 없음" : `${real.toLocaleString("ko-KR")} / ${plan.toLocaleString("ko-KR")}`}>
      <span className="pb-ratio-track">
        <i className={over ? "pb-ratio-over" : ""} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </span>
      <em className={over ? "pb-ratio-bad" : ""}>{pct == null ? "—" : `${pct}%`}</em>
    </span>
  );
}

// ── 문서 체인 — 청구 한 줄이 견적 → 계약으로 이어진다 (2026-08-04 기획 3단계) ──
//   발행·입금은 세금계산서 화면이 맡는다. 여기서는 만들어진 문서로 가는 길만 준다.
function DocChain({ it, busy, canMake, onQuote, onContract, onIssue }: {
  it: BoardItem; busy: boolean; canMake: boolean;
  onQuote: () => void; onContract: () => void; onIssue: () => void;
}) {
  const quote = (it.values || {})[DOC_VALUE_KEY] as { id?: string; no?: string } | undefined;
  const contract = (it.values || {})[CONTRACT_VALUE_KEY] as { id?: string; no?: string } | undefined;
  return (
    <span className="pb-chain">
      {quote?.id
        ? <button type="button" className="pb-chain-on" onClick={onQuote} title="견적서 열기">견적 {quote.no || ""}</button>
        : <button type="button" className="pb-chain-do" disabled={busy || !canMake} onClick={onQuote}>{busy ? "…" : "＋ 견적서"}</button>}
      {quote?.id && (contract?.id
        ? <button type="button" className="pb-chain-on" onClick={onContract} title="계약서 열기">계약</button>
        : <button type="button" className="pb-chain-do" disabled={busy || !canMake} onClick={onContract}>＋ 계약서</button>)}
      {contract?.id && <button type="button" className="pb-chain-do" onClick={onIssue} title="세금계산서 만들기">＋ 발행</button>}
    </span>
  );
}

// ── 타임라인(간트) — '일정 · 마일스톤' 처럼 기간이 본체인 일 (2026-08-04 기획 2단계) ──
//   막대 색은 흐름 상태 컬럼의 옵션 색을 그대로 쓴다 — 화면마다 색 뜻이 갈리지 않게.
function BoardTimeline({ items, span, flowCol, nameLabel, onAdd }: {
  items: BoardItem[];
  span: { start: BoardColumn; end: BoardColumn };
  flowCol: BoardColumn | null;
  nameLabel: string;
  onAdd: () => void;
}) {
  const DAY = 86_400_000;
  const dayOf = (v: any) => {
    const sv = String(v || "");
    if (!/^\d{4}-\d{2}-\d{2}/.test(sv)) return null;
    return new Date(`${sv.slice(0, 10)}T00:00:00`).getTime();
  };
  const rows = items.map((it) => {
    const a = dayOf(it.values?.[span.start.id]);
    const b = dayOf(it.values?.[span.end.id]);
    const s = a ?? b, e = b ?? a;
    return { it, s, e: s != null && e != null ? Math.max(s, e) : e };
  });
  const dated = rows.filter((r) => r.s != null) as { it: BoardItem; s: number; e: number }[];
  const undated = rows.filter((r) => r.s == null).map((r) => r.it);

  if (dated.length === 0) {
    return (
      <p className="pj-sec-empty">
        {span.start.name}·{span.end.name} 을 채우면 여기에 기간 막대로 그려져요.
        <button type="button" className="pb-kadd ml-2" onClick={onAdd}>＋ {nameLabel}</button>
      </p>
    );
  }

  const min = Math.min(...dated.map((r) => r.s)) - 3 * DAY;
  const max = Math.max(...dated.map((r) => r.e)) + 3 * DAY;
  const totalDays = Math.max(1, Math.round((max - min) / DAY));
  const pct = (ms: number) => ((ms - min) / (max - min)) * 100;
  const todayMs = new Date(`${todayKst()}T00:00:00`).getTime();
  const todayPct = pct(todayMs);

  // 눈금 — 8칸 안팎으로 나눈다
  const step = Math.max(1, Math.round(totalDays / 8));
  const ticks: { left: number; label: string }[] = [];
  for (let d = 0; d <= totalDays; d += step) {
    const ms = min + d * DAY;
    ticks.push({ left: pct(ms), label: new Date(ms).toISOString().slice(5, 10).replace("-", "/") });
  }

  const colorOf = (it: BoardItem) => {
    if (!flowCol) return "var(--primary)";
    const opt = (flowCol.settings?.options || []).find((o: any) => o.id === it.values?.[flowCol.id]);
    return opt?.color || "var(--primary)";
  };

  return (
    <div className="pb-gantt">
      <div className="pb-gantt-head">
        <span className="pb-gantt-name" />
        <span className="pb-gantt-track">
          {ticks.map((tk, i) => <i key={i} style={{ left: `${tk.left}%` }}>{tk.label}</i>)}
        </span>
      </div>
      <div className="pb-gantt-rows">
        {dated.sort((a, b) => a.s - b.s).map(({ it, s, e }) => {
          const left = pct(s);
          const width = Math.max(1.2, pct(Math.max(e, s + DAY)) - left);
          const late = e < todayMs;
          return (
            <div key={it.id} className="pb-gantt-row">
              <span className="pb-gantt-name" title={it.name || ""}>{it.name || "(이름 없음)"}</span>
              <span className="pb-gantt-track">
                {todayPct >= 0 && todayPct <= 100 && <b className="pb-gantt-today" style={{ left: `${todayPct}%` }} />}
                <span className="pb-gantt-bar" style={{ left: `${left}%`, width: `${width}%`, background: colorOf(it) }}
                  title={`${it.name || "(이름 없음)"} · ${String(it.values?.[span.start.id] || "").slice(0, 10)} ~ ${String(it.values?.[span.end.id] || "").slice(0, 10)}`}>
                  <em>{it.name || "(이름 없음)"}</em>
                </span>
                {late && <i className="pb-gantt-late" style={{ left: `${Math.min(99, left + width)}%` }}>지남</i>}
              </span>
            </div>
          );
        })}
      </div>
      {undated.length > 0 && (
        <p className="pb-gantt-undated">날짜가 없어 안 그려진 것 {undated.length}건 — 표 보기에서 {span.start.name}을 채워 주세요.</p>
      )}
    </div>
  );
}

/** 행을 뭐라고 부를지 — 되돌리기 문구가 조기 반환보다 앞에서도 필요해 순수 함수로 둔다 */
function nameLabelOf(templateKey: string | null | undefined): string {
  return ITEM_LABEL[templateKey || "blank"] || "행";
}

/** 행 정렬 — 컬럼 타입에 맞게. 값이 빈 행은 방향과 무관하게 늘 뒤로 보낸다. */
function sortRows(rows: BoardItem[], sort: { colId: string; dir: "asc" | "desc" } | null,
  cols: BoardColumn[], users: { id: string; name: string }[]): BoardItem[] {
  if (!sort) return rows;
  const c = cols.find((x) => x.id === sort.colId);
  if (!c) return rows;
  const key = (it: BoardItem): string | number | null => {
    const v = it.values?.[c.id];
    if (v === null || v === undefined || v === "") return null;
    if (c.type === "number") return Number(v) || 0;
    if (c.type === "status") {
      const i = (c.settings?.options || []).findIndex((o: any) => o.id === v);
      return i < 0 ? null : i;
    }
    if (c.type === "person") return users.find((u) => u.id === v)?.name || "";
    return String(v);
  };
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;      // 빈 값은 늘 아래
    if (kb === null) return -1;
    if (typeof ka === "number" && typeof kb === "number") return (ka - kb) * sign;
    return String(ka).localeCompare(String(kb), "ko") * sign;
  });
}

// ── 프로젝트 정리 — 이 프로젝트의 **모든 템플릿**을 하나씩 구획으로 ──
//   한 프로젝트에 템플릿을 여러 개 붙이는 게 기본이라(＋), 정리도 그 단위여야 맞다.
function ProjectSummary({ boards, cols, groups, items, users }: {
  boards: { id: string; name: string; template_key: string | null }[];
  cols: BoardColumn[]; groups: BoardGroup[]; items: BoardItem[]; users: { id: string; name: string }[];
}) {
  const filled = boards.filter((b) => items.some((i) => i.board_id === b.id));
  if (filled.length === 0) {
    return <p className="pj-sec-empty">템플릿에 값을 채우면 여기에 합계·분포·마감이 자동으로 정리돼요.</p>;
  }
  return (
    <div className="pb-sum-all">
      {/* 표를 가로지르는 돈 요약이 맨 위 — 표별 카드보다 이게 먼저 읽혀야 한다(2026-08-05) */}
      <ProjectMoneyReport boards={boards} cols={cols} items={items} />
      <p className="pb-sum-top">템플릿 {filled.length}개 · 총 {items.length}행 — 입력된 칸만 요약했어요.</p>
      {filled.map((b) => (
        <section key={b.id} className="pb-sum-sec">
          <h4 className="pb-sum-sec-h">{b.name}<em>{items.filter((i) => i.board_id === b.id).length}행</em></h4>
          <BoardSummary
            cols={cols.filter((c) => c.board_id === b.id)}
            items={items.filter((i) => i.board_id === b.id)}
            groups={groups.filter((g) => g.board_id === b.id)}
            users={users} />
        </section>
      ))}
    </div>
  );
}

// ── 템플릿 하나 — 컬럼 타입만 보고 만든 요약. 값이 없는 항목은 그리지 않는다 ──
function BoardSummary({ cols, items, groups, users }: {
  cols: BoardColumn[]; items: BoardItem[]; groups: BoardGroup[]; users: { id: string; name: string }[];
}) {
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || "";
  const cards: SummaryCard[] = buildBoardSummary(cols, items, groups, nameOf, todayKst());
  if (cards.length === 0) {
    return <p className="pj-sec-empty">템플릿에 값을 채우면 여기에 합계·분포·마감이 자동으로 정리돼요.</p>;
  }
  return (
    <div className="pb-sum-grid">
      {cards.map((c, i) => {
        if (c.kind === "number") return (
          <div key={i} className="pb-sum-card"><span>{c.label} {c.mode === "avg" ? "평균" : "합계"}</span>
            <b>{(c.mode === "avg" ? c.avg : c.sum).toLocaleString("ko-KR")}{c.unit}</b>
            <em>{c.filled}건 입력{c.mode === "avg" ? "" : ` · 평균 ${c.avg.toLocaleString("ko-KR")}${c.unit}`}</em></div>
        );
        if (c.kind === "weighted") return (
          <div key={i} className="pb-sum-card"><span>{c.label}</span>
            <b>{c.value.toLocaleString("ko-KR")}원</b>
            <em>{c.a} × {c.b} — 확률까지 반영한 값</em></div>
        );
        if (c.kind === "diff") return (
          <div key={i} className="pb-sum-card"><span>{c.label}</span>
            <b className={c.value < 0 ? "pb-sum-bad" : "pb-sum-ok"}>{c.value.toLocaleString("ko-KR")}{c.unit}</b>
            <em>{c.a}에서 {c.b}을 뺀 값</em></div>
        );
        if (c.kind === "status" || c.kind === "group") {
          const total = c.parts.reduce((n, p) => n + p.count, 0) || 1;
          return (
            <div key={i} className="pb-sum-card pb-sum-wide"><span>{c.label}</span>
              <b>{c.kind === "status" && c.doneRate != null ? `완료율 ${c.doneRate}%` : `${total}건`}</b>
              <span className="pb-sum-bar">
                {c.parts.map((p) => <i key={p.label} style={{ width: `${(p.count / total) * 100}%`, background: p.color }} />)}
              </span>
              <span className="pb-sum-legend">
                {c.parts.map((p) => <span key={p.label}><i style={{ background: p.color }} />{p.label} {p.count}</span>)}
              </span></div>
          );
        }
        if (c.kind === "date") return (
          <div key={i} className="pb-sum-card"><span>{c.label}</span>
            <b className={c.late > 0 ? "pb-sum-bad" : ""}>{c.late > 0 ? `지난 것 ${c.late}건` : `이번 주 ${c.soon}건`}</b>
            <em>{c.next ? `다음 ${c.next}` : "예정된 날짜 없음"}{c.late > 0 ? ` · 이번 주 ${c.soon}건` : ""}</em></div>
        );
        return (
          <div key={i} className="pb-sum-card pb-sum-wide"><span>{c.label}별</span>
            <b>{c.rows.length}명</b>
            <em>{c.rows.map((r) => `${r.name} ${r.count}건`).join(" · ")}</em></div>
        );
      })}
    </div>
  );
}

// ── 셀 — 타입별 편집기. 다섯 가지만 쓴다(텍스트·숫자·날짜·상태·사람) ──
function Cell({ col, item, users, partners, companyId, onSave, onPartnerCreated, onFillDown }: {
  col: BoardColumn; item: BoardItem; users: { id: string; name: string }[];
  partners: { id: string; name: string; business_number?: string | null }[];
  companyId: string; onSave: (v: any) => void; onPartnerCreated: () => void;
  /** Ctrl+D — 윗줄 값 끌어오기(표에서만 넘어온다) */
  onFillDown?: () => void;
}) {
  //   입력 칸 어디서든 Ctrl/⌘+D 로 윗줄 값을 끌어온다
  const fillKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) { e.preventDefault(); onFillDown?.(); }
  };
  const v = item.values?.[col.id];
  if (col.type === "partner") {
    return <PartnerCell value={v || ""} partners={partners} companyId={companyId} onSave={onSave} onCreated={onPartnerCreated} />;
  }
  if (col.type === "number") {
    return (
      <input defaultValue={v == null || v === "" ? "" : Number(v).toLocaleString("ko-KR")} inputMode="numeric" placeholder="0"
        onBlur={(e) => {
          const n = Number(String(e.target.value).replace(/[^0-9.-]/g, ""));
          e.target.value = n ? n.toLocaleString("ko-KR") : "";
          onSave(Number.isFinite(n) && e.target.value !== "" ? n : null);
        }}
        onKeyDown={(e) => { fillKey(e); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="pb-in pb-in-num" />
    );
  }
  if (col.type === "date") {
    return <span onKeyDown={fillKey}><DateField value={v || ""} onChange={(e) => onSave(e.target.value || null)} className="pb-in pb-in-date" /></span>;
  }
  if (col.type === "status") {
    const options: any[] = col.settings?.options || [];
    const cur = options.find((o) => o.id === v);
    return (
      <span className="pb-status" style={cur ? { background: cur.color } : undefined}>
        <select value={v || ""} onKeyDown={fillKey} onChange={(e) => onSave(e.target.value || null)}>
          <option value="">—</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <i>{cur?.label || "—"}</i>
      </span>
    );
  }
  if (col.type === "person") {
    return (
      <select value={v || ""} onKeyDown={fillKey} onChange={(e) => onSave(e.target.value || null)} className="pb-in pb-in-sel">
        <option value="">—</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    );
  }
  return (
    <input defaultValue={v || ""} placeholder="—"
      onBlur={(e) => onSave(e.target.value || null)}
      onKeyDown={(e) => { fillKey(e); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="pb-in" />
  );
}

// ── 거래처 셀 — 검색해서 고르고, 없으면 그 자리에서 만든다(전표입력과 같은 방식) ──
//   값은 partners.id 를 담는다. 이름만으로 만들 수 있게 해서 입력이 끊기지 않게 한다.
function PartnerCell({ value, partners, companyId, onSave, onCreated }: {
  value: string; partners: { id: string; name: string; business_number?: string | null }[];
  companyId: string; onSave: (v: any) => void; onCreated: () => void;
}) {
  const { toast } = useToast();
  const cur = partners.find((p) => p.id === value);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return partners.slice(0, 20);
    const tn = t.replace(/-/g, "");
    return partners.filter((p) =>
      (p.name || "").toLowerCase().includes(t) || (p.business_number || "").replace(/-/g, "").includes(tn)
    ).slice(0, 30);
  }, [partners, q]);
  const exact = matches.some((p) => (p.name || "").trim() === q.trim());

  const createNow = async () => {
    const name = q.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const row: any = await upsertPartner({ companyId, name });
      const id = row?.id || row?.data?.id;
      if (!id) throw new Error("등록 실패");
      onSave(id);
      onCreated();
      setOpen(false);
      setQ("");
      toast(`'${name}' 거래처를 등록했습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "거래처 등록 실패", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="pb-in pb-partner-btn" onClick={() => { setOpen(true); setQ(""); }}>
        {cur?.name || <span className="pb-partner-empty">거래처 선택</span>}
      </button>
    );
  }
  return (
    <span className="pb-partner">
      <input autoFocus value={q} placeholder="거래처 검색 또는 새 이름"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (e.key === "Enter") { if (matches.length === 1 && !q.trim()) return; if (!exact && q.trim()) createNow(); else if (matches[0]) { onSave(matches[0].id); setOpen(false); } }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="pb-in pb-partner-in" />
      <span className="pb-partner-pop">
        {value && (
          <button type="button" className="pb-partner-opt pb-partner-clear" onMouseDown={(e) => { e.preventDefault(); onSave(null); setOpen(false); }}>선택 해제</button>
        )}
        {matches.map((p) => (
          <button key={p.id} type="button" className="pb-partner-opt"
            onMouseDown={(e) => { e.preventDefault(); onSave(p.id); setOpen(false); }}>
            {p.name}{p.business_number ? <em>{p.business_number}</em> : null}
          </button>
        ))}
        {q.trim() && !exact && (
          <button type="button" className="pb-partner-opt pb-partner-new" disabled={saving}
            onMouseDown={(e) => { e.preventDefault(); createNow(); }}>
            ＋ &apos;{q.trim()}&apos; 새 거래처로 등록
          </button>
        )}
        {matches.length === 0 && !q.trim() && <span className="pb-partner-none">등록된 거래처가 없어요</span>}
      </span>
    </span>
  );
}
