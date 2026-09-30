// 파일 종류 아이콘 — 윈도·맥 탐색기처럼 종이(오른쪽 위 접힘) 위에 종류별 색 띠와 확장자.
//   각 회사 로고는 쓰지 않는다(상표) — 모양·색으로 한눈에 가르고 글자는 형식 이름.
//   종류 판정은 이름의 확장자 하나로 한다(MIME 은 브라우저·경로마다 달라 .hwp 가 빈 값으로 오기도 한다).

type Kind = { label: string; color: string };

const KINDS: [string[], Kind][] = [
  [["pdf"], { label: "PDF", color: "#E5484D" }],
  [["hwp"], { label: "HWP", color: "#1E9BD7" }],
  [["hwpx"], { label: "HWPX", color: "#1E9BD7" }],
  [["doc", "docx", "rtf"], { label: "DOC", color: "#2F6BD8" }],
  [["xls", "xlsx", "xlsm"], { label: "XLS", color: "#1F8F4E" }],
  [["csv"], { label: "CSV", color: "#1F8F4E" }],
  [["ppt", "pptx"], { label: "PPT", color: "#E0662F" }],
  [["jpg", "jpeg"], { label: "JPG", color: "#8E4EC6" }],
  [["png"], { label: "PNG", color: "#8E4EC6" }],
  [["gif"], { label: "GIF", color: "#8E4EC6" }],
  [["webp"], { label: "WEBP", color: "#8E4EC6" }],
  [["svg"], { label: "SVG", color: "#8E4EC6" }],
  [["zip", "7z", "rar"], { label: "ZIP", color: "#A0772F" }],
  [["txt", "md"], { label: "TXT", color: "#6B7280" }],
  [["json"], { label: "JSON", color: "#6B7280" }],
];

export function fileKindOf(name: string): Kind {
  const ext = (String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) || "";
  for (const [exts, k] of KINDS) if (exts.includes(ext)) return k;
  return { label: ext ? ext.slice(0, 4).toUpperCase() : "FILE", color: "#8B90A0" };
}

export function FileTypeIcon({ name, size = 28 }: { name: string; size?: number }) {
  const k = fileKindOf(name);
  const w = Math.round(size * 0.8);
  //   글자 수에 맞춰 띠 글자 크기를 줄인다 — 4글자(HWPX·WEBP·JSON)도 띠 안에 들어가게
  const fs = k.label.length >= 4 ? 5.6 : 7.6;
  return (
    <svg className="file-type-icon" width={w} height={size} viewBox="0 0 24 30" aria-label={`${k.label} 파일`} role="img">
      {/* 종이 — 오른쪽 위를 접었다 */}
      {/* 테두리는 글자색을 옅게 — 배경색(border)만 쓰면 흰 표 위에서 종이 윤곽이 안 보였다 */}
      <path d="M4 1.5h11.5L22.5 8.5V27a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 27V3A1.5 1.5 0 0 1 4 1.5Z"
        style={{ fill: "var(--bg-card)", stroke: "var(--text-dim)" }} strokeOpacity="0.55" strokeWidth="1.3" />
      <path d="M15.5 1.5V7a1.5 1.5 0 0 0 1.5 1.5h5.5" style={{ fill: "var(--bg-surface)", stroke: "var(--text-dim)" }} strokeOpacity="0.55" strokeWidth="1.3" strokeLinejoin="round" />
      {/* 종류 띠 + 형식 이름 — 종이 왼쪽 밖으로 살짝 나오게(탐색기 아이콘 모양) */}
      <rect x="0.3" y="14" width="20" height="10.5" rx="2" fill={k.color} />
      <text x="10.3" y="21.9" textAnchor="middle" fontSize={fs} fontWeight="800" fill="#fff"
        style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", letterSpacing: k.label.length >= 4 ? "0" : "0.2px" }}>{k.label}</text>
    </svg>
  );
}
