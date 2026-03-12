/**
 * OwnerView 카드 매입세액 공제 자동분류 (Card VAT Input Credit Auto-Classification)
 * 한국 부가가치세법 기반 법인카드 매입세액 공제/불공제 자동 분류 엔진
 */

import { supabase } from './supabase';

const db = supabase as any;

// ── 공제 가능 업종/카테고리 (VAT Deductible Categories) ──

export const DEDUCTIBLE_CATEGORIES = [
  { code: 'office_supplies', label: '사무용품', keywords: ['사무', '문구', '복사', '프린터', '토너', '잉크', '오피스'] },
  { code: 'raw_materials', label: '원재료/부자재', keywords: ['원재료', '부자재', '자재', '소재', '부품'] },
  { code: 'telecom', label: '통신비', keywords: ['통신', 'KT', 'SKT', 'LG유플러스', 'SK텔레콤', '인터넷', '전화'] },
  { code: 'utilities', label: '공과금', keywords: ['전기', '수도', '가스', '관리비', '공과금', '한전', '한국전력'] },
  { code: 'rent', label: '임차료', keywords: ['임대', '임차', '월세', '사무실', '오피스텔'] },
  { code: 'transport_business', label: '업무용 교통비', keywords: ['택시', '버스', '지하철', 'KTX', 'SRT', '톨게이트', '하이패스', '주차'] },
  { code: 'logistics', label: '물류/운반비', keywords: ['택배', '배송', 'CJ대한통운', '로젠', '한진', '우체국', '운반'] },
  { code: 'advertising', label: '광고선전비', keywords: ['광고', '마케팅', '네이버광고', '구글광고', '카카오광고', 'SNS광고', '인쇄', '현수막'] },
  { code: 'insurance_business', label: '업무용 보험료', keywords: ['화재보험', '배상책임', '산재보험', '고용보험'] },
  { code: 'repair', label: '수선유지비', keywords: ['수리', '정비', '유지보수', '수선', 'AS', 'A/S'] },
  { code: 'software', label: '소프트웨어/IT', keywords: ['소프트웨어', 'SW', '라이선스', 'AWS', 'Azure', '클라우드', '서버', '호스팅', 'SaaS', '구독'] },
  { code: 'consulting', label: '전문용역비', keywords: ['컨설팅', '자문', '용역', '회계', '세무', '법무', '법률', '특허'] },
  { code: 'education', label: '교육훈련비', keywords: ['교육', '훈련', '세미나', '연수', '워크숍'] },
  { code: 'fuel_business', label: '업무용 차량유류비', keywords: ['주유', 'GS칼텍스', 'SK에너지', 'S-OIL', '현대오일뱅크', 'LPG'] },
  { code: 'general_expense', label: '일반 사업경비', keywords: [] },
] as const;

// ── 불공제 업종/카테고리 (VAT Non-Deductible Categories) ──

export const NON_DEDUCTIBLE_CATEGORIES = [
  { code: 'entertainment', label: '접대비', keywords: ['접대', '골프', '골프장', '룸살롱', '유흥', '나이트', '노래방', '가라오케', '바(Bar)', '클럽'] },
  { code: 'personal_expense', label: '개인 사적경비', keywords: ['개인', '사적', '가족'] },
  { code: 'non_business_vehicle', label: '비영업용 차량유지비', keywords: ['자동차보험', '차량보험', '자동차세'] },
  { code: 'employee_welfare_exempt', label: '면세 복리후생', keywords: [] },
  { code: 'tax_exempt_purchase', label: '면세 매입', keywords: ['면세', '농산물', '수산물', '축산물', '병원', '의료', '약국', '의원'] },
  { code: 'overseas_purchase', label: '해외 매입', keywords: ['해외', 'FOREIGN', 'USD', 'PAYPAL'] },
  { code: 'donation', label: '기부금', keywords: ['기부', '성금', '후원', '자선'] },
  { code: 'fine_penalty', label: '벌금/과태료', keywords: ['벌금', '과태료', '범칙금', '과징금', '가산금'] },
  { code: 'luxury_goods', label: '사치성 재화', keywords: ['보석', '귀금속', '모피', '고급시계', '명품'] },
] as const;

