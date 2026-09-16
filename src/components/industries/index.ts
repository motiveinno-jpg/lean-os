// 업종 23곳 모음 (2026-09-16 2차) — 업종군 7 × 세부 업종
import { MANUFACTURING } from "./subs-manufacturing";
import { TRADE } from "./subs-trade";
import { SERVICE } from "./subs-service";
import { BUILD } from "./subs-build";
import { PRO } from "./subs-pro";
import { PARENTS } from "./parents";
import type { Industry } from "./model";

export const INDUSTRIES: Industry[] = [...MANUFACTURING, ...TRADE, ...SERVICE, ...BUILD, ...PRO];
export const BY_SLUG = new Map(INDUSTRIES.map((i) => [i.slug, i]));
export const BY_PARENT = new Map(PARENTS.map((p) => [p.key, INDUSTRIES.filter((i) => i.parent === p.key)]));
export { PARENTS, PARENT_BY_KEY } from "./parents";
export type { Industry, Section, Ui, Hero } from "./model";
