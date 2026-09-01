// 프로젝트 v3 — 수식 컬럼 계산기 (2026-09-01 사장님 "다른 열의 금액·숫자를 지정해 수식으로 값 도출")
//
//   문법: 열 이름 그대로 + 숫자 + ＋ − × ÷ + - * / ( ). eval 금지 — 직접 토큰화·재귀하강.
//   정직함 규칙: 참조한 칸이 비어 있으면 결과는 null("—", 0으로 지어내지 않음),
//   참조한 열이 없으면 error 로 이름을 말한다. 값은 저장하지 않고 볼 때마다 계산한다.

export type FormulaResult = { value: number | null; error?: string };

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(expr: string): Tok[] | { error: string } {
  const s = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/[−–—]/g, "-").replace(/＋/g, "+")
    .replace(/（/g, "(").replace(/）/g, ")");
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if ("+-*/()".includes(ch)) { toks.push({ t: "op", v: ch }); i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i; while (j < s.length && /[0-9.,]/.test(s[j])) j++;
      const n = Number(s.slice(i, j).replace(/,/g, ""));
      if (!Number.isFinite(n)) return { error: `숫자를 읽을 수 없어요: '${s.slice(i, j)}'` };
      toks.push({ t: "num", v: n }); i = j; continue;
    }
    //   열 이름 — 연산자·괄호·공백 전까지 한 덩어리(한글·영문·숫자 섞임 허용)
    let j = i; while (j < s.length && !/[\s+\-*/()]/.test(s[j])) j++;
    toks.push({ t: "id", v: s.slice(i, j) }); i = j;
  }
  return toks;
}

/** resolve: 열 이름 → 그 줄의 숫자 값. undefined = 그런 열 없음, null = 열은 있는데 칸이 비어 있음 */
export function evalFormula(expr: string, resolve: (name: string) => number | null | undefined): FormulaResult {
  if (!expr.trim()) return { value: null, error: "수식이 비어 있어요" };
  const toks = tokenize(expr);
  if ("error" in toks) return { value: null, error: toks.error };
  let pos = 0;
  let empty = false;
  const peek = () => toks[pos];
  const take = () => toks[pos++];
  function primary(): number | { error: string } {
    const tk = take();
    if (!tk) return { error: "수식이 끝나지 않았어요 — 뒤가 비었습니다" };
    if (tk.t === "num") return tk.v;
    if (tk.t === "id") {
      const v = resolve(tk.v);
      if (v === undefined) return { error: `'${tk.v}' 열을 찾을 수 없어요 — 이름이 바뀌었거나 지워졌습니다` };
      if (v === null) { empty = true; return 0; }
      return v;
    }
    if (tk.v === "(") {
      const v = addSub();
      if (typeof v !== "number") return v;
      const close = take();
      if (!close || close.t !== "op" || close.v !== ")") return { error: "닫는 괄호 ) 가 빠졌어요" };
      return v;
    }
    if (tk.v === "-") { const v = primary(); return typeof v === "number" ? -v : v; }
    return { error: `여기엔 값이 와야 해요: '${tk.v}'` };
  }
  function mulDiv(): number | { error: string } {
    let left = primary();
    if (typeof left !== "number") return left;
    while (peek()?.t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = take().v;
      const right = primary();
      if (typeof right !== "number") return right;
      if (op === "/") {
        if (right === 0) { empty = true; left = 0; }
        else left = left / right;
      } else left = left * right;
    }
    return left;
  }
  function addSub(): number | { error: string } {
    let left = mulDiv();
    if (typeof left !== "number") return left;
    while (peek()?.t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = take().v;
      const right = mulDiv();
      if (typeof right !== "number") return right;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  const out = addSub();
  if (typeof out !== "number") return { value: null, error: out.error };
  if (pos < toks.length) return { value: null, error: `수식 뒤에 이해 못 한 부분이 있어요: '${toks[pos].t === "op" ? (toks[pos] as { v: string }).v : (toks[pos] as { v: unknown }).v}'` };
  if (empty) return { value: null }; // 빈 칸 참조 또는 0 나누기 — "—"
  return { value: Math.round(out * 100) / 100 };
}
