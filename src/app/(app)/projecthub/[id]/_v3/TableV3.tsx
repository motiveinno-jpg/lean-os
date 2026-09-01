"use client";

// 프로젝트 v3 — 먼데이식 표 입력 (2026-08-31 결정 130·124·132, docs/20260831_PLAN_projecthub_v3_impl.md 1단계)
//
//   사장님 확정: "입력은 기본적인 형태로 먼데이 형태로 — 처음 들어갔을 때부터. 간트·칸반은 보는 형태일 뿐."
//   프로젝트에 들어오면 이 표가 먼저다. 표가 곧 입력이다:
//   · 그룹 = 상태(단계) 색 띠 — 결정 132: 상태=단계=색 라벨 한 축 (deals.item_stages)
//   · 그룹마다 인라인 ＋줄(치고 Enter), 셀 클릭 즉시 편집, 상태 셀은 색 팔레트
//   · 커스텀 컬럼(project_item_columns) — 오른쪽 ＋로 추가, 값은 project_items.fields[key]
//   · 숫자 컬럼은 아래 합계 줄
//   데이터 모델은 v2.6(project_items)을 그대로 승계 — 이 파일은 화면만 바꾼다(결정 131·133).
//   feature_on('projecthub_v3') 게이트 뒤에서만 렌더. 칸반 보기는 ＋보기로 켠다(2026-08-31 사장님
//   "목업대로 안 보인다" — 2단계 예정을 앞당김). 서랍·기록·기능 토글·간트는 2~3단계.

