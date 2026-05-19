// 회사 직인 자동 생성기 — Canvas 로 한국식 도장 PNG 생성.
// 기본(corporate)은 실제 한국 법인인감도장 형식:
//  - 인주 빨강 "정사각형" 이중 테두리 (법인인감은 둥근 직인이 아니라 사각 도장)
//  - 세로쓰기 글자를 오른쪽→왼쪽 열로 배치(전통 인장 판독 방향)
//  - 오른쪽 열: 회사명(세로), 왼쪽 열: "代表理事之印" 등 직책+之印
//  - 열 사이 칸 구분선(전각 인장의 새김 칸)
// 기존 variant(double/single/square) 는 그대로 유지 — 기존 데이터/옵션 보존.

export interface SealOptions {
  size?: number; // PX, 정사각형 (default 400)
  color?: string; // hex (default 인주 빨강 #C0392B)
  /**
   * - corporate: 실제 한국 법인인감도장 (정사각 이중테두리 + 세로쓰기 열) — 기본값
   * - double:    이중 원형 + 중앙 회사명
   * - single:    단일 원형 + 중앙 회사명
   * - square:    사각 테두리 + 중앙 회사명
   */
  variant?: "corporate" | "double" | "single" | "square";
  /** 법인인감 하단 원호 문구 (default "대표이사") */
  title?: string;
}

/** "주식회사 OO" / "(주)OO" 등 회사 접두사 제거 */
function cleanCompanyName(name: string): string {
  return name
    .replace(/^주식회사\s*/g, "")
    .replace(/^\(주\)\s*/g, "")
    .replace(/^㈜\s*/g, "")
    .replace(/\s*주식회사$/g, "")
    .replace(/\s*\(주\)$/g, "")
    .replace(/\s*㈜$/g, "")
    .replace(/\s*주식회사\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 한국 도장 폰트 우선순위 — 굵은 명조/고딕 계열
const FONT_STACK = `'Nanum Myeongjo', 'Noto Serif KR', 'Noto Sans KR', 'Pretendard', '바탕', serif`;

/**
 * 회사명으로 원형 직인 PNG Blob 생성.
 * variant 기본값은 법인인감(corporate).
 */
export async function generateCompanySeal(
  companyName: string,
  opts: SealOptions = {},
): Promise<Blob> {
  const size = opts.size ?? 400;
  const color = opts.color ?? "#C0392B"; // 인주 빨강
  const variant = opts.variant ?? "corporate";
  const title = (opts.title ?? "대표이사").trim() || "대표이사";

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const cleaned = cleanCompanyName(companyName) || companyName?.trim() || "회사";

  if (variant === "corporate") {
    drawCorporateSeal(ctx, { size, cx, cy, color, name: cleaned, title });
  } else if (variant === "square") {
    drawSquareSeal(ctx, { size, cx, cy, color, name: cleaned });
  } else {
    drawCircularSeal(ctx, { size, cx, cy, color, name: cleaned, double: variant === "double" });
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Canvas to blob failed"));
        else resolve(blob);
      },
      "image/png",
      0.95,
    );
  });
}

interface DrawCtx {
  size: number;
  cx: number;
  cy: number;
  color: string;
  name: string;
  title?: string;
  double?: boolean;
}

/** 직책 → 법인인감 좌측 열 문구 (전통 한자 표기 우선, 미매핑 직책은 한글+印) */
function sealPhrase(title: string): string {
  const t = (title || "대표이사").replace(/\s+/g, "");
  switch (t) {
    case "대표이사":
    case "代表理事":
      return "代表理事之印";
    case "이사장":
      return "理事長之印";
    case "대표":
      return "代表之印";
    case "사장":
      return "社長之印";
    case "회장":
      return "會長之印";
    default:
      return t + "印";
  }
}

/**
 * 실제 한국 법인인감도장 — 정사각 이중 테두리 + 세로쓰기 열(오른→왼).
 *  · 오른쪽 열: 회사명(길면 2열로 분할), 세로 1자씩
 *  · 가장 왼쪽 열: "代表理事之印" 등 직책+之印
 *  · 열 사이 칸 구분선 — 전각 인장의 새김 칸 느낌
 * 법인등기소 인감(사각 도장)과 동일한 판독 방향/레이아웃.
 */
