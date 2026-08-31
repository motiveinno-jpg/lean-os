// ── 원천징수이행상황신고서(C103900) 전자신고 파일 (2026-08-31 세무 4차 2단계, 결정 106) ──
//
//   규격: 「원천신고 전산매체 제출요령 V2(2020.04.22)」 — 사장님이 2026-08-31 전달한 국세청 문서.
//   레이아웃은 문서의 '테이블 형식' 표를 **그대로** 옮겨 적었다(누적 바이트 위치까지 문서와 대조).
//   · 파일: LINE SEQUENTIAL(레코드마다 CR/LF) · ASCII + 한글 KSC-5601 2바이트
//   · 파일명: 작성일자 + C103900.신고구분상세코드 (예: 20260910C103900.01)
//   · 레코드: '21' Header(400) → '22' 환급세액 조정(200) → '23' 원천징수 명세(150) × 소득코드
//   · '23'은 실제 금액이 있는 소득코드만 생성한다(0으로 채운 레코드 금지 — 문서 명시)
//
//   ★ 베타(모티브 게이트 tax_efile): 홈택스 '변환 신고' 검증 + 세무사 검토로 실신고 1회 통과 전엔
//     전체 오픈하지 않는다. 이 화면이 만드는 건 정기(01)·매월(01)·연말정산 없음(N)의 기본형이다 —
//     수정신고·반기·환급신청·부표는 범위 밖(홈택스에서 직접).

import { buildNtsFile, type NtsField, type NtsIssue } from "@/lib/nts-efile";

export type WhtEfileRow = {
  /** 원천징수소득코드 — A01 근로 간이세액 · A10 근로 가감계 · A25 사업소득 매월징수 · A30 사업소득 가감계 · A99 총합계 */
  code: "A01" | "A10" | "A25" | "A30" | "A99";
  n: number; pay: number; tax: number;
};
export type WhtEfileInput = {
  bizNo: string;        // 사업자등록번호 10자리(숫자만)
  hometaxId: string;    // 홈택스 사용자ID (Header 11번, Not Null)
  companyName: string;  // 법인명(상호) — Not Null
  ceoName: string;      // 대표자명 — Not Null
  address?: string; phone?: string; email?: string;
  yearMonth: string;    // 귀속연월 = 지급연월 YYYY-MM (매월 정기신고: 같은 달, 문서 §제출·징수·귀속 작성법)
  submitYm: string;     // 제출연월 YYYY-MM = 지급연월 + 1 (매월 정기: 지급연월 = 제출연월 - 1)
  madeOn: string;       // 작성일자 YYYY-MM-DD
  rows: WhtEfileRow[];
};

const ym = (s: string) => s.replace(/-/g, "").slice(0, 6);
const ymd = (s: string) => s.replace(/-/g, "").slice(0, 8);
const digits = (s: string) => String(s || "").replace(/[^0-9]/g, "");

const C = (name: string, len: number, value: string): NtsField => ({ name, len, type: "X", value });
const N = (name: string, len: number, value: number): NtsField => ({ name, len, type: "9", value });

/** '21' Header — 문서 누적 위치: 2,9,22,24,26,28,31,37,43,49,69,74,84,114,120,134,164,234,248,298,328,330,331~338,341,361,369,373,400 */
function headerRecord(i: WhtEfileInput): NtsField[] {
  return [
    C("자료구분", 2, "21"),
    C("서식코드", 7, "C103900"),
    C("납세자ID", 13, digits(i.bizNo)),           // 사업자번호 10자리, 좌측 수록 + 우측 공백
    C("세목코드", 2, "14"),
    C("신고구분코드", 2, "01"),                    // 정기
    C("신고구분상세코드", 2, "01"),                // 정기
    C("신고서종류코드", 3, "F01"),
    C("귀속연월", 6, ym(i.yearMonth)),
    C("지급연월", 6, ym(i.yearMonth)),
    C("제출연월", 6, ym(i.submitYm)),
    C("사용자ID", 20, i.hometaxId.trim()),
    C("민원종류코드", 5, "FF001"),
    C("세무대리인사업자번호", 10, ""),
    C("세무대리인성명", 30, ""),
    C("세무대리인관리번호", 6, ""),
    C("세무대리인전화번호", 14, ""),
    C("법인명(상호)", 30, i.companyName.trim()),
    C("사업장소재지", 70, (i.address || "").trim()),
    C("사업장전화번호", 14, (i.phone || "").trim()),
    C("전자메일주소", 50, (i.email || "").trim()),
    C("성명(대표자명)", 30, i.ceoName.trim()),
    C("원천신고구분", 2, "01"),                    // 매월
    C("연말정산여부", 1, "N"),
    C("소득처분여부", 1, "N"),
    C("환급신청여부", 1, "N"),
    C("일괄납부여부", 1, "N"),
    C("사업자단위과세여부", 1, "N"),
    C("신고서부표여부", 1, "N"),
    C("차월이월환급세액승계명세여부", 1, "N"),
    C("기납부세액명세서제출여부", 1, "N"),
    C("예입처(은행코드)", 3, ""),
    C("계좌번호", 20, ""),
    C("작성일자", 8, ymd(i.madeOn)),
    C("세무프로그램코드", 4, "9000"),              // 업체코드 없는 경우 9000 (문서 34번)
    C("공란", 27, ""),
  ];
}

