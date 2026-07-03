import { supabase } from './supabase';

export async function verifyBusinessNumber(bizNo: string): Promise<{
  valid: boolean;
  // 미등록: 국세청 API가 정상 응답했지만 등록되지 않은 번호 (확인불가=API 장애와 구분 — 가입 차단 판정용)
  status: '계속사업자' | '휴업자' | '폐업자' | '미등록' | '확인불가';
  taxType?: string;
  raw?: any;
}> {
  // Validate format
  const cleaned = bizNo.replace(/[^0-9]/g, '');
  if (cleaned.length !== 10) return { valid: false, status: '확인불가' };

  // Checksum validation
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned[i]) * weights[i];
  }
  sum += Math.floor((parseInt(cleaned[8]) * 5) / 10);
  const checkDigit = (10 - (sum % 10)) % 10;
  if (checkDigit !== parseInt(cleaned[9])) {
    return { valid: false, status: '확인불가' };
  }

  try {
    const { data, error } = await (supabase as any).functions.invoke('verify-business-number', {
      body: { businessNumbers: [cleaned] },
    });
    if (error) throw error;

    const result = data?.results?.[0];
    if (!result) return { valid: true, status: '확인불가' };

    const statusMap: Record<string, '계속사업자' | '휴업자' | '폐업자'> = {
      '01': '계속사업자',
      '02': '휴업자',
      '03': '폐업자',
    };

    // b_stt_cd 가 없으면 = API 는 정상 응답했으나 국세청에 없는 번호 (tax_type: "국세청에 등록되지 않은…")
    return {
      valid: true,
      status: statusMap[result.b_stt_cd] || '미등록',
      taxType: result.tax_type,
      raw: result,
    };
  } catch {
    return { valid: true, status: '확인불가' };
  }
}
