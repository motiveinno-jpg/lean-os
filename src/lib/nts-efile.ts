// ── 국세청 전자신고 파일 공통 엔진 (2026-08-31 세무 4차, 결정 106 — docs/20260831_PLAN_tax_module.md) ──
//
//   홈택스 '신고서 파일 변환' 업로드용 파일은 **고정폭 텍스트 · EUC-KR(실제로는 CP949) 바이트 기준**이다.
//   더존·이카운트가 만드는 그 파일이고, 오프셋이 한 바이트만 밀려도 숫자가 엉뚱한 칸으로 들어간다.
//
//   ★ 그래서 이 파일은 **레이아웃을 코드에 박지 않는다** — 레이아웃은 데이터(NtsField[])다.
//     국세청 규격 문서(홈택스 자료실 '전자신고 파일설명서' — 로그인 다운로드, 연도별 개정)를 받으면
//     서식별 레이아웃 테이블만 채워서 켠다. 문서 없이 오프셋을 추측해 만들지 않는다(가산세 리스크).
//   ★ 초과·미지원 문자는 **자르거나 바꿔치지 않고 이슈로 돌려준다** — 소리 없이 값이 손상된 파일이
//     형식 검증을 통과하는 것이 최악이다. 이슈가 하나라도 있으면 파일을 내려주지 않는 것이 호출부 규칙.
//
//   인코더: 브라우저·Node 에 EUC-KR **인코더**는 없지만 **디코더**(TextDecoder)는 있다 —
//   전체 바이트쌍을 한 번 디코드해 역테이블(문자 → 바이트쌍)을 만든다. 의존성 0.

export type NtsFieldType = "X" | "9"; // X=문자(좌측 정렬·공백 채움) / 9=숫자(우측 정렬·0 채움)
export type NtsField = { name: string; len: number; type: NtsFieldType; value: string | number };
export type NtsIssue = { field: string; message: string };

// ── EUC-KR(CP949) 인코딩 ──────────────────────────────────────────────────

let REV: Map<string, number> | null = null; // 문자 → (hi<<8)|lo

/** 역테이블 — 브라우저의 TextDecoder('euc-kr') 는 WHATWG 규격상 CP949(UHC)라 확장 한글('똠' 등)도 나온다.
 *  ⚠️ Node(ICU)는 더 엄격한 순수 EUC-KR 일 수 있다 — 파일 생성은 브라우저에서만 하므로 실사용은 CP949.
 *  어느 쪽이든 표현 못 하는 문자는 bad 로 돌아와 이슈가 된다(조용한 누락 없음). */
function eucKrTable(): Map<string, number> {
  if (REV) return REV;
  const dec = new TextDecoder("euc-kr", { fatal: false });
  const rev = new Map<string, number>();
  const buf = new Uint8Array(2);
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x41; lo <= 0xfe; lo++) {
      buf[0] = hi; buf[1] = lo;
      const ch = dec.decode(buf);
      //   유효한 2바이트 문자만 — 깨진 쌍은 U+FFFD(대체 문자)로 나온다
      if (ch.length === 1 && ch !== "�" && !rev.has(ch)) rev.set(ch, (hi << 8) | lo);
    }
  }
  REV = rev;
  return rev;
}

/** 한 글자씩 EUC-KR 바이트로. 표현 못 하는 문자는 bad 에 담아 돌려준다(바꿔치지 않는다). */
export function encodeEucKr(s: string): { bytes: number[]; bad: string[] } {
  const rev = eucKrTable();
  const bytes: number[] = [];
  const bad: string[] = [];
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) { bytes.push(code); continue; }   // ASCII 인쇄 문자
    const pair = rev.get(ch);
    if (pair == null) { bad.push(ch); continue; }
    bytes.push(pair >> 8, pair & 0xff);
  }
  return { bytes, bad };
}

/** EUC-KR 바이트 길이 — 규격의 '길이'는 글자 수가 아니라 바이트 수다 */
export function eucKrLen(s: string): number {
  return encodeEucKr(s).bytes.length;
}

// ── 필드·레코드 채우기 ─────────────────────────────────────────────────────

const SPACE = 0x20, ZERO = 0x30;

