// ══════════════════════════════════════════════════════════════
//  업종 페이지 자료 구조 (2026-09-16 2차 — 대표: 업종마다 히어로도 본문도 다르게, 세부 업종은 각각 페이지로)
//   ▸ 1차(9/16 오전)에는 7개 업종이 같은 틀·같은 카드 3장이라 페이지가 바뀐 느낌이 없었다.
//   ▸ 이제 업종군(7)마다 히어로 그림과 본문 구성(섹션 종류·차례)이 다르고,
//     세부 업종(23)은 그 틀 위에 제목·숫자·예시를 자기 것으로 갈아 끼운다.
//   ▸ 화면 속 회사명·거래처·금액은 전부 가상 예시(결정 220). 기능은 앱에 실제로 있는 것만 적는다.
// ══════════════════════════════════════════════════════════════

export type Tone = "ok" | "bad" | "warn" | "ind" | "gray";

/* 화면 흉내 한 장 */
export type UiRow = { t: string; s?: string; r?: string; tone?: Tone; badge?: boolean };
export type Ui = {
  title: string;
  badge?: { t: string; tone?: Tone };
  rows: UiRow[];
  kv?: [string, string][];
  bars?: number[];
  foot?: string;
};

/* ── 히어로 일곱 가지 ──────────────────────────────────────
   pipeline 흐름 파이프라인(제조)  inbox 채널 인박스(온라인 판매)  board 보드+간트(용역)
   site 현장 공정·기성(건설)       grid 창고 격자(도소매)          log 시간대 처리(물류)
   month 월 달력(전문 서비스)                                                        */
export type Hero =
  | { kind: "pipeline"; nodes: [string, string, string][]; hot?: number }   // [제목, 설명, 값]
  | { kind: "inbox"; tiles: [string, string][]; orders: [string, string, Tone][]; foot: [string, string][]; gauges: [string, string, number][] }
  | { kind: "board"; cols: [string, string, [string, string][]][]; gantt: [string, number, number][] }  // 칸반 + 간트[이름, 시작%, 폭%]
  | { kind: "site"; name: string; progress: string; rows: [string, number, number, number | null][]; money: [string, string][] }
  | { kind: "grid"; cells: [string, string, Tone][]; note: [string, string][] }
  | { kind: "log"; head: [string, string]; rows: [string, string, string, Tone][]; kv: [string, string][] }
  | { kind: "month"; marks: [number, string, Tone][]; side: [string, string][] };

/* ── 본문 섹션 — 업종군마다 골라 쓴다 ─────────────────────── */
export type Section =
  | { kind: "flow"; eyebrow?: string; title: string; lead?: string; steps: [string, string, string][] }
  | { kind: "cases"; eyebrow?: string; title: string; lead?: string; items: { no: string; title: string; steps: string[]; chips: string[]; ui: Ui }[] }
  | { kind: "clock"; eyebrow?: string; title: string; lead?: string; slots: [string, string, string, [string, string][]][] }
  | { kind: "calc"; eyebrow?: string; title: string; lead?: string; rows: [string, number, string, string][]; sum: [string, number, string]; compare: [string, string, string, Tone][]; note?: string }
  | { kind: "checks"; eyebrow?: string; title: string; lead?: string; items: [string, string][] }
  | { kind: "signal"; eyebrow?: string; title: string; lead?: string; groups: { tone: Tone; title: string; count: string; items: [string, string][] }[] }
  | { kind: "table"; eyebrow?: string; title: string; lead?: string; cols: string[]; rows: string[][]; foot?: string }
  | { kind: "sites"; eyebrow?: string; title: string; lead?: string; items: { name: string; sub: string; pct: number; tone: Tone; rows: [string, string][] }[] }
  | { kind: "journey"; eyebrow?: string; title: string; lead?: string; steps: { title: string; desc: string; out: [string, string, Tone?][] }[] }
  | { kind: "logs"; eyebrow?: string; title: string; lead?: string; rows: [string, string, string, Tone][]; foot?: string }
  | { kind: "month"; eyebrow?: string; title: string; lead?: string; marks: [number, string, Tone][]; notes: [string, string][] }
  | { kind: "probs"; eyebrow?: string; title: string; items: [string, string, string][] }
  | { kind: "start"; title?: string; cols: [string, string, string[]][] }
  | { kind: "menus"; title?: string; lead?: string; main: [string, string][]; next: [string, string][] };

export type Industry = {
  slug: string;
  parent: string;            // 업종군 키
  name: string;              // 짧은 이름(메뉴·칩에 쓴다)
  label: string;             // 히어로 눈썹
  title: [string, string];
  lead: string;
  kpis: [string, string][];  // [값, 이름]
  shot: string;              // 히어로 배경 — 실제 화면(public/product)
  hero: Hero;
  sections: Section[];       // 본문 — 업종군 틀 + 업종별 내용
  finTitle: string;
  finLead: string;
  seo: string;
};

export type Parent = {
  key: string;
  name: string;              // 업종군 이름
  lead: string;              // 업종군 목록에서 쓰는 한 줄
  accent: "indigo" | "blue" | "violet" | "amber" | "teal" | "slate" | "rose";
  shot: string;
};
