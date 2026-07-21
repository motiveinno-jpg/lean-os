"use client";
import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useEffect, useState, useRef, useCallback } from "react";
import { DateField } from "@/components/date-field";
import { friendlyError } from "@/lib/friendly-error";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { subscribeToBankTransactions, subscribeToCardTransactions } from "@/lib/realtime";
import { getCurrentUser, getBankTransactions, getBankTransactionStats, getMonthlyIncomeExpense, mapBankTransaction, ignoreBankTransaction, getDeals, getDealClassifications, getClassificationRules, upsertClassificationRule, deleteClassificationRule, getDistinctBankAccountNos } from "@/lib/queries";
import type { MonthlyIncomeExpense } from "@/lib/queries";
import { getCorporateCards, upsertCorporateCard, deleteCorporateCard, getCardTransactions, getCardTransactionStats, mapCardTransaction, ignoreCardTransaction, uploadReceiptToCard, getDistinctCardNames, restoreCardTransaction, upsertCardAlias } from "@/lib/card-transactions";
import { classifyCardTransaction, batchSaveVATClassifications } from "@/lib/card-vat-classification";
import { ClassificationBadge } from "@/components/classification-badge";
import { QueryErrorBanner } from "@/components/query-status";
import { useToast } from "@/components/toast";
import { useUser } from "@/components/user-context";
import { UpcomingAutoTransfersCard } from "@/components/upcoming-auto-transfers";
import { TopExpensesThisMonth } from "@/components/top-expenses-month";
import { AutoTransferHistoryCard } from "@/components/auto-transfer-history";
import { CardBillingSummary } from "@/components/card-billing-summary";
import { TopCardExpensesThisMonth, CardMonthlyUsage, CardAutoTransferHistory } from "@/components/card-insights";
import { CardsOverview } from "@/components/cards-overview";
import { BankAccountsOverview } from "@/components/bank-accounts-overview";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { useConfirm } from "@/components/confirm-dialog";
import { useModalKeys } from "@/hooks/use-modal-keys";

type Tab = 'inbox' | 'all' | 'rules' | 'cards' | 'manual';
type FilterStatus = 'all' | 'unmapped' | 'auto_mapped' | 'manual_mapped' | 'ignored';
type CardFilterStatus = 'all' | 'unmapped' | 'auto_mapped' | 'manual_mapped' | 'ignored';

const BANK_TABS: Tab[] = ['inbox', 'all', 'manual', 'rules'];

// AI 제안 계정과목 code → 한글 라벨(엣지 classify-transactions 의 ACCOUNT_CATEGORIES 와 동기화). 확정 시 이 라벨로 분류.
const AI_CATEGORY_LABEL: Record<string, string> = {
  revenue: "매출", other_revenue: "기타수익", outsourcing: "외주비", infrastructure: "인프라/서버",
  salary: "급여/인건비", rent: "임대료/관리비", software: "소프트웨어/SaaS", professional: "전문서비스",
  welfare: "복리후생", insurance: "4대보험", marketing: "마케팅/광고", supplies: "소모품/사무용품",
  travel: "출장/교통비", communication: "통신비", tax: "세금/공과금", depreciation: "감가상각비",
  interest: "이자비용", other_expense: "기타 운영비",
};

// 매달 고정적으로 나가는 계정 = 고정비(변동비와 구분, 번레이트 분석용). AI 확정 시 이 코드면 고정비 자동 체크.
const AI_FIXED_COST_CODES = new Set(["rent", "salary", "insurance", "software", "communication", "infrastructure", "interest"]);
const CARD_TABS: Tab[] = ['cards'];

interface TransactionsViewProps {
  initialTab?: Tab;
  visibleTabs?: Tab[];
}

export default function TransactionsPage() {
  // 2026-07-15 단순화: 브라우징 탭(전체/수기입력/법인카드) 제거 — 조회는 통장·카드가 담당.
  //   '거래 자동화'는 미분류 정리 + 분류 규칙만. 입금은 '거래 매칭'으로 유도(아래 배너).
  return <TransactionsView initialTab="inbox" visibleTabs={['inbox', 'rules']} />;
}

