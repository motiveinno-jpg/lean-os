"use client";
//   인사 처리할 것 팝업 (2026-08-27 인사 5차) — 요약 줄 숫자를 누르면 내역. 확정·통보는 사람.
import type { HrTodoGroup } from "@/lib/hr-todo";

const GO: Record<string, string> = { contracts: "/hr-templates?tab=packages", history: "/employees", leave: "/employees?tab=leave", attendance: "/attendance?tab=records" };

export function HrTodoDialog({ groups, loading, onClose, onEmployee }: { groups: HrTodoGroup[]; loading: boolean; onClose: () => void; onEmployee?: (id: string, go?: string) => void }) {
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">인사 처리할 것 — {total}건</h3>
        <p className="inv-modal-desc">기한(계약 만료·수습 종료·1주년·미서명·공휴일)과 근태 이상(52시간 예상·연속 지각·퇴근 누락), 연차촉진 대상을 규칙으로 모았습니다. 여기서는 보기만 — 처리(발송·발령·정정)는 각 화면에서 사람이 합니다.</p>
        {loading ? <div className="collect-empty">모으는 중…</div> : total === 0 ? <div className="collect-empty">지금 처리할 것이 없습니다</div> : (
          <div className="hr-todo-groups">
            {groups.map((g) => (
              <div key={g.key} className="hr-todo-group">
                <div className="hr-todo-head"><b>{g.label}</b> <span className="collect-tab-cnt">{g.items.length}</span> <span className="hr-src-tag">{g.source}</span> <span className="inv-hint">{g.hint}</span></div>
                <ul className="hr-todo-list">
                  {g.items.map((it, i) => (
                    <li key={i}>
                      {it.employee_id && onEmployee ? <button type="button" className="bz-link" onClick={() => onEmployee(it.employee_id!, g.go)}>{it.name}</button> : <b>{it.name}</b>}
                      <span>{it.text}</span>{it.date && <span className="ev-dim mono-number">{it.date}</span>}
                    </li>
                  ))}
                </ul>
                {g.go && GO[g.go] && <a className="bz-link hr-todo-go" href={GO[g.go]}>처리하러 가기 →</a>}
              </div>
            ))}
          </div>
        )}
        <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}
