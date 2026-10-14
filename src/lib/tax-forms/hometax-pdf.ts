// ── 홈택스 연말정산 간소화 PDF(소득·세액공제 증명서류) 읽기 — 2026-10-14 연말정산 5단계 ──
//
//   사장님 결정: 직원 브라우저 안에서만 읽는다(서버·AI 로 보내지 않음, 원본 저장 안 함). 읽은 값은 '제안' — 직원이 확인하고 칸에 넣는다.
//   구조는 실물(2025년 귀속 간소화 PDF 14쪽)에서 확인한 것만 믿는다:
//   · 페이지(덩어리)마다 「YYYY년 귀속 소득·세액공제 증명서류 … [항목]」 제목 → '성 명' 줄 다음 줄 첫 칸 = 그 덩어리의 사람
//   · 금액 = '인별합계금액 ¦ n' (한 사람이 여러 쪽이면 마지막 쪽에만 있다)
//   · 신용카드·직불카드 등·현금영수증 = '일반 ¦ 전통시장 ¦ 대중교통 ¦ 문화체육 (¦ 주택임차료) ¦ 합계금액' 머리 다음 줄이 금액
//   · 의료비 = '의료비 인별합계금액' · '안경구입비 인별합계금액' · '산후조리원 인별합계금액'
//   · [소득기준 초과 부양가족 내역] = 마지막 칸 'Y' 인 사람 — 의료비 말고는 공제 대상이 아니다(기본공제대상자 요건)
//   · 건강보험·고용보험·국민연금 = 급여에서 이미 잡힌다 → 넣지 않는다(참고로만)
//   실물에 없던 항목(기부금·월세·연금저축·주택자금·학교 교육비)은 같은 틀(인별합계금액)로 찾고, 칸을 확신하지 못하면 '확인 필요'로 둔다.

export type PdfTarget =
  | "insurance" | "insuranceDisabled" | "medicalSelf" | "medicalOthers" | "medicalInfertility" | "medicalPremature"
  | "eduSelf" | "eduK12" | "eduUniv" | "eduDisabled"
  | "donPolitical" | "donSpecial" | "donGeneral" | "donReligious"
  | "monthlyRent" | "rentLoanRepay" | "housingSaving" | "mortgageInterest" | "pensionSaving" | "irp"
  | "card.credit" | "card.debitCash" | "card.market" | "card.transit" | "card.culture";

export const PDF_TARGET_LABEL: Record<PdfTarget, string> = {
  insurance: "보장성 보험료", insuranceDisabled: "장애인전용 보험료",
  medicalSelf: "의료비 — 본인·65세 이상·장애인·6세 이하", medicalOthers: "의료비 — 그 밖 부양가족",
  medicalInfertility: "난임 시술비", medicalPremature: "미숙아·선천성이상아",
  eduSelf: "교육비 — 본인", eduK12: "교육비 — 취학 전·초중고", eduUniv: "교육비 — 대학생", eduDisabled: "장애인 특수교육비",
  donPolitical: "정치자금 기부금", donSpecial: "특례기부금", donGeneral: "일반기부금 (종교 외)", donReligious: "종교단체 기부금",
  monthlyRent: "월세", rentLoanRepay: "주택임차 차입금 원리금", housingSaving: "주택청약 납입액", mortgageInterest: "장기주택저당 이자",
  pensionSaving: "연금저축", irp: "퇴직연금(IRP)",
  "card.credit": "신용카드", "card.debitCash": "체크카드·현금영수증", "card.market": "전통시장", "card.transit": "대중교통", "card.culture": "도서·공연·박물관 등",
};

export type PdfItem = {
  section: string; person: string; self: boolean; amount: number;
  /** 넣을 칸 — null 이면 '확인 필요'(직원이 고른다) */
  target: PdfTarget | null;
  /** 기본으로 넣을지 — 소득기준 초과 부양가족(의료비 외)은 끈다. 칸 미정이어도 켜 둔다(직원이 고르거나 끈다) */
  use: boolean;
  note?: string;
};
export type PdfParsed = {
  year: number | null; self: string | null; items: PdfItem[];
  overIncome: string[];
  /** 급여에서 잡히는 것 — 넣지 않고 보여만 준다 */
  info: { section: string; amount: number }[];
  /** 덩어리를 찾았지만 금액 줄이 없던 항목 */
  missed: string[];
};

const num = (s: string | undefined): number | null => {
  if (s == null) return null;
  const t = s.replace(/[,\s원]/g, "");
  return /^-?\d+$/.test(t) ? Number(t) : null;
};
const norm = (s: string) => s.replace(/\s+/g, "");