export type DeductibleCategoryCode = typeof DEDUCTIBLE_CATEGORIES[number]['code'];
export type NonDeductibleCategoryCode = typeof NON_DEDUCTIBLE_CATEGORIES[number]['code'];
export type VATCategoryCode = DeductibleCategoryCode | NonDeductibleCategoryCode;

// ── 업종별 가맹점 패턴 (Merchant Classification Patterns) ──

const MERCHANT_PATTERNS: Array<{
  pattern: RegExp;
  category: VATCategoryCode;
  deductible: boolean;
}> = [
  // Non-deductible patterns (check first - higher priority)
  { pattern: /골프|CC|컨트리클럽/i, category: 'entertainment', deductible: false },
  { pattern: /룸살롱|유흥|나이트|노래방|가라오케/i, category: 'entertainment', deductible: false },
  { pattern: /면세점|DUTY\s*FREE/i, category: 'tax_exempt_purchase', deductible: false },
  { pattern: /병원|의원|의료|약국|한의원|치과|안과|피부과/i, category: 'tax_exempt_purchase', deductible: false },
  { pattern: /벌금|과태료|범칙금/i, category: 'fine_penalty', deductible: false },
  { pattern: /기부|성금|후원금|자선/i, category: 'donation', deductible: false },

  // Deductible patterns
  { pattern: /GS칼텍스|SK에너지|S-?OIL|현대오일뱅크|주유소|LPG/i, category: 'fuel_business', deductible: true },
  { pattern: /CJ대한통운|로젠택배|한진택배|우체국택배|편의점택배/i, category: 'logistics', deductible: true },
  { pattern: /KT|SKT|SK텔레콤|LG유플러스|LGU\+/i, category: 'telecom', deductible: true },
  { pattern: /한국전력|한전|도시가스|수도/i, category: 'utilities', deductible: true },
  { pattern: /택시|카카오택시|KTX|SRT|코레일|톨게이트|하이패스/i, category: 'transport_business', deductible: true },
  { pattern: /네이버광고|구글광고|카카오광고|페이스북광고|인스타/i, category: 'advertising', deductible: true },
  { pattern: /AWS|Amazon\s*Web|Azure|Google\s*Cloud|GCP|Vercel|Heroku|Netlify/i, category: 'software', deductible: true },
  { pattern: /오피스디포|알파문구|모닝글로리|문방구/i, category: 'office_supplies', deductible: true },
  { pattern: /교보문고|영풍문고|예스24|알라딘/i, category: 'education', deductible: true },
];

// ── Classification Result ──

