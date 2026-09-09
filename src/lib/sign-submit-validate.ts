// 외부 서명 제출(/api/sign/submit)의 입력 검증 — 라우트 파일은 핸들러만 export 할 수 있어 여기로 뺐다.
const MAX_SIGNATURE_DATA_URL = 1_500_000;   // 서명 PNG/JPEG data URL 상한(약 1.1MB 이미지)
const MAX_INPUT_KEYS = 100;
const MAX_INPUT_LEN = 500;

type SigData = { type: "draw" | "type" | "upload"; data: string };

/** 서명 데이터 검증 — 그림·업로드는 PNG/JPEG data URL 만, 타이핑은 짧은 글자만. 실패 사유를 돌려준다. */
export function validateSignatureData(v: unknown): { ok: true; value: SigData } | { ok: false; error: string } {
  if (!v || typeof v !== "object") return { ok: false, error: "서명 데이터가 없습니다." };
  const t = (v as { type?: unknown }).type;
  const d = (v as { data?: unknown }).data;
  if (typeof d !== "string" || !d) return { ok: false, error: "서명 데이터가 비어 있습니다." };
  if (t === "type") {
    const text = d.trim();
    if (text.length < 1 || text.length > 40) return { ok: false, error: "서명 이름은 1~40자여야 합니다." };
    if (/[<>]/.test(text)) return { ok: false, error: "서명 이름에 쓸 수 없는 문자가 있습니다." };
    return { ok: true, value: { type: "type", data: text } };
  }
  if (t === "draw" || t === "upload") {
    if (d.length > MAX_SIGNATURE_DATA_URL) return { ok: false, error: "서명 이미지가 너무 큽니다." };
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(d)) return { ok: false, error: "서명 이미지 형식이 올바르지 않습니다." };
    return { ok: true, value: { type: t, data: d } };
  }
  return { ok: false, error: "서명 방식이 올바르지 않습니다." };
}

/** 서명자 입력값 검증 — 문자열 키/값, 개수·길이 제한. HTML 이스케이프는 합성 단계(applySignerInputsToHtml)가 한다. */
export function validateSignerInputs(v: unknown): { ok: true; value: Record<string, string> | null } | { ok: false; error: string } {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "입력값 형식이 올바르지 않습니다." };
  const out: Record<string, string> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > MAX_INPUT_KEYS) return { ok: false, error: "입력값이 너무 많습니다." };
  for (const [k, val] of entries) {
    if (typeof k !== "string" || k.length > 100) return { ok: false, error: "입력값 키가 올바르지 않습니다." };
    if (val == null) continue;
    if (typeof val !== "string") return { ok: false, error: "입력값은 문자열이어야 합니다." };
    if (val.length > MAX_INPUT_LEN) return { ok: false, error: "입력값이 너무 깁니다." };
    out[k] = val;
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

