"use client";
import { koFallback } from "@/lib/ko-label";

// 프로젝트 표(보드) 화면 — 새 프로젝트 구조 1단계 (2026-08-03 기획 v2).
//   상단 탭에서 표를 고르고(＋로 추가), 그룹 안에 행을 쌓고, 셀을 눌러 바로 고친다.
//   숫자 컬럼은 그룹마다 합계가 자동으로 붙는다.
//
// 설계 메모
//   · 값은 행의 values(jsonb)에 컬럼ID로 담는다 — 컬럼을 더해도 DB 구조를 안 바꾼다.
//   · 저장은 셀 단위 즉시 반영(낙관적 갱신 없이 서버 응답 후 무효화) — 입력 중 화면이 튀지 않게
//     텍스트·숫자는 blur/Enter 에서만 저장한다.
//   · 정렬은 position 오름차순. 새 행은 그룹 맨 아래.

import { useMemo, useState, useRef, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";
import { useToast } from "@/components/toast";
import { QueryBar, ChipGroup, QuickSearch, quickSearchHit, quickTerms, ConditionPanel, ConditionRow, TokenField, AppliedChips, ExcelMenu, type AppliedChip } from "@/components/query-kit";
import { exportToExcel } from "@/lib/excel-export";
import { xNum, type ExcelColumn } from "@/lib/excel-io";
import { ExcelUploadDialog } from "@/app/(app)/inventory/_components/excel-upload";
import { DateRangeField } from "@/components/date-range-field";
import { DateField } from "@/components/date-field";
import { getPartners, upsertPartner } from "@/lib/partners";
import { buildQuoteContent, buildContractContent, insertDocument } from "@/lib/documents";
import { BoardItemDrawer } from "./BoardItemDrawer";
import { BoardDocModal, type DocKind } from "./BoardDocModal";
import { BoardTrash } from "./BoardTrash";
import { BoardCalendar } from "./BoardCalendar";
import { ProjectMoneyReport } from "./ProjectMoneyReport";
import { BoardMinutes } from "./BoardMinutes";
import { BoardInbox } from "./BoardInbox";
import { BoardExpiry } from "./BoardExpiry";
import { BoardExpense } from "./BoardExpense";
import { BoardDeals } from "./BoardDeals";
import { hasMoneyData } from "@/lib/project-money-rollup";
import { BoardFigure } from "./BoardFigures";
import { AdDashboard } from "./AdDashboard";
import { templateFigures, shapeFigures, summaryCardKey, type Figure, boardDigest, type BoardChip } from "@/lib/project-template-summary";
import { todayKst, mondayOfStr, addDaysStr } from "@/lib/kst";
import { BoardNewModal, LabelEditor } from "./BoardNewModal";
import { listPresets, savePreset, updatePreset, removePreset, type Preset } from "@/lib/board-presets";
import {
  listAdAccounts, listDealAdAccounts, linkAdAccount, unlinkAdAccount,
  rollupCampaigns, fillAdBoard, AD_PERIODS, type AdPeriodKey,
} from "@/lib/project-ads";
import {
  applyLayout, layoutFrom, normalizeLayout, SUMMARY_SHAPES,
  type SummaryLayout, type SummaryShape,
} from "@/lib/summary-layout";
import {
  findTemplate, ITEM_LABEL, templateKind, sumColumn, buildBoardSummary, DOC_VALUE_KEY,
  flowColumnOf, spanColumnsOf, terminalOptionId, CONTRACT_VALUE_KEY, payTermsOf, INPUT_MODES, inputModesOf, MODE_LABEL, isDoneRow, START_DATE_RE,
  COL_FORMATS, DEFAULT_STATUS_OPTIONS, TODO_LINK_KEY,
  type InputMode, type PayTermRow, type ColumnDef, type GroupDef, type StatusOption,
  type BoardColumn, type BoardGroup, type BoardItem, type ColType, type SummaryCard,
} from "@/lib/project-boards";

// ⚠️ 새 표(project_board*)는 아직 생성된 DB 타입(src/types/database.ts)에 없다 —
//   타입 재생성(supabase gen types)은 CLI 가 있는 PC 에서 돌려야 해서, 그때까지는 느슨한 클라이언트를 쓴다.
//   (레포에 이미 쓰이는 방식: (supabase as any).from/rpc)
const db = supabase as any;
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
/** 표 칸 너비(px) — globals.css 의 .pbc-* 와 같은 값. 표의 최소 너비를 셈할 때 쓴다. */
const COL_W = { sel: 58, name: 200, cell: 132, ratio: 116, doc: 110, tail: 60 };
/** 칸마다 고르는 너비 — 머리의 ⋯ 에서 정한다. settings.width(px) 에 담으니 DB 구조는 안 바뀐다.
 *  (2026-08-06 사장님: "지금 칸이 너무 넓은 듯" — 기본을 줄이고, 긴 글이 드는 칸만 넓게 둘 수 있게) */
const COL_WIDTHS: { key: string; label: string; px: number }[] = [
  { key: "narrow", label: "좁게", px: 100 },
  { key: "normal", label: "보통", px: COL_W.cell },
  { key: "wide", label: "넓게", px: 210 },
];
const widthOf = (c: BoardColumn) => Number(c.settings?.width) || COL_W.cell;
/** 첫 칸(행 이름)의 슬롯 id — 칸 id 와 섞이지 않게 예약어를 쓴다 */
const NAME_SLOT = "__name__";
/** 표 머리에 서는 차례 — 첫 칸과 값 칸들을 한 줄로 세운 것. 끌어 옮기기는 이 차례를 바꾼다. */
type Slot = { id: string; col: BoardColumn | null };
/** 값 정렬 — 쳐 넣는 글자는 왼쪽, 숫자는 오른쪽(자릿수를 맞춰 읽는다),
 *  고르는 값(담당·거래처·라벨)은 가운데 (2026-08-06 사장님 지시) */
//   날짜도 가운데 — 자릿수가 늘 같아 가운데로 두면 줄이 눈에 잘 맞는다(2026-08-06 사장님 지시)
const tdAlign = (type: ColType) =>
  type === "number" ? "pb-td-num"
    : type === "status" || type === "person" || type === "partner" || type === "date" ? "pb-td-mid" : "";
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
  //   요약을 어느 범위로 보나 — null(입력화면) · "board"(이 표만) · "all"(프로젝트 전체 안내판)
  //   (2026-08-07 사장님: "정리는 요약으로 이름을 바꾸고, 왼쪽에 기능을 몰고, 오른쪽엔 전체 요약")
  const [summaryScope, setSummaryScope] = useState<null | "board" | "all">(null);
  const showSummary = summaryScope !== null;
  const [renaming, setRenaming] = useState(false);
  const [tplMenu, setTplMenu] = useState(false);          // 템플릿 ⋯ (이름 · 삭제)
  const [presetName, setPresetName] = useState<string | null>(null);   // 회사 양식으로 저장 — 이름 묻는 창
  const [groupMenu, setGroupMenu] = useState<string | null>(null);   // 그룹 ⋯
  const [trashOpen, setTrashOpen] = useState(false);
  //   필터 — 표·칸반이 같이 쓴다. 켜진 게 없으면 아무것도 거르지 않는다.
  const [filters, setFilters] = useState<{ mine: boolean; week: boolean; open: boolean }>({ mine: false, week: false, open: false });
  //   칸 값으로 거르기 — 엑셀 필터처럼 칸마다 든 값을 세어 두고 골라서 좁힌다(2026-08-06 사장님 지시).
  //   같은 칸 안에서는 OR(둘 다 보기), 칸끼리는 AND(둘 다 만족). 고른 게 없으면 안 거른다.
  const [valueFilters, setValueFilters] = useState<Record<string, string[]>>({});
  //   ── 조회 화면 표준 (2026-08-18 사장님: "탭별로 버튼이 많고 검색조건이 없는데 담당·상태·일정으로 검색, 간편검색도") ──
  //   빠른검색(즉시, 쉼표=또는) + 검색조건 패널(담당·상태·기간·내 담당/이번 주/미완료 — '조회'로 반영)
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  type BCond = { person: string[]; status: string[]; from: string; to: string; mine: boolean; week: boolean; open: boolean };
  const BEMPTY: BCond = { person: [], status: [], from: "", to: "", mine: false, week: false, open: false };
  const [bDraft, setBDraft] = useState<BCond>(BEMPTY);
  const [bLive, setBLive] = useState<BCond>(BEMPTY);
  const bCount = (c: BCond) => c.person.length + c.status.length + ((c.from || c.to) ? 1 : 0) + (c.mine ? 1 : 0) + (c.week ? 1 : 0) + (c.open ? 1 : 0);
  //   필터 창 — 열려 있으면 맨 앞에 둘 칸 id("" 면 첫 칸부터). 칸 머리 ⋯ 에서도 같은 창을 연다.
  const [filterPanel, setFilterPanel] = useState<string | null>(null);
  //   엑셀 올리기 팝업 — 재고와 같은 공용 부품(ExcelUploadDialog)을 쓴다 (2026-08-31 사장님 지시)
  const [xlsOpen, setXlsOpen] = useState(false);
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
  // 표에서 줄 끌어 옮기기 — **손잡이(⠿)만** 끌린다(줄 전체를 끌리게 하면 칸 안 글자를 못 고른다).
  //   끌리는 그림은 줄 전체로 바꿔 무엇을 옮기는지 보이게 한다. rowOver = 지금 올라가 있는 줄
  const [rowDrag, setRowDrag] = useState<string | null>(null);
  const [rowOver, setRowOver] = useState<string | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);   // 손이 올라가 있는 구획(그룹)
  //   눌린 자리 — 5px 넘게 움직여야 끌기로 친다(그냥 눌렀다 뗀 것과 구분). 렌더를 안 흔들려고 ref
  const pressRef = useRef<{ id: string; x: number; y: number } | null>(null);
  // 머리에서 칸 순서 바꾸기 — 첫 칸('항목')도 같이 옮긴다(2026-08-06 사장님 지시:
  //   "항목을 끌어서 구분과 숫자 사이에 놓을 수 있도록"). 슬롯 id 는 칸 id, 첫 칸은 NAME_SLOT.
  const [colDrag, setColDrag] = useState<string | null>(null);
  const [colOver, setColOver] = useState<string | null>(null);
  //   놓는 자리 — 목표 칸의 왼쪽 절반이면 그 앞, 오른쪽 절반이면 그 뒤(맨 끝으로도 보낼 수 있게)
  const [colAfter, setColAfter] = useState(false);
  const colPressRef = useRef<{ id: string; x: number; y: number } | null>(null);

  const { data: boards = [], isLoading } = useQuery({
    queryKey: ["pb-boards", dealId],
    queryFn: async () => {
      const data = logRead("ProjectBoards:boards", await db.from("project_boards")
        .select("id, name, template_key, name_label, name_pos, position").eq("deal_id", dealId).is("archived_at", null)
        .order("position", { ascending: true }));
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });

  // 회사 양식 — 우리 회사가 저장해 둔 칸 구성. 프로젝트를 옮겨도 같은 걸 본다.
  const { data: boardPresets = [] } = useQuery({
    queryKey: ["pb-presets", companyId, "board"],
    queryFn: () => listPresets(companyId, "board"),
    enabled: !!companyId,
  });
  //   정리 양식 — 무엇을 어떤 순서로 볼지. 표 형태(template_key)별로 골라 쓴다.
  const { data: summaryPresets = [] } = useQuery({
    queryKey: ["pb-presets", companyId, "summary"],
    queryFn: () => listPresets(companyId, "summary"),
    enabled: !!companyId,
  });

  const boardId = activeId && boards.some((b) => b.id === activeId) ? activeId : (boards[0]?.id || "");
  const board = boards.find((b) => b.id === boardId);
  //   '매출 · 청구' 만 문서 체인을 쓴다 — 조회 조건에서도 보므로 여기서 먼저 정한다
  //   견적서를 바로 만들 수 있는 표 — 합친 '매출 흐름' 과 합치기 전 '매출 · 청구' 둘 다 (2026-08-07)
  const isBilling = templateKind(board?.template_key) === "revenue";
  //   ⚠️ '계약 · 갱신' 도 만기 카드에서 계약서를 만든다 — 문서 목록을 안 읽으면 만들어 놓고도
  //      화면이 빈 문서를 열어 저장이 안 됐다(2026-08-07 사장님: "계약서 만들기가 작동 안 한다").
  const canDoc = isBilling || board?.template_key === "contract";
  //   '마케팅 계정 관리' 표 — 값을 사람이 아니라 매체 API 가 채운다(2026-08-06)
  const isAds = board?.template_key === "ads";

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
    enabled: summaryScope === "all" && boardIds.length > 0,
  });
  const { data: allGroups = [] } = useQuery({
    queryKey: ["pb-all-groups", dealId, boardIds.length],
    queryFn: async () => {
      const data = logRead("ProjectBoards:allGroups", await db.from("project_board_groups")
        .select("id, board_id, name, color, position").in("board_id", boardIds)
        .is("archived_at", null).order("position", { ascending: true }));
      return (data || []) as BoardGroup[];
    },
    enabled: summaryScope === "all" && boardIds.length > 0,
  });
  const { data: allItems = [] } = useQuery({
    queryKey: ["pb-all-items", dealId, boardIds.length],
    queryFn: async () => {
      const data = await fetchPaged<any>("ProjectBoards:allItems", () => db.from("project_board_items")
        .select("id, board_id, group_id, parent_item_id, name, values, position").in("board_id", boardIds)
        .is("archived_at", null).order("position", { ascending: true }).order("id"), 50000);
      return (data || []) as BoardItem[];
    },
    enabled: summaryScope === "all" && boardIds.length > 0,
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
    enabled: !!dealId && canDoc,
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
    //   표를 옮기면 앞 표의 칸 필터는 뜻을 잃는다(칸 id 가 다르다) — 같이 비운다
    setValueFilters({});
    setFilterPanel(null);
    if (!boardId || typeof window === "undefined") return;
    const saved = window.localStorage.getItem(`${VIEW_KEY}${boardId}`) as InputMode | null;
    setViewPick(saved && MODE_LABEL[saved] ? saved : null);
  }, [boardId]);
  const pickView = (v: InputMode) => {
    setViewPick(v);
    if (typeof window !== "undefined") window.localStorage.setItem(`${VIEW_KEY}${boardId}`, v);
  };

  // 필터 — 셋 다 '켜면 좁아지는' 방향으로만 동작한다(AND). 무엇이 걸러졌는지 줄로 알려준다.
  const toggled = useMemo(() => {
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

  // 칸 값 필터 — 창에 보이는 건수는 위 세 단추까지 반영한 것을 센다(화면과 숫자가 어긋나지 않게).
  const facets = useMemo(() => buildFacets(cols, toggled, users, partners as any[]), [cols, toggled, users, partners]);
  const activeValueFilters = useMemo(
    () => Object.entries(valueFilters).filter(([cid, vals]) => vals.length > 0 && cols.some((c) => c.id === cid)),
    [valueFilters, cols]);
  //   검색조건·빠른검색 — 담당(사람 칸 어느 하나) · 상태(상태 칸 어느 하나) · 기간(날짜 칸 어느 하나가 범위 안)
  const personCols = useMemo(() => cols.filter((c) => c.type === "person"), [cols]);
  const statusCols = useMemo(() => cols.filter((c) => c.type === "status"), [cols]);
  const dateCols = useMemo(() => cols.filter((c) => c.type === "date"), [cols]);
  const condHit = (it: BoardItem, c: BCond) => {
    if (c.person.length && !personCols.some((pc) => c.person.includes(String(it.values?.[pc.id] || "")))) return false;
    if (c.status.length && !statusCols.some((sc) => c.status.includes(String(it.values?.[sc.id] || "")))) return false;
    if (c.from || c.to) {
      const ok = dateCols.some((dc) => { const v = String(it.values?.[dc.id] || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) && (!c.from || v >= c.from) && (!c.to || v <= c.to); });
      if (!ok) return false;
    }
    return true;
  };
  const cellText = (it: BoardItem) => cols.map((c) => {
    const v = it.values?.[c.id]; if (v == null || v === "") return "";
    if (c.type === "person") return users.find((u) => u.id === String(v))?.name || "";
    if (c.type === "partner") return (partners as any[]).find((p) => p.id === String(v))?.name || "";
    if (c.type === "status") return ((c.settings?.options || []) as StatusOption[]).find((o) => o.id === String(v))?.label || String(v);
    return String(v);
  });
  const shown = useMemo(() => {
    let rows = toggled.filter((it) => condHit(it, bLive) && quickSearchHit(q, [it.name, ...cellText(it)]));
    if (activeValueFilters.length === 0) return rows;
    return rows.filter((it) => activeValueFilters.every(([cid, vals]) => {
      const c = cols.find((x) => x.id === cid);
      return !c || vals.includes(facetKey(c, it));
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggled, activeValueFilters, cols, bLive, q, users, partners]);
  //   패널 선택지 — 이 표에 실제로 있는 값만
  const personOpts = useMemo(() => [...new Set((items as BoardItem[]).flatMap((it) => personCols.map((pc) => String(it.values?.[pc.id] || ""))).filter(Boolean))]
    .map((id) => ({ value: id, label: users.find((u) => u.id === id)?.name || "(나간 사람)" })), [items, personCols, users]);
  const statusOpts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const sc of statusCols) for (const o of ((sc.settings?.options || []) as StatusOption[])) if (!seen.has(o.id)) seen.set(o.id, statusCols.length > 1 ? `${o.label} (${sc.name})` : o.label);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [statusCols]);
  const bChips: AppliedChip[] = [
    ...quickTerms(q).map((t, i) => ({ group: "빠른검색", label: t, onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")) })),
    ...bLive.person.map((v) => ({ group: "담당", label: users.find((u) => u.id === v)?.name || v, onRemove: () => { const c = { ...bLive, person: bLive.person.filter((x) => x !== v) }; setBLive(c); setBDraft(c); } })),
    ...bLive.status.map((v) => ({ group: "상태", label: statusOpts.find((o) => o.value === v)?.label || v, onRemove: () => { const c = { ...bLive, status: bLive.status.filter((x) => x !== v) }; setBLive(c); setBDraft(c); } })),
    ...((bLive.from || bLive.to) ? [{ group: "기간", label: `${bLive.from || "…"} ~ ${bLive.to || "…"}`, onRemove: () => { const c = { ...bLive, from: "", to: "" }; setBLive(c); setBDraft(c); } }] : []),
    ...(filters.mine ? [{ group: "빠른 조건", label: "내 담당", onRemove: () => setFilters((f) => ({ ...f, mine: false })) }] : []),
    ...(filters.week ? [{ group: "빠른 조건", label: "이번 주", onRemove: () => setFilters((f) => ({ ...f, week: false })) }] : []),
    ...(filters.open ? [{ group: "빠른 조건", label: "미완료만", onRemove: () => setFilters((f) => ({ ...f, open: false })) }] : []),
  ];
  const applyDraft = () => { setBLive(bDraft); setFilters({ mine: bDraft.mine, week: bDraft.week, open: bDraft.open }); setPanelOpen(false); };
  const openPanel = () => { setBDraft({ ...bLive, mine: filters.mine, week: filters.week, open: filters.open }); setPanelOpen(true); };
  const hiddenCount = items.length - shown.length;
  //   한 칸의 값 하나를 켜고 끈다 — 창에서도, 칸 머리 ⋯ 에서도 같은 길로 들어온다
  const toggleValueFilter = (colId: string, key: string) => setValueFilters((prev) => {
    const cur = prev[colId] || [];
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    const out = { ...prev };
    if (next.length === 0) delete out[colId]; else out[colId] = next;
    return out;
  });

  const itemsByGroup = useMemo(() => {
    const m: Record<string, BoardItem[]> = {};
    for (const it of shown) {
      const k = it.group_id || "__none__";
      (m[k] = m[k] || []).push(it);
    }
    return m;
  }, [shown]);

  // ── 표 만들기 — 템플릿의 컬럼·그룹을 그대로 심는다 ──
  //    기본 양식이든 직접 짠 것이든 같은 길로 들어온다(만드는 방법이 둘로 갈리면 안 된다)
  const createBoardFrom = async (tpl: { key: string; name: string; columns: ColumnDef[]; groups: GroupDef[] }) => {
    if (busy) return;
    setBusy(true);
    try {
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
      //   방금 만든 표는 채우러 온 것이다 — '정리'를 보던 중이었어도 입력 화면으로 되돌린다
      //   (2026-08-07: 새 표를 만들었는데 빈 정리 화면이 떠서 '표'를 다시 눌러야 했다)
      setSummaryScope(null);
      qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
      toast(`'${tpl.name}' 템플릿을 만들었습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "템플릿 생성 실패", "error");
    } finally {
      setBusy(false);
    }
  };
  //   기본 양식에서 출발했으면 그 key 를 그대로 심는다 — 칸을 더 붙여도 칸반·행 이름 같은 성격이 따라온다
  //   (2026-08-05 사장님: "기본 템플릿에 필요한 컬럼을 계속 추가하는 형태").
  //   그룹은 출발한 양식의 것을, 처음부터 짠 것이면 하나로 시작한다(단계는 상태 칸의 라벨이 맡는다)
  const groupsOfBase = (baseKey: string | null) =>
    baseKey ? findTemplate(baseKey).groups : [{ name: "목록", color: GROUP_COLORS[0] }];
  const createCustomBoard = async (name: string, columns: ColumnDef[], saveToCompany: boolean, baseKey: string | null) => {
    await createBoardFrom({ key: baseKey || "custom", name, columns, groups: groupsOfBase(baseKey) });
    if (!saveToCompany) return;
    try {
      await savePreset({ companyId, kind: "board", name, templateKey: baseKey, payload: { columns }, userId });
      qc.invalidateQueries({ queryKey: ["pb-presets", companyId, "board"] });
      toast(`'${name}' 을 회사 양식으로 저장했습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "회사 양식 저장 실패", "error");
    }
  };
  const useBoardPreset = (p: Preset) =>
    createBoardFrom({ key: p.template_key || "custom", name: p.name,
      columns: (p.payload?.columns || []) as ColumnDef[], groups: groupsOfBase(p.template_key) });
  const dropBoardPreset = async (p: Preset) => {
    try {
      await removePreset(p.id);
      qc.invalidateQueries({ queryKey: ["pb-presets", companyId, "board"] });
      toast(`'${p.name}' 을 회사 양식에서 뺐습니다(이미 만든 표는 그대로입니다).`, "success");
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); }
  };
  const saveSummaryPreset = async (name: string, layout: SummaryLayout, templateKey: string | null) => {
    try {
      await savePreset({ companyId, kind: "summary", name, templateKey, payload: layout, userId });
      qc.invalidateQueries({ queryKey: ["pb-presets", companyId, "summary"] });
      toast(`'${name}' 정리 양식을 저장했습니다.`, "success");
    } catch (e: any) { toast(e?.message || "정리 양식 저장 실패", "error"); }
  };
  //   고쳐 쓰기 — 양식을 고칠 때마다 새로 쌓이면 목록이 못 쓰게 된다(2026-08-05 사장님 지시)
  const editSummaryPreset = async (p: Preset, name: string, layout: SummaryLayout) => {
    try {
      await updatePreset(p.id, { name: name.trim() || p.name, payload: layout });
      qc.invalidateQueries({ queryKey: ["pb-presets", companyId, "summary"] });
      toast(`'${name.trim() || p.name}' 정리 양식을 수정했습니다.`, "success");
    } catch (e: any) { toast(e?.message || "정리 양식 수정 실패", "error"); }
  };
  const dropSummaryPreset = async (p: Preset) => {
    try {
      await removePreset(p.id);
      qc.invalidateQueries({ queryKey: ["pb-presets", companyId, "summary"] });
      toast(`'${p.name}' 정리 양식을 지웠습니다.`, "success");
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); }
  };
  // 지금 보고 있는 표의 칸 구성을 회사 양식으로 — 이미 다듬어 쓰던 표가 가장 좋은 양식이다
  const saveBoardAsPreset = async (name: string) => {
    setPresetName(null);
    try {
      await savePreset({
        companyId, kind: "board", name,
        //   어느 기본 양식에서 나온 표인지도 같이 담는다 — 다른 프로젝트에서 꺼내 쓸 때 성격이 그대로 온다
        templateKey: board?.template_key || null,
        payload: { columns: cols.map((c) => ({ name: c.name, type: c.type, settings: c.settings || {} })) },
        userId,
      });
      qc.invalidateQueries({ queryKey: ["pb-presets", companyId, "board"] });
      toast(`'${name}' 을 회사 양식으로 저장했습니다.`, "success");
    } catch (e: any) { toast(e?.message || "회사 양식 저장 실패", "error"); }
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
      toast("템플릿 구조를 복제했습니다(행은 가져오지 않았습니다).", "success");
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
      ? `${ids.length}건을 옮겼습니다. 이름이 같은 칸만 따라갔고 ${dropped}칸은 비웠습니다.`
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
  //   첫 칸 머리글 — '이름' 이 회사 말로는 상호명·현장명일 수 있다(2026-08-05 사장님 지시).
  //   비우면 템플릿 기본 라벨로 돌아간다. 행 이름 자체(items.name)는 그대로다.
  const renameNameColumn = async (next: string) => {
    const v = next.trim();
    if (!board) return;
    const { error } = await db.from("project_boards").update({ name_label: v || null }).eq("id", boardId);
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
  };

  // 행 → 견적서. '매출 · 청구' 템플릿에서만 쓴다(2026-08-03 사장님: "입력은 무조건 템플릿으로").
  //   문서 자체는 기존 편집기가 맡는다 — 여기서는 만들고 연결한 뒤 그리로 보낸다.
  const [makingDoc, setMakingDoc] = useState<string | null>(null);
  //   문서는 팝업으로 연다 — 화면을 옮기면 업무 흐름이 끊긴다(2026-08-04 사장님 지시)
  //   draft — 아직 만들지 않은 문서(저장을 눌러야 생긴다, 2026-08-07 사장님 지시)
  const [docModal, setDocModal] = useState<{ itemId: string; kind: DocKind; draft?: { name: string; content: any; contentType: "invoice" | "contract"; sourceDocumentId?: string | null } } | null>(null);
  const [minutesGroup, setMinutesGroup] = useState<string | null>(null);   // 회의록에서 펼쳐 둔 회의
  const [sendingTodo, setSendingTodo] = useState<string | null>(null);
  //   '＋ 견적서' 는 편집기를 열 뿐이다 — 문서는 **저장을 눌러야** 생긴다(2026-08-07 사장님 지시).
  //   그래야 열어 보고 닫았을 때 빈 견적서가 문서함에 쌓이지 않는다.
  const openQuote = async (it: BoardItem) => {
    const linked = (it.values || {})[DOC_VALUE_KEY] as { id?: string } | undefined;
    if (linked?.id) { setDocModal({ itemId: it.id, kind: "quote" }); return; }
    if (!userId) return;
    setDocModal({
      itemId: it.id, kind: "quote",
      draft: {
        name: `${it.name?.trim() || dealName || "프로젝트"} 견적서`,
        content: buildQuoteContent(), contentType: "invoice",
      },
    });
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

  //   이 줄이 '계약' 단계인가 — 라벨로 읽는다(회사마다 라벨을 바꿔 쓰므로 낱말로 본다)
  const atContractStage = (it: BoardItem) => {
    const flow = flowColumnOf(cols);
    if (!flow) return false;
    const opt = ((flow.settings?.options || []) as StatusOption[]).find((o) => o.id === it.values?.[flow.id]);
    return !!opt && /계약|수주/.test(opt.label);
  };

  //   행 → 계약서. 전자서명도 이 문서로 이어진다(계약서 화면의 '거래처에 보내기').
  //   예전엔 **견적서를 먼저 만들어야만** 계약서 단추가 나왔다 — 견적 없이 바로 계약하는 일이
  //   흔한데 '계약' 단계로 옮겨도 아무 일도 일어나지 않았다(2026-08-07 사장님 지적).
  //   견적이 있으면 품목·수신처를 물려받고, 없으면 그 줄의 거래처·금액으로 만든다.
  const makeContract = async (it: BoardItem) => {
    const linked = (it.values || {})[CONTRACT_VALUE_KEY] as { id?: string } | undefined;
    if (linked?.id) { setDocModal({ itemId: it.id, kind: "contract" }); return; }
    if (!userId) return;
    const q = (it.values || {})[DOC_VALUE_KEY] as { id?: string } | undefined;
    const quoteDoc = (dealDocs as any[]).find((d) => d.id === q?.id) || null;
    const amountCol = cols.find((c) => c.type === "number" && (c.settings?.unit || "") === "원");
    setDocModal({
      itemId: it.id, kind: "contract",
      draft: {
        name: `${it.name?.trim() || dealName || "프로젝트"} 계약서`,
        contentType: "contract",
        sourceDocumentId: quoteDoc?.id || null,
        content: buildContractContent({
          quoteDoc, dealName: dealName || "", rowName: it.name || "",
          partnerName: (partners as any[]).find((p) => p.id === (it.values || {})[partnerColId || ""])?.name,
          amount: amountCol ? Number(it.values?.[amountCol.id]) || 0 : 0,
        }),
      },
    });
  };

  //   편집기의 '저장' 이 부른다 — 이때 문서를 만들고 그 줄에 매단다
  //   name — 팝업에서 문서명을 고쳤으면 그 이름으로 만든다(2026-08-10)
  const createDocFromDraft = async (contentJson: any, name?: string): Promise<boolean> => {
    const d = docModal?.draft;
    const it = docModal ? items.find((i) => i.id === docModal.itemId) : null;
    if (!d || !it || !userId) return false;
    try {
      const doc = await insertDocument({
        companyId, dealId, userId, name: name?.trim() || d.name,
        contentType: d.contentType, contentJson, sourceDocumentId: d.sourceDocumentId || null,
      });
      const key = d.contentType === "contract" ? CONTRACT_VALUE_KEY : DOC_VALUE_KEY;
      await db.from("project_board_items")
        .update({ values: { ...(it.values || {}), [key]: { id: doc.id, no: doc.document_number || (d.contentType === "contract" ? "계약서" : "견적서") } }, updated_at: new Date().toISOString() })
        .eq("id", it.id);
      qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
      await qc.invalidateQueries({ queryKey: ["pb-docs", dealId] });
      setDocModal({ itemId: it.id, kind: docModal!.kind });   // 이제 진짜 문서다
      return true;
    } catch (e: any) {
      toast(e?.message || "저장 실패", "error");
      return false;
    }
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
    setValueFilters((prev) => { const n = { ...prev }; delete n[c.id]; return n; });
    // 값은 행의 jsonb 에 그대로 남는다 — 컬럼을 되살리면 값도 같이 돌아온다
    await softDelete("project_board_columns", c.id, `컬럼 '${c.name}'`, ["pb-cols"]);
  };
  // 칸 설정 한 자리 — 라벨(상태)·단위(숫자)·너비를 ⋯ 창에서 한 번에 저장한다.
  //   (따로따로 쓰면 앞 저장이 아직 안 돌아온 settings 를 덮어쓴다)
  //   단위를 알아야 '정리'가 합계를 제대로 읽는다(원끼리만 더하고, %는 평균을 낸다)
  const saveColSettings = async (c: BoardColumn, patch: Record<string, any>) => {
    const next = { ...(c.settings || {}), ...patch };
    const { error } = await db.from("project_board_columns").update({ settings: next }).eq("id", c.id);
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
  };
  // 머리에서 칸 끌어 옮기기 — 첫 칸('항목')까지 한 줄에 놓고 차례를 다시 매긴다.
  //   값 칸은 position 을, 첫 칸은 표의 name_pos 를 고친다(2026-08-06 사장님 지시).
  const moveColumnTo = async (dragId: string, targetId: string, after: boolean) => {
    setColDrag(null); setColOver(null);
    if (dragId === targetId) return;
    const next = slots.map((s) => s.id).filter((id) => id !== dragId);
    const at = next.indexOf(targetId);
    if (at < 0) return;
    next.splice(after ? at + 1 : at, 0, dragId);
    const reqs: Promise<any>[] = [];
    //   값 칸: 첫 칸을 뺀 순서가 곧 position
    const colOrder = next.filter((id) => id !== NAME_SLOT);
    colOrder.forEach((id, i) => {
      const c = cols.find((x) => x.id === id);
      if (c && c.position !== i) reqs.push(db.from("project_board_columns").update({ position: i }).eq("id", id));
    });
    const nextNamePos = next.indexOf(NAME_SLOT);
    if (nextNamePos !== namePos) reqs.push(db.from("project_boards").update({ name_pos: nextNamePos }).eq("id", boardId));
    const res = await Promise.all(reqs);
    const bad = res.find((r: any) => r?.error);
    if (bad) { toast(bad.error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
    qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
  };

  // 칸 복제 — 같은 형식·라벨의 칸을 바로 오른쪽에 하나 더. 값은 칸 id 에 매여 있어 따라오지 않는다.
  const duplicateColumn = async (c: BoardColumn) => {
    const pos = c.position + 1;
    const later = cols.filter((x) => x.position >= pos);
    const res = await Promise.all(later.map((x) =>
      db.from("project_board_columns").update({ position: x.position + 1 }).eq("id", x.id)));
    const bad = res.find((r: any) => r.error);
    if (bad) { toast(bad.error.message, "error"); return; }
    const { error } = await db.from("project_board_columns").insert({
      board_id: boardId, name: `${c.name} 사본`, type: c.type, settings: c.settings || {}, position: pos,
    });
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
    toast(`'${c.name}' 과 같은 형식의 칸을 옆에 만들었습니다(값은 안 따라와요).`, "success");
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
  // 줄 옮기기 — 끌어다 놓은 자리에 넣고 그 그룹의 순서를 다시 매긴다 (2026-08-06 사장님 지시:
  //   "항목들 위치를 자유자재로 옮길 수 있게 드래그 앤 드롭으로").
  //   targetId 가 없으면 그 그룹 맨 뒤로 — 빈 그룹으로도 옮길 수 있어야 한다.
  //   ⚠️ 걸러 보는 중이어도 **표에 안 보이는 줄까지** 포함해 자리를 매긴다(숨은 줄이 뒤섞이지 않게).
  const moveRow = async (targetGroupId: string, targetId?: string) => {
    const src = items.find((i) => i.id === rowDrag);
    setRowDrag(null); setRowOver(null);
    if (!src || src.id === targetId) return;
    const dest = items.filter((i) => i.group_id === targetGroupId && i.id !== src.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const at = targetId ? dest.findIndex((i) => i.id === targetId) : -1;
    const next = at < 0 ? [...dest, src] : [...dest.slice(0, at), src, ...dest.slice(at)];
    const res = await Promise.all(next.map((r, i) => db.from("project_board_items")
      .update(r.id === src.id ? { position: i, group_id: targetGroupId, updated_at: new Date().toISOString() } : { position: i })
      .eq("id", r.id)));
    const bad = res.find((r: any) => r.error);
    if (bad) { toast(bad.error.message, "error"); return; }
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
    toast(`${ids.length}건을 지웠습니다. '지운 항목'에서 되살릴 수 있습니다.`, "success");
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
    if (groups.length <= 1) { toast("그룹이 하나뿐이라 삭제할 수 없습니다.", "error"); return; }
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
    //   회의 표의 그룹은 '회의 회차' 다 — '그룹 2' 가 아니라 날짜를 붙여 준다 (2026-08-07)
    const name = board?.template_key === "meeting"
      ? `${todayKst().slice(5).replace("-", "/")} 회의`
      : `그룹 ${groups.length + 1}`;
    const { data, error } = await db.from("project_board_groups")
      .insert({ board_id: boardId, name, position: groups.length }).select("id").single();
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-groups", boardId] });
    if (data?.id) setMinutesGroup(data.id as string);
  };

  //   회의에서 정한 것을 '할 일 · 진행' 표로 넘긴다 — 결정만 적고 끝나지 않게 (2026-08-07).
  //   담당·기한은 형식이 같은 칸을 찾아 옮긴다(칸 이름은 회사마다 다르다).
  const sendToTodo = async (it: BoardItem) => {
    if (sendingTodo) return;
    const todoBoard = (boards as any[]).find((b) => b.template_key === "todo");
    if (!todoBoard) { toast("'할 일 · 진행' 표가 없습니다 — ＋ 템플릿에서 먼저 만들어 주세요.", "error"); return; }
    setSendingTodo(it.id);
    try {
      //   이미 보낸 안건이면 새 줄을 또 만들지 않는다 (2026-08-20 입력 점검: 누를 때마다
      //   insert 라 같은 할 일이 3줄 서 있었다). 보낸 할 일이 지워졌으면 다시 보낼 수 있다.
      const sentId = String((it.values || {})[TODO_LINK_KEY] || "");
      if (sentId) {
        const { data: alive } = await db.from("project_board_items")
          .select("id").eq("id", sentId).is("archived_at", null).maybeSingle();
        if (alive?.id) { toast("이미 할 일로 보냈습니다 — '할 일 · 진행' 표에 있습니다.", "success"); return; }
      }
      const [tc, tg] = await Promise.all([
        db.from("project_board_columns").select("id, name, type, settings").eq("board_id", todoBoard.id).order("position"),
        db.from("project_board_groups").select("id").eq("board_id", todoBoard.id).order("position"),
      ]);
      const tcols = (tc.data || []) as BoardColumn[];
      const gid = (tg.data || [])[0]?.id as string | undefined;
      if (!gid) throw new Error("할 일 표에 그룹이 없습니다");
      const pick = (t: string) => cols.find((c) => c.type === t) || null;
      const dst = (t: string) => tcols.find((c) => c.type === t) || null;
      const values: Record<string, any> = {};
      //   담당 — 사람 칸끼리
      const p = pick("person"), dp = dst("person");
      if (p && dp && it.values?.[p.id]) values[dp.id] = it.values[p.id];
      //   기한 — 회의일이 아닌 날짜 칸에서 마감 칸으로
      const dueSrc = cols.filter((c) => c.type === "date").find((c) => !/회의|일자/.test(c.name));
      const dueDst = tcols.filter((c) => c.type === "date")[0];
      if (dueSrc && dueDst && it.values?.[dueSrc.id]) values[dueDst.id] = it.values[dueSrc.id];
      //   단계를 안 정하면 칸반의 '단계 미지정' 으로 떨어져 눈에 안 띈다 — 첫 단계에 세운다
      const tflow = tcols.find((c) => c.type === "status" && c.settings?.flow) || tcols.find((c) => c.type === "status");
      const firstOpt = ((tflow?.settings?.options || []) as any[])[0];
      if (tflow && firstOpt) values[tflow.id] = firstOpt.id;
      const { data: made, error } = await db.from("project_board_items")
        .insert({ board_id: todoBoard.id, group_id: gid, name: it.name || "(안건)", position: 0, values })
        .select("id").single();
      if (error) throw new Error(error.message);
      //   안건에 만든 할 일의 id 를 남긴다 — 버튼이 '보냄 ✓' 로 바뀌고, 다시 눌러도 중복이 안 생긴다
      if (made?.id) {
        await db.from("project_board_items")
          .update({ values: { ...(it.values || {}), [TODO_LINK_KEY]: made.id } }).eq("id", it.id);
        qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
      }
      qc.invalidateQueries({ queryKey: ["pb-items", todoBoard.id] });
      toast(`'${it.name || "안건"}' 을 할 일로 보냈습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "할 일로 보내기 실패", "error");
    } finally { setSendingTodo(null); }
  };
  //   after 를 주면 그 칸 바로 오른쪽에 넣는다 — 표 끝까지 가로로 밀지 않아도 원하는 자리에 붙는다
  //   (2026-08-05 사장님: "표에서 칸 이름 옆 ＋로 컬럼을 추가할 수 있게").
  const addColumn = async (type: ColType, after?: BoardColumn) => {
    const label = COL_FORMATS.find((f) => f.type === type)?.label || "칸";
    const settings = type === "status" ? { options: DEFAULT_STATUS_OPTIONS } : {};
    const pos = after ? after.position + 1 : cols.length;
    if (after) {
      // 뒤 칸들을 한 자리씩 민다 — 안 밀면 새 칸이 뒤 칸과 같은 자리를 두고 다툰다
      const later = cols.filter((c) => c.position >= pos);
      const res = await Promise.all(later.map((c) =>
        db.from("project_board_columns").update({ position: c.position + 1 }).eq("id", c.id)));
      const bad = res.find((r: any) => r.error);
      if (bad) { toast(bad.error.message, "error"); return; }
    }
    const { error } = await db.from("project_board_columns").insert({ board_id: boardId, name: label, type, settings, position: pos });
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
  };
  if (isLoading) return <p className="pj-sec-empty">불러오는 중…</p>;

  // ── 템플릿이 하나도 없을 때 — 고르는 화면부터 띄운다(빈 표 앞에서 막히지 않게) ──
  //    이미 표가 있는데 더 붙일 때는 팝업으로 뜬다(아래 picking) — 보던 표가 사라지면 안 된다
  if (boards.length === 0) {
    return <BoardNewModal inline busy={busy} presets={boardPresets} onCustom={createCustomBoard}
      onUsePreset={useBoardPreset} onRemovePreset={dropBoardPreset} />;
  }

  //   첫 칸 머리글 — 회사가 바꿔 뒀으면 그걸, 아니면 템플릿 기본 라벨(2026-08-05 사장님 지시)
  const nameLabel = String(board?.name_label || "").trim() || ITEM_LABEL[board?.template_key || "blank"] || "이름";
  // 칸반이 열로 쓸 컬럼 — 흐름 상태 컬럼. 없으면 그룹으로 열을 만든다.
  const flowCol = flowColumnOf(cols);
  //   입력 화면 — 표·칸반에 **그 일 전용 첫 화면**이 붙는다(회의록 등, 2026-08-07).
  //   고를 수 없는 보기가 저장돼 있으면(옛 타임라인·다른 템플릿의 화면) 표로 떨어뜨린다.
  const modes = inputModesOf(board?.template_key);
  const wanted = viewPick || (findTemplate(board?.template_key).input || "grid");
  const view: InputMode = modes.includes(wanted) ? wanted : "grid";

  // ── 엑셀 — 내려받기·양식·올리기 (2026-08-31 사장님: "우측에 엑셀 내려받기·자료올리기, 재고의 공용 부품으로") ──
  //   머리줄은 내려받기·양식이 **같은 이름**을 쓴다 — 내려받은 파일을 고쳐 그대로 올려도 읽힌다.
  //   같은 이름의 칸이 둘이면 (2) 를 붙여 가른다(머리 이름으로 칸을 찾으므로 겹치면 한 칸이 먹힌다).
  //   ⚠️ 로딩 조기 return(위) 뒤라 훅을 못 쓴다 — 칸 수가 많아야 수십 개라 매 렌더 계산해도 된다.
  const xlsLabels = (() => {
    const seen = new Map<string, number>();
    const uniq = (name: string) => { const n = (seen.get(name) || 0) + 1; seen.set(name, n); return n > 1 ? `${name} (${n})` : name; };
    return { group: uniq("그룹"), name: uniq(nameLabel), cols: cols.map((c) => uniq(c.name)) };
  })();
  //   셀 하나를 사람이 읽는 값으로 — 담당·거래처·상태는 id 가 아니라 이름을 적는다(올릴 때도 이름으로 받는다)
  const xlsDisplay = (c: BoardColumn, v: any): string | number => {
    if (v == null || v === "") return "";
    if (c.type === "person") return users.find((u) => u.id === String(v))?.name || "";
    if (c.type === "partner") return (partners as any[]).find((p) => p.id === String(v))?.name || "";
    if (c.type === "status") return ((c.settings?.options || []) as StatusOption[]).find((o) => o.id === String(v))?.label || String(v);
    if (c.type === "number") { const n = Number(v); return Number.isNaN(n) ? String(v) : n; }
    return String(v);
  };
  const excelDown = () => {
    const rows = shown.map((it) => {
      const rec: Record<string, unknown> = {
        [xlsLabels.group]: groups.find((g) => g.id === it.group_id)?.name || "",
        [xlsLabels.name]: it.name || "",
      };
      cols.forEach((c, i) => { rec[xlsLabels.cols[i]] = xlsDisplay(c, it.values?.[c.id]); });
      return rec;
    });
    const sheet = (board?.name || "표").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "표";
    exportToExcel(rows, sheet, `${dealName ? `${dealName}_` : ""}${board?.name || "표"}_${todayKst()}`);
  };
  //   올리기 양식 칸 — 이 표의 칸 그대로. 필수는 행 이름 하나뿐(칸은 비워도 줄이 된다)
  const xlsCols: ExcelColumn[] = [
    { key: "__group", label: xlsLabels.group, hint: `비우면 지금 보는 그룹으로 · ${groups.map((g) => g.name).join(" / ") || "그룹 없음"}`, example: groups[0]?.name || "" },
    { key: "__name", label: xlsLabels.name, required: true, example: "(예시 줄 — 지우고 채우세요)" },
    ...cols.map((c, i): ExcelColumn => ({
      key: `c${i}`, label: xlsLabels.cols[i],
      kind: c.type === "number" ? "number" : c.type === "date" ? "date" : "text",
      hint: c.type === "status" ? `${((c.settings?.options || []) as StatusOption[]).map((o) => o.label).join(" / ")} 중 하나`
        : c.type === "person" ? "구성원 이름 그대로"
        : c.type === "partner" ? "거래처 이름 그대로" : undefined,
      example: c.type === "status" ? (((c.settings?.options || []) as StatusOption[])[0]?.label || "")
        : c.type === "person" ? (users[0]?.name || "")
        : c.type === "date" ? todayKst() : "",
    })),
  ];
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
    if (!docModalItem || docModal?.draft) return null;
    const key = docModal!.kind === "quote" ? DOC_VALUE_KEY : CONTRACT_VALUE_KEY;
    const linked = (docModalItem.values || {})[key] as { id?: string } | undefined;
    return (dealDocs as any[]).find((d) => d.id === linked?.id) || null;
  })();
  //   계약서 팝업이 '견적서 불러오기' 로 당겨 올 견적 — 그 줄에 붙은 견적서 (2026-08-10)
  const docModalQuote = (() => {
    if (!docModalItem || docModal?.kind !== "contract") return null;
    const linked = (docModalItem.values || {})[DOC_VALUE_KEY] as { id?: string } | undefined;
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
  //   ① 표 행 금액은 문서를 따라간다 (2026-08-10 사장님 결정) — 매출 집계·잔금이 보는 값이
  //      문서와 갈리면 어느 쪽이 맞는지 알 길이 없다. 계약 > 견적 우선은 팝업이 판단해 부른다.
  //      ⚠️ values 는 **DB 에서 다시 읽어** 합친다 — 직전에 문서 링크를 쓴 것이 캐시엔 아직 없다.
  const syncRowAmount = async (supply: number) => {
    const it = docModalItem;
    const c = cols.find((x) => x.type === "number" && (x.settings?.unit || "") === "원");
    if (!it || !c) return;
    const cur = Number(it.values?.[c.id]) || 0;
    const next = Math.round(supply);
    if (cur === next) return;
    const fresh = logRead("ProjectBoards:rowValues", await db.from("project_board_items")
      .select("values").eq("id", it.id).maybeSingle());
    const { error } = await db.from("project_board_items")
      .update({ values: { ...((fresh?.values as any) || it.values || {}), [c.id]: next }, updated_at: new Date().toISOString() })
      .eq("id", it.id);
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
    toast(`행 금액도 ${won(cur)} → ${won(next)} 으로 맞췄습니다.`, "success");
  };
  //   개정 견적서를 만들면 그 줄의 견적 연결을 새 문서로 옮긴다(원본은 문서함에 그대로 남는다)
  const relinkQuote = async (q: { id: string; no: string }) => {
    const it = docModalItem;
    if (!it) return;
    const fresh = logRead("ProjectBoards:rowValues", await db.from("project_board_items")
      .select("values").eq("id", it.id).maybeSingle());
    await db.from("project_board_items")
      .update({ values: { ...((fresh?.values as any) || it.values || {}), [DOC_VALUE_KEY]: q }, updated_at: new Date().toISOString() })
      .eq("id", it.id);
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
  };
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
  //   머리에 서는 차례 — 값 칸들 사이 어디에 첫 칸이 끼는지는 표가 기억한다(name_pos, 없으면 맨 앞)
  const namePos = Math.min(Math.max(Number(board?.name_pos) || 0, 0), cols.length);
  const slots: Slot[] = (() => {
    const list: Slot[] = cols.map((c) => ({ id: c.id, col: c }));
    list.splice(namePos, 0, { id: NAME_SLOT, col: null });
    return list;
  })();
  const widthOfSlot = (s: Slot) => (s.col ? widthOf(s.col) : COL_W.name);

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
            onClick={() => { setActiveId(b.id); setSummaryScope(null); setSort(null); setOpenItemId(null); }}
            onDoubleClick={() => { if (b.id === boardId) setRenaming(true); }}
            title="더블클릭하면 이름을 바꿉니다"
            className={`pb-tab ${b.id === boardId && !showSummary ? "pb-tab-on" : ""}`}>{b.name}</button>
        ))}
        {/* ＋ 템플릿 은 탭 바로 옆 — 마지막 탭에 붙여 둔다
            (2026-08-05 사장님: "＋템플릿도 우측이 아니라 기존처럼 수주·매출 옆에 있어서 자유롭게 추가").
            오른쪽 끝은 지금 보고 있는 템플릿을 관리하는 ⋯ 만 남긴다 — 성격이 다른 동작이라 자리도 가른다. */}
        <button type="button" className="pb-newtpl" onClick={() => setPicking(true)}
          title="템플릿 추가" aria-label="템플릿 추가">＋ 템플릿</button>
        <span className="pb-bar1-right">
          <span className="pb-tplmenu">
            <button type="button" className={`pb-dots ${tplMenu ? "pb-dots-on" : ""}`} onClick={() => setTplMenu((v) => !v)}
              title="이 템플릿 관리" aria-label="템플릿 메뉴">⋯</button>
            {tplMenu && (<>
              <span className="pb-menu-veil" onClick={() => setTplMenu(false)} />
              <span className="pb-menu">
                <button type="button" onClick={() => { setTplMenu(false); setRenaming(true); }}>이름 바꾸기</button>
                <button type="button" onClick={duplicateBoard}>템플릿 복제</button>
                <button type="button" onClick={() => { setTplMenu(false); setPresetName(board?.name || "새 양식"); }}>
                  회사 양식으로 저장
                </button>
                <button type="button" onClick={() => { setTplMenu(false); setTrashOpen(true); }}>지운 항목</button>
                <button type="button" className="pb-menu-danger" onClick={() => { setTplMenu(false); removeBoard(); }}>템플릿 삭제</button>
              </span>
            </>)}
          </span>
        </span>
      </div>

      {picking && (
        <BoardNewModal busy={busy} presets={boardPresets} onCustom={createCustomBoard}
          onUsePreset={(p) => { setPicking(false); useBoardPreset(p); }} onRemovePreset={dropBoardPreset}
          onClose={() => setPicking(false)} />
      )}
      {presetName !== null && (
        <NameDialog title="회사 양식으로 저장" hint={`지금 표의 칸 ${cols.length}개를 그대로 담습니다 · 행은 담지 않습니다`}
          value={presetName} onCancel={() => setPresetName(null)} onSave={saveBoardAsPreset} />
      )}

      {/* 광고 표는 입력이 없어 이 줄(입력·보기·필터)이 가리킬 곳이 없다 — 통째로 감춘다 (2026-08-06) */}
      {!isAds && <div className="pb-bar2">
        {/*  조회 줄 — 다른 조회 화면과 같은 부품: [검색조건 ▾] 빠른검색 · 보기 칩 ‖ 전체 요약 (2026-08-18 사장님) */}
        <ConditionPanel open={panelOpen} onOpenChange={(v) => (v ? openPanel() : setPanelOpen(false))} activeCount={bCount(bLive) + (filters.mine ? 1 : 0) + (filters.week ? 1 : 0) + (filters.open ? 1 : 0)}
          foot={<>
            <button type="button" className="btn-secondary btn-sm" disabled={bCount(bDraft) === 0} onClick={() => setBDraft(BEMPTY)}>조건 지우기</button>
            {cols.length > 0 && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => { setPanelOpen(false); setFilterPanel(""); }} title="칸마다 든 값을 보고 고르는 엑셀식 필터">
                칸 값으로 거르기{activeValueFilters.length > 0 ? ` (${activeValueFilters.length})` : ""}
              </button>
            )}
            <span className="ml-auto text-[11px] text-[var(--text-dim)]">{(items as BoardItem[]).filter((it) => condHit(it, bDraft)).length.toLocaleString("ko")}건</span>
            <button type="button" className="btn-primary btn-sm" onClick={applyDraft}>조회</button>
          </>}>
          {/*  보기 형식 — 회의록·표·칸반·요약을 여기서 고른다 (2026-08-31 사장님: "보기도 검색조건에 넣어서").
               값 하나짜리라 조회를 기다리지 않고 누르는 즉시 바뀐다(기간과 같은 규칙). */}
          <ConditionRow label="보기" hint="누르면 바로 바뀝니다">
            <ChipGroup value={summaryScope === "board" ? "__summary" : (summaryScope === null ? view : "")}
              onChange={(v) => { if (v === "__summary") setSummaryScope("board"); else { setSummaryScope(null); pickView(v as InputMode); } }}
              options={[...modes.map((v) => ({ value: v as string, label: MODE_LABEL[v] })), { value: "__summary", label: "요약" }]} />
          </ConditionRow>
          <ConditionRow label="빠른 조건">
            <span className="qk-quicks">
              {([["mine", "내 담당"], ["week", "이번 주"], ["open", "미완료만"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setBDraft((c) => ({ ...c, [k]: !c[k] }))}
                  className={bDraft[k] ? "qk-quick qk-quick-on" : "qk-quick"}>{label}</button>
              ))}
            </span>
          </ConditionRow>
          {personCols.length > 0 && (
            <ConditionRow label="담당" hint="여러 명 · 담당 칸 어느 하나">
              <TokenField items={personOpts} value={bDraft.person} onChange={(v) => setBDraft((c) => ({ ...c, person: v }))} placeholder="이름 일부" />
            </ConditionRow>
          )}
          {statusCols.length > 0 && (
            <ConditionRow label="상태" hint="여러 개 · 상태 칸 어느 하나">
              <TokenField items={statusOpts} value={bDraft.status} onChange={(v) => setBDraft((c) => ({ ...c, status: v }))} placeholder="상태 이름 일부" />
            </ConditionRow>
          )}
          {dateCols.length > 0 && (
            <ConditionRow label="일정" hint={`날짜 칸(${dateCols.map((c) => c.name).join("·")}) 어느 하나가 범위 안`}>
              <DateRangeField label={null} from={bDraft.from} to={bDraft.to} onChange={(f, t) => setBDraft((c) => ({ ...c, from: f, to: t }))} onClear={() => setBDraft((c) => ({ ...c, from: "", to: "" }))} />
            </ConditionRow>
          )}
        </ConditionPanel>
        <QuickSearch value={q} onApply={setQ} placeholder="이름 · 칸에 든 글자 · 담당 · 상태 — 쉼표로 여러 개, Enter" />
        {/*  보기 칩(회의록·표·칸반·요약)은 검색조건 패널 안 '보기' 줄로 옮겼다 (2026-08-31 사장님) */}
        <div className="pb-bar2-right">
          {hiddenCount > 0 && <em className="text-[11px] text-[var(--text-dim)] not-italic">{hiddenCount}건 숨김</em>}
          {/*  엑셀 — 내려받기·양식·올리기를 한 버튼 안에(재고와 같은 공용 부품, 2026-08-31 사장님) */}
          <ExcelMenu items={[
            { label: "내려받기", hint: "지금 조건으로 보이는 줄을 그대로 — 담당·상태는 이름으로", count: shown.length, disabled: shown.length === 0, onClick: excelDown },
            { label: "양식 내려받기 · 올리기", hint: "양식을 받아 채운 뒤 올리면 읽어서 보여 주고, 등록을 눌러야 저장", onClick: () => setXlsOpen(true) },
          ]} />
          {/*  프로젝트 전체는 따로 — 표마다 한 줄인 안내판이다(다 펼치지 않는다) */}
          <button type="button" onClick={() => setSummaryScope("all")} aria-pressed={summaryScope === "all"}
            className={`pb-allsum ${summaryScope === "all" ? "pb-allsum-on" : ""}`}>전체 요약</button>
        </div>
      </div>}
      {!isAds && bChips.length > 0 && <div className="pb-chips"><AppliedChips chips={bChips} onClearAll={() => { setQ(""); setBLive(BEMPTY); setBDraft(BEMPTY); setFilters({ mine: false, week: false, open: false }); }} /></div>}

      {/* 본문 — 상자 안에서 스크롤한다(템플릿 탭·보기 줄은 위에 고정). 2026-08-18 사장님: 끝선 맞추고 스크롤 */}
      <div className="pb-body">
      {renaming && board && (
        <input autoFocus defaultValue={board.name} className="pb-rename"
          onBlur={(e) => renameBoard(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(false); }} />
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
          <span>{undo.label} 을 삭제했습니다.</span>
          <button type="button" onClick={runUndo}>되돌리기</button>
          <button type="button" className="pb-undo-x" onClick={() => setUndo(null)} aria-label="닫기">✕</button>
        </div>
      )}

      {trashOpen && (
        <BoardTrash dealId={dealId} boardIds={boardIds}
          boardNames={Object.fromEntries(boards.map((b) => [b.id, b.name]))}
          onClose={() => setTrashOpen(false)} />
      )}

      {/* 엑셀처럼 칸 값으로 거르기 — 무슨 값이 몇 건인지 보고 고른다 (2026-08-06 사장님 지시) */}
      {filterPanel !== null && (
        <QuickFilterPanel facets={facets} picked={valueFilters} focusColId={filterPanel}
          total={toggled.length} shownCount={shown.length}
          onToggle={toggleValueFilter} onClear={() => setValueFilters({})} onClose={() => setFilterPanel(null)} />
      )}

      {/* 엑셀 올리기 — 재고와 같은 공용 부품. 이 표의 칸 그대로 양식을 주고, 읽어 보여 준 뒤 등록은 사람이 누른다 (2026-08-31 사장님) */}
      {xlsOpen && (
        <ExcelUploadDialog<{ group_id: string; name: string; values: Record<string, any> }>
          title={board?.name || "표"} cols={xlsCols}
          templateName={`${board?.name || "표"}_양식`}
          sheetName={(board?.name || "표").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "표"}
          guide={[
            `${xlsLabels.group} 칸을 비우면 지금 보는 그룹으로 들어갑니다.`,
            "담당·거래처·상태는 화면에 보이는 이름 그대로 적으세요 — 다르면 그 줄이 빠지고 이유가 보입니다.",
          ]}
          parse={(r) => {
            const name = String(r.__name || "").trim();
            if (!name) return { error: `${nameLabel}이 비어 있습니다` };
            let gidTo = (minutesGroup && groups.some((g) => g.id === minutesGroup) ? minutesGroup : groups[0]?.id) || "";
            const gName = String(r.__group || "").trim();
            if (gName) {
              const g = groups.find((x) => x.name.trim() === gName);
              if (!g) return { error: `그룹 '${gName}' 이 없습니다 — ${groups.map((x) => x.name).join(" / ")}` };
              gidTo = g.id;
            }
            if (!gidTo) return { error: "그룹이 없습니다 — 표에 그룹을 먼저 만드세요" };
            const values: Record<string, any> = {};
            for (let i = 0; i < cols.length; i++) {
              const c = cols[i]; const raw = String(r[`c${i}`] || "").trim();
              if (!raw) continue;
              if (c.type === "number") { const n = xNum(raw); if (n == null) return { error: `${c.name}: 숫자가 아닙니다 (${raw})` }; values[c.id] = n; }
              else if (c.type === "date") { if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: `${c.name}: 날짜는 ${todayKst()} 형식 (${raw})` }; values[c.id] = raw; }
              else if (c.type === "status") {
                const o = ((c.settings?.options || []) as StatusOption[]).find((x) => x.label.trim() === raw || x.id === raw);
                if (!o) return { error: `${c.name}: '${raw}' 는 없는 값 — ${((c.settings?.options || []) as StatusOption[]).map((x) => x.label).join(" / ")}` };
                values[c.id] = o.id;
              }
              else if (c.type === "person") { const u = users.find((x) => x.name.trim() === raw); if (!u) return { error: `${c.name}: 구성원 '${raw}' 을 못 찾았습니다` }; values[c.id] = u.id; }
              else if (c.type === "partner") { const p = (partners as any[]).find((x) => String(x.name || "").trim() === raw); if (!p) return { error: `${c.name}: 거래처 '${raw}' 을 못 찾았습니다` }; values[c.id] = p.id; }
              else values[c.id] = raw;
            }
            return { ok: { group_id: gidTo, name, values } };
          }}
          previewHead={[xlsLabels.group, xlsLabels.name, ...xlsLabels.cols.slice(0, 4)]}
          previewRow={(v) => [
            groups.find((g) => g.id === v.group_id)?.name || "",
            v.name,
            ...cols.slice(0, 4).map((c) => xlsDisplay(c, v.values[c.id])),
          ]}
          commit={async (rows) => {
            //   자리 번호 — 걸러 보는 중이어도 그룹의 **전체** 줄 수 뒤에 붙인다(숨은 줄과 안 겹치게)
            const base: Record<string, number> = {};
            for (const g of groups) base[g.id] = (items as BoardItem[]).filter((it) => it.group_id === g.id).length;
            const ins = rows.map((r) => ({ board_id: boardId, group_id: r.group_id, name: r.name, position: base[r.group_id]++, values: r.values }));
            const { error } = await db.from("project_board_items").insert(ins);
            if (error) throw new Error(error.message);
            qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
            return `${rows.length}줄을 올렸습니다`;
          }}
          onClose={() => setXlsOpen(false)} />
      )}

      {/* 문서 팝업 — 견적·계약·발행. 화면을 옮기지 않고 여기서 끝낸다 */}
      {docModalItem && (
        <BoardDocModal
          kind={docModal!.kind}
          rowName={docModalItem.name}
          doc={docModalDoc}
          draft={docModal!.draft ? { name: docModal!.draft.name, content: docModal!.draft.content } : null}
          onCreate={createDocFromDraft}
          amount={docModalAmount}
          partnerName={docModalPartner?.name || ""}
          partnerId={docModalPartner?.id || null}
          partnerBizno={docModalPartner?.business_number || null}
          companyId={companyId} dealId={dealId} userId={userId}
          quoteDoc={docModalQuote}
          hasContract={!!((docModalItem.values || {})[CONTRACT_VALUE_KEY] as any)?.id}
          onAmountChange={syncRowAmount}
          onQuoteReplaced={relinkQuote}
          onClose={() => setDocModal(null)}
          onSent={() => markStage(docModalItem, /견적/)}
          onApproved={() => markStage(docModalItem, /계약/)}
          onIssued={() => markStage(docModalItem, /발행/)} />
      )}

      {/* 행 상세 — 표·칸반 어디서 열어도 같은 서랍. 칸 편집기는 같은 Cell 을 넘겨준다 */}
      {openItem && (
        <BoardItemDrawer
          item={openItem} cols={cols} companyId={companyId} userId={userId} users={users}
          nameLabel={nameLabel} dealId={dealId}
          onClose={() => setOpenItemId(null)}
          onSaveName={(v) => saveName(openItem, v)}
          renderCell={(c) => (
            <Cell col={c} item={openItem} users={users} partners={partners as any[]} companyId={companyId}
              onPartnerCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })}
              onSave={(v) => saveValue(openItem, c.id, v)} />
          )} />
      )}

      {isAds ? (
        /* 광고 표는 **입력이 없다** — 값을 매체에서 받아오므로 대시보드만 보여 준다
           (2026-08-06 사장님: "아드리엘처럼 입력화면 없이 대시보드만") */
        <AdDashboard dealId={dealId} companyId={companyId} boardId={boardId} />
      ) : summaryScope === "all" ? (
        /* 전체 요약 — 돈 흐름 한 장 + 표마다 한 줄. 줄을 누르면 그 표의 요약으로 간다 (2026-08-07) */
        <ProjectDigest dealId={dealId} boards={boards} cols={allCols} groups={allGroups} items={allItems} users={users}
          activeId={boardId}
          onPickBoard={(bid: string) => { setActiveId(bid); setSummaryScope("board"); }} />
      ) : summaryScope === "board" ? (
        /* 이 표만 요약 */
        <BoardSummary boardName={board?.name || "표"} templateKey={board?.template_key}
          cols={cols} items={items} groups={groups} users={users}
          presets={summaryPresets} onSavePreset={saveSummaryPreset} onUpdatePreset={editSummaryPreset}
          onRemovePreset={dropSummaryPreset}
          onOpenItem={(itemId) => setOpenItemId(itemId)} />
      ) : view === "expiry" ? (
        /* 만기 카드 — '계약 · 갱신' 의 첫 화면 (2026-08-07) */
        <BoardExpiry items={shown} cols={cols} groups={groups}
          partnerName={(it) => (partners as any[]).find((p) => p.id === it.values?.[partnerColId || ""])?.name || ""}
          onOpen={setOpenItemId}
          onAdvance={(it, next) => { const f = flowColumnOf(cols); if (f) saveValue(it, f.id, next); }}
          onContract={makeContract}
          contractOf={(it) => !!((it.values || {})[CONTRACT_VALUE_KEY] as any)?.id}
          busyId={makingDoc}
          onAdd={(gid, name, values) => addItem(gid, values, name)}
          onSetDate={(it, colId, v) => saveValue(it, colId, v)}
          renderPartner={(value, onChange) => (
            <PartnerCell value={value} partners={partners as any[]} companyId={companyId}
              onSave={(v) => onChange(v || "")}
              onCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })} />
          )} />
      ) : view === "expense" ? (
        /* 지출 입력 — '예산 · 지출' 의 첫 화면 (2026-08-07) */
        <BoardExpense items={shown} cols={cols} groups={groups}
          onAdd={(gid, name, values) => addItem(gid, values, name)}
          onOpen={setOpenItemId}
          renderPartner={(value, onChange) => (
            <PartnerCell value={value} partners={partners as any[]} companyId={companyId}
              onSave={(v) => onChange(v || "")}
              onCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })} />
          )} />
      ) : view === "deals" ? (
        /* 건별 진행 카드 — '매출 흐름' 의 첫 화면 (2026-08-07) */
        <BoardDeals items={shown} cols={cols}
          partnerName={(it) => (partners as any[]).find((p) => p.id === it.values?.[partnerColId || ""])?.name || ""}
          userName={(id) => users.find((u) => u.id === String(id || ""))?.name || ""}
          onOpen={setOpenItemId}
          onStage={(it, opt) => { const f = flowColumnOf(cols); if (f) saveValue(it, f.id, opt); }}
          renderDocs={(it) => (
            <DocChain it={it} busy={makingDoc === it.id} canMake={!!userId} atContract={atContractStage(it)}
              onQuote={() => openQuote(it)} onContract={() => makeContract(it)}
              onIssue={() => setDocModal({ itemId: it.id, kind: "issue" })} />
          )} />
      ) : view === "calendar" ? (
        /* 캘린더 — '일정 · 마일스톤' 의 첫 화면. 빈 칸을 끌면 그 자리에 일정이 생긴다 (2026-08-07) */
        <BoardCalendar items={shown} cols={cols} flowCol={flowCol} onOpen={setOpenItemId}
          onCreateRange={(from, to, name) => {
            const span = spanColumnsOf(cols);
            const values: Record<string, any> = {};
            if (span) { values[span.start.id] = from; values[span.end.id] = to; }
            addItem(groups[0]?.id || "", values, name);
          }} />
      ) : view === "inbox" ? (
        /* 접수함 — '요청 · 검수' 의 첫 화면 (2026-08-07) */
        <BoardInbox
          items={shown} cols={cols} groups={groups} users={users} userId={userId}
          onAdd={(gid, name, values) => addItem(gid, values, name)}
          onOpen={setOpenItemId}
          onAdvance={(it, next) => { const f = flowColumnOf(cols); if (f) saveValue(it, f.id, next); }} />
      ) : view === "minutes" ? (
        /* 회의록 — '회의 · 결정' 의 첫 화면. 표는 '표' 로 언제든 돌아간다 (2026-08-07) */
        <BoardMinutes
          items={shown} cols={cols} groups={groups} users={users}
          activeGroupId={minutesGroup || groups[0]?.id || null}
          onPickGroup={setMinutesGroup}
          onAddGroup={addGroup}
          onAdd={(gid, name) => addItem(gid, {}, name)}
          onOpen={setOpenItemId}
          sending={sendingTodo}
          onSendToTodo={sendToTodo}
          onSaveCell={(it, colId, v) => saveValue(it, colId, v)}
          renderCell={(c, it) => (
            <Cell col={c} item={it} users={users} partners={partners as any[]} companyId={companyId}
              onSave={(v) => saveValue(it, c.id, v)}
              onPartnerCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })} />
          )} />
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
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
                        className="pb-card-name" />
                      {/* 칸을 더 붙이면 카드에도 바로 보여야 한다 — 앞 4개만 보여 주면 추가가 안 된 것처럼 읽힌다 */}
                      <div className="pb-card-fields">
                        {cols.filter((c) => c.id !== flowCol?.id).map((c) => (
                          <span key={c.id} className="pb-card-field">
                            <label>{c.name}</label>
                            <Cell col={c} item={it} users={users} partners={partners as any[]} companyId={companyId}
                              onPartnerCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })}
                              onSave={(v) => saveValue(it, c.id, v)} />
                          </span>
                        ))}
                        {/* 칸 추가 — 칸반에도 라벨 옆에 ＋ 를 둔다(표로 옮겨 가지 않아도 칸을 붙일 수 있게) */}
                        <span className="pb-card-field pb-card-addcol">
                          <label>칸 추가</label>
                          <select value="" title="칸 추가 — 형식을 고르세요" aria-label="칸 추가"
                            onChange={(e) => { if (e.target.value) addColumn(e.target.value as ColType); }}>
                            <option value="">＋</option>
                            {COL_FORMATS.map((f) => <option key={f.type} value={f.type}>{f.label}</option>)}
                          </select>
                        </span>
                      </div>
                      {ratioPair && <RatioBar plan={Number(it.values?.[ratioPair.plan.id]) || 0} real={Number(it.values?.[ratioPair.real.id]) || 0} unit={ratioPair.real.settings?.unit || ""} />}
                      {isBilling && (
                        <DocChain it={it} busy={makingDoc === it.id} canMake={!!userId} atContract={atContractStage(it)}
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
          //   줄을 이 구획 안 빈자리에 놓으면 그 그룹 맨 뒤로 — 그룹이 비어 있어도 옮길 수 있어야 한다
          //   (손이 어디 위에 있는지는 data-group·data-row 로 찾는다)
          <section key={g.id} data-group={g.id} className={`pb-group ${rowDrag ? "pb-group-drop" : ""}`}>
            {/* 그룹이 하나뿐이면 머리줄을 숨긴다 — '요청 목록 6건' 한 줄이 뜻 없이 자리를 먹었다 */}
            {groups.length > 1 && (
              <div className="pb-group-head">
                <span className="pb-group-dot" style={{ background: g.color }} />
                <input defaultValue={g.name} className="pb-group-name"
                  onBlur={(e) => renameGroup(g, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }} />
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
              {/* 칸 너비를 표가 알아서 정하게 두면 머리글에 든 것(단위 칸·라벨 버튼)에 따라 칸마다 폭이
                  달라진다 — 값이 같은 종류인데 상자 넓이가 제각각으로 보였다(2026-08-05 사장님 지시).
                  칸 너비를 colgroup 으로 못 박고, 화면이 좁으면 가로로 스크롤한다. */}
              <table className="pb-table" style={{ minWidth: COL_W.sel + slots.reduce((n, s) => n + widthOfSlot(s), 0)
                + (ratioPair ? COL_W.ratio : 0) + (isBilling ? COL_W.doc : 0) + COL_W.tail }}>
                <colgroup>
                  <col className="pbc-sel" />
                  {/* 칸마다 너비를 따로 준다 — 머리 ⋯ 의 '칸 너비'에서 고른 값(기본 보통).
                      첫 칸('항목')도 이 줄에 섞여 있어 끌어 옮긴 자리에 그대로 선다 */}
                  {slots.map((s) => <col key={s.id} style={{ width: widthOfSlot(s) }} />)}
                  {ratioPair && <col className="pbc-ratio" />}
                  {isBilling && <col className="pbc-doc" />}
                  <col className="pbc-tail" />
                </colgroup>
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
                    {/* 머리 칸은 끌어서 자리를 바꾼다 — 첫 칸('항목')도 값 칸들 사이로 끼워 넣을 수 있다
                        (2026-08-06 사장님: "항목을 끌어서 구분과 숫자 사이에 놓을 수 있도록").
                        줄 옮기기와 같은 방식: 입력기·단추 위가 아닌 곳에서 5px 넘게 움직이면 끌기. */}
                    {slots.map((s) => {
                      const c = s.col;
                      const dragProps = {
                        "data-slot": s.id,
                        onPointerDown: (e: React.PointerEvent) => {
                          if (e.button !== 0) return;
                          if ((e.target as HTMLElement).closest("input,select,button,textarea,a,label")) return;
                          colPressRef.current = { id: s.id, x: e.clientX, y: e.clientY };
                          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        },
                        onPointerMove: (e: React.PointerEvent) => {
                          const p = colPressRef.current;
                          if (!p || p.id !== s.id) return;
                          if (colDrag !== s.id) {
                            if (Math.abs(e.clientX - p.x) < 5 && Math.abs(e.clientY - p.y) < 5) return;
                            setColDrag(s.id);
                          }
                          const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-slot]") as HTMLElement | null;
                          const over = el?.getAttribute("data-slot") || null;
                          const box = el?.getBoundingClientRect();
                          setColOver(over === s.id ? null : over);
                          setColAfter(!!box && e.clientX > box.left + box.width / 2);
                        },
                        onPointerUp: (e: React.PointerEvent) => {
                          const p = colPressRef.current;
                          colPressRef.current = null;
                          try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* 이미 풀림 */ }
                          if (!p || p.id !== s.id || colDrag !== s.id) return;
                          if (colOver) moveColumnTo(s.id, colOver, colAfter);
                          else { setColDrag(null); setColOver(null); }
                        },
                        onPointerCancel: () => { colPressRef.current = null; setColDrag(null); setColOver(null); },
                        className: `${c?.type === "number" ? "pb-th-num" : ""} ${!c ? "pb-th-name" : ""}`
                          + `${colDrag === s.id ? " pb-th-drag" : ""}`
                          + `${colOver === s.id ? (colAfter ? " pb-th-over-after" : " pb-th-over") : ""}`,
                      };
                      //   첫 칸 — 머리글만 바꾼다(값 칸처럼 형식·라벨이 없다)
                      if (!c) return (
                        <th key={s.id} {...dragProps}>
                          <span className="pb-th-in">
                            <span className="pb-th-marks"><span className="pb-th-grip" title="끌어서 칸 자리 옮기기">⠿</span></span>
                            <input key={`nl-${boardId}-${nameLabel}`} defaultValue={nameLabel} className="pb-col-name"
                              title="첫 칸 머리글 — 비우면 기본으로 돌아갑니다"
                              onBlur={(e) => renameNameColumn(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }} />
                          </span>
                        </th>
                      );
                      return (
                        <th key={s.id} {...dragProps}>
                          <span className="pb-th-in">
                            <input defaultValue={c.name} className="pb-col-name"
                              onBlur={(e) => renameColumn(c, e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }} />
                            {/* 손잡이와, 지금 이 칸에 걸린 정렬·필터 표시 — 머리글을 가운데로 맞추려고
                                흐름에서 빼 왼쪽에 띄운다. 조작은 전부 ⋯ 안에 있다(2026-08-06) */}
                            <span className="pb-th-marks">
                              <span className="pb-th-grip" title="끌어서 칸 자리 옮기기">⠿</span>
                              {sort?.colId === c.id && (
                                <button type="button" className="pb-col-mark" title="정렬 끄기" onClick={() => setSort(null)}>
                                  {sort.dir === "asc" ? "▲" : "▼"}
                                </button>
                              )}
                              {(valueFilters[c.id]?.length || 0) > 0 && (
                                <button type="button" className="pb-col-mark pb-col-mark-flt" title="이 칸 필터 끄기"
                                  onClick={() => setValueFilters((prev) => { const n = { ...prev }; delete n[c.id]; return n; })}>▼</button>
                              )}
                            </span>
                            {/* 그 칸에 대한 모든 것을 한 자리로 — 정렬·필터·너비·라벨·단위·복제·칸 추가·삭제 */}
                            <ColumnMenu col={c}
                              sortDir={sort?.colId === c.id ? sort.dir : null}
                              filtered={(valueFilters[c.id]?.length || 0) > 0}
                              onSort={(dir) => setSort(dir ? { colId: c.id, dir } : null)}
                              onFilter={() => setFilterPanel(c.id)}
                              onSaveSettings={(patch) => saveColSettings(c, patch)}
                              onAddRight={(t) => addColumn(t, c)}
                              onDuplicate={() => duplicateColumn(c)}
                              onRemove={() => removeColumn(c)} />
                          </span>
                        </th>
                      );
                    })}
                    {ratioPair && <th className="pb-th-ratio">{ratioPair.real.name}률</th>}
                    {isBilling && <th className="pb-th-doc">견적서</th>}
                    <th className="pb-th-x">
                      {/* 컬럼은 표의 일부다 — 툴바가 아니라 표 머리 끝에 둔다 */}
                      <span className="pb-addcol">
                        <select value="" title="칸 추가 — 형식을 고르세요"
                          onChange={(e) => { if (e.target.value) addColumn(e.target.value as ColType); }}>
                          <option value="">＋</option>
                          {COL_FORMATS.map((f) => <option key={f.type} value={f.type}>{f.label}</option>)}
                        </select>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => (
                    //   줄 어디를 눌러도 끌린다 — 손잡이(16px)만 잡히게 했더니 잡히지 않는다는 제보
                    //   (2026-08-06). 입력기·단추 위에서 누른 것은 그대로 두고, 빈자리에서 5px 넘게
                    //   움직였을 때만 끌기로 친다(눌렀다 뗀 것과 구분).
                    <tr key={it.id} data-row={it.id}
                      onPointerDown={(e) => {
                        if (sort || e.button !== 0) return;
                        if ((e.target as HTMLElement).closest("input,select,button,textarea,a,label")) return;
                        pressRef.current = { id: it.id, x: e.clientX, y: e.clientY };
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        const p = pressRef.current;
                        if (!p || p.id !== it.id) return;
                        if (rowDrag !== it.id) {
                          if (Math.abs(e.clientY - p.y) < 5 && Math.abs(e.clientX - p.x) < 5) return;
                          setRowDrag(it.id);
                        }
                        const el = document.elementFromPoint(e.clientX, e.clientY);
                        const overRow = el?.closest("tr[data-row]")?.getAttribute("data-row") || null;
                        setRowOver(overRow === it.id ? null : overRow);
                        setOverGroup(el?.closest("section[data-group]")?.getAttribute("data-group") || null);
                      }}
                      onPointerUp={(e) => {
                        const p = pressRef.current;
                        pressRef.current = null;
                        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* 이미 풀림 */ }
                        if (!p || p.id !== it.id || rowDrag !== it.id) return;
                        if (overGroup) moveRow(overGroup, rowOver || undefined);
                        else { setRowDrag(null); setRowOver(null); }
                        setOverGroup(null);
                      }}
                      onPointerCancel={() => { pressRef.current = null; setRowDrag(null); setRowOver(null); setOverGroup(null); }}
                      className={`${rowDrag === it.id ? "pb-row-drag" : ""} ${rowOver === it.id ? "pb-row-over" : ""}`}>
                      <td className="pb-td-sel">
                        {/* 첫 칸이 손잡이 자리 — 여기를 잡고 끌면 줄이 따라온다(이름 칸 안 16px 은 너무 좁았다) */}
                        <span className={`pb-grip ${rowDrag === it.id ? "pb-grip-on" : ""}`}
                          title={sort ? "정렬을 끄면 순서를 바꿀 수 있습니다" : "끌어서 순서 바꾸기"}>⠿</span>
                        <input type="checkbox" aria-label="줄 선택" checked={selected.has(it.id)}
                          onChange={(e) => setSelected((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(it.id); else n.delete(it.id);
                            return n;
                          })} />
                      </td>
                      {/* 값 줄도 머리와 같은 차례로 — 첫 칸이 가운데로 끼어 있으면 값도 그 자리에 선다 */}
                      {slots.map((s) => (s.col ? (
                        <td key={s.id} className={tdAlign(s.col.type)}>
                          <Cell col={s.col} item={it} users={users} partners={partners as any[]} companyId={companyId}
                            onPartnerCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })}
                            onFillDown={() => {
                              // 엑셀 습관 그대로 — 바로 윗줄 값을 끌어온다
                              const idx = rows.findIndex((r) => r.id === it.id);
                              const above = idx > 0 ? rows[idx - 1] : null;
                              if (above) saveValue(it, s.col!.id, above.values?.[s.col!.id] ?? null);
                            }}
                            onSave={(v) => saveValue(it, s.col!.id, v)} />
                        </td>
                      ) : (
                        <td key={s.id} className="pb-td-name">
                          <span className="pb-name-cell">
                            <input defaultValue={it.name} placeholder={`${nameLabel} 입력`}
                              onBlur={(e) => saveName(it, e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
                              className="pb-in" />
                            <button type="button" className="pb-open" title="열기 — 메모·파일" onClick={() => setOpenItemId(it.id)}>⤢</button>
                            <button type="button" className="pb-open" title="한 줄 복제" onClick={() => duplicateItem(it)}>⧉</button>
                          </span>
                        </td>
                      )))}
                      {ratioPair && (
                        <td className="pb-td-ratio">
                          <RatioBar plan={Number(it.values?.[ratioPair.plan.id]) || 0} real={Number(it.values?.[ratioPair.real.id]) || 0} unit={ratioPair.real.settings?.unit || ""} />
                        </td>
                      )}
                      {isBilling && (
                        <td className="pb-td-doc">
                          <DocChain it={it} busy={makingDoc === it.id} canMake={!!userId} atContract={atContractStage(it)}
                            onQuote={() => openQuote(it)} onContract={() => makeContract(it)}
                            onIssue={() => setDocModal({ itemId: it.id, kind: "issue" })} />
                        </td>
                      )}
                      <td className="pb-td-x">
                        <button type="button" className="pb-x" title="행 삭제" onClick={() => removeItem(it)}>✕</button>
                      </td>
                    </tr>
                  ))}
                  <QuickAddRow key={`qa-${g.id}`} nameLabel={nameLabel} slots={slots} users={users}
                    partners={partners as any[]} companyId={companyId}
                    onPartnerCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })}
                    extraCells={(ratioPair ? 1 : 0) + (isBilling ? 1 : 0)}
                    onAdd={(name, values) => addItem(g.id, values, name)} />
                  {rows.length > 0 && numberCols.length > 0 && (
                    <tr className="pb-sum">
                      <td />
                      {slots.map((s) => (s.col ? (
                        <td key={s.id} className={tdAlign(s.col.type)}>
                          {s.col.type === "number" ? won(sumColumn(rows, s.col.id)) : ""}
                        </td>
                      ) : <td key={s.id}>합계</td>))}
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
    </div>
  );
}


// ── 빠른 입력 줄 — 빈 행을 만들고 칸을 옮겨 다니는 대신 한 줄에서 끝낸다 (2026-08-04 기획 5단계) ──
//   2026-08-05 사장님: "컬럼을 추가했는데 밑에 입력은 고정되어 있다."
//   → 이름 + 첫 숫자 + 첫 날짜만 받던 것을 **표의 모든 칸을 그대로** 받도록 바꿨다.
//     칸마다 자기 자리(td)에 입력기가 서므로 머리글과 세로로 맞는다.
//   Enter 를 치면 저장하고 이름 칸으로 커서가 돌아온다 — 여러 건을 연달아 넣을 때가 많다.
function QuickAddRow({ nameLabel, slots, users, partners, companyId, onPartnerCreated, extraCells, onAdd }: {
  /** 머리와 같은 차례 — 첫 칸이 가운데로 끼어 있으면 입력 줄도 그 자리에 선다 */
  nameLabel: string; slots: Slot[]; users: { id: string; name: string }[];
  /** 거래처도 이 줄에서 고른다 — 돈 표에서는 거래처가 핵심 칸이다(2026-08-07) */
  partners: { id: string; name: string; business_number?: string | null }[];
  companyId: string; onPartnerCreated: () => void;
  /** 비율·문서처럼 머리글에만 있는 칸 수 — 빈 칸으로 채워 자리를 맞춘다 */
  extraCells: number;
  onAdd: (name: string, values: Record<string, any>) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  //   흐름(단계) 칸은 첫 단계가 기본 — 빈 단계 줄이 칸반의 '단계 미지정'으로 떨어지는 걸 막는다
  //   (2026-08-20 입력 점검). 회의→할 일 보내기의 "첫 단계에 세운다"와 같은 정책.
  //   ⚠️ flow 표시가 있는 칸만 — 구분·우선순위 같은 일반 상태 칸에 기본값을 넣으면 거짓 데이터가 된다.
  //   바꾸거나 비우는 것('—')은 그 자리에서 그대로 가능하다.
  const flowDefault = useMemo(() => {
    const fc = slots.map((s) => s.col).find((c) => c && c.type === "status" && c.settings?.flow) || null;
    const first = ((fc?.settings?.options || []) as StatusOption[])[0];
    return fc && first ? { [fc.id]: String(first.id) } : {};
  }, [slots]);
  const [values, setValues] = useState<Record<string, any>>(flowDefault);
  //   칸이 늦게 오면(첫 렌더 때 slots 가 비었으면) 기본값을 뒤늦게 한 번 채운다.
  //   사용자가 '—' 로 비운 값("")은 undefined 가 아니므로 다시 덮지 않는다.
  useEffect(() => {
    const [k, v] = Object.entries(flowDefault)[0] || [];
    if (k) setValues((prev) => (prev[k] === undefined ? { ...prev, [k]: v } : prev));
  }, [flowDefault]);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const set = (id: string, v: any) => setValues((prev) => ({ ...prev, [id]: v }));

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      //   빈 칸은 아예 안 담는다 — 빈 문자열이 들어가면 '입력됨'으로 세어진다
      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(values)) if (v !== "" && v != null) clean[k] = v;
      await onAdd(name.trim(), clean);
      setName(""); setValues(flowDefault);
      nameRef.current?.focus();
    } finally { setBusy(false); }
  };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } };

  return (
    <tr className="pb-quick">
      <td className="pb-td-sel" />
      {slots.map((s) => (s.col ? (
        <td key={s.id} className={tdAlign(s.col.type)} onKeyDown={onKey}>
          <QuickCell col={s.col} users={users} partners={partners} companyId={companyId}
            onPartnerCreated={onPartnerCreated}
            value={values[s.col.id] ?? ""} onChange={(v) => set(s.col!.id, v)} />
        </td>
      ) : (
        <td key={s.id} className="pb-td-name">
          <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey}
            placeholder={`＋ ${nameLabel} 입력하고 Enter`} className="pb-quick-name" />
        </td>
      )))}
      {Array.from({ length: extraCells }, (_, i) => <td key={`x${i}`} />)}
      <td className="pb-td-x">
        <button type="button" onClick={submit} disabled={busy || !name.trim()} className="pb-quick-go">
          {busy ? "…" : "추가"}
        </button>
      </td>
    </tr>
  );
}

/** 빠른 입력 줄의 칸 하나 — 아직 행이 없으므로 저장된 셀(Cell)과 달리 값을 들고만 있는다. */
function QuickCell({ col, users, partners, companyId, onPartnerCreated, value, onChange }: {
  col: BoardColumn; users: { id: string; name: string }[];
  partners: { id: string; name: string; business_number?: string | null }[];
  companyId: string; onPartnerCreated: () => void;
  value: any; onChange: (v: any) => void;
}) {
  if (col.type === "number") {
    return <input value={value} inputMode="numeric" placeholder={col.settings?.unit || "0"} className="pb-quick-in pb-quick-num"
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.-]/g, ""))} />;
  }
  if (col.type === "date") {
    return <DateField value={value || ""} onChange={(e) => onChange(e.target.value)} className="pb-quick-in" />;
  }
  if (col.type === "status") {
    //   고른 라벨은 위 줄들과 **같은 색 라벨**로 보여 준다 — 여기만 맨 select 로 두니 다른 칸처럼 보였다
    //   (2026-08-06 사장님: "단계 부분 검토를 선택했을 때 라벨로 나와야 하는 게 아닌지").
    const options: StatusOption[] = (col.settings?.options || []) as StatusOption[];
    const cur = options.find((o) => o.id === value);
    return (
      <span className={`pb-status ${cur ? "" : "pb-status-empty"}`} style={cur ? { background: cur.color } : undefined}>
        <select value={value || ""} aria-label={col.name} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <i>{cur?.label || "—"}</i>
      </span>
    );
  }
  if (col.type === "person") {
    return (
      <select value={value || ""} className="pb-quick-in" aria-label={col.name} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    );
  }
  if (col.type === "partner") {
    //   예전엔 '행을 만든 뒤 표에서 고르세요' 였다 — 돈 표(매출 흐름·예산 지출)에서 거래처는
    //   핵심 칸이라, 한 줄에서 끝내자는 이 줄의 취지가 거기서 끊겼다 (2026-08-07 사장님 점검).
    //   저장된 셀과 같은 고르개를 쓴다 — 없는 거래처는 여기서 바로 등록된다.
    return (
      <PartnerCell value={value || ""} partners={partners} companyId={companyId}
        onSave={(v) => onChange(v || "")} onCreated={onPartnerCreated} />
    );
  }
  return <input value={value || ""} placeholder={col.name} className="pb-quick-in"
    onChange={(e) => onChange(e.target.value)} />;
}

// ── 계획 대비 실적 막대 — 금액 대비 입금(잔금), 예산 대비 집행(남은 예산) ──
//   2026-08-07 사장님: "계약금이 입금되면 잔금이 얼마인지 보이면 좋겠다".
//   비율만으로는 '얼마 남았나' 를 못 읽는다 — 원 단위면 남은 금액을 숫자로 함께 적는다.
function RatioBar({ plan, real, unit }: { plan: number; real: number; unit?: string }) {
  if (!plan && !real) return <span className="pb-ratio-none">—</span>;
  const pct = plan > 0 ? Math.round((real / plan) * 100) : null;
  const over = pct != null && pct > 100;
  const left = plan - real;
  return (
    <span className="pb-ratio" title={pct == null ? "계획 없음" : `${real.toLocaleString("ko-KR")} / ${plan.toLocaleString("ko-KR")}`}>
      <span className="pb-ratio-line">
        <span className="pb-ratio-track">
          <i className={over ? "pb-ratio-over" : ""} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
        </span>
        <em className={over ? "pb-ratio-bad" : ""}>{pct == null ? "—" : `${pct}%`}</em>
      </span>
      {unit === "원" && plan > 0 && (
        <b className={left < 0 ? "pb-ratio-left pb-ratio-bad" : "pb-ratio-left"}>
          {left > 0 ? `남은 ${won(left)}` : left === 0 ? "완납" : `초과 ${won(-left)}`}
        </b>
      )}
    </span>
  );
}

// ── 문서 체인 — 청구 한 줄이 견적 → 계약으로 이어진다 (2026-08-04 기획 3단계) ──
//   발행·입금은 세금계산서 화면이 맡는다. 여기서는 만들어진 문서로 가는 길만 준다.
function DocChain({ it, busy, canMake, atContract, onQuote, onContract, onIssue }: {
  it: BoardItem; busy: boolean; canMake: boolean;
  /** 이 줄이 '계약' 단계인가 — 그러면 계약서 만들기를 눈에 띄게 한다 */
  atContract: boolean;
  onQuote: () => void; onContract: () => void; onIssue: () => void;
}) {
  const quote = (it.values || {})[DOC_VALUE_KEY] as { id?: string; no?: string } | undefined;
  const contract = (it.values || {})[CONTRACT_VALUE_KEY] as { id?: string; no?: string } | undefined;
  return (
    <span className="pb-chain">
      {quote?.id
        ? <button type="button" className="pb-chain-on" onClick={onQuote} title="견적서 열기">견적 {quote.no || ""}</button>
        : <button type="button" className="pb-chain-do" disabled={busy || !canMake} onClick={onQuote}>{busy ? "…" : "＋ 견적서"}</button>}
      {/*  견적이 없어도 계약서를 만든다 — 견적 없이 바로 계약하는 일이 흔하다(2026-08-07) */}
      {contract?.id
        ? <button type="button" className="pb-chain-on" onClick={onContract} title="계약서 열기 · 전자서명">계약</button>
        : <button type="button" className={`pb-chain-do ${atContract ? "pb-chain-urge" : ""}`}
            disabled={busy || !canMake} onClick={onContract}
            title="계약서를 만들고 거래처에 전자서명을 요청합니다">＋ 계약서</button>}
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
  /** 정리 안에서 그릴 때는 없다 — 거기서는 읽기만 한다 */
  onAdd?: () => void;
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
        {/*  날짜 칸이 하나뿐이면 시작·종료가 같은 칸이다 — 이름을 두 번 적으면 "예상일·예상일" 이 된다 */}
        {span.start === span.end
          ? <>{span.end.name} 을 채우면 여기에 기간 막대로 그려져요.</>
          : <>{span.start.name}·{span.end.name} 을 채우면 여기에 기간 막대로 그려져요.</>}
        {onAdd && <button type="button" className="pb-kadd ml-2" onClick={onAdd}>＋ {nameLabel}</button>}
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

/** 창 바깥을 눌러 닫기 — **누르기 시작한 자리가 배경일 때만** 닫는다.
 *  입력칸 안에서 글자를 끌어 고르다 바깥에서 손을 떼면 브라우저가 그 클릭을 배경 것으로 쳐서
 *  창이 닫혔다(2026-08-06 사장님 제보). 모든 팝업이 이 한 곳을 쓴다. */
function useVeilClose(onClose: () => void) {
  const down = useRef(false);
  return {
    onMouseDown: (e: React.MouseEvent) => { down.current = e.target === e.currentTarget; },
    onClick: (e: React.MouseEvent) => { if (down.current && e.target === e.currentTarget) onClose(); },
  };
}

/** 이름만 묻는 작은 창 — 회사 양식 저장처럼 한 줄만 받으면 되는 자리 */
function NameDialog({ title, hint, value, onSave, onCancel }: {
  title: string; hint?: string; value: string; onSave: (name: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(value);
  const veil = useVeilClose(onCancel);
  const ok = v.trim().length > 0;
  return (
    <div className="pb-doc-modal" {...veil}>
      <div className="pb-doc-box pb-name-box">
        <b className="pb-name-h">{title}</b>
        {hint && <em className="pb-name-hint">{hint}</em>}
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="양식 이름"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && ok) onSave(v.trim()); if (e.key === "Escape") onCancel(); }} />
        <span className="pb-name-foot">
          <button type="button" onClick={onCancel}>취소</button>
          <button type="button" className="pb-name-go" disabled={!ok} onClick={() => onSave(v.trim())}>저장</button>
        </span>
      </div>
    </div>
  );
}

/** 칸 하나에 대한 모든 것 — 정렬 · 필터 · 너비 · 라벨 · 단위 · 복제 · 칸 추가 · 삭제 (2026-08-06 사장님 지시).
 *
 *   머리에 단추를 늘어놓으면 그만큼 칸이 넓어진다("지금 칸이 너무 넓은 듯").
 *   그래서 머리는 [이름][지금 걸린 정렬·필터 표시][⋯] 만 두고, 나머지는 전부 이 창에서 다룬다.
 *   (표가 가로 스크롤 상자라 붙어 뜨는 팝오버는 잘린다 — 가운데 창으로 띄운다.)
 *   즉시 도는 것(정렬·필터·복제·칸 추가·삭제)과 저장을 눌러야 도는 것(라벨·단위·너비)을 층으로 가른다.
 */
function ColumnMenu({ col, sortDir, filtered, onSort, onFilter, onSaveSettings, onAddRight, onDuplicate, onRemove }: {
  col: BoardColumn;
  sortDir: "asc" | "desc" | null;
  filtered: boolean;
  onSort: (dir: "asc" | "desc" | null) => void;
  onFilter: () => void;
  onSaveSettings: (patch: Record<string, any>) => void;
  onAddRight: (type: ColType) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);      // '오른쪽에 칸 추가' 를 고른 상태
  const veil = useVeilClose(() => setOpen(false));
  const options = ((col.settings?.options || []) as StatusOption[]);
  const [draft, setDraft] = useState<StatusOption[]>([]);
  const [unit, setUnit] = useState("");
  const [width, setWidth] = useState<number>(COL_W.cell);

  const start = () => {
    setDraft(options.map((o) => ({ ...o })));
    setUnit(col.settings?.unit || "");
    setWidth(widthOf(col));
    setAdding(false);
    setOpen(true);
  };
  const save = () => {
    setOpen(false);
    const patch: Record<string, any> = {};
    if (col.type === "status") {
      const clean = draft.filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() }));
      const same = clean.length === options.length
        && clean.every((d, i) => d.id === options[i].id && d.label === options[i].label && d.color === options[i].color);
      if (!same) patch.options = clean;
    }
    if (col.type === "number" && unit.trim() !== (col.settings?.unit || "")) patch.unit = unit.trim() || undefined;
    if (width !== widthOf(col)) patch.width = width;
    if (Object.keys(patch).length > 0) onSaveSettings(patch);
  };
  const act = (fn: () => void) => { setOpen(false); fn(); };

  return (
    <>
      <button type="button" className={`pb-colmenu-btn ${open ? "pb-colmenu-on" : ""}`}
        title={`'${col.name}' 칸 — 정렬 · 필터 · 너비 · 설정`} aria-label={`${col.name} 칸 메뉴`} onClick={start}>⋯</button>
      {open && (
        <div className="pb-doc-modal" {...veil}>
          <div className="pb-doc-box pb-collabels-box">
            <b className="pb-collabels-h">‘{col.name}’ 칸</b>
            {adding ? (<>
              {/* 오른쪽에 칸 추가 — 표 끝까지 가로로 밀지 않아도 원하는 자리에 붙는다 */}
              <em className="pb-name-hint">이 칸 바로 오른쪽에 붙일 칸의 형식을 고르세요.</em>
              <span className="pb-colplus-list">
                {COL_FORMATS.map((f) => (
                  <button key={f.type} type="button" onClick={() => act(() => onAddRight(f.type))}>
                    <b>{f.label}</b>
                    <em>{f.hint}</em>
                  </button>
                ))}
              </span>
              <span className="pb-collabels-foot">
                <button type="button" onClick={() => setAdding(false)}>뒤로</button>
              </span>
            </>) : (<>
              <span className="pb-colmenu-sec">
                <span>정렬</span>
                <span className="pb-colmenu-pick">
                  <button type="button" aria-pressed={sortDir === "asc"} className={sortDir === "asc" ? "pb-colmenu-on2" : ""}
                    onClick={() => act(() => onSort("asc"))}>▲ 오름차순</button>
                  <button type="button" aria-pressed={sortDir === "desc"} className={sortDir === "desc" ? "pb-colmenu-on2" : ""}
                    onClick={() => act(() => onSort("desc"))}>▼ 내림차순</button>
                  <button type="button" disabled={!sortDir} onClick={() => act(() => onSort(null))}>해제</button>
                </span>
              </span>
              <span className="pb-colmenu-sec">
                <span>칸 너비</span>
                <span className="pb-colmenu-pick">
                  {COL_WIDTHS.map((w) => (
                    <button key={w.key} type="button" aria-pressed={width === w.px}
                      className={width === w.px ? "pb-colmenu-on2" : ""} onClick={() => setWidth(w.px)}>{w.label}</button>
                  ))}
                </span>
              </span>
              {col.type === "status" && (<>
                <em className="pb-name-hint">이 칸에서 고를 수 있는 값 — 이름 · 색 · 순서를 여기서 정합니다.</em>
                <LabelEditor options={draft} onChange={setDraft}
                  note="쓰고 있던 라벨을 빼면 그 행은 빈칸이 됩니다(값은 남습니다)." />
              </>)}
              {col.type === "number" && (
                <label className="pb-colmenu-unit">
                  <span>단위</span>
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="원 · % · 개"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) save(); }} />
                  <em>정리에서 원끼리만 더하고 % 는 평균을 냅니다.</em>
                </label>
              )}
              <span className="pb-colmenu-list">
                <button type="button" onClick={() => act(onFilter)}>
                  이 칸 값으로 거르기{filtered ? " — 지금 걸려 있음" : ""}
                </button>
                <button type="button" onClick={() => setAdding(true)}>오른쪽에 칸 추가 ▸</button>
                <button type="button" onClick={() => act(onDuplicate)}>칸 복제</button>
              </span>
              <span className="pb-collabels-foot">
                <button type="button" className="pb-fmt-del" onClick={() => act(onRemove)}>이 칸 삭제</button>
                <button type="button" onClick={() => setOpen(false)}>취소</button>
                <button type="button" className="pb-collabels-go" onClick={save}>저장</button>
              </span>
            </>)}
          </div>
        </div>
      )}
    </>
  );
}

// ── 칸 값 필터 — 엑셀 필터처럼 "이 칸에 무슨 값이 몇 건" 을 보고 골라 좁힌다 (2026-08-06 사장님 지시) ──
/** 값이 빈 행도 골라 볼 수 있어야 한다 — 빈칸만 모으는 일이 실제로 잦다 */
const FACET_EMPTY = "__empty";
/** 이 행이 그 칸에서 어느 값에 속하는지. 세는 쪽과 거르는 쪽이 **같은 함수**를 써야 숫자가 안 어긋난다.
 *  날짜는 달로 묶는다 — 하루하루 늘어놓으면 목록이 못 쓰게 된다. */
function facetKey(col: BoardColumn, it: BoardItem): string {
  const v = it.values?.[col.id];
  if (v === null || v === undefined || String(v).trim() === "") return FACET_EMPTY;
  if (col.type === "date") {
    const s = String(v);
    return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : FACET_EMPTY;
  }
  return String(v);
}
type Facet = { col: BoardColumn; opts: { key: string; label: string; color?: string; count: number }[]; more: number };
/** 칸마다 값 목록을 만든다. 상태·담당은 정해진 순서대로, 나머지는 많은 것부터. 너무 길면 잘라 낸다. */
function buildFacets(cols: BoardColumn[], rows: BoardItem[], users: { id: string; name: string }[], partners: any[]): Facet[] {
  const CAP = 12;
  const thisYear = todayKst().slice(0, 4);
  return cols.map((col) => {
    const count = new Map<string, number>();
    for (const it of rows) {
      const k = facetKey(col, it);
      count.set(k, (count.get(k) || 0) + 1);
    }
    const options = ((col.settings?.options || []) as StatusOption[]);
    const labelOf = (k: string): { label: string; color?: string } => {
      if (k === FACET_EMPTY) return { label: "(빈칸)" };
      if (col.type === "status") {
        const o = options.find((x) => x.id === k);
        return { label: o?.label || "(지운 라벨)", color: o?.color };
      }
      if (col.type === "person") return { label: users.find((u) => u.id === k)?.name || "(나간 사람)" };
      if (col.type === "partner") return { label: partners.find((p) => p.id === k)?.name || "(지운 거래처)" };
      if (col.type === "date") {
        const [y, m] = k.split("-");
        return { label: y === thisYear ? `${Number(m)}월` : `${y.slice(2)}.${m}` };
      }
      if (col.type === "number") return { label: Number(k).toLocaleString("ko-KR") + (col.settings?.unit || "") };
      return { label: k };
    };
    //   순서 — 상태·담당은 그 칸이 이미 정해 둔 차례를, 날짜는 이른 달부터, 나머지는 건수 많은 것부터
    let keys = [...count.keys()];
    if (col.type === "status") {
      const rank = new Map(options.map((o, i) => [o.id, i]));
      keys.sort((a, b) => (rank.get(a) ?? 900) - (rank.get(b) ?? 900));
    } else if (col.type === "person") {
      const rank = new Map(users.map((u, i) => [u.id, i]));
      keys.sort((a, b) => (rank.get(a) ?? 900) - (rank.get(b) ?? 900));
    } else if (col.type === "date") {
      keys.sort((a, b) => a.localeCompare(b));
    } else {
      keys.sort((a, b) => (count.get(b) || 0) - (count.get(a) || 0));
    }
    //   빈칸은 늘 맨 뒤 — 값이 있는 것부터 보이는 게 자연스럽다
    keys = [...keys.filter((k) => k !== FACET_EMPTY), ...keys.filter((k) => k === FACET_EMPTY)];
    const shownKeys = keys.slice(0, CAP);
    return {
      col,
      opts: shownKeys.map((k) => ({ key: k, count: count.get(k) || 0, ...labelOf(k) })),
      more: Math.max(0, keys.length - shownKeys.length),
    };
  });
}

/** 필터 창 — 칸을 가로로 늘어놓고, 칸마다 값을 눌러 켜고 끈다.
 *  같은 칸 안에서 여럿 고르면 '둘 다 보기', 칸끼리는 '둘 다 만족'이다. */
function QuickFilterPanel({ facets, picked, focusColId, total, shownCount, onToggle, onClear, onClose }: {
  facets: Facet[];
  picked: Record<string, string[]>;
  /** 칸 머리 ⋯ 에서 열었으면 그 칸을 맨 앞에 둔다 */
  focusColId: string;
  total: number; shownCount: number;
  onToggle: (colId: string, key: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ordered = focusColId
    ? [...facets.filter((f) => f.col.id === focusColId), ...facets.filter((f) => f.col.id !== focusColId)]
    : facets;
  const on = Object.values(picked).filter((v) => v.length > 0).length;
  const veil = useVeilClose(onClose);
  return (
    <div className="pb-doc-modal" {...veil}>
      <div className="pb-doc-box pb-qf-box">
        <div className="pb-qf-head">
          <b>칸 값으로 거르기</b>
          <em>{total}건 중 {shownCount}건 표시{on > 0 ? ` · ${on}개 칸에 걸림` : ""}</em>
          <button type="button" className="pb-qf-clear" disabled={on === 0} onClick={onClear}>모두 취소</button>
          <button type="button" className="pb-qf-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="pb-qf-cols">
          {ordered.map((f) => (
            <section key={f.col.id} className="pb-qf-col">
              <b>{f.col.name}</b>
              {f.opts.length === 0 ? <em className="pb-qf-none">값 없음</em> : f.opts.map((o) => {
                const isOn = (picked[f.col.id] || []).includes(o.key);
                return (
                  <button key={o.key} type="button" aria-pressed={isOn}
                    className={`pb-qf-opt ${isOn ? "pb-qf-opt-on" : ""}`}
                    onClick={() => onToggle(f.col.id, o.key)}>
                    {o.color && <i style={{ background: o.color }} />}
                    <span>{o.label}</span>
                    <em>{o.count}</em>
                  </button>
                );
              })}
              {f.more > 0 && <em className="pb-qf-none">그 밖에 {f.more}가지 — 값을 좁히려면 정렬을 쓰세요</em>}
            </section>
          ))}
        </div>
        <p className="pb-qf-foot">같은 칸에서 여럿 고르면 <b>둘 다</b> 보이고, 칸을 여러 개 걸면 <b>모두 맞는 줄</b>만 남습니다.</p>
      </div>
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

// ── 전체 요약 — 프로젝트를 **한 장**으로 (2026-08-07 사장님 지시) ──
//   예전 '정리' 는 표마다 리포트를 통째로 펼쳐, 표가 일곱 개면 일곱 장이 이어졌다.
//   전체 요약이 할 일은 "다 보여 주는 것" 이 아니라 **"어디를 볼지 고르게 하는 것"** 이다.
//     · 맨 위 돈 흐름 한 장(표를 가로지르는 금액)
//     · 그 아래 표마다 한 줄 — 행 수 + 지금 챙길 것 한둘. 누르면 그 표의 '요약' 으로 간다.
function ProjectDigest({ dealId, boards, cols, groups, items, users, activeId, onPickBoard }: {
  /** 광고 표는 표가 아니라 수집해 둔 일별 기록에서 읽는다 — 그래서 프로젝트 id 가 필요하다 */
  dealId: string;
  boards: { id: string; name: string; template_key: string | null }[];
  cols: BoardColumn[]; groups: BoardGroup[]; items: BoardItem[]; users: { id: string; name: string }[];
  activeId: string;
  onPickBoard: (boardId: string) => void;
}) {
  const today = todayKst();
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || "";
  const money = hasMoneyData(boards, cols, items, today);
  if (boards.length === 0) {
    return <p className="pj-sec-empty">표를 하나 만들면 여기에 프로젝트 한 장 요약이 생겨요.</p>;
  }
  //   같은 템플릿을 두 번 쓰면 이름이 같다 — 그때만 그룹 이름을 덧붙여 구분한다
  const dup = new Set(boards.filter((b, i, a) => a.some((o, j) => j !== i && o.name === b.name)).map((b) => b.id));

  return (
    <div className="pb-sum-all">
      {/* 표를 가로지르는 돈이 맨 위 — 표별 줄보다 이게 먼저 읽혀야 한다 */}
      {money && (
        <SummaryReport kicker="프로젝트 전체" title="돈 흐름" meta="표 여러 개에서 모은 금액">
          <ProjectMoneyReport boards={boards} cols={cols} items={items} />
        </SummaryReport>
      )}

      <section className="pb-rep">
        <header className="pb-rep-head">
          <div className="pb-rep-title">
            <span className="pb-rep-kicker">표</span>
            <b>어디를 볼까</b>
            <em>줄을 누르면 그 표의 요약으로 갑니다</em>
          </div>
        </header>
        <div className="pb-dg">
          {boards.map((b) => {
            const bItems = items.filter((i) => i.board_id === b.id);
            const bCols = cols.filter((c) => c.board_id === b.id);
            const chips = boardDigest(bCols, bItems, groups.filter((g) => g.board_id === b.id), nameOf, today);
            const hint = dup.has(b.id)
              ? groups.filter((g) => g.board_id === b.id).map((g) => g.name).slice(0, 2).join(" · ")
              : "";
            return (
              <button key={b.id} type="button" onClick={() => onPickBoard(b.id)}
                className={`pb-dg-row ${b.id === activeId ? "pb-dg-on" : ""}`}>
                <span className="pb-dg-k">
                  <b>{b.name}</b>
                  <em>{[hint, bItems.length > 0 ? `${bItems.length}건` : "아직 빈 표"].filter(Boolean).join(" · ")}</em>
                </span>
                <span className="pb-dg-chips">
                  {chips.map((c: BoardChip) => (
                    <i key={c.text} className={c.tone === "bad" ? "pb-dg-bad" : c.tone === "warn" ? "pb-dg-warn" : ""}>{c.text}</i>
                  ))}
                </span>
                <span className="pb-dg-go">›</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** 리포트 한 장 — 정리의 모든 구획이 이 껍데기를 쓴다.
 *  머리(무엇에 대한 리포트인지)와 몸(지표)이 늘 같은 자리에 있어야 통일감이 생긴다.
 *  (2026-08-05 사장님: "프로젝트별·템플릿별이 따로 노는데 통일감이 있어야 하고,
 *   각 부분마다 별도 리포트로 나뉘어 있으면 좋겠다") */
function SummaryReport({ kicker, title, meta, tools, children }: {
  kicker: string; title: string; meta?: string; tools?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="pb-rep">
      <header className="pb-rep-head">
        <div className="pb-rep-title">
          <span className="pb-rep-kicker">{kicker}</span>
          <b>{title}</b>
          {meta && <em>{meta}</em>}
        </div>
        {tools && <div className="pb-rep-tools">{tools}</div>}
      </header>
      {children}
    </section>
  );
}

/** 요약 카드 하나를 그린다 — 정리 양식이 그림과 섞어 늘어놓으므로 낱개로 뽑아 뒀다 */
function SummaryCardView({ c }: { c: SummaryCard }) {
  if (c.kind === "number") return (
    <div className="pb-sum-card"><span>{c.label} {c.mode === "avg" ? "평균" : "합계"}</span>
      <b>{(c.mode === "avg" ? c.avg : c.sum).toLocaleString("ko-KR")}{c.unit}</b>
      <em>{c.filled}건 입력{c.mode === "avg" ? "" : ` · 평균 ${c.avg.toLocaleString("ko-KR")}${c.unit}`}</em></div>
  );
  if (c.kind === "weighted") return (
    <div className="pb-sum-card"><span>{c.label}</span>
      <b>{c.value.toLocaleString("ko-KR")}원</b>
      <em>{c.a} × {c.b} — 확률까지 반영한 값</em></div>
  );
  if (c.kind === "diff") return (
    <div className="pb-sum-card"><span>{c.label}</span>
      <b className={c.value < 0 ? "pb-sum-bad" : "pb-sum-ok"}>{c.value.toLocaleString("ko-KR")}{c.unit}</b>
      <em>{c.a}에서 {c.b}을 뺀 값</em></div>
  );
  if (c.kind === "status" || c.kind === "group") {
    const total = c.parts.reduce((n, p) => n + p.count, 0) || 1;
    return (
      <div className="pb-sum-card pb-sum-wide"><span>{c.label}</span>
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
    <div className="pb-sum-card"><span>{c.label}</span>
      <b className={c.late > 0 ? "pb-sum-bad" : ""}>{c.late > 0 ? `기한 지난 ${c.late}건` : `이번 주 ${c.soon}건`}</b>
      <em>{c.next ? `다음 ${c.label} ${c.next}` : `예정된 ${c.label} 없음`}{c.late > 0 ? ` · 이번 주 ${c.soon}건` : ""}</em></div>
  );
  return (
    <div className="pb-sum-card pb-sum-wide"><span>{c.label}별 인원</span>
      <b>{c.rows.length}명</b>
      <em>{c.rows.map((r) => `${r.name} ${r.count}건`).join(" · ")}</em></div>
  );
}

// ── 템플릿 하나 — 컬럼 타입만 보고 만든 요약. 값이 없는 항목은 그리지 않는다 ──
//    무엇을 어떤 순서로 볼지는 '정리 양식'이 정한다(2026-08-05 사장님 지시).
function BoardSummary({ boardName, needsHint, templateKey, cols, items, groups, users, presets, onSavePreset, onUpdatePreset, onRemovePreset, onOpenItem }: {
  /** 리포트 머리에 쓸 표 이름 */
  boardName: string;
  /** 같은 이름의 표가 또 있을 때 — 머리에 그룹 이름을 덧붙여 구분한다 */
  needsHint?: boolean;
  templateKey?: string | null;
  cols: BoardColumn[]; items: BoardItem[]; groups: BoardGroup[]; users: { id: string; name: string }[];
  presets?: Preset[];
  onSavePreset?: (name: string, layout: SummaryLayout, templateKey: string | null) => void;
  onUpdatePreset?: (p: Preset, name: string, layout: SummaryLayout) => void;
  onRemovePreset?: (p: Preset) => void;
  onOpenItem?: (itemId: string) => void;
}) {
  //   2026-08-20 재편 (docs/20260820_PLAN_project_summary_redesign.md, 사장님 확정) —
  //   지표 카드 나열 + '어떻게 볼까' 전역 형태 스위치(도구 11개) → 유형별 **정해진 한 장**
  //   (결론 한 문장 → 핵심 숫자 → 대표 그림 → 챙길 것) + **내 지표**(원하는 그림을 원하는 형태로 추가·전환·순서).
  //   정리 양식(presets)·전역 스위치·지표 고르기는 내 지표가 흡수 — 프롭은 호환으로 받기만 한다(다음 정리 때 제거).
  //   캘린더 형태는 요약에서 뺐다(달력은 일정/할 일 메뉴가 본체) — 간트는 일정 유형의 대표 그림으로 남는다.
  void presets; void onSavePreset; void onUpdatePreset; void onRemovePreset;
  const tplKey = templateKey || "blank";
  const [asTable, setAsTable] = useState(false);      // 그림 대신 숫자로 읽기 (색을 못 가르는 눈에도 같은 값)
  const [pickOpen, setPickOpen] = useState(false);    // 내 지표 추가 피커
  const [mineIds, setMineIds] = useState<string[]>([]);
  useEffect(() => {
    try { const raw = JSON.parse(localStorage.getItem(`ov.board.mine.${tplKey}`) || "[]"); setMineIds(Array.isArray(raw) ? raw : []); } catch { setMineIds([]); }
    setPickOpen(false);
  }, [tplKey]);
  //   내 지표 저장 — 사람·브라우저별(localStorage). 기존 sumshape/sumfmt 와 같은 저장 방식('내가 보는 눈'은 나에게만).
  const saveMine = (ids: string[]) => { setMineIds(ids); try { localStorage.setItem(`ov.board.mine.${tplKey}`, JSON.stringify(ids)); } catch { /* 무시 */ } };

  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || "";
  const today = todayKst();

  // ── 유형 판별 — 템플릿 키가 먼저, 커스텀은 칸 타입으로 (돈 > 일정 > 할 일 > 기록) ──
  const flow = flowColumnOf(cols);
  const term = flow ? terminalOptionId(flow) : null;
  const span = spanColumnsOf(cols);
  const dateCols = cols.filter((c) => c.type === "date");
  const dueCol = cols.find((c) => c.type === "date" && !START_DATE_RE.test(c.name)) || null;
  //   금액 칸이 둘일 수 있다(예산·집행) — 예산 칸은 '전체 그릇', 집행(그 외 첫 금액 칸)이 실적이다.
  //   섞어 쓰면 핵심 숫자(예산 기준)와 대표 그림(집행 기준)이 서로 다른 얘기를 한다 (2026-08-20 구현 중 발견).
  const wonCols = cols.filter((c) => c.type === "number" && (c.settings?.unit || "") === "원");
  const budgetCol = wonCols.find((c) => /예산|budget/i.test(c.name)) || null;
  const moneyCol = wonCols.find((c) => c.id !== budgetCol?.id) || budgetCol;
  type SumType = "money" | "task" | "date" | "log";
  const { sumType, typeWhy } = ((): { sumType: SumType; typeWhy: string } => {
    if (["spend", "cost", "budget", "revenue", "pipeline", "billing"].includes(tplKey)) return { sumType: "money", typeWhy: "" };
    if (["todo", "review"].includes(tplKey)) return { sumType: "task", typeWhy: "" };
    if (["schedule", "contract"].includes(tplKey)) return { sumType: "date", typeWhy: "" };
    if (tplKey === "meeting") return { sumType: "log", typeWhy: "" };
    if (moneyCol) return { sumType: "money", typeWhy: "금액 칸이 있어 돈 요약으로 보여드립니다" };
    if (span || dateCols.length >= 2) return { sumType: "date", typeWhy: "날짜 칸이 있어 일정 요약으로 보여드립니다" };
    if (flow) return { sumType: "task", typeWhy: "단계 칸이 있어 할 일 요약으로 보여드립니다" };
    return { sumType: "log", typeWhy: "" };
  })();

  // ── 사실 계산 — 결론·숫자·챙길 것이 같은 값을 쓴다 ──
  const isOpen = (it: BoardItem) => !isDoneRow(it as any, cols as any, groups as any);
  const openItems = items.filter(isOpen);
  const doneCount = items.length - openItems.length;
  const dval = (it: BoardItem) => String((dueCol && it.values?.[dueCol.id]) || "").slice(0, 10);
  const validD = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const overdue = dueCol ? openItems.filter((it) => validD(dval(it)) && dval(it) < today).sort((a, b) => dval(a).localeCompare(dval(b))) : [];
  const weekEnd = addDaysStr(mondayOfStr(today), 7);
  const thisWeek = dueCol ? openItems.filter((it) => validD(dval(it)) && dval(it) >= today && dval(it) < weekEnd).sort((a, b) => dval(a).localeCompare(dval(b))) : [];
  const upcoming = dueCol ? openItems.filter((it) => validD(dval(it)) && dval(it) >= today).sort((a, b) => dval(a).localeCompare(dval(b))) : [];
  const mval = (it: BoardItem) => Number((moneyCol && it.values?.[moneyCol.id]) || 0) || 0;
  const totalMoney = moneyCol ? items.reduce((n, it) => n + mval(it), 0) : 0;
  const openMoney = moneyCol ? openItems.reduce((n, it) => n + mval(it), 0) : 0;
  const dday = (v: string) => Math.round((new Date(v + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 864e5);

  // ── 결론 한 문장 + 핵심 숫자 (유형별) ──
  const shortW = (n: number) => { const v = Math.round(n || 0); if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억`; if (Math.abs(v) >= 1e4) return `${Math.round(v / 1e4).toLocaleString("ko-KR")}만`; return v.toLocaleString("ko-KR"); };
  type StatCell = { l: string; v: string; s?: string; tone?: "warn" | "bad" | "ok" };
  let headline = ""; let why = ""; let stats: StatCell[] = [];
  if (sumType === "money") {
    const budgetTotal = budgetCol && budgetCol.id !== moneyCol?.id ? items.reduce((n, it) => n + (Number(it.values?.[budgetCol.id]) || 0), 0) : 0;
    if (budgetTotal > 0 && moneyCol) {
      //   예산 칸 + 집행 칸 — "예산 대비 얼마나 썼나"가 결론
      const pctUsed = Math.round((totalMoney / budgetTotal) * 100);
      headline = `${budgetCol!.name} ${shortW(budgetTotal)}원 중 ${shortW(totalMoney)}원(${pctUsed}%)을 사용했습니다` + (overdue.length ? ` — ${dueCol?.name || "기한"} 지난 ${overdue.length}건은 오늘 확인이 필요합니다.` : ".");
      why = [`남은 ${budgetCol!.name} ${shortW(Math.max(0, budgetTotal - totalMoney))}원`, thisWeek.length ? `이번 주 ${dueCol?.name || "결제"} ${thisWeek.length}건` : ""].filter(Boolean).join(" · ");
      stats = [
        { l: budgetCol!.name, v: `${shortW(budgetTotal)}원` },
        { l: moneyCol.name, v: `${shortW(totalMoney)}원`, s: `${items.length}건` },
        { l: "남음", v: `${shortW(Math.max(0, budgetTotal - totalMoney))}원` },
        { l: "집행률", v: `${pctUsed}%`, tone: pctUsed >= 90 ? "bad" as const : pctUsed >= 75 ? "warn" as const : undefined },
        ...(dueCol ? [{ l: `${dueCol.name} 지남`, v: `${overdue.length}건`, tone: overdue.length ? "bad" as const : undefined }] : []),
      ];
    } else {
      headline = moneyCol
        ? `${moneyCol.name} 합계 ${shortW(totalMoney)}원 중 ${shortW(totalMoney - openMoney)}원이 끝났습니다` + (overdue.length ? ` — ${dueCol?.name || "기한"} 지난 ${overdue.length}건은 오늘 확인이 필요합니다.` : ".")
        : `${items.length}건이 있습니다.`;
      why = [dueCol && thisWeek.length ? `이번 주 ${dueCol.name} ${thisWeek.length}건` : "", `미완료 ${openItems.length}건 ${moneyCol ? shortW(openMoney) + "원" : ""}`].filter(Boolean).join(" · ");
      stats = [
        ...(moneyCol ? [
          { l: "합계", v: `${shortW(totalMoney)}원` },
          { l: "완료", v: `${shortW(totalMoney - openMoney)}원`, s: `${doneCount}건` },
          { l: "미완료", v: `${shortW(openMoney)}원`, s: `${openItems.length}건` },
        ] : [{ l: "전체", v: `${items.length}건` }]),
        ...(dueCol ? [{ l: `${dueCol.name} 지남`, v: `${overdue.length}건`, tone: overdue.length ? "bad" as const : undefined }, { l: "이번 주", v: `${thisWeek.length}건`, tone: thisWeek.length ? "warn" as const : undefined }] : []),
      ];
    }
  } else if (sumType === "task") {
    headline = `${items.length}건 중 ${doneCount}건이 끝났습니다` + (overdue.length ? ` — 기한 지난 ${overdue.length}건이 밀려 있습니다.` : overdue.length === 0 && dueCol ? " — 기한 지난 건은 없습니다." : ".");
    why = [flow ? `진행 중 ${openItems.length}건` : "", thisWeek.length ? `이번 주 마감 ${thisWeek.length}건` : ""].filter(Boolean).join(" · ");
    stats = [
      { l: "전체", v: `${items.length}건` },
      { l: "완료", v: `${doneCount}건`, s: items.length ? `${Math.round((doneCount / items.length) * 100)}%` : undefined },
      { l: "남음", v: `${openItems.length}건` },
      ...(dueCol ? [{ l: "기한 지남", v: `${overdue.length}건`, tone: overdue.length ? "bad" as const : undefined }, { l: "이번 주 마감", v: `${thisWeek.length}건`, tone: thisWeek.length ? "warn" as const : undefined }] : []),
    ];
  } else if (sumType === "date") {
    const next = upcoming[0] || null;
    headline = `${items.length}건 중 ${doneCount}건이 끝났습니다` + (overdue.length ? ` — 종료가 지난 미완료 ${overdue.length}건이 밀려 있습니다.` : ".");
    why = next ? `다음 ${dueCol?.name || "마감"} ${dval(next).slice(5)} (D-${dday(dval(next))}) · ${next.name}` : "";
    stats = [
      { l: "전체", v: `${items.length}건` },
      { l: "완료", v: `${doneCount}건`, s: items.length ? `${Math.round((doneCount / items.length) * 100)}%` : undefined },
      { l: "지연", v: `${overdue.length}건`, tone: overdue.length ? "bad" as const : undefined, s: "종료 지났는데 미완료" },
      ...(next ? [{ l: `다음 ${dueCol?.name || "마감"}`, v: dday(dval(next)) === 0 ? "오늘" : `D-${dday(dval(next))}`, s: next.name.slice(0, 16) }] : []),
    ];
  } else {
    headline = `기록 ${items.length}건이 있습니다` + (overdue.length ? ` — 후속 기한 지난 ${overdue.length}건이 밀려 있습니다.` : ".");
    why = flow ? "" : "";
    const opts: any[] = (flow?.settings?.options || []) as any[];
    const topStates = opts.map((o) => ({ label: String(o.label), n: items.filter((it) => it.values?.[flow!.id] === o.id).length })).filter((x) => x.n > 0).slice(0, 3);
    stats = [
      { l: "전체", v: `${items.length}건` },
      ...topStates.map((x) => ({ l: x.label, v: `${x.n}건` })),
      ...(dueCol ? [{ l: "기한 지남", v: `${overdue.length}건`, tone: overdue.length ? "bad" as const : undefined }] : []),
    ];
  }

  // ── 그림 재료 — 기존 빌더 그대로 (자동 + 도넛 + 막대 + 선), id 로 합친다 ──
  const auto = templateFigures(tplKey, cols, items, groups, nameOf, today);
  const poolFigs: Figure[] = [...auto.figures];
  for (const sh of ["donut", "bars", "line"] as const) {
    for (const f of shapeFigures(sh, cols, items, groups, nameOf, today).figures) {
      if (!poolFigs.some((x) => x.id === f.id)) poolFigs.push(f);
    }
  }
  const cards: SummaryCard[] = buildBoardSummary(cols, items, groups, nameOf, today);
  type Piece = { id: string; title: string; kind: string; node: ReactNode };
  const pool: Piece[] = [
    ...poolFigs.map((f) => ({ id: f.id, title: f.title, kind: f.kind, node: <BoardFigure f={f} table={asTable} /> })),
    ...cards.map((c) => ({ id: `card:${summaryCardKey(c)}`, title: c.label, kind: "card", node: <SummaryCardView c={c} /> })),
  ];

  // ── 대표 그림 — 유형별 하나 (일정은 타임라인) ──
  const heroFig = sumType === "date" ? null
    : sumType === "log" ? null
    : (() => {
      const rank = sumType === "money" ? ["hbars", "donut", "weeks", "line", "ring"] : ["hbars", "ring", "donut", "weeks", "line"];
      for (const k of rank) { const f = auto.figures.find((x) => x.kind === k); if (f) return f; }
      return auto.figures[0] || null;
    })();
  const hero = sumType === "date" && span
    ? <BoardTimeline items={items} span={span} flowCol={flow} nameLabel="행" />
    : heroFig ? <BoardFigure f={heroFig} table={asTable} /> : null;

  // ── 챙길 것 — 지남 → 이번 주 → 고액(돈) / 다가오는(일정) 순, 8줄 컷. 줄 클릭 = 그 행 열기 ──
  type Todo = { tag: string; tone: "bad" | "warn" | "dim"; text: string; right: string; itemId: string };
  const todos: Todo[] = [];
  for (const it of overdue) todos.push({ tag: sumType === "date" ? "지연" : "지남", tone: "bad", text: `${it.name}${dueCol ? ` — ${dueCol.name} ${dval(it).slice(5)}` : ""}`, right: moneyCol && mval(it) ? `${shortW(mval(it))}원` : `D+${-dday(dval(it))}`, itemId: it.id });
  for (const it of thisWeek) todos.push({ tag: "이번 주", tone: "warn", text: `${it.name}${dueCol ? ` — ${dval(it).slice(5)}` : ""}`, right: moneyCol && mval(it) ? `${shortW(mval(it))}원` : (dday(dval(it)) === 0 ? "오늘" : `D-${dday(dval(it))}`), itemId: it.id });
  if (sumType === "money" && moneyCol) {
    const used = new Set(todos.map((t) => t.itemId));
    for (const it of [...openItems].sort((a, b) => mval(b) - mval(a)).filter((it) => mval(it) > 0 && !used.has(it.id)).slice(0, 3)) {
      todos.push({ tag: "고액", tone: "dim", text: it.name, right: `${shortW(mval(it))}원`, itemId: it.id });
    }
  }
  if (sumType === "date") {
    const used = new Set(todos.map((t) => t.itemId));
    for (const it of upcoming.filter((it) => !used.has(it.id)).slice(0, 3)) {
      todos.push({ tag: "예정", tone: "dim", text: `${it.name} — ${dval(it).slice(5)}`, right: `D-${dday(dval(it))}`, itemId: it.id });
    }
  }
  const todoCut = todos.slice(0, 8);

  // ── 내 지표 — 카드마다 형태 전환(같은 제목의 다른 그림이 있을 때만) ──
  const KIND_SHAPE: Record<string, SummaryShape> = { donut: "donut", hbars: "bars", weeks: "bars", line: "line" };
  const shapeOf = (title: string, want: "donut" | "bars" | "line") =>
    pool.find((x) => x.title === title && (KIND_SHAPE[x.kind] === want));
  const minePieces = mineIds.map((id) => pool.find((x) => x.id === id)).filter(Boolean) as Piece[];
  const addable = pool.filter((x) => !mineIds.includes(x.id) && x.id !== heroFig?.id);
  const KIND_LABEL: Record<string, string> = { donut: "도넛", hbars: "막대", weeks: "주별", line: "선", ring: "링", stat: "숫자", card: "숫자" };
  const moveMine = (i: number, d: number) => { const next = [...mineIds]; const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; saveMine(next); };
  const swapMine = (i: number, id: string) => { const next = [...mineIds]; next[i] = id; saveMine(next); };

  //   [표로] = 그림(도넛·막대·선)을 숫자 표로 바꿔 읽는 토글(색을 못 가르는 눈에도 같은 값).
  //   기록 유형(대표 그림 없음)·타임라인은 바꿀 그림이 없어 **버튼이 아무 일도 안 했다** (2026-08-20 사장님 제보)
  //   → 토글이 먹는 그림이 하나라도 있을 때만 버튼을 보인다.
  const tableTargets = (heroFig ? 1 : 0) + minePieces.filter((x) => x.kind !== "card").length;
  const tools = tableTargets === 0 ? undefined : (
    <div className="pb-fmt">
      <button type="button" className={`pb-fmt-btn ${asTable ? "pb-fmt-on" : ""}`}
        onClick={() => setAsTable((v) => !v)} title="도넛·막대 그림을 숫자 표로 바꿔 읽습니다">{asTable ? "그림으로" : "표로"}</button>
    </div>
  );

  const hint = needsHint ? groups.map((g) => g.name).filter(Boolean).slice(0, 2).join(" · ") : "";
  const TYPE_LABEL: Record<SumType, string> = { money: "돈", task: "할 일", date: "일정", log: "기록" };
  const meta = items.length === 0 ? "아직 채운 값이 없습니다"
    : [hint, `${items.length}행`, `${TYPE_LABEL[sumType]} 요약`, typeWhy].filter(Boolean).join(" · ");

  return (
    <SummaryReport kicker="템플릿" title={boardName} meta={meta} tools={items.length === 0 ? undefined : tools}>
      {items.length === 0 ? (
        <p className="pj-sec-empty">값을 채우면 여기에 결론 · 핵심 숫자 · 챙길 것이 자동으로 정리됩니다.</p>
      ) : (
        <>
          {/* ① 결론 한 문장 */}
          <div className="pbsum-concl"><b>{headline}</b>{why && <span className="pbsum-why">{why}</span>}</div>
          {/* ② 핵심 숫자 */}
          <div className="pbsum-stats">
            {stats.map((c) => (
              <div key={c.l} className="pbsum-stat">
                <span className="pbsum-stat-l">{c.l}{c.tone && <em className={`pbsum-tone pbsum-tone-${c.tone}`}>{c.tone === "bad" ? "확인" : "임박"}</em>}</span>
                <span className={`pbsum-stat-v mono-number ${c.tone === "bad" ? "text-[var(--danger)]" : ""}`}>{c.v}</span>
                {c.s && <span className="pbsum-stat-s">{c.s}</span>}
              </div>
            ))}
          </div>
          {/* ③ 대표 그림 + ④ 챙길 것 */}
          <div className={`pbsum-body ${hero ? "" : "pbsum-body-1"}`}>
            {hero && <div className="pbsum-hero">{hero}</div>}
            <div className="pbsum-todo">
              <h5>챙길 것 {todos.length > 0 && <span className="pbsum-todo-n mono-number">{todos.length}</span>}<small>— 누르면 그 행이 열립니다</small></h5>
              {todoCut.length === 0 ? (
                <p className="pbsum-todo-empty">지금 챙길 것이 없습니다 — 기한 지남 · 이번 주 마감이 생기면 여기에 떠요.</p>
              ) : (
                <ul>
                  {todoCut.map((t) => (
                    <li key={t.itemId + t.tag}>
                      <button type="button" onClick={() => onOpenItem?.(t.itemId)}>
                        <em className={`pbsum-tag pbsum-tag-${t.tone}`}>{t.tag}</em>
                        <span className="pbsum-todo-t">{t.text}</span>
                        <span className="pbsum-todo-r mono-number">{t.right}</span>
                      </button>
                    </li>
                  ))}
                  {todos.length > todoCut.length && <li className="pbsum-todo-more">외 {todos.length - todoCut.length}건 — 표에서 보세요</li>}
                </ul>
              )}
            </div>
          </div>
          {/* ⑤ 내 지표 — 내가 골라 붙인 그림. 형태는 카드마다, 나에게만 저장 */}
          <div className="pbsum-mine">
            <div className="pbsum-mine-h">
              <b>내 지표</b>
              <span>내가 골라 붙인 그림 · 형태는 카드마다 · 나에게만 저장</span>
              <span className="flex-1" />
              <span className="relative inline-block">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setPickOpen((v) => !v)}>＋ 지표 추가</button>
                {pickOpen && (
                  <div className="pbsum-picker">
                    <div className="pbsum-picker-h">이 표의 칸으로 만들 수 있는 그림</div>
                    {addable.length === 0 ? <p className="pbsum-todo-empty">더 붙일 그림이 없습니다.</p> : (
                      <div className="pbsum-picker-list">
                        {addable.map((x) => (
                          <button key={x.id} type="button" onClick={() => { saveMine([...mineIds, x.id]); setPickOpen(false); }}>
                            {x.title} <small>{KIND_LABEL[x.kind] || koFallback(x.kind)}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </span>
            </div>
            {minePieces.length === 0 ? (
              <p className="pbsum-todo-empty">＋ 지표 추가로 보고 싶은 그림(도넛·막대·선·숫자)을 붙여 두세요.</p>
            ) : (
              <div className="bf-grid">
                {minePieces.map((x, i) => (
                  <div key={x.id} className="pbsum-mfig">
                    <div className="pbsum-mfig-tools">
                      <button type="button" onClick={() => moveMine(i, -1)} disabled={i === 0} title="앞으로">‹</button>
                      <button type="button" onClick={() => moveMine(i, 1)} disabled={i === minePieces.length - 1} title="뒤로">›</button>
                      {(["donut", "bars", "line"] as const).map((sh) => {
                        const alt = shapeOf(x.title, sh);
                        const on = KIND_SHAPE[x.kind] === sh;
                        if (!alt && !on) return null;
                        return (
                          <button key={sh} type="button" className={on ? "pbsum-sh-on" : ""} disabled={on || !alt}
                            onClick={() => alt && swapMine(i, alt.id)} title={`${sh === "donut" ? "도넛" : sh === "bars" ? "막대" : "선"}으로 보기`}>
                            <ShapeIcon kind={sh} />
                          </button>
                        );
                      })}
                      <button type="button" onClick={() => saveMine(mineIds.filter((id) => id !== x.id))} title="빼기">✕</button>
                    </div>
                    {x.node}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </SummaryReport>
  );
}

/** 보기 아이콘 — 글자보다 그림이 빠르다(2026-08-05 사장님 지시).
 *  선 굵기·크기를 한 규격으로 맞춰 한 줄에 놓았을 때 무게가 같아 보이게 한다. */
function ShapeIcon({ kind }: { kind: SummaryShape }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {kind === "auto" && (<>
        {/* 자동 — 반짝임(무엇을 그릴지 알아서 고른다) */}
        <path {...p} d="M8 2.5l1.1 2.9L12 6.5 9.1 7.6 8 10.5 6.9 7.6 4 6.5l2.9-1.1z" />
        <path {...p} d="M12.5 10.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" />
      </>)}
      {kind === "gantt" && (<>
        {/* 간트 — 시작이 어긋난 가로 막대 */}
        <rect {...p} x="2" y="3" width="7" height="2.4" rx="1.2" />
        <rect {...p} x="5" y="6.8" width="8" height="2.4" rx="1.2" />
        <rect {...p} x="3.5" y="10.6" width="6" height="2.4" rx="1.2" />
      </>)}
      {kind === "calendar" && (<>
        <rect {...p} x="2.2" y="3.2" width="11.6" height="10.6" rx="2" />
        <path {...p} d="M2.2 6.4h11.6M5.4 2v2.4M10.6 2v2.4" />
        <path {...p} d="M5.2 9.2h1.6M9.2 9.2h1.6M5.2 11.6h1.6" />
      </>)}
      {kind === "donut" && (<>
        <circle {...p} cx="8" cy="8" r="5.6" />
        <circle {...p} cx="8" cy="8" r="2.1" />
        <path {...p} d="M8 2.4v3.5M12.9 10.7l-3-1.7" />
      </>)}
      {kind === "bars" && (<>
        <path {...p} d="M2.6 13.4h10.8" />
        <rect {...p} x="3.4" y="8.4" width="2.6" height="4" rx="0.8" />
        <rect {...p} x="6.9" y="5.4" width="2.6" height="7" rx="0.8" />
        <rect {...p} x="10.4" y="3.2" width="2.6" height="9.2" rx="0.8" />
      </>)}
      {kind === "line" && (<>
        <path {...p} d="M2.4 13.2h11.2" />
        <path {...p} d="M3 10.6l3-3.4 2.6 2.2 4.4-5" />
        <circle cx="6" cy="7.2" r="1.05" fill="currentColor" />
        <circle cx="8.6" cy="9.4" r="1.05" fill="currentColor" />
      </>)}
      {kind === "cards" && (<>
        <rect {...p} x="2.2" y="3.4" width="11.6" height="9.2" rx="2" />
        <path {...p} d="M4.8 7h4.2M4.8 9.8h6.4" />
      </>)}
    </svg>
  );
}

/** 정리 구성 — 무엇을 켜고 어떤 순서로 볼지. 고른 결과는 회사 양식으로 저장한다.
 *  저장해 둔 양식을 고른 상태면 **덮어쓰기(수정)** 와 **삭제**를 여기서 한다
 *  (2026-08-05 사장님: "양식이 설정되면 수정·삭제가 안 된다"). */
function SummaryFormatDialog({ all, layout, presetName, canRemove, onApply, onUpdate, onRemove, onClose }: {
  all: { id: string; title: string }[]; layout: SummaryLayout | null; presetName: string | null;
  canRemove: boolean; onApply: (next: SummaryLayout) => void;
  /** 고른 양식을 이 구성으로 덮어쓴다 — 새 양식이 늘어나지 않게 */
  onUpdate?: (next: SummaryLayout) => void;
  onRemove: () => void; onClose: () => void;
}) {
  const [rows, setRows] = useState(() => {
    const ordered = applyLayout(all, layout);
    const off = new Set(layout?.off || []);
    const rest = all.filter((a) => off.has(a.id));
    return [...ordered.map((a) => ({ ...a, on: true })), ...rest.map((a) => ({ ...a, on: false }))];
  });
  const move = (i: number, d: -1 | 1) => setRows((prev) => {
    const j = i + d;
    if (j < 0 || j >= prev.length) return prev;
    const n = [...prev];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const veil = useVeilClose(onClose);

  return (
    <div className="pb-doc-modal" {...veil}>
      <div className="pb-doc-box pb-fmt-box">
        <b className="pb-fmt-h">정리 구성{presetName ? ` — ${presetName}` : ""}</b>
        <em className="pb-fmt-hint">켠 것만 위에서부터 그려집니다 · 나중에 새 지표가 생기면 켜진 채 뒤에 붙습니다</em>
        <ul className="pb-fmt-rows">
          {rows.map((r, i) => (
            <li key={r.id} className={r.on ? "" : "pb-fmt-offrow"}>
              <label>
                <input type="checkbox" checked={r.on}
                  onChange={(e) => setRows((prev) => prev.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} />
                {r.title}
              </label>
              <button type="button" title="위로" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" title="아래로" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
            </li>
          ))}
        </ul>
        <span className="pb-fmt-foot">
          {canRemove && <button type="button" className="pb-fmt-del" onClick={onRemove}>이 양식 삭제</button>}
          <button type="button" onClick={onClose}>취소</button>
          <button type="button"
            onClick={() => onApply(layoutFrom(all, rows.filter((r) => r.on).map((r) => r.id)))}>
            {onUpdate ? "새로 저장" : "양식으로 저장"}
          </button>
          {/* 고른 양식이 있으면 덮어쓰기가 기본 — 고칠 때마다 양식이 늘어나면 목록이 못 쓰게 된다 */}
          {onUpdate && (
            <button type="button" className="pb-fmt-go"
              onClick={() => onUpdate(layoutFrom(all, rows.filter((r) => r.on).map((r) => r.id)))}>
              이 양식 수정
            </button>
          )}
        </span>
      </div>
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
        onKeyDown={(e) => { fillKey(e); if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
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
      onKeyDown={(e) => { fillKey(e); if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
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
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { if (matches.length === 1 && !q.trim()) return; if (!exact && q.trim()) createNow(); else if (matches[0]) { onSave(matches[0].id); setOpen(false); } }
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
        {matches.length === 0 && !q.trim() && <span className="pb-partner-none">등록된 거래처가 없습니다</span>}
      </span>
    </span>
  );
}
