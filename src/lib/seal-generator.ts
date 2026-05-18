// 회사 직인 자동 생성기 — Canvas 로 한국식 원형 도장 PNG 생성.
// 기본은 한국 법인인감(둥근 원형 인감) 스타일:
//  - 인주 빨강 이중 원형 테두리
//  - 회사명을 상단 원호(arc)를 따라 배치
//  - 하단 원호에 직책(대표이사 등) 배치
//  - 중앙에 "之印" / 회사 약칭
// 기존 variant(double/single/square) 도 그대로 유지 — 기존 데이터/옵션 보존.

export interface SealOptions {
  size?: number; // PX, 정사각형 (default 400)
  color?: string; // hex (default 인주 빨강 #C0392B)
  /**
   * - corporate: 한국 법인인감 (원호 회사명 + 하단 직책) — 기본값
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

/**
 * 한국 법인인감 — 원호 회사명(상단) + 하단 직책 원호 + 중앙 "之印".
 * 실제 법인등기 인감과 동일한 레이아웃 톤.
 */
function drawCorporateSeal(ctx: CanvasRenderingContext2D, d: DrawCtx) {
  const { size, cx, cy, color, name } = d;
  const title = d.title || "대표이사";

  const outerRadius = size * 0.47;
  const innerRadius = size * 0.4;

  // 이중 원형 테두리 (바깥 굵게, 안쪽 가늘게 — 전통 인감 형태)
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.035;
  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = size * 0.011;
  ctx.beginPath();
  ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
  ctx.stroke();

  // 텍스트 배치 반경 (이중 원 사이)
  const textRadius = (outerRadius + innerRadius) / 2 + size * 0.005;

  // ── 상단 원호: 회사명 (시계방향, 정상 방향으로 읽힘) ──
  drawArcText(ctx, {
    text: name,
    cx,
    cy,
    radius: textRadius,
    color,
    // 12시 기준 위쪽 호. 글자가 위로 볼록하게 정렬.
    startAngle: -Math.PI / 2,
    fontSize: arcFontSize(size, name.length, 0.135),
    position: "top",
  });

  // ── 하단 원호: 직책 (대표이사 등), 아래쪽에서도 정상 방향으로 읽힘 ──
  drawArcText(ctx, {
    text: title,
    cx,
    cy,
    radius: textRadius,
    color,
    startAngle: Math.PI / 2,
    fontSize: arcFontSize(size, title.length, 0.12),
    position: "bottom",
  });

  // ── 좌우 구분 점 (전통 인감 장식) ──
  ctx.fillStyle = color;
  for (const a of [0, Math.PI]) {
    const dx = cx + Math.cos(a) * textRadius;
    const dy = cy + Math.sin(a) * textRadius;
    ctx.beginPath();
    ctx.arc(dx, dy, size * 0.011, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── 중앙: "之印" (2자 세로/가로) 또는 회사 약칭 ──
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const center = "之印";
  const centerFont = Math.round(size * 0.26);
  ctx.font = `900 ${centerFont}px ${FONT_STACK}`;
  // 두 글자를 위/아래로 배치 (전통 인감 중앙 표기)
  ctx.fillText(center.charAt(0), cx, cy - size * 0.135);
  ctx.fillText(center.charAt(1), cx, cy + size * 0.135);
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

/** 원호 글자 폰트 크기 — 글자 수가 많을수록 작게 */
function arcFontSize(size: number, charCount: number, base: number): number {
  const maxChars = 7; // 원호에 편하게 들어가는 글자 수
  const scale = charCount > maxChars ? maxChars / charCount : 1;
  return Math.round(size * base * scale);
}

/**
 * 원호를 따라 텍스트 배치.
 * - position "top":    글자가 위로 볼록, 좌→우 정상 방향. (회전 보정)
 * - position "bottom": 글자가 아래로, 좌→우 정상 방향.
 */
function drawArcText(
  ctx: CanvasRenderingContext2D,
  o: {
    text: string;
    cx: number;
    cy: number;
    radius: number;
    color: string;
    startAngle: number; // 호 중심 각도 (rad). top=-PI/2, bottom=PI/2
    fontSize: number;
    position: "top" | "bottom";
  },
) {
  const chars = Array.from(o.text);
  if (chars.length === 0) return;

  ctx.save();
  ctx.fillStyle = o.color;
  ctx.font = `900 ${o.fontSize}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // 글자 1개당 각도 간격 (글자 폭 기준, 너무 빽빽하지 않게)
  const anglePerChar = (o.fontSize * 1.05) / o.radius;
  const totalAngle = anglePerChar * (chars.length - 1);

  chars.forEach((ch, i) => {
    let angle: number;
    if (o.position === "top") {
      // 좌→우로 읽히려면 왼쪽(작은 각)부터: startAngle - half + i*step
      angle = o.startAngle - totalAngle / 2 + i * anglePerChar;
    } else {
      // 하단 호: 좌→우 정상 방향이 되려면 각도를 반대로 진행
      angle = o.startAngle + totalAngle / 2 - i * anglePerChar;
    }

    const x = o.cx + Math.cos(angle) * o.radius;
    const y = o.cy + Math.sin(angle) * o.radius;

    ctx.save();
    ctx.translate(x, y);
    // 글자를 반경 방향(중심에서 바깥)으로 세움
    if (o.position === "top") {
      ctx.rotate(angle + Math.PI / 2);
    } else {
      ctx.rotate(angle - Math.PI / 2);
    }
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });

  ctx.restore();
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
