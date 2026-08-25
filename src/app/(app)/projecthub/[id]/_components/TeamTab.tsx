"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

// '사람과 기록' 자리 — 프로젝트 담당 배정(2026-07-30 4단계).
//   deal_assignments 테이블은 2026-06 부터 존재했지만 화면이 한 곳도 없어서 8행만 쌓인 채
//   방치돼 있었다(담당자는 deals.internal_manager_id 단 1명). 그 테이블을 여는 화면이다.
//   RLS: company members can view/manage (deals.company_id = get_my_company_id()) — 확인 완료.
//
//   ⚠️ 결재(approval_requests)에는 deal_id 컬럼이 없다 → 프로젝트별 결재 목록은 만들 수 없다.
//      없는 연결을 그럴듯하게 보여주면 안 되므로 이 자리에 넣지 않았다. 연결하려면 먼저
//      approval_requests.deal_id 추가가 필요하다(별도 마이그레이션·기획 필요).

const db = supabase;

type Assignment = {
  id: string; deal_id: string; user_id: string; role: string | null;
  assigned_at: string | null; is_active: boolean | null; handover_notes: string | null;
};
type Member = { id: string; name: string | null };
type Emp = { user_id: string | null; name: string | null; department: string | null; position: string | null; status: string | null };

// 역할 — 자유 입력 대신 고정 목록. 사람이 매번 다른 말을 쓰면 롤업이 안 된다.
const ROLES = ["총괄", "실행", "정산", "지원", "검토"];