/** '22' 환급세액 조정(200) — 환급 없음 기본형: 전부 0 (문서: 값이 없어도 0으로 채운다) */
function adjustRecord(): NtsField[] {
  return [
    C("자료구분", 2, "22"),
    C("서식코드", 7, "C103900"),
    N("(12)전월미환급세액", 15, 0),
    N("(13)기환급신청세액", 15, 0),
    N("(14)차감잔액", 15, 0),
    N("(15)일반환급세액", 15, 0),
    N("(16)신탁재산세액", 15, 0),
    N("(17)그밖의환급세액-금융회사등", 15, 0),
    N("(17)그밖의환급세액-합병등", 15, 0),
    N("(18)조정대상환급세액", 15, 0),
    N("(19)당월조정환급세액계", 15, 0),
    N("(20)차월이월환급세액", 15, 0),
    N("(21)환급신청액", 15, 0),
    N("승계대상합계차월이월환급세액", 15, 0),
    C("공란", 11, ""),
  ];
}

/** '23' 원천징수 명세 및 납부세액(150) — 소득코드 하나당 한 레코드 */
function detailRecord(r: WhtEfileRow): NtsField[] {
  return [
    C("자료구분", 2, "23"),
    C("서식코드", 7, "C103900"),
    C("원천징수소득코드", 3, r.code),
    N("(4)인원", 15, r.n),
    N("(5)총지급액", 15, r.pay),
    N("(6)징수세액-소득세등", 15, r.tax),
    N("(7)징수세액-농특세", 15, 0),
    N("(8)가산세", 15, 0),
    N("(9)당월조정환급세액", 15, 0),
    N("(10)납부세액-소득세등", 15, r.tax),         // 조정환급·가산세 0 → 납부세액 = 징수세액
    N("(11)납부세액-농특세", 15, 0),
    C("공란", 18, ""),
  ];
}

export function buildWhtEfile(i: WhtEfileInput): { bytes: Uint8Array | null; fileName: string; issues: NtsIssue[] } {
  const issues: NtsIssue[] = [];
  if (digits(i.bizNo).length !== 10) issues.push({ field: "사업자등록번호", message: `10자리 숫자여야 합니다 (지금 '${i.bizNo}') — 회사설정에서 채우세요` });
  if (!i.hometaxId.trim()) issues.push({ field: "홈택스 사용자ID", message: "필수입니다 (Header 11번 · Not Null)" });
  if (i.hometaxId.trim().length > 20) issues.push({ field: "홈택스 사용자ID", message: "20자를 넘을 수 없습니다" });
  if (!i.companyName.trim()) issues.push({ field: "법인명(상호)", message: "필수입니다 — 회사설정에서 채우세요" });
  if (!i.ceoName.trim()) issues.push({ field: "대표자명", message: "필수입니다 — 회사설정에서 채우세요" });
  //   '23'은 실제 금액이 있는 코드만 — 무실적(전부 0)은 전산매체 대상이 아니라 홈택스에서 직접 신고
  const rows = i.rows.filter((r) => r.n > 0 || r.pay > 0 || r.tax !== 0);
  if (rows.length === 0) issues.push({ field: "명세", message: "금액이 있는 소득이 없습니다 — 무실적 신고는 홈택스에서 직접 하세요(0 레코드 생성 금지, 규격 명시)" });
  for (const r of rows) {
    if (r.n > 0 && r.pay <= 0) issues.push({ field: r.code, message: "인원이 1명 이상이면 총지급액은 0보다 커야 합니다(규격 검증)" });
    if (r.n === 0 && r.pay > 0) issues.push({ field: r.code, message: "총지급액이 있으면 인원이 있어야 합니다(규격 검증)" });
    if (r.tax < 0) issues.push({ field: r.code, message: "이 화면의 기본형(정기·매월)에서 음수 세액은 지원하지 않습니다 — 홈택스에서 직접" });
  }
  if (issues.length > 0) return { bytes: null, fileName: "", issues };

  //   레코드 길이는 규격 그대로 검증 — Header 400 · 조정 200 · 명세 150. 개별 길이가 달라 레코드별로 검증한다.
  const recs: { fields: NtsField[]; len: number }[] = [
    { fields: headerRecord(i), len: 400 },
    { fields: adjustRecord(), len: 200 },
    ...rows.map((r) => ({ fields: detailRecord(r), len: 150 })),
  ];
  const all: NtsIssue[] = [];
  const chunks: number[] = [];
  for (const rec of recs) {
    const built = buildNtsFile([rec.fields], { recordLen: rec.len, lineBreak: "\r\n" });
    all.push(...built.issues);
    chunks.push(...built.bytes);
  }
  if (all.length > 0) return { bytes: null, fileName: "", issues: all };
  return { bytes: new Uint8Array(chunks), fileName: `${ymd(i.madeOn)}C103900.01`, issues: [] };
}