import { useMemo, useRef, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { logRead } from "@/lib/log-read";
import { friendlyError } from "@/lib/friendly-error";
import { getCompanyUsers } from "@/lib/queries";
import { stagesOf, FIELD_TYPES, type ItemStage, type FieldType } from "@/lib/project-items";
import { TEMPLATES, TPL_CATEGORIES, MY_TPL_CAT, type Tpl } from "./templates";
import { evalFormula, type FormulaResult } from "./formula";
import { downloadStoredFile } from "@/lib/file-storage";
import { buildQuoteContent, buildContractContent, insertDocument } from "@/lib/documents";
import { BoardDocModal, type DocKind } from "../_components/BoardDocModal";
import { exportToExcel } from "@/lib/excel-export";
import { xNum, isDate, type ExcelColumn, type ExcelRow } from "@/lib/excel-io";
import { ExcelUploadDialog, type ParseResult } from "@/app/(app)/inventory/_components/excel-upload";
import type { ItemRow } from "./HubV3";

const db = supabase as any;

/** 단계 색 이름 → 실제 색 (v2.6 ItemStage.color 5종) */
const STAGE_HEX: Record<ItemStage["color"], string> = {
  gray: "#9aa0b5", indigo: "#5559DF", orange: "#FDAB3D", green: "#00C875", red: "#E2445C",
};
const KIND_CHIP: Record<string, { label: string; cls: string }> = {
  todo: { label: "할 일", cls: "text-[var(--primary)] bg-[var(--primary)]/10" },
  money: { label: "돈", cls: "text-emerald-600 bg-emerald-500/10" },
  note: { label: "메모", cls: "text-amber-600 bg-amber-500/10" },
};

export type ColumnDef = {
  id: string; deal_id: string; key: string; name: string; type: FieldType;
  settings: { options?: { id: string; label: string; color?: string }[] } | null;
  position: number; archived_at: string | null;
};
type UserRow = { id: string; name: string | null; email: string | null };

/** 떠 있는 선택 팝 — 상태 팔레트·담당·선택지·컬럼 추가가 같은 그릇을 쓴다 */
type Pop =
  | { kind: "status"; itemId: string; x: number; y: number }
  | { kind: "person"; itemId: string; colKey?: string; x: number; y: number }
  | { kind: "partner"; itemId: string; colKey: string; x: number; y: number }
  | { kind: "select"; itemId: string; colKey: string; x: number; y: number }
  | { kind: "addcol"; x: number; y: number }
  | { kind: "addview"; x: number; y: number }
  | { kind: "follower"; itemId: string; x: number; y: number }
  | { kind: "addcal"; date: string; x: number; y: number }
  | { kind: "excel"; x: number; y: number }
  | { kind: "longtext"; itemId: string; colKey: string; x: number; y: number }
  | { kind: "formula"; colKey: string; x: number; y: number }
  | { kind: "files"; itemId: string; colKey: string; x: number; y: number }
  | { kind: "ovlink"; itemId: string; colKey: string; x: number; y: number }
  | { kind: "features"; x: number; y: number }
  | { kind: "bulkstatus"; x: number; y: number; up?: boolean }
  | { kind: "bulkassign"; x: number; y: number; up?: boolean };

export function TableV3() {
  const params = useParams();
  const dealId = String(params?.id || "");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();
  const companyId = user?.company_id ?? null;

  // ── 데이터 (v2.6 훅 패턴 승계 — 쿼리 키는 분리해 화면끼리 안 엮이게) ──
  const { data: deal, isLoading: dealLoading } = useQuery({
    queryKey: ["pjv3-deal", dealId],
    enabled: !!dealId,
    queryFn: async () => logRead("pjv3:deal", await db.from("deals")
      .select("id, name, company_id, stage, start_date, end_date, item_stages, v3_views, v3_builtin, v3_features")
      .eq("id", dealId).maybeSingle()),
  });
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["pjv3-items", dealId],
    enabled: !!dealId,
    queryFn: async () => (logRead("pjv3:items", await db.from("project_items")
      .select("*").eq("deal_id", dealId).is("archived_at", null)
      .order("position").order("created_at")) || []) as ItemRow[],
  });
  const { data: cols = [] } = useQuery({
    queryKey: ["pjv3-cols", dealId],
    enabled: !!dealId,
    queryFn: async () => (logRead("pjv3:cols", await db.from("project_item_columns")
      .select("*").eq("deal_id", dealId).is("archived_at", null)
      .order("position").order("created_at")) || []) as ColumnDef[],
  });
  const { data: users = [] } = useQuery({
    queryKey: ["pjv3-users", companyId],
    enabled: !!companyId,
    queryFn: () => getCompanyUsers(companyId!) as Promise<UserRow[]>,
  });
  //   거래처 칸 검색 피커 (2026-09-01 사장님: "거래처 검색 안 됨" — 2단계 예정이던 스텁을 앞당김)
  const { data: partners = [] } = useQuery({
    queryKey: ["pjv3-partners", companyId],
    enabled: !!companyId,
    staleTime: 300_000,
    queryFn: async () => (logRead("pjv3:partners", await db.from("partners")
      .select("id, name").eq("company_id", companyId!).eq("is_active", true).order("name").limit(500)) || []) as { id: string; name: string }[],
  });
  const [partnerQ, setPartnerQ] = useState("");
  //   담당·팔로워 팝도 거래처처럼 검색해 고른다(2026-09-01 사장님 "사원 수 많으면 스크롤로 못 찾는다")
  const [personQ, setPersonQ] = useState("");

  const stages = useMemo(() => stagesOf(deal?.item_stages), [deal?.item_stages]);
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name || "";

  // ── 검색 — 구분(kind) 칩 줄은 뺐다: v2.6 탭과 똑같이 생겨 "옛 화면 아니냐" 혼란을 줬다
  //   (2026-08-31 사장님 지적). 돈·메모 구분은 2단계 서랍·보기에서 다룬다.
  const [q, setQ] = useState("");
  // ── 하위 작업(2026-09-01 사장님) — parent_id(v2.6 모델)로. 표·칸반·합계는 최상위 기준,
  //   하위는 ▸ 펼침으로 부모 아래 들여서. 금액·숫자는 부모 셀에 '총(자기+하위 합)' ──
  const childrenOf = useMemo(() => {
    const m = new Map<string, ItemRow[]>();
    for (const it of items) {
      const p = (it as any).parent_id as string | null;
      if (p) (m.get(p) ?? m.set(p, []).get(p)!).push(it);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return m;
  }, [items]);
  const shown = useMemo(() => items.filter((it) => {
    if ((it as any).parent_id) return false; // 하위는 부모 아래에서만
    if (!q.trim()) return true;
    const kids = childrenOf.get(it.id) || [];
    const hay = [it.name, ...assigneesOf(it).map(userName), ...(it.tags || []),
      ...kids.map((k) => k.name),
      ...Object.values(it.fields || {}).map((v) => String(v ?? ""))].join(" ").toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [items, q, users, childrenOf]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  /** 하위 포함 총액 — 하위가 없으면 null(직접 값 그대로 쓰라는 뜻) */
  const rollNum = (it: ItemRow, get: (x: ItemRow) => number) => {
    const kids = childrenOf.get(it.id);
    if (!kids?.length) return null;
    return get(it) + kids.reduce((s, k) => s + get(k), 0);
  };
  const addSubItem = async (parent: ItemRow, name: string) => {
    const kids = childrenOf.get(parent.id) || [];
    //   만들 때는 부모 값을 복사(사장님: "복사는 하되 자유자재로 수정") — 이후엔 완전 독립.
    //   금액·숫자·날짜류는 비운다: 부모 금액을 복사하면 총액이 이중으로 부풀고, 날짜는 하위마다 다르다.
    const copyFields: Record<string, unknown> = {};
    for (const c of cols) {
      if (["number", "formula", "auto", "files", "date"].includes(c.type)) continue;
      const v = (parent.fields || {})[c.key];
      if (v != null) copyFields[c.key] = v;
    }
    const { error } = await db.from("project_items").insert({
      company_id: companyId, deal_id: dealId, kind: "todo", name,
      status: parent.status, parent_id: parent.id,
      assignee_id: parent.assignee_id, assignee_ids: (parent as any).assignee_ids || [], fields: copyFields,
      position: (kids[kids.length - 1]?.position ?? 0) + 1, created_by: user?.id ?? null,
    });
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
  };
  const byStage = useMemo(() => {
    const m = new Map<string, ItemRow[]>();
    for (const s of stages) m.set(s.id, []);
    const etc: ItemRow[] = [];
    for (const it of shown) (m.get(it.status) ?? etc).push(it);
    return { m, etc };
  }, [shown, stages]);

  // ── ＋ 기능(2026-09-01 오두 갭 1차) — 반복·앞뒤 순서는 켠 프로젝트에서만. 팀 공유(deals.v3_features) ──
  const features: string[] = Array.isArray(deal?.v3_features) ? deal.v3_features : [];
  const featOn = (k: "recur" | "deps" | "billing" | "survey") => features.includes(k);
  //   토글 결과와 '어디에 생겼는지'를 바로 말해준다 — 안 그러면 눌러도 달라진 게 없어 보인다(2026-09-01 사장님)
  const FEAT_ON_MSG: Record<string, string> = {
    recur: "'반복 작업'을 켰습니다 — 줄 '열기' 서랍에 반복 설정이 생겼습니다",
    deps: "'앞뒤 순서'를 켰습니다 — 줄 '열기' 서랍에 '앞 작업' 설정이 생겼습니다",
    billing: "'견적·청구'를 켰습니다 — 줄에 ₩ 버튼이 생겼고, 누르면 견적부터 입금까지 처리합니다",
    survey: "'설문 발송'을 켰습니다 — 위 조회 줄에 '설문' 버튼이 생겼습니다",
  };
  const toggleFeature = async (k: string) => {
    const turningOn = !features.includes(k);
    const next = turningOn ? [...features, k] : features.filter((x) => x !== k);
    const { error } = await db.from("deals").update({ v3_features: next }).eq("id", dealId);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-deal", dealId] });
    toast(turningOn ? (FEAT_ON_MSG[k] || "켰습니다") : "껐습니다 — 이 프로젝트에서만 빠지고, 쓰던 값은 남아 있습니다", "success");
  };

  //   반복 — 완료(마지막 그룹)로 옮기는 순간 다음 줄을 만들어 준다(만들어만 주고, 지우는 건 사람)
  const nextRecurDue = (rec: { freq?: string; weekday?: number }, fromDue: string | null): string => {
    const base = fromDue ? new Date(fromDue) : new Date();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (base < today) base.setTime(today.getTime());
    const d = new Date(base);
    if (rec.freq === "daily") d.setDate(d.getDate() + 1);
    else if (rec.freq === "monthly") d.setMonth(d.getMonth() + 1);
    else { // weekly
      const wd = rec.weekday ?? 1;
      d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7 || 7));
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  //   앞 작업 경고 — 첫 시도는 막고 알려주고, 곧바로 다시 누르면 그대로 진행(강제 아님)
  const depWarnRef = useRef<string | null>(null);

  // ── 저장 — 셀 하나가 곧 저장 단위(표가 입력이다) ──
  const saveItem = async (id: string, patch: Record<string, unknown>) => {
    const cur = items.find((x) => x.id === id);
    const lastStageId = stages[stages.length - 1]?.id;
    const movingToDone = typeof patch.status === "string" && patch.status === lastStageId && cur?.status !== lastStageId;
    //   앞 작업이 안 끝났는데 완료로 — 한 번 알리고, 다시 누르면 통과
    if (movingToDone && featOn("deps") && (cur as any)?.after_id) {
      const after = items.find((x) => x.id === (cur as any).after_id);
      if (after && after.status !== lastStageId && depWarnRef.current !== id) {
        depWarnRef.current = id;
        setTimeout(() => { if (depWarnRef.current === id) depWarnRef.current = null; }, 5000);
        toast(`앞 작업 '${after.name}' 이(가) 아직 안 끝났어요 — 그래도 옮기려면 한 번 더 누르세요`, "error");
        return false;
      }
      depWarnRef.current = null;
    }
    const { error } = await db.from("project_items")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(friendlyError(error), "error"); return false; }
    //   반복 — 완료로 옮겼고 반복 설정이 있으면 다음 줄 생성(반복 설정은 새 줄이 이어받는다)
    const rec = (cur as any)?.recurrence as { freq?: string; weekday?: number } | null;
    if (movingToDone && featOn("recur") && rec?.freq && cur) {
      const due = nextRecurDue(rec, cur.due_date);
      const firstStage = stages[0]?.id || cur.status;
      await db.from("project_items").insert({
        company_id: companyId, deal_id: dealId, kind: cur.kind, name: cur.name,
        status: firstStage, assignee_id: cur.assignee_id, assignee_ids: (cur as any).assignee_ids || [], due_date: due,
        fields: cur.fields || {}, recurrence: rec, parent_id: (cur as any).parent_id ?? null,
        position: (cur.position ?? 0) + 0.5, created_by: user?.id ?? null,
      });
      await db.from("project_items").update({ recurrence: null }).eq("id", id);
      toast(`반복 — 다음 '${due.slice(5).replace("-", "/")}' 줄을 만들었습니다`, "success");
    }
    //   상태 변경은 기록(채터)에 log 로 남긴다 — 댓글과 한 줄기(결정 113). 실패해도 저장은 유효
    if (typeof patch.status === "string") {
      const from = items.find((x) => x.id === id)?.status;
      if (from && from !== patch.status) {
        const lbl = (sid: string) => stages.find((s) => s.id === sid)?.label || sid;
        await db.from("project_item_events").insert({
          company_id: companyId, item_id: id, kind: "log",
          body: `상태: ${lbl(from)} → ${lbl(patch.status)}`, created_by: user?.id ?? null,
        });
        qc.invalidateQueries({ queryKey: ["pjv3-events", id] });
      }
    }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    return true;
  };
  const saveField = (it: ItemRow, key: string, value: unknown) =>
    saveItem(it.id, { fields: { ...(it.fields || {}), [key]: value === "" ? null : value } });

  //   다중 담당(2026-09-01 사장님 "담당자가 여러 명일 수도") — assignee_ids 가 전체,
  //   assignee_id 는 대표(배열 첫 명) 규약. 목록·내 작업·엑셀은 대표를 계속 읽어 파급이 없다.
  const assigneesOf = (it: ItemRow): string[] => {
    const a = ((it as any).assignee_ids || []) as string[];
    return a.length > 0 ? a : (it.assignee_id ? [it.assignee_id] : []);
  };
  const assigneeLabel = (it: ItemRow): string => {
    const names = assigneesOf(it).map(userName).filter(Boolean);
    return names.length === 0 ? "" : names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}`;
  };
  const toggleAssignee = (it: ItemRow, uid: string) => {
    const cur = assigneesOf(it);
    const next = cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid];
    saveItem(it.id, { assignee_ids: next, assignee_id: next[0] ?? null });
  };
  const addItem = async (stageId: string, name: string, due?: string) => {
    const group = byStage.m.get(stageId) || [];
    const { error } = await db.from("project_items").insert({
      company_id: companyId, deal_id: dealId, kind: "todo",
      name, status: stageId, position: (group[group.length - 1]?.position ?? 0) + 1,
      due_date: due ?? null,
      created_by: user?.id ?? null,
    });
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
  };
  const addColumn = async (name: string, type: FieldType, settings?: Record<string, unknown>) => {
    const { error } = await db.from("project_item_columns").insert({
      company_id: companyId, deal_id: dealId, key: name, name, type,
      settings: settings ?? (type === "select" ? { options: [] } : {}),
      position: (cols[cols.length - 1]?.position ?? 0) + 1,
    });
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-cols", dealId] });
    toast(`'${name}' 컬럼을 추가했습니다 — 셀을 눌러 바로 채우세요`, "success");
  };

  // ── 보기 — 표가 기본(결정 130), 칸반은 ＋보기로 추가한 '보는 형태'.
  //   추가 상태는 임시로 브라우저에 기억(3단계에서 deals.v3_views 로 팀 공유 저장 — 결정 129) ──
  //   보기 구성은 deals.v3_views 로 팀 공유(결정 129 — 2026-09-01 localStorage 임시분 대체.
  //   임시 저장분은 승계하지 않는다: 하루짜리였고, 팀 공유가 원칙). 지금 보는 보기(curView)는
  //   기억하지 않는다 — 조회값 자동 기억 금지, 기본은 표.
  const VIEW_LABELS: Record<string, string> = { kanban: "칸반", calendar: "캘린더", gantt: "간트" };
  const [views, setViews] = useState<string[]>([]);
  const [curView, setCurView] = useState<"table" | "kanban" | "calendar" | "gantt">("table");
  useEffect(() => {
    if (Array.isArray(deal?.v3_views)) setViews(deal.v3_views.filter((v: unknown) => typeof v === "string"));
  }, [deal?.v3_views]);
  const persistViews = async (next: string[]) => {
    setViews(next);
    const { error } = await db.from("deals").update({ v3_views: next }).eq("id", dealId);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-deal", dealId] });
  };
  const addView = (v: "kanban" | "calendar" | "gantt") => {
    setCurView(v); setPop(null);
    if (!views.includes(v)) persistViews([...views, v]);
  };
  const removeView = (v: string) => {
    if (curView === v) setCurView("table");
    persistViews(views.filter((x) => x !== v));
  };

  // ── 간트 보기 — 시작일~마감일 막대(둘 중 하나만 있으면 하루짜리). 날짜 범위는 항목에서 자동 ──
  const gantt = useMemo(() => {
    const dated = shown.filter((it) => it.due_date || (it as any).start_date);
    const ds = dated.flatMap((it) => [(it as any).start_date, it.due_date].filter(Boolean) as string[]);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const min = ds.length ? new Date(ds.reduce((a, b) => (a < b ? a : b))) : new Date(today);
    let max = ds.length ? new Date(ds.reduce((a, b) => (a > b ? a : b))) : new Date(today);
    min.setDate(min.getDate() - 3);
    max.setDate(max.getDate() + 4);
    if ((+max - +min) / 86400000 < 28) max = new Date(+min + 28 * 86400000);
    if ((+max - +min) / 86400000 > 120) max = new Date(+min + 120 * 86400000);
    const total = Math.round((+max - +min) / 86400000) + 1;
    const pctOf = (d: string) => (Math.round((+new Date(d) - +min) / 86400000) / total) * 100;
    const ticks: { left: number; label: string }[] = [];
    for (let i = 0; i < total; i += 7) {
      const t = new Date(+min + i * 86400000);
      ticks.push({ left: (i / total) * 100, label: `${t.getMonth() + 1}/${t.getDate()}` });
    }
    const todayLeft = +today >= +min && +today <= +max ? (Math.round((+today - +min) / 86400000) / total) * 100 : null;
    return { dated, undatedCount: shown.length - dated.length, pctOf, ticks, todayLeft, dayW: 100 / total };
  }, [shown]);

  // ── 캘린더 보기(추천 3 승인) — 마감일 기준, 칩 클릭=서랍, 날짜 ＋로 그 날짜 마감 항목 추가 ──
  const [calMonth, setCalMonth] = useState(0);
  const calCells = useMemo(() => {
    const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + calMonth);
    const y = base.getFullYear(); const m = base.getMonth();
    const start = new Date(y, m, 1 - new Date(y, m, 1).getDay());
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = iso(new Date());
    return {
      y, m,
      cells: Array.from({ length: 42 }, (_, i) => {
        const d = new Date(start); d.setDate(start.getDate() + i);
        return { date: iso(d), day: d.getDate(), inMonth: d.getMonth() === m, isToday: iso(d) === today };
      }),
    };
  }, [calMonth]);
  const byDue = useMemo(() => {
    const map = new Map<string, ItemRow[]>();
    for (const it of shown) if (it.due_date) (map.get(it.due_date) ?? map.set(it.due_date, []).get(it.due_date)!).push(it);
    return map;
  }, [shown]);

  // ── 칸반 끌어 옮기기 — 놓는 곳의 상태로 바뀐다(표의 상태 셀과 같은 저장).
  //   끄는 항목은 ref 로 든다 — dragstart 의 setState 가 커밋되기 전에 drop 이 오면 놓친다 ──
  const dragIdRef = useRef<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const dropTo = async (stageId: string) => {
    const id = dragIdRef.current; dragIdRef.current = null; setDragOverStage(null);
    if (!id) return;
    const it = items.find((x) => x.id === id);
    if (!it || it.status === stageId) return;
    await saveItem(id, { status: stageId });
  };

  // ── 템플릿 팝업 — monday 템플릿 센터 벤치마킹(2026-08-31 사장님: 생성 때 고르지 않고 버튼→팝업).
  //   템플릿은 **가로형**(사장님: "한 태스크당 업무처리를 하려면 가로로 보는 게 편함") —
  //   항목을 세로로 시드하지 않고 **컬럼 정의**를 시드한다. 그룹은 안 건드린다(_v3/templates.ts) ──
  const [tplOpen, setTplOpen] = useState(false);
  const [tplCat, setTplCat] = useState<string>(TPL_CATEGORIES[0]);
  const [tplSel, setTplSel] = useState<Tpl | null>(null);
  const [tplSaving, setTplSaving] = useState(false);

  //   우리 회사 양식(4단계) — 지금 표의 구조(커스텀 컬럼+그룹)를 저장해 다른 프로젝트에서 재사용.
  //   monday '만든 사람: {회사}' 대응. 값이 아니라 구조만 담는다(project_templates.spec).
  type MyTplRow = { id: string; name: string; icon: string; spec: { cols?: Tpl["cols"]; stages?: ItemStage[] } };
  const { data: myTplRows = [] } = useQuery({
    queryKey: ["pjv3-mytpl", companyId],
    enabled: !!companyId && tplOpen,
    queryFn: async () => (logRead("pjv3:mytpl", await db.from("project_templates")
      .select("id, name, icon, spec").eq("company_id", companyId).is("archived_at", null)
      .order("created_at", { ascending: false })) || []) as MyTplRow[],
  });
  const myTpls: Tpl[] = myTplRows.map((r) => ({
    key: `mine_${r.id}`, icon: r.icon || "⭐", name: r.name, cat: MY_TPL_CAT,
    desc: "우리 회사가 저장한 양식", cols: r.spec?.cols || [], stages: r.spec?.stages, example: "예시 — 한 건",
  }));
  const catTpls = (cat: string) => (cat === MY_TPL_CAT ? myTpls : TEMPLATES.filter((t) => t.cat === cat));
  const pickCat = (cat: string) => { setTplCat(cat); setTplSel(catTpls(cat)[0] ?? null); };

  const [myTplName, setMyTplName] = useState("");
  const [myTplDel, setMyTplDel] = useState<string | null>(null); // ✕ 두 번 눌러 확정
  const saveAsTemplate = async () => {
    const nm = myTplName.trim();
    if (!nm) { toast("양식 이름을 적어 주세요"); return; }
    const spec = {
      cols: cols.map((c) => ({ name: c.name, type: c.type, ...((c.settings?.options?.length ? { options: c.settings.options } : {}) as object) })),
      stages,
    };
    const { error } = await db.from("project_templates").insert({
      company_id: companyId, name: nm, spec, created_by: user?.id ?? null,
    });
    if (error) { toast(friendlyError(error), "error"); return; }
    setMyTplName("");
    qc.invalidateQueries({ queryKey: ["pjv3-mytpl", companyId] });
    toast(`'${nm}' 양식으로 저장했습니다 — 다른 프로젝트의 템플릿에서 골라 쓸 수 있습니다`, "success");
  };
  const deleteMyTpl = async (id: string) => {
    if (myTplDel !== id) { setMyTplDel(id); return; } // 첫 클릭은 확인
    setMyTplDel(null);
    const { error } = await db.from("project_templates")
      .update({ archived_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(friendlyError(error), "error"); return; }
    if (tplSel?.key === `mine_${id}`) setTplSel(null);
    qc.invalidateQueries({ queryKey: ["pjv3-mytpl", companyId] });
    toast("양식을 지웠습니다", "success");
  };
  const applyTemplate = async (tpl: Tpl) => {
    if (tplSaving) return;
    setTplSaving(true);
    try {
      //   우리 회사 양식은 그룹 구성까지 재현한다 — 단 빈 표일 때만(쓰던 표의 그룹을 덮으면 파괴)
      let firstStageId = stages[0]?.id;
      if (tpl.stages?.length && items.length === 0) {
        const { error } = await db.from("deals").update({ item_stages: tpl.stages }).eq("id", dealId);
        if (error) throw new Error(error.message);
        firstStageId = tpl.stages[0].id;
        qc.invalidateQueries({ queryKey: ["pjv3-deal", dealId] });
      }
      //   같은 이름의 열이 이미 있으면 건너뛴다(deal_id+key unique) — 두 번 눌러도 안 겹치게
      const existing = new Set(cols.map((c) => c.key));
      const newCols = tpl.cols.filter((c) => !existing.has(c.name));
      if (newCols.length > 0) {
        const base = cols.length > 0 ? Math.max(...cols.map((c) => c.position ?? 0)) + 1 : 0;
        const { error } = await db.from("project_item_columns").insert(newCols.map((c, i) => ({
          company_id: companyId, deal_id: dealId, key: c.name, name: c.name, type: c.type,
          settings: c.options ? { options: c.options } : {}, position: base + i,
        })));
        if (error) throw new Error(error.message);
      }
      //   예시 줄은 빈 표에만 — 쓰던 표에 예시가 끼면 방해다
      if (items.length === 0 && firstStageId) {
        const { error } = await db.from("project_items").insert({
          company_id: companyId, deal_id: dealId, kind: "todo",
          name: tpl.example, status: firstStageId, position: 0, created_by: user?.id ?? null,
        });
        if (error) throw new Error(error.message);
      }
      //   설문형 양식이면 설문 기능도 같이 켠다 — 설문 버튼이 ＋기능 뒤로 숨어 못 찾는 일 방지(2026-09-01)
      if (["svsat", "svevent", "svbook"].includes(tpl.key) && !features.includes("survey")) await toggleFeature("survey");
      toast(newCols.length > 0
        ? `'${tpl.name}' 양식을 적용했습니다 — 열 ${newCols.length}개가 오른쪽에 붙었습니다`
        : `'${tpl.name}' 양식의 열이 이미 다 있습니다`, "success");
      setTplOpen(false); setTplSel(null);
      qc.invalidateQueries({ queryKey: ["pjv3-cols", dealId] });
      qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    } catch (e: any) {
      toast(`적용 실패: ${e.message || e}`, "error");
    } finally {
      setTplSaving(false);
    }
  };

  // ── 그룹(단계) — 처음엔 한 그룹, 이름은 눌러서 바꾸고 ＋ 새 그룹으로 늘린다(2026-08-31 사장님) ──
  const [stageEdit, setStageEdit] = useState<string | null>(null);
  const stageEditRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { stageEditRef.current?.focus(); stageEditRef.current?.select(); }, [stageEdit]);
  const saveStages = async (next: ItemStage[]) => {
    const { error } = await db.from("deals").update({ item_stages: next }).eq("id", dealId);
    if (error) { toast(friendlyError(error), "error"); return false; }
    qc.invalidateQueries({ queryKey: ["pjv3-deal", dealId] });
    return true;
  };
  const renameStage = async (id: string, label: string) => {
    setStageEdit(null);
    const v = label.trim();
    const cur = stages.find((s) => s.id === id);
    if (!v || !cur || cur.label === v) return;
    await saveStages(stages.map((s) => (s.id === id ? { ...s, label: v } : s)));
  };
  const STAGE_COLORS: ItemStage["color"][] = ["indigo", "orange", "green", "red", "gray"];
  const addStage = async () => {
    const id = `g_${Date.now().toString(36)}`;
    const ok = await saveStages([...stages, { id, label: "새 그룹", color: STAGE_COLORS[stages.length % STAGE_COLORS.length] }]);
    if (ok) setStageEdit(id);
  };

  // ── 지우기 — 만들 수 있는 것(줄·그룹·컬럼)은 지울 수도 있어야 한다
  //   (2026-09-01 사장님: "그룹을 추가하면 삭제 버튼이 없음 — 기능 추가할 때는 사용자 편의를 무조건 고려").
  //   전부 ✕ 두 번 클릭 확정(회사 양식 지우기와 같은 패턴), 3초 지나면 해제 ──
  const [delArm, setDelArm] = useState<string | null>(null); // "stage:…" | "item:…" | "col:…"
  useEffect(() => {
    if (!delArm) return;
    const t = setTimeout(() => setDelArm(null), 3000);
    return () => clearTimeout(t);
  }, [delArm]);
  const armOrRun = (key: string, run: () => void) => {
    if (delArm !== key) { setDelArm(key); return; }
    setDelArm(null); run();
  };
  const deleteStage = async (id: string) => {
    const rest = stages.filter((s) => s.id !== id);
    if (rest.length === 0) return; // 마지막 그룹은 못 지운다(버튼도 안 그림) — 표엔 그룹이 최소 하나
    const movedCount = (byStage.m.get(id) || []).length;
    if (movedCount > 0) {
      //   항목은 지우지 않는다 — 맨 위 남는 그룹으로 옮긴다(그룹 삭제가 항목까지 지우면 파괴)
      const { error } = await db.from("project_items").update({ status: rest[0].id })
        .eq("deal_id", dealId).eq("status", id);
      if (error) { toast(friendlyError(error), "error"); return; }
    }
    const ok = await saveStages(rest);
    if (!ok) return;
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    toast(movedCount > 0 ? `그룹을 지우고 항목 ${movedCount}개를 '${rest[0].label}'(으)로 옮겼습니다` : "그룹을 지웠습니다", "success");
  };
  const deleteItem = async (id: string) => {
    //   부모를 지우면 하위도 같이(고아 방지) — ✕ 확인 문구가 미리 예고한다
    const { error } = await db.from("project_items")
      .update({ archived_at: new Date().toISOString() })
      .or(`id.eq.${id},parent_id.eq.${id}`);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    toast("줄을 지웠습니다", "success");
  };
  // ── 줄 끌어 옮기기 — ⋮⋮ 핸들로 다른 줄 앞·그룹 끝에 놓는다. 그룹이 바뀌면 상태도 같이
  //   (2026-09-01 사장님 승인 추천 2). 순서는 그룹 안 0..n 재부여(그룹 항목 수가 작아 일괄로 충분) ──
  const rowDragRef = useRef<string | null>(null);
  const [rowDropAt, setRowDropAt] = useState<string | null>(null); // "before:<itemId>" | "end:<stageId>"
  const moveRow = async (target: string) => {
    const id = rowDragRef.current; rowDragRef.current = null; setRowDropAt(null);
    if (!id) return;
    const it = items.find((x) => x.id === id);
    if (!it) return;
    let stageId: string; let list: ItemRow[];
    if (target.startsWith("end:")) {
      stageId = target.slice(4);
      list = (byStage.m.get(stageId) || []).filter((x) => x.id !== id);
      list.push(it);
    } else {
      const beforeId = target.slice("before:".length);
      if (beforeId === id) return;
      const before = items.find((x) => x.id === beforeId);
      if (!before) return;
      stageId = before.status;
      const group = byStage.m.get(stageId) ?? byStage.etc;
      list = group.filter((x) => x.id !== id);
      const idx = list.findIndex((x) => x.id === beforeId);
      list.splice(idx < 0 ? list.length : idx, 0, it);
    }
    const results = await Promise.all(list.map((x, i) =>
      db.from("project_items").update({ position: i, ...(x.id === id ? { status: stageId } : {}) }).eq("id", x.id)));
    const failed = results.find((r: { error: unknown }) => r.error);
    if (failed) { toast(friendlyError(failed.error), "error"); }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
  };

  // ── 컬럼 이름 바꾸기·끌어 옮기기 (추천 3) — key 는 그대로 둔다(값 fields[key] 연결이 끊기지 않게) ──
  const [colEdit, setColEdit] = useState<string | null>(null);
  const colEditRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { colEditRef.current?.focus(); colEditRef.current?.select(); }, [colEdit]);
  const renameColumn = async (c: ColumnDef, name: string) => {
    setColEdit(null);
    const v = name.trim();
    if (!v || v === c.name) return;
    const { error } = await db.from("project_item_columns").update({ name: v }).eq("id", c.id);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-cols", dealId] });
  };
  const colDragRef = useRef<string | null>(null);
  const [colDropAt, setColDropAt] = useState<string | null>(null);

  // ── 내장 열(담당·상태·마감·금액)도 커스텀과 똑같이 — 숨기기·이름·이동을 deals.v3_builtin 에 저장
  //   (2026-09-01 사장님: "템플릿 기본값도 삭제·수정·열 이동 되게, 다른 항목들도 다"). '이름' 열만
  //   항목의 정체라 고정. 숨긴 열은 오른쪽 ＋에서 되살린다 ──
  type BuiltinId = "assignee" | "status" | "due" | "amount";
  type BuiltinCfg = { hidden?: string[]; labels?: Record<string, string>; order?: string[] };
  const BUILTIN_DEFS: { id: BuiltinId; label: string; minW: number; title?: string }[] = [
    { id: "assignee", label: "담당", minW: 84 },
    { id: "status", label: "상태", minW: 92 },
    { id: "due", label: "마감", minW: 106 },
    { id: "amount", label: "금액", minW: 96, title: "예정 금액 — 확정 금액은 장부(전표·계산서)가 갖습니다" },
  ];
  const builtinCfg: BuiltinCfg = (deal?.v3_builtin as BuiltinCfg) || {};
  type AnyCol = { key: string; label: string; builtin?: BuiltinId; col?: ColumnDef; minW: number; title?: string };
  const allCols: AnyCol[] = useMemo(() => {
    const hidden = new Set(builtinCfg.hidden || []);
    const labels = builtinCfg.labels || {};
    const base: AnyCol[] = [
      ...BUILTIN_DEFS.filter((b) => !hidden.has(b.id)).map((b) => ({ key: b.id, label: labels[b.id] || b.label, builtin: b.id, minW: b.minW, title: b.title })),
      ...cols.map((c) => ({ key: c.key, label: c.name, col: c, minW: 96 })),
    ];
    const order = builtinCfg.order;
    if (!order?.length) return base;
    const idx = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length + base.findIndex((x) => x.key === k) : i; };
    return [...base].sort((a, b) => idx(a.key) - idx(b.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, deal?.v3_builtin]);
  const saveBuiltin = async (patch: Partial<BuiltinCfg>) => {
    const { error } = await db.from("deals").update({ v3_builtin: { ...builtinCfg, ...patch } }).eq("id", dealId);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-deal", dealId] });
  };
  const hideBuiltin = async (id: BuiltinId) => {
    await saveBuiltin({ hidden: [...(builtinCfg.hidden || []), id] });
    toast("열을 숨겼습니다 — 오른쪽 ＋에서 되살릴 수 있습니다", "success");
  };
  const renameBuiltin = async (id: BuiltinId, label: string) => {
    setColEdit(null);
    const v = label.trim();
    if (!v) return;
    await saveBuiltin({ labels: { ...(builtinCfg.labels || {}), [id]: v } });
  };
  const moveAnyCol = async (targetKey: string | null) => {
    const key = colDragRef.current; colDragRef.current = null; setColDropAt(null);
    if (!key || key === targetKey) return;
    const dragged = allCols.find((c) => c.key === key);
    if (!dragged) return;
    const list = allCols.filter((c) => c.key !== key);
    const idx = targetKey ? list.findIndex((c) => c.key === targetKey) : -1;
    list.splice(idx < 0 ? list.length : idx, 0, dragged);
    await saveBuiltin({ order: list.map((c) => c.key) });
  };

  // ── 컬럼 설정 저장(수식 expr 등) + 첨부파일(project-files 버킷) + 오너뷰 연결 검색 ──
  const fxInRef = useRef<HTMLInputElement | null>(null);
  const saveColSettings = async (col: ColumnDef, patch: Record<string, unknown>) => {
    const { error } = await db.from("project_item_columns")
      .update({ settings: { ...(col.settings || {}), ...patch } }).eq("id", col.id);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-cols", dealId] });
  };
  //   업로드는 새 uuid 경로 + upsert 금지(버킷에 UPDATE 정책이 없다 — 의도), 경로 첫 구간 = company_id(RLS)
  const uploadItemFile = async (it: ItemRow, colKey: string, file: File) => {
    if (file.size > 20 * 1024 * 1024) { toast("20MB까지 올릴 수 있습니다", "error"); return; }
    //   경로에 원본 이름을 넣지 않는다 — 한글 파일명이 storage key 에서 400 (실측). 이름은 메타(fields)에만.
    const ext = (file.name.split(".").pop() || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
    const path = `${companyId}/${dealId}/${it.id}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
    const { error } = await db.storage.from("project-files").upload(path, file, { upsert: false });
    if (error) { toast(friendlyError(error), "error"); return; }
    const cur = Array.isArray((it.fields || {})[colKey]) ? ((it.fields || {})[colKey] as { name: string; path: string }[]) : [];
    await saveField(it, colKey, [...cur, { name: file.name, path }]);
    toast(`'${file.name}' 을(를) 붙였습니다`, "success");
  };
  const openItemFile = async (path: string) => {
    const { data, error } = await db.storage.from("project-files").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { toast("파일 열기에 실패했습니다", "error"); return; }
    window.open(data.signedUrl, "_blank");
  };
  const deleteItemFile = async (it: ItemRow, colKey: string, path: string) => {
    await db.storage.from("project-files").remove([path]);
    const cur = Array.isArray((it.fields || {})[colKey]) ? ((it.fields || {})[colKey] as { name: string; path: string }[]) : [];
    await saveField(it, colKey, cur.filter((f) => f.path !== path));
  };
  const openStoredFile = (lk: { file_url?: string; title: string }) => {
    if (lk.file_url) void downloadStoredFile(lk.file_url, lk.title);
  };
  const [ovQ, setOvQ] = useState("");
  const [ovSrc, setOvSrc] = useState<"board" | "doc" | "sign">("board");
  const [ovOpen, setOvOpen] = useState(false); // pop 은 아래에서 선언되므로(TDZ) 열림 여부만 따로 든다
  const { data: ovResults = [] } = useQuery({
    queryKey: ["pjv3-ov", companyId, ovSrc, ovQ],
    enabled: !!companyId && ovOpen,
    queryFn: async (): Promise<{ id: string; title: string; file_url?: string }[]> => {
      if (ovSrc === "board") {
        const d = logRead("pjv3:ovboard", await db.from("board_posts").select("id, title")
          .eq("company_id", companyId).ilike("title", `%${ovQ}%`).order("created_at", { ascending: false }).limit(10));
        return (d || []).map((r: { id: string; title: string }) => ({ id: r.id, title: r.title }));
      }
      if (ovSrc === "doc") {
        const d = logRead("pjv3:ovdoc", await db.from("document_files").select("id, file_name, file_url")
          .eq("company_id", companyId).ilike("file_name", `%${ovQ}%`).order("created_at", { ascending: false }).limit(10));
        return (d || []).map((r: { id: string; file_name: string; file_url: string }) => ({ id: r.id, title: r.file_name, file_url: r.file_url }));
      }
      const d = logRead("pjv3:ovsign", await db.from("signature_requests").select("id, title")
        .eq("company_id", companyId).ilike("title", `%${ovQ}%`).order("created_at", { ascending: false }).limit(10));
      return (d || []).map((r: { id: string; title: string }) => ({ id: r.id, title: r.title }));
    },
  });

  // ── 돈(줄에서 바로 청구, 2026-09-01 사장님 승인) — 기존 견적·계약 팝업(BoardDocModal)을
  //   v3 줄에 그대로 연결. 연결 저장 = fields.__quote / __contract {id,no}(예약 키 — 컬럼 정의가
  //   없으니 표에는 안 보인다). ＋기능 'billing' 을 켠 프로젝트에서만 서랍에 '돈' 구역 ──
  const QUOTE_KEY = "__quote";
  const CONTRACT_KEY = "__contract";
  const { data: dealDocs = [] } = useQuery({
    queryKey: ["pjv3-docs", dealId],
    enabled: !!dealId && featOn("billing"),
    queryFn: async () => (logRead("pjv3:docs", await db.from("documents")
      .select("*").eq("deal_id", dealId).order("created_at", { ascending: false })) || []) as any[],
  });
  const [docModal, setDocModal] = useState<{ itemId: string; kind: DocKind; draft?: { name: string; content: any; contentType: "invoice" | "contract"; sourceDocumentId?: string | null } } | null>(null);
  const partnerColKey = cols.find((c) => c.type === "partner")?.key;
  const rowPartnerName = (it: ItemRow) => (partnerColKey ? String((it.fields || {})[partnerColKey] || "") : "");
  const rowAmount = (it: ItemRow) => rollNum(it, (x) => Number(x.plan_amount) || 0) ?? (Number(it.plan_amount) || 0);
  const docLinkOf = (it: ItemRow, key: string) => ((it.fields || {})[key] as { id?: string; no?: string } | undefined) || null;
  const openQuoteModal = (it: ItemRow) => {
    if (docLinkOf(it, QUOTE_KEY)?.id) { setDocModal({ itemId: it.id, kind: "quote" }); return; }
    //   하위 작업이 있으면 하위가 품목 행으로 미리 채워진다(각 이름·금액)
    const kids = childrenOf.get(it.id) || [];
    const content = buildQuoteContent() as any;
    if (kids.length > 0) {
      content.items = kids.map((k) => {
        const a = Number(k.plan_amount) || 0;
        return { name: k.name, quantity: 1, unitPrice: a, supplyAmount: a, taxAmount: Math.round(a * 0.1), totalAmount: Math.round(a * 1.1) };
      });
    }
    setDocModal({ itemId: it.id, kind: "quote", draft: { name: `${it.name?.trim() || deal?.name || "프로젝트"} 견적서`, content, contentType: "invoice" } });
  };
  const openContractModal = (it: ItemRow) => {
    if (docLinkOf(it, CONTRACT_KEY)?.id) { setDocModal({ itemId: it.id, kind: "contract" }); return; }
    const q = docLinkOf(it, QUOTE_KEY);
    const quoteDoc = (dealDocs as any[]).find((d) => d.id === q?.id) || null;
    setDocModal({
      itemId: it.id, kind: "contract",
      draft: {
        name: `${it.name?.trim() || deal?.name || "프로젝트"} 계약서`, contentType: "contract",
        sourceDocumentId: quoteDoc?.id || null,
        content: buildContractContent({ quoteDoc, dealName: deal?.name || "", rowName: it.name || "", partnerName: rowPartnerName(it) || undefined, amount: rowAmount(it) }),
      },
    });
  };
  const createDocFromDraft = async (contentJson: any, name?: string): Promise<boolean> => {
    const d = docModal?.draft;
    const it = docModal ? items.find((i) => i.id === docModal.itemId) : null;
    if (!d || !it || !user?.id) return false;
    try {
      const docRow = await insertDocument({
        companyId: companyId!, dealId, userId: user.id, name: name?.trim() || d.name,
        contentType: d.contentType, contentJson, sourceDocumentId: d.sourceDocumentId || null,
      });
      const key = d.contentType === "contract" ? CONTRACT_KEY : QUOTE_KEY;
      await saveField(it, key, { id: docRow.id, no: docRow.document_number || (d.contentType === "contract" ? "계약서" : "견적서") });
      qc.invalidateQueries({ queryKey: ["pjv3-docs", dealId] });
      setDocModal({ itemId: it.id, kind: docModal!.kind });
      return true;
    } catch (e: any) {
      toast(e?.message || "저장 실패", "error");
      return false;
    }
  };

  // ── 엑셀 — 재고 공용 부품(excel-io·ExcelUploadDialog) 재사용. 조회 줄엔 '엑셀 ▾' 하나(표준) ──
  const [excelUp, setExcelUp] = useState(false);
  const exportRows = () => {
    const data = shown.map((it) => {
      const row: Record<string, unknown> = {
        "그룹": stages.find((s) => s.id === it.status)?.label || it.status,
        "이름": it.name,
        "담당": userName(it.assignee_id) || "",
        "마감": it.due_date || "",
        "금액": it.plan_amount ?? "",
      };
      for (const c of cols) {
        const raw = (it.fields || {})[c.key];
        const val = raw == null ? "" : String(raw);
        if (c.type === "select") row[c.name] = (c.settings?.options || []).find((o) => o.id === val)?.label || val;
        else if (c.type === "person") row[c.name] = userName(val || null) || val;
        else if (c.type === "check") row[c.name] = raw === true || raw === "true" ? "예" : "아니오";
        else if (c.type === "formula") { const r = fxEval(it, c); row[c.name] = r.error ? "" : r.value ?? ""; }
        else if (c.type === "auto") { const src = (c.settings as { mode?: string } | null)?.mode === "created" ? (it as any).created_at : (it as any).updated_at; row[c.name] = src ? String(src).slice(0, 10) : ""; }
        else if (c.type === "files") row[c.name] = Array.isArray(raw) ? `파일 ${raw.length}개` : "";
        else if (c.type === "ovlink") row[c.name] = raw && typeof raw === "object" ? (raw as { title?: string }).title || "" : "";
        else row[c.name] = val;
      }
      return row;
    });
    exportToExcel(data, "표", `${deal?.name || "프로젝트"}_표_${new Date().toISOString().slice(0, 10)}`);
  };
  const excelCols: ExcelColumn[] = [
    { key: "group", label: "그룹", hint: `표의 그룹 이름 그대로 (${stages.map((s) => s.label).join(" / ")}) — 비우면 첫 그룹`, example: stages[0]?.label },
    { key: "name", label: "이름", required: true, example: "○○ 건" },
    { key: "assignee", label: "담당", hint: "구성원 이름 그대로 — 비우면 없음" },
    { key: "due", label: "마감", kind: "date" },
    { key: "amount", label: "금액", kind: "number" },
    //   수식·자동 날짜·첨부·오너뷰 연결은 올리기 대상이 아니다(계산·자동·복합) — 양식에서 뺀다
    ...cols.filter((c) => !["formula", "auto", "files", "ovlink"].includes(c.type)).map((c): ExcelColumn => ({
      key: `f_${c.key}`, label: c.name,
      kind: c.type === "number" || c.type === "rating" ? "number" : c.type === "date" ? "date" : c.type === "check" ? "bool" : "text",
      hint: c.type === "select" ? `다음 중 하나: ${(c.settings?.options || []).map((o) => o.label).join(" / ")}`
        : c.type === "person" ? "구성원 이름 그대로"
        : c.type === "check" ? "예/아니오" : c.type === "rating" ? "1~5" : undefined,
    })),
  ];
  type XRow = { name: string; status: string; assignee_id: string | null; due: string | null; amount: number | null; fields: Record<string, unknown> };
  const parseX = (row: ExcelRow): ParseResult<XRow> => {
    const name = (row.name || "").trim();
    if (!name) return { error: "이름이 비었습니다" };
    let status = stages[0]?.id || "todo";
    const g = (row.group || "").trim();
    if (g) {
      const st = stages.find((s) => s.label === g);
      if (!st) return { error: `그룹 '${g}' 이(가) 표에 없습니다 — ${stages.map((s) => s.label).join("/")} 중에서` };
      status = st.id;
    }
    let assignee: string | null = null;
    const an = (row.assignee || "").trim();
    if (an) {
      const u = users.find((x) => (x.name || "").trim() === an);
      if (!u) return { error: `담당 '${an}' 을(를) 구성원에서 못 찾았습니다` };
      assignee = u.id;
    }
    const dueRaw = (row.due || "").trim();
    if (dueRaw && !isDate(dueRaw)) return { error: `마감 '${dueRaw}' — 2026-09-01 형식으로` };
    const fields: Record<string, unknown> = {};
    for (const c of cols) {
      if (["formula", "auto", "files", "ovlink"].includes(c.type)) continue; // 양식에 없는 타입
      const raw = (row[`f_${c.key}`] || "").trim();
      if (!raw) continue;
      if (c.type === "check") { fields[c.key] = /^(예|y|yes|true|o|1)$/i.test(raw); continue; }
      if (c.type === "rating") {
        const n = Math.round(Number(raw));
        if (!Number.isFinite(n) || n < 1 || n > 5) return { error: `'${c.name}' 칸의 '${raw}' — 1~5 사이 숫자로` };
        fields[c.key] = n; continue;
      }
      if (c.type === "select") {
        const opt = (c.settings?.options || []).find((o) => o.label === raw);
        if (!opt) return { error: `'${c.name}' 칸의 '${raw}' — ${(c.settings?.options || []).map((o) => o.label).join("/")} 중에서` };
        fields[c.key] = opt.id;
      } else if (c.type === "person") {
        const u = users.find((x) => (x.name || "").trim() === raw);
        if (!u) return { error: `'${c.name}' 칸의 '${raw}' 을(를) 구성원에서 못 찾았습니다` };
        fields[c.key] = u.id;
      } else if (c.type === "number") {
        fields[c.key] = xNum(raw);
      } else if (c.type === "date") {
        if (!isDate(raw)) return { error: `'${c.name}' 칸의 '${raw}' — 날짜 형식(YYYY-MM-DD)으로` };
        fields[c.key] = raw;
      } else {
        fields[c.key] = raw;
      }
    }
    return { ok: { name, status, assignee_id: assignee, due: dueRaw || null, amount: xNum(row.amount), fields } };
  };
  const commitX = async (rows: XRow[]) => {
    const base = items.length > 0 ? Math.max(...items.map((x) => x.position ?? 0)) + 1 : 0;
    const { error } = await db.from("project_items").insert(rows.map((r, i) => ({
      company_id: companyId, deal_id: dealId, kind: "todo", name: r.name, status: r.status,
      assignee_id: r.assignee_id, due_date: r.due, plan_amount: r.amount,
      fields: r.fields, position: base + i, created_by: user?.id ?? null,
    })));
    if (error) throw new Error(error.message);
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    return `${rows.length}줄을 표에 넣었습니다`;
  };

  // ── 설문 발송(2026-09-01 사장님 승인) — 컬럼=질문, 응답 1건=줄 1개. 설정은 project_surveys,
  //   외부 페이지 /survey/{token} 은 project-survey 엣지 함수가 담당(anon DB 접근 0) ──
  const SV_ANSWERABLE = ["text", "longtext", "number", "date", "select", "check", "rating", "url", "tel", "place"];
  const [svOpen, setSvOpen] = useState(false);
  type SurveyRow = {
    id: string; token: string; enabled: boolean; title: string; intro: string; name_label: string;
    banner_path: string | null; image_paths: string[]; questions: { key: string; required?: boolean }[];
    target_stage: string; response_count: number;
    //   2차(2026-09-01): 받는 조건 — 마감일·정원·1인 1회. 집행은 엣지 함수가 한다
    closes_at: string | null; max_responses: number | null; prevent_dup: boolean;
  };
  const { data: survey } = useQuery({
    queryKey: ["pjv3-survey", dealId],
    enabled: !!dealId && svOpen,
    queryFn: async () => (logRead("pjv3:survey", await db.from("project_surveys")
      .select("*").eq("deal_id", dealId).maybeSingle())) as SurveyRow | null,
  });
  const [svForm, setSvForm] = useState({
    title: "", intro: "", nameLabel: "성함", stage: "", banner: null as string | null,
    images: [] as string[], q: {} as Record<string, { on: boolean; required: boolean }>,
    closesAt: "", maxResp: "", preventDup: false,
  });
  useEffect(() => {
    if (!svOpen) return;
    const qmap: Record<string, { on: boolean; required: boolean }> = {};
    for (const q of survey?.questions || []) qmap[q.key] = { on: true, required: !!q.required };
    setSvForm({
      title: survey?.title || `${deal?.name || ""} 설문`,
      intro: survey?.intro || "",
      nameLabel: survey?.name_label || "성함",
      stage: survey?.target_stage || stages[0]?.id || "",
      banner: survey?.banner_path ?? null,
      images: (survey?.image_paths as string[]) || [],
      q: qmap,
      closesAt: survey?.closes_at || "",
      maxResp: survey?.max_responses != null ? String(survey.max_responses) : "",
      preventDup: !!survey?.prevent_dup,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svOpen, survey?.id]);
  const svCols = cols.filter((c) => SV_ANSWERABLE.includes(c.type));
  const saveSurvey = async (enable?: boolean) => {
    const questions = svCols.filter((c) => svForm.q[c.key]?.on).map((c) => ({ key: c.key, required: !!svForm.q[c.key]?.required }));
    const payload: Record<string, unknown> = {
      company_id: companyId, deal_id: dealId, title: svForm.title.trim(), intro: svForm.intro,
      name_label: svForm.nameLabel.trim() || "성함", target_stage: svForm.stage || stages[0]?.id || "",
      banner_path: svForm.banner, image_paths: svForm.images, questions,
      closes_at: svForm.closesAt || null,
      max_responses: svForm.maxResp.trim() !== "" && Number.isFinite(Number(svForm.maxResp)) && Number(svForm.maxResp) > 0
        ? Math.round(Number(svForm.maxResp)) : null,
      prevent_dup: svForm.preventDup,
      created_by: survey?.id ? undefined : user?.id ?? null,
    };
    if (enable !== undefined) payload.enabled = enable;
    const { error } = await db.from("project_surveys").upsert(payload, { onConflict: "deal_id" });
    if (error) { toast(friendlyError(error), "error"); return false; }
    qc.invalidateQueries({ queryKey: ["pjv3-survey", dealId] });
    return true;
  };
  const uploadSurveyImg = async (file: File, kind: "banner" | "image") => {
    if (file.size > 20 * 1024 * 1024) { toast("20MB까지 올릴 수 있습니다", "error"); return; }
    const ext = (file.name.split(".").pop() || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
    const path = `${companyId}/${dealId}/survey/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
    const { error } = await db.storage.from("project-files").upload(path, file, { upsert: false });
    if (error) { toast(friendlyError(error), "error"); return; }
    setSvForm((f) => kind === "banner" ? { ...f, banner: path } : { ...f, images: [...f.images, path] });
  };
  const surveyUrl = survey?.token ? `${typeof window !== "undefined" ? window.location.origin : ""}/survey/${survey.token}` : "";
  //   응답 줄(fields.__sv — 엣지가 심는 표식)만 골라 엑셀로. 표 전체 내려받기와 달리 응답자·제출일·질문만
  const svResponses = items.filter((it) => (it.fields || {})["__sv"] === true);
  const exportSvResponses = () => {
    const data = svResponses.map((it) => {
      const row: Record<string, unknown> = {
        [survey?.name_label || "성함"]: it.name,
        "제출일": String((it as any).created_at || "").slice(0, 10),
      };
      for (const c of svCols) {
        const raw = (it.fields || {})[c.key];
        const val = raw == null ? "" : String(raw);
        if (c.type === "select") row[c.name] = (c.settings?.options || []).find((o) => o.id === val)?.label || val;
        else if (c.type === "check") row[c.name] = raw === true || raw === "true" ? "예" : "아니오";
        else row[c.name] = val;
      }
      return row;
    });
    exportToExcel(data, "설문 응답", `${deal?.name || "설문"}_응답_${new Date().toISOString().slice(0, 10)}`);
  };
  //   질문 타입별 간단 집계 — 내려받지 않고도 흐름이 보이게. 글·날짜류는 요약할 수 없어 뺀다
  const svSumFor = (c: (typeof cols)[number]): string | null => {
    const vals = svResponses.map((it) => (it.fields || {})[c.key]).filter((v) => v != null && String(v).trim() !== "");
    if (vals.length === 0) return null;
    if (c.type === "rating") {
      const avg = vals.reduce((s: number, v) => s + Number(v), 0) / vals.length;
      return `★ ${avg.toFixed(1)} (${vals.length}명)`;
    }
    if (c.type === "number") return `합계 ${vals.reduce((s: number, v) => s + Number(v), 0).toLocaleString("ko-KR")}`;
    if (c.type === "select") {
      const cnt = new Map<string, number>();
      for (const v of vals) cnt.set(String(v), (cnt.get(String(v)) || 0) + 1);
      const parts = (c.settings?.options || []).filter((o) => cnt.has(o.id)).map((o) => `${o.label} ${cnt.get(o.id)}`);
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    if (c.type === "check") {
      const n = vals.filter((v) => v === true || v === "true").length;
      return n > 0 ? `예 ${n}` : null;
    }
    return null;
  };

  // ── 일괄 처리(오두 갭 ①) — 줄 체크 → 바닥 SelectionBar. 완료·상태는 saveItem 루프(반복·앞뒤 규칙 공유) ──
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearSel = () => setSelIds(new Set());
  const bulkStatus = async (stageId: string) => {
    for (const id of selIds) await saveItem(id, { status: stageId });
    clearSel(); setPop(null);
  };
  const bulkAssign = async (uid: string | null) => {
    const { error } = await db.from("project_items").update({ assignee_id: uid, assignee_ids: uid ? [uid] : [] }).in("id", [...selIds]);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    clearSel(); setPop(null);
  };
  const bulkDelete = async () => {
    const ids = [...selIds];
    const { error } = await db.from("project_items")
      .update({ archived_at: new Date().toISOString() })
      .or(ids.map((id) => `id.eq.${id},parent_id.eq.${id}`).join(","));
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    toast(`${ids.length}줄을 지웠습니다`, "success");
    clearSel();
  };

  // ── 그룹 접기(각자 보기) + 완료 보관(마지막 그룹을 소프트로 치우기) + 보관함 모달 ──
  const [collapsedG, setCollapsedG] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) => setCollapsedG((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [archOpen, setArchOpen] = useState(false);
  const { data: archived = [] } = useQuery({
    queryKey: ["pjv3-archived", dealId],
    enabled: !!dealId && archOpen,
    queryFn: async () => (logRead("pjv3:archived", await db.from("project_items")
      .select("id, name, archived_at").eq("deal_id", dealId).not("archived_at", "is", null)
      .order("archived_at", { ascending: false }).limit(100)) || []) as { id: string; name: string; archived_at: string }[],
  });
  const restoreItem = async (id: string) => {
    const { error } = await db.from("project_items").update({ archived_at: null }).eq("id", id);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    qc.invalidateQueries({ queryKey: ["pjv3-archived", dealId] });
    toast("되살렸습니다 — 원래 그룹으로 돌아갔습니다", "success");
  };
  const archiveGroup = async (stageId: string) => {
    const ids = (byStage.m.get(stageId) || []).map((x) => x.id);
    if (ids.length === 0) return;
    const { error } = await db.from("project_items")
      .update({ archived_at: new Date().toISOString() })
      .or(ids.map((id) => `id.eq.${id},parent_id.eq.${id}`).join(","));
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    toast(`${ids.length}건을 보관했습니다 — 조회 줄 '보관함'에서 언제든 되살립니다`, "success");
  };

  // ── 서랍(추천 1 = 2단계 핵심) — 줄을 열면 체크리스트·기록(댓글+변경 한 줄기)·팔로워.
  //   팔로워 알림 연동(notify 트리거 확장)은 다음 차수 ──
  const [drawerId, setDrawerId] = useState<string | null>(null);
  //   내 작업 등에서 ?item= 으로 들어오면 그 줄 서랍을 바로 연다(마운트 1회 — /board 딥링크 패턴)
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get("item");
      if (id) setDrawerId(id);
    } catch { /* 무시 */ }
  }, []);
  const drawerItem = items.find((x) => x.id === drawerId) ?? null;
  // (서랍 Esc 닫기는 팝 선언 뒤에 — 팝이 떠 있으면 Esc 는 팝만 닫는다)
  type CheckRow = { id: string; name: string; done: boolean; position: number };
  type EventRow = { id: string; kind: string; body: string; created_by: string | null; created_at: string };
  const { data: checks = [] } = useQuery({
    queryKey: ["pjv3-checks", drawerId],
    enabled: !!drawerId,
    queryFn: async () => (logRead("pjv3:checks", await db.from("project_item_checks")
      .select("id, name, done, position").eq("item_id", drawerId)
      .order("position").order("created_at")) || []) as CheckRow[],
  });
  const { data: events = [] } = useQuery({
    queryKey: ["pjv3-events", drawerId],
    enabled: !!drawerId,
    queryFn: async () => (logRead("pjv3:events", await db.from("project_item_events")
      .select("id, kind, body, created_by, created_at").eq("item_id", drawerId)
      .order("created_at", { ascending: false })) || []) as EventRow[],
  });
  const addCheck = async (name: string) => {
    if (!drawerId) return;
    const { error } = await db.from("project_item_checks").insert({
      company_id: companyId, item_id: drawerId, name,
      position: (checks[checks.length - 1]?.position ?? 0) + 1,
    });
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-checks", drawerId] });
  };
  const toggleCheck = async (c: CheckRow) => {
    const { error } = await db.from("project_item_checks").update({ done: !c.done }).eq("id", c.id);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-checks", drawerId] });
  };
  const deleteCheck = async (id: string) => {
    const { error } = await db.from("project_item_checks").delete().eq("id", id);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-checks", drawerId] });
  };
  //   @멘션(2026-09-01) — 댓글에서 @이름으로 부르면 팔로워·담당이 아니어도 알림이 간다.
  //   이름→id 풀이는 여기(클라이언트)서 하고, 알림 합류는 comment_notify 트리거가 mentions 칸으로.
  const [cmt, setCmt] = useState("");
  useEffect(() => setCmt(""), [drawerId]);
  const cmtMention = (() => { const m = cmt.match(/@([^\s@]*)$/); return m ? m[1] : null; })();
  const mentionHits = cmtMention != null
    ? users.filter((u) => u.name && u.name.toLowerCase().includes(cmtMention.toLowerCase())).slice(0, 6)
    : [];
  const pickMention = (name: string) => setCmt((v) => v.replace(/@[^\s@]*$/, `@${name} `));
  const addComment = async (body: string) => {
    if (!drawerId) return;
    //   @이름 뒤에 글자가 이어지면(=다른 이름의 일부) 오탐이라 경계를 본다
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentions = users
      .filter((u) => u.name && new RegExp(`@${esc(u.name)}(?![\\w가-힣])`).test(body))
      .map((u) => u.id);
    const { error } = await db.from("project_item_events").insert({
      company_id: companyId, item_id: drawerId, kind: "comment", body, created_by: user?.id ?? null, mentions,
    });
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-events", drawerId] });
  };
  //   기록 줄에서 @이름을 진하게 — 부른 사람이 한눈에 보이게
  const renderCmtBody = (body: string) =>
    body.split(/(@[^\s@]+)/g).map((tok, i) =>
      tok.startsWith("@") && users.some((u) => u.name && tok.slice(1).startsWith(u.name))
        ? <b key={i} className="pjv3-mention">{tok}</b> : tok);
  const toggleFollower = async (it: ItemRow, uid: string) => {
    const cur: string[] = (it as any).followers || [];
    const next = cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid];
    await saveItem(it.id, { followers: next });
  };

  // ── 선택지(select 옵션) 편집 — 템플릿은 기초일 뿐, 이름·색·순서·추가·삭제 전부 사용자 것
  //   (2026-09-01 사장님: "템플릿에서 제공하는 항목도 삭제·수정 가능하게, 위치도 자유자재로") ──
  const OPTION_COLORS = ["#9aa0b5", "#FDAB3D", "#00C875", "#E2445C", "#5559DF", "#66CCFF"];
  const [optEdit, setOptEdit] = useState(false);
  const saveOptions = async (col: ColumnDef, options: NonNullable<NonNullable<ColumnDef["settings"]>["options"]>) => {
    const { error } = await db.from("project_item_columns")
      .update({ settings: { ...(col.settings || {}), options } }).eq("id", col.id);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-cols", dealId] });
  };
  const deleteOption = async (col: ColumnDef, optId: string) => {
    //   이 값을 쓰던 칸은 비운다 — 지운 선택지 id 가 셀에 날것으로 남지 않게
    const using = items.filter((it) => (it.fields || {})[col.key] === optId);
    await Promise.all(using.map((it) =>
      db.from("project_items").update({ fields: { ...(it.fields || {}), [col.key]: null } }).eq("id", it.id)));
    await saveOptions(col, (col.settings?.options || []).filter((o) => o.id !== optId));
    if (using.length > 0) qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
  };

  const deleteColumn = async (c: ColumnDef) => {
    const { error } = await db.from("project_item_columns")
      .update({ archived_at: new Date().toISOString() }).eq("id", c.id);
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-cols", dealId] });
    toast(`'${c.name}' 컬럼을 지웠습니다 — 칸에 적었던 값은 남아 있어 같은 이름으로 다시 만들면 보입니다`, "success");
  };

  // ── 팝(팔레트·담당·선택지·컬럼 추가) — 화면에 하나만 ──
  const [pop, setPop] = useState<Pop | null>(null);
  useEffect(() => {
    if (!pop) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".pjv3-pop")) setPop(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPop(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [pop]);
  const at = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    //   앱 전체가 zoom(--app-zoom) 안이라 fixed 좌표가 zoom 배로 다시 늘어난다 — 나눠서 보정
    //   (2026-09-01 사장님: 오른쪽 ＋ 팝이 화면 밖으로 잘리고 클릭 안 됨). 우측·하단 여유도 확보.
    const zEl = document.querySelector(".app-zoom");
    const zoom = zEl ? parseFloat(getComputedStyle(zEl as HTMLElement).zoom as string) || 1 : 1;
    //   화면 아래쪽 버튼(SelectionBar 등)에서 열면 팝이 잘린다 — 하단 340px 안이면 시작점을 위로 당긴다
    return {
      x: Math.max(8, Math.min(r.left, window.innerWidth - 320)) / zoom,
      y: Math.min(r.bottom + 4, window.innerHeight - 340) / zoom,
    };
  };
  //   바닥 바(일괄 처리)의 팝은 버튼 '위'에 붙인다 — 하단 클램프로 화면 중간에 동떨어져 뜨던 것(2026-09-01 사장님)
  const atUp = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const zEl = document.querySelector(".app-zoom");
    const zoom = zEl ? parseFloat(getComputedStyle(zEl as HTMLElement).zoom as string) || 1 : 1;
    return { x: Math.max(8, Math.min(r.left, window.innerWidth - 320)) / zoom, y: (r.top - 6) / zoom, up: true as const };
  };
  useEffect(() => { if (!pop || pop.kind !== "select") setOptEdit(false); }, [pop]);
  useEffect(() => { if (!pop || (pop.kind !== "person" && pop.kind !== "follower")) setPersonQ(""); }, [pop]);
  useEffect(() => { setOvOpen(pop?.kind === "ovlink"); }, [pop]);
  //   상태(그룹) 팔레트도 고정이 아니다 — 이름·색·순서·추가·삭제 (2026-09-01 사장님)
  const [stEdit, setStEdit] = useState(false);
  useEffect(() => { if (!pop || pop.kind !== "status") setStEdit(false); }, [pop]);
  useEffect(() => {
    //   팝(팔레트·담당 등)이 떠 있으면 Esc 는 팝만 닫는다 — 서랍까지 같이 닫히면 당황스럽다
    if (!drawerId || pop) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerId(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [drawerId, pop]);

  // ── 셀 인라인 편집(글·숫자·날짜) — 누르면 그 자리가 입력칸 ──
  const [edit, setEdit] = useState<{ itemId: string; colKey: string } | null>(null);
  const editRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { editRef.current?.focus(); editRef.current?.select(); }, [edit]);
  const EditCell = ({ it, colKey, value, type, align }: {
    it: ItemRow; colKey: string; value: string; type?: "text" | "number" | "date"; align?: "left";
  }) => {
    const editing = edit?.itemId === it.id && edit?.colKey === colKey;
    const commit = async (v: string) => {
      setEdit(null);
      if (v === value) return;
      if (colKey === "name") { if (v.trim()) await saveItem(it.id, { name: v.trim() }); return; }
      if (colKey === "due_date") { await saveItem(it.id, { due_date: v || null }); return; }
      if (colKey === "plan_amount") { await saveItem(it.id, { plan_amount: v === "" ? null : Number(v.replace(/[^0-9.-]/g, "")) }); return; }
      await saveField(it, colKey, type === "number" ? (v === "" ? null : Number(v)) : v);
    };
    if (editing) return (
      <input ref={editRef} className="pjv3-cell" defaultValue={value} type={type === "date" ? "date" : "text"}
        inputMode={type === "number" ? "decimal" : undefined}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEdit(null);
        }} />
    );
    //   숫자는 읽을 땐 콤마, 고칠 땐 원값 (표가 입력이자 장부다)
    const shownValue = type === "number" && value !== "" && Number.isFinite(Number(value))
      ? Number(value).toLocaleString("ko-KR") : value;
    return (
      <span className={`pjv3-cell ${align === "left" ? "text-left" : ""} ${value ? "" : "text-[var(--text-dim)]"}`}
        onClick={() => setEdit({ itemId: it.id, colKey })}>{shownValue || "—"}</span>
    );
  };

  // ── 수식 — 저장 없이 볼 때마다 계산. 열 이름(현재 라벨)으로 참조, 수식→수식은 깊이 3까지 ──
  const fxEval = (it: ItemRow, c: ColumnDef, depth = 0): FormulaResult => {
    if (depth > 3) return { value: null, error: "수식이 서로를 참조하고 있어요" };
    const expr = String((c.settings as { expr?: string } | null)?.expr || "");
    return evalFormula(expr, (name) => {
      const amountLabel = (builtinCfg.labels || {}).amount || "금액";
      if (name === amountLabel || name === "금액" || name === "amount") {
        return it.plan_amount == null ? null : Number(it.plan_amount);
      }
      const target = cols.find((x) => x.name === name || x.key === name);
      if (!target) return undefined;
      if (target.type === "number" || target.type === "rating") {
        const v = (it.fields || {})[target.key];
        return v == null || v === "" ? null : Number(v);
      }
      if (target.type === "formula" && target.key !== c.key) {
        const r = fxEval(it, target, depth + 1);
        return r.error ? undefined : r.value;
      }
      return undefined;
    });
  };
  /** 수식에서 부를 수 있는 열 이름들(수식 편집 팝의 칩) */
  const fxRefNames = [
    (builtinCfg.labels || {}).amount || "금액",
    ...cols.filter((c) => c.type === "number" || c.type === "rating" || c.type === "formula").map((c) => c.name),
  ];

  // ── 숫자 컬럼 합계(먼데이 M6) ──
  const numberCols = cols.filter((c) => c.type === "number");

  if (dealLoading || itemsLoading) return <div className="pjv3-wrap"><div className="collect-empty">불러오는 중…</div></div>;
  if (!deal) return <div className="pjv3-wrap"><div className="collect-empty">프로젝트를 찾을 수 없습니다.</div></div>;

  const stageOf = (id: string) => stages.find((s) => s.id === id);
  const period = [deal.start_date, deal.end_date].filter(Boolean).join(" ~ ");
  const totalCols = 1 + allCols.length + 1; // 이름 + (내장·커스텀 통합, 숨김 제외) + ＋

  const renderRow = (it: ItemRow, depth = 0) => {
    const kids = depth === 0 ? (childrenOf.get(it.id) || []) : [];
    const open = expanded.has(it.id);
    return (
    <tr key={it.id} className={`${rowDropAt === `before:${it.id}` ? "pjv3-dropbefore" : ""} ${depth > 0 ? "pjv3-sub" : ""}`}
      onDragOver={(e) => { if (depth === 0 && rowDragRef.current) { e.preventDefault(); setRowDropAt(`before:${it.id}`); } }}
      onDragLeave={() => setRowDropAt((cur) => (cur === `before:${it.id}` ? null : cur))}
      onDrop={() => moveRow(`before:${it.id}`)}>
      <td className="pjv3-namecell pjv3-ecell">
        <span className="flex items-center gap-1.5 px-0">
          {depth === 0 && (
            <span className="pjv3-handle" title="끌어서 순서·그룹 옮기기" draggable
              onDragStart={(e) => { rowDragRef.current = it.id; e.dataTransfer.setData("text/plain", it.id); }}
              onDragEnd={() => { rowDragRef.current = null; setRowDropAt(null); }}>⋮⋮</span>
          )}
          {depth === 0 && (
            <input type="checkbox" className={`pjv3-selbox ${selIds.size > 0 ? "show" : ""}`} aria-label="이 줄 고르기"
              checked={selIds.has(it.id)} onChange={() => toggleSel(it.id)} />
          )}
          {depth === 0 && (
            <button type="button" className={`pjv3-subtg ${open ? "open" : ""} ${kids.length === 0 ? "empty" : ""}`}
              title={kids.length > 0 ? "하위 작업 펼치기/접기" : "하위 작업 만들기"}
              onClick={() => toggleExpand(it.id)}>
              <span className="car">▶</span>{kids.length > 0 && <span className="cnt num">{kids.length}</span>}
            </button>
          )}
          {it.kind !== "todo" && (
            <span className={`pjv3-kind ${KIND_CHIP[it.kind]?.cls || ""}`}>{KIND_CHIP[it.kind]?.label}</span>
          )}
          {featOn("recur") && (it as any).recurrence?.freq && (
            <span className="pjv3-rowbadge" title={`반복 — ${(it as any).recurrence.freq === "daily" ? "매일" : (it as any).recurrence.freq === "monthly" ? "매월" : "매주"}. 완료로 옮기면 다음 줄이 생깁니다`}>🔁</span>
          )}
          {featOn("deps") && (it as any).after_id && (() => {
            const af = items.find((x) => x.id === (it as any).after_id);
            const lastId = stages[stages.length - 1]?.id;
            if (!af || af.status === lastId) return null;
            return <span className="pjv3-rowbadge dim" title={`앞 작업 '${af.name}' 이(가) 끝난 뒤`}>⛓</span>;
          })()}
          <span className="min-w-0 flex-1"><EditCell it={it} colKey="name" value={it.name} align="left" /></span>
          {/* ₩ — 견적·청구를 켠 프로젝트의 들어가는 문(2026-09-01 사장님 "달라지는 게 없다" — 효과가 서랍에만 숨어 있었다).
              문서가 붙은 줄은 항상 보이고(견적=파랑·계약=초록), 나머지는 호버에만. 누르면 서랍(돈 구역이 맨 위) */}
          {featOn("billing") && depth === 0 && (() => {
            const hasC = !!(it.fields as Record<string, unknown>)?.[CONTRACT_KEY];
            const hasQ = !!(it.fields as Record<string, unknown>)?.[QUOTE_KEY];
            return (
              <button type="button" className={`pjv3-money-badge ${hasC ? "c" : hasQ ? "q" : ""}`}
                title={hasC ? "계약까지 진행됨 — 돈 구역 열기" : hasQ ? "견적 있음 — 돈 구역 열기" : "이 줄로 견적부터 청구까지 — 돈 구역 열기"}
                onClick={() => setDrawerId(it.id)}>₩</button>
            );
          })()}
          <button type="button" className="pjv3-open" title="이 줄 열기 — 체크리스트·기록·팔로워"
            onClick={() => setDrawerId(it.id)}>열기</button>
        </span>
      </td>
      {allCols.map((ac) => {
        //   내장 4열 — 통합 순서의 자리에서 그대로 렌더(숨기면 여기 안 온다)
        if (ac.builtin === "assignee") {
          return <td key={ac.key}><button type="button" className="pjv3-cell" title={assigneesOf(it).map(userName).filter(Boolean).join(", ")}
            onClick={(e) => setPop({ kind: "person", itemId: it.id, ...at(e) })}>
            {assigneeLabel(it) || <span className="text-[var(--text-dim)]">—</span>}</button></td>;
        }
        if (ac.builtin === "status") {
          return <td key={ac.key}><button type="button" className="pjv3-stcell" style={{ background: STAGE_HEX[stageOf(it.status)?.color || "gray"] }}
            onClick={(e) => setPop({ kind: "status", itemId: it.id, ...at(e) })}>
            {stageOf(it.status)?.label || it.status}</button></td>;
        }
        if (ac.builtin === "due") {
          return <td key={ac.key} className="pjv3-ecell mono-number"><EditCell it={it} colKey="due_date" value={it.due_date || ""} type="date" /></td>;
        }
        if (ac.builtin === "amount") {
          //   하위가 있으면 '총(자기+하위 합)' — 눌러서 부모 자신의 값을 고칠 수 있다
          const roll = kids.length > 0 ? rollNum(it, (x) => Number(x.plan_amount) || 0) : null;
          const editing = edit?.itemId === it.id && edit?.colKey === "plan_amount";
          if (roll != null && !editing) {
            return <td key={ac.key} className="pjv3-ecell mono-number">
              <span className="pjv3-cell pjv3-rollcell" title={`자기 ${(Number(it.plan_amount) || 0).toLocaleString("ko-KR")} + 하위 ${kids.length}건 합 — 누르면 자기 값 수정`}
                onClick={() => setEdit({ itemId: it.id, colKey: "plan_amount" })}>총 {roll.toLocaleString("ko-KR")}</span></td>;
          }
          return <td key={ac.key} className="pjv3-ecell mono-number">
            <EditCell it={it} colKey="plan_amount" value={it.plan_amount == null ? "" : String(it.plan_amount)} type="number" />
          </td>;
        }
        const c = ac.col!;
        const raw = (it.fields || {})[c.key];
        const val = raw == null ? "" : String(raw);
        //   자유도 타입들(2026-09-01 사장님 1·2차+평점·위치 전부 승인)
        if (c.type === "check") {
          const on = raw === true || raw === "true";
          return <td key={ac.key} className="pjv3-checkcell">
            <input type="checkbox" checked={on} aria-label={c.name} onChange={() => saveField(it, c.key, !on)} /></td>;
        }
        if (c.type === "rating") {
          const n = Math.max(0, Math.min(5, Number(raw) || 0));
          return <td key={ac.key} className="pjv3-ratecell">
            {[1, 2, 3, 4, 5].map((k) => (
              <span key={k} className={k <= n ? "on" : ""} title={`${k}점${k === n ? " — 다시 누르면 지움" : ""}`}
                onClick={() => saveField(it, c.key, k === n ? null : k)}>★</span>
            ))}</td>;
        }
        if (c.type === "url" || c.type === "tel" || c.type === "place") {
          if (edit?.itemId === it.id && edit?.colKey === c.key) {
            return <td key={ac.key} className="pjv3-ecell"><EditCell it={it} colKey={c.key} value={val} type="text" /></td>;
          }
          if (!val) return <td key={ac.key} className="pjv3-ecell"><span className="pjv3-cell text-[var(--text-dim)]"
            onClick={() => setEdit({ itemId: it.id, colKey: c.key })}>—</span></td>;
          const href = c.type === "url" ? (/^https?:\/\//.test(val) ? val : `https://${val}`)
            : c.type === "tel" ? `tel:${val.replace(/[^0-9+]/g, "")}`
            : `https://map.naver.com/p/search/${encodeURIComponent(val)}`;
          return <td key={ac.key} className="pjv3-linkcell">
            <a href={href} target={c.type === "tel" ? undefined : "_blank"} rel="noreferrer"
              title={c.type === "place" ? "누르면 네이버 지도 검색" : c.type === "tel" ? "누르면 전화 걸기" : "누르면 새 창"}>{val}</a>
            <button type="button" className="pjv3-linkedit" title="고치기" onClick={() => setEdit({ itemId: it.id, colKey: c.key })}>✎</button>
          </td>;
        }
        if (c.type === "longtext") {
          return <td key={ac.key} className="pjv3-longcell">
            <span className={`pjv3-cell !text-left ${val ? "" : "text-[var(--text-dim)]"}`}
              onClick={(e) => setPop({ kind: "longtext", itemId: it.id, colKey: c.key, ...at(e) })}>{val || "—"}</span></td>;
        }
        if (c.type === "auto") {
          const src = (c.settings as { mode?: string } | null)?.mode === "created" ? (it as any).created_at : (it as any).updated_at;
          return <td key={ac.key} className="mono-number text-xs text-[var(--text-dim)]">
            {src ? String(src).slice(5, 16).replace("T", " ") : "—"}</td>;
        }
        if (c.type === "formula") {
          const r = fxEval(it, c);
          return <td key={ac.key} className="pjv3-ecell mono-number">
            <span className="pjv3-cell" title={r.error || `수식: ${String((c.settings as { expr?: string } | null)?.expr || "")} — 누르면 고치기`}
              onClick={(e) => setPop({ kind: "formula", colKey: c.key, ...at(e) })}>
              {r.error ? <span className="text-[var(--danger)]">⚠ 수식 확인</span> : r.value == null ? "—" : r.value.toLocaleString("ko-KR")}
            </span></td>;
        }
        if (c.type === "files") {
          const list = Array.isArray(raw) ? (raw as { name: string; path: string }[]) : [];
          return <td key={ac.key}><button type="button" className="pjv3-cell"
            onClick={(e) => setPop({ kind: "files", itemId: it.id, colKey: c.key, ...at(e) })}>
            {list.length > 0 ? `📎 ${list.length}` : <span className="text-[var(--text-dim)]">—</span>}</button></td>;
        }
        if (c.type === "ovlink") {
          const lk = raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as { src: string; id: string; title: string; file_url?: string }) : null;
          return <td key={ac.key} className="pjv3-linkcell">
            {lk ? (
              <a href={lk.src === "board" ? `/board?post=${lk.id}` : lk.src === "sign" ? "/signatures" : "#"}
                onClick={(e) => { if (lk.src === "doc") { e.preventDefault(); openStoredFile(lk); } }}
                title={lk.src === "board" ? "게시글로 이동" : lk.src === "sign" ? "전자계약으로 이동" : "파일 열기"}>
                {lk.src === "board" ? "📋" : lk.src === "sign" ? "✍" : "🗂"} {lk.title}</a>
            ) : (
              <span className="pjv3-cell text-[var(--text-dim)]"
                onClick={(e) => { setOvQ(""); setPop({ kind: "ovlink", itemId: it.id, colKey: c.key, ...at(e) }); }}>—</span>
            )}
            {lk && <button type="button" className="pjv3-linkedit" title="바꾸기"
              onClick={(e) => { setOvQ(""); setPop({ kind: "ovlink", itemId: it.id, colKey: c.key, ...at(e) }); }}>✎</button>}
          </td>;
        }
        if (c.type === "select") {
          const opt = (c.settings?.options || []).find((o) => o.id === val || o.label === val);
          //   옵션에 색이 있으면 상태 셀처럼 색으로 채운다 — 가로 흐름이 색으로 읽힌다(monday 문법)
          if (opt?.color) {
            return <td key={c.id}><button type="button" className="pjv3-stcell" style={{ background: opt.color }}
              onClick={(e) => setPop({ kind: "select", itemId: it.id, colKey: c.key, ...at(e) })}>{opt.label}</button></td>;
          }
          return <td key={c.id}><button type="button" className="pjv3-cell" onClick={(e) => setPop({ kind: "select", itemId: it.id, colKey: c.key, ...at(e) })}>
            {opt?.label || val || <span className="text-[var(--text-dim)]">—</span>}</button></td>;
        }
        if (c.type === "person") {
          return <td key={c.id}><button type="button" className="pjv3-cell" onClick={(e) => setPop({ kind: "person", itemId: it.id, colKey: c.key, ...at(e) })}>
            {userName(val || null) || val || <span className="text-[var(--text-dim)]">—</span>}</button></td>;
        }
        if (c.type === "partner") {
          return <td key={c.id}><button type="button" className="pjv3-cell"
            onClick={(e) => { setPartnerQ(""); setPop({ kind: "partner", itemId: it.id, colKey: c.key, ...at(e) }); }}>
            {val || <span className="text-[var(--text-dim)]">—</span>}</button></td>;
        }
        if (c.type === "number" && kids.length > 0) {
          const roll = rollNum(it, (x) => Number((x.fields || {})[c.key]) || 0);
          const rEditing = edit?.itemId === it.id && edit?.colKey === c.key;
          if (roll != null && !rEditing) {
            return <td key={c.id} className="pjv3-ecell mono-number">
              <span className="pjv3-cell pjv3-rollcell" title={`하위 ${kids.length}건 합 포함 — 누르면 자기 값 수정`}
                onClick={() => setEdit({ itemId: it.id, colKey: c.key })}>총 {roll.toLocaleString("ko-KR")}</span></td>;
          }
        }
        return <td key={c.id} className={`pjv3-ecell ${c.type === "number" ? "mono-number" : ""}`}>
          <EditCell it={it} colKey={c.key} value={val} type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"} /></td>;
      })}
      <td className="pjv3-rowdel">
        <button type="button" className={`pjv3-del ${delArm === `item:${it.id}` ? "arm" : ""}`}
          title={kids.length > 0 ? `이 줄 지우기 — 하위 ${kids.length}개도 같이 지워집니다` : "이 줄 지우기"}
          onClick={() => armOrRun(`item:${it.id}`, () => deleteItem(it.id))}>
          {delArm === `item:${it.id}` ? (kids.length > 0 ? `하위 ${kids.length}개도 같이 — 한 번 더` : "한 번 더") : "✕"}
        </button>
      </td>
    </tr>
  );
  };
  const subAddRow = (parent: ItemRow) => (
    <tr key={`sub-${parent.id}`} className="pjv3-sub pjv3-subadd">
      <td colSpan={totalCols}>
        <input placeholder="＋ 하위 작업 적고 Enter — 담당·선택 값은 부모를 복사해 시작합니다"
          onKeyDown={(e) => {
            const v = (e.target as HTMLInputElement).value;
            if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) {
              addSubItem(parent, v.trim()); (e.target as HTMLInputElement).value = "";
            }
          }} />
      </td>
    </tr>
  );

  return (
    <div className="pjv3-wrap">
      {/* 한 상자 — 제목·보기·검색·표 전부 이 안(2026-08-31 사장님: 다른 메뉴처럼 한 박스로) */}
      <div className="pjv3-box">
      <div className="pjv3-head">
        <h1>{deal.name}</h1>
        {period && <span className="pjv3-head-sub mono-number">{period}</span>}
        <span className="pjv3-head-sub">표가 곧 입력입니다 — 다른 보기는 ＋ 보기로 켭니다</span>
        <button type="button" className="btn-secondary btn-sm ml-auto" title="업무에 맞는 시작 양식을 예시로 보고 채웁니다"
          onClick={() => { pickCat(TPL_CATEGORIES[0]); setTplOpen(true); }}>템플릿</button>
      </div>

      {/* 보기 줄 — 표가 기본, 칸반은 '표를 보는 형태'(결정 130). 간트·캘린더·현황은 다음 단계 */}
      <div className="pjv3-views">
        <button type="button" className={`pjv3-vchip ${curView === "table" ? "on" : ""}`} onClick={() => setCurView("table")}>표</button>
        {views.filter((v) => VIEW_LABELS[v]).map((v) => (
          <button key={v} type="button" className={`pjv3-vchip ${curView === v ? "on" : ""}`}
            onClick={() => setCurView(v as "kanban" | "calendar")}>
            {VIEW_LABELS[v]}
            {curView === v && <span className="x" title="이 보기 빼기" onClick={(e) => { e.stopPropagation(); removeView(v); }}>✕</span>}
          </button>
        ))}
        <button type="button" className="pjv3-addview" onClick={(e) => setPop({ kind: "addview", ...at(e) })}>＋ 보기</button>
        <button type="button" className="pjv3-addview" title="반복·앞뒤 순서 같은 기능을 이 프로젝트에만 켭니다"
          onClick={(e) => setPop({ kind: "features", ...at(e) })}>＋ 기능{features.length > 0 && <em className="num" style={{ fontStyle: "normal" }}> {features.length}</em>}</button>
      </div>

      <div className="pjv3-toolbar">
        <span className="pjv3-search">🔍<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 담당 · 칸에 든 글자 — 검색" aria-label="검색" /></span>
        <button type="button" className="btn-secondary btn-sm" onClick={(e) => setPop({ kind: "excel", ...at(e) })}>엑셀 ▾</button>
        {featOn("survey") && (
          <button type="button" className="btn-secondary btn-sm" title="외부에 링크로 설문을 보내고 응답을 이 표에 받습니다"
            onClick={() => setSvOpen(true)}>설문</button>
        )}
        <button type="button" className="btn-secondary btn-sm" title="보관한 줄 보기·되살리기" onClick={() => setArchOpen(true)}>보관함</button>
        <span className="pjv3-count num">{shown.length}건{shown.length !== items.length ? ` / 전체 ${items.length}` : ""}</span>
      </div>

      {curView === "gantt" ? (
        <div className="pjv3-ganttwrap">
          <div className="pjv3-gr pjv3-gr-head">
            <div className="pjv3-gname">이름</div>
            <div className="pjv3-glane pjv3-ghead">
              {gantt.ticks.map((t) => <span key={t.label} className="tick num" style={{ left: `${t.left}%` }}>{t.label}</span>)}
              {gantt.todayLeft != null && <span className="todayline" style={{ left: `${gantt.todayLeft}%` }} />}
            </div>
          </div>
          {[...stages, { id: "__etc", label: "단계 밖", color: "gray" as const }].map((s) => {
            const src = s.id === "__etc" ? byStage.etc : (byStage.m.get(s.id) || []);
            const group = src.filter((it) => it.due_date || (it as any).start_date);
            if (group.length === 0) return null;
            return (
              <div key={s.id}>
                <div className="pjv3-ggroup" style={{ borderLeftColor: STAGE_HEX[s.color] }}>{s.label}</div>
                {group.map((it) => {
                  const a = ((it as any).start_date || it.due_date) as string;
                  const b = (it.due_date || (it as any).start_date) as string;
                  const [from, to] = a <= b ? [a, b] : [b, a];
                  const left = gantt.pctOf(from);
                  const width = Math.max(gantt.pctOf(to) - left + gantt.dayW, gantt.dayW);
                  return (
                    <div key={it.id} className="pjv3-gr" role="button" tabIndex={0} title="누르면 서랍 — 시작일·마감도 거기서"
                      onClick={() => setDrawerId(it.id)}>
                      <div className="pjv3-gname">{it.name}</div>
                      <div className="pjv3-glane">
                        {gantt.todayLeft != null && <span className="todayline" style={{ left: `${gantt.todayLeft}%` }} />}
                        <span className="bar" style={{ left: `${left}%`, width: `${width}%`, background: STAGE_HEX[s.color] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {gantt.dated.length === 0 && <div className="collect-empty">날짜가 있는 항목이 없습니다 — 서랍이나 마감 셀에서 날짜를 채우면 막대가 나타납니다</div>}
          {gantt.undatedCount > 0 && <div className="pjv3-tpl-mine">시작일·마감일이 없는 항목 {gantt.undatedCount}개는 간트에 안 보입니다 — 서랍에서 날짜를 채우면 나타납니다</div>}
        </div>
      ) : curView === "calendar" ? (
        <div className="pjv3-calwrap">
          <div className="pjv3-calhead">
            <button type="button" onClick={() => setCalMonth((m) => m - 1)}>◀</button>
            <b className="num">{calCells.y}년 {calCells.m + 1}월</b>
            <button type="button" onClick={() => setCalMonth((m) => m + 1)}>▶</button>
            {calMonth !== 0 && <button type="button" className="pjv3-addview" onClick={() => setCalMonth(0)}>이번 달</button>}
            <span className="pjv3-head-sub">마감일 기준 — 칩을 누르면 서랍, 날짜의 ＋로 그 날짜 마감 항목 추가</span>
          </div>
          <div className="pjv3-calgrid">
            {["일", "월", "화", "수", "목", "금", "토"].map((d) => <div key={d} className="pjv3-caldow">{d}</div>)}
            {calCells.cells.map((c) => {
              const dayItems = byDue.get(c.date) || [];
              return (
                <div key={c.date} className={`pjv3-calcell ${c.inMonth ? "" : "out"} ${c.isToday ? "today" : ""}`}>
                  <div className="d num">{c.day}
                    <button type="button" className="pjv3-caladd" title="이 날짜 마감으로 추가"
                      onClick={(e) => setPop({ kind: "addcal", date: c.date, ...at(e) })}>＋</button>
                  </div>
                  {dayItems.map((it) => (
                    <button key={it.id} type="button" className="pjv3-calchip"
                      style={{ background: STAGE_HEX[stages.find((s) => s.id === it.status)?.color || "gray"] }}
                      title={`${it.name} — 누르면 서랍`} onClick={() => setDrawerId(it.id)}>{it.name}</button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : curView === "kanban" ? (
        <div className="pjv3-kbwrap">
          <div className="pjv3-kb">
            {stages.map((s) => {
              const group = byStage.m.get(s.id) || [];
              return (
                <div key={s.id} className={`pjv3-kcol ${dragOverStage === s.id ? "dragover" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverStage(s.id); }}
                  onDragLeave={() => setDragOverStage((cur) => (cur === s.id ? null : cur))}
                  onDrop={() => dropTo(s.id)}>
                  <h3><span className="dot" style={{ background: STAGE_HEX[s.color] }} />{s.label}<span className="cnt num">{group.length}</span></h3>
                  <div className="pjv3-kcards">
                    {group.map((it) => {
                      const late = it.due_date && it.status !== stages[stages.length - 1]?.id && it.due_date < new Date().toISOString().slice(0, 10);
                      return (
                        <div key={it.id} className="pjv3-kc" draggable role="button" tabIndex={0}
                          title="누르면 서랍 — 체크리스트·기록·팔로워" onClick={() => setDrawerId(it.id)}
                          onDragStart={() => { dragIdRef.current = it.id; }} onDragEnd={() => { dragIdRef.current = null; setDragOverStage(null); }}>
                          <div className="tt">{it.name}</div>
                          {(assigneesOf(it).length > 0 || it.due_date || it.plan_amount != null) && (
                            <div className="meta">
                              {assigneeLabel(it) && <span>{assigneeLabel(it)}</span>}
                              {it.due_date && <span className={`mono-number ${late ? "late" : ""}`}>{it.due_date}</span>}
                              {it.plan_amount != null && <span className="mono-number">{Number(it.plan_amount).toLocaleString("ko-KR")}</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="pjv3-kadd">
                    <input placeholder={`＋ ${s.label}에 추가`}
                      onKeyDown={(e) => {
                        const v = (e.target as HTMLInputElement).value;
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) {
                          addItem(s.id, v.trim()); (e.target as HTMLInputElement).value = "";
                        }
                      }} />
                  </div>
                </div>
              );
            })}
            {byStage.etc.length > 0 && (
              <div className={`pjv3-kcol ${dragOverStage === "__etc" ? "dragover" : ""}`}>
                <h3><span className="dot" style={{ background: STAGE_HEX.gray }} />단계 밖<span className="cnt num">{byStage.etc.length}</span></h3>
                <div className="pjv3-kcards">
                  {byStage.etc.map((it) => (
                    <div key={it.id} className="pjv3-kc" draggable role="button" tabIndex={0}
                          title="누르면 서랍 — 체크리스트·기록·팔로워" onClick={() => setDrawerId(it.id)}
                      onDragStart={() => { dragIdRef.current = it.id; }} onDragEnd={() => { dragIdRef.current = null; setDragOverStage(null); }}>
                      <div className="tt">{it.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
      <div className="pjv3-sheetwrap">
        <table className="pjv3-sheet">
          <thead><tr>
            <th className="!text-left" style={{ minWidth: 220 }}>이름</th>
            {allCols.map((ac) => (
              <th key={ac.key} style={{ minWidth: ac.minW }}
                className={colDropAt === ac.key ? "pjv3-coldrop" : ""}
                title={ac.title || `${ac.label}${ac.col ? ` (${FIELD_TYPES.find((t) => t.id === ac.col!.type)?.label || ac.col!.type})` : ""} — 눌러서 이름, 끌어서 순서`}
                draggable={colEdit !== ac.key}
                onDragStart={(e) => { colDragRef.current = ac.key; e.dataTransfer.setData("text/plain", ac.key); }}
                onDragEnd={() => { colDragRef.current = null; setColDropAt(null); }}
                onDragOver={(e) => { if (colDragRef.current && colDragRef.current !== ac.key) { e.preventDefault(); setColDropAt(ac.key); } }}
                onDragLeave={() => setColDropAt((cur) => (cur === ac.key ? null : cur))}
                onDrop={() => moveAnyCol(ac.key)}>
                {colEdit === ac.key ? (
                  <input ref={colEditRef} className="pjv3-coledit" defaultValue={ac.label}
                    onBlur={(e) => (ac.builtin ? renameBuiltin(ac.builtin, e.target.value) : renameColumn(ac.col!, e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setColEdit(null);
                    }} />
                ) : (
                  <span className="pjv3-colname" onClick={() => setColEdit(ac.key)}>{ac.label}</span>
                )}
                <button type="button" className={`pjv3-del ${delArm === `col:${ac.key}` ? "arm" : ""}`}
                  title={ac.builtin ? "이 열 숨기기 — 오른쪽 ＋에서 되살립니다" : "이 컬럼 지우기 — 칸에 적은 값은 남습니다"}
                  onClick={() => armOrRun(`col:${ac.key}`, () => (ac.builtin ? hideBuiltin(ac.builtin!) : deleteColumn(ac.col!)))}>
                  {delArm === `col:${ac.key}` ? "한 번 더" : "✕"}
                </button>
              </th>
            ))}
            <th className="pjv3-colplus" title="컬럼 추가 — 글·숫자·날짜·선택·사람·거래처 · 숨긴 열 되살리기"
              onClick={(e) => setPop({ kind: "addcol", ...at(e as unknown as React.MouseEvent) })}>＋</th>
          </tr></thead>
          <tbody>
            {stages.map((s, sIdx) => {
              const group = byStage.m.get(s.id) || [];
              const folded = collapsedG.has(s.id);
              const isLast = sIdx === stages.length - 1;
              return [
                <tr key={`g-${s.id}`}>
                  <td colSpan={totalCols} className="pjv3-grow"
                    style={{ borderLeftColor: STAGE_HEX[s.color], background: `color-mix(in srgb, ${STAGE_HEX[s.color]} 7%, var(--bg-card))` }}>
                    <button type="button" className={`pjv3-gfold ${folded ? "" : "open"}`} title={folded ? "그룹 펼치기" : "그룹 접기"}
                      onClick={() => toggleCollapse(s.id)}>▶</button>
                    {stageEdit === s.id ? (
                      <input ref={stageEditRef} className="pjv3-grow-edit" defaultValue={s.label}
                        onBlur={(e) => renameStage(s.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setStageEdit(null);
                        }} />
                    ) : (
                      <span className="pjv3-grow-label" title="눌러서 그룹 이름 바꾸기" onClick={() => setStageEdit(s.id)}>{s.label}</span>
                    )}
                    <em className="num">{group.length}</em>
                    {isLast && group.length > 0 && (
                      <button type="button" className={`pjv3-garch ${delArm === `arch:${s.id}` ? "arm" : ""}`}
                        title="이 그룹의 줄을 보관함으로 치웁니다 — 언제든 되살릴 수 있습니다"
                        onClick={(e) => { e.stopPropagation(); armOrRun(`arch:${s.id}`, () => archiveGroup(s.id)); }}>
                        {delArm === `arch:${s.id}` ? `${group.length}건 보관 — 한 번 더` : "보관"}
                      </button>
                    )}
                    {stages.length > 1 && (
                      <button type="button"
                        className={`pjv3-del ${delArm === `stage:${s.id}` ? "arm" : ""}`}
                        title={group.length > 0 ? "이 그룹 지우기 — 항목은 맨 위 그룹으로 옮겨집니다" : "이 그룹 지우기"}
                        onClick={(e) => { e.stopPropagation(); armOrRun(`stage:${s.id}`, () => deleteStage(s.id)); }}>
                        {delArm === `stage:${s.id}` ? (group.length > 0 ? `${group.length}개 옮기고 지우기 — 한 번 더` : "한 번 더") : "✕"}
                      </button>
                    )}
                  </td>
                </tr>,
                ...(folded ? [] : group.flatMap((gi) => {
                  const kk = childrenOf.get(gi.id) || [];
                  const op = expanded.has(gi.id);
                  return [renderRow(gi, 0), ...(op ? kk.map((k) => renderRow(k, 1)) : []), ...(op ? [subAddRow(gi)] : [])];
                })),
                ...(folded ? [] : [
                <tr key={`a-${s.id}`} className={`pjv3-addrow ${rowDropAt === `end:${s.id}` ? "pjv3-dropbefore" : ""}`}
                  onDragOver={(e) => { if (rowDragRef.current) { e.preventDefault(); setRowDropAt(`end:${s.id}`); } }}
                  onDragLeave={() => setRowDropAt((cur) => (cur === `end:${s.id}` ? null : cur))}
                  onDrop={() => moveRow(`end:${s.id}`)}>
                  <td colSpan={totalCols}>
                    <input placeholder={`＋ ${s.label}에 적고 Enter — 담당·마감은 셀에서 바로`}
                      onKeyDown={(e) => {
                        const v = (e.target as HTMLInputElement).value;
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) {
                          addItem(s.id, v.trim()); (e.target as HTMLInputElement).value = "";
                        }
                      }} />
                  </td>
                </tr>]),
              ];
            })}
            <tr key="addgroup" className="pjv3-addgroup">
              <td colSpan={totalCols}>
                <button type="button" onClick={addStage}>＋ 새 그룹</button>
              </td>
            </tr>
            {byStage.etc.length > 0 && [
              <tr key="g-etc"><td colSpan={totalCols} className="pjv3-grow" style={{ borderLeftColor: STAGE_HEX.gray }}>
                단계 밖<em className="num">{byStage.etc.length}</em></td></tr>,
              ...byStage.etc.flatMap((gi) => {
                const kk = childrenOf.get(gi.id) || [];
                const op = expanded.has(gi.id);
                return [renderRow(gi, 0), ...(op ? kk.map((k) => renderRow(k, 1)) : []), ...(op ? [subAddRow(gi)] : [])];
              }),
            ]}
            {(shown.length > 0 || numberCols.length > 0) && (
              <tr className="pjv3-sumrow">
                <td className="!text-left num">{shown.length}건</td>
                {allCols.map((ac) => {
                  if (ac.builtin === "status") return <td key={ac.key} className="font-bold">{stages.map((s) => `${s.label} ${(byStage.m.get(s.id) || []).length}`).join(" · ")}</td>;
                  if (ac.builtin === "amount") return <td key={ac.key} className="mono-number font-bold">{shown.reduce((s, it) => s + (rollNum(it, (x) => Number(x.plan_amount) || 0) ?? (Number(it.plan_amount) || 0)), 0).toLocaleString("ko-KR")}</td>;
                  if (ac.col?.type === "number") return <td key={ac.key} className="mono-number font-bold">{shown.reduce((s, it) => { const g = (x: ItemRow) => Number((x.fields || {})[ac.col!.key]) || 0; return s + (rollNum(it, g) ?? g(it)); }, 0).toLocaleString("ko-KR")}</td>;
                  if (ac.col?.type === "check") { const done = shown.filter((it) => (it.fields || {})[ac.col!.key] === true).length; return <td key={ac.key} className="num font-bold">{done}/{shown.length}</td>; }
                  if (ac.col?.type === "rating") { const vs = shown.map((it) => Number((it.fields || {})[ac.col!.key]) || 0).filter((v) => v > 0); return <td key={ac.key} className="num font-bold">{vs.length ? `★ ${(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(1)}` : ""}</td>; }
                  if (ac.col?.type === "formula") { const sum = shown.reduce((s, it) => { const r = fxEval(it, ac.col!); return s + (r.value ?? 0); }, 0); return <td key={ac.key} className="mono-number font-bold">{sum.toLocaleString("ko-KR")}</td>; }
                  return <td key={ac.key}></td>;
                })}
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      {selIds.size > 0 && (
        <div className="pjv3-qselbar">
          <b className="qk-selbar-n">{selIds.size}건 선택</b>
          <div className="qk-selbar-right">
            <button type="button" onClick={clearSel} className="qk-selbar-clear">선택 해제</button>
            <button type="button" className="btn-secondary btn-sm" onClick={(e) => setPop({ kind: "bulkstatus", ...atUp(e) })}>그룹·상태 바꾸기</button>
            <button type="button" className="btn-secondary btn-sm" onClick={(e) => setPop({ kind: "bulkassign", ...atUp(e) })}>담당 바꾸기</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => armOrRun("bulk:del", bulkDelete)}>{delArm === "bulk:del" ? "한 번 더" : "지우기"}</button>
            <button type="button" className="btn-primary btn-sm" onClick={() => { const last = stages[stages.length - 1]; if (last) bulkStatus(last.id); }}>
              {stages[stages.length - 1]?.label || "완료"}(으)로
            </button>
          </div>
        </div>
      )}
      <p className="pjv3-foot">
        {curView === "kanban"
          ? "카드를 끌어 다른 열에 놓으면 상태가 바뀝니다(표의 상태 셀과 같은 저장) · 카드를 누르면 서랍 · 열 아래 칸에 적고 Enter로 추가"
          : curView === "calendar"
            ? "마감일이 있는 항목만 보입니다 — 칩을 누르면 서랍 · 날짜의 ＋로 그 날짜 마감 항목 추가"
            : "셀은 눌러서 그 자리 수정 · 이름 칸 '열기'로 체크리스트·기록·팔로워 · ⋮⋮ 끌어 순서·그룹 이동 · 컬럼 머리단은 눌러 이름, 끌어 순서 · ✕는 한 번 더 눌러 지우기"}
      </p>
      </div>

      {/* ── 견적·계약·계산서 팝업 — 기존 BoardDocModal 그대로(품목표·결제조건·PDF 미리보기·발송) ── */}
      {docModal && deal && (() => {
        const it = items.find((i) => i.id === docModal.itemId);
        if (!it) return null;
        const q = docLinkOf(it, QUOTE_KEY);
        const c = docLinkOf(it, CONTRACT_KEY);
        const linkedId = docModal.kind === "contract" ? c?.id : docModal.kind === "quote" ? q?.id : null;
        const doc = (dealDocs as any[]).find((d) => d.id === linkedId) || null;
        const quoteDoc = (dealDocs as any[]).find((d) => d.id === q?.id) || null;
        const pName = rowPartnerName(it);
        const pRow = partners.find((x) => x.name === pName) || null;
        return (
          <BoardDocModal
            kind={docModal.kind} rowName={it.name || ""} doc={doc} draft={docModal.draft || null}
            onCreate={createDocFromDraft}
            amount={rowAmount(it)}
            partnerName={pName} partnerId={pRow?.id || null}
            companyId={companyId!} dealId={dealId} userId={user?.id}
            quoteDoc={quoteDoc} hasContract={!!c}
            onAmountChange={(supply) => { if ((childrenOf.get(it.id) || []).length === 0) saveItem(it.id, { plan_amount: supply }); }}
            onQuoteReplaced={(d) => saveField(it, QUOTE_KEY, d)}
            onClose={() => { setDocModal(null); qc.invalidateQueries({ queryKey: ["pjv3-docs", dealId] }); }}
            onIssued={() => qc.invalidateQueries({ queryKey: ["pjv3-docs", dealId] })}
          />
        );
      })()}

      {/* ── 보관함 — 보관·삭제된 줄 되살리기 ── */}
      {archOpen && (
        <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) setArchOpen(false); }}>
          <div className="phv3-modal" role="dialog" aria-modal="true" aria-label="보관함">
            <h3 className="phv3-modal-title">보관함 — 되살리면 원래 그룹으로 돌아갑니다</h3>
            {archived.length === 0 && <div className="pjv3-tpl-mine">보관된 줄이 없습니다 — 완료 그룹의 '보관'이나 줄 ✕로 치운 것이 여기 모입니다</div>}
            {archived.map((a) => (
              <div key={a.id} className="pjv3-arch-row">
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="num text-[10px] text-[var(--text-dim)]">{a.archived_at.slice(5, 10)}</span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => restoreItem(a.id)}>↩ 되살리기</button>
              </div>
            ))}
            <div className="phv3-modal-actions"><button type="button" className="btn-secondary btn-sm" onClick={() => setArchOpen(false)}>닫기</button></div>
          </div>
        </div>
      )}

      {/* ── 설문 설정 — 컬럼이 곧 질문. 저장 후 '설문 켜기'로 외부 링크가 산다 ── */}
      {svOpen && deal && (
        <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSvOpen(false); }}>
          <div className="phv3-modal" role="dialog" aria-modal="true" aria-label="설문 보내기">
            <h3 className="phv3-modal-title">설문 보내기 — 응답 1건이 표의 줄 1개가 됩니다</h3>
            <div className="pjv3-sv-field"><label>설문 제목(외부에 보임)</label>
              <input type="text" value={svForm.title} onChange={(e) => setSvForm((f) => ({ ...f, title: e.target.value }))} /></div>
            <div className="pjv3-sv-field"><label>안내문 — 길게 써도 됩니다(문단·줄바꿈 그대로 보임)</label>
              <textarea rows={5} value={svForm.intro} onChange={(e) => setSvForm((f) => ({ ...f, intro: e.target.value }))}
                placeholder={"안녕하세요, ○○입니다.\n설문 취지·경품·개인정보 안내·마감일을 자유롭게 적으세요."} /></div>
            <div className="pjv3-sv-field"><label>배너 이미지 — 맨 위에 크게(가로형 권장)</label>
              <div className="flex items-center gap-2">
                {svForm.banner ? <span className="text-[11px] text-[var(--text-dim)]">배너 1장 올라감</span> : <span className="text-[11px] text-[var(--text-dim)]">없음</span>}
                {svForm.banner && <button type="button" className="pjv3-del !opacity-100" onClick={() => setSvForm((f) => ({ ...f, banner: null }))}>✕</button>}
                <label className="btn-secondary btn-sm ml-auto cursor-pointer">올리기
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSurveyImg(f, "banner"); e.target.value = ""; }} /></label>
              </div></div>
            <div className="pjv3-sv-field"><label>안내문 아래 이미지 — 메뉴판·약도·포스터 등 여러 장</label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-dim)]">{svForm.images.length}장</span>
                {svForm.images.length > 0 && <button type="button" className="pjv3-del !opacity-100" title="마지막 장 빼기"
                  onClick={() => setSvForm((f) => ({ ...f, images: f.images.slice(0, -1) }))}>✕</button>}
                <label className="btn-secondary btn-sm ml-auto cursor-pointer">＋ 추가
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSurveyImg(f, "image"); e.target.value = ""; }} /></label>
              </div></div>
            <div className="pjv3-sv-field"><label>이름 칸을 뭐라고 물을까요(항상 필수)</label>
              <input type="text" value={svForm.nameLabel} onChange={(e) => setSvForm((f) => ({ ...f, nameLabel: e.target.value }))} /></div>
            <div className="pjv3-sv-field"><label>질문으로 내보낼 컬럼 — 배지를 눌러 필수/선택</label>
              {svCols.length === 0 && <div className="pjv3-tpl-mine">내보낼 수 있는 컬럼이 없습니다 — 글·선택·평점 같은 컬럼을 먼저 만드세요(담당·수식·첨부는 설문에 못 나갑니다)</div>}
              {svCols.map((c) => {
                const st = svForm.q[c.key] || { on: false, required: false };
                return (
                  <div key={c.key} className="pjv3-sv-qrow">
                    <input type="checkbox" checked={st.on} aria-label={c.name}
                      onChange={() => setSvForm((f) => ({ ...f, q: { ...f.q, [c.key]: { ...st, on: !st.on } } }))} />
                    {c.name}
                    <span className="ty">{FIELD_TYPES.find((t) => t.id === c.type)?.label}</span>
                    {st.on && (
                      <span className={`pjv3-sv-req ${st.required ? "on" : ""}`}
                        onClick={() => setSvForm((f) => ({ ...f, q: { ...f.q, [c.key]: { ...st, required: !st.required } } }))}>
                        {st.required ? "필수" : "선택"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="pjv3-sv-field"><label>응답이 들어올 그룹</label>
              <select value={svForm.stage} onChange={(e) => setSvForm((f) => ({ ...f, stage: e.target.value }))}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select></div>
            <div className="pjv3-sv-field"><label>받는 조건 — 비워 두면 제한 없음</label>
              <div className="pjv3-sv-limits">
                <span>마감일</span>
                <input type="date" value={svForm.closesAt} aria-label="마감일"
                  onChange={(e) => setSvForm((f) => ({ ...f, closesAt: e.target.value }))} />
                <span>최대 응답</span>
                <input type="text" inputMode="numeric" placeholder="제한 없음" value={svForm.maxResp} aria-label="최대 응답 수"
                  onChange={(e) => setSvForm((f) => ({ ...f, maxResp: e.target.value.replace(/[^0-9]/g, "") }))} />
                <label className="chk">
                  <input type="checkbox" checked={svForm.preventDup}
                    onChange={(e) => setSvForm((f) => ({ ...f, preventDup: e.target.checked }))} /> 1인 1회
                </label>
              </div>
              {svForm.preventDup && (
                <p className="pjv3-sv-hint">같은 기기·같은 인터넷망의 재제출을 막습니다 — 한 사무실(같은 와이파이)의 여러 명이 한 사람으로 잡힐 수 있으니 행사 신청처럼 여럿이 함께 내는 설문에는 끄세요.</p>
              )}</div>
            {survey?.token && (
              <div className="pjv3-sv-link">
                <code>{surveyUrl}</code>
                <button type="button" className="btn-secondary btn-sm" disabled={!survey.enabled}
                  title={survey.enabled ? "외부인이 보는 화면 그대로 새 탭에" : "설문을 켠 뒤 미리보기 — 꺼진 링크는 밖에서 마감으로 보입니다"}
                  onClick={() => window.open(surveyUrl, "_blank")}>미리보기</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(surveyUrl); toast("링크를 복사했습니다 — 문자·카톡 어디든 붙여넣으세요", "success"); }}>복사</button>
              </div>
            )}
            {svResponses.length > 0 && (
              <div className="pjv3-sv-link">
                <span className="num text-[11px] text-[var(--text-dim)]">지금까지 응답 {svResponses.length}건</span>
                <button type="button" className="btn-secondary btn-sm ml-auto" title="응답 줄만 — 응답자·제출일·질문 컬럼"
                  onClick={exportSvResponses}>응답만 엑셀로</button>
              </div>
            )}
            {svResponses.length > 0 && (
              <div className="pjv3-sv-sum">
                {svCols.map((c) => {
                  const s = svSumFor(c);
                  return s ? <span key={c.key}><b>{c.name}</b> {s}</span> : null;
                })}
              </div>
            )}
            <p className="phv3-modal-desc !mt-2">
              {survey?.enabled
                ? <>지금 <b>켜져 있습니다</b> — 응답 {survey.response_count}건. 끄면 링크가 즉시 죽습니다.</>
                : "링크 하나를 몇 명에게든 보내도 됩니다 — 응답자마다 줄 하나씩 쌓입니다."}
            </p>
            <div className="phv3-modal-actions">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setSvOpen(false)}>닫기</button>
              {survey?.enabled && (
                <button type="button" className="btn-secondary btn-sm" onClick={async () => { if (await saveSurvey(false)) toast("설문을 껐습니다 — 링크가 무효가 됐습니다", "success"); }}>끄기</button>
              )}
              <button type="button" className="btn-secondary btn-sm" onClick={async () => { if (await saveSurvey()) toast("저장했습니다", "success"); }}>저장만</button>
              <button type="button" className="btn-primary btn-sm" onClick={async () => { if (await saveSurvey(true)) toast("설문이 켜졌습니다 — 링크를 복사해 보내세요", "success"); }}>설문 켜기</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 엑셀 올리기 — 재고 공용 다이얼로그: 양식 다운 → 채워 올리면 미리 보고 '등록'으로 확정 ── */}
      {excelUp && deal && (
        <ExcelUploadDialog<XRow>
          title={`${deal.name} — 엑셀로 줄 올리기`}
          desc="양식을 받아 채운 뒤 올리면 먼저 읽어 보여주고, 등록을 눌러야 저장됩니다."
          cols={excelCols} templateName={`${deal.name}_표양식`} sheetName="표"
          guide={["그룹·담당·선택 칸은 화면에 보이는 이름 그대로 적습니다."]}
          parse={parseX}
          previewHead={["그룹", "이름", "담당", "마감", "금액"]}
          previewRow={(r) => [stages.find((s) => s.id === r.status)?.label || "", r.name, userName(r.assignee_id) || "—", r.due || "—", r.amount == null ? "—" : r.amount.toLocaleString("ko-KR")]}
          commit={commitX}
          onClose={() => setExcelUp(false)}
        />
      )}

      {/* ── 서랍 — 줄 하나를 크게: 이름·속성·체크리스트·팔로워·기록(댓글+변경 한 줄기) ── */}
      {drawerItem && (
        <>
          <div className="pjv3-drawer-veil" onClick={() => setDrawerId(null)} />
          <div className="pjv3-drawer" role="dialog" aria-label={drawerItem.name}>
            <div className="pjv3-drawer-head">
              <input key={drawerItem.id} defaultValue={drawerItem.name} aria-label="이름"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== drawerItem.name) saveItem(drawerItem.id, { name: v }); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }} />
              <button type="button" className="pjv3-drawer-x" onClick={() => setDrawerId(null)}>✕</button>
            </div>
            <div className="pjv3-drawer-body">
              <div className="pjv3-props">
                <button type="button" className="pjv3-stcell" style={{ background: STAGE_HEX[stages.find((s) => s.id === drawerItem.status)?.color || "gray"] }}
                  onClick={(e) => setPop({ kind: "status", itemId: drawerItem.id, ...at(e) })}>
                  {stages.find((s) => s.id === drawerItem.status)?.label || drawerItem.status}</button>
                <button type="button" className="pjv3-prop" title={assigneesOf(drawerItem).map(userName).filter(Boolean).join(", ")}
                  onClick={(e) => setPop({ kind: "person", itemId: drawerItem.id, ...at(e) })}>
                  담당 · {assigneeLabel(drawerItem) || "없음"}</button>
                <input type="date" className="pjv3-prop" aria-label="시작일" title="시작일 — 간트 막대의 왼쪽 끝"
                  value={((drawerItem as any).start_date as string) || ""}
                  onChange={(e) => saveItem(drawerItem.id, { start_date: e.target.value || null })} />
                <input type="date" className="pjv3-prop" aria-label="마감" title="마감일" value={drawerItem.due_date || ""}
                  onChange={(e) => saveItem(drawerItem.id, { due_date: e.target.value || null })} />
              </div>
              {featOn("recur") && (
                <div className="pjv3-props !mt-2">
                  <span className="pjv3-proplabel">반복</span>
                  <select className="pjv3-prop" value={((drawerItem as any).recurrence?.freq as string) || ""}
                    onChange={(e) => {
                      const f = e.target.value;
                      saveItem(drawerItem.id, { recurrence: f ? { freq: f, ...(f === "weekly" ? { weekday: ((drawerItem as any).recurrence?.weekday ?? 1) } : {}) } : null });
                    }}>
                    <option value="">안 함</option><option value="daily">매일</option>
                    <option value="weekly">매주</option><option value="monthly">매월</option>
                  </select>
                  {((drawerItem as any).recurrence?.freq) === "weekly" && (
                    <select className="pjv3-prop" value={String((drawerItem as any).recurrence?.weekday ?? 1)}
                      onChange={(e) => saveItem(drawerItem.id, { recurrence: { freq: "weekly", weekday: Number(e.target.value) } })}>
                      {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => <option key={i} value={i}>{d}요일</option>)}
                    </select>
                  )}
                </div>
              )}
              {featOn("deps") && !(drawerItem as any).parent_id && (
                <div className="pjv3-props !mt-2">
                  <span className="pjv3-proplabel">앞 작업</span>
                  <select className="pjv3-prop" value={((drawerItem as any).after_id as string) || ""}
                    onChange={(e) => saveItem(drawerItem.id, { after_id: e.target.value || null })}>
                    <option value="">없음</option>
                    {items.filter((x) => !(x as any).parent_id && x.id !== drawerItem.id && (x as any).after_id !== drawerItem.id)
                      .map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
              )}

              {featOn("billing") && !(drawerItem as any).parent_id && (() => {
                const q = docLinkOf(drawerItem, QUOTE_KEY);
                const c = docLinkOf(drawerItem, CONTRACT_KEY);
                const qDoc = (dealDocs as any[]).find((d) => d.id === q?.id) || null;
                const cDoc = (dealDocs as any[]).find((d) => d.id === c?.id) || null;
                return (<>
                  <h4>돈 — 이 줄로 견적부터 청구까지 (만든 문서는 견적·전자계약 메뉴에도 똑같이)</h4>
                  <div className="pjv3-moneycard">
                    {!q && (
                      <button type="button" className="btn-primary btn-sm w-full"
                        title="줄의 거래처·하위 작업(품목·금액)이 미리 채워진 견적 팝업이 열립니다 — 미리보기 포함"
                        onClick={() => openQuoteModal(drawerItem)}>💰 견적서 만들기</button>
                    )}
                    {q && (
                      <div className="pjv3-moneyrow">
                        <button type="button" className="pjv3-moneylink" onClick={() => openQuoteModal(drawerItem)}>📄 견적서 {q.no || ""}</button>
                        <span className="pjv3-moneyst">{qDoc?.status === "sent" ? "보냄" : qDoc?.status === "approved" ? "승인" : "작성됨"}</span>
                      </div>
                    )}
                    {q && (
                      <div className="pjv3-moneyrow">
                        <button type="button" className="pjv3-moneylink" onClick={() => openContractModal(drawerItem)}>✍ {c ? `계약서 ${c.no || ""}` : "계약으로 전환"}</button>
                        {c && <span className="pjv3-moneyst">{cDoc?.status === "signed" ? "서명 완료" : "진행 중"}</span>}
                      </div>
                    )}
                    {c && (
                      <div className="pjv3-moneyrow">
                        <button type="button" className="pjv3-moneylink" onClick={() => setDocModal({ itemId: drawerItem.id, kind: "issue" })}>🧾 세금계산서 발행</button>
                      </div>
                    )}
                    <div className="pjv3-moneyflow">
                      <em className={q ? "on" : ""}>견적</em>→<em className={c ? "on" : ""}>계약·서명</em>→<em>계산서</em>→<em>입금</em>
                    </div>
                  </div>
                </>);
              })()}
              <h4>체크리스트{checks.length > 0 ? ` — ${checks.filter((c) => c.done).length}/${checks.length}` : ""}</h4>
              {checks.map((c) => (
                <div key={c.id} className="pjv3-check">
                  <label>
                    <input type="checkbox" checked={c.done} onChange={() => toggleCheck(c)} />
                    <span className={c.done ? "done" : ""}>{c.name}</span>
                  </label>
                  <button type="button" className={`pjv3-del ${delArm === `check:${c.id}` ? "arm" : ""}`} title="지우기"
                    onClick={() => armOrRun(`check:${c.id}`, () => deleteCheck(c.id))}>
                    {delArm === `check:${c.id}` ? "한 번 더" : "✕"}
                  </button>
                </div>
              ))}
              <input className="pjv3-drawer-add" placeholder="＋ 체크 항목 적고 Enter"
                onKeyDown={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) { addCheck(v.trim()); (e.target as HTMLInputElement).value = ""; }
                }} />

              <h4>팔로워 — 이 줄의 변화를 같이 보는 사람</h4>
              <div className="pjv3-followers">
                {(((drawerItem as any).followers || []) as string[]).map((uid) => (
                  <span key={uid} className="pjv3-follower">{userName(uid) || "?"}
                    <i title="빼기" onClick={() => toggleFollower(drawerItem, uid)}>✕</i></span>
                ))}
                <button type="button" className="pjv3-addview" onClick={(e) => setPop({ kind: "follower", itemId: drawerItem.id, ...at(e) })}>＋ 사람</button>
              </div>

              <h4>기록 — 댓글과 변경이 시간순 한 줄기</h4>
              <div className="pjv3-cmtwrap">
                <input className="pjv3-drawer-add" placeholder="댓글 적고 Enter — @로 사람 부르기" value={cmt}
                  onChange={(e) => setCmt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      //   @ 입력 중이면 Enter 는 첫 후보를 고르는 키 — 반 쓴 이름이 그대로 나가는 사고 방지
                      if (cmtMention != null && mentionHits.length > 0) { pickMention(mentionHits[0].name!); return; }
                      if (cmt.trim()) { addComment(cmt.trim()); setCmt(""); }
                    }
                  }} />
                {cmtMention != null && mentionHits.length > 0 && (
                  <div className="pjv3-mention-pop">
                    {mentionHits.map((u) => (
                      <button key={u.id} type="button"
                        onMouseDown={(e) => { e.preventDefault(); pickMention(u.name!); }}>{u.name}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="pjv3-events">
                {events.map((ev) => (
                  <div key={ev.id} className={`pjv3-event ${ev.kind}`}>
                    {ev.kind === "comment"
                      ? <><b>{userName(ev.created_by) || "누군가"}</b> {renderCmtBody(ev.body)}</>
                      : ev.body}
                    <time className="mono-number">{ev.created_at.slice(5, 16).replace("T", " ")}</time>
                  </div>
                ))}
                {events.length === 0 && <div className="pjv3-tpl-mine">아직 기록이 없습니다 — 첫 댓글을 남겨 보세요</div>}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── 템플릿 팝업 — 왼쪽 목록에서 고르면 오른쪽에 단계·시작 항목이 실물로 미리 보인다 ── */}
      {tplOpen && (
        <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) setTplOpen(false); }}>
          <div className="phv3-modal pjv3-tpl-modal" role="dialog" aria-modal="true" aria-label="템플릿">
            <h3 className="phv3-modal-title">템플릿 — 업무에 맞는 가로 양식</h3>
            <p className="phv3-modal-desc">
              적용하면 <b>처리 단계가 열(가로)로 붙습니다</b> — 한 줄이 한 건이라, 줄만 훑으면 어디까지 갔는지 보입니다.
              열은 나중에 자유롭게 고치고 지워도 됩니다.
            </p>
            <div className="pjv3-tpl-layout">
              {/* monday 템플릿 센터의 좌측 카테고리 — 맨 위는 '만든 사람: {회사}' 대응인 우리 회사 양식 */}
              <div className="pjv3-tpl-cats">
                <button type="button" className={`pjv3-tpl-cat ${tplCat === MY_TPL_CAT ? "on" : ""}`} onClick={() => pickCat(MY_TPL_CAT)}>
                  {MY_TPL_CAT}<em className="num">{myTpls.length}</em>
                </button>
                {TPL_CATEGORIES.map((c) => (
                  <button key={c} type="button" className={`pjv3-tpl-cat ${tplCat === c ? "on" : ""}`} onClick={() => pickCat(c)}>
                    {c}<em className="num">{TEMPLATES.filter((t) => t.cat === c).length}</em>
                  </button>
                ))}
              </div>
              <div className="pjv3-tpl-list">
                {tplCat === MY_TPL_CAT && (
                  <div className="pjv3-tpl-save">
                    <input value={myTplName} onChange={(e) => setMyTplName(e.target.value)} placeholder="양식 이름 — 예: 우리 회사 수주 표"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) saveAsTemplate(); }} />
                    <button type="button" className="btn-secondary btn-sm" onClick={saveAsTemplate}
                      title="지금 표의 열·그룹 구성을 양식으로 저장합니다(내용은 저장 안 됨)">지금 표를 양식으로 저장</button>
                  </div>
                )}
                {catTpls(tplCat).map((s) => (
                  <div key={s.key} className={`pjv3-tpl-item ${tplSel?.key === s.key ? "on" : ""}`}
                    role="button" tabIndex={0} onClick={() => setTplSel(s)}
                    onKeyDown={(e) => { if (e.key === "Enter") setTplSel(s); }}>
                    <b>{s.icon} {s.name}
                      {tplCat === MY_TPL_CAT && (
                        <span className={`pjv3-tpl-x ${myTplDel === s.key.replace("mine_", "") ? "arm" : ""}`}
                          title={myTplDel === s.key.replace("mine_", "") ? "한 번 더 누르면 지웁니다" : "이 양식 지우기"}
                          onClick={(e) => { e.stopPropagation(); deleteMyTpl(s.key.replace("mine_", "")); }}>
                          {myTplDel === s.key.replace("mine_", "") ? "한 번 더" : "✕"}
                        </span>
                      )}
                    </b><span>{s.desc.split(".")[0]}</span>
                  </div>
                ))}
                {tplCat === MY_TPL_CAT && myTpls.length === 0 && (
                  <div className="pjv3-tpl-mine">아직 저장한 양식이 없습니다 — 열·그룹을 갖춘 표에서 위 버튼으로 저장하면 여기 쌓입니다</div>
                )}
              </div>
              {tplSel && (
                <div className="pjv3-tpl-preview">
                  <b>{tplSel.icon} {tplSel.name}</b>
                  <p>{tplSel.desc}</p>
                  {/* 실물 미리보기 — 붙을 열 그대로, 예시 한 줄(색 옵션은 첫 값으로) */}
                  <div className="pjv3-tpl-minisheet">
                    <table>
                      <thead><tr>
                        <th className="!text-left">이름</th>
                        {tplSel.cols.map((c) => <th key={c.name}>{c.name}</th>)}
                      </tr></thead>
                      <tbody><tr>
                        <td className="!text-left">{tplSel.example}</td>
                        {tplSel.cols.map((c) => (
                          <td key={c.name}>
                            {c.options?.[0]?.color
                              ? <span className="pjv3-tpl-badge" style={{ background: c.options[0].color }}>{c.options[0].label}</span>
                              : <span className="text-[var(--text-dim)]">{FIELD_TYPES.find((t) => t.id === c.type)?.label || "—"}</span>}
                          </td>
                        ))}
                      </tr></tbody>
                    </table>
                  </div>
                  {(tplSel.stages?.length ?? 0) > 0 && (
                    <div className="pjv3-tpl-stagerow">
                      그룹
                      {tplSel.stages!.map((s) => (
                        <span key={s.id} className="pjv3-tpl-badge" style={{ background: STAGE_HEX[s.color] }}>{s.label}</span>
                      ))}
                      <em>빈 표에 적용할 때만 그룹까지 재현됩니다</em>
                    </div>
                  )}
                  <div className="phv3-modal-actions">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setTplOpen(false)}>닫기</button>
                    <button type="button" className="btn-primary btn-sm" disabled={tplSaving}
                      onClick={() => applyTemplate(tplSel)}>이 템플릿 적용</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 떠 있는 팝 — 상태·담당·선택지·컬럼 추가 ── */}
      {pop && (
        <div className={`pjv3-pop ${(pop.kind === "select" && optEdit) || (pop.kind === "status" && stEdit) ? "pjv3-pop-wide" : ""} ${"up" in pop && pop.up ? "pjv3-pop-up" : ""}`} style={{ left: pop.x, top: pop.y }}>
          {pop.kind === "status" && !stEdit && (<>
            <div className="pjv3-pop-title">상태 — 그룹·칸반 열이 같이 바뀝니다</div>
            {stages.map((s) => (
              <button key={s.id} type="button" className="pjv3-pop-color" style={{ background: STAGE_HEX[s.color] }}
                onClick={() => { saveItem(pop.itemId, { status: s.id }); setPop(null); }}>{s.label}</button>
            ))}
            <button type="button" className="pjv3-opt-manage" onClick={() => setStEdit(true)}>상태 고치기 — 이름·색·순서·추가·삭제</button>
          </>)}
          {pop.kind === "status" && stEdit && (<>
            <div className="pjv3-pop-title">상태 고치기 (색은 점을 눌러 순환 — 표·칸반·간트가 같이 바뀝니다)</div>
            {stages.map((s, i) => (
              <div key={s.id} className="pjv3-opt-row">
                <span className="dot" style={{ background: STAGE_HEX[s.color] }} title="색 바꾸기"
                  onClick={() => {
                    const next = STAGE_COLORS[(STAGE_COLORS.indexOf(s.color) + 1) % STAGE_COLORS.length];
                    saveStages(stages.map((x) => (x.id === s.id ? { ...x, color: next } : x)));
                  }} />
                <input defaultValue={s.label} aria-label="상태 이름"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== s.label) saveStages(stages.map((x) => (x.id === s.id ? { ...x, label: v } : x)));
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }} />
                <button type="button" disabled={i === 0} title="위로"
                  onClick={() => { const n = [...stages]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; saveStages(n); }}>↑</button>
                <button type="button" disabled={i === stages.length - 1} title="아래로"
                  onClick={() => { const n = [...stages]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; saveStages(n); }}>↓</button>
                {stages.length > 1 && (
                  <button type="button" className={`pjv3-del ${delArm === `stage:${s.id}` ? "arm" : ""}`}
                    title="지우기 — 이 상태의 항목은 맨 위 그룹으로 옮겨집니다"
                    onClick={() => armOrRun(`stage:${s.id}`, () => deleteStage(s.id))}>
                    {delArm === `stage:${s.id}` ? "한 번 더" : "✕"}
                  </button>
                )}
              </div>
            ))}
            <input placeholder="＋ 새 상태 적고 Enter"
              onKeyDown={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) {
                  saveStages([...stages, { id: `g_${Date.now().toString(36)}`, label: v.trim(), color: STAGE_COLORS[stages.length % STAGE_COLORS.length] }]);
                  (e.target as HTMLInputElement).value = "";
                }
              }} />
            <button type="button" onClick={() => setStEdit(false)}>← 고르기로 돌아가기</button>
          </>)}
          {pop.kind === "person" && (() => {
            //   내장 담당 = 여러 명(눌러서 넣고 빼기) · 사람 타입 컬럼 = 한 명 고르기. 둘 다 검색으로 좁힌다
            const it = items.find((x) => x.id === pop.itemId);
            const qs = personQ.trim().toLowerCase();
            const hits = qs ? users.filter((u) => (u.name || u.email || "").toLowerCase().includes(qs)) : users;
            const multi = !pop.colKey;
            const cur = multi && it ? assigneesOf(it) : [];
            return (<>
              <div className="pjv3-pop-title">{multi ? "담당 — 눌러서 넣고 빼기(여러 명)" : "사람 — 이름으로 검색해 고릅니다"}</div>
              <input placeholder="이름 검색" value={personQ} autoFocus aria-label="이름 검색"
                onChange={(e) => setPersonQ(e.target.value)} />
              <button type="button" className="text-[var(--text-dim)]" onClick={() => {
                if (pop.colKey) { if (it) saveField(it, pop.colKey!, null); }
                else saveItem(pop.itemId, { assignee_id: null, assignee_ids: [] });
                setPop(null);
              }}>비우기</button>
              {hits.slice(0, 12).map((u) => (
                <button key={u.id} type="button" onClick={() => {
                  if (pop.colKey) { if (it) saveField(it, pop.colKey!, u.id); setPop(null); }
                  else if (it) toggleAssignee(it, u.id);
                }}>{multi && cur.includes(u.id) ? "✓ " : ""}{u.name || u.email}</button>
              ))}
              {hits.length > 12 && <div className="pjv3-pop-title">앞 12명만 — 검색으로 좁히세요</div>}
              {hits.length === 0 && <div className="pjv3-pop-title">일치하는 사람이 없습니다</div>}
            </>);
          })()}
          {pop.kind === "partner" && (() => {
            const qStr = partnerQ.trim().toLowerCase();
            const hits = qStr ? partners.filter((pt) => pt.name.toLowerCase().includes(qStr)) : partners;
            return (<>
              <div className="pjv3-pop-title">거래처 — 이름 일부로 검색해 고릅니다</div>
              <input placeholder="거래처 검색" value={partnerQ} autoFocus aria-label="거래처 검색"
                onChange={(e) => setPartnerQ(e.target.value)} />
              <button type="button" className="text-[var(--text-dim)]" onClick={() => {
                const it = items.find((x) => x.id === pop.itemId); if (it) saveField(it, pop.colKey, null); setPop(null);
              }}>비우기</button>
              {hits.slice(0, 20).map((pt) => (
                <button key={pt.id} type="button" onClick={() => {
                  const it = items.find((x) => x.id === pop.itemId); if (it) saveField(it, pop.colKey, pt.name); setPop(null);
                }}>{pt.name}</button>
              ))}
              {hits.length > 20 && <div className="pjv3-pop-title">앞 20개만 — 검색으로 좁히세요</div>}
              {hits.length === 0 && <div className="pjv3-pop-title">{partners.length === 0 ? "등록된 거래처가 없습니다 — 재무 › 거래처에서 등록" : "일치하는 거래처가 없습니다"}</div>}
            </>);
          })()}
          {pop.kind === "select" && (() => {
            const col = cols.find((c) => c.key === pop.colKey);
            if (!col) return null;
            const opts = col.settings?.options || [];
            if (optEdit) return (<>
              <div className="pjv3-pop-title">{col.name} — 선택지 고치기 (색은 점을 눌러 순환)</div>
              {opts.map((o, i) => (
                <div key={o.id} className="pjv3-opt-row">
                  <span className="dot" style={{ background: o.color || OPTION_COLORS[0] }} title="색 바꾸기"
                    onClick={() => {
                      const next = OPTION_COLORS[(OPTION_COLORS.indexOf(o.color || "") + 1) % OPTION_COLORS.length];
                      saveOptions(col, opts.map((x) => (x.id === o.id ? { ...x, color: next } : x)));
                    }} />
                  <input defaultValue={o.label} aria-label="선택지 이름"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== o.label) saveOptions(col, opts.map((x) => (x.id === o.id ? { ...x, label: v } : x)));
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }} />
                  <button type="button" disabled={i === 0} title="위로"
                    onClick={() => { const n = [...opts]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; saveOptions(col, n); }}>↑</button>
                  <button type="button" disabled={i === opts.length - 1} title="아래로"
                    onClick={() => { const n = [...opts]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; saveOptions(col, n); }}>↓</button>
                  <button type="button" className={`pjv3-del ${delArm === `opt:${col.id}:${o.id}` ? "arm" : ""}`}
                    title="지우기 — 이 값을 쓰던 칸은 비워집니다"
                    onClick={() => armOrRun(`opt:${col.id}:${o.id}`, () => deleteOption(col, o.id))}>
                    {delArm === `opt:${col.id}:${o.id}` ? "한 번 더" : "✕"}
                  </button>
                </div>
              ))}
              <input placeholder="＋ 선택지 적고 Enter"
                onKeyDown={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) {
                    saveOptions(col, [...opts, { id: `o_${Date.now().toString(36)}`, label: v.trim(), color: OPTION_COLORS[opts.length % OPTION_COLORS.length] }]);
                    (e.target as HTMLInputElement).value = "";
                  }
                }} />
              <button type="button" onClick={() => setOptEdit(false)}>← 고르기로 돌아가기</button>
            </>);
            return (<>
              <div className="pjv3-pop-title">{col.name}</div>
              <button type="button" className="text-[var(--text-dim)]" onClick={() => {
                const it = items.find((x) => x.id === pop.itemId); if (it) saveField(it, pop.colKey, null); setPop(null);
              }}>없음</button>
              {opts.map((o) => (
                <button key={o.id} type="button" className={o.color ? "pjv3-pop-color" : ""}
                  style={o.color ? { background: o.color } : undefined}
                  onClick={() => { const it = items.find((x) => x.id === pop.itemId); if (it) saveField(it, pop.colKey, o.id); setPop(null); }}>
                  {o.label}</button>
              ))}
              {opts.length === 0 && <div className="pjv3-pop-title">아직 선택지가 없습니다 — 아래에서 만드세요</div>}
              <button type="button" className="pjv3-opt-manage" onClick={() => setOptEdit(true)}>선택지 고치기 — 이름·색·순서·추가·삭제</button>
            </>);
          })()}
          {pop.kind === "features" && (<>
            <div className="pjv3-pop-title">＋ 기능 — 이 프로젝트에만 켭니다(팀 공유)</div>
            {([["recur", "반복 작업", "서랍에 '반복' 줄 — 완료로 옮기면 다음 줄 자동"], ["deps", "앞뒤 순서", "서랍에 '앞 작업' 줄 — 안 끝났으면 알려줌"], ["billing", "견적·청구", "줄에 ₩ 버튼 — 견적→계약→계산서→입금"], ["survey", "설문 발송", "위에 '설문' 버튼 — 외부 링크로 받은 응답이 줄로"]] as const).map(([k, label, hint]) => (
              <button key={k} type="button" onClick={() => toggleFeature(k)}>
                {features.includes(k) ? "✓ " : ""}{label}<small className="pjv3-typehint"> — {hint}</small>
              </button>
            ))}
          </>)}
          {pop.kind === "bulkstatus" && (<>
            <div className="pjv3-pop-title">고른 {selIds.size}줄을 어느 그룹으로</div>
            {stages.map((s) => (
              <button key={s.id} type="button" className="pjv3-pop-color" style={{ background: STAGE_HEX[s.color] }}
                onClick={() => bulkStatus(s.id)}>{s.label}</button>
            ))}
          </>)}
          {pop.kind === "bulkassign" && (<>
            <div className="pjv3-pop-title">고른 {selIds.size}줄의 담당을</div>
            <button type="button" className="text-[var(--text-dim)]" onClick={() => bulkAssign(null)}>없음</button>
            {users.map((u) => (
              <button key={u.id} type="button" onClick={() => bulkAssign(u.id)}>{u.name || u.email}</button>
            ))}
          </>)}
          {pop.kind === "follower" && (() => {
            const it = items.find((x) => x.id === pop.itemId);
            const qs = personQ.trim().toLowerCase();
            const hits = qs ? users.filter((u) => (u.name || u.email || "").toLowerCase().includes(qs)) : users;
            return (<>
              <div className="pjv3-pop-title">팔로워 — 눌러서 넣고 빼기(여러 명)</div>
              <input placeholder="이름 검색" value={personQ} autoFocus aria-label="이름 검색"
                onChange={(e) => setPersonQ(e.target.value)} />
              {hits.slice(0, 12).map((u) => {
                const on = (((it as any)?.followers || []) as string[]).includes(u.id);
                return (
                  <button key={u.id} type="button" onClick={() => { if (it) toggleFollower(it, u.id); }}>
                    {on ? "✓ " : ""}{u.name || u.email}
                  </button>
                );
              })}
              {hits.length > 12 && <div className="pjv3-pop-title">앞 12명만 — 검색으로 좁히세요</div>}
              {hits.length === 0 && <div className="pjv3-pop-title">일치하는 사람이 없습니다</div>}
            </>);
          })()}
          {pop.kind === "addview" && (<>
            <div className="pjv3-pop-title">보기 추가 — 표를 보는 다른 형태</div>
            {!views.includes("kanban") && <button type="button" onClick={() => addView("kanban")}>칸반 — 상태별 카드로 보고, 끌어서 옮깁니다</button>}
            {!views.includes("calendar") && <button type="button" onClick={() => addView("calendar")}>캘린더 — 마감일 달력으로 봅니다</button>}
            {!views.includes("gantt") && <button type="button" onClick={() => addView("gantt")}>간트 — 시작~마감 막대로 일정을 봅니다</button>}
            <div className="pjv3-pop-title">추가한 보기는 팀 전체가 같이 봅니다 · 현황은 다음 단계에서</div>
          </>)}
          {pop.kind === "excel" && (<>
            <div className="pjv3-pop-title">엑셀</div>
            <button type="button" onClick={() => { exportRows(); setPop(null); }}>내려받기 — 지금 보이는 줄 그대로</button>
            <button type="button" onClick={() => { setExcelUp(true); setPop(null); }}>올리기 — 양식 받아 채워서 한 번에</button>
          </>)}
          {pop.kind === "addcal" && (<>
            <div className="pjv3-pop-title">{pop.date} 마감으로 추가 — 첫 그룹에 들어갑니다</div>
            <input autoFocus placeholder="이름 적고 Enter"
              onKeyDown={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim() && stages[0]) {
                  addItem(stages[0].id, v.trim(), pop.date); setPop(null);
                }
              }} />
          </>)}
          {pop.kind === "longtext" && (() => {
            const it = items.find((x) => x.id === pop.itemId);
            const col = cols.find((c) => c.key === pop.colKey);
            if (!it || !col) return null;
            const cur = String((it.fields || {})[pop.colKey] ?? "");
            return (<>
              <div className="pjv3-pop-title">{col.name} — 바깥을 누르면 저장됩니다</div>
              <textarea className="pjv3-longedit" autoFocus defaultValue={cur} rows={6}
                onBlur={(e) => { const v = e.target.value; if (v !== cur) saveField(it, pop.colKey, v || null); }} />
            </>);
          })()}
          {pop.kind === "formula" && (() => {
            const col = cols.find((c) => c.key === pop.colKey);
            if (!col) return null;
            return (<>
              <div className="pjv3-pop-title">수식 — 열 이름과 ＋ − × ÷ ( ) 숫자 · 빈 칸을 참조한 줄은 —</div>
              <input ref={fxInRef} defaultValue={String((col.settings as { expr?: string } | null)?.expr || "")} placeholder="예: 수량 × 단가 − 할인" />
              <div className="pjv3-fxtoks">
                {[...fxRefNames.filter((n) => n !== col.name), "＋", "−", "×", "÷", "(", ")"].map((t) => (
                  <button key={t} type="button" onClick={() => { const el = fxInRef.current; if (el) { el.value = `${el.value} ${t} `.replace(/\s+/g, " "); el.focus(); } }}>{t}</button>
                ))}
              </div>
              <button type="button" className="pjv3-opt-manage"
                onClick={() => { saveColSettings(col, { expr: (fxInRef.current?.value ?? "").trim() }); setPop(null); }}>저장</button>
            </>);
          })()}
          {pop.kind === "files" && (() => {
            const it = items.find((x) => x.id === pop.itemId);
            if (!it) return null;
            const list = Array.isArray((it.fields || {})[pop.colKey]) ? ((it.fields || {})[pop.colKey] as { name: string; path: string }[]) : [];
            return (<>
              <div className="pjv3-pop-title">첨부파일 — 누르면 열기 · 20MB까지</div>
              {list.map((f) => (
                <div key={f.path} className="pjv3-opt-row">
                  <button type="button" className="pjv3-filename" onClick={() => openItemFile(f.path)}>📎 {f.name}</button>
                  <button type="button" className={`pjv3-del ${delArm === `file:${f.path}` ? "arm" : ""}`} title="지우기"
                    onClick={() => armOrRun(`file:${f.path}`, () => deleteItemFile(it, pop.colKey, f.path))}>
                    {delArm === `file:${f.path}` ? "한 번 더" : "✕"}
                  </button>
                </div>
              ))}
              {list.length === 0 && <div className="pjv3-pop-title">아직 없습니다</div>}
              <label className="pjv3-filepick">＋ 파일 올리기
                <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadItemFile(it, pop.colKey, f); e.target.value = ""; }} />
              </label>
            </>);
          })()}
          {pop.kind === "ovlink" && (() => {
            const it = items.find((x) => x.id === pop.itemId);
            if (!it) return null;
            const cur = (it.fields || {})[pop.colKey];
            return (<>
              <div className="pjv3-pop-title">오너뷰에서 골라 붙이기</div>
              <div className="pjv3-fxtoks">
                {([["board", "게시글"], ["doc", "보관함 파일"], ["sign", "전자계약"]] as const).map(([k, l]) => (
                  <button key={k} type="button" className={ovSrc === k ? "on" : ""} onClick={() => setOvSrc(k)}>{l}</button>
                ))}
              </div>
              <input value={ovQ} onChange={(e) => setOvQ(e.target.value)} placeholder="이름 일부로 검색" autoFocus />
              {ovResults.map((r) => (
                <button key={r.id} type="button" onClick={() => {
                  saveField(it, pop.colKey, { src: ovSrc, id: r.id, title: r.title, ...(r.file_url ? { file_url: r.file_url } : {}) });
                  setPop(null);
                }}>{r.title}</button>
              ))}
              {ovResults.length === 0 && <div className="pjv3-pop-title">결과가 없습니다 — 검색어를 바꿔 보세요</div>}
              {cur != null && <button type="button" className="pjv3-opt-manage" onClick={() => { saveField(it, pop.colKey, null); setPop(null); }}>연결 풀기</button>}
            </>);
          })()}
          {pop.kind === "addcol" && (<>
            {(builtinCfg.hidden?.length ?? 0) > 0 && (<>
              <div className="pjv3-pop-title">숨긴 기본 열 — 눌러서 되살리기</div>
              {builtinCfg.hidden!.map((h) => (
                <button key={h} type="button"
                  onClick={() => { saveBuiltin({ hidden: builtinCfg.hidden!.filter((x) => x !== h) }); setPop(null); }}>
                  ↩ {(builtinCfg.labels || {})[h] || BUILTIN_DEFS.find((b) => b.id === h)?.label || h}
                </button>
              ))}
            </>)}
            <AddColPop fxNames={fxRefNames} onAdd={(name, type, settings) => { addColumn(name, type, settings); setPop(null); }} />
          </>)}
        </div>
      )}
    </div>
  );
}

/** 컬럼 추가 팝 — 이름 적고 타입 고르면 끝 (결정 125: 컬럼이 곧 구조).
 *  2026-09-01 확장: 그룹(기본·자유도·오너뷰 연결)으로 묶고, 수식은 식 입력·자동 날짜는 기준 선택 단계가 붙는다 */
function AddColPop({ onAdd, fxNames }: {
  onAdd: (name: string, type: FieldType, settings?: Record<string, unknown>) => void; fxNames: string[];
}) {
  const [name, setName] = useState("");
  const [step, setStep] = useState<null | "formula" | "auto">(null);
  const [expr, setExpr] = useState("");
  if (step === "formula") return (
    <>
      <div className="pjv3-pop-title">{`'${name}' 수식 — 열 이름과 ＋ − × ÷ ( ) 숫자`}</div>
      <input autoFocus value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="예: 수량 × 단가 − 할인" />
      <div className="pjv3-fxtoks">
        {[...fxNames, "＋", "−", "×", "÷", "(", ")"].map((t) => (
          <button key={t} type="button" onClick={() => setExpr((v) => `${v} ${t} `.replace(/\s+/g, " "))}>{t}</button>
        ))}
      </div>
      <button type="button" className={expr.trim() ? "" : "opacity-40"}
        onClick={() => { if (expr.trim()) onAdd(name, "formula", { expr: expr.trim() }); }}>만들기</button>
    </>
  );
  if (step === "auto") return (
    <>
      <div className="pjv3-pop-title">{`'${name}' — 어떤 날짜를 자동으로 보여줄까요`}</div>
      <button type="button" onClick={() => onAdd(name, "auto", { mode: "created" })}>만든 날</button>
      <button type="button" onClick={() => onAdd(name, "auto", { mode: "updated" })}>마지막 수정</button>
    </>
  );
  return (
    <>
      <div className="pjv3-pop-title">컬럼 추가 — 이름 적고 타입을 고르세요</div>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 광고 ID, 마진" />
      {(["기본", "자유도", "오너뷰 연결"] as const).map((g) => (
        <div key={g}>
          <div className="pjv3-pop-title">{g}</div>
          {FIELD_TYPES.filter((t) => t.group === g).map((t) => (
            <button key={t.id} type="button" className={name.trim() ? "" : "opacity-40"}
              onClick={() => {
                if (!name.trim()) return;
                if (t.id === "formula") { setStep("formula"); return; }
                if (t.id === "auto") { setStep("auto"); return; }
                onAdd(name.trim(), t.id, undefined);
              }}>
              {t.label}{t.hint ? <small className="pjv3-typehint"> — {t.hint}</small> : null}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
