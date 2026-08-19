"use client";

import { useMemo, useState } from "react";
import { QueryScreen, QueryHead, QueryBody, QueryBar, QuickSearch, quickSearchHit, ChipGroup, ConditionPanel, ConditionRow, AppliedChips, ResultStrip, Stat, Pager, usePager, type AppliedChip } from "@/components/query-kit";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { Ico } from "@/components/ui-icon";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { logRead } from "@/lib/log-read";

// 직원용 구성원 디렉토리 — 읽기 전용. 누가 어느 부서/직책에 있는지만 보여준다.
//   2026-08-19 조회 화면 표준(인사 메뉴 점검): 상자 + [검색조건(부서) · 빠른검색 · 보기 칩(리스트/카드) ‖ 인원] + 표(정렬) + 쪽. 카드는 보기 옵션.
//   예전엔 상자 없이 부서별 유리 카드 격자만 있었다.
// 조직도 정렬용 직책 서열 (2026-08-19 사장님: 본부장→팀장→과장→사원 순으로 먼저). 목록에 없는 직책은 뒤로.
const POSITION_RANK = ["대표", "이사", "본부장", "부장", "팀장", "차장", "과장", "대리", "주임", "사원"];
// 대표(CEO)는 부서 상자에서 빼서 조직도 맨 위 가운데 뿌리로 올린다 (2026-08-19 사장님)
const isCeoPosition = (p?: string | null) => /^(대표(이사)?|CEO)$/i.test(String(p || "").trim());

