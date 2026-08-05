// 회사 양식 — 한 프로젝트에서 짠 구성을 회사 안에서 다시 쓴다 (2026-08-05 사장님 지시).
//
//   kind='board'    payload = { columns: ColumnDef[] }              표를 이 칸 구성으로 새로 만든다
//   kind='summary'  payload = { off: string[]; order: string[] }    정리에서 무엇을 어떤 순서로 볼지
//
// 정리 양식은 '끈 것'과 '순서'만 담는다 — 새 지표가 생기면 자동으로 켜진 채 뒤에 붙는다.
//   (켠 것만 담으면 나중에 추가된 지표가 영영 안 보인다.)

import { supabase } from "@/lib/supabase";
import type { ColumnDef } from "@/lib/project-boards";

const db = supabase as any;

export type PresetKind = "board" | "summary";
export type BoardPresetPayload = { columns: ColumnDef[] };
export type SummaryPresetPayload = { off: string[]; order: string[] };

export type Preset = {
  id: string;
  kind: PresetKind;
  name: string;
  template_key: string | null;
  payload: any;
  created_at: string;
};

export async function listPresets(companyId: string, kind: PresetKind): Promise<Preset[]> {
  if (!companyId) return [];
  const { data, error } = await db.from("project_board_presets")
    .select("id, kind, name, template_key, payload, created_at")
    .eq("company_id", companyId).eq("kind", kind).is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as Preset[];
}

export async function savePreset(input: {
  companyId: string; kind: PresetKind; name: string;
  templateKey?: string | null; payload: any; userId?: string | null;
}): Promise<void> {
  const { error } = await db.from("project_board_presets").insert({
    company_id: input.companyId, kind: input.kind, name: input.name.trim() || "이름 없는 양식",
    template_key: input.templateKey ?? null, payload: input.payload, created_by: input.userId || null,
  });
  if (error) throw new Error(error.message);
}

/** 양식 갱신 — 같은 이름으로 다시 저장할 때(덮어쓰기) */
export async function updatePreset(id: string, patch: { name?: string; payload?: any }): Promise<void> {
  const { error } = await db.from("project_board_presets").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** 지우기는 보관 처리 — 되돌릴 수 있게 실제로 지우지 않는다 */
export async function removePreset(id: string): Promise<void> {
  const { error } = await db.from("project_board_presets")
    .update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}
