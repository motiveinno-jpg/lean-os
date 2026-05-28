// 2026-05-28 서명 페이지 본문 — 라디오/조건부 텍스트 토큰 파서.
// 토큰 문법:
//   라디오: {{?라디오:포기사유 | 옵션1 | 옵션2 | ... }}
//     - 첫 항목 = fieldKey, 나머지 = 옵션 (모두 필수 선택)
//   조건부 텍스트: {{?텍스트:기타사유 when=포기사유=기타}}
//     - when 절 만족 시에만 표시·필수 입력
// 기존 {{변수}} 텍스트 치환 토큰과는 `?` prefix 로 구분.
// 발송자측 변수 매핑 흐름은 `?` 토큰을 건드리지 않음 (extractTokens 에서 필터).

export type RadioField = {
  kind: 'radio';
  key: string;
  options: string[];
  raw: string; // 원본 토큰 문자열 (PDF/HTML 치환용)
};

export type TextField = {
  kind: 'text';
  key: string;
  when?: { key: string; value: string };
  raw: string;
};

export type SignerField = RadioField | TextField;

// {{?라디오:...}} / {{?텍스트:...}} 만 추출 (?-prefix 토큰).
// 일반 {{변수}} 는 건드리지 않음.
const RADIO_TOKEN_RE = /\{\{\s*\?라디오\s*:\s*([^}]+?)\s*\}\}/g;
const TEXT_TOKEN_RE = /\{\{\s*\?텍스트\s*:\s*([^}]+?)\s*\}\}/g;

// HTML 태그가 토큰 안에 끼었을 가능성 — normalizeVariableTokens 가 이미 정리.
// 추가 정리: 공백 정규화.
function normInner(raw: string): string {
  return String(raw).replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function parseSiyanFields(html: string): { fields: SignerField[] } {
  const fields: SignerField[] = [];
  if (!html) return { fields };

  // 라디오: "포기사유 | 옵션1 | 옵션2 | ..."
  let m: RegExpExecArray | null;
  RADIO_TOKEN_RE.lastIndex = 0;
  while ((m = RADIO_TOKEN_RE.exec(html))) {
    const inner = normInner(m[1]);
    const parts = inner.split('|').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) continue; // key + 최소 1개 옵션 필요
    const [key, ...options] = parts;
    if (!key) continue;
    // 중복 key 제거 — 첫 번째 정의 우선
    if (fields.some((f) => f.key === key)) continue;
    fields.push({ kind: 'radio', key, options, raw: m[0] });
  }

  // 조건부 텍스트: "기타사유 when=포기사유=기타" 또는 그냥 "key" (when 없음)
  TEXT_TOKEN_RE.lastIndex = 0;
  while ((m = TEXT_TOKEN_RE.exec(html))) {
    const inner = normInner(m[1]);
    // when= 절 분리
    const whenIdx = inner.search(/\swhen\s*=/i);
    let key: string;
    let when: { key: string; value: string } | undefined;
    if (whenIdx >= 0) {
      key = inner.slice(0, whenIdx).trim();
      const whenStr = inner.slice(whenIdx).replace(/^\s*when\s*=\s*/i, '').trim();
      const eq = whenStr.indexOf('=');
      if (eq > 0) {
        when = { key: whenStr.slice(0, eq).trim(), value: whenStr.slice(eq + 1).trim() };
      }
    } else {
      key = inner;
    }
    if (!key) continue;
    if (fields.some((f) => f.key === key)) continue;
    fields.push({ kind: 'text', key, when, raw: m[0] });
  }

  return { fields };
}

// when 조건이 활성인지 — 라디오 선택값과 매칭되면 true
export function isFieldActive(field: SignerField, inputs: Record<string, string>): boolean {
  if (field.kind === 'radio') return true;
  if (!field.when) return true;
  return inputs[field.when.key] === field.when.value;
}

// 라디오 필수 + when 만족된 텍스트 필수 검증
export function validateInputs(
  fields: SignerField[],
  inputs: Record<string, string>,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const f of fields) {
    if (!isFieldActive(f, inputs)) continue;
    const v = inputs[f.key];
    if (v == null || String(v).trim() === '') missing.push(f.key);
  }
  return { ok: missing.length === 0, missing };
}

// PDF/HTML 본문 합성용: 토큰을 결과 문자열로 치환.
// 라디오: 모든 옵션을 줄바꿈으로 나열, 선택값 앞에 ☑ 나머지 앞에 ☐.
// 텍스트: when 만족 + 입력값 있으면 그대로, 아니면 빈 문자열.
// signer_inputs 가 null/빈 객체이면 안전 폴백 — 라디오는 옵션 모두 ☐, 텍스트는 빈 문자열.
export function renderFieldToken(
  field: SignerField,
  inputs: Record<string, string> | null | undefined,
): string {
  const ins = inputs || {};
  if (field.kind === 'radio') {
    const selected = ins[field.key];
    return field.options
      .map((opt) => (opt === selected ? `☑ ${opt}` : `☐ ${opt}`))
      .join('\n');
  }
  // text
  if (!isFieldActive(field, ins)) return '';
  const v = ins[field.key];
  return v ? String(v) : '';
}