export function TeamTab({ dealId, companyId, users, managerId, managerName }: {
  dealId: string; companyId: string; users: Member[];
  managerId?: string | null; managerName?: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState(ROLES[1]);
  const [saving, setSaving] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["deal-assignments", dealId],
    queryFn: async () => {
      const data = logRead("TeamTab:assignments", await db.from("deal_assignments")
        .select("id, deal_id, user_id, role, assigned_at, is_active, handover_notes")
        .eq("deal_id", dealId).order("assigned_at", { ascending: true }));
      return (data || []) as Assignment[];
    },
    enabled: !!dealId,
  });

  // 부서·직급 — employees 를 user_id 로 붙인다(구성원 화면과 같은 소스).
  const { data: emps = [] } = useQuery({
    queryKey: ["deal-team-emps", companyId],
    queryFn: async () => {
      const data = logRead("TeamTab:emps", await db.from("employees")
        .select("user_id, name, department, position, status").eq("company_id", companyId));
      return (data || []) as Emp[];
    },
    enabled: !!companyId,
  });

  // 프로젝트 채널 — chat_channels.deal_id. 있으면 링크, 없으면 만들라고 안내한다.
  const { data: channels = [] } = useQuery({
    queryKey: ["deal-channels", dealId],
    queryFn: async () => {
      const data = logRead("TeamTab:channels", await db.from("chat_channels")
        .select("id, name, type").eq("deal_id", dealId));
      return (data || []) as { id: string; name: string | null; type: string | null }[];
    },
    enabled: !!dealId,
  });

  const empByUser = useMemo(() => {
    const m: Record<string, Emp> = {};
    for (const e of emps) if (e.user_id) m[e.user_id] = e;
    return m;
  }, [emps]);
  const userName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users) m[u.id] = u.name || "(이름 없음)";
    return m;
  }, [users]);

  const active = useMemo(() => rows.filter((r) => r.is_active !== false), [rows]);
  const past = useMemo(() => rows.filter((r) => r.is_active === false), [rows]);
  const assignedIds = useMemo(() => new Set(active.map((a) => a.user_id)), [active]);

  // 부서 롤업 — 배정된 사람들의 소속. 부서 미입력은 '미지정' 으로 묶는다.
  const byDept = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const a of active) {
      const dep = empByUser[a.user_id]?.department || "미지정";
      (m[dep] ||= []).push(userName[a.user_id] || "—");
    }
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [active, empByUser, userName]);

  const add = async () => {
    if (!addUser) { toast("배정할 구성원을 고르세요", "error"); return; }
    if (assignedIds.has(addUser)) { toast("이미 배정된 구성원입니다", "error"); return; }
    setSaving(true);
    try {
      const { error } = await db.from("deal_assignments").insert({
        deal_id: dealId, user_id: addUser, role: addRole, is_active: true,
      });
      if (error) throw new Error(error.message);
      setAddUser("");
      qc.invalidateQueries({ queryKey: ["deal-assignments", dealId] });
      toast("담당으로 배정했습니다", "success");
    } catch (e: any) { toast(e?.message || "배정 실패", "error"); } finally { setSaving(false); }
  };

  const changeRole = async (a: Assignment, role: string) => {
    const { error } = await db.from("deal_assignments").update({ role }).eq("id", a.id);
    if (error) { toast("역할 변경 실패: " + error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["deal-assignments", dealId] });
  };

  // 해제는 지우지 않는다 — 누가 언제까지 맡았는지가 인수인계 기록이다(is_active=false + removed_at).
  const release = async (a: Assignment) => {
    const ok = await appConfirm(
      `${userName[a.user_id] || "이 구성원"}을 담당에서 해제할까요? 기록은 '지난 담당'에 남습니다.`,
      { title: "담당 해제", confirmLabel: "해제" },
    );
    if (!ok) return;
    const { error } = await db.from("deal_assignments")
      .update({ is_active: false, removed_at: new Date().toISOString() }).eq("id", a.id);
    if (error) { toast("해제 실패: " + error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["deal-assignments", dealId] });
    toast("담당에서 해제했습니다", "success");
  };

  const candidates = users.filter((u) => !assignedIds.has(u.id));

  return (
    <div className="pj-team">
      {/* 대표 담당(deals.internal_manager_id) — 목록·알림이 아직 이 값을 쓴다 */}
      <div className="pj-team-owner glass-card">
        <span className="pj-team-owner-k">대표 담당</span>
        <b>{managerName || "미지정"}</b>
        <span className="pj-team-owner-note">목록 카드와 알림이 이 사람을 기준으로 표시됩니다. 프로젝트 수정에서 바꿔요.</span>
      </div>

      <div className="pj-team-box glass-card">
        <div className="pj-team-head">
          <h3>함께 하는 사람 <span>{active.length}명</span></h3>
          <span className="pj-team-hint">여러 명을 역할별로 배정할 수 있습니다</span>
        </div>

        {isLoading ? (
          <p className="pj-sec-empty">불러오는 중…</p>
        ) : active.length === 0 ? (
          <p className="pj-sec-empty">아직 배정된 사람이 없습니다. 아래에서 구성원을 추가하면 각자 맡은 역할이 여기에 남습니다.</p>
        ) : (
          <div className="pj-team-rows">
            {active.map((a) => {
              const e = empByUser[a.user_id];
              return (
                <div key={a.id} className="pj-team-row">
                  <span className="pj-team-avatar">{(userName[a.user_id] || "?").slice(-2)}</span>
                  <span className="pj-team-who">
                    <b>{userName[a.user_id] || "(알 수 없음)"}{a.user_id === managerId && <em>대표 담당</em>}</b>
                    <span>{[e?.department, e?.position].filter(Boolean).join(" · ") || "부서 미입력"}</span>
                  </span>
                  <select value={a.role || ""} onChange={(ev) => changeRole(a, ev.target.value)} className="pj-team-role">
                    <option value="">역할 미지정</option>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button type="button" onClick={() => release(a)} className="pj-team-release">해제</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="pj-team-add">
          <select value={addUser} onChange={(e) => setAddUser(e.target.value)} className="field-input">
            <option value="">구성원 선택</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.name || "(이름 없음)"}</option>)}
          </select>
          <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="field-input">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button type="button" onClick={add} disabled={saving || !addUser} className="btn-primary">
            {saving ? "배정 중…" : "＋ 담당 배정"}
          </button>
        </div>
      </div>

      <div className="pj-team-side">
        <div className="pj-team-box glass-card">
          <div className="pj-team-head"><h3>부서</h3><span className="pj-team-hint">배정된 사람의 소속</span></div>
          {byDept.length === 0 ? (
            <p className="pj-sec-empty">배정된 사람이 없습니다.</p>
          ) : (
            <div className="pj-team-depts">
              {byDept.map(([dep, names]) => (
                <div key={dep} className="pj-team-dept">
                  <b>{dep}</b>
                  <span>{names.join(" · ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pj-team-box glass-card">
          <div className="pj-team-head"><h3>프로젝트 채널</h3></div>
          {channels.length === 0 ? (
            <p className="pj-sec-empty">
              이 프로젝트 채널이 아직 없습니다. <Link href="/chat" className="pj-team-link">메신저</Link>에서 프로젝트 채널을 만들면 여기에 연결됩니다.
            </p>
          ) : (
            <div className="pj-team-channels">
              {channels.map((c) => (
                <Link key={c.id} href={`/chat?channel=${c.id}`} className="pj-team-channel">
                  <b># {c.name || "채널"}</b>
                  <span>열기 →</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {past.length > 0 && (
          <div className="pj-team-box glass-card">
            <div className="pj-team-head"><h3>지난 담당</h3><span className="pj-team-hint">인수인계 기록</span></div>
            <div className="pj-team-past">
              {past.map((a) => (
                <div key={a.id} className="pj-team-past-row">
                  <b>{userName[a.user_id] || "(알 수 없음)"}</b>
                  <span>{a.role || "역할 미지정"}</span>
                  {a.handover_notes && <em>{a.handover_notes}</em>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
