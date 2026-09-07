export interface ApprovalPdfFormField {
  label: string;
  value: string;
}

/** PDF 상단 기안일에 사용할 양식 필드값. 필드가 없으면 호출부에서 등록일로 폴백한다. */
export function approvalDraftDate(formFields: ApprovalPdfFormField[]): string | null {
  const field = formFields.find((item) =>
    item.label.replace(/[\s:：]/g, "") === "기안일"
  );
  const value = field?.value.trim();
  return value && value !== "-" ? value : null;
}
