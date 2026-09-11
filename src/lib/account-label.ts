//   같은 이름의 계정이 여러 번 보이는 이유를 화면이 말해 주게 한다 (2026-09-11 사장님: "같은 게 여러 번 보인다").
//   표준 계정체계는 같은 성격의 비용을 원가 단계마다 따로 둔다 — 도서인쇄비가 제조(526)·도급(626)·
//   분양(726)·판관(826) 네 개다. 중복이 아니라 쓰임이 다른 것인데, 화면이 코드만 보여 주면
//   넷 중 무엇을 골라야 하는지 알 수 없다. 차감계정(대손충당금·감가상각누계액)도 마찬가지로,
//   바로 앞 자산 계정에 붙는 것이라 "무엇의 대손충당금인지"를 말해 줘야 고를 수 있다.
//   ⚠️ 이름이 겹치는 계정에만 꼬리표를 붙인다. 전부에 붙이면 그냥 시끄러워진다.

export type LabelAccount = { code: string | number | null; name: string | null };

/** 코드 구간이 말하는 원가 단계. 표준 계정체계(제조 5·도급 6·분양 7·판관 8)를 따른다. */
export function accountCostGroup(code: string | number | null | undefined): string | null {
  const n = Number(String(code ?? "").replace(/[^0-9]/g, ""));
  if (!n) return null;
  if (n >= 451 && n <= 499) return "매출원가";
  if (n >= 500 && n <= 599) return "제조";
  if (n >= 600 && n <= 699) return "도급";
  if (n >= 700 && n <= 799) return "분양";
  if (n >= 800 && n <= 899) return "판관";
  if (n >= 900) return "영업외";
  return null;
}

//   앞 계정에 붙어 그 값을 깎는 계정들. 이름만으로는 어디에 붙는지 알 수 없다.
const CONTRA_WORDS = ["감가상각누계액", "상각누계액", "대손충당금", "현재가치할인차금", "사채할인발행차금"];
export function isContraAccount(name: string | null | undefined): boolean {
  const n = String(name || "");
  return CONTRA_WORDS.some((w) => n.includes(w));
}

/** 차감계정이 붙어 있는 본 계정 이름 (109 대손충당금 ← 108 외상매출금). 못 찾으면 null. */
export function contraOwnerName(acc: LabelAccount, all: LabelAccount[]): string | null {
  const me = Number(String(acc.code ?? "").replace(/[^0-9]/g, ""));
  if (!me) return null;
  //   바로 앞 코드부터 거슬러 올라가되, 차감계정은 건너뛴다(220·222·224 감가상각누계액이 줄지어 있다)
  const sorted = all
    .map((a) => ({ n: Number(String(a.code ?? "").replace(/[^0-9]/g, "")), name: String(a.name || "") }))
    .filter((a) => a.n > 0 && a.n < me)
    .sort((a, b) => b.n - a.n);
  for (const prev of sorted) {
    if (!isContraAccount(prev.name)) return prev.name;
  }
  return null;
}

/**
 *  이름이 겹치는 계정에만 붙일 꼬리표를 만든다. 키는 계정 코드.
 *  비용·수익은 원가 단계(제조·판관 …), 차감계정은 붙어 있는 본 계정 이름.
 */
export function buildAccountQualifiers(all: LabelAccount[]): Record<string, string> {
  const seen = new Map<string, number>();
  for (const a of all) {
    const n = String(a.name || "").trim();
    if (n) seen.set(n, (seen.get(n) || 0) + 1);
  }
  const out: Record<string, string> = {};
  for (const a of all) {
    const name = String(a.name || "").trim();
    const code = String(a.code ?? "");
    if (!name || !code || (seen.get(name) || 0) < 2) continue;
    const q = isContraAccount(name) ? contraOwnerName(a, all) : accountCostGroup(a.code);
    if (q) out[code] = q;
  }
  return out;
}