/** 칸 이름 → 넣을 칸. 사람이 본인인지에 따라 달라지는 것(의료비·교육비)은 함수로 */
function targetOf(section: string, self: boolean): { target: PdfTarget | null; note?: string } | "card" | "info" | "skip" {
  const s = norm(section);
  if (/건강보험|고용보험|국민연금/.test(s)) return "info";
  if (/소득기준초과/.test(s)) return "skip";
  if (/신용카드|직불카드|현금영수증/.test(s)) return "card";
  if (/장애인전용/.test(s) && !/보장성보험,/.test(s)) return { target: "insuranceDisabled" };
  if (/보장성보험/.test(s)) return { target: "insurance", note: "장애인전용 보험이 섞여 있으면 그 금액만 '장애인전용 보험료'로 옮기세요" };
  if (/학자금/.test(s)) return self ? { target: "eduSelf" } : { target: null, note: "본인 학자금 대출만 공제됩니다" };
  if (/교육비/.test(s)) return self ? { target: "eduSelf" } : { target: null, note: "취학 전·초중고인지 대학생인지 고르세요(인원 칸도 확인)" };
  if (/기부금/.test(s)) return { target: null, note: "기부금 종류(정치자금·특례·일반·종교)를 고르세요" };
  if (/월세/.test(s)) return { target: "monthlyRent" };
  if (/연금저축/.test(s)) return { target: "pensionSaving" };
  if (/퇴직연금/.test(s)) return { target: "irp" };
  if (/주택마련저축|청약/.test(s)) return { target: "housingSaving" };
  if (/장기주택저당/.test(s)) return { target: "mortgageInterest" };
  if (/주택임차차입금/.test(s)) return { target: "rentLoanRepay" };
  return { target: null, note: "오너뷰가 칸을 정하지 못한 항목입니다 — 맞는 칸을 고르세요" };
}

const CARD_COL: Record<string, PdfTarget> = { 일반: "card.debitCash", 전통시장: "card.market", 대중교통: "card.transit", 문화체육: "card.culture", 주택임차료: "card.debitCash" };