// HTML 본문에 토큰 치환 — sign 페이지 서명 완료 후 PDF/모달용.
// 라디오는 각 옵션을 줄바꿈 표시 위해 <br/> 로 연결.
export function applySignerInputsToHtml(
  html: string,
  inputs: Record<string, string> | null | undefined,
): string {
  if (!html) return html;
  const ins = inputs || {};
  let out = html;

  // 라디오 치환
  out = out.replace(RADIO_TOKEN_RE, (full, inner) => {
    const innerNorm = normInner(inner);
    const parts = innerNorm.split('|').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return full; // 잘못된 토큰은 원형 유지
    const [key, ...options] = parts;
    const selected = ins[key];
    const html = options
      .map((opt) => {
        const mark = opt === selected ? '☑' : '☐';
        // 선택된 옵션은 굵게
        return opt === selected ? `<strong>${mark} ${escapeHtml(opt)}</strong>` : `${mark} ${escapeHtml(opt)}`;
      })
      .join('<br/>');
    return html;
  });

  // 텍스트 치환
  out = out.replace(TEXT_TOKEN_RE, (full, inner) => {
    const innerNorm = normInner(inner);
    const whenIdx = innerNorm.search(/\swhen\s*=/i);
    let key: string;
    let when: { key: string; value: string } | undefined;
    if (whenIdx >= 0) {
      key = innerNorm.slice(0, whenIdx).trim();
      const whenStr = innerNorm.slice(whenIdx).replace(/^\s*when\s*=\s*/i, '').trim();
      const eq = whenStr.indexOf('=');
      if (eq > 0) when = { key: whenStr.slice(0, eq).trim(), value: whenStr.slice(eq + 1).trim() };
    } else {
      key = innerNorm;
    }
    if (!key) return full;
    // when 미만족 → 빈 문자열
    if (when && ins[when.key] !== when.value) return '';
    const v = ins[key];
    return v ? `<strong>${escapeHtml(String(v))}</strong>` : '';
  });

  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 발송측 변수 매핑에서 ?-prefix 토큰을 제외하기 위한 헬퍼.
// extractTokens 안에서 추출한 raw 토큰명이 이 함수에서 true 면 매핑 UI 에서 숨김.
export function isSignerInputTokenName(name: string): boolean {
  const t = String(name || '').trim();
  return t.startsWith('?라디오') || t.startsWith('?텍스트');
}

// ── Sanity check (dev 콘솔용) ──
if (typeof window !== 'undefined' && (window as any).__SIYAN_FIELDS_DEBUG__) {
  try {
    const sample = `본문 텍스트 {{?라디오:포기사유 | 참여기업 내부 사정 | 상품 미출시 또는 출시 지연 | 자부담금 납부 조건 미인지 | 지원사업 내용 오인 | 기타}} 중간 {{?텍스트:기타사유 when=포기사유=기타}} 끝`;
    const { fields } = parseSiyanFields(sample);
    console.assert(fields.length === 2, '라디오+텍스트 2개 토큰');
    console.assert(fields[0].kind === 'radio' && fields[0].key === '포기사유', '라디오 key');
    console.assert((fields[0] as RadioField).options.length === 5, '라디오 5개 옵션');
    console.assert(fields[1].kind === 'text' && fields[1].key === '기타사유', '텍스트 key');
    console.assert((fields[1] as TextField).when?.key === '포기사유' && (fields[1] as TextField).when?.value === '기타', 'when 절');
    const v1 = validateInputs(fields, {});
    console.assert(!v1.ok && v1.missing.includes('포기사유'), '미선택 시 invalid');
    const v2 = validateInputs(fields, { 포기사유: '기타' });
    console.assert(!v2.ok && v2.missing.includes('기타사유'), '기타 선택 후 텍스트 미입력 invalid');
    const v3 = validateInputs(fields, { 포기사유: '참여기업 내부 사정' });
    console.assert(v3.ok, '비-기타 선택 시 텍스트 불필요 → valid');
    const v4 = validateInputs(fields, { 포기사유: '기타', 기타사유: '사업종료' });
    console.assert(v4.ok, '둘 다 입력 → valid');
    console.log('[signature-fields] sanity OK');
  } catch (e) {
    console.warn('[signature-fields] sanity FAIL', e);
  }
}