export interface VATClassificationResult {
  deductible: boolean;
  categoryCode: VATCategoryCode;
  categoryLabel: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

// ── Transaction Interface (matches card_transactions table) ──

export interface CardTransactionInput {
  id?: string;
  merchant_name?: string;
  category?: string;
  amount?: number;
  description?: string;
  transaction_date?: string;
  is_deductible?: boolean;
  vat_category?: string;
}

// ── Auto-Classify Card Transaction ──

export function classifyCardTransaction(transaction: CardTransactionInput): VATClassificationResult {
  const merchantName = (transaction.merchant_name || '').trim();
  const category = (transaction.category || '').trim();
  const description = (transaction.description || '').trim();
  const searchText = `${merchantName} ${category} ${description}`;

  // 1) Check merchant name against known patterns (highest confidence)
  for (const mp of MERCHANT_PATTERNS) {
    if (mp.pattern.test(merchantName) || mp.pattern.test(searchText)) {
      const catInfo = mp.deductible
        ? DEDUCTIBLE_CATEGORIES.find(c => c.code === mp.category)
        : NON_DEDUCTIBLE_CATEGORIES.find(c => c.code === mp.category);
      return {
        deductible: mp.deductible,
        categoryCode: mp.category,
        categoryLabel: catInfo?.label || mp.category,
        confidence: 'high',
        reason: `가맹점명 "${merchantName}" 패턴 매칭`,
      };
    }
  }

  // 2) Check category/description keywords against deductible categories
  for (const cat of NON_DEDUCTIBLE_CATEGORIES) {
    for (const kw of cat.keywords) {
      if (kw && searchText.includes(kw)) {
        return {
          deductible: false,
          categoryCode: cat.code,
          categoryLabel: cat.label,
          confidence: 'medium',
          reason: `키워드 "${kw}" 매칭 → ${cat.label} (불공제)`,
        };
      }
    }
  }

  for (const cat of DEDUCTIBLE_CATEGORIES) {
    for (const kw of cat.keywords) {
      if (kw && searchText.includes(kw)) {
        return {
          deductible: true,
          categoryCode: cat.code,
          categoryLabel: cat.label,
          confidence: 'medium',
          reason: `키워드 "${kw}" 매칭 → ${cat.label} (공제)`,
        };
      }
    }
  }

  // 3) Heuristic: small amounts at restaurants likely entertainment/meals
  const amount = transaction.amount || 0;
  if (/식당|레스토랑|음식|치킨|피자|카페|커피|스타벅스|이디야|투썸/i.test(searchText)) {
    // Meals: generally deductible as 복리후생비 if for employees,
    // but classify as entertainment (불공제) if above threshold (접대 의심)
    if (amount > 300000) {
      return {
        deductible: false,
        categoryCode: 'entertainment',
        categoryLabel: '접대비 (추정)',
        confidence: 'low',
        reason: `음식점 결제 ₩${amount.toLocaleString()} (30만원 초과 → 접대비 추정)`,
      };
    }
    return {
      deductible: true,
      categoryCode: 'general_expense',
      categoryLabel: '복리후생비/회의비',
      confidence: 'low',
      reason: `음식점 결제 ₩${amount.toLocaleString()} (일반 업무경비 추정)`,
    };
  }

  // 4) Default: assume deductible with low confidence (requires manual review)
  return {
    deductible: true,
    categoryCode: 'general_expense',
    categoryLabel: '일반 사업경비 (미분류)',
    confidence: 'low',
    reason: '자동 분류 불가 — 수동 확인 필요',
  };
}

// ── Batch Classify Transactions ──

export function classifyCardTransactions(
  transactions: CardTransactionInput[],
): Array<CardTransactionInput & { classification: VATClassificationResult }> {
  return transactions.map(tx => ({
    ...tx,
    classification: classifyCardTransaction(tx),
  }));
}

// ── Save Classification to DB ──

export async function saveVATClassification(
  transactionId: string,
  result: VATClassificationResult,
): Promise<void> {
  const { error } = await db
    .from('card_transactions')
    .update({
      is_deductible: result.deductible,
      vat_category: result.categoryCode,
      vat_category_label: result.categoryLabel,
      vat_confidence: result.confidence,
      vat_reason: result.reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', transactionId);

  if (error) throw error;
}

// ── Batch Save Classifications ──

export async function batchSaveVATClassifications(
  classifications: Array<{ transactionId: string; result: VATClassificationResult }>,
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const item of classifications) {
    try {
      await saveVATClassification(item.transactionId, item.result);
      success++;
    } catch {
      failed++;
    }
  }

  return { success, failed };
}

// ── VAT Deduction Summary ──

export interface VATDeductionSummary {
  period: { from: string; to: string };
  totalTransactions: number;
  totalAmount: number;
  deductible: {
    count: number;
    amount: number;
    vatAmount: number; // 공급가액의 10% (VAT portion)
    byCategory: Array<{
      code: string;
      label: string;
      count: number;
      amount: number;
      vatAmount: number;
    }>;
  };
  nonDeductible: {
    count: number;
    amount: number;
    byCategory: Array<{
      code: string;
      label: string;
      count: number;
      amount: number;
    }>;
  };
  unclassified: {
    count: number;
    amount: number;
  };
  estimatedVATCredit: number; // 예상 매입세액 공제 금액
}

export async function getVATDeductionSummary(
  companyId: string,
  period: { from: string; to: string },
): Promise<VATDeductionSummary> {
  const { data, error } = await db
    .from('card_transactions')
    .select('id, amount, is_deductible, vat_category, vat_category_label, merchant_name, category, description')
    .eq('company_id', companyId)
    .gte('transaction_date', period.from)
    .lte('transaction_date', period.to);

  if (error) throw error;

  const transactions = (data || []) as Array<{
    id: string;
    amount: number;
    is_deductible: boolean | null;
    vat_category: string | null;
    vat_category_label: string | null;
    merchant_name: string | null;
    category: string | null;
    description: string | null;
  }>;

  // Auto-classify any unclassified transactions in-memory
  const classified = transactions.map(tx => {
    if (tx.vat_category) {
      return {
        ...tx,
        _deductible: tx.is_deductible ?? true,
        _category: tx.vat_category,
        _label: tx.vat_category_label || tx.vat_category,
      };
    }
    const result = classifyCardTransaction({
      merchant_name: tx.merchant_name || undefined,
      category: tx.category || undefined,
      amount: tx.amount,
      description: tx.description || undefined,
    });
    return {
      ...tx,
      _deductible: result.deductible,
      _category: result.categoryCode,
      _label: result.categoryLabel,
    };
  });

  const totalAmount = classified.reduce((s, t) => s + Number(t.amount || 0), 0);

  // Deductible breakdown
  const deductibleTx = classified.filter(t => t._deductible);
  const deductibleAmount = deductibleTx.reduce((s, t) => s + Number(t.amount || 0), 0);
  // VAT = supply price * 10%, supply price = total / 1.1
  const deductibleVAT = Math.round(deductibleAmount / 11);

  const deductibleByCategory = groupByCategory(deductibleTx, true);

  // Non-deductible breakdown
  const nonDeductibleTx = classified.filter(t => !t._deductible);
  const nonDeductibleAmount = nonDeductibleTx.reduce((s, t) => s + Number(t.amount || 0), 0);

  const nonDeductibleByCategory = groupByCategory(nonDeductibleTx, false);

  // Unclassified (those without saved vat_category in DB)
  const unclassifiedTx = transactions.filter(t => !t.vat_category);
  const unclassifiedAmount = unclassifiedTx.reduce((s, t) => s + Number(t.amount || 0), 0);

  return {
    period,
    totalTransactions: classified.length,
    totalAmount,
    deductible: {
      count: deductibleTx.length,
      amount: deductibleAmount,
      vatAmount: deductibleVAT,
      byCategory: deductibleByCategory,
    },
    nonDeductible: {
      count: nonDeductibleTx.length,
      amount: nonDeductibleAmount,
      byCategory: nonDeductibleByCategory,
    },
    unclassified: {
      count: unclassifiedTx.length,
      amount: unclassifiedAmount,
    },
    estimatedVATCredit: deductibleVAT,
  };
}

// ── Helper: Group transactions by category ──

function groupByCategory(
  transactions: Array<{ amount: number; _category: string; _label: string }>,
  includeVAT: boolean,
): Array<{ code: string; label: string; count: number; amount: number; vatAmount: number }> {
  const map = new Map<string, { code: string; label: string; count: number; amount: number }>();

  for (const tx of transactions) {
    const existing = map.get(tx._category);
    if (existing) {
      existing.count++;
      existing.amount += Number(tx.amount || 0);
    } else {
      map.set(tx._category, {
        code: tx._category,
        label: tx._label,
        count: 1,
        amount: Number(tx.amount || 0),
      });
    }
  }

  return Array.from(map.values())
    .map(item => ({
      ...item,
      vatAmount: includeVAT ? Math.round(item.amount / 11) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ── Get VAT Period Boundaries (한국 부가세 신고기간) ──

export function getVATPeriods(year: number): Array<{
  label: string;
  from: string;
  to: string;
  filingDeadline: string;
}> {
  return [
    {
      label: `${year}년 1기 예정 (1~3월)`,
      from: `${year}-01-01`,
      to: `${year}-03-31`,
      filingDeadline: `${year}-04-25`,
    },
    {
      label: `${year}년 1기 확정 (1~6월)`,
      from: `${year}-01-01`,
      to: `${year}-06-30`,
      filingDeadline: `${year}-07-25`,
    },
    {
      label: `${year}년 2기 예정 (7~9월)`,
      from: `${year}-07-01`,
      to: `${year}-09-30`,
      filingDeadline: `${year}-10-25`,
    },
    {
      label: `${year}년 2기 확정 (7~12월)`,
      from: `${year}-07-01`,
      to: `${year}-12-31`,
      filingDeadline: `${year + 1}-01-25`,
    },
  ];
}

// ── Format Helpers ──

export function formatVATAmount(amount: number): string {
  return `₩${amount.toLocaleString('ko-KR')}`;
}

export function getDeductionRateDisplay(deductibleAmount: number, totalAmount: number): string {
  if (totalAmount === 0) return '0%';
  const rate = (deductibleAmount / totalAmount) * 100;
  return `${Math.round(rate * 10) / 10}%`;
}