export default function TeamPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "card" | "org">("list");
  const [depts, setDepts] = useState<string[]>([]);
  const [draftDepts, setDraftDepts] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  type SK = "name" | "department" | "position" | "email";
  const [sort, setSort] = useState<SortState<SK>>({ key: "department", dir: "asc" });

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["team-directory", companyId],
    queryFn: async () => {
      // 회사 격리는 서버(RPC 내부 get_my_company_id())가 강제 — 클라이언트에서 company_id 전달 안 함.
      // RPC는 salary 등 민감 컬럼을 일절 반환하지 않는 안전 디렉토리 뷰.
      const { data, error } = await supabase.rpc("get_company_directory");
      if (error) throw error;
      return (data ?? []).filter((e) => e.status === "active" || e.status === "joined");
    },
    enabled: !!companyId,
  });
  const allDepts = useMemo(() => [...new Set(employees.map((e) => e.department || "미배정"))].sort(), [employees]);

  // 조직도 (2026-08-19 사장님: 디렉토리에서 조직도도 보이게) — 회사 루트 → 부서 상자 → 직책 서열순 구성원.
  //   검색·부서 필터가 조직도에도 그대로 적용된다. '미배정'은 맨 뒤.
  const { data: companyName = "" } = useQuery({
    queryKey: ["company-name", companyId],
    enabled: !!companyId && view === "org",
    staleTime: 300_000,
    queryFn: async () => {
      const data = logRead("team:companyName", await supabase.from("companies").select("name").eq("id", companyId!).maybeSingle());
      return (data as { name?: string } | null)?.name || "";
    },
  });

  const filtered = useMemo(() => {
    const rows = employees.filter((e) => quickSearchHit(search, [e.name, e.department, e.position, e.email, e.phone]) && (depts.length === 0 || depts.includes(e.department || "미배정")));
    const k = sort.key;
    return [...rows].sort((a, b) => (cmp((a as any)[k] || "", (b as any)[k] || "") * (sort.dir === "asc" ? 1 : -1)) || (a.name || "").localeCompare(b.name || ""));
  }, [employees, search, depts, sort]);
  const pager = usePager(filtered, 50, `${search}|${depts.join()}|${sort.key}${sort.dir}`);
  const orgCeos = useMemo(() => filtered.filter((e) => isCeoPosition(e.position)), [filtered]);
  const orgDepts = useMemo(() => {
    const rank = (p?: string | null) => { const i = POSITION_RANK.indexOf(p || ""); return i === -1 ? POSITION_RANK.length : i; };
    const m = new Map<string, typeof filtered>();
    filtered.forEach((e) => { if (isCeoPosition(e.position)) return; const d = e.department || "미배정"; if (!m.has(d)) m.set(d, []); m.get(d)!.push(e); });
    return [...m.entries()]
      .sort((a, b) => (a[0] === "미배정" ? 1 : b[0] === "미배정" ? -1 : a[0].localeCompare(b[0])))
      .map(([d, rows]) => [d, [...rows].sort((x, y) => (rank(x.position) - rank(y.position)) || (x.name || "").localeCompare(y.name || ""))] as const);
  }, [filtered]);


  // 조직도 이미지(PNG) 내보내기 (2026-08-19 사장님) — 화면 캡처 라이브러리 없이 조직도 데이터를
  //   캔버스에 직접 그린다(다크모드·CSS 변수 무관, 항상 인쇄용 밝은 배경). 부서 4개씩 줄바꿈.
  const exportOrgImage = () => {
    const C = { bg: "#ffffff", border: "#d8dee9", text: "#0f172a", muted: "#64748b", dim: "#94a3b8", primary: "#4f46e5", primarySoft: "#eef2ff", surface: "#f8fafc" };
    const BOX_W = 224, GAP_X = 24, GAP_Y = 44, MARGIN = 36, COLS = Math.max(1, Math.min(4, orgDepts.length));
    const deptH = (rows: number) => 34 + rows * 22 + 8;
    const rowsOf: (typeof orgDepts)[] = [];
    for (let i = 0; i < orgDepts.length; i += COLS) rowsOf.push(orgDepts.slice(i, i + COLS));
    const rowHeights = rowsOf.map((r) => Math.max(...r.map(([, list]) => deptH(list.length))));
    const rootH = 30 + orgCeos.length * 22 + 22;
    const rootW = 240;
    const gridW = COLS * BOX_W + (COLS - 1) * GAP_X;
    const W = Math.max(gridW, rootW) + MARGIN * 2;
    const H = MARGIN + rootH + GAP_Y + rowHeights.reduce((a, b) => a + b + GAP_Y, 0) - (rowsOf.length ? GAP_Y : 0) + rowHeights.length * 0 + MARGIN;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const font = (size: number, bold = false) => { ctx.font = `${bold ? "700 " : ""}${size}px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`; };
    const ellipsize = (t: string, max: number) => { let v = t; while (v && ctx.measureText(v).width > max) v = v.slice(0, -1); return v === t ? t : v.slice(0, -1) + "…"; };
    const rr = (x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
    const cx = W / 2;

    // 뿌리 — 회사명(작게) + 대표들
    const rootX = cx - rootW / 2, rootY = MARGIN;
    rr(rootX, rootY, rootW, rootH, 12); ctx.fillStyle = C.primarySoft; ctx.fill(); ctx.strokeStyle = C.primary; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    font(10); ctx.fillStyle = C.muted; ctx.fillText(ellipsize(companyName || "우리 회사", rootW - 24), cx, rootY + 14);
    orgCeos.forEach((e, i) => {
      font(13, true); ctx.fillStyle = C.text;
      const nm = e.name || "—"; const pos = e.position || "";
      const label = pos ? `${nm}  ·  ${pos}` : nm;
      ctx.fillText(ellipsize(label, rootW - 24), cx, rootY + 30 + i * 22 + 4);
    });
    font(10); ctx.fillStyle = C.muted;
    ctx.fillText(`총 ${filtered.length}명`, cx, rootY + rootH - 12);

    // 가지 — 뿌리 줄기 → 줄마다 가로 버스 → 부서 상자 줄기
    ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
    let y = rootY + rootH;
    let prevBusY = rootY + rootH;
    rowsOf.forEach((row, ri) => {
      const rowW = row.length * BOX_W + (row.length - 1) * GAP_X;
      const startX = cx - rowW / 2;
      const busY = y + GAP_Y / 2;
      const centers = row.map((_, i) => startX + i * BOX_W + BOX_W / 2);
      ctx.beginPath();
      ctx.moveTo(cx, prevBusY); ctx.lineTo(cx, busY); // 줄기(이전 버스 → 이번 버스)
      if (row.length > 1 || Math.abs(centers[0] - cx) > 1) {
        ctx.moveTo(Math.min(cx, centers[0]), busY); ctx.lineTo(Math.max(cx, centers[centers.length - 1]), busY);
      }
      centers.forEach((c) => { ctx.moveTo(c, busY); ctx.lineTo(c, y + GAP_Y); });
      ctx.stroke();
      prevBusY = busY;

      // 부서 상자들
      row.forEach(([dept, list], i) => {
        const bx = startX + i * BOX_W, by = y + GAP_Y, bh = deptH(list.length);
        rr(bx, by, BOX_W, bh, 12); ctx.fillStyle = C.bg; ctx.fill(); ctx.strokeStyle = C.border; ctx.stroke();
        rr(bx, by, BOX_W, 30, 12); ctx.save(); ctx.clip(); ctx.fillStyle = C.surface; ctx.fillRect(bx, by, BOX_W, 30); ctx.restore();
        ctx.beginPath(); ctx.moveTo(bx, by + 30); ctx.lineTo(bx + BOX_W, by + 30); ctx.strokeStyle = C.border; ctx.stroke();
        ctx.textAlign = "left"; font(12, true); ctx.fillStyle = C.text;
        ctx.fillText(ellipsize(dept, BOX_W - 70), bx + 12, by + 16);
        ctx.textAlign = "right"; font(10); ctx.fillStyle = C.dim;
        ctx.fillText(`${list.length}명`, bx + BOX_W - 12, by + 16);
        list.forEach((e, mi) => {
          const my = by + 34 + mi * 22 + 11;
          ctx.textAlign = "left"; font(11.5); ctx.fillStyle = C.text;
          ctx.fillText(ellipsize(e.name || "—", BOX_W - 90), bx + 12, my);
          ctx.textAlign = "right"; font(10.5); ctx.fillStyle = C.muted;
          ctx.fillText(ellipsize(e.position || "", 70), bx + BOX_W - 12, my);
        });
        ctx.strokeStyle = C.border; // 다음 연결선 색 복구
      });
      y = y + GAP_Y + rowHeights[ri];
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      a.href = URL.createObjectURL(blob);
      a.download = `조직도_${(companyName || "회사").replace(/[\/:*?"<>|]/g, "")}_${day}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  };

  if (!companyId) return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;

  const chips: AppliedChip[] = [
    ...(depts.length ? [{ group: "부서", label: depts.join(" · "), onRemove: () => { setDepts([]); setDraftDepts([]); } }] : []),
    ...(search ? [{ group: "빠른검색", label: search, onRemove: () => setSearch("") }] : []),
  ];
  const onSort = (key: SK) => setSort((s: SortState<SK>) => nextSort(s, key));

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <QueryBar right={<span className="text-xs text-[var(--text-muted)]">총 {employees.length}명</span>}>
            <ConditionPanel open={panelOpen} onOpenChange={(v) => { if (v) setDraftDepts(depts); setPanelOpen(v); }} activeCount={depts.length ? 1 : 0}
              foot={<>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setDraftDepts([])}>기본으로</button>
                <span className="ml-auto" />
                <button type="button" className="btn-primary btn-sm" onClick={() => { setDepts(draftDepts); setPanelOpen(false); }}>조회</button>
              </>}>
              <ConditionRow label="부서" hint="여러 개">
                <span className="qk-quicks">{allDepts.map((d) => <button key={d} type="button" onClick={() => setDraftDepts((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d])} className={draftDepts.includes(d) ? "qk-quick qk-quick-on" : "qk-quick"}>{d}</button>)}</span>
              </ConditionRow>
            </ConditionPanel>
            <QuickSearch value={search} onApply={setSearch} placeholder="이름 · 부서 · 직책 · 이메일 · 연락처 — 쉼표로 여러 개, Enter" />
            <ChipGroup value={view} onChange={setView} options={[{ value: "list", label: "리스트" }, { value: "card", label: "카드" }, { value: "org", label: "조직도" }] as const} />
          </QueryBar>
          <AppliedChips chips={chips} onClearAll={() => { setDepts([]); setDraftDepts([]); setSearch(""); }} />
          <ResultStrip>
            <Stat label="표시" value={`${filtered.length}명`} />
            <Stat label="부서" value={`${new Set(filtered.map((e) => e.department || "미배정")).size}개`} />
          </ResultStrip>
        </QueryHead>
        <QueryBody>
          <div className="team-scroll">
            {isLoading ? (
              <div className="collect-empty">불러오는 중…</div>
            ) : filtered.length === 0 ? (
              <div className="collect-empty">
                {search || depts.length ? "조건에 맞는 구성원이 없습니다" : "등록된 구성원이 없습니다 — 구성원이 등록되면 여기에 표시됩니다"}
                {!search && !depts.length && role !== "employee" && <> · <Link href="/employees" className="bz-link">직원 관리로 →</Link></>}
              </div>
            ) : view === "list" ? (
              <>
                <table className="ev-table ev-lined team-table">
                  <thead>
                    <tr>
                      <SortableTh label="이름" sortKey="name" sort={sort} onSort={onSort} />
                      <SortableTh label="부서" sortKey="department" sort={sort} onSort={onSort} />
                      <SortableTh label="직책" sortKey="position" sort={sort} onSort={onSort} />
                      <SortableTh label="이메일" sortKey="email" sort={sort} onSort={onSort} />
                      <th>연락처</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pager.view.map((e) => (
                      <tr key={e.id}>
                        <td className="text-left"><span className="team-avatar">{(e.name || "?").slice(0, 1)}</span><b>{e.name || "—"}</b></td>
                        <td className="text-center">{e.department || <span className="text-[var(--text-dim)]">미배정</span>}</td>
                        <td className="text-center">{e.position || "—"}</td>
                        <td className="text-left">{e.email ? <a href={`mailto:${e.email}`} className="bz-link font-normal">{e.email}</a> : "—"}</td>
                        <td className="text-center mono-number">{e.phone || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pager page={pager.page} pages={pager.pages} total={filtered.length} from={pager.from} to={pager.to} size={50} onPage={pager.setPage} />
              </>
            ) : view === "org" ? (
              <div className="org-chart">
                <div className="self-end -mb-2">
                  <button type="button" onClick={exportOrgImage} className="btn-secondary btn-sm">이미지 저장</button>
                </div>
                <div className="org-root">
                  <div className="text-[10px] text-[var(--text-dim)]">{companyName || "우리 회사"}</div>
                  {orgCeos.length > 0 ? (
                    <div className="mt-1 space-y-0.5">
                      {orgCeos.map((e) => (
                        <div key={e.id} className="flex items-center justify-center gap-2">
                          <span className="team-avatar">{(e.name || "?").slice(0, 1)}</span>
                          <span className="text-sm font-bold">{e.name}</span>
                          <span className="text-[11px] text-[var(--text-muted)]">{e.position}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm font-bold mt-0.5">{companyName || "우리 회사"}</div>
                  )}
                  <div className="text-[11px] text-[var(--text-muted)] mt-1">총 {filtered.length}명</div>
                </div>
                <div className="org-stem" />
                <div className="org-depts">
                  {orgDepts.map(([dept, rows]) => (
                    <div key={dept} className="flex flex-col items-center">
                      <div className="org-stem org-stem-sm" />
                      <div className="org-dept">
                        <div className="org-dept-head">
                          <span className="text-xs font-bold truncate">{dept}</span>
                          <span className="text-[11px] text-[var(--text-dim)] shrink-0">{rows.length}명</span>
                        </div>
                        <div className="py-1">
                          {rows.map((e) => (
                            <div key={e.id} className="org-member">
                              <span className="team-avatar">{(e.name || "?").slice(0, 1)}</span>
                              <span className="text-xs font-semibold truncate flex-1">{e.name || "—"}</span>
                              <span className="text-[11px] text-[var(--text-muted)] shrink-0">{e.position || ""}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="team-cards">
                {pager.view.map((e) => (
                  <div key={e.id} className="team-card">
                    <span className="team-avatar team-avatar-lg">{(e.name || "?").slice(0, 1)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold truncate">{e.name || "—"}</div>
                      <div className="text-xs text-[var(--text-muted)] truncate">{[e.department, e.position].filter(Boolean).join(" · ") || "—"}</div>
                      {e.email && <div className="text-[11px] text-[var(--text-dim)] truncate mt-1"><Ico e="✉" /> {e.email}</div>}
                      {e.phone && <div className="text-[11px] text-[var(--text-dim)] truncate"><Ico e="📞" /> {e.phone}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}
