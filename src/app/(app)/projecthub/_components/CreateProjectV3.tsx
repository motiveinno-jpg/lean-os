"use client";

// 프로젝트 생성 v3 — 이름만 (2026-08-31 사장님: "생성할 때 템플릿 선택 없애자.
//   그냥 기본 먼데이 형식(워크플로우)으로 나와서 내가 쓰고 싶은 대로 쓰게")
//   꾸러미(시작 양식) 고르기는 생성 후 표 화면의 '템플릿' 버튼으로 옮겼다 —
//   monday 템플릿 센터 벤치마킹(카드·미리보기·사용 버튼). TableV3 의 TplPop 참조.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

const db = supabase as any;

export function CreateProjectV3({ companyId, onClose }: {
  companyId: string; userId?: string | null; onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (saving) return;
    const nm = name.trim();
    if (!nm) { toast("프로젝트 이름을 입력해 주세요"); return; }
    setSaving(true);
    try {
      //   item_stages null = 기본 3단계(대기·진행 중·완료) 워크플로우 표
      const { data: deal, error } = await db.from("deals").insert({
        company_id: companyId, name: nm, stage: "estimate", item_stages: null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      toast(`'${nm}' 프로젝트를 만들었습니다 — 표에 바로 적으면 됩니다`);
      onClose();
      router.push(`/projecthub/${deal.id}`);
    } catch (e: any) {
      toast(`생성 실패: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="phv3-modal" role="dialog" aria-modal="true" aria-label="새 프로젝트">
        <h3 className="phv3-modal-title">새 프로젝트</h3>
        <p className="phv3-modal-desc">
          이름만 적으면 <b>기본 워크플로우 표</b>로 시작합니다 — 쓰고 싶은 대로 쓰면 됩니다.
          업무에 맞는 시작 양식이 필요하면 만든 뒤 표 위 <b>템플릿</b> 버튼에서 고릅니다.
        </p>
        <input
          className="phv3-field"
          placeholder="프로젝트 이름"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) create(); }}
        />
        <div className="phv3-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={create}>만들기</button>
        </div>
      </div>
    </div>
  );
}