export function TransactionsView({ initialTab = 'inbox', visibleTabs = BANK_TABS }: TransactionsViewProps = {}) {
  const { role } = useUser();
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const bankCd = useSyncCooldown(companyId, "bank");
  const [userId, setUserId] = useState<string | null>(null);
  const [userLoadFailed, setUserLoadFailed] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('unmapped');
  const [filterType, setFilterType] = useState<string>('');
  // 통장별/날짜 필터 — codef sync 결과 분류용
  const [selectedAccountNo, setSelectedAccountNo] = useState<string>('');
  const [bankDateFrom, setBankDateFrom] = useState<string>('');
  const [bankDateTo, setBankDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [mapModal, setMapModal] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ rule_name: '', match_type: 'contains', match_field: 'counterparty', match_value: '', assign_category: '', assign_classification: '', assign_deal_id: '', is_fixed_cost: false });
  // Card tab state
  const [cardMapModal, setCardMapModal] = useState<any>(null);
  const [showCardForm, setShowCardForm] = useState(false);
  const [editingCard, setEditingCard] = useState<any>(null);
  const [cardForm, setCardForm] = useState({ card_name: '', card_number: '', card_company: '삼성', holder_name: '', monthly_limit: '', payment_day: '', billing_day: '', card_type: 'credit' as 'credit' | 'check' | 'debit' | 'other' });
  const [selectedCardId, setSelectedCardId] = useState<string>('');
  const [selectedCardName, setSelectedCardName] = useState<string>('');  // CODEF sync 카드 필터
  const [cardFilterStatus, setCardFilterStatus] = useState<CardFilterStatus>('all');
  const [cardDateFrom, setCardDateFrom] = useState('');
  const [cardDateTo, setCardDateTo] = useState('');
  const [cardUploading, setCardUploading] = useState(false);
  const [cardUploadResult, setCardUploadResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cardFileRef = useRef<HTMLInputElement>(null);
  const receiptFileRef = useRef<HTMLInputElement>(null);
  const [receiptUploadingId, setReceiptUploadingId] = useState<string | null>(null);
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [codefSyncing, setCodefSyncing] = useState(false);
  const [bankFetching, setBankFetching] = useState(false);
  // AI 제안(suggest 모드) — DB 미적용, 화면에만 추천 보관. 확정은 사람이 [확정] 클릭.
  const [aiSug, setAiSug] = useState<Record<string, { category: string; confidence: number }>>({});
  const [aiSugLoading, setAiSugLoading] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false); // 상단 도구(동기화·내보내기·업로드) 드롭다운 — 버튼 난립 압축
  // Manual entry state
  const [manualForm, setManualForm] = useState({
    type: 'expense' as 'income' | 'expense',
    amount: '',
    counterparty: '',
    description: '',
    transaction_date: todayKst(),
    category: '',
    bank_name: '',
    memo: '',
  });
  const [manualSaving, setManualSaving] = useState(false);
  const [manualEntries, setManualEntries] = useState<any[]>([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        if (u) {
          setCompanyId(u.company_id);
          setUserId(u.id);
        } else {
          setUserLoadFailed(true);
        }
      })
      .catch(() => {
        setUserLoadFailed(true);
      });
  }, []);

  // 전역 자동 동기화(app-shell)가 완료되면 거래 목록 즉시 갱신
  useEffect(() => {
    const onSynced = () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['card-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['bank-tx-stats'] });
      queryClient.invalidateQueries({ queryKey: ['bank-tx-monthly'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts-distinct'] });
    };
    window.addEventListener('ownerview:codef-synced', onSynced);
    return () => window.removeEventListener('ownerview:codef-synced', onSynced);
  }, [queryClient]);

  // Supabase Realtime — 통장/카드 거래 즉시 반영 (페이지 머무는 동안)
  // 10분 sync interval / 진입 시 sync 는 별도 유지(백업 + 초기 로드).
  useEffect(() => {
    if (!companyId) return;
    const bankCh = subscribeToBankTransactions(companyId, () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['bank-tx-stats'] });
      queryClient.invalidateQueries({ queryKey: ['bank-tx-monthly'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts-distinct'] });
    });
    const cardCh = subscribeToCardTransactions(companyId, () => {
      queryClient.invalidateQueries({ queryKey: ['card-transactions'] });
    });
    return () => {
      supabase.removeChannel(bankCh);
      supabase.removeChannel(cardCh);
    };
  }, [companyId, queryClient]);

  const { data: bankTx = [], isLoading, error: mainError, refetch: mainRefetch } = useQuery({
    queryKey: ['bank-transactions', companyId, filterStatus, filterType, bankDateFrom, bankDateTo],
    queryFn: () => getBankTransactions(companyId!, {
      status: filterStatus === 'all' ? undefined : filterStatus,
      type: filterType || undefined,
      dateFrom: bankDateFrom || undefined,
      dateTo: bankDateTo || undefined,
      // accountNo 는 client-side 필터 (raw_data->>accountNo PostgREST eq 불안정).
    }),
    enabled: !!companyId,
  });

  // bank_transactions 의 is_fixed_cost(고정비 — 비용 성격) 토글 mutation
  const toggleFixedMut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await (supabase).from('bank_transactions').update({ is_fixed_cost: value }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bank-transactions'] }),
    onError: (e: any) => toast(`고정비 변경 실패: ${e.message}`, 'error'),
  });

  // 2026-05-22 자동이체(is_auto_transfer — 결제 방식) 토글 mutation. 고정비와 독립.
  const toggleAutoMut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await (supabase).from('bank_transactions').update({ is_auto_transfer: value }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bank-transactions'] }),
    onError: (e: any) => toast(`자동이체 변경 실패: ${e.message}`, 'error'),
  });

  // 통장 목록 (codef sync 한 결과로부터)
  const { data: bankAccountsList = [] } = useQuery({
    queryKey: ['bank-accounts-distinct', companyId],
    queryFn: () => getDistinctBankAccountNos(companyId!),
    enabled: !!companyId,
  });

  const { data: stats } = useQuery({
    queryKey: ['bank-tx-stats', companyId],
    queryFn: () => getBankTransactionStats(companyId!),
    enabled: !!companyId,
  });

  const { data: monthlyData = [] } = useQuery({
    queryKey: ['bank-tx-monthly', companyId],
    queryFn: () => getMonthlyIncomeExpense(companyId!),
    enabled: !!companyId,
  });

  const { data: deals = [] } = useQuery({
    queryKey: ['deals', companyId],
    queryFn: () => getDeals(companyId!),
    enabled: !!companyId,
  });

  const { data: classifications = [] } = useQuery({
    queryKey: ['deal-classifications', companyId],
    queryFn: () => getDealClassifications(companyId!),
    enabled: !!companyId,
  });

  const { data: rules = [] } = useQuery({
    queryKey: ['classification-rules', companyId],
    queryFn: () => getClassificationRules(companyId!),
    enabled: !!companyId,
  });

  // 자동이체(반복결제) 등록내역 — 거래의 "자동" 판정 기준
  const { data: recurringPayments = [] } = useQuery({
    queryKey: ['recurring-payments', companyId],
    queryFn: async () => {
      const { getRecurringPayments } = await import('@/lib/approval-center');
      return getRecurringPayments(companyId!);
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // ── Card Queries ──
  const { data: corpCards = [] } = useQuery({
    queryKey: ['corporate-cards', companyId],
    queryFn: () => getCorporateCards(companyId!),
    enabled: !!companyId,
  });

  const { data: cardTx = [], isLoading: cardTxLoading, error: cardError } = useQuery({
    queryKey: ['card-transactions', companyId, selectedCardId, selectedCardName, cardFilterStatus, cardDateFrom, cardDateTo],
    queryFn: () => getCardTransactions(companyId!, {
      cardId: selectedCardId || undefined,
      cardName: selectedCardName || undefined,
      status: cardFilterStatus === 'all' ? undefined : cardFilterStatus,
      dateFrom: cardDateFrom || undefined,
      dateTo: cardDateTo || undefined,
    }),
    enabled: !!companyId && tab === 'cards',
  });

  const { data: cardStats } = useQuery({
    queryKey: ['card-tx-stats', companyId],
    queryFn: () => getCardTransactionStats(companyId!),
    enabled: !!companyId && tab === 'cards',
  });

  // CODEF sync 로 들어온 거래의 distinct card_name (카드사 + 끝4자리)
  const { data: codefCards = [] } = useQuery({
    queryKey: ['codef-card-names', companyId],
    queryFn: () => getDistinctCardNames(companyId!),
    enabled: !!companyId && tab === 'cards',
  });

  // CSV Upload → bank_transactions 직접 삽입
  const handleCSVUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    setUploading(true);
    setUploadResult(null);

    try {
      const text = await file.text();
      const lines = text.split("\n").filter(l => l.trim());
      if (lines.length < 2) throw new Error("CSV 데이터가 없습니다");

      const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
      const rows = lines.slice(1).map(line => {
        const vals = line.split(",").map(v => v.trim().replace(/"/g, ""));
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = vals[i] || ""; });
        return row;
      });

      const records = rows.map(r => {
        const dateKey = headers.find(h => /거래일|날짜|date/i.test(h)) || headers[0];
        const inKey = headers.find(h => /입금|수입|income|deposit/i.test(h));
        const outKey = headers.find(h => /출금|지출|expense|withdrawal/i.test(h));
        const amountKey = headers.find(h => /금액|amount|거래금액/i.test(h));
        const counterpartyKey = headers.find(h => /상대|거래처|counterparty|적요/i.test(h));
        const descKey = headers.find(h => /내용|적요|description|memo|비고/i.test(h));
        const balanceKey = headers.find(h => /잔액|잔고|balance/i.test(h));

        let amount = 0;
        let type: "income" | "expense" = "expense";

        if (inKey && outKey) {
          const inAmt = Number((r[inKey] || "0").replace(/[^0-9.-]/g, "")) || 0;
          const outAmt = Number((r[outKey] || "0").replace(/[^0-9.-]/g, "")) || 0;
          if (inAmt > 0) { amount = inAmt; type = "income"; }
          else { amount = outAmt; type = "expense"; }
        } else if (amountKey) {
          amount = Number((r[amountKey] || "0").replace(/[^0-9.-]/g, "")) || 0;
          type = amount >= 0 ? "income" : "expense";
          amount = Math.abs(amount);
        }

        const balanceAfter = balanceKey ? Number((r[balanceKey] || "0").replace(/[^0-9.-]/g, "")) || null : null;

        return {
          company_id: companyId,
          transaction_date: r[dateKey || ""] || todayKst(),
          amount,
          balance_after: balanceAfter,
          type,
          counterparty: r[counterpartyKey || ""] || null,
          description: r[descKey || ""] || null,
          source: 'csv_upload',
          raw_data: r,
        };
      }).filter(r => r.amount > 0);

      if (records.length === 0) throw new Error("유효한 거래 데이터가 없습니다");

      // ── F-4: Duplicate check (transaction_date + amount + counterparty) ──
      const existing = logRead('transactions/page:existing', await supabase
        .from("bank_transactions")
        .select("transaction_date, amount, counterparty")
        .eq("company_id", companyId ?? ""));

      const existingKeys = new Set(
        (existing || []).map((e: any) =>
          `${e.transaction_date}|${Number(e.amount)}|${(e.counterparty || '').trim().toLowerCase()}`
        )
      );

      const uniqueRecords = records.filter(r => {
        const key = `${r.transaction_date}|${r.amount}|${(r.counterparty || '').trim().toLowerCase()}`;
        return !existingKeys.has(key);
      });

      const duplicateCount = records.length - uniqueRecords.length;

      if (uniqueRecords.length > 0) {
        const { error } = await supabase.from("bank_transactions").insert(uniqueRecords);
        if (error) throw error;
      }

      const parts: string[] = [];
      if (uniqueRecords.length > 0) parts.push(`${uniqueRecords.length}건 업로드 완료`);
      if (duplicateCount > 0) parts.push(`${duplicateCount}건 중복 건너뜀`);
      setUploadResult(parts.join(', ') || '업로드할 데이터가 없습니다');
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-tx-stats"] });
    } catch (err: any) {
      setUploadResult(`오류: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [companyId, queryClient]);

  // Card CSV Upload → card_transactions 직접 삽입
  const handleCardCSVUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    setCardUploading(true);
    setCardUploadResult(null);

    try {
      const text = await file.text();
      const lines = text.split("\n").filter(l => l.trim());
      if (lines.length < 2) throw new Error("CSV 데이터가 없습니다");

      const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
      const rows = lines.slice(1).map(line => {
        const vals = line.split(",").map(v => v.trim().replace(/"/g, ""));
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = vals[i] || ""; });
        return row;
      });

      const records = rows.map(r => {
        const dateKey = headers.find(h => /거래일|날짜|date|승인일/i.test(h)) || headers[0];
        const amountKey = headers.find(h => /금액|amount|거래금액|승인금액|이용금액/i.test(h));
        const merchantKey = headers.find(h => /가맹점|상호|merchant|이용처/i.test(h));
        const categoryKey = headers.find(h => /업종|카테고리|category/i.test(h));
        const approvalKey = headers.find(h => /승인번호|approval/i.test(h));

        const amount = Math.abs(Number((r[amountKey || ""] || "0").replace(/[^0-9.-]/g, "")) || 0);

        return {
          company_id: companyId,
          card_id: selectedCardId || null,
          transaction_date: r[dateKey || ""] || todayKst(),
          amount,
          merchant_name: r[merchantKey || ""] || null,
          merchant_category: r[categoryKey || ""] || null,
          approval_number: r[approvalKey || ""] || null,
          source: 'csv_upload',
          mapping_status: 'unmapped',
          raw_data: r,
        };
      }).filter(r => r.amount > 0);

      if (records.length === 0) throw new Error("유효한 카드 거래 데이터가 없습니다");

      // ── F-4: Card CSV duplicate check (transaction_date + amount + merchant_name) ──
      const existingCards = logRead('transactions/page:existingCards', await supabase
        .from("card_transactions")
        .select("transaction_date, amount, merchant_name")
        .eq("company_id", companyId ?? ""));

      const existingCardKeys = new Set(
        (existingCards || []).map((e: any) =>
          `${e.transaction_date}|${Number(e.amount)}|${(e.merchant_name || '').trim().toLowerCase()}`
        )
      );

      const uniqueCardRecords = records.filter(r => {
        const key = `${r.transaction_date}|${r.amount}|${(r.merchant_name || '').trim().toLowerCase()}`;
        return !existingCardKeys.has(key);
      });

      const cardDuplicateCount = records.length - uniqueCardRecords.length;

      let classifiedCount = 0;
      if (uniqueCardRecords.length > 0) {
        const { data: inserted, error } = await supabase
          .from("card_transactions")
          .insert(uniqueCardRecords)
          .select("id, merchant_name, merchant_category, amount");
        if (error) throw error;

        // Auto-classify VAT deductibility for inserted records
        if (inserted && inserted.length > 0) {
          const classifications = inserted.map(tx => {
            const result = classifyCardTransaction({
              merchant_name: tx.merchant_name || undefined,
              category: tx.merchant_category || undefined,
              amount: tx.amount,
            });
            return { transactionId: tx.id, result };
          });
          const { success } = await batchSaveVATClassifications(classifications);
          classifiedCount = success;
        }
      }

      const cardParts: string[] = [];
      if (uniqueCardRecords.length > 0) cardParts.push(`${uniqueCardRecords.length}건 카드 거래 업로드 완료`);
      if (classifiedCount > 0) cardParts.push(`${classifiedCount}건 VAT 자동분류 완료`);
      if (cardDuplicateCount > 0) cardParts.push(`${cardDuplicateCount}건 중복 건너뜀`);
      setCardUploadResult(cardParts.join(', ') || '업로드할 데이터가 없습니다');
      queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["card-tx-stats"] });
    } catch (err: any) {
      setCardUploadResult(`오류: ${err.message}`);
    } finally {
      setCardUploading(false);
      if (cardFileRef.current) cardFileRef.current.value = "";
    }
  }, [companyId, selectedCardId, queryClient]);

  // Receipt upload handler
  const handleReceiptUpload = useCallback(async (txId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    setReceiptUploadingId(txId);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${companyId}/receipts/${txId}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('receipts').upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(path);
      await uploadReceiptToCard(txId, urlData.publicUrl);

      queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
    } catch (err: any) {
      toast(`영수증 업로드 실패: ${err.message}`, "error");
    } finally {
      setReceiptUploadingId(null);
      if (receiptFileRef.current) receiptFileRef.current.value = "";
    }
  }, [companyId, queryClient]);

  // 영수증 스캔 → OCR(ocr-receipt Edge) → 수기 입력 폼 자동 완성. (사장님이 확인 후 직접 등록)
  const handleOcrScan = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    setOcrScanning(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${companyId}/ocr/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("receipts").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      // Edge 가 서버에서 fetch 하므로 서명 URL(시간제한 공개) 사용 — 버킷 public/private 무관 동작.
      const { data: signed, error: signErr } = await supabase.storage.from("receipts").createSignedUrl(path, 300);
      if (signErr || !signed?.signedUrl) throw signErr || new Error("이미지 URL 생성 실패");
      const { data, error } = await supabase.functions.invoke("ocr-receipt", { body: { image_url: signed.signedUrl } });
      if (error) throw error;
      if (!data?.success || !data.confidence) {
        toast("영수증을 인식하지 못했습니다. 직접 입력해주세요.", "error");
        return;
      }
      // OCR 카테고리(식대|교통|소모품|사무용품|접대|통신|기타) → 수기 폼 카테고리 매핑
      const catMap: Record<string, string> = {
        "식대": "복리후생비", "교통": "교통비", "소모품": "소모품비", "사무용품": "소모품비",
        "접대": "접대비", "통신": "통신비", "기타": "기타비용",
      };
      setManualForm((f) => ({
        ...f,
        type: "expense",
        amount: data.amount ? String(data.amount) : f.amount,
        transaction_date: data.date || f.transaction_date,
        counterparty: data.merchant || f.counterparty,
        description: data.merchant || f.description,
        category: data.category ? (catMap[data.category] || "") : f.category,
        memo: Array.isArray(data.items) && data.items.length ? data.items.join(", ") : f.memo,
      }));
      toast(`영수증 인식 완료 (확신도 ${data.confidence}%) — 내용 확인 후 등록하세요`, "success");
    } catch (err: any) {
      toast(`영수증 스캔 실패: ${err.message}`, "error");
    } finally {
      setOcrScanning(false);
      if (ocrFileRef.current) ocrFileRef.current.value = "";
    }
  }, [companyId]);

  // Bulk VAT auto-classification for unmapped card transactions
  const [vatClassifying, setVatClassifying] = useState(false);
  const handleBulkVATClassify = useCallback(async () => {
    if (!companyId) return;
    setVatClassifying(true);
    try {
      const { data: unmapped, error } = await supabase
        .from("card_transactions")
        .select("id, merchant_name, merchant_category, amount")
        .eq("company_id", companyId ?? "")
        .or("mapping_status.eq.unmapped,mapping_status.is.null");
      if (error) throw error;
      if (!unmapped || unmapped.length === 0) {
        toast("분류할 미매핑 거래가 없습니다", "info");
        return;
      }
      const classifications = unmapped.map(tx => ({
        transactionId: tx.id,
        result: classifyCardTransaction({
          merchant_name: tx.merchant_name || undefined,
          category: tx.merchant_category || undefined,
          amount: tx.amount,
        }),
      }));
      const { success, failed } = await batchSaveVATClassifications(classifications);
      toast(`VAT 자동분류 완료: ${success}건 성공${failed > 0 ? `, ${failed}건 실패` : ''}`, success > 0 ? "success" : "error");
      queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["card-tx-stats"] });
    } catch (err: any) {
      toast(`VAT 분류 실패: ${err.message}`, "error");
    } finally {
      setVatClassifying(false);
    }
  }, [companyId, queryClient]);

  // (구 handleAIClassify 자동적용 제거 — 'AI 추천 받기'(runAiSuggest, 제안→사람 확정)로 대체 2026-07-15)

  // 사용자가 추가한 분류/카테고리 옵션 (저장·재사용·삭제)
  const { data: savedOptions = [] } = useQuery({
    queryKey: ["tx-category-options", companyId],
    queryFn: async () => {
      const data = logRead('transactions/page:data', await (supabase)
        .from("tx_category_options")
        .select("id, kind, name")
        .eq("company_id", companyId!)
        .order("name"));
      return (data || []) as { id: string; kind: string; name: string }[];
    },
    enabled: !!companyId,
  });
  const savedClassifications = savedOptions.filter((o) => o.kind === "classification").map((o) => o.name);
  const savedCategories = savedOptions.filter((o) => o.kind === "category").map((o) => o.name);

  const addOptionMut = useMutation({
    mutationFn: async (p: { kind: "classification" | "category"; name: string }) => {
      const { error } = await (supabase)
        .from("tx_category_options")
        .upsert({ company_id: companyId as string, kind: p.kind, name: p.name.trim() }, { onConflict: "company_id,kind,name" });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tx-category-options"] }),
    onError: (e: any) => toast("옵션 추가 실패: " + (e?.message || ""), "error"),
  });

  const deleteOptionMut = useMutation({
    mutationFn: async (p: { kind: "classification" | "category"; name: string }) => {
      const { error } = await (supabase)
        .from("tx_category_options")
        .delete()
        .eq("company_id", companyId ?? "")
        .eq("kind", p.kind)
        .eq("name", p.name);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tx-category-options"] }),
    onError: (e: any) => toast("옵션 삭제 실패: " + (e?.message || ""), "error"),
  });

  const mapMut = useMutation({
    mutationFn: (params: { id: string; dealId?: string; classification?: string; category?: string; isFixedCost?: boolean }) =>
      mapBankTransaction(params.id, { ...params, mappedBy: userId! }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-tx-stats"] });
      setMapModal(null);
      // 분류 완료된 거래는 inbox 에서 사라지고 '전체' 탭에 남음 — 사용자 혼란 방지 안내
      const fixedNote = vars.isFixedCost ? " · 자동이체 표시됨" : "";
      if (tab === 'inbox') {
        toast(`분류 완료${fixedNote} — '전체' 탭에서 확인할 수 있습니다`, "success");
      } else {
        toast(`분류 완료${fixedNote}`, "success");
      }
    },
    onError: (err: any) => toast("거래 매핑 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const ignoreMut = useMutation({
    mutationFn: (id: string) => ignoreBankTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-tx-stats"] });
    },
    onError: (err: any) => toast("거래 무시 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const addRuleMut = useMutation({
    mutationFn: () => upsertClassificationRule({
      companyId: companyId!,
      ruleName: ruleForm.rule_name,
      matchType: ruleForm.match_type,
      matchField: ruleForm.match_field,
      matchValue: ruleForm.match_value,
      assignCategory: ruleForm.assign_category || undefined,
      assignClassification: ruleForm.assign_classification || undefined,
      assignDealId: ruleForm.assign_deal_id || undefined,
      isFixedCost: ruleForm.is_fixed_cost,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classification-rules"] });
      setShowRuleForm(false);
      setRuleForm({ rule_name: '', match_type: 'contains', match_field: 'counterparty', match_value: '', assign_category: '', assign_classification: '', assign_deal_id: '', is_fixed_cost: false });
    },
    onError: (err: any) => toast("분류 규칙 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const deleteRuleMut = useMutation({
    mutationFn: (id: string) => deleteClassificationRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["classification-rules"] }),
    onError: (err: any) => toast("분류 규칙 삭제 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // ── Card Mutations ──
  const cardMapMut = useMutation({
    mutationFn: (params: { id: string; dealId?: string; classification?: string; category?: string; isFixedCost?: boolean; isDeductible?: boolean }) =>
      mapCardTransaction(params.id, { ...params, mappedBy: userId! }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["card-tx-stats"] });
      setCardMapModal(null);
    },
    onError: (err: any) => toast("카드 거래 매핑 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const cardIgnoreMut = useMutation({
    mutationFn: (id: string) => ignoreCardTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["card-tx-stats"] });
    },
    onError: (err: any) => toast("카드 거래 무시 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // AI 추천 받기(제안 모드) — 미분류 지출 최대 20건에 AI 계정과목 추천을 받아 화면에만 보관(확정은 사람).
  const runAiSuggest = useCallback(async () => {
    if (!companyId) return;
    setAiSugLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { toast("로그인이 필요합니다", "error"); return; }
      const ids = (bankTx as any[]).filter((t) => t.mapping_status === 'unmapped' && t.type === 'expense').slice(0, 20).map((t) => t.id);
      if (ids.length === 0) { toast("추천할 미분류 지출이 없습니다", "info"); return; }
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/classify-transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ transaction_ids: ids, suggest: true }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "AI 추천 실패");
      const map: Record<string, { category: string; confidence: number }> = {};
      for (const r of (result.results || [])) map[r.id] = { category: r.category, confidence: r.confidence };
      setAiSug((prev) => ({ ...prev, ...map }));
      toast(Object.keys(map).length > 0 ? `AI 추천 ${Object.keys(map).length}건 — 확인 후 [확정]하세요` : "AI가 추천할 거래를 찾지 못했습니다", Object.keys(map).length > 0 ? "success" : "info");
    } catch (err: any) {
      toast(friendlyError(err, "AI 추천 실패"), "error");
    } finally {
      setAiSugLoading(false);
    }
  }, [companyId, bankTx]);

  // AI 추천 확정 — 사람이 [확정] 클릭 시 그 계정과목(한글 라벨)으로 분류(+학습). mapMut 재사용.
  const confirmAiSug = useCallback((txId: string, code: string, confidence: number) => {
    const label = AI_CATEGORY_LABEL[code] || code;
    void confidence; // (확정 시엔 라벨만 저장 — 수동 분류와 동일 형식으로 일관 + 학습)
    // 고정비도 AI 계정과목에서 자동 판정(수동 체크 불필요). 임대료·급여·보험·구독·통신·인프라·이자 = 고정비.
    mapMut.mutate({ id: txId, category: label, classification: label, isFixedCost: AI_FIXED_COST_CODES.has(code) });
    setAiSug((prev) => { const n = { ...prev }; delete n[txId]; return n; });
  }, [mapMut]);

  const cardRestoreMut = useMutation({
    mutationFn: (id: string) => restoreCardTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["card-tx-stats"] });
    },
    onError: (err: any) => toast("카드 거래 복원 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const upsertCardMut = useMutation({
    mutationFn: () => upsertCorporateCard({
      id: editingCard?.id,
      companyId: companyId!,
      cardName: cardForm.card_name,
      cardNumber: cardForm.card_number,
      cardCompany: cardForm.card_company,
      holderName: cardForm.holder_name,
      monthlyLimit: cardForm.monthly_limit ? Number(cardForm.monthly_limit) : undefined,
      paymentDay: cardForm.payment_day ? Number(cardForm.payment_day) : null,
      billingDay: cardForm.billing_day ? Number(cardForm.billing_day) : null,
      cardType: cardForm.card_type,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["corporate-cards"] });
      setShowCardForm(false);
      setEditingCard(null);
      setCardForm({ card_name: '', card_number: '', card_company: '삼성', holder_name: '', monthly_limit: '', payment_day: '', billing_day: '', card_type: 'credit' });
    },
    onError: (err: any) => toast("법인카드 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });
  // 법인카드 등록/수정 모달 — ESC 닫기 · Enter 확인(카드 이름 미입력/저장중이면 비활성)
  useModalKeys(showCardForm, () => setShowCardForm(false), !cardForm.card_name || upsertCardMut.isPending ? undefined : () => upsertCardMut.mutate());

  const deleteCardMut = useMutation({
    mutationFn: (id: string) => deleteCorporateCard(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["corporate-cards"] }),
    onError: (err: any) => toast("법인카드 삭제 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const aliasMut = useMutation({
    mutationFn: (p: { sourceCardName: string; alias: string }) =>
      upsertCardAlias({ companyId: companyId!, ...p }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codef-card-names"] });
      toast("카드 별명이 저장되었습니다", "success");
    },
    onError: (err: any) => toast(`별명 저장 실패: ${err.message || err}`, "error"),
  });

  function handleEditCardAlias(cardName: string, currentAlias: string | null | undefined) {
    if (!companyId) return;
    const next = window.prompt(
      `카드 별명을 입력하세요 (비우면 별명 삭제)\n\n원본 카드명: ${cardName}\n예: 대표 카드, 광고비 카드, 영업팀 카드, 출장비 카드 등`,
      currentAlias || ""
    );
    if (next === null) return; // 취소
    aliasMut.mutate({ sourceCardName: cardName, alias: next });
  }

  const s = stats || { total: 0, unmapped: 0, autoMapped: 0, manualMapped: 0, totalIncome: 0, totalExpense: 0 };
  const cs = cardStats || { total: 0, unmapped: 0, autoMapped: 0, totalSpent: 0, deductible: 0, nonDeductible: 0 };

  /* Search + 통장 + 고정지출 필터 (client-side — server-side JSON eq 불안정해서 안전하게 여기서) */
  const [showFixedOnly, setShowFixedOnly] = useState(false);
  // 거래내역 테이블 정렬 — 날짜/거래처 헤더 클릭 시 토글
  const [bankSortBy, setBankSortBy] = useState<'transaction_date' | 'counterparty'>('transaction_date');
  const [bankSortDir, setBankSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleBankSort = (key: 'transaction_date' | 'counterparty') => {
    if (bankSortBy === key) {
      setBankSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setBankSortBy(key);
      setBankSortDir(key === 'transaction_date' ? 'desc' : 'asc');
    }
  };
  // 카드 탭 정렬 + 환불 표시 토글
  const [cardSortBy, setCardSortBy] = useState<'transaction_date' | 'merchant_name' | 'amount'>('transaction_date');
  const [cardSortDir, setCardSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleCardSort = (key: 'transaction_date' | 'merchant_name' | 'amount') => {
    if (cardSortBy === key) setCardSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setCardSortBy(key); setCardSortDir(key === 'amount' || key === 'transaction_date' ? 'desc' : 'asc'); }
  };
  const [showRefunds, setShowRefunds] = useState(false);
  // A2 체크카드 그룹 접기 토글 — localStorage 영구
  const [checkCardCollapsed, setCheckCardCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('cards:check-collapsed') === '1'; } catch { return false; }
  });
  function toggleCheckCard() {
    setCheckCardCollapsed(v => {
      const next = !v;
      try { localStorage.setItem('cards:check-collapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  }

  // 자동이체 매칭 휴리스틱: 활성 반복결제와 거래처/수취인명이 겹치고 금액이 ±5% 이내면 "자동(자동이체)" 로 본다.
  // 2026-05-22 is_auto_transfer(수동 체크) 가 켜져 있으면 항상 "자동이체" 로 표시 (고정비와 무관).
  const activeRecurring = (() => {
    const list: { keys: string[]; amount: number }[] = [];
    for (const r of (recurringPayments as any[])) {
      if (r.is_active === false) continue;
      const keys = [r.name, r.recipient_name, r.payee_name]
        .filter(Boolean)
        .map((s: string) => String(s).trim().toLowerCase())
        .filter((s: string) => s.length >= 2);
      if (keys.length === 0) continue;
      list.push({ keys, amount: Number(r.amount || 0) });
    }
    return list;
  })();
  const isAutoTransferTx = (tx: any): boolean => {
    if (tx?.is_auto_transfer === true) return true;
    if (tx?.type !== 'expense') return false;
    const cp = String(tx?.counterparty || '').trim().toLowerCase();
    const desc = String(tx?.description || '').trim().toLowerCase();
    if (!cp && !desc) return false;
    const amt = Math.abs(Number(tx?.amount || 0));
    for (const rp of activeRecurring) {
      const nameHit = rp.keys.some((k) => (cp && (cp.includes(k) || k.includes(cp))) || (desc && desc.includes(k)));
      if (!nameHit) continue;
      if (rp.amount <= 0) return true; // 금액 미등록 반복결제는 이름만으로 자동 판정
      const tol = Math.max(1000, rp.amount * 0.05);
      if (Math.abs(amt - rp.amount) <= tol) return true;
    }
    return false;
  };

  const filteredBankTx = (() => {
    let xs = bankTx as any[];
    if (selectedAccountNo) {
      xs = xs.filter((tx: any) => tx.raw_data?.accountNo === selectedAccountNo);
    }
    if (showFixedOnly) {
      xs = xs.filter((tx: any) => isAutoTransferTx(tx));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      xs = xs.filter((tx: any) =>
        (tx.counterparty || '').toLowerCase().includes(q) ||
        (tx.description || '').toLowerCase().includes(q) ||
        (tx.category || '').toLowerCase().includes(q),
      );
    }
    // 정렬 적용 (기본: 날짜 desc — 기존 동작과 동일)
    const dir = bankSortDir === 'asc' ? 1 : -1;
    xs = [...xs].sort((a, b) => {
      if (bankSortBy === 'transaction_date') {
        // 날짜 동일 시 은행 거래시각(trTime) → 입력시각 순으로 tiebreak (잔액 순서 정확)
        const dCmp = String(a.transaction_date || '').localeCompare(String(b.transaction_date || ''));
        if (dCmp !== 0) return dCmp * dir;
        const tCmp = String(a.raw_data?.trTime || '').localeCompare(String(b.raw_data?.trTime || ''));
        if (tCmp !== 0) return tCmp * dir;
        return String(a.created_at || '').localeCompare(String(b.created_at || '')) * dir;
      }
      return String(a.counterparty || '').localeCompare(String(b.counterparty || ''), 'ko') * dir;
    });
    return xs;
  })();

  /* 카드 거래: 환불(amount<0) 기본 숨김 + 정렬 */
  const displayCardTx = (() => {
    let xs = cardTx as any[];
    if (!showRefunds) {
      xs = xs.filter((t: any) => Number(t.amount || 0) > 0);
    }
    const dir = cardSortDir === 'asc' ? 1 : -1;
    xs = [...xs].sort((a: any, b: any) => {
      if (cardSortBy === 'transaction_date') {
        const dCmp = String(a.transaction_date || '').localeCompare(String(b.transaction_date || ''));
        if (dCmp !== 0) return dCmp * dir;
        return String(a.created_at || '').localeCompare(String(b.created_at || '')) * dir;
      }
      if (cardSortBy === 'amount') {
        return (Math.abs(Number(a.amount || 0)) - Math.abs(Number(b.amount || 0))) * dir;
      }
      return String(a.merchant_name || '').localeCompare(String(b.merchant_name || ''), 'ko') * dir;
    });
    return xs;
  })();

  /* Category breakdown for expense donut chart */
  const categoryBreakdown = bankTx.reduce((acc: Record<string, number>, tx: any) => {
    if (tx.type !== 'expense' && tx.type !== '출금') return acc;
    const cat = tx.category || '미분류';
    acc[cat] = (acc[cat] || 0) + Number(tx.amount);
    return acc;
  }, {} as Record<string, number>);
  const categoryEntries = Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]);
  const categoryTotal = categoryEntries.reduce((s, [, v]) => s + v, 0);

  // 권한 게이트는 모든 훅 이후에 — early return 이 훅보다 위면 Rules of Hooks 위반(크래시)
  if (role === "employee" || role === "partner") {
    return <AccessDenied detail="통장 거래 내역은 대표·관리자 전용입니다." />;
  }

  if (!companyId) {
    if (userLoadFailed) {
      return (
        <div className="p-6 text-center">
          <p className="text-red-400 mb-3">사용자 정보를 불러올 수 없습니다.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm"
          >
            새로고침
          </button>
        </div>
      );
    }
    return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  }

  if (mainError) {
    return <div className="p-6 text-center text-red-400">데이터를 불러올 수 없습니다. 새로고침해 주세요.</div>;
  }

  return (
    <div className="">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <div className="tx-header-bar page-sticky-header">
        {/* 탭 — 좌측 (visibleTabs 길이가 1 이하면 탭 UI 자체 숨김, 단일 view) */}
        {visibleTabs.length > 1 ? (
          <div className="tx-tab-switcher seg-bar">
            {(([['inbox', `미분류 정리 (${s.unmapped})`], ['all', '전체'], ['manual', '수기 입력'], ['rules', '분류 규칙'], ['cards', '법인카드']] as [Tab, string][])
              .filter(([t]) => visibleTabs.includes(t))
            ).map(([t, label]) => (
              <button key={t} onClick={() => { setTab(t); if (t === 'inbox') setFilterStatus('unmapped'); else if (t === 'all') setFilterStatus('all'); }}
                className={`seg-item ${tab === t ? 'seg-item-active' : ''}`}>
                {label}
              </button>
            ))}
          </div>
        ) : <div />}
        <div className="tx-toolbar-actions">
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
          {/* 도구 드롭다운 — 미분류 정리(inbox)에선 숨김: 동기화·내보내기·업로드는 통장 소관(중복). 전체/카드 뷰에서만. */}
          {tab !== 'inbox' && (
          <button type="button" onClick={() => setToolsOpen(v => !v)} className="btn-secondary rounded-lg text-xs whitespace-nowrap" title="최근 거래 불러오기 · 자동이체 인식 · 내보내기 · 업로드">
            🛠 도구 {toolsOpen ? '▲' : '▾'}
          </button>
          )}
          {toolsOpen && (
          <div className="tx-tools-menu" onClick={() => setToolsOpen(false)}>
          {!(visibleTabs.length === 1 && visibleTabs[0] === 'cards') && (
            <button
              onClick={() => bankCd.run(async () => {
                if (!companyId) return;
                setBankFetching(true);
                try {
                  const { syncCodefData, syncBankBalances } = await import('@/lib/data-sync');
                  // 1) 은행 거래 sync (CODEF 은행 분기만 — 홈택스/카드 미포함)
                  const result = await syncCodefData(companyId, 'bank');
                  if (!result.success && result.status !== 'partial') {
                    toast(result.error || '통장 거래 불러오기 실패', 'error');
                    return;
                  }
                  try { localStorage.setItem(`codef-connected-${companyId}`, '1'); } catch { /* ignore */ }
                  const synced = result.bankSynced ?? 0;
                  // 2) sync 완료 후 bank_accounts.balance 재계산 (잔액 즉시 반영)
                  const balResult = await syncBankBalances(companyId);
                  // 3) 거래목록 + 잔액 + 통장목록 즉시 갱신
                  queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
                  queryClient.invalidateQueries({ queryKey: ['bank-tx-stats'] });
                  queryClient.invalidateQueries({ queryKey: ['bank-tx-monthly'] });
                  queryClient.invalidateQueries({ queryKey: ['bank-accounts-distinct'] });
                  queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
                  // 다른 페이지(대시보드 등) 도 잔액 갱신하도록 전역 이벤트 발행
                  try { window.dispatchEvent(new CustomEvent('ownerview:codef-synced')); } catch { /* ignore */ }
                  const balMsg = balResult.status === 'success' ? ` · ${balResult.message}` : '';
                  const allNotes = [...(result.errors || []), ...(result.notes || [])];
                  const blockerNote = allNotes.find(n =>
                    n.code === 'NO_DEMAND_DEPOSIT' || n.code === 'CF-00401' || n.code === 'CF-00003' || n.code === 'CF-13021'
                  );
                  if (synced > 0) {
                    toast(`통장 최근 거래 ${synced}건 불러옴${balMsg}`, 'success');
                  } else if (blockerNote) {
                    toast(`통장 불러오기 — ${blockerNote.message}${blockerNote.hint ? ` · ${blockerNote.hint}` : ''}`, 'info');
                  } else {
                    toast(`통장 불러오기 완료 — 새 거래 없음${balMsg}`, 'info');
                  }
                } catch (e: any) {
                  toast(friendlyError(e, '통장 거래 불러오기 오류'), 'error');
                } finally {
                  setBankFetching(false);
                }
              })}
              disabled={bankFetching || codefSyncing || !companyId || bankCd.disabled}
              className={`btn-secondary rounded-lg text-xs whitespace-nowrap ${bankCd.disabled ? "!opacity-40 cursor-not-allowed" : ""}`}
              title={bankCd.disabled ? `30분 쿨타임 — ${bankCd.label}` : "CODEF 은행 연동으로 최근 거래를 불러오고 통장 잔액을 즉시 반영합니다"}
            >
              {bankFetching ? (
                <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> 불러오는 중...</>
              ) : bankCd.disabled ? (
                `⏳ ${bankCd.label}`
              ) : (
                '🏦 최근 거래 불러오기'
              )}
            </button>
          )}
          {/* CODEF 동기화 — 카드 전용 (통장은 위 '최근 거래 불러오기'로 통일, 중복 제거) */}
          {(visibleTabs.length === 1 && visibleTabs[0] === 'cards') && (
          <button
            onClick={async () => {
              setCodefSyncing(true);
              // 통장관리(bank tabs)면 'bank' / 카드관리(cards만)면 'card' — 504 회피.
              // 'all' 은 hometax까지 포함해 60초 넘김.
              const syncType: 'bank' | 'card' = (visibleTabs.length === 1 && visibleTabs[0] === 'cards') ? 'card' : 'bank';
              try {
                const { syncCodefData } = await import('@/lib/data-sync');
                const result = await syncCodefData(companyId!, syncType);
                if (result.success) {
                  // 수동 동기화 성공 → 이후 자동 동기화 활성화 플래그
                  try { localStorage.setItem(`codef-connected-${companyId}`, '1'); } catch { /* ignore */ }
                  // 카드 탭이면 승인내역(실시간)도 별도 호출 (billing 과 묶으면 Edge 150s 초과). 청구 마감 전 결제 즉시 반영.
                  let approvalSynced = 0;
                  if (syncType === 'card') {
                    const ar = await syncCodefData(companyId!, 'card_approval').catch(() => null);
                    approvalSynced = (ar as any)?.cardSynced ?? 0;
                  }
                  const synced = syncType === 'bank' ? (result.bankSynced ?? 0) : ((result.cardSynced ?? 0) + approvalSynced);
                  const label = syncType === 'bank' ? '통장' : '카드';
                  const allNotes = [...(result.errors || []), ...(result.notes || [])];
                  // 환경/등록 이슈 — 사용자가 행동해야 풀리는 것 우선 표시
                  const blockerNote = allNotes.find(n =>
                    n.code === 'NO_DEMAND_DEPOSIT' || n.code === 'CF-00401' || n.code === 'CF-00003' || n.code === 'CF-13021'
                  );
                  if (synced > 0) {
                    toast(`${label} 거래내역 ${synced}건 동기화 완료`, 'success');
                  } else if (blockerNote) {
                    toast(`${label} 동기화 — ${blockerNote.message}${blockerNote.hint ? ` · ${blockerNote.hint}` : ''}`, 'info');
                  } else {
                    toast(`${label} 동기화 완료 — 해당 기간 새 거래 없음`, 'info');
                  }
                  queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
                  queryClient.invalidateQueries({ queryKey: ['card-transactions'] });
                  queryClient.invalidateQueries({ queryKey: ['bank-tx-stats'] });
                  queryClient.invalidateQueries({ queryKey: ['bank-tx-monthly'] });
                  queryClient.invalidateQueries({ queryKey: ['bank-accounts-distinct'] });
                } else {
                  toast(result.error || 'CODEF 동기화 실패', 'error');
                }
              } catch (e: any) {
                toast(friendlyError(e, '오류'), 'error');
              } finally {
                setCodefSyncing(false);
              }
            }}
            disabled={codefSyncing || !companyId}
            className="btn-primary whitespace-nowrap"
          >
            {codefSyncing ? '동기화 중...' : 'CODEF 동기화'}
          </button>
          )}
          <button
            onClick={async () => {
              if (!companyId) return;
              try {
                const { autoMarkRecurringTransactions } = await import('@/lib/recurring-auto-mark');
                const r = await autoMarkRecurringTransactions(companyId);
                if (r.marked > 0) {
                  toast(`자동이체 ${r.marked}건 자동 인식 완료 (학습 패턴 ${r.learned}건)`, 'success');
                  queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
                } else if (r.learned === 0) {
                  toast('학습할 자동이체가 없습니다. 먼저 자동이체 거래에 자동이체 체크를 1회만 해주세요.', 'info');
                } else {
                  toast(`새로 인식할 거래 없음 (패턴 ${r.learned}건 학습 중)`, 'info');
                }
              } catch (err: any) {
                toast(`자동 인식 실패: ${err?.message || '오류'}`, 'error');
              }
            }}
            disabled={!companyId}
            title="이미 자동이체 체크된 거래의 출금처+금액 패턴을 학습해 같은 패턴의 신규 거래를 자동 마킹"
            className="btn-secondary rounded-lg text-xs whitespace-nowrap"
          >
            🔁 자동이체 자동 인식
          </button>
          <button
            onClick={async () => {
              const { exportBankTransactionsDouzone } = await import("@/lib/export-douzone");
              exportBankTransactionsDouzone(filteredBankTx as any);
            }}
            disabled={filteredBankTx.length === 0}
            className="btn-secondary rounded-lg text-xs whitespace-nowrap"
            title="현재 보이는 거래내역을 엑셀로 다운로드"
          >
            📄 엑셀 내보내기
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="btn-secondary rounded-lg text-xs whitespace-nowrap">
            {uploading ? "업로드 중..." : "📥 CSV 업로드"}
          </button>
          </div>
          )}
        </div>
      </div>

      {/* Search Bar — 미분류 정리(inbox)에선 별도 검색행 제거, 검색·선택확정은 리스트 툴바에 압축. */}
      {tab !== 'inbox' && (
      <div className="tx-search-bar">
        <div className="flex-1 relative">
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="거래처, 적요 검색..."
            aria-label="거래처, 적요 검색"
            className="w-full px-3 py-2 pl-9 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        {selectedIds.size > 0 && (
          <button
            onClick={() => {
              selectedIds.forEach(id => mapMut.mutate({ id }));
              setSelectedIds(new Set());
            }}
            className="px-3 py-2 bg-[var(--primary)] text-white rounded-xl text-xs font-semibold"
          >
            선택 {selectedIds.size}건 매핑
          </button>
        )}
        <button
          onClick={() => {
            if (!bankTx.length) return;
            const lines = ['날짜,거래처,적요,유형,금액,상태,카테고리'];
            bankTx.forEach((tx: any) => {
              lines.push([
                tx.transaction_date,
                `"${(tx.counterparty || '').replace(/"/g, '""')}"`,
                `"${(tx.description || '').replace(/"/g, '""')}"`,
                tx.type === 'income' ? '입금' : '출금',
                tx.amount,
                tx.mapping_status === 'unmapped' ? '미매핑' : tx.mapping_status === 'auto_mapped' ? '자동' : tx.mapping_status === 'manual_mapped' ? '수동' : '무시',
                tx.category || '',
              ].join(','));
            });
            const bom = '\uFEFF';
            const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `거래내역_${todayKst()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="btn-secondary whitespace-nowrap hidden"
        >
          CSV 내보내기
        </button>
      </div>
      )}

      {uploadResult && (
        <div className={`bank-upload-result-banner ${uploadResult.startsWith("오류") ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
          {uploadResult}
          <button onClick={() => setUploadResult(null)} className="ml-2 opacity-60 hover:opacity-100">x</button>
        </div>
      )}

      {/* 기간설정 — 미분류 정리(inbox)에선 제거(분류 확정엔 불필요). 전체/카드에서만. */}
      {(tab === 'all' || tab === 'cards') && (
        <div className="tx-period-filter-bar no-print">
          <span className="text-xs font-semibold text-[var(--text-muted)]">기간</span>
          {tab === 'cards' ? (
            <>
              <DateField value={cardDateFrom} onChange={e => setCardDateFrom(e.target.value)} aria-label="시작일"
                className="px-2 py-1.5 text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-[var(--text)]" />
              <span className="text-xs text-[var(--text-dim)]">~</span>
              <DateField value={cardDateTo} onChange={e => setCardDateTo(e.target.value)} aria-label="종료일"
                className="px-2 py-1.5 text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-[var(--text)]" />
              {(cardDateFrom || cardDateTo) && <button onClick={() => { setCardDateFrom(''); setCardDateTo(''); }} className="text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] px-1">기간 해제</button>}
            </>
          ) : (
            <>
              <DateField value={bankDateFrom} onChange={e => setBankDateFrom(e.target.value)} aria-label="시작일"
                className="px-2 py-1.5 text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-[var(--text)]" />
              <span className="text-xs text-[var(--text-dim)]">~</span>
              <DateField value={bankDateTo} onChange={e => setBankDateTo(e.target.value)} aria-label="종료일"
                className="px-2 py-1.5 text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-[var(--text)]" />
              {(bankDateFrom || bankDateTo) && <button onClick={() => { setBankDateFrom(''); setBankDateTo(''); }} className="text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] px-1">기간 해제</button>}
            </>
          )}
        </div>
      )}

      {/* 입금 → 거래 매칭 유도 배너 — 거래 자동화는 '지출 분류' 중심, 입금 정산은 '거래 매칭'에서(회계 전표 자동). */}
      {tab === 'inbox' && (bankTx as any[]).some((t) => t.type === 'income') && (
        <div className="no-print mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[var(--info)]/8 border border-[var(--info)]/25">
          <span className="text-[12px] text-[var(--text)]">
            💡 <b>입금 {(bankTx as any[]).filter((t) => t.type === 'income').length}건</b>은 여기서 분류하기보다 <b>거래 매칭</b>에서 세금계산서와 정산하면 미수금 차감·회계 전표가 자동 처리됩니다.
          </span>
          <a href="/partners/reconciliation" className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[var(--info)] text-white hover:opacity-90 transition whitespace-nowrap">거래 매칭에서 정산 →</a>
        </div>
      )}

      {/* Manual Entry Tab */}
      {tab === 'manual' && (
        <div className="manual-entry-tab">
          <div className="manual-entry-form-card glass-card">
            <h3 className="section-title">거래내역 직접 등록</h3>
            {/* 영수증 스캔 — 사진 한 장으로 폼 자동 완성 (OCR) */}
            <input ref={ocrFileRef} type="file" accept="image/*" capture="environment" onChange={handleOcrScan} className="hidden" />
            <button
              type="button"
              onClick={() => ocrFileRef.current?.click()}
              disabled={ocrScanning || !companyId}
              className="w-full mb-4 py-3 rounded-xl border-2 border-dashed border-[var(--primary)]/40 text-[var(--primary)] text-sm font-semibold hover:bg-[var(--primary)]/5 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {ocrScanning ? (
                <><span className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" /> 영수증 분석 중…</>
              ) : (
                <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><circle cx="12" cy="13" r="3" /></svg> 영수증 스캔으로 자동 입력</>
              )}
            </button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">입출금 구분 *</label>
                <div className="flex gap-2">
                  {(['income', 'expense'] as const).map(t => (
                    <button key={t} onClick={() => setManualForm(f => ({ ...f, type: t }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${manualForm.type === t ? (t === 'income' ? 'bg-blue-500 text-white' : 'bg-red-500 text-white') : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)]'}`}>
                      {t === 'income' ? '입금' : '출금'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">거래일 *</label>
                <DateField value={manualForm.transaction_date} onChange={e => setManualForm(f => ({ ...f, transaction_date: e.target.value }))}
                  className="field-input" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">금액 (원) *</label>
                <input type="text" inputMode="numeric" value={manualForm.amount ? Number(manualForm.amount).toLocaleString("ko-KR") : ""} onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); setManualForm(f => ({ ...f, amount: v })); }}
                  placeholder="1,500,000" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-right font-mono focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">거래처</label>
                <input value={manualForm.counterparty} onChange={e => setManualForm(f => ({ ...f, counterparty: e.target.value }))}
                  placeholder="(주)모티브" className="field-input" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">적요/설명</label>
                <input value={manualForm.description} onChange={e => setManualForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="서비스 용역대금" className="field-input" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">카테고리</label>
                <select value={manualForm.category} onChange={e => setManualForm(f => ({ ...f, category: e.target.value }))}
                  className="field-input">
                  <option value="">선택 안함</option>
                  <option value="매출">매출</option><option value="급여">급여</option><option value="임대료">임대료</option>
                  <option value="복리후생비">복리후생비</option><option value="소모품비">소모품비</option><option value="통신비">통신비</option>
                  <option value="교통비">교통비</option><option value="광고선전비">광고선전비</option><option value="접대비">접대비</option>
                  <option value="보험료">보험료</option><option value="세금공과">세금공과</option><option value="수수료">수수료</option>
                  <option value="이자수익">이자수익</option><option value="기타수입">기타수입</option><option value="기타비용">기타비용</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">은행/결제수단</label>
                <input value={manualForm.bank_name} onChange={e => setManualForm(f => ({ ...f, bank_name: e.target.value }))}
                  placeholder="국민은행, 신한카드 등" className="field-input" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">메모</label>
                <input value={manualForm.memo} onChange={e => setManualForm(f => ({ ...f, memo: e.target.value }))}
                  placeholder="비고" className="field-input" />
              </div>
            </div>
            <button
              onClick={async () => {
                if (!companyId || manualSaving) return;
                const amount = Number(manualForm.amount);
                if (!amount || amount <= 0) { toast('금액을 입력하세요', 'error'); return; }
                if (!manualForm.transaction_date) { toast('거래일을 선택하세요', 'error'); return; }
                setManualSaving(true);
                try {
                  const db = supabase;
                  const externalId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                  const { error } = await db.from('transactions').insert({
                    company_id: companyId,
                    external_id: externalId,
                    amount: manualForm.type === 'income' ? amount : -amount,
                    type: manualForm.type,
                    description: manualForm.description || manualForm.counterparty || '수기 입력',
                    transaction_date: manualForm.transaction_date,
                    source: 'manual',
                    counterparty: manualForm.counterparty || null,
                    category: manualForm.category || null,
                    memo: manualForm.memo || null,
                    bank_name: manualForm.bank_name || null,
                    mapping_status: manualForm.category ? 'manual_mapped' : 'unmapped',
                  });
                  if (error) throw error;
                  toast('거래내역이 등록되었습니다', 'success');
                  setManualForm(f => ({ ...f, amount: '', counterparty: '', description: '', category: '', memo: '' }));
                  queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
                  queryClient.invalidateQueries({ queryKey: ['bank-tx-stats'] });
                  // Refresh manual entries list
                  const entries = logRead('transactions/page:entries', await db.from('transactions').select('*').eq('company_id', companyId).eq('source', 'manual').order('transaction_date', { ascending: false }).limit(50));
                  setManualEntries(entries || []);
                } catch (err: any) {
                  toast(`등록 실패: ${err.message}`, 'error');
                }
                setManualSaving(false);
              }}
              disabled={manualSaving || !companyId}
              className="btn-primary w-full"
            >
              {manualSaving ? '저장 중...' : '거래내역 등록'}
            </button>
          </div>

          {/* Recently added manual entries */}
          <div className="manual-entry-history-card glass-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">수기 입력 내역</h3>
              <button onClick={async () => {
                if (!companyId) return;
                const db = supabase;
                const data = logRead('transactions/page:data', await db.from('transactions').select('*').eq('company_id', companyId).eq('source', 'manual').order('transaction_date', { ascending: false }).limit(50));
                setManualEntries(data || []);
              }} className="text-xs text-[var(--primary)] font-semibold">새로고침</button>
            </div>
            {manualEntries.length === 0 ? (
              <EmptyState icon="✍️" title="수기 입력된 거래가 없습니다" desc="위에서 거래를 등록하세요." />
            ) : (
              <div className="overflow-x-auto">
                <table className="manual-entry-history-table">
                  <thead className="sticky-bar"><tr className="table-head-row">
                    <th className="text-left px-2 py-2">날짜</th><th className="text-left px-2 py-2">구분</th>
                    <th className="text-right px-2 py-2">금액</th><th className="text-left px-2 py-2">거래처</th>
                    <th className="text-left px-2 py-2">적요</th><th className="text-left px-2 py-2">카테고리</th>
                  </tr></thead>
                  <tbody>
                    {manualEntries.map((tx: any) => (
                      <tr key={tx.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition">
                        <td className="px-2 py-2 text-xs">{tx.transaction_date}</td>
                        <td className="px-2 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${tx.type === 'income' ? 'bg-[var(--info-dim)] text-[var(--info)]' : 'bg-[var(--danger-dim)] text-[var(--danger)]'}`}>{tx.type === 'income' ? '입금' : '출금'}</span></td>
                        <td className="px-2 py-2 text-right font-mono text-xs">{Math.abs(Number(tx.amount)).toLocaleString()}원</td>
                        <td className="px-2 py-2 text-xs max-w-[160px]"><span className="block truncate" title={tx.counterparty || undefined}>{tx.counterparty || '-'}</span></td>
                        <td className="px-2 py-2 text-xs text-[var(--text-muted)] max-w-[200px]"><span className="block truncate" title={tx.description || undefined}>{tx.description || '-'}</span></td>
                        <td className="px-2 py-2 text-xs">{tx.category || <span className="text-[var(--text-dim)]">미분류</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rules Tab */}
      {tab === 'rules' && (
        <div className="rules-tab">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-dim)]">거래처/적요 패턴 매칭으로 자동 분류합니다. n8n에서 수집된 거래도 이 규칙을 적용합니다.</p>
            <button onClick={() => setShowRuleForm(!showRuleForm)} className="text-xs text-[var(--primary)] font-semibold">+ 규칙 추가</button>
          </div>

          {showRuleForm && (
            <div className="rule-form-card glass-card">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">규칙명 *</label>
                  <input value={ruleForm.rule_name} onChange={e => setRuleForm({ ...ruleForm, rule_name: e.target.value })}
                    placeholder="예: 스파크플러스 월세" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">매칭 필드</label>
                  <select value={ruleForm.match_field} onChange={e => setRuleForm({ ...ruleForm, match_field: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                    <option value="counterparty">거래처</option>
                    <option value="description">적요</option>
                    <option value="memo">메모</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">매칭 방식</label>
                  <select value={ruleForm.match_type} onChange={e => setRuleForm({ ...ruleForm, match_type: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                    <option value="contains">포함</option>
                    <option value="exact">정확히 일치</option>
                    <option value="regex">정규식</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">매칭 값 *</label>
                  <input value={ruleForm.match_value} onChange={e => setRuleForm({ ...ruleForm, match_value: e.target.value })}
                    placeholder="예: 스파크플러스" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리</label>
                  <select value={ruleForm.assign_category} onChange={e => setRuleForm({ ...ruleForm, assign_category: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                    <option value="">미지정</option>
                    <option value="고정비">고정비</option>
                    <option value="변동비">변동비</option>
                    <option value="매출">매출</option>
                    <option value="기타">기타</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">프로젝트 연결</label>
                  <select value={ruleForm.assign_deal_id} onChange={e => setRuleForm({ ...ruleForm, assign_deal_id: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                    <option value="">미연결</option>
                    {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <input type="checkbox" checked={ruleForm.is_fixed_cost} onChange={e => setRuleForm({ ...ruleForm, is_fixed_cost: e.target.checked })} />
                자동이체로 표시 <span className="caption">— 이 규칙에 매칭되는 거래를 자동이체로 표시</span>
              </label>
              <div className="flex gap-2">
                <button onClick={() => ruleForm.rule_name && ruleForm.match_value && addRuleMut.mutate()}
                  disabled={!ruleForm.rule_name || !ruleForm.match_value}
                  className="btn-primary btn-sm">추가</button>
                <button onClick={() => setShowRuleForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-xs">취소</button>
              </div>
            </div>
          )}

          {rules.length === 0 ? (
            <EmptyState
              card
              icon="📐"
              title="분류 규칙이 없습니다"
              desc="규칙을 추가하면 거래가 자동으로 분류됩니다."
              action={<button onClick={() => setShowRuleForm(!showRuleForm)} className="btn-primary">+ 규칙 추가</button>}
            />
          ) : (
            <div className="rule-list">
              {rules.map((r: any) => (
                <div key={r.id} className="rule-row glass-card">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{r.rule_name}</span>
                      {r.is_fixed_cost && <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">자동이체</span>}
                      {r.assign_category && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">{r.assign_category}</span>}
                    </div>
                    <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                      {r.match_field} {r.match_type === 'contains' ? '포함' : r.match_type === 'exact' ? '=' : '~'} "{r.match_value}"
                      {r.deals?.name && ` → ${r.deals.name}`}
                    </div>
                  </div>
                  <button onClick={() => deleteRuleMut.mutate(r.id)} className="text-xs text-red-400/60 hover:text-red-400 ml-3">삭제</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inbox / All Tabs */}
      {(tab === 'inbox' || tab === 'all') && (
        <>
          {/* ═══ granter 계좌 스타일 통장 개요 — 미분류 정리(거래 자동화)에선 숨김: 통장 페이지와 중복(계좌·지출예정·자동이체·이번달지출). ═══ */}
          {companyId && tab !== 'inbox' && (
            <BankAccountsOverview
              companyId={companyId}
              selectedAccountNo={selectedAccountNo}
              onSelect={(no) => setSelectedAccountNo(no)}
            />
          )}

          {/* 메인 카드 2열 — 다가오는 자동이체 + 이번달 큰 지출 TOP5 — inbox 숨김(통장 중복) */}
          {companyId && tab !== 'inbox' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <UpcomingAutoTransfersCard companyId={companyId} />
              <AutoTransferHistoryCard companyId={companyId} />
              <TopExpensesThisMonth companyId={companyId} />
            </div>
          )}

          {/* ═══ 아래: 거래내역 검색·필터 + 차트 ═══ */}
          {/* 통장 선택 필터 — 미분류 정리(inbox)에선 제거(분류 확정엔 불필요). 전체 뷰에서만. */}
          {tab !== 'inbox' && bankAccountsList.length > 0 && (
            <div className="bank-account-filter-bar">
              <select
                value={selectedAccountNo}
                onChange={e => setSelectedAccountNo(e.target.value)}
                className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)]"
                aria-label="통장 선택"
              >
                <option value="">전체 통장 ({bankAccountsList.reduce((s, a) => s + a.count, 0)}건)</option>
                {bankAccountsList.map(a => {
                  const display = a.accountNo.length >= 12
                    ? `${a.accountNo.slice(0,3)}-${a.accountNo.slice(3,9)}-${a.accountNo.slice(9,11)}-${a.accountNo.slice(11)}`
                    : a.accountNo;
                  return (
                    <option key={a.accountNo} value={a.accountNo}>{display} ({a.count}건)</option>
                  );
                })}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text)] ml-2"
                title="자동이체(반복결제 등록)와 연결된 거래만 표시 (inbox 는 미분류만 보이므로 자동으로 '전체' 탭 전환)">
                <input
                  type="checkbox"
                  checked={showFixedOnly}
                  onChange={e => setShowFixedOnly(e.target.checked)}
                  className="accent-[var(--primary)]"
                />
                자동이체만
              </label>
              {(selectedAccountNo || bankDateFrom || bankDateTo || showFixedOnly) && (
                <button
                  onClick={() => { setSelectedAccountNo(''); setBankDateFrom(''); setBankDateTo(''); setShowFixedOnly(false); }}
                  className="px-2 py-1.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]"
                >초기화</button>
              )}
              <span className="ml-auto text-[10px] text-[var(--text-dim)]">
                {filteredBankTx.length}건 표시 / 전체 {bankTx.length}건
                {showFixedOnly || filteredBankTx.some((t: any) => isAutoTransferTx(t)) ? (
                  <> · 자동이체 합계 ₩{filteredBankTx.filter((t: any) => isAutoTransferTx(t) && t.type === 'expense').reduce((s: number, t: any) => s + Number(t.amount || 0), 0).toLocaleString()}</>
                ) : null}
              </span>
            </div>
          )}

          {/* Filter pills */}
          {tab === 'all' && (
            <div className="bank-status-filter-pills">
              <div className="seg-bar">
                {([['all', '전체'], ['unmapped', '미매핑'], ['auto_mapped', '자동'], ['manual_mapped', '수동'], ['ignored', '무시']] as [FilterStatus, string][]).map(([f, label]) => (
                  <button key={f} onClick={() => setFilterStatus(f)}
                    className={`seg-item ${filterStatus === f ? 'seg-item-active' : ''}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="ml-auto seg-bar">
                {['', 'income', 'expense'].map(t => (
                  <button key={t} onClick={() => setFilterType(t)}
                    className={`seg-item ${filterType === t ? 'seg-item-active' : ''}`}>
                    {t === '' ? '전체' : t === 'income' ? '입금' : '출금'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bank-tx-list-card glass-card">
            {isLoading ? (
              <div className="p-10 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>
            ) : filteredBankTx.length === 0 ? (
              <EmptyState
                icon={tab === 'inbox' ? '✅' : '🏦'}
                title={tab === 'inbox' ? '처리할 거래가 없습니다' : searchQuery ? '검색 결과가 없습니다' : '은행 거래내역을 연결하면 자동 분류가 시작됩니다'}
                desc={tab === 'inbox' ? '모든 거래가 분류되었습니다.' : searchQuery ? '다른 키워드로 검색해보세요.' : 'CSV를 업로드하거나 n8n 자동 수집을 설정하세요'}
              />
            ) : (
              <>
                {/* 정렬·전체선택 툴바 — 스크롤과 분리해 항상 상단 고정 */}
                <div className="bank-tx-sort-toolbar">
                  {tab === 'inbox' && (
                    <label className="flex items-center gap-1.5 text-[var(--text-muted)] cursor-pointer mr-1">
                      <input type="checkbox"
                        checked={selectedIds.size > 0 && selectedIds.size === filteredBankTx.filter((t: any) => t.mapping_status === 'unmapped').length}
                        onChange={e => { if (e.target.checked) { setSelectedIds(new Set(filteredBankTx.filter((t: any) => t.mapping_status === 'unmapped').map((t: any) => t.id))); } else { setSelectedIds(new Set()); } }}
                        className="accent-[var(--primary)]" />
                      전체 선택
                    </label>
                  )}
                  <div className="seg-bar">
                    <button onClick={() => toggleBankSort('transaction_date')} className={`seg-item ${bankSortBy === 'transaction_date' ? 'seg-item-active' : ''}`}>
                      날짜순 {bankSortBy === 'transaction_date' ? (bankSortDir === 'asc' ? '↑' : '↓') : ''}
                    </button>
                    <button onClick={() => toggleBankSort('counterparty')} className={`seg-item ${bankSortBy === 'counterparty' ? 'seg-item-active' : ''}`}>
                      거래처순 {bankSortBy === 'counterparty' ? (bankSortDir === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </div>
                  {tab === 'inbox' && (
                    <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      placeholder="거래처 검색" aria-label="거래처 검색"
                      className="tx-inline-search" />
                  )}
                  {tab === 'inbox' && (
                    <div className="ml-auto flex items-center gap-1.5">
                      {selectedIds.size > 0 && (
                        <button onClick={() => { selectedIds.forEach(id => mapMut.mutate({ id })); setSelectedIds(new Set()); }}
                          className="btn-secondary btn-sm whitespace-nowrap">선택 {selectedIds.size}건 확정</button>
                      )}
                      <button onClick={runAiSuggest} disabled={aiSugLoading}
                        className="ai-suggest-btn btn-primary btn-sm"
                        title="미분류 지출(최대 20건)에 AI 계정과목 추천 — 확정은 직접">
                        {aiSugLoading ? "AI 추천 중…" : "🤖 AI 추천 받기"}
                      </button>
                    </div>
                  )}
                </div>

                {/* 스크롤 영역 — 거래 행만(툴바·합계는 고정) */}
                <div className="overflow-auto flex-1 space-y-2.5 p-3">
                {/* 거래 카드 행 (시안) */}
                {filteredBankTx.map((tx: any) => {
                  const isIncome = tx.type === 'income';
                  const mapMeta = tx.mapping_status === 'unmapped' ? { c: 'bg-[var(--warning)]/10 text-[var(--warning)]', t: '미매핑' }
                    : tx.mapping_status === 'auto_mapped' ? { c: 'bg-[var(--brand-info)]/10 text-[var(--brand-info)]', t: '자동' }
                    : tx.mapping_status === 'manual_mapped' ? { c: 'bg-[var(--success)]/10 text-[var(--success)]', t: '수동' }
                    : { c: 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]', t: '무시' };
                  return (
                    <div key={tx.id}
                      className="bank-tx-row group glass-card">
                      <div className="tx-row-main" onClick={() => setMapModal(tx)} title="클릭해서 상세 분류">
                      {tab === 'inbox' && tx.mapping_status === 'unmapped' && (
                        <input type="checkbox" checked={selectedIds.has(tx.id)} onClick={e => e.stopPropagation()}
                          onChange={e => { const next = new Set(selectedIds); if (e.target.checked) next.add(tx.id); else next.delete(tx.id); setSelectedIds(next); }}
                          className="accent-[var(--primary)] shrink-0" />
                      )}
                      <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${isIncome ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--danger)]/10 text-[var(--danger)]'}`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isIncome ? 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' : 'M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6'} />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-[var(--text)] truncate max-w-[220px]">{tx.counterparty || tx.description || '—'}</span>
                          {tx.classification && <ClassificationBadge classification={tx.classification} />}
                          {tx.category && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)] whitespace-nowrap">{tx.category}</span>}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-dim)] mt-1 flex-wrap">
                          <span className="mono-number">{tx.transaction_date}</span>
                          <span>·</span>
                          <span>{tx.bank_accounts?.alias || tx.raw_data?.accountNo?.slice(-4) || '—'}</span>
                          <span className={`px-1.5 py-0.5 rounded-full ${mapMeta.c}`}>{mapMeta.t}</span>
                          {tx.deals?.name && <span className="truncate max-w-[100px]">· {tx.deals.name}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                        {tab !== 'inbox' && (
                        <label className="flex items-center gap-1 cursor-pointer" title={tx.is_auto_transfer ? '자동이체로 표시됨 — 클릭해서 해제' : '자동이체(결제 방식)로 표시'}>
                          <input type="checkbox" checked={!!tx.is_auto_transfer} onChange={e => toggleAutoMut.mutate({ id: tx.id, value: e.target.checked })} disabled={toggleAutoMut.isPending} className="accent-sky-500 cursor-pointer" />
                          {tx.is_auto_transfer ? <span className="text-[9px] px-1 py-0.5 rounded bg-sky-500/15 text-sky-500 font-semibold whitespace-nowrap">자동이체</span>
                            : isAutoTransferTx(tx) ? <span className="text-[9px] px-1 py-0.5 rounded bg-sky-500/10 text-sky-400 whitespace-nowrap" title="등록된 자동이체와 일치 — 자동 감지">자동감지</span>
                            : <span className="text-[9px] text-[var(--text-dim)]">자동이체</span>}
                        </label>
                        )}
                        <label className="flex items-center gap-1 cursor-pointer" title={tx.is_fixed_cost ? '고정비로 표시됨 — 클릭해서 해제' : '고정비(비용 성격)로 표시'}>
                          <input type="checkbox" checked={!!tx.is_fixed_cost} onChange={e => toggleFixedMut.mutate({ id: tx.id, value: e.target.checked })} disabled={toggleFixedMut.isPending} className="accent-orange-500 cursor-pointer" />
                          {tx.is_fixed_cost ? <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/15 text-orange-500 font-semibold whitespace-nowrap">고정비</span>
                            : <span className="text-[9px] text-[var(--text-dim)]">고정비</span>}
                        </label>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-base font-bold mono-number ${isIncome ? 'text-[var(--success)]' : 'text-[var(--text)]'}`}>
                          {isIncome ? '+' : '-'}₩{Number(tx.amount).toLocaleString()}
                        </p>
                        {tab !== 'inbox' && <p className="text-[10px] text-[var(--text-dim)] mono-number mt-0.5 hidden md:block">잔액 ₩{Number(tx.balance_after || 0).toLocaleString()}</p>}
                      </div>
                      </div>
                      {/* AI 추천(제안) — 사람이 [확정] 클릭해야 적용(확정은 사람). 미분류 지출 + 추천 있을 때만. */}
                      {tab === 'inbox' && tx.mapping_status === 'unmapped' && tx.type === 'expense' && aiSug[tx.id] && (() => {
                        const s = aiSug[tx.id];
                        const label = AI_CATEGORY_LABEL[s.category] || s.category;
                        return (
                          <div className="tx-ai-suggestion">
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--primary)' }}>🤖 AI 추천</span>
                            <span className="text-[12px] font-bold text-[var(--text)]">{label}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{s.confidence}%</span>
                            {AI_FIXED_COST_CODES.has(s.category) && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/12 text-orange-500 font-semibold">고정비</span>}
                            <button onClick={() => confirmAiSug(tx.id, s.category, s.confidence)}
                              className="ml-auto px-3 py-1 rounded-lg text-[11px] font-bold text-white bg-[var(--primary)] hover:opacity-90 transition">확정</button>
                            <button onClick={() => setMapModal(tx)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition">수정</button>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                </div>

                {(() => {
                  const sumIncome = filteredBankTx.filter((t: any) => t.type === 'income').reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
                  const sumExpense = filteredBankTx.filter((t: any) => t.type === 'expense').reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
                  const net = sumIncome - sumExpense;
                  const selSum = filteredBankTx.filter((t: any) => selectedIds.has(t.id)).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
                  return (
                    <div className="bank-tx-summary-bar">
                      <span className="text-[var(--text-dim)] uppercase tracking-wider">
                        합계 ({filteredBankTx.length}건)
                        {selectedIds.size > 0 && <span className="ml-2 text-[var(--primary)] font-semibold">· 선택 {selectedIds.size}건 ₩{selSum.toLocaleString()}</span>}
                      </span>
                      {tab !== 'inbox' && (
                      <span className="flex items-center gap-4 mono-number">
                        <span className="text-[var(--success)] font-bold">+₩{sumIncome.toLocaleString()}</span>
                        <span className="text-[var(--danger)] font-bold">-₩{sumExpense.toLocaleString()}</span>
                        <span className={`font-bold ${net >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{net >= 0 ? '+' : ''}₩{net.toLocaleString()}</span>
                      </span>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {/* ═══ 하단: 월별 추이 + 카테고리 분포 차트 — 미분류 정리(분류 확정)에선 숨김(분석은 통장·리포트에서). ═══ */}
          {tab !== 'inbox' && (
          <div className="monthly-trend-section">
            <div className="md:col-span-2">
              {monthlyData.length > 0 && <MonthlyChart data={monthlyData} />}
            </div>
            {categoryEntries.length > 0 && (
              <div className="category-breakdown-card rounded-2xl bg-[var(--bg-card)]">
                <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">지출 카테고리 분포</p>
                <div className="space-y-2">
                  {categoryEntries.slice(0, 6).map(([cat, amount]) => {
                    const pct = categoryTotal > 0 ? Math.round((amount / categoryTotal) * 100) : 0;
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="text-[var(--text-muted)] truncate max-w-[120px]">{cat}</span>
                          <span className="text-[var(--text-dim)] mono-number">{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%`, transition: 'width 0.3s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {categoryEntries.length > 6 && (
                  <p className="text-[9px] text-[var(--text-dim)] mt-2">외 {categoryEntries.length - 6}개 카테고리</p>
                )}
              </div>
            )}
          </div>
          )}
        </>
      )}

      {/* Cards Tab */}
      {tab === 'cards' && (
        <div className="cards-tab">
          {/* Card Query Error */}
          {cardError && (
            <div className="p-3 rounded-lg text-sm bg-red-500/10 text-red-400">
              카드 거래 데이터를 불러올 수 없습니다. 새로고침해 주세요.
            </div>
          )}
          {/* Card Upload Result */}
          {cardUploadResult && (
            <div className={`card-upload-result-banner ${cardUploadResult.startsWith("오류") ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
              {cardUploadResult}
              <button onClick={() => setCardUploadResult(null)} className="ml-2 opacity-60 hover:opacity-100">x</button>
            </div>
          )}

          {/* ═══ granter 스타일 카드 개요: 전체 지출 + 카드사별 그룹 + 3열 그리드 (2026-05-27) ═══ */}
          {companyId && (
            <CardsOverview
              companyId={companyId}
              onSelectCard={(id) => {
                if (id.startsWith('codef:')) {
                  setSelectedCardId('');
                  setSelectedCardName(id.slice('codef:'.length));
                } else {
                  setSelectedCardId(id);
                  setSelectedCardName('');
                }
                // 선택 시 아래 상세(거래내역) 로 스크롤
                if (typeof window !== 'undefined') {
                  setTimeout(() => document.getElementById('card-tx-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                }
              }}
            />
          )}

          {/* ═══ 상세: 이용대금/청구서 + 큰 지출 TOP5 (2열) ═══ */}
          {companyId && (
            <div className="card-billing-detail-grid">
              <CardBillingSummary
                companyId={companyId}
                onSelectCard={(id) => {
                  if (id.startsWith('codef:')) {
                    // CODEF sync only (미등록 카드) — card_name 필터 사용
                    setSelectedCardId('');
                    setSelectedCardName(id.slice('codef:'.length));
                  } else {
                    setSelectedCardId(id);
                    setSelectedCardName('');
                  }
                }}
              />
              <TopCardExpensesThisMonth companyId={companyId} />
            </div>
          )}

          {/* 카드 자동이체·정기결제 내역 */}
          {companyId && <CardAutoTransferHistory companyId={companyId} />}

          {/* 카드 월별 사용금액 (카드별/합계) */}
          {companyId && <CardMonthlyUsage companyId={companyId} />}

          {/* Card 별 사용액 (CODEF sync 거래) — 별명 편집·미식별 매핑 안내 (granter 개요의 상세) */}
          {codefCards.length > 0 && (() => {
            // 끝번호(숫자4자리) 없이 카드사명만 있는 항목 = CODEF 응답에 카드 식별자 없는 미식별 거래 묶음.
            // 사용자가 어떤 카드인지 알 수 없으므로 경고 + 클릭해서 안의 거래 확인 가능하게 안내.
            const isUnidentified = (name: string) => !/\d{4}\s*$/.test(name);
            const unidentifiedCards = codefCards.filter((c: any) => isUnidentified(c.card_name));
            const unidentifiedCount = unidentifiedCards.reduce((s: number, c: any) => s + Number(c.count || 0), 0);
            return (
              <div id="card-tx-detail" className="card-usage-detail">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[var(--text-muted)]">카드별 사용액 (카드번호 끝 4자리)</div>
                  {selectedCardName && (
                    <button onClick={() => setSelectedCardName('')}
                      className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text)] transition">
                      ✕ 선택 해제 (전체 보기)
                    </button>
                  )}
                </div>
                {unidentifiedCount > 0 && (
                  <div className="mb-2 text-[11px] text-[var(--text-dim)] px-1">
                    끝번호가 없는 묶음 거래 {unidentifiedCount.toLocaleString()}건이 포함됨 · 거래 클릭 → 매핑에서 정확한 카드를 지정할 수 있습니다.
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {codefCards.map((c: any) => {
                    const unid = isUnidentified(c.card_name);
                    const displayName = c.alias || c.card_name;
                    return (
                      <div
                        key={c.card_name}
                        className={`card-usage-tile relative group ${
                          selectedCardName === c.card_name
                            ? 'bg-[var(--primary)]/10 border-[var(--primary)]'
                            : 'bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--primary)]/50'
                        }`}
                        onClick={() => setSelectedCardName(selectedCardName === c.card_name ? '' : c.card_name)}
                        title={unid ? '끝번호 없는 묶음 거래 — 클릭해서 안 거래를 보고 매핑하세요' : undefined}
                        role="button"
                        tabIndex={0}
                      >
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleEditCardAlias(c.card_name, c.alias); }}
                          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--primary)] text-[var(--text-muted)] hover:text-[var(--primary)]"
                          title="카드 별명 편집"
                          aria-label="카드 별명 편집"
                        >
                          ✏️
                        </button>
                        <div className="flex items-center gap-1 pr-6">
                          {(() => {
                            const matched: any = corpCards.find((cc: any) => cc.card_name === c.card_name);
                            return matched ? <CardTypeBadge type={(matched as any).card_type} /> : null;
                          })()}
                          <div className="text-xs font-bold text-[var(--text)] truncate">{displayName}</div>
                        </div>
                        {c.alias && (
                          <div className="text-[10px] text-[var(--text-dim)] truncate" title={c.card_name}>
                            {c.card_name}
                          </div>
                        )}
                        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          {c.count.toLocaleString()}건
                          {unid && <span className="ml-1 text-[var(--text-dim)]">· 묶음</span>}
                        </div>
                        <div className="text-sm font-semibold text-[var(--primary)] mt-1">₩{Number(c.total).toLocaleString()}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Card Selector + Actions */}
          <div className="card-selector-actions-bar">
            <select value={selectedCardId} onChange={e => { setSelectedCardId(e.target.value); if (e.target.value) setSelectedCardName(''); }}
              className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm w-full sm:w-auto sm:min-w-[200px]">
              <option value="">전체 카드 (등록된)</option>
              {corpCards.map((c: any) => (
                <option key={c.id} value={c.id}>{c.card_name} ({c.card_company})</option>
              ))}
            </select>

            <div className="ml-auto flex gap-2">
              <input ref={cardFileRef} type="file" accept=".csv" onChange={handleCardCSVUpload} className="hidden" />
              <button onClick={() => cardFileRef.current?.click()} disabled={cardUploading}
                className="btn-secondary whitespace-nowrap">
                {cardUploading ? "업로드 중..." : "카드 CSV"}
              </button>
              <button onClick={handleBulkVATClassify} disabled={vatClassifying}
                className="btn-secondary whitespace-nowrap">
                {vatClassifying ? "분류 중..." : "VAT 자동분류"}
              </button>
              <button onClick={() => { setEditingCard(null); setCardForm({ card_name: '', card_number: '', card_company: '삼성', holder_name: '', monthly_limit: '', payment_day: '', billing_day: '', card_type: 'credit' }); setShowCardForm(true); }}
                className="btn-primary whitespace-nowrap">
                + 카드 등록
              </button>
            </div>
          </div>

          {/* Card Filter Pills + 환불/취소 표시 토글 */}
          <div className="card-status-filter-bar">
            {([['all', '전체'], ['unmapped', '미매핑'], ['auto_mapped', '자동'], ['manual_mapped', '수동'], ['ignored', '무시']] as [CardFilterStatus, string][]).map(([f, label]) => (
              <button key={f} onClick={() => setCardFilterStatus(f)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${cardFilterStatus === f ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}>
                {label}
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text)]">
              <input type="checkbox" checked={showRefunds} onChange={e => setShowRefunds(e.target.checked)} className="accent-[var(--primary)]" />
              환불/취소 거래 표시
            </label>
            <span className="ml-auto text-[10px] text-[var(--text-dim)]">
              {displayCardTx.length}건 표시 / 전체 {cardTx.length}건
            </span>
          </div>

          {/* Registered Cards List 제거 — 이용대금 청구서(CardBillingSummary)·월별 사용금액(CardMonthlyUsage)·
              CODEF 카드별 사용액(위)에서 이미 모든 카드 정보가 노출되어 중복. 수정/삭제는 청구서 카드 상세에서. */}

          {/* Card Transactions Table */}
          <div className="card-tx-table-card glass-card">
            {cardTxLoading ? (
              <div className="p-10 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>
            ) : displayCardTx.length === 0 ? (
              <EmptyState icon="💳" title="카드 거래내역이 없습니다" desc="카드를 등록하고 CSV를 업로드하세요." />
            ) : (
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
                <thead className="sticky-bar">
                  <tr className="table-head-row">
                    <th
                      onClick={() => toggleCardSort('transaction_date')}
                      className="text-left px-4 py-3 font-medium cursor-pointer select-none hover:text-[var(--text)] transition"
                      title="클릭해서 날짜 정렬"
                    >
                      날짜 {cardSortBy === 'transaction_date' ? (cardSortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => toggleCardSort('merchant_name')}
                      className="text-left px-4 py-3 font-medium cursor-pointer select-none hover:text-[var(--text)] transition"
                      title="클릭해서 가맹점 이름순 정렬"
                    >
                      가맹점 {cardSortBy === 'merchant_name' ? (cardSortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => toggleCardSort('amount')}
                      className="text-right px-4 py-3 font-medium cursor-pointer select-none hover:text-[var(--text)] transition"
                      title="클릭해서 금액순 정렬"
                    >
                      금액 {cardSortBy === 'amount' ? (cardSortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th className="text-center px-4 py-3 font-medium">상태</th>
                    <th className="text-center px-4 py-3 font-medium">분류</th>
                  </tr>
                </thead>
                <tbody>
                  {displayCardTx.map((tx: any) => {
                    const amt = Number(tx.amount || 0);
                    const isRefund = amt < 0;
                    return (
                    <tr
                      key={tx.id}
                      onClick={() => setCardMapModal(tx)}
                      className="card-tx-row"
                      title="클릭해서 분류·매핑"
                    >
                      <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] mono-number">{tx.transaction_date}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-sm">{tx.merchant_name || "—"}</div>
                        <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                          {tx.card_name || tx.corporate_cards?.card_name || "카드 미지정"}
                          {tx.corporate_cards?.card_company && ` · ${tx.corporate_cards.card_company}`}
                        </div>
                      </td>
                      <td className={`px-4 py-2.5 text-sm text-right font-medium mono-number ${isRefund ? 'text-green-400' : 'text-red-400'}`}>
                        {isRefund ? '+' : '-'}₩{Math.abs(amt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                          tx.mapping_status === 'unmapped' ? 'bg-[var(--warning-dim)] text-[var(--warning)]' :
                          tx.mapping_status === 'auto_mapped' ? 'bg-[var(--info-dim)] text-[var(--info)]' :
                          tx.mapping_status === 'manual_mapped' ? 'bg-[var(--success-dim)] text-[var(--success)]' :
                          'bg-[var(--text-muted)]/10 text-[var(--text-muted)]'
                        }`}>
                          {tx.mapping_status === 'unmapped' ? '미매핑' :
                           tx.mapping_status === 'auto_mapped' ? '자동' :
                           tx.mapping_status === 'manual_mapped' ? '수동' : '무시'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          {tx.merchant_category && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)]">{tx.merchant_category}</span>
                          )}
                          {(() => {
                            // classification 이 JSON 자동분류 결과면 label 만 표시, 일반 텍스트면 그대로
                            const raw = tx.classification;
                            if (!raw || typeof raw !== 'string') return null;
                            const label = raw.trim().startsWith('{')
                              ? (() => { try { return JSON.parse(raw)?.label || ''; } catch { return ''; } })()
                              : raw;
                            return label ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400">{label}</span>
                            ) : null;
                          })()}
                          {tx.category && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${tx.is_deductible ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                              {tx.category}
                            </span>
                          )}
                          {tx.is_deductible === true && !tx.category && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">공제</span>}
                          {tx.is_deductible === false && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">불공제</span>}
                          {tx.deals?.name && <span className="text-[9px] text-[var(--text-dim)]">{tx.deals.name}</span>}
                          {tx.receipt_url && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">영수증</span>}
                          {!tx.merchant_category && !tx.category && !tx.classification && tx.is_deductible == null && !tx.deals?.name && (
                            <span className="caption">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {/* Card Add/Edit Modal */}
      {showCardForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCardForm(false)}>
          <div className="card-form-modal" onClick={e => e.stopPropagation()}>
            <h3 className="section-title">{editingCard ? '카드 수정' : '법인카드 등록'}</h3>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">카드 이름 *</label>
                <input value={cardForm.card_name} onChange={e => setCardForm({ ...cardForm, card_name: e.target.value })}
                  placeholder="예: 법인 삼성카드" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">카드사 *</label>
                  <select value={cardForm.card_company} onChange={e => setCardForm({ ...cardForm, card_company: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm">
                    <option value="삼성">삼성카드</option>
                    <option value="신한">신한카드</option>
                    <option value="현대">현대카드</option>
                    <option value="KB">KB국민카드</option>
                    <option value="롯데">롯데카드</option>
                    <option value="하나">하나카드</option>
                    <option value="우리">우리카드</option>
                    <option value="NH">NH농협카드</option>
                    <option value="BC">BC카드</option>
                    <option value="기타">기타</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">카드번호 (선택)</label>
                  <input value={cardForm.card_number} onChange={e => setCardForm({ ...cardForm, card_number: e.target.value })}
                    placeholder="1234-5678-9012-3456" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">소지자명 (선택)</label>
                  <input value={cardForm.holder_name} onChange={e => setCardForm({ ...cardForm, holder_name: e.target.value })}
                    placeholder="예: 홍길동" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">월 한도 (선택)</label>
                  <input type="text" inputMode="numeric" value={cardForm.monthly_limit ? Number(cardForm.monthly_limit).toLocaleString("ko-KR") : ""} onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); setCardForm({ ...cardForm, monthly_limit: v }); }}
                    placeholder="5,000,000" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-right font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">카드 종류 *</label>
                <div className="flex gap-2">
                  {([['credit', '신용카드'], ['check', '체크카드'], ['debit', '직불카드'], ['other', '기타']] as const).map(([k, label]) => (
                    <button key={k} type="button"
                      onClick={() => setCardForm({ ...cardForm, card_type: k })}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition border ${
                        cardForm.card_type === k
                          ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                          : 'bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)]'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-[var(--text-dim)] mt-1">이용대금 청구서에는 신용카드만 표시됩니다 (체크/직불은 즉시 출금).</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">이용대금 결제일 {cardForm.card_type === 'credit' ? '*' : '(선택)'}</label>
                  <input type="number" min={1} max={31} value={cardForm.payment_day} onChange={e => setCardForm({ ...cardForm, payment_day: e.target.value })}
                    disabled={cardForm.card_type !== 'credit'}
                    placeholder="예: 25" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm disabled:opacity-40" />
                  <div className="text-[10px] text-[var(--text-dim)] mt-1">매월 카드사가 자동출금하는 날</div>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">사용내역 마감일 (선택)</label>
                  <input type="number" min={1} max={31} value={cardForm.billing_day} onChange={e => setCardForm({ ...cardForm, billing_day: e.target.value })}
                    disabled={cardForm.card_type !== 'credit'}
                    placeholder="예: 15" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm disabled:opacity-40" />
                  <div className="text-[10px] text-[var(--text-dim)] mt-1">청구 사이클 마감 (마감+1 부터 다음 청구)</div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => cardForm.card_name && upsertCardMut.mutate()}
                disabled={!cardForm.card_name || upsertCardMut.isPending}
                className="flex-1 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {upsertCardMut.isPending ? '저장 중...' : editingCard ? '수정' : '등록'}
              </button>
              <button onClick={() => setShowCardForm(false)} className="px-4 py-2.5 text-[var(--text-muted)] text-sm">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* Card Map Modal */}
      {cardMapModal && (
        <CardMapTransactionModal
          tx={cardMapModal}
          deals={deals}
          classifications={classifications}
          existingCategories={Array.from(new Set([
            ...cardTx.map((t: any) => t.category).filter(Boolean),
            ...bankTx.map((t: any) => t.category).filter(Boolean),
          ])) as string[]}
          existingClassifications={Array.from(new Set([
            ...bankTx.map((t: any) => t.classification).filter(Boolean),
            // 카드 거래 classification 은 JSON 일 수 있음 — label 만 추출
            ...cardTx.map((t: any) => {
              const raw = t.classification;
              if (!raw || typeof raw !== 'string') return null;
              if (!raw.trim().startsWith('{')) return raw;
              try { return JSON.parse(raw)?.label || null; } catch { return null; }
            }).filter(Boolean),
          ])) as string[]}
          savedCategories={savedCategories}
          savedClassifications={savedClassifications}
          onAddOption={(kind, name) => addOptionMut.mutate({ kind, name })}
          onDeleteOption={(kind, name) => deleteOptionMut.mutate({ kind, name })}
          onMap={(params) => cardMapMut.mutate({ id: cardMapModal.id, ...params })}
          onClose={() => setCardMapModal(null)}
        />
      )}

      {/* Map Modal */}
      {mapModal && (
        <MapTransactionModal
          tx={mapModal}
          deals={deals}
          classifications={classifications}
          existingCategories={Array.from(new Set([...bankTx.map((t: any) => t.category).filter(Boolean), ...cardTx.map((t: any) => t.category).filter(Boolean)])) as string[]}
          existingClassifications={Array.from(new Set([...bankTx.map((t: any) => t.classification).filter(Boolean), ...cardTx.map((t: any) => t.classification).filter(Boolean)])) as string[]}
          savedCategories={savedCategories}
          savedClassifications={savedClassifications}
          onAddOption={(kind, name) => addOptionMut.mutate({ kind, name })}
          onDeleteOption={(kind, name) => deleteOptionMut.mutate({ kind, name })}
          onMap={(params) => mapMut.mutate({ id: mapModal.id, ...params })}
          onClose={() => setMapModal(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ──

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="glass-card p-3">
      <div className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-sm font-black mono-number" style={{ color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}

const CARD_TYPE_META: Record<string, { label: string; bg: string; color: string }> = {
  credit: { label: '신용', bg: 'rgba(59,130,246,0.12)', color: '#60a5fa' },
  check:  { label: '체크', bg: 'rgba(249,115,22,0.12)', color: '#fb923c' },
  debit:  { label: '직불', bg: 'rgba(34,197,94,0.12)',  color: '#4ade80' },
  other:  { label: '기타', bg: 'rgba(148,163,184,0.12)', color: '#94a3b8' },
};

function CardTypeBadge({ type }: { type?: string | null }) {
  const meta = CARD_TYPE_META[type || 'credit'] || CARD_TYPE_META.credit;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider shrink-0"
      style={{ background: meta.bg, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}

// 분류/카테고리 디폴트 옵션. 사용자가 직접 입력해도 OK (datalist 는 자동완성용).
// '기타' 는 의도적으로 제거 — 분류 의미 없음. 원하는 분류가 없으면 그냥 직접 타이핑.
const DEFAULT_CLASSIFICATIONS = ['B2B', 'B2C', 'B2G', '광고/마케팅', '인건비', '운영비', '외주비', '임대료', '소프트웨어', '세금'];
const DEFAULT_CATEGORIES = ['고정비', '변동비', '매출', '인건비', '복리후생', '식대', '교통/주차', '통신비', '광고선전비', '세금공과', '소모품비', '지급수수료', '임대료'];

// 칩 버튼 — 분류/카테고리 옵션 빠른 선택. 기본 5개만 표시 + '+ 더보기' 토글 + '+ 직접 추가' input.
// onAddOption: 추가 시 DB 저장(영구). deletable: 삭제 가능한(사용자 추가) 옵션 set. onDeleteOption: 삭제 콜백.
function ChipPicker({ options, value, onSelect, onAddOption, onDeleteOption, deletable }: {
  options: string[];
  value: string;
  onSelect: (v: string) => void;
  onAddOption?: (name: string) => void;
  onDeleteOption?: (name: string) => void;
  deletable?: Set<string>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showAddInput, setShowAddInput] = useState(false);
  const [newChip, setNewChip] = useState('');
  const { confirm: confirmDialog, confirmElement } = useConfirm();
  if (!options.length && !showAddInput) {
    return (
      <div className="mt-1.5">
        <button type="button" onClick={() => setShowAddInput(true)}
          className="px-2 py-0.5 text-[10px] rounded-full border border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition">
          + 직접 추가
        </button>
      </div>
    );
  }

  const visible = showAll ? options : options.slice(0, 5);
  const hasMore = options.length > 5 && !showAll;

  const submitNew = () => {
    const v = newChip.trim();
    if (v) {
      onSelect(v);
      onAddOption?.(v); // DB 영구 저장 — 다음에도 칩으로 보임
      setNewChip('');
      setShowAddInput(false);
    }
  };

  return (
    <div className="mt-1.5 flex flex-wrap gap-1 items-center">
      {visible.map((opt) => {
        const selected = opt === value;
        const canDelete = deletable?.has(opt) && !!onDeleteOption;
        return (
          <span key={opt} className={`group inline-flex items-center rounded-full transition ${
            selected ? 'bg-[var(--primary)] text-white' : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]'
          }`}>
            <button type="button" onClick={() => onSelect(opt)} className="px-2 py-0.5 text-[10px]">
              {opt}
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={async (e) => { e.stopPropagation(); const { ok } = await confirmDialog({ title: "옵션 삭제", desc: `'${opt}' 옵션을 삭제할까요? (이미 분류된 거래엔 영향 없음)`, danger: true }); if (ok) onDeleteOption!(opt); }}
                className={`pr-1.5 pl-0.5 text-[10px] ${selected ? 'text-white/70 hover:text-white' : 'text-[var(--text-dim)] hover:text-red-400'}`}
                title="이 옵션 삭제"
              >
                ×
              </button>
            )}
          </span>
        );
      })}
      {hasMore && (
        <button type="button" onClick={() => setShowAll(true)}
          className="px-2 py-0.5 text-[10px] rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] transition">
          + 더보기 ({options.length - 5})
        </button>
      )}
      {showAddInput ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={newChip}
            onChange={e => setNewChip(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitNew(); } if (e.key === 'Escape') { setShowAddInput(false); setNewChip(''); } }}
            placeholder="새 분류"
            className="w-24 px-2 py-0.5 text-[10px] bg-[var(--bg)] border border-[var(--primary)] rounded-full"
          />
          <button type="button" onClick={submitNew}
            className="px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--primary)] text-white">추가</button>
          <button type="button" onClick={() => { setShowAddInput(false); setNewChip(''); }}
            className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]">취소</button>
        </div>
      ) : (
        <button type="button" onClick={() => setShowAddInput(true)}
          className="px-2 py-0.5 text-[10px] rounded-full border border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition"
          title="없는 분류 직접 추가">
          + 추가
        </button>
      )}
      {confirmElement}
    </div>
  );
}

function MapTransactionModal({ tx, deals, classifications, existingCategories, existingClassifications, savedCategories, savedClassifications, onAddOption, onDeleteOption, onMap, onClose }: {
  tx: any;
  deals: any[];
  classifications: any[];
  existingCategories?: string[];
  existingClassifications?: string[];
  savedCategories?: string[];
  savedClassifications?: string[];
  onAddOption?: (kind: "classification" | "category", name: string) => void;
  onDeleteOption?: (kind: "classification" | "category", name: string) => void;
  onMap: (params: { dealId?: string; classification?: string; category?: string; isFixedCost?: boolean }) => void;
  onClose: () => void;
}) {
  const [dealId, setDealId] = useState(tx.deal_id || '');
  const [classification, setClassification] = useState(tx.classification || '');
  const [category, setCategory] = useState(tx.category || '');
  const [isFixed, setIsFixed] = useState(!!tx.is_fixed_cost);

  const clsOptions = Array.from(new Set<string>([
    ...DEFAULT_CLASSIFICATIONS,
    ...(savedClassifications || []),
    ...(classifications.map((c: any) => c.name).filter(Boolean) as string[]),
    ...(existingClassifications || []),
  ]));
  const catOptions = Array.from(new Set<string>([
    ...DEFAULT_CATEGORIES,
    ...(savedCategories || []),
    ...(existingCategories || []),
  ]));
  // 삭제 가능한 옵션 = 사용자가 저장한 옵션만 (기본/기존거래 파생은 삭제 불가)
  const clsDeletable = new Set(savedClassifications || []);
  const catDeletable = new Set(savedCategories || []);
  // ESC 닫기 · Enter 매핑 저장 (모달 마운트 = 항상 열림 상태)
  useModalKeys(true, onClose, () => onMap({ dealId: dealId || undefined, classification: classification.trim() || undefined, category: category.trim() || undefined, isFixedCost: isFixed }));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bank-map-modal" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-1">거래 매핑</h3>
        <div className="text-xs text-[var(--text-muted)] mb-4">
          {tx.transaction_date} · {tx.counterparty || '알 수 없음'} · {tx.type === 'income' ? '+' : '-'}₩{Number(tx.amount).toLocaleString()}
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">프로젝트 연결</label>
            <select value={dealId} onChange={e => setDealId(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm">
              <option value="">미연결</option>
              {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">분류 <span className="text-[var(--text-dim)] font-normal">(아래 칩 클릭 또는 직접 입력)</span></label>
              <input
                list="bank-cls-options"
                value={classification}
                onChange={e => setClassification(e.target.value)}
                placeholder="예: B2B, 광고/마케팅, 인건비..."
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
              />
              <datalist id="bank-cls-options">
                {clsOptions.map((c) => <option key={c} value={c} />)}
              </datalist>
              <ChipPicker options={clsOptions} value={classification} onSelect={setClassification}
                onAddOption={(n) => onAddOption?.("classification", n)}
                onDeleteOption={(n) => onDeleteOption?.("classification", n)}
                deletable={clsDeletable} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리 <span className="text-[var(--text-dim)] font-normal">(아래 칩 클릭 또는 직접 입력)</span></label>
              <input
                list="bank-cat-options"
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="예: 고정비, 식대, 통신비..."
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
              />
              <datalist id="bank-cat-options">
                {catOptions.map((c) => <option key={c} value={c} />)}
              </datalist>
              <ChipPicker options={catOptions} value={category} onSelect={setCategory}
                onAddOption={(n) => onAddOption?.("category", n)}
                onDeleteOption={(n) => onDeleteOption?.("category", n)}
                deletable={catDeletable} />
            </div>
          </div>
          <div className="caption">💡 원하는 분류·카테고리가 없으면 직접 타이핑하세요. 다음 분류부터 자동완성·칩에 추가됩니다.</div>
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <input type="checkbox" checked={isFixed} onChange={e => setIsFixed(e.target.checked)} />
            자동이체로 표시 <span className="caption">— 자동이체(반복결제) 거래면 체크</span>
          </label>
        </div>

        <div className="flex gap-2">
          <button onClick={() => onMap({ dealId: dealId || undefined, classification: classification.trim() || undefined, category: category.trim() || undefined, isFixedCost: isFixed })}
            className="flex-1 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold">매핑 저장</button>
          <button onClick={onClose} className="px-4 py-2.5 text-[var(--text-muted)] text-sm">취소</button>
        </div>
      </div>
    </div>
  );
}

function CardMapTransactionModal({ tx, deals, classifications, existingCategories, existingClassifications, savedCategories, savedClassifications, onAddOption, onDeleteOption, onMap, onClose }: {
  tx: any;
  deals: any[];
  classifications: any[];
  existingCategories?: string[];
  existingClassifications?: string[];
  savedCategories?: string[];
  savedClassifications?: string[];
  onAddOption?: (kind: "classification" | "category", name: string) => void;
  onDeleteOption?: (kind: "classification" | "category", name: string) => void;
  onMap: (params: { dealId?: string; classification?: string; category?: string; isFixedCost?: boolean; isDeductible?: boolean }) => void;
  onClose: () => void;
}) {
  // card_transactions.classification 은 자동 VAT 분류 시 JSON 문자열 형태로 저장됨
  // ({"label":"식대","confidence":"high","reason":"..."}). 모달에는 label 만 보이게 파싱.
  const initialClassification = (() => {
    const raw = tx.classification || '';
    if (!raw || typeof raw !== 'string') return '';
    if (!raw.trim().startsWith('{')) return raw;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.label || '';
    } catch {
      return raw;
    }
  })();

  const [dealId, setDealId] = useState(tx.deal_id || '');
  const [classification, setClassification] = useState(initialClassification);
  const [category, setCategory] = useState(tx.category || '');
  const [isFixed, setIsFixed] = useState(!!tx.is_fixed_cost);
  const [isDeductible, setIsDeductible] = useState(tx.is_deductible !== false);

  const clsOptions = Array.from(new Set<string>([
    ...DEFAULT_CLASSIFICATIONS,
    ...(savedClassifications || []),
    ...(classifications.map((c: any) => c.name).filter(Boolean) as string[]),
    ...(existingClassifications || []),
  ]));
  const catOptions = Array.from(new Set<string>([
    ...DEFAULT_CATEGORIES,
    '접대비', '교통비', '식비', '사무용품',
    ...(savedCategories || []),
    ...(existingCategories || []),
  ]));
  const clsDeletable = new Set(savedClassifications || []);
  const catDeletable = new Set(savedCategories || []);
  // ESC 닫기 · Enter 매핑 저장 (모달 마운트 = 항상 열림 상태)
  useModalKeys(true, onClose, () => onMap({
    dealId: dealId || undefined,
    classification: classification.trim() || undefined,
    category: category.trim() || undefined,
    isFixedCost: isFixed,
    isDeductible,
  }));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="card-map-modal" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-1">카드 거래 매핑</h3>
        <div className="text-xs text-[var(--text-muted)] mb-4">
          {tx.transaction_date} · {tx.merchant_name || '알 수 없음'} · {Number(tx.amount) < 0 ? <span className="text-green-500">+₩{Math.abs(Number(tx.amount)).toLocaleString()} (취소/환불)</span> : `-₩${Number(tx.amount).toLocaleString()}`}
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">프로젝트 연결</label>
            <select value={dealId} onChange={e => setDealId(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm">
              <option value="">미연결</option>
              {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">분류 <span className="text-[var(--text-dim)] font-normal">(아래 칩 클릭 또는 직접 입력)</span></label>
              <input
                list="card-cls-options"
                value={classification}
                onChange={e => setClassification(e.target.value)}
                placeholder="예: B2B, 광고/마케팅, 인건비..."
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
              />
              <datalist id="card-cls-options">
                {clsOptions.map((c) => <option key={c} value={c} />)}
              </datalist>
              <ChipPicker options={clsOptions} value={classification} onSelect={setClassification}
                onAddOption={(n) => onAddOption?.("classification", n)}
                onDeleteOption={(n) => onDeleteOption?.("classification", n)}
                deletable={clsDeletable} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리 <span className="text-[var(--text-dim)] font-normal">(아래 칩 클릭 또는 직접 입력)</span></label>
              <input
                list="card-cat-options"
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="예: 식비, 교통비, 접대비..."
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
              />
              <datalist id="card-cat-options">
                {catOptions.map((c) => <option key={c} value={c} />)}
              </datalist>
              <ChipPicker options={catOptions} value={category} onSelect={setCategory}
                onAddOption={(n) => onAddOption?.("category", n)}
                onDeleteOption={(n) => onDeleteOption?.("category", n)}
                deletable={catDeletable} />
            </div>
          </div>
          <div className="caption">💡 원하는 분류·카테고리가 없으면 직접 타이핑하세요. 다음 분류부터 자동완성·칩에 추가됩니다.</div>
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <input type="checkbox" checked={isFixed} onChange={e => setIsFixed(e.target.checked)} />
              고정비로 표시 <span className="caption">— 매월 반복되는 지출이면 체크</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <input type="checkbox" checked={isDeductible} onChange={e => setIsDeductible(e.target.checked)} />
              공제 가능 <span className="caption">— 부가세 매입세액 공제 대상이면 체크</span>
            </label>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => onMap({
            dealId: dealId || undefined,
            classification: classification.trim() || undefined,
            category: category.trim() || undefined,
            isFixedCost: isFixed,
            isDeductible,
          })}
            className="flex-1 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold">매핑 저장</button>
          <button onClick={onClose} className="px-4 py-2.5 text-[var(--text-muted)] text-sm">취소</button>
        </div>
      </div>
    </div>
  );
}

function fmtW(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${Math.round(abs / 1e4).toLocaleString()}만`;
  return abs.toLocaleString();
}

const MONTH_LABELS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const CHART_H = 180;
const CHART_PAD = { top: 20, right: 16, bottom: 32, left: 16 };

function MonthlyChart({ data }: { data: MonthlyIncomeExpense[] }) {
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("tx-monthly-chart-expanded") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("tx-monthly-chart-expanded", expanded ? "1" : "0");
  }, [expanded]);
  const [visibility, setVisibility] = useState<"all" | "income" | "expense">("all");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const maxVal = Math.max(
    1,
    ...data.map(d => {
      if (visibility === "income") return d.income;
      if (visibility === "expense") return d.expense;
      return Math.max(d.income, d.expense);
    }),
  );

  const WIDTH = expanded ? 800 : 320;
  const HEIGHT = expanded ? 320 : 130;
  const PADDING_X = expanded ? 64 : 36;
  const PADDING_Y = expanded ? 24 : 14;
  const chartW = WIDTH - PADDING_X * 2;
  const chartH = HEIGHT - PADDING_Y * 2;
  const dotR = expanded ? 5 : 2.5;
  const strokeW = expanded ? 3 : 2;
  const monthFs = expanded ? 14 : 9;
  const yFs = expanded ? 12 : 8;

  function toSmoothPath(vals: number[]): string {
    if (vals.length === 0) return "";
    const points = vals.map((val, i) => ({
      x: PADDING_X + (i / Math.max(1, vals.length - 1)) * chartW,
      y: PADDING_Y + chartH - (val / maxVal) * chartH,
    }));
    if (points.length === 1) return `M${points[0].x},${points[0].y}`;
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const t = 0.18;
      const c1x = p1.x + (p2.x - p0.x) * t;
      const c1y = p1.y + (p2.y - p0.y) * t;
      const c2x = p2.x - (p3.x - p1.x) * t;
      const c2y = p2.y - (p3.y - p1.y) * t;
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }
    return d;
  }
  function toAreaPath(vals: number[]): string {
    const line = toSmoothPath(vals);
    if (!line) return "";
    const lastX = PADDING_X + chartW;
    const firstX = PADDING_X;
    const baseY = PADDING_Y + chartH;
    return `${line} L${lastX},${baseY} L${firstX},${baseY} Z`;
  }

  const incomePath = toSmoothPath(data.map(d => d.income));
  const incomeArea = toAreaPath(data.map(d => d.income));
  const expensePath = toSmoothPath(data.map(d => d.expense));
  const expenseArea = toAreaPath(data.map(d => d.expense));

  const formatKR = (n: number) => {
    if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
    if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만`;
    return n.toLocaleString();
  };

  const totalIncome = data.reduce((s, d) => s + d.income, 0);
  const totalExpense = data.reduce((s, d) => s + d.expense, 0);
  const hover = hoverIdx !== null ? data[hoverIdx] : null;
  const hoverMIdx = hover ? parseInt(hover.month.split('-')[1], 10) - 1 : 0;

  return (
    <div className="monthly-trend-chart-card glass-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-[var(--text)]">월별 입금 / 출금 추이</h3>
          <p className="text-[10px] text-[var(--text-dim)] mt-0.5">최근 6개월</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setVisibility(v => v === "income" ? "all" : "income")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition ${
              visibility === "expense" ? "opacity-40 border-[var(--border)]" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />입금
          </button>
          <button
            type="button"
            onClick={() => setVisibility(v => v === "expense" ? "all" : "expense")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition ${
              visibility === "income" ? "opacity-40 border-[var(--border)]" : "border-rose-500/30 bg-rose-500/10 text-rose-500"
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full bg-rose-500" />출금
          </button>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="ml-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-[var(--bg-surface)] hover:bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition border border-[var(--border)]"
          >
            {expanded ? "↑ 접기" : "↓ 펼치기"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl px-4 py-2.5 shadow-sm">
            <div className="text-[10px] text-emerald-500 font-semibold uppercase tracking-wider">6개월 입금</div>
            <div className="text-base font-black mt-0.5 text-emerald-500 mono-number">₩{totalIncome.toLocaleString()}</div>
          </div>
          <div className="bg-rose-500/5 border border-rose-500/15 rounded-xl px-4 py-2.5 shadow-sm">
            <div className="text-[10px] text-rose-500 font-semibold uppercase tracking-wider">6개월 출금</div>
            <div className="text-base font-black mt-0.5 text-rose-500 mono-number">₩{totalExpense.toLocaleString()}</div>
          </div>
        </div>
      )}

      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          style={{ maxHeight: expanded ? 420 : 160 }}
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
            const stepX = chartW / Math.max(1, data.length - 1);
            const idx = Math.round((px - PADDING_X) / stepX);
            if (idx >= 0 && idx < data.length) setHoverIdx(idx);
            else setHoverIdx(null);
          }}
        >
          <defs>
            <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map(r => {
            const y = PADDING_Y + chartH - r * chartH;
            return (
              <line key={r} x1={PADDING_X} x2={WIDTH - PADDING_X} y1={y} y2={y}
                stroke="var(--border)" strokeWidth={0.5} strokeDasharray={r === 0 ? "0" : "3,3"} opacity={0.5} />
            );
          })}

          {visibility !== "expense" && <path d={incomeArea} fill="url(#incomeGrad)" stroke="none" />}
          {visibility !== "income" && <path d={expenseArea} fill="url(#expenseGrad)" stroke="none" />}

          {visibility !== "expense" && (
            <path d={incomePath} fill="none" stroke="#10b981" strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {visibility !== "income" && (
            <path d={expensePath} fill="none" stroke="#f43f5e" strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
          )}

          {data.map((d, i) => {
            const x = PADDING_X + (i / Math.max(1, data.length - 1)) * chartW;
            const mIdx = parseInt(d.month.split('-')[1], 10) - 1;
            const isHover = i === hoverIdx;
            return (
              <g key={d.month}>
                {visibility !== "expense" && (
                  <circle cx={x} cy={PADDING_Y + chartH - (d.income / maxVal) * chartH}
                    r={isHover ? dotR * 1.6 : dotR} fill="#10b981"
                    stroke="var(--bg-card)" strokeWidth={isHover ? 2 : 1.2} />
                )}
                {visibility !== "income" && (
                  <circle cx={x} cy={PADDING_Y + chartH - (d.expense / maxVal) * chartH}
                    r={isHover ? dotR * 1.6 : dotR} fill="#f43f5e"
                    stroke="var(--bg-card)" strokeWidth={isHover ? 2 : 1.2} />
                )}
                <text x={x} y={HEIGHT - 4} textAnchor="middle"
                  fill={isHover ? "var(--text)" : "var(--text-dim)"}
                  fontSize={monthFs} fontWeight={isHover ? 700 : 500}>
                  {MONTH_LABELS[mIdx]}
                </text>
              </g>
            );
          })}

          {hover !== null && hoverIdx !== null && (
            <line
              x1={PADDING_X + (hoverIdx / Math.max(1, data.length - 1)) * chartW}
              x2={PADDING_X + (hoverIdx / Math.max(1, data.length - 1)) * chartW}
              y1={PADDING_Y} y2={PADDING_Y + chartH}
              stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="2,3" opacity={0.5}
            />
          )}

          <text x={PADDING_X - 6} y={PADDING_Y + 4} textAnchor="end" fill="var(--text-dim)" fontSize={yFs}>
            {formatKR(maxVal)}
          </text>
          <text x={PADDING_X - 6} y={PADDING_Y + chartH + 3} textAnchor="end" fill="var(--text-dim)" fontSize={yFs}>0</text>
        </svg>

        {hover && (
          <div
            className="absolute pointer-events-none px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] shadow-lg text-[11px] whitespace-nowrap"
            style={{
              left: `${((PADDING_X + (hoverIdx! / Math.max(1, data.length - 1)) * chartW) / WIDTH) * 100}%`,
              top: 0,
              transform: "translateX(-50%)",
            }}
          >
            <div className="font-bold text-[var(--text)] mb-1">{MONTH_LABELS[hoverMIdx]}</div>
            {visibility !== "expense" && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-[var(--text-muted)]">입금</span>
                <span className="font-bold text-emerald-500 ml-auto">₩{hover.income.toLocaleString()}</span>
              </div>
            )}
            {visibility !== "income" && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span className="text-[var(--text-muted)]">출금</span>
                <span className="font-bold text-rose-500 ml-auto">₩{hover.expense.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 pt-1 mt-1 border-t border-[var(--border)]/50">
              <span className="text-[var(--text-muted)]">순이익</span>
              <span className={`font-bold ml-auto ${hover.income - hover.expense >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                ₩{(hover.income - hover.expense).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
