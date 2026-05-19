// 회사 직인 자동 생성기 — Canvas 로 한국식 도장 PNG 생성.
// 기본(corporate)은 실제 한국 법인 대표이사 인감도장 형식 (직원 예시 이미지
// 직인예시-2-카드재첨부.png 기준):
//  - 인주 빨강 "이중 원형" 테두리 (원형 — 사각 아님)
//  - 회사명(주식회사 포함 전체)을 바깥 링을 따라 원호(arc)로 빙 둘러 배열
//  - 중앙 소원(小圓) 안에 직책 한자 「代表理事」 2x2 세로쓰기(우→좌)
// 기존 variant(double/single/square) 는 그대로 유지 — 기존 데이터/옵션 보존.

export interface SealOptions {
  size?: number; // PX, 정사각형 (default 400)
  color?: string; // hex (default 인주 빨강 #C0392B)
  /**
   * - corporate: 한국 법인 대표이사 인감 (이중 원형 + 회사명 원호 + 중앙 代表理事) — 기본값
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
    // corporate 는 링에 회사명 전체(주식회사 포함)를 두름 — prefix 제거 안 함.
    const fullName = (companyName || "").trim().replace(/\s+/g, "") || cleaned;
    drawCorporateSeal(ctx, { size, cx, cy, color, name: fullName, title });
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

/** 직책 → 중앙 한자 (代表理事 등). 미매핑 직책은 한글 원문 그대로 세로. */
function titleHanja(title: string): string {
  const t = (title || "대표이사").replace(/\s+/g, "");
  switch (t) {
    case "대표이사":
    case "代表理事":
      return "代表理事";
    case "이사장":
      return "理事長";
    case "대표":
      return "代表";
    case "사장":
      return "社長";
    case "회장":
      return "會長";
    default:
      return t;
  }
}

/**
 * 한국 법인 대표이사 인감 (직원 예시 직인예시-2-카드재첨부.png 기준):
 *  ① 이중 원형 테두리(원형 — 사각 아님)
 *  ② 회사명(주식회사 포함 전체)을 바깥 링 따라 원호로 빙 둘러 배열
 *  ③ 중앙 소원 안 직책 한자 「代表理事」 2x2 세로쓰기(우→좌)
 */
function drawCorporateSeal(ctx: CanvasRenderingContext2D, d: DrawCtx) {
  const { size, cx, cy, color } = d;
  const name = (d.name || "회사").replace(/\s+/g, "");
  const center = titleHanja(d.title || "대표이사");

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // ── ① 이중 원형 테두리 ──
  const outerR = size * 0.47;
  const innerR = size * 0.40;
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = size * 0.011;
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.stroke();

  // ── ② 회사명 — 바깥 링 따라 원호 배열 (12시에서 시계방향, 글자머리 바깥) ──
  const chars = Array.from(name);
  if (chars.length > 0) {
    const textR = (outerR + innerR) / 2;
    // 글자가 링을 꽉 채우되 과밀하지 않게: 최대 가독 글자수 기준 폰트 산정.
    const anglePer = (Math.PI * 2) / Math.max(chars.length, 8);
    const fontSize = Math.min(size * 0.13, textR * anglePer * 1.5);
    ctx.font = `900 ${Math.round(fontSize)}px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    chars.forEach((ch, i) => {
      // 12시(-π/2) 시작, 시계방향. 글자머리가 바깥(반경 방향)을 향하게 회전.
      const ang = -Math.PI / 2 + i * anglePer;
      const x = cx + Math.cos(ang) * textR;
      const y = cy + Math.sin(ang) * textR;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
  }

  // ── ③ 중앙 소원 + 직책 한자 세로쓰기(우→좌) ──
  const centerR = size * 0.165;
  ctx.lineWidth = size * 0.011;
  ctx.beginPath();
  ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
  ctx.stroke();

  const cc = Array.from(center);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (cc.length === 4) {
    // 2x2 — 우열(代,表) 상→하, 좌열(理,事) 상→하  ⇒ 代表理事 (우→좌 판독)
    const fs = Math.round(centerR * 0.62);
    ctx.font = `900 ${fs}px ${FONT_STACK}`;
    const dx = centerR * 0.42, dy = centerR * 0.42;
    ctx.fillText(cc[0], cx + dx, cy - dy);
    ctx.fillText(cc[1], cx + dx, cy + dy);
    ctx.fillText(cc[2], cx - dx, cy - dy);
    ctx.fillText(cc[3], cx - dx, cy + dy);
  } else {
    // 그 외: 단일 세로열 중앙 정렬
    const fs = Math.round(Math.min(centerR * 0.7, (centerR * 1.7) / Math.max(cc.length, 1)));
    ctx.font = `900 ${fs}px ${FONT_STACK}`;
    const lh = fs * 1.05;
    const startY = cy - (lh * (cc.length - 1)) / 2;
    cc.forEach((ch, i) => ctx.fillText(ch, cx, startY + i * lh));
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
