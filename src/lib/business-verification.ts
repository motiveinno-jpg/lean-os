import { supabase } from './supabase';

export async function verifyBusinessNumber(bizNo: string): Promise<{
  valid: boolean;
  status: '계속사업자' | '휴업자' | '폐업자' | '확인불가';
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

    return {
      valid: true,
      status: statusMap[result.b_stt_cd] || '확인불가',
      taxType: result.tax_type,
      raw: result,
    };
  } catch {
    return { valid: true, status: '확인불가' };
  }
}