/** 페이지 글자 줄(칸은 배열) → 공제 항목. 줄은 위→아래, 칸은 왼→오른쪽 순서 */
export function parseHometaxLines(lines: string[][]): PdfParsed {
  type Block = { section: string; person: string | null; lines: string[][] };
  const blocks: Block[] = [];
  let year: number | null = null;
  let selfName: string | null = null;
  let cur: Block | null = null;
  let pendingTitle = false;
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].map((c) => c.trim()).filter(Boolean);
    if (!cells.length) continue;
    const joined = cells.join(" ");
    if (/귀속\s*소득\s*·?\s*세액공제\s*증명서류/.test(joined)) {
      const y = joined.match(/(\d{4})\s*년\s*귀속/); if (y && !year) year = Number(y[1]);
      cur = { section: "", person: null, lines: [] }; blocks.push(cur);
      const b = joined.match(/\[([^\]]+)\]/);
      if (b) cur.section = b[1].trim(); else pendingTitle = true;
      continue;
    }
    if (!cur) continue;
    if (pendingTitle) {
      const b = joined.match(/\[([^\]]+)\]/);
      if (b) { cur.section = b[1].trim(); pendingTitle = false; continue; }
    }
    if (/^성\s*명$/.test(cells[0]) && !cur.person) {
      const next = (lines[i + 1] || []).map((c) => c.trim()).filter(Boolean);
      if (next[0] && /^[가-힣A-Za-z][가-힣A-Za-z\s]{0,19}$/.test(next[0])) {
        cur.person = next[0];
        if (!selfName && /본인\s*인적사항/.test(cur.lines.map((l) => l.join(" ")).join(" "))) selfName = next[0];
      }
    }
    cur.lines.push(cells);
  }
  if (!selfName) selfName = blocks.find((b) => b.person)?.person || null;

  //   소득기준 초과 부양가족 — '관 계 ¦ 성 명 … ¦ 소득기준 초과' 아래 줄 중 마지막 칸이 Y
  const overIncome = new Set<string>();
  for (const b of blocks.filter((x) => /소득기준초과/.test(norm(x.section))))
    for (const l of b.lines) if (l.length >= 3 && l[l.length - 1] === "Y" && /^[가-힣A-Za-z]/.test(l[1] || "")) overIncome.add(l[1]);

  const items: PdfItem[] = [];
  const info = new Map<string, number>();
  const missed: string[] = [];
  const add = (section: string, person: string, amount: number, target: PdfTarget | null, note?: string) => {
    if (!amount) return;
    const self = person === selfName;
    const over = !self && overIncome.has(person);
    const medical = target != null && target.startsWith("medical");
    items.push({ section, person, self, amount, target, use: !(over && !medical),   // 칸 미정(null)도 켜 둔다 → 고르거나 끌 때까지 '넣기' 막힘(조용히 빠지지 않게)
      note: over && !medical ? "소득기준 초과 부양가족 — 공제 대상이 아닙니다" : note });
  };

  for (const b of blocks) {
    const person = b.person || selfName || "";
    const t = targetOf(b.section, person === selfName);
    if (t === "skip") continue;
    if (t === "info") {
      const tot = b.lines.find((l) => l[0] === "총합계") || b.lines.find((l) => l[0] === "합계");
      const v = num(tot?.[1]); if (v) info.set(b.section, (info.get(b.section) || 0) + v);
      continue;
    }
    if (t === "card") {
      const hi = b.lines.findIndex((l) => l[0] === "일반" && l[l.length - 1] === "합계금액");
      if (hi < 0) continue;                               // 현금영수증 월별 쪽 등 — 집계는 앞 쪽에 있다
      const head = b.lines[hi], vals = b.lines[hi + 1] || [];
      const kind = /신용카드/.test(norm(b.section)) ? "credit" : "debit";
      head.forEach((h, k) => {
        if (h === "합계금액") return;
        const v = num(vals[k]); if (v == null) return;
        const tg = h === "일반" && kind === "credit" ? "card.credit" : CARD_COL[h];
        if (tg) add(b.section, person, v, tg, h === "주택임차료" ? "현금영수증 월세분은 일반 사용분으로 계산합니다(국세청 안내)" : undefined);
      });
      continue;
    }
    //   의료비 — 의료비 + 안경(1인 50만) + 산후조리원(출산 1회 200만)
    if (/의료비/.test(norm(b.section)) && !/실손/.test(norm(b.section))) {
      const g = (label: string) => num(b.lines.find((l) => norm(l[0]) === label)?.[1]) || 0;
      const med = g("의료비인별합계금액"), glasses = g("안경구입비인별합계금액"), care = g("산후조리원인별합계금액");
      const total = med + Math.min(glasses, 500_000) + Math.min(care, 2_000_000);
      const capped = glasses > 500_000 || care > 2_000_000;
      if (total) add(b.section, person, total, person === selfName ? "medicalSelf" : "medicalOthers",
        `${person === selfName ? "" : "65세 이상·장애인·6세 이하 가족이면 '본인·65세 이상…' 칸으로 옮기세요. 난임·미숙아는 해당 칸으로. "}${capped ? "안경 50만·산후조리 200만 한도를 넘는 금액은 뺐습니다." : ""}`.trim() || undefined);
      else if (!b.lines.some((l) => /인별합계금액/.test(norm(l[0])))) missed.push(b.section);
      continue;
    }
    const tot = b.lines.find((l) => norm(l[0]) === "인별합계금액");
    const v = num(tot?.[tot.length - 1]);
    if (v == null) continue;                              // 한 사람이 여러 쪽 — 합계는 마지막 쪽에
    add(b.section, person, v, t.target, t.note);
  }
  //   덩어리는 있는데 금액을 못 찾은 칸 (같은 칸에 아무 사람도 금액이 없을 때)
  for (const b of blocks) {
    const t = targetOf(b.section, false);
    if (t === "skip" || t === "info" || !b.section) continue;
    if (!items.some((x) => x.section === b.section) && !missed.includes(b.section)
      && !blocks.filter((x) => x.section === b.section).some((x) => x.lines.some((l) => /인별합계금액|합계금액/.test(norm(l.join(""))))))
      missed.push(b.section);
  }
  return { year, self: selfName, items, overIncome: [...overIncome], info: [...info].map(([section, amount]) => ({ section, amount })), missed };
}

/** 고른 항목 → 칸별 합계. 넣을 칸이 정해지고 '넣기'가 켜진 것만 */
export function sumPdfItems(items: PdfItem[]): Partial<Record<PdfTarget, number>> {
  const out: Partial<Record<PdfTarget, number>> = {};
  for (const it of items) if (it.use && it.target) out[it.target] = (out[it.target] || 0) + it.amount;
  return out;
}
