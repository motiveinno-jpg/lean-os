"use client";

// 은행·카드사 브랜드 로고 배지 (2026-08-13 사장님: "그랜터처럼 실제 은행 로고를")
//   public/bank-logos/ 에 번들한 기관 심볼(공식 사이트 파비콘/터치아이콘, 식별 목적)을
//   기관명 문자열로 매칭해 보여준다. 로고 파일이 없는 기관은 브랜드 컬러 모노그램 폴백.
//   이름은 CODEF/수기 입력 어느 쪽이든 "국민", "KB국민은행", "국민카드" 류 부분 일치로 잡는다.

/* eslint-disable @next/next/no-img-element */

type Brand = { key: string; file?: string; color: string; short: string; dark?: boolean };

// 카드사 우선 매칭(이름에 '카드'가 있으면 카드 테이블 먼저) — "국민카드"가 kb 은행으로 잡히지 않게.
const CARD_BRANDS: [RegExp, Brand][] = [
  [/국민|KB/i, { key: "kbcard", file: "kbcard", color: "#FFB300", short: "KB", dark: true }],
  [/신한/, { key: "shinhancard", file: "shinhancard", color: "#0046FF", short: "신한" }],
  [/삼성/, { key: "samsungcard", color: "#1428A0", short: "삼성" }],
  [/현대/, { key: "hyundaicard", file: "hyundaicard", color: "#111111", short: "현대" }],
  [/롯데/, { key: "lottecard", file: "lottecard", color: "#DA291C", short: "롯데" }],
  [/우리/, { key: "wooricard", file: "wooricard", color: "#0067AC", short: "우리" }],
  [/하나/, { key: "hanacard", file: "hanacard", color: "#008485", short: "하나" }],
  [/농협|NH/i, { key: "nhcard", file: "nh", color: "#00A94F", short: "NH" }],
  [/비씨|BC/i, { key: "bccard", file: "bccard", color: "#E60012", short: "BC" }],
];

const BANK_BRANDS: [RegExp, Brand][] = [
  [/국민|KB/i, { key: "kb", file: "kb", color: "#FFB300", short: "KB", dark: true }],
  [/신한/, { key: "shinhan", file: "shinhan", color: "#0046FF", short: "신한" }],
  [/우리/, { key: "woori", file: "woori", color: "#0067AC", short: "우리" }],
  [/하나|외환/, { key: "hana", file: "hana", color: "#008485", short: "하나" }],
  [/농협|NH/i, { key: "nh", file: "nh", color: "#00A94F", short: "NH" }],
  [/기업|IBK/i, { key: "ibk", color: "#0072BC", short: "IBK" }],
  [/카카오/, { key: "kakaobank", color: "#FFCC00", short: "카뱅", dark: true }],
  [/토스/, { key: "tossbank", file: "tossbank", color: "#0064FF", short: "토스" }],
  [/케이뱅크|K뱅크/i, { key: "kbank", file: "kbank", color: "#0F1EAA", short: "K" }],
  [/SC|제일/i, { key: "sc", color: "#0F5499", short: "SC" }],
  [/씨티|시티/, { key: "citi", color: "#003B70", short: "씨티" }],
  [/우체국/, { key: "post", file: "post", color: "#E60012", short: "우체국" }],
  [/새마을/, { key: "mg", color: "#009944", short: "MG" }],
  [/수협/, { key: "suhyup", file: "suhyup", color: "#0088CE", short: "수협" }],
  [/부산|BNK부산/, { key: "busan", file: "busan", color: "#C8161D", short: "부산" }],
  [/대구|iM|아이엠/i, { key: "im", file: "im", color: "#00A5E5", short: "iM" }],
  [/광주/, { key: "kwangju", color: "#F26522", short: "광주" }],
  [/전북/, { key: "jeonbuk", file: "jeonbuk", color: "#0072BC", short: "전북" }],
  [/경남|BNK경남/, { key: "kyongnam", color: "#E60012", short: "경남" }],
  [/신협/, { key: "shinhyup", file: "shinhyup", color: "#00A0E9", short: "신협" }],
];

export function matchBankBrand(rawName: string | null | undefined): Brand | null {
  const name = String(rawName || "").trim();
  if (!name) return null;
  const tables = /카드/.test(name) ? [CARD_BRANDS, BANK_BRANDS] : [BANK_BRANDS, CARD_BRANDS];
  for (const table of tables) {
    for (const [re, brand] of table) if (re.test(name)) return brand;
  }
  return null;
}

/** 기관명 → 로고 배지. 로고 파일이 있으면 이미지, 없으면 브랜드 컬러 모노그램. 미매칭이면 회색 이니셜. */
export function BankLogo({ name, size = 28, className = "" }: { name: string | null | undefined; size?: number; className?: string }) {
  const brand = matchBankBrand(name);
  const style: React.CSSProperties = { width: size, height: size };
  if (brand?.file) {
    return (
      <span className={`bank-logo ${className}`} style={style}>
        <img src={`/bank-logos/${brand.file}.png`} alt={String(name || "")} width={size} height={size} loading="lazy" />
      </span>
    );
  }
  const initial = brand?.short || String(name || "?").replace(/은행|카드|뱅크/g, "").trim().slice(0, 2) || "?";
  return (
    <span
      className={`bank-logo bank-logo-mono ${className}`}
      style={{ ...style, background: brand?.color || "var(--bg-surface)", color: brand ? (brand.dark ? "#1c2030" : "#ffffff") : "var(--text-muted)", fontSize: Math.max(9, Math.round(size * 0.34)) }}
      aria-label={String(name || "")}
    >
      {initial}
    </span>
  );
}
