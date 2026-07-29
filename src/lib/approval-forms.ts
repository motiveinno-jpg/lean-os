// 결재 양식 빌더 CRUD (2026-07-01, HR 서비스식 커스텀 결재 양식)
//   회사가 만든 결재 양식(커스텀 필드 + 내용 템플릿 + 결재선 단계)을 관리. 새 요청에서 선택해 사용.

import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

export type ApprovalFieldType = "text" | "number" | "amount" | "date" | "select" | "textarea" | "fixed";
export const FIELD_TYPE_LABEL: Record<ApprovalFieldType, string> = {
  text: "한 줄 텍스트", number: "숫자", amount: "금액", date: "날짜", select: "선택(드롭다운)", textarea: "여러 줄 텍스트", fixed: "직접입력 고정값",
};

export interface ApprovalFormField {
  key: string;
  label: string;
  type: ApprovalFieldType;
  required?: boolean;
  options?: string[]; // type='select'
  default_value?: string; // type='fixed' — 양식에 고정 표시할 값(작성자 수정 불가)
}

export type ApproverType = "role" | "user";
export interface ApprovalFormStage {
  stage: number;
  name: string;
  approver_type: ApproverType;
  approver_role?: string | null;   // approver_type='role'
  approver_user_ids?: string[];    // approver_type='user'
  required_count?: number;
}

export interface ApprovalForm {
  id: string;
  company_id: string;
  name: string;
  category: string | null;
  description: string | null;
  fields: ApprovalFormField[];
  content_template: string | null;
  stages: ApprovalFormStage[];
  reference_user_ids: string[]; // 참조(CC) — 결재선과 별개로 결과를 통보받는 인원, 양식에서 미리 지정
  allow_requester_edit: boolean;
  use_attachment: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 결재 양식 목록.
 * @param opts.includeInactive 비활성(삭제 처리된) 양식까지 포함.
 *   기안 화면의 양식 선택은 활성만 써야 하지만, **이미 기안된 문서를 표시·PDF 출력**할 때는
 *   비활성 양식도 필요하다 — 양식이 삭제되면 fields(라벨 정의)를 못 찾아 과거 문서의
 *   필드값이 표가 아닌 평문으로 떨어지기 때문(2026-07-27 지출결의서 건).
 */
export async function listApprovalForms(opts?: { includeInactive?: boolean }): Promise<ApprovalForm[]> {
  let q = db.from("approval_forms").select("*");
  if (!opts?.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as ApprovalForm[];
}

export interface SaveApprovalFormInput {
  id?: string;
  companyId: string;
  name: string;
  category?: string | null;
  description?: string | null;
  fields: ApprovalFormField[];
  contentTemplate?: string | null;
  stages: ApprovalFormStage[];
  referenceUserIds?: string[];
  allowRequesterEdit?: boolean;
  useAttachment?: boolean;
  createdBy?: string | null;
}

export async function saveApprovalForm(input: SaveApprovalFormInput): Promise<string> {
  const row: Record<string, unknown> = {
    company_id: input.companyId,
    name: input.name.trim(),
    category: input.category || null,
    description: input.description || null,
    fields: input.fields,
    content_template: input.contentTemplate || null,
    stages: input.stages,
    reference_user_ids: input.referenceUserIds ?? [],
    allow_requester_edit: input.allowRequesterEdit ?? true,
    use_attachment: input.useAttachment ?? true,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await db.from("approval_forms").update(row as never).eq("id", input.id);
    if (error) throw error;
    return input.id;
  }
  row.created_by = input.createdBy || null;
  const { data, error } = await db.from("approval_forms").insert(row as never).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function deleteApprovalForm(id: string): Promise<void> {
  // 소프트 삭제 — 기존 요청의 form_id 참조 보존
  const { error } = await db.from("approval_forms").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