/** 필드 하나를 규격 폭으로. 초과·미지원 문자·음수는 이슈 — 자르지 않는다. */
export function packField(f: NtsField): { bytes: number[]; issues: NtsIssue[] } {
  const issues: NtsIssue[] = [];
  if (f.type === "9") {
    const n = typeof f.value === "number" ? f.value : Number(String(f.value).trim() || 0);
    if (!Number.isFinite(n)) { issues.push({ field: f.name, message: `숫자가 아닙니다: ${String(f.value)}` }); return { bytes: new Array(f.len).fill(ZERO), issues }; }
    if (n < 0) issues.push({ field: f.name, message: `음수는 이 필드에 직접 못 넣습니다(규격의 부호 필드 사용): ${n}` });
    const digits = String(Math.abs(Math.round(n)));
    if (digits.length > f.len) { issues.push({ field: f.name, message: `자릿수 초과 — ${digits.length}자리 > 폭 ${f.len}` }); return { bytes: new Array(f.len).fill(ZERO), issues }; }
    const out = new Array<number>(f.len).fill(ZERO);
    for (let i = 0; i < digits.length; i++) out[f.len - digits.length + i] = digits.charCodeAt(i);
    return { bytes: out, issues };
  }
  const s = String(f.value ?? "");
  const { bytes, bad } = encodeEucKr(s);
  for (const ch of bad) issues.push({ field: f.name, message: `EUC-KR 로 표현할 수 없는 문자: '${ch}' — 값을 고쳐야 합니다` });
  if (bytes.length > f.len) {
    issues.push({ field: f.name, message: `길이 초과 — ${bytes.length}바이트 > 폭 ${f.len} ('${s}')` });
    return { bytes: new Array(f.len).fill(SPACE), issues };
  }
  return { bytes: [...bytes, ...new Array(f.len - bytes.length).fill(SPACE)], issues };
}

/** 레코드 하나 — 필드를 이어 붙이고, 규격이 정한 레코드 길이와 다르면 이슈. */
export function packRecord(fields: NtsField[], expectLen?: number): { bytes: Uint8Array; issues: NtsIssue[] } {
  const issues: NtsIssue[] = [];
  const parts: number[] = [];
  for (const f of fields) {
    const r = packField(f);
    parts.push(...r.bytes);
    issues.push(...r.issues);
  }
  if (expectLen != null && parts.length !== expectLen)
    issues.push({ field: "(레코드)", message: `레코드 길이 ${parts.length} ≠ 규격 ${expectLen} — 레이아웃 테이블을 확인하세요` });
  return { bytes: new Uint8Array(parts), issues };
}

/** 파일 전체 — 레코드 사이 개행은 규격마다 달라 옵션(기본 CRLF). 이슈가 있으면 내려받지 말 것. */
export function buildNtsFile(
  records: NtsField[][],
  opts: { recordLen?: number; lineBreak?: "\r\n" | "\n" | "" } = {},
): { bytes: Uint8Array; issues: NtsIssue[] } {
  const br = opts.lineBreak ?? "\r\n";
  const brBytes = [...br].map((c) => c.charCodeAt(0));
  const issues: NtsIssue[] = [];
  const chunks: number[] = [];
  records.forEach((fields, i) => {
    const r = packRecord(fields, opts.recordLen);
    issues.push(...r.issues.map((x) => ({ ...x, message: `${i + 1}번째 레코드 · ${x.message}` })));
    chunks.push(...r.bytes);
    if (i < records.length - 1 || br) chunks.push(...brBytes);
  });
  return { bytes: new Uint8Array(chunks), issues };
}

/** 브라우저 다운로드 — text/plain 으로 주면 브라우저가 인코딩을 건드릴 수 있어 octet-stream 으로 */
export function downloadNtsBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── 서식 레이아웃 등록부 ───────────────────────────────────────────────────
//
//   ★ 여기가 비어 있는 동안 화면에는 전자신고 파일 버튼이 **뜨지 않는다** ("되는 척 금지").
//   홈택스 자료실 '전자신고 파일설명서'(원천세·부가세, 연도별)를 받으면:
//     1) 서식별로 NtsLayout 을 채운다 (레코드 길이·필드 폭·타입을 문서 그대로 옮겨 적기)
//     2) feature_rollout 에 'tax_efile' 을 모티브만 넣고 화면 버튼을 게이트로 연다
//     3) 홈택스 변환 검증 + 세무사 검토로 실제 신고 1회를 통과한 뒤 전체 오픈 (결정 106)
export type NtsLayout = {
  /** 서식 구분 — 'wht'(원천징수이행상황신고서) · 'vat'(부가세 신고) 등 */
  key: string;
  name: string;
  /** 규격 문서 버전 — 화면에 적는다(연도별 개정 시 어긋남이 보이게) */
  specVersion: string;
  recordLen: number;
  lineBreak: "\r\n" | "\n" | "";
};
export const NTS_LAYOUTS: NtsLayout[] = [
  //   아직 없음 — 규격 문서 확보 대기 (2026-08-31). 추측으로 채우지 말 것.
];
