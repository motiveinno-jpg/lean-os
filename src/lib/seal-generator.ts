// 회사 직인 자동 생성기 — Canvas 로 한국식 원형 도장 PNG 생성.
// 다른 SaaS(모두사인 등)의 도장 자동생성과 유사한 스타일.

export interface SealOptions {
  size?: number; // PX, 정사각형 (default 400)
  color?: string; // hex (default 인주 빨강 #C0392B)
  variant?: "double" | "single" | "square"; // 테두리 스타일
}

/** "주식회사 OO" / "(주)OO" 등 회사 접두사 제거 */
function cleanCompanyName(name: string): string {
  return name
    .replace(/^주식회사\s*/g, "")
    .replace(/^\(주\)\s*/g, "")
    .replace(/\s*주식회사$/g, "")
    .replace(/\s*\(주\)$/g, "")
    .replace(/\s*주식회사\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 회사명으로 원형 직인 PNG Blob 생성.
 * - 외곽 이중 원 (variant=double) 또는 단일 (single)
 * - 가운데 회사명 (긴 이름은 자동 줄바꿈)
 * - 아래 "之印" 또는 "印"
 */
export async function generateCompanySeal(
  companyName: string,
  opts: SealOptions = {},
): Promise<Blob> {
  const size = opts.size ?? 400;
  const color = opts.color ?? "#C0392B"; // 인주 빨강
  const variant = opts.variant ?? "double";

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // 배경 투명
  ctx.clearRect(0, 0, size, size);

  // 좌표 / 색상
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size * 0.46;
  const innerRadius = size * 0.42;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 외곽 테두리
  if (variant === "square") {
    const pad = size * 0.04;
    const inset = size * 0.04;
    ctx.lineWidth = size * 0.04;
    ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);
    ctx.lineWidth = size * 0.012;
    ctx.strokeRect(pad + inset, pad + inset, size - (pad + inset) * 2, size - (pad + inset) * 2);
  } else {
    ctx.lineWidth = size * 0.04;
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
    ctx.stroke();
    if (variant === "double") {
      ctx.lineWidth = size * 0.012;
      ctx.beginPath();
      ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 회사명 텍스트
  const cleaned = cleanCompanyName(companyName) || companyName || "회사";
  // 9자 초과면 2~3줄 분할
  const lines = splitForSeal(cleaned);

  // 한국 도장 폰트 우선순위 — 굵은 고딕 계열
  const fontStack = `'Noto Sans KR', 'Pretendard', 'Nanum Myeongjo', '바탕', serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // 줄 수에 따라 폰트 크기 조절
  const baseFontSize = lines.length === 1
    ? size * 0.28
    : lines.length === 2
    ? size * 0.22
    : size * 0.18;
  // 너무 긴 줄은 더 줄임
  const maxChars = Math.max(...lines.map((l) => l.length));
  const adjustedFontSize = maxChars > 4 ? baseFontSize * (4 / maxChars) : baseFontSize;

  const lineHeight = adjustedFontSize * 1.15;
  const totalHeight = lineHeight * lines.length;
  const startY = cy - totalHeight / 2 + lineHeight / 2 - size * 0.04;

  ctx.font = `900 ${Math.round(adjustedFontSize)}px ${fontStack}`;
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, startY + i * lineHeight);
  });

  // "印" — 우측 하단 작은 도장 마크 (전통적)
  ctx.font = `900 ${Math.round(size * 0.1)}px ${fontStack}`;
  ctx.fillText("印", cx, cy + size * 0.32);

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

/** 회사명을 도장에 맞게 줄바꿈 (2~3자/줄 우선, 긴 단어는 그대로) */
function splitForSeal(name: string): string[] {
  // 공백 기준 분리
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [name];
  // 토큰 길이 합이 4 이하면 한 줄
  const totalLen = tokens.reduce((s, t) => s + t.length, 0);
  if (totalLen <= 4) return [tokens.join("")];
  if (totalLen <= 8) {
    // 2줄로 분할
    if (tokens.length === 1) {
      const t = tokens[0];
      const mid = Math.ceil(t.length / 2);
      return [t.slice(0, mid), t.slice(mid)];
    }
    // 2개 이상 토큰 — 절반씩
    const mid = Math.ceil(tokens.length / 2);
    return [tokens.slice(0, mid).join(""), tokens.slice(mid).join("")];
  }
  // 3줄로 분할
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