function drawCorporateSeal(ctx: CanvasRenderingContext2D, d: DrawCtx) {
  const { size, color, name } = d;
  const title = d.title || "대표이사";

  // ── 정사각 이중 테두리 (법인인감은 원형 아닌 사각 도장) ──
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineJoin = "miter";

  const pad = size * 0.055;
  ctx.lineWidth = size * 0.05;
  ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);

  const ip = size * 0.105;
  ctx.lineWidth = size * 0.013;
  ctx.strokeRect(ip, ip, size - ip * 2, size - ip * 2);

  // ── 열 구성 (오른쪽이 첫 열) ──
  const nameChars = Array.from((name || "회사").replace(/\s+/g, ""));
  const phraseChars = Array.from(sealPhrase(title));
  const columns: string[][] = [];
  if (nameChars.length > 5) {
    const mid = Math.ceil(nameChars.length / 2);
    columns.push(nameChars.slice(0, mid)); // 오른쪽 첫 열
    columns.push(nameChars.slice(mid));    // 그 왼쪽 열
  } else {
    columns.push(nameChars);
  }
  columns.push(phraseChars); // 가장 왼쪽: 직책 + 之印

  const innerLeft = ip + size * 0.028;
  const innerRight = size - ip - size * 0.028;
  const innerTop = ip + size * 0.04;
  const innerBottom = size - ip - size * 0.04;
  const usableW = innerRight - innerLeft;
  const usableH = innerBottom - innerTop;
  const colCount = columns.length;
  const colW = usableW / colCount;

  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  columns.forEach((colChars, ci) => {
    // 오른쪽(ci=0)부터 왼쪽으로
    const colCenterX = innerRight - colW * (ci + 0.5);
    const n = Math.max(colChars.length, 1);
    const cellH = usableH / n;
    const fs = Math.min(colW * 0.84, cellH * 0.86);
    ctx.font = `900 ${Math.round(fs)}px ${FONT_STACK}`;
    colChars.forEach((ch, ri) => {
      const y = innerTop + cellH * (ri + 0.5);
      ctx.fillText(ch, colCenterX, y);
    });
  });

  // ── 열 구분 세로선 (인장 새김 칸) ──
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.007;
  for (let i = 1; i < colCount; i++) {
    const lx = innerRight - colW * i;
    ctx.beginPath();
    ctx.moveTo(lx, innerTop);
    ctx.lineTo(lx, innerBottom);
    ctx.stroke();
  }
}

/** 일반 원형 도장 (double/single) — 중앙 회사명 */
function drawCircularSeal(ctx: CanvasRenderingContext2D, d: DrawCtx) {
  const { size, cx, cy, color, name } = d;
  const outerRadius = size * 0.46;
  const innerRadius = size * 0.42;

  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.04;
  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
  ctx.stroke();
  if (d.double) {
    ctx.lineWidth = size * 0.012;
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawCenterName(ctx, size, cx, cy, color, name);
}

/** 사각 테두리 도장 — 중앙 회사명 */
function drawSquareSeal(ctx: CanvasRenderingContext2D, d: DrawCtx) {
  const { size, cx, cy, color, name } = d;
  const pad = size * 0.04;
  const inset = size * 0.04;
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.04;
  ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);
  ctx.lineWidth = size * 0.012;
  ctx.strokeRect(pad + inset, pad + inset, size - (pad + inset) * 2, size - (pad + inset) * 2);
  drawCenterName(ctx, size, cx, cy, color, name);
}

/** 중앙 회사명 + 하단 "印" (double/single/square 공용) */
function drawCenterName(
  ctx: CanvasRenderingContext2D,
  size: number,
  cx: number,
  cy: number,
  color: string,
  name: string,
) {
  const lines = splitForSeal(name);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const baseFontSize = lines.length === 1
    ? size * 0.28
    : lines.length === 2
    ? size * 0.22
    : size * 0.18;
  const maxChars = Math.max(...lines.map((l) => l.length));
  const adjustedFontSize = maxChars > 4 ? baseFontSize * (4 / maxChars) : baseFontSize;

  const lineHeight = adjustedFontSize * 1.15;
  const totalHeight = lineHeight * lines.length;
  const startY = cy - totalHeight / 2 + lineHeight / 2 - size * 0.04;

  ctx.font = `900 ${Math.round(adjustedFontSize)}px ${FONT_STACK}`;
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, startY + i * lineHeight);
  });

  ctx.font = `900 ${Math.round(size * 0.1)}px ${FONT_STACK}`;
  ctx.fillText("印", cx, cy + size * 0.32);
}

/** 회사명을 도장에 맞게 줄바꿈 (2~3자/줄 우선, 긴 단어는 그대로) */
function splitForSeal(name: string): string[] {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [name];
  const totalLen = tokens.reduce((s, t) => s + t.length, 0);
  if (totalLen <= 4) return [tokens.join("")];
  if (totalLen <= 8) {
    if (tokens.length === 1) {
      const t = tokens[0];
      const mid = Math.ceil(t.length / 2);
      return [t.slice(0, mid), t.slice(mid)];
    }
    const mid = Math.ceil(tokens.length / 2);
    return [tokens.slice(0, mid).join(""), tokens.slice(mid).join("")];
  }
  if (tokens.length === 1) {
    const t = tokens[0];
    const third = Math.ceil(t.length / 3);
    return [t.slice(0, third), t.slice(third, third * 2), t.slice(third * 2)];
  }
  const part = Math.ceil(tokens.length / 3);
  return [
    tokens.slice(0, part).join(""),
    tokens.slice(part, part * 2).join(""),
    tokens.slice(part * 2).join(""),
  ];
}

/** 미리보기용 dataURL */
export async function generateCompanySealDataUrl(
  companyName: string,
  opts: SealOptions = {},
): Promise<string> {
  const blob = await generateCompanySeal(companyName, opts);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
