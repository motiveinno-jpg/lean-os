// 회사 저장공간 쿼터 — 조회·표기·업로드 전 사전검사 (2026-09-02 스토리지 팩 후속)
//   쿼터 = included_storage_bytes(기본 500MiB) + (추가좌석 + 스토리지팩) × 10GiB.
//   단일 소스: get_company_storage RPC (company_storage_usage 카운터 + 구독/플랜 파라미터).
//   DB 게이트(storage.objects RESTRICTIVE INSERT)는 '이미 한도 이상'만 막고 파일 크기는 모른다.
//   그래서 업로드 직전에 여기서 "이 파일까지 더하면 넘는지"를 먼저 재고, 넘으면
//   숫자가 들어간 한국어 안내로 끊는다(게이트에 걸리면 RLS 문구만 나와 사용자가 이유를 모른다).

import { supabase } from "@/lib/supabase";

export interface CompanyStorage {
  usedBytes: number;
  quotaBytes: number;
  includedBytes: number;
  perUnitBytes: number;
  extraSeats: number;
  storagePacks: number;
}

const DEFAULT_INCLUDED = 524288000;      // 500 MiB
const DEFAULT_UNIT = 10737418240;        // 10 GiB

/** 바이트 → 사람이 읽는 용량. 정수로 떨어지면 소수점 생략(10.0 GB → 10 GB). */
export function fmtBytes(n: number): string {
  const b = Math.max(0, Number(n) || 0);
  const trim = (v: number, d: number) => {
    const s = v.toFixed(d);
    return s.replace(/\.0+$/, "");
  };
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${trim(b / 1024, 0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${trim(b / 1024 / 1024, b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  if (b < 1024 * 1024 * 1024 * 1024) return `${trim(b / 1024 / 1024 / 1024, 1)} GB`;
  return `${trim(b / 1024 / 1024 / 1024 / 1024, 2)} TB`;
}

/** 회사 사용량/쿼터 조회. 실패하면 null(호출측은 '검사 생략' 으로 처리 — 업로드를 막지 않는다). */
export async function getCompanyStorage(companyId: string | null | undefined): Promise<CompanyStorage | null> {
  if (!companyId) return null;
  try {
    const { data, error } = await (supabase as any).rpc("get_company_storage", { p_company: companyId });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      usedBytes: Number(row.used_bytes) || 0,
      quotaBytes: Number(row.quota_bytes) || DEFAULT_INCLUDED,
      includedBytes: Number(row.included_bytes) || DEFAULT_INCLUDED,
      perUnitBytes: Number(row.per_unit_bytes) || DEFAULT_UNIT,
      extraSeats: Number(row.extra_seats) || 0,
      storagePacks: Number(row.storage_packs) || 0,
    };
  } catch {
    return null;
  }
}

/** 사용자에게 보여줄 한도 초과 안내 — 남은 용량과 해결 경로(정리 또는 저장공간 추가)까지. */
export function storageFullMessage(s: Pick<CompanyStorage, "usedBytes" | "quotaBytes">, fileBytes?: number): string {
  const left = Math.max(0, s.quotaBytes - s.usedBytes);
  const head = fileBytes != null
    ? `저장공간이 부족해 올릴 수 없습니다 (파일 ${fmtBytes(fileBytes)} · 남은 공간 ${fmtBytes(left)}).`
    : `저장공간이 가득 찼습니다 (${fmtBytes(s.usedBytes)} / ${fmtBytes(s.quotaBytes)}).`;
  return `${head} 안 쓰는 파일을 지우거나, 설정 → 요금제에서 저장공간을 늘려 주세요.`;
}

/** 업로드 직전 사전검사 — 이 파일까지 더해 한도를 넘으면 안내 문구로 throw.
 *  조회 실패 시엔 통과시킨다(최종 방어선은 DB 게이트). */
export async function assertStorageQuota(companyId: string | null | undefined, fileBytes: number): Promise<void> {
  const s = await getCompanyStorage(companyId);
  if (!s) return;
  if (s.usedBytes + Math.max(0, fileBytes || 0) > s.quotaBytes) {
    throw new Error(storageFullMessage(s, fileBytes));
  }
}

/** 여러 파일을 한 번에 올릴 때 — 합계로 한 번만 검사. */
export async function assertStorageQuotaMany(companyId: string | null | undefined, files: { size: number }[]): Promise<void> {
  const total = files.reduce((a, f) => a + (Number(f.size) || 0), 0);
  await assertStorageQuota(companyId, total);
}
