"use client";

// 프로젝트 참여자 — 대표담당자 한 명 대신 여럿(2026-08-03 사장님 지시).
//   "대체로 여러 인원이 프로젝트를 수행하는데 대표담당자가 있는 게 별로다.
//    담당자를 다중선택하게, 부서를 선택하면 부서에 속한 인원이 자동 태그되게."
//
//   · 머리줄 오른쪽에 얼굴(이니셜) 묶음으로 보인다 — 구글 드라이브 공유 표시와 같은 자리.
//   · 누르면 검색해서 넣고 빼고, 아래에 '부서로 한 번에' 가 붙는다.
//   · 부서는 인사 데이터(employees.department)를 그대로 쓴다 — 프로젝트용 부서를 따로 만들지 않는다.
//   · 행 단위 담당은 표의 '담당' 컬럼이 따로 맡는다(사장님: "그 하위에는 담당자 컬럼은 있어도 좋다").

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";

const db = supabase as any;

export type MemberRow = { id: string; user_id: string; added_via_department: string | null };

/** 이름에서 얼굴 글자 — 한글은 끝 두 글자가 사람을 더 잘 가른다(김혜진 → 혜진) */
export function faceOf(name: string): string {
  const n = (name || "").trim();
  if (!n) return "?";
  return /[가-힣]/.test(n) ? n.slice(-2) : n.slice(0, 2).toUpperCase();
}

export function ProjectMembers({ dealId, companyId, users }: {
  dealId: string; companyId: string; users: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: members = [] } = useQuery({
    queryKey: ["pj-members", dealId],
    queryFn: async () => {
      const data = logRead("ProjectMembers:list", await db.from("project_members")
        .select("id, user_id, added_via_department").eq("deal_id", dealId));
      return (data || []) as MemberRow[];
    },
    enabled: !!dealId,
  });

  // 부서 — 인사 데이터에서. 참여자 팝오버를 열었을 때만 부른다.
  const { data: staff = [] } = useQuery({
    queryKey: ["pj-member-depts", companyId],
    queryFn: async () => {
      const data = logRead("ProjectMembers:staff", await db.from("employees")
        .select("user_id, department, status").eq("company_id", companyId).not("user_id", "is", null));
      return (data || []) as { user_id: string; department: string | null; status: string | null }[];
    },
    enabled: !!companyId && open,
    staleTime: 5 * 60 * 1000,
  });

  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || "이름 없음";
  const memberIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  const depts = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const s of staff) {
      if (s.status === "resigned" || !s.department) continue;
      (m[s.department] = m[s.department] || []).push(s.user_id);
    }
    return Object.entries(m).map(([name, ids]) => ({ name, ids })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [staff]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const pool = users.filter((u) => !memberIds.has(u.id));
    if (!t) return pool.slice(0, 20);
    return pool.filter((u) => (u.name || "").toLowerCase().includes(t)).slice(0, 30);
  }, [users, memberIds, q]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pj-members", dealId] });
    qc.invalidateQueries({ queryKey: ["ph-members"] });   // 목록 화면의 참여자 집계
  };

  const add = async (userIds: string[], viaDept?: string) => {
    const fresh = userIds.filter((id) => !memberIds.has(id));
    if (fresh.length === 0 || busy) return;
    setBusy(true);
    try {
      const rows = fresh.map((user_id) => ({ company_id: companyId, deal_id: dealId, user_id, added_via_department: viaDept || null }));
      const { error } = await db.from("project_members").insert(rows);
      if (error) throw new Error(error.message);
      refresh();
      setQ("");
      toast(viaDept ? `${viaDept} ${fresh.length}명을 넣었습니다.` : `${nameOf(fresh[0])} 님을 넣었습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "참여자 추가 실패", "error");
    } finally { setBusy(false); }
  };

  const remove = async (m: MemberRow) => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await db.from("project_members").delete().eq("id", m.id);
      if (error) throw new Error(error.message);
      refresh();
    } catch (e: any) {
      toast(e?.message || "참여자 제외 실패", "error");
    } finally { setBusy(false); }
  };

  const shown = members.slice(0, 4);
  const rest = members.length - shown.length;

  return (
    <span className="pj-mem">
      <button type="button" className="pj-mem-faces" onClick={() => setOpen((v) => !v)}
        title={members.length === 0 ? "참여자 넣기" : members.map((m) => nameOf(m.user_id)).join(", ")}>
        {members.length === 0 ? (
          <span className="pj-mem-none">＋ 참여자</span>
        ) : (<>
          {shown.map((m) => <i key={m.id} className="pj-mem-face">{faceOf(nameOf(m.user_id))}</i>)}
          {rest > 0 && <i className="pj-mem-face pj-mem-more">+{rest}</i>}
        </>)}
      </button>

      {open && (<>
        <span className="pj-mem-veil" onClick={() => setOpen(false)} />
        <span className="pj-mem-pop">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름으로 찾기"
            className="pj-mem-in" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />

          {members.length > 0 && (
            <span className="pj-mem-block">
              <b>참여 중 {members.length}명</b>
              {members.map((m) => (
                <span key={m.id} className="pj-mem-row">
                  <i className="pj-mem-face">{faceOf(nameOf(m.user_id))}</i>
                  {nameOf(m.user_id)}
                  {m.added_via_department && <em>{m.added_via_department}</em>}
                  <button type="button" onClick={() => remove(m)} title="빼기">✕</button>
                </span>
              ))}
            </span>
          )}

          <span className="pj-mem-block">
            <b>넣기</b>
            {matches.length === 0 ? <span className="pj-mem-empty">더 넣을 사람이 없습니다</span> : matches.map((u) => (
              <button key={u.id} type="button" className="pj-mem-row pj-mem-pick" onClick={() => add([u.id])}>
                <i className="pj-mem-face">{faceOf(u.name)}</i>{u.name}
              </button>
            ))}
          </span>

          {depts.length > 0 && (
            <span className="pj-mem-block">
              <b>부서로 한 번에</b>
              {depts.map((d) => {
                const left = d.ids.filter((id) => !memberIds.has(id)).length;
                return (
                  <button key={d.name} type="button" className="pj-mem-row pj-mem-pick" disabled={left === 0}
                    onClick={() => add(d.ids, d.name)}>
                    <i className="pj-mem-face pj-mem-dept">부</i>{d.name}
                    <em>{left === 0 ? "모두 참여 중" : `${left}명 추가`}</em>
                  </button>
                );
              })}
            </span>
          )}
        </span>
      </>)}
    </span>
  );
}
