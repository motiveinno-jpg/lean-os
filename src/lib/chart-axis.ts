// 차트 축 — 눈금 값·축 글자·곡선 보간을 한 곳에서 정한다.
//   화면마다 축 글자를 따로 만들다 보니 같은 돈이 50,000,000 / 2.5억 / 2520만 으로 제각각 찍혔고,
//   눈금은 (최대−최소)/6 같은 날값이라 2520만·7560만처럼 읽기 힘든 숫자가 나왔다.
//   축은 이 모듈의 fmtAxisKrw · niceTicks 만 쓰고, 선 곡선은 monotonePath 로 그린다.

/** 축 글자 — 1억 이상은 '억', 1만 이상은 '만', 그 아래는 그대로. 0 은 단위 없이 "0". */
export function fmtAxisKrw(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  const sg = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e8) return `${sg}${trim(a / 1e8, 2)}억`;
  if (a >= 1e4) return `${sg}${trim(a / 1e4, a >= 1e6 ? 0 : 1).toLocaleString("ko-KR")}만`;
  return `${sg}${Math.round(a).toLocaleString("ko-KR")}`;
}

/** 소수 자릿수를 d 까지만, 뒤의 0 은 떼고 숫자로 */
function trim(n: number, d: number): number {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

/** 보기 좋은 간격 — 1·2·2.5·5 × 10ⁿ 중 raw 이상에서 가장 작은 것 */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / e;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * e;
}

/**
 * 눈금 — min~max 를 덮는 보기 좋은 값들(0 을 늘 포함).
 *   count 는 대략의 칸 수. 돌려주는 lo/hi 로 축 범위를 잡으면 눈금이 축 끝에 딱 맞는다.
 */
export function niceTicks(min: number, max: number, count = 4): { lo: number; hi: number; step: number; ticks: number[] } {
  let a = Math.min(min, max, 0), b = Math.max(min, max, 0);
  if (a === b) b = a + 1;
  const step = niceStep((b - a) / Math.max(1, count));
  const lo = Math.floor(a / step) * step;
  const hi = Math.ceil(b / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toPrecision(12)));
  return { lo, hi, step, ticks };
}

/**
 * 단조 3차 보간 경로(Fritsch–Carlson) — 점과 점 사이에서 곡선이 두 점 값 밖으로 넘치지 않는다.
 *   Catmull-Rom 같은 일반 스무딩은 급하게 오르내리는 자리에서 곡선이 0 아래로 출렁여
 *   '없던 적자'를 그려 냈다. 이 보간은 이웃 두 점 사이 값만 지난다. x 는 커지는 순서여야 한다.
 */
export function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  if (n === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;
  const dx: number[] = [], sl: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    sl.push(dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const t: number[] = new Array(n).fill(0);
  t[0] = sl[0];
  t[n - 1] = sl[n - 2];
  for (let i = 1; i < n - 1; i++) {
    //   기울기 부호가 바뀌는 자리(봉우리·골짜기)는 수평 — 넘침이 생기는 바로 그 자리다
    if (sl[i - 1] * sl[i] <= 0) { t[i] = 0; continue; }
    const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
    t[i] = (w1 + w2) / (w1 / sl[i - 1] + w2 / sl[i]);
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i].x + h},${pts[i].y + t[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - t[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

/**
 * 말풍선 가로 자리 — 점이 그림 왼쪽·오른쪽 끝에 가까우면 말풍선을 안쪽으로 붙인다.
 *   가운데 정렬 그대로 두면 끝 점의 말풍선이 그림 상자 밖으로 나가 잘린다.
 *   pct = 점의 가로 위치(0~100).
 */
export function tipEdge(pct: number): "" | "viz-tip-at-l" | "viz-tip-at-r" {
  return pct <= 15 ? "viz-tip-at-l" : pct >= 85 ? "viz-tip-at-r" : "";
}
