"use client";

// 프로젝트 생성 v3 — 이름 + 시작 꾸러미 (2026-08-31 기획 결정 0-7)
//   꾸러미는 초기 내용(할 일·예정 틀·단계 이름)만 채운다. 구조는 어느 것을 골라도 같은 한 장 —
//   옛 템플릿(구조를 영구 결정)과 다른 점. '빈 프로젝트'가 Enter 기본 동선.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { STARTERS, type Starter } from "@/lib/project-items";

const db = supabase as any;

export function CreateProjectV3({ companyId, userId, onClose }: {
  companyId: string; userId?: string | null; onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function create(starter: Starter) {
    if (saving) return;
    const nm = name.trim();
    if (!nm) { toast("프로젝트 이름을 입력해 주세요"); return; }
    setSaving(true);
    try {
      const { data: deal, error } = await db.from("deals").insert({
        company_id: companyId,
        name: nm,
        stage: "estimate",
        item_stages: starter.stages ?? null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      if (starter.seeds.length > 0) {
        const rows = starter.seeds.map((s, i) => ({
          company_id: companyId,
          deal_id: deal.id,
          kind: s.kind,
          money_kind: s.moneyKind ?? null,
          name: s.name,
          status: "todo",
          tags: s.tags ?? [],
          priority: s.priority ?? null,
          is_milestone: !!s.isMilestone,
          position: i,
          created_by: userId ?? null,
        }));
        const { error: se } = await db.from("project_items").insert(rows);
        if (se) throw new Error(se.message);
      }
      toast(starter.key === "blank"
        ? `'${nm}' 프로젝트를 만들었습니다 — 바로 입력하면 됩니다`
        : `'${nm}' 프로젝트를 '${starter.name}' 꾸러미로 만들었습니다 — 시작 항목이 채워졌습니다`);
      onClose();
      router.push(`/projecthub/${deal.id}${starter.firstTab !== "todo" ? `?tab=${starter.firstTab}` : ""}`);
    } catch (e: any) {
      toast(`생성 실패: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="phv3-modal phv3-modal-wide" role="dialog" aria-modal="true" aria-label="새 프로젝트">
        <h3 className="phv3-modal-title">새 프로젝트</h3>
        <p className="phv3-modal-desc">
          이름을 입력하고 하려는 일을 고르면 시작할 내용이 채워집니다.
          <b> 어느 것을 골라도 화면 구조는 같은 한 장</b>이라 나중에 자유롭게 바꾸고 섞을 수 있습니다.
        </p>
        <input
          className="phv3-field"
          placeholder="프로젝트 이름"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(STARTERS.find((s) => s.key === "blank")!); }}
        />
        <div className="phv3-starter-grid">
          {STARTERS.map((s) => (
            <button key={s.key} type="button" className="phv3-starter" disabled={saving} onClick={() => create(s)}>
              <b>{s.icon} {s.name}</b>
              <span>{s.desc}</span>
            </button>
          ))}
        </div>
        <p className="phv3-note">꾸러미 = 시작값(할 일·예정 금액 틀·단계 이름)일 뿐, 구조를 결정하지 않습니다. Enter = 빈 프로젝트.</p>
      </div>
    </div>
  );
}
