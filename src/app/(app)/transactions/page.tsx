"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
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

type Tab = 'inbox' | 'all' | 'rules' | 'cards' | 'manual';
type FilterStatus = 'all' | 'unmapped' | 'auto_mapped' | 'manual_mapped' | 'ignored';
type CardFilterStatus = 'all' | 'unmapped' | 'auto_mapped' | 'manual_mapped' | 'ignored';

const BANK_TABS: Tab[] = ['inbox', 'all', 'manual', 'rules'];
const CARD_TABS: Tab[] = ['cards'];

interface TransactionsViewProps {
  initialTab?: Tab;
  visibleTabs?: Tab[];
}

export default function TransactionsPage() {
  return <TransactionsView initialTab="inbox" visibleTabs={BANK_TABS} />;
}

export function TransactionsView({ initialTab = 'inbox', visibleTabs = BANK_TABS }: TransactionsViewProps = {}) {
  const { role } = useUser();
  if (role === "employee" || role === "partner") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-[var(--text-muted)]">
        <div className="text-center">
          <p className="text-lg font-medium">접근 권한이 없습니다</p>
          <p className="text-sm mt-1">관리자에게 문의하세요</p>
        </div>
      </div>
    );
  }
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);
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
  const [cardForm, setCardForm] = useState({ card_name: '', card_number: '', card_company: '삼성', holder_name: '', monthly_limit: '' });
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
  const [codefSyncing, setCodefSyncing] = useState(false);
  const [aiClassifying, setAiClassifying] = useState(false);
  // Manual entry state
  const [manualForm, setManualForm] = useState({
    type: 'expense' as 'income' | 'expense',
    amount: '',
    counterparty: '',
    description: '',
    transaction_date: new Date().toISOString().split('T')[0],
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

  // bank_transactions 의 is_fixed_cost 토글 mutation
  const toggleFixedMut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await (supabase as any).from('bank_transactions').update({ is_fixed_cost: value }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bank-transactions'] }),
    onError: (e: any) => toast(`고정지출 변경 실패: ${e.message}`, 'error'),
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
          transaction_date: r[dateKey || ""] || new Date().toISOString().slice(0, 10),
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
      const { data: existing } = await supabase
        .from("bank_transactions")
        .select("transaction_date, amount, counterparty")
        .eq("company_id", companyId);

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
          transaction_date: r[dateKey || ""] || new Date().toISOString().slice(0, 10),
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
      const { data: existingCards } = await supabase
        .from("card_transactions")
        .select("transaction_date, amount, merchant_name")
        .eq("company_id", companyId);

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

  // Bulk VAT auto-classification for unmapped card transactions
  const [vatClassifying, setVatClassifying] = useState(false);
  const handleBulkVATClassify = useCallback(async () => {
    if (!companyId) return;
    setVatClassifying(true);
    try {
      const { data: unmapped, error } = await supabase
        .from("card_transactions")
        .select("id, merchant_name, merchant_category, amount")
        .eq("company_id", companyId)
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

  const handleAIClassify = useCallback(async () => {
    if (!companyId) return;
    setAiClassifying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { toast("로그인이 필요합니다", "error"); return; }
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/classify-transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(
          selectedIds.size > 0
            ? { transaction_ids: Array.from(selectedIds) }
            : {}
        ),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "AI 분류 실패");
      toast(`AI 분류 완료: ${result.classified}건 분류됨 (총 ${result.total}건)`, "success");
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-tx-stats"] });
      setSelectedIds(new Set());
    } catch (err: any) {
      toast(err.message || "AI 분류 실패", "error");
    } finally {
      setAiClassifying(false);
    }
  }, [companyId, selectedIds, queryClient]);

  const mapMut = useMutation({
    mutationFn: (params: { id: string; dealId?: string; classification?: string; category?: string; isFixedCost?: boolean }) =>
      mapBankTransaction(params.id, { ...params, mappedBy: userId! }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-tx-stats"] });
      setMapModal(null);
    },
    onError: (err: any) => toast("거래 매핑 실패: " + (err?.message || "알 수 없는 오류"), "error"),
  });

  const ignoreMut = useMutation({
    mutationFn: (id: string) => ignoreBankTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-tx-stats"] });
    },
    onError: (err: any) => toast("거래 무시 실패: " + (err?.message || "알 수 없는 오류"), "error"),
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
    onError: (err: any) => toast("분류 규칙 저장 실패: " + (err?.message || "알 수 없는 오류"), "error"),
  });

  const deleteRuleMut = useMutation({
    mutationFn: (id: string) => deleteClassificationRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["classification-rules"] }),
    onError: (err: any) => toast("분류 규칙 삭제 실패: " + (err?.message || "알 수 없는 오류"), "error"),
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
    onError: (err: any) => toast("카드 거래 매핑 실패: " + (err?.message || "알 수 없는 오류"), "error"),
  });

  const cardIgnoreMut = useMutation({
    mutationFn: (id: string) => ignoreCardTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["card-tx-stats"] });
    },
    onError: (err: any) => toast("카드 거래 무시 실패: " + (err?.message || "알 수 없는 오류"), "error"),
  });

  const cardRestoreMut = useMutation({
    mutationFn: (id: string) => restoreCardTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["card-tx-stats"] });
    },
    onError: (err: any) => toast("카드 거래 복원 실패: " + (err?.message || "알 수 없는 오류"), "error"),
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
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["corporate-cards"] });
      setShowCardForm(false);
      setEditingCard(null);
      setCardForm({ card_name: '', card_number: '', card_company: '삼성', holder_name: '', monthly_limit: '' });
    },
    onError: (err: any) => toast("법인카드 저장 실패: " + (err?.message || "알 수 없는 오류"), "error"),
  });

  const deleteCardMut = useMutation({
    mutationFn: (id: string) => deleteCorporateCard(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["corporate-cards"] }),
    onError: (err: any) => toast("법인카드 삭제 실패: " + (err?.message || "알 수 없는 오류"), "error"),
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
  const filteredBankTx = (() => {
    let xs = bankTx as any[];
    if (selectedAccountNo) {
      xs = xs.filter((tx: any) => tx.raw_data?.accountNo === selectedAccountNo);
    }
    if (showFixedOnly) {
      xs = xs.filter((tx: any) => tx.is_fixed_cost === true);
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
        return String(a.transaction_date || '').localeCompare(String(b.transaction_date || '')) * dir;
      }
      return String(a.counterparty || '').localeCompare(String(b.counterparty || ''), 'ko') * dir;
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
    <div className="max-w-[1100px]">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold">거래내역</h1>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">은행 거래 자동 수집 + 딜/분류 매핑</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
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
                  const synced = syncType === 'bank' ? (result.bankSynced ?? 0) : (result.cardSynced ?? 0);
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
                toast(e.message || '오류', 'error');
              } finally {
                setCodefSyncing(false);
              }
            }}
            disabled={codefSyncing || !companyId}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50 whitespace-nowrap"
          >
            {codefSyncing ? '동기화 중...' : 'CODEF 동기화'}
          </button>
          <button
            onClick={handleAIClassify}
            disabled={aiClassifying || !companyId}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50 whitespace-nowrap"
          >
            {aiClassifying ? (
              <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> 분류 중...</>
            ) : (
              <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg> AI 자동분류{selectedIds.size > 0 ? ` (${selectedIds.size}건)` : ""}</>
            )}
          </button>
          <button
            onClick={async () => {
              const { exportBankTransactionsDouzone } = await import("@/lib/export-douzone");
              exportBankTransactionsDouzone(filteredBankTx as any);
            }}
            disabled={filteredBankTx.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-surface)] hover:bg-[var(--bg)] text-[var(--text)] rounded-lg text-xs font-semibold transition border border-[var(--border)] disabled:opacity-50 whitespace-nowrap"
            title="현재 보이는 거래내역을 더존 양식 CSV 로 다운로드"
          >
            📄 더존 CSV
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="px-3 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs sm:text-sm font-semibold transition disabled:opacity-50 whitespace-nowrap">
            {uploading ? "업로드 중..." : "CSV 업로드"}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-2 mb-4">
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
            a.download = `거래내역_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] text-sm rounded-xl font-semibold transition"
        >
          CSV 내보내기
        </button>
      </div>

      {uploadResult && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${uploadResult.startsWith("오류") ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
          {uploadResult}
          <button onClick={() => setUploadResult(null)} className="ml-2 opacity-60 hover:opacity-100">x</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <StatCard label="전체" value={s.total} />
        <StatCard label="미매핑" value={s.unmapped} color={s.unmapped > 0 ? 'var(--warning)' : 'var(--success)'} />
        <StatCard label="자동매핑" value={s.autoMapped} color="var(--primary)" />
        <StatCard label="총 입금" value={`₩${fmtW(s.totalIncome)}`} color="var(--success)" />
        <StatCard label="총 출금" value={`₩${fmtW(s.totalExpense)}`} color="var(--danger)" />
      </div>

      {/* Monthly Income/Expense Chart + Category Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="md:col-span-2">
          {monthlyData.length > 0 && <MonthlyChart data={monthlyData} />}
        </div>
        {categoryEntries.length > 0 && (
          <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)]">
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

      {/* Tabs — visibleTabs 길이가 1 이하면 탭 UI 자체 숨김 (단일 view) */}
      {visibleTabs.length > 1 && (
        <div className="flex items-center gap-1 mb-4 border-b border-[var(--border)] overflow-x-auto scrollbar-hide">
          {(([['inbox', `Inbox (${s.unmapped})`], ['all', '전체'], ['manual', '수기 입력'], ['rules', '분류 규칙'], ['cards', '법인카드']] as [Tab, string][])
            .filter(([t]) => visibleTabs.includes(t))
          ).map(([t, label]) => (
            <button key={t} onClick={() => { setTab(t); if (t === 'inbox') setFilterStatus('unmapped'); else if (t === 'all') setFilterStatus('all'); }}
              className={`px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold transition border-b-2 -mb-px whitespace-nowrap ${
                tab === t ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Manual Entry Tab */}
      {tab === 'manual' && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
            <h3 className="text-sm font-bold mb-4">거래내역 직접 등록</h3>
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
                <input type="date" value={manualForm.transaction_date} onChange={e => setManualForm(f => ({ ...f, transaction_date: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">금액 (원) *</label>
                <input type="text" inputMode="numeric" value={manualForm.amount ? Number(manualForm.amount).toLocaleString("ko-KR") : ""} onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); setManualForm(f => ({ ...f, amount: v })); }}
                  placeholder="1,500,000" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-right font-mono focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">거래처</label>
                <input value={manualForm.counterparty} onChange={e => setManualForm(f => ({ ...f, counterparty: e.target.value }))}
                  placeholder="(주)모티브" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">적요/설명</label>
                <input value={manualForm.description} onChange={e => setManualForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="서비스 용역대금" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">카테고리</label>
                <select value={manualForm.category} onChange={e => setManualForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
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
                  placeholder="국민은행, 신한카드 등" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">메모</label>
                <input value={manualForm.memo} onChange={e => setManualForm(f => ({ ...f, memo: e.target.value }))}
                  placeholder="비고" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
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
                  const db = supabase as any;
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
                  const { data: entries } = await db.from('transactions').select('*').eq('company_id', companyId).eq('source', 'manual').order('transaction_date', { ascending: false }).limit(50);
                  setManualEntries(entries || []);
                } catch (err: any) {
                  toast(`등록 실패: ${err.message}`, 'error');
                }
                setManualSaving(false);
              }}
              disabled={manualSaving || !companyId}
              className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
            >
              {manualSaving ? '저장 중...' : '거래내역 등록'}
            </button>
          </div>

          {/* Recently added manual entries */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">수기 입력 내역</h3>
              <button onClick={async () => {
                if (!companyId) return;
                const db = supabase as any;
                const { data } = await db.from('transactions').select('*').eq('company_id', companyId).eq('source', 'manual').order('transaction_date', { ascending: false }).limit(50);
                setManualEntries(data || []);
              }} className="text-xs text-[var(--primary)] font-semibold">새로고침</button>
            </div>
            {manualEntries.length === 0 ? (
              <p className="text-center py-6 text-sm text-[var(--text-muted)]">수기 입력된 거래가 없습니다. 위에서 거래를 등록하세요.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-[var(--bg-card)] shadow-[0_1px_0_0_var(--border)]"><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-2 py-2">날짜</th><th className="text-left px-2 py-2">구분</th>
                    <th className="text-right px-2 py-2">금액</th><th className="text-left px-2 py-2">거래처</th>
                    <th className="text-left px-2 py-2">적요</th><th className="text-left px-2 py-2">카테고리</th>
                  </tr></thead>
                  <tbody>
                    {manualEntries.map((tx: any) => (
                      <tr key={tx.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition">
                        <td className="px-2 py-2 text-xs">{tx.transaction_date}</td>
                        <td className="px-2 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${tx.type === 'income' ? 'bg-blue-500/10 text-blue-500' : 'bg-red-500/10 text-red-500'}`}>{tx.type === 'income' ? '입금' : '출금'}</span></td>
                        <td className="px-2 py-2 text-right font-mono text-xs">{Math.abs(Number(tx.amount)).toLocaleString()}원</td>
                        <td className="px-2 py-2 text-xs">{tx.counterparty || '-'}</td>
                        <td className="px-2 py-2 text-xs text-[var(--text-muted)]">{tx.description || '-'}</td>
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
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-dim)]">거래처/적요 패턴 매칭으로 자동 분류합니다. n8n에서 수집된 거래도 이 규칙을 적용합니다.</p>
            <button onClick={() => setShowRuleForm(!showRuleForm)} className="text-xs text-[var(--primary)] font-semibold">+ 규칙 추가</button>
          </div>

          {showRuleForm && (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 space-y-3">
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
                  <label className="block text-xs text-[var(--text-muted)] mb-1">딜 연결</label>
                  <select value={ruleForm.assign_deal_id} onChange={e => setRuleForm({ ...ruleForm, assign_deal_id: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                    <option value="">미연결</option>
                    {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <input type="checkbox" checked={ruleForm.is_fixed_cost} onChange={e => setRuleForm({ ...ruleForm, is_fixed_cost: e.target.checked })} />
                고정비로 표시
              </label>
              <div className="flex gap-2">
                <button onClick={() => ruleForm.rule_name && ruleForm.match_value && addRuleMut.mutate()}
                  disabled={!ruleForm.rule_name || !ruleForm.match_value}
                  className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50">추가</button>
                <button onClick={() => setShowRuleForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-xs">취소</button>
              </div>
            </div>
          )}

          {rules.length === 0 ? (
            <div className="text-center py-10 text-sm text-[var(--text-muted)]">분류 규칙이 없습니다. 규칙을 추가하면 거래가 자동으로 분류됩니다.</div>
          ) : (
            <div className="space-y-2">
              {rules.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{r.rule_name}</span>
                      {r.is_fixed_cost && <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">고정비</span>}
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
          {/* ═══ 메인: 통장 잔액 + 다가오는 자동이체 ═══ */}
          {/* 통장별 잔액 카드 + 총잔액 */}
          {bankAccountsList.length > 0 && (
            <div className="mb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <div className="col-span-2 sm:col-span-1 lg:col-span-1 bg-gradient-to-br from-[var(--primary)]/15 to-[var(--primary)]/5 rounded-xl p-3 border border-[var(--primary)]/20">
                <div className="text-[10px] text-[var(--primary)] font-semibold uppercase tracking-wider">총 잔액</div>
                <div className="text-lg font-black mt-1 mono-number">
                  ₩{bankAccountsList.reduce((s, a) => s + (a.balance || 0), 0).toLocaleString()}
                </div>
                <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{bankAccountsList.length}개 통장</div>
              </div>
              {bankAccountsList.slice(0, 8).map((a) => {
                const display = a.alias || (a.accountNo.length >= 12
                  ? `${a.accountNo.slice(0,3)}-${a.accountNo.slice(3,9)}-${a.accountNo.slice(9,11)}-${a.accountNo.slice(11)}`
                  : a.accountNo);
                const isSelected = selectedAccountNo === a.accountNo;
                return (
                  <button
                    key={a.accountNo}
                    onClick={() => setSelectedAccountNo(isSelected ? '' : a.accountNo)}
                    className={`text-left rounded-xl p-3 border transition ${
                      isSelected
                        ? 'bg-[var(--primary)]/10 border-[var(--primary)]/40 ring-1 ring-[var(--primary)]/30'
                        : 'bg-[var(--bg-card)] border-[var(--border)] hover:bg-[var(--bg-surface)]'
                    }`}
                    title={`클릭해서 ${isSelected ? '해제' : '필터'}`}
                  >
                    <div className="text-[10px] text-[var(--text-dim)] truncate">{a.bankName || ''}</div>
                    <div className="text-[11px] font-semibold mono-number truncate">{display}</div>
                    <div className="text-sm font-bold mono-number mt-1">₩{(a.balance || 0).toLocaleString()}</div>
                    <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{a.count}건</div>
                  </button>
                );
              })}
            </div>
          )}

          {/* 메인 카드 2열 — 다가오는 자동이체 + 이번달 큰 지출 TOP5 (엑셀 다운로드) */}
          {companyId && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <UpcomingAutoTransfersCard companyId={companyId} />
              <TopExpensesThisMonth companyId={companyId} />
            </div>
          )}

          {/* ═══ 아래: 거래내역 검색·필터 + 차트 ═══ */}
          {/* 통장 + 날짜 필터 — codef sync 결과 분류 */}
          {bankAccountsList.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3 p-3 bg-[var(--bg-surface)] rounded-xl">
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
              <input
                type="date"
                value={bankDateFrom}
                onChange={e => setBankDateFrom(e.target.value)}
                className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)]"
                aria-label="시작일"
              />
              <span className="text-xs text-[var(--text-dim)]">~</span>
              <input
                type="date"
                value={bankDateTo}
                onChange={e => setBankDateTo(e.target.value)}
                className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)]"
                aria-label="종료일"
              />
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text)] ml-2">
                <input
                  type="checkbox"
                  checked={showFixedOnly}
                  onChange={e => setShowFixedOnly(e.target.checked)}
                  className="accent-[var(--primary)]"
                />
                고정지출만
              </label>
              {(selectedAccountNo || bankDateFrom || bankDateTo || showFixedOnly) && (
                <button
                  onClick={() => { setSelectedAccountNo(''); setBankDateFrom(''); setBankDateTo(''); setShowFixedOnly(false); }}
                  className="px-2 py-1.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]"
                >초기화</button>
              )}
              <span className="ml-auto text-[10px] text-[var(--text-dim)]">
                {filteredBankTx.length}건 표시 / 전체 {bankTx.length}건
                {showFixedOnly || filteredBankTx.some((t: any) => t.is_fixed_cost) ? (
                  <> · 고정지출 합계 ₩{filteredBankTx.filter((t: any) => t.is_fixed_cost && t.type === 'expense').reduce((s: number, t: any) => s + Number(t.amount || 0), 0).toLocaleString()}</>
                ) : null}
              </span>
            </div>
          )}

          {/* Filter pills */}
          {tab === 'all' && (
            <div className="flex items-center gap-2 mb-3">
              {([['all', '전체'], ['unmapped', '미매핑'], ['auto_mapped', '자동'], ['manual_mapped', '수동'], ['ignored', '무시']] as [FilterStatus, string][]).map(([f, label]) => (
                <button key={f} onClick={() => setFilterStatus(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${filterStatus === f ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}>
                  {label}
                </button>
              ))}
              <div className="ml-auto flex gap-1">
                {['', 'income', 'expense'].map(t => (
                  <button key={t} onClick={() => setFilterType(t)}
                    className={`px-2 py-1 rounded text-[10px] font-semibold ${filterType === t ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'text-[var(--text-dim)]'}`}>
                    {t === '' ? '전체' : t === 'income' ? '입금' : '출금'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            {isLoading ? (
              <div className="p-10 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>
            ) : filteredBankTx.length === 0 ? (
              <div className="p-16 text-center">
                <div className="text-4xl mb-4">{tab === 'inbox' ? '✅' : '🏦'}</div>
                <div className="text-sm font-medium text-[var(--text)]">{tab === 'inbox' ? '처리할 거래가 없습니다' : searchQuery ? '검색 결과가 없습니다' : '은행 거래내역을 연결하면 자동 분류가 시작됩니다'}</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  {tab === 'inbox' ? '모든 거래가 분류되었습니다.' : searchQuery ? '다른 키워드로 검색해보세요.' : 'CSV를 업로드하거나 n8n 자동 수집을 설정하세요'}
                </div>
              </div>
            ) : (
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[800px]">
                <thead className="sticky top-0 z-10 bg-[var(--bg-card)] shadow-[0_1px_0_0_var(--border)]">
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    {tab === 'inbox' && <th className="text-center px-2 py-3 font-medium w-8">
                      <input type="checkbox"
                        checked={selectedIds.size > 0 && selectedIds.size === filteredBankTx.filter((t: any) => t.mapping_status === 'unmapped').length}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedIds(new Set(filteredBankTx.filter((t: any) => t.mapping_status === 'unmapped').map((t: any) => t.id)));
                          } else {
                            setSelectedIds(new Set());
                          }
                        }}
                        className="accent-[var(--primary)]"
                      />
                    </th>}
                    <th
                      onClick={() => toggleBankSort('transaction_date')}
                      className="text-left px-4 py-3 font-medium cursor-pointer select-none hover:text-[var(--text)] transition"
                      title="클릭해서 날짜 정렬"
                    >
                      날짜 {bankSortBy === 'transaction_date' ? (bankSortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th className="text-left px-4 py-3 font-medium">통장</th>
                    <th
                      onClick={() => toggleBankSort('counterparty')}
                      className="text-left px-4 py-3 font-medium cursor-pointer select-none hover:text-[var(--text)] transition"
                      title="클릭해서 거래처 이름순 정렬"
                    >
                      거래처 {bankSortBy === 'counterparty' ? (bankSortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th className="text-left px-4 py-3 font-medium">적요</th>
                    <th className="text-right px-4 py-3 font-medium">금액</th>
                    <th className="text-right px-4 py-3 font-medium hidden md:table-cell">잔액</th>
                    <th className="text-center px-4 py-3 font-medium" title="고정지출">고정</th>
                    <th className="text-center px-4 py-3 font-medium">상태</th>
                    <th className="text-center px-4 py-3 font-medium">분류</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBankTx.map((tx: any) => (
                    <tr
                      key={tx.id}
                      onClick={() => setMapModal(tx)}
                      className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition cursor-pointer"
                      title="클릭해서 분류·매핑"
                    >
                      {tab === 'inbox' && tx.mapping_status === 'unmapped' && (
                        <td className="text-center px-2 py-2.5 w-8" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.has(tx.id)}
                            onChange={e => {
                              const next = new Set(selectedIds);
                              if (e.target.checked) next.add(tx.id); else next.delete(tx.id);
                              setSelectedIds(next);
                            }}
                            className="accent-[var(--primary)]"
                          />
                        </td>
                      )}
                      {tab === 'inbox' && tx.mapping_status !== 'unmapped' && <td className="w-8" />}
                      <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] mono-number">{tx.transaction_date}</td>
                      <td className="px-4 py-2.5 text-[10px] text-[var(--text-dim)] mono-number whitespace-nowrap">
                        {tx.bank_accounts?.alias || tx.raw_data?.accountNo?.slice(-4) || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-sm">{tx.counterparty || "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] max-w-[180px] truncate">{tx.description || "—"}</td>
                      <td className={`px-4 py-2.5 text-sm text-right font-medium mono-number ${tx.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                        {tx.type === 'income' ? '+' : '-'}₩{Number(tx.amount).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-right text-[var(--text-muted)] mono-number hidden md:table-cell">
                        ₩{Number(tx.balance_after || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={!!tx.is_fixed_cost}
                          onChange={e => toggleFixedMut.mutate({ id: tx.id, value: e.target.checked })}
                          disabled={toggleFixedMut.isPending}
                          className="accent-orange-500 cursor-pointer"
                          title={tx.is_fixed_cost ? '고정지출 — 클릭해서 해제' : '고정지출로 표시'}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          tx.mapping_status === 'unmapped' ? 'bg-yellow-500/10 text-yellow-400' :
                          tx.mapping_status === 'auto_mapped' ? 'bg-blue-500/10 text-blue-400' :
                          tx.mapping_status === 'manual_mapped' ? 'bg-green-500/10 text-green-400' :
                          'bg-gray-500/10 text-gray-400'
                        }`}>
                          {tx.mapping_status === 'unmapped' ? '미매핑' :
                           tx.mapping_status === 'auto_mapped' ? '자동' :
                           tx.mapping_status === 'manual_mapped' ? '수동' : '무시'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          {tx.classification && <ClassificationBadge classification={tx.classification} />}
                          {tx.category && (
                            <span className="text-[10px] text-[var(--text-muted)]">{tx.category}</span>
                          )}
                          {tx.deals?.name && (
                            <span className="text-[9px] text-[var(--text-dim)]">{tx.deals.name}</span>
                          )}
                          {!tx.classification && !tx.category && !tx.deals?.name && (
                            <span className="text-[10px] text-[var(--text-dim)]">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </>
      )}

      {/* Cards Tab */}
      {tab === 'cards' && (
        <div className="space-y-4">
          {/* Card Query Error */}
          {cardError && (
            <div className="p-3 rounded-lg text-sm bg-red-500/10 text-red-400">
              카드 거래 데이터를 불러올 수 없습니다. 새로고침해 주세요.
            </div>
          )}
          {/* Card Upload Result */}
          {cardUploadResult && (
            <div className={`p-3 rounded-lg text-sm ${cardUploadResult.startsWith("오류") ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
              {cardUploadResult}
              <button onClick={() => setCardUploadResult(null)} className="ml-2 opacity-60 hover:opacity-100">x</button>
            </div>
          )}

          {/* Card Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="총 사용액" value={`₩${fmtW(cs.totalSpent)}`} color="var(--danger)" />
            <StatCard label="공제 가능" value={`₩${fmtW(cs.deductible)}`} color="var(--success)" />
            <StatCard label="공제 불가" value={`₩${fmtW(cs.nonDeductible)}`} color="var(--warning)" />
            <StatCard label="미매핑" value={cs.unmapped} color={cs.unmapped > 0 ? 'var(--warning)' : 'var(--success)'} />
          </div>

          {/* Card 별 사용액 (CODEF sync 거래) */}
          {codefCards.length > 0 && (() => {
            // 끝번호(숫자4자리) 없이 카드사명만 있는 항목 = CODEF 응답에 카드 식별자 없는 미식별 거래 묶음.
            // 사용자가 어떤 카드인지 알 수 없으므로 경고 + 클릭해서 안의 거래 확인 가능하게 안내.
            const isUnidentified = (name: string) => !/\d{4}\s*$/.test(name);
            const unidentifiedCards = codefCards.filter((c: any) => isUnidentified(c.card_name));
            const unidentifiedCount = unidentifiedCards.reduce((s: number, c: any) => s + Number(c.count || 0), 0);
            return (
              <div>
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
                  <div className="mb-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/30 text-xs text-amber-600">
                    <div className="font-semibold mb-0.5">⚠️ 카드 식별자 미확인 거래 {unidentifiedCount.toLocaleString()}건</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      CODEF 응답에 카드 끝번호가 없는 거래입니다. 같은 카드사 여러 카드 거래가 한 묶음으로 표시됩니다.
                      해당 카드 항목을 클릭해 거래를 확인하고 필요 시 수동으로 카드 매핑하세요.
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {codefCards.map((c: any) => {
                    const unid = isUnidentified(c.card_name);
                    const displayName = c.alias || c.card_name;
                    return (
                      <div
                        key={c.card_name}
                        className={`relative group p-3 rounded-xl border text-left transition cursor-pointer ${
                          selectedCardName === c.card_name
                            ? 'bg-[var(--primary)]/10 border-[var(--primary)]'
                            : unid
                              ? 'bg-amber-500/5 border-amber-500/30 hover:border-amber-500/60'
                              : 'bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--primary)]/50'
                        }`}
                        onClick={() => setSelectedCardName(selectedCardName === c.card_name ? '' : c.card_name)}
                        title={unid ? '⚠️ 카드 식별자 미확인 — 같은 카드사 여러 카드 거래가 묶여 있을 수 있습니다' : undefined}
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
                          {unid && <span className="text-[10px]">⚠️</span>}
                          <div className="text-xs font-bold text-[var(--text)] truncate">{displayName}</div>
                        </div>
                        {c.alias && (
                          <div className="text-[10px] text-[var(--text-dim)] truncate" title={c.card_name}>
                            {c.card_name}
                          </div>
                        )}
                        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          {c.count.toLocaleString()}건{unid && <span className="ml-1 text-amber-600">· 미식별</span>}
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
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <select value={selectedCardId} onChange={e => { setSelectedCardId(e.target.value); if (e.target.value) setSelectedCardName(''); }}
              className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm w-full sm:w-auto sm:min-w-[200px]">
              <option value="">전체 카드 (등록된)</option>
              {corpCards.map((c: any) => (
                <option key={c.id} value={c.id}>{c.card_name} ({c.card_company})</option>
              ))}
            </select>

            <input type="date" value={cardDateFrom} onChange={e => setCardDateFrom(e.target.value)}
              className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs" placeholder="시작일" />
            <input type="date" value={cardDateTo} onChange={e => setCardDateTo(e.target.value)}
              className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs" placeholder="종료일" />

            <div className="ml-auto flex gap-2">
              <input ref={cardFileRef} type="file" accept=".csv" onChange={handleCardCSVUpload} className="hidden" />
              <button onClick={() => cardFileRef.current?.click()} disabled={cardUploading}
                className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] text-sm rounded-xl font-semibold transition disabled:opacity-50">
                {cardUploading ? "업로드 중..." : "카드 CSV"}
              </button>
              <button onClick={handleBulkVATClassify} disabled={vatClassifying}
                className="px-3 py-2 bg-emerald-600/10 border border-emerald-600/30 hover:border-emerald-500 text-emerald-400 text-sm rounded-xl font-semibold transition disabled:opacity-50">
                {vatClassifying ? "분류 중..." : "VAT 자동분류"}
              </button>
              <button onClick={() => { setEditingCard(null); setCardForm({ card_name: '', card_number: '', card_company: '삼성', holder_name: '', monthly_limit: '' }); setShowCardForm(true); }}
                className="px-3 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-sm rounded-xl font-semibold transition">
                + 카드 등록
              </button>
            </div>
          </div>

          {/* Card Filter Pills */}
          <div className="flex items-center gap-2">
            {([['all', '전체'], ['unmapped', '미매핑'], ['auto_mapped', '자동'], ['manual_mapped', '수동'], ['ignored', '무시']] as [CardFilterStatus, string][]).map(([f, label]) => (
              <button key={f} onClick={() => setCardFilterStatus(f)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${cardFilterStatus === f ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Registered Cards List */}
          {corpCards.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {corpCards.map((c: any) => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-card)] rounded-xl border border-[var(--border)] text-xs">
                  <span className="font-semibold">{c.card_name}</span>
                  <span className="text-[var(--text-dim)]">{c.card_company}</span>
                  {c.card_number && <span className="text-[var(--text-dim)]">****{c.card_number.slice(-4)}</span>}
                  {c.holder_name && <span className="text-[var(--text-dim)]">{c.holder_name}</span>}
                  <button onClick={() => {
                    setEditingCard(c);
                    setCardForm({ card_name: c.card_name, card_number: c.card_number || '', card_company: c.card_company, holder_name: c.holder_name || '', monthly_limit: c.monthly_limit ? String(c.monthly_limit) : '' });
                    setShowCardForm(true);
                  }} className="text-[var(--primary)] hover:underline">수정</button>
                  <button onClick={() => { if (confirm('이 카드를 삭제하시겠습니까?')) deleteCardMut.mutate(c.id); }}
                    className="text-red-400/60 hover:text-red-400">삭제</button>
                </div>
              ))}
            </div>
          )}

          {/* Card Transactions Table */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            {cardTxLoading ? (
              <div className="p-10 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>
            ) : cardTx.length === 0 ? (
              <div className="p-16 text-center">
                <div className="text-4xl mb-4">💳</div>
                <div className="text-lg font-bold mb-2">카드 거래내역이 없습니다</div>
                <div className="text-sm text-[var(--text-muted)]">카드를 등록하고 CSV를 업로드하세요.</div>
              </div>
            ) : (
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-4 py-3 font-medium">날짜</th>
                    <th className="text-left px-4 py-3 font-medium">가맹점</th>
                    <th className="text-right px-4 py-3 font-medium">금액</th>
                    <th className="text-center px-4 py-3 font-medium">카테고리</th>
                    <th className="text-center px-4 py-3 font-medium">상태</th>
                    <th className="text-center px-4 py-3 font-medium">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {cardTx.map((tx: any) => (
                    <tr key={tx.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition">
                      <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] mono-number">{tx.transaction_date}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-sm">{tx.merchant_name || "---"}</div>
                        <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                          {tx.card_name || tx.corporate_cards?.card_name || "카드 미지정"}
                          {tx.corporate_cards?.card_company && ` · ${tx.corporate_cards.card_company}`}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right font-medium mono-number text-red-400">
                        -₩{Number(tx.amount).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {tx.merchant_category && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)]">{tx.merchant_category}</span>}
                        {tx.category && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ml-1 ${tx.is_deductible ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                            {(() => { try { const c = JSON.parse(tx.classification || '{}'); return c.label || tx.category; } catch { return tx.category; } })()}
                          </span>
                        )}
                        {tx.is_deductible === true && !tx.category && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 ml-1">공제</span>}
                        {tx.is_deductible === false && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 ml-1">불공제</span>}
                        {tx.receipt_url && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 ml-1">영수증</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          tx.mapping_status === 'unmapped' ? 'bg-yellow-500/10 text-yellow-400' :
                          tx.mapping_status === 'auto_mapped' ? 'bg-blue-500/10 text-blue-400' :
                          tx.mapping_status === 'manual_mapped' ? 'bg-green-500/10 text-green-400' :
                          'bg-gray-500/10 text-gray-400'
                        }`}>
                          {tx.mapping_status === 'unmapped' ? '미매핑' :
                           tx.mapping_status === 'auto_mapped' ? '자동' :
                           tx.mapping_status === 'manual_mapped' ? '수동' : '무시'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {tx.mapping_status === 'unmapped' && (
                            <>
                              <button onClick={() => setCardMapModal(tx)}
                                className="px-2 py-1 rounded text-[10px] font-semibold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition">
                                매핑
                              </button>
                              <button onClick={() => cardIgnoreMut.mutate(tx.id)}
                                className="px-2 py-1 rounded text-[10px] text-[var(--text-dim)] hover:text-[var(--text-muted)] transition">
                                무시
                              </button>
                            </>
                          )}
                          {(tx.mapping_status === 'ignored' || tx.mapping_status === 'manual_mapped' || tx.mapping_status === 'auto_mapped') && (
                            <button onClick={() => cardRestoreMut.mutate(tx.id)}
                              className="px-2 py-1 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition"
                              title="미매핑 상태로 되돌리기">
                              복원
                            </button>
                          )}
                          <input ref={receiptFileRef} type="file" accept="image/*,.pdf" className="hidden"
                            onChange={(e) => handleReceiptUpload(tx.id, e)} />
                          <button onClick={() => {
                            // Create a unique file input for this transaction
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*,.pdf';
                            input.onchange = (ev) => handleReceiptUpload(tx.id, ev as any);
                            input.click();
                          }}
                            disabled={receiptUploadingId === tx.id}
                            className="px-2 py-1 rounded text-[10px] text-[var(--text-dim)] hover:text-[var(--text-muted)] transition disabled:opacity-50">
                            {receiptUploadingId === tx.id ? '...' : tx.receipt_url ? '📎' : '영수증'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {/* Card Add/Edit Modal */}
      {showCardForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCardForm(false)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 w-[480px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-4">{editingCard ? '카드 수정' : '법인카드 등록'}</h3>
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
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
      <div className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-sm font-black mono-number" style={{ color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}

function MapTransactionModal({ tx, deals, classifications, onMap, onClose }: {
  tx: any;
  deals: any[];
  classifications: any[];
  onMap: (params: { dealId?: string; classification?: string; category?: string; isFixedCost?: boolean }) => void;
  onClose: () => void;
}) {
  const [dealId, setDealId] = useState('');
  const [classification, setClassification] = useState('');
  const [category, setCategory] = useState('');
  const [isFixed, setIsFixed] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 w-[480px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-1">거래 매핑</h3>
        <div className="text-xs text-[var(--text-muted)] mb-4">
          {tx.transaction_date} · {tx.counterparty || '알 수 없음'} · {tx.type === 'income' ? '+' : '-'}₩{Number(tx.amount).toLocaleString()}
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">딜 연결</label>
            <select value={dealId} onChange={e => setDealId(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm">
              <option value="">미연결</option>
              {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">분류</label>
              <select value={classification} onChange={e => setClassification(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm">
                <option value="">미지정</option>
                {classifications.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm">
                <option value="">미지정</option>
                <option value="고정비">고정비</option>
                <option value="변동비">변동비</option>
                <option value="매출">매출</option>
                <option value="기타">기타</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <input type="checkbox" checked={isFixed} onChange={e => setIsFixed(e.target.checked)} />
            고정비로 표시
          </label>
        </div>

        <div className="flex gap-2">
          <button onClick={() => onMap({ dealId: dealId || undefined, classification: classification || undefined, category: category || undefined, isFixedCost: isFixed })}
            className="flex-1 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold">매핑 저장</button>
          <button onClick={onClose} className="px-4 py-2.5 text-[var(--text-muted)] text-sm">취소</button>
        </div>
      </div>
    </div>
  );
}

function CardMapTransactionModal({ tx, deals, classifications, onMap, onClose }: {
  tx: any;
  deals: any[];
  classifications: any[];
  onMap: (params: { dealId?: string; classification?: string; category?: string; isFixedCost?: boolean; isDeductible?: boolean }) => void;
  onClose: () => void;
}) {
  const [dealId, setDealId] = useState('');
  const [classification, setClassification] = useState('');
  const [category, setCategory] = useState('');
  const [isFixed, setIsFixed] = useState(false);
  const [isDeductible, setIsDeductible] = useState(true);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 w-[480px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-1">카드 거래 매핑</h3>
        <div className="text-xs text-[var(--text-muted)] mb-4">
          {tx.transaction_date} · {tx.merchant_name || '알 수 없음'} · -₩{Number(tx.amount).toLocaleString()}
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">딜 연결</label>
            <select value={dealId} onChange={e => setDealId(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm">
              <option value="">미연결</option>
              {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">분류</label>
              <select value={classification} onChange={e => setClassification(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm">
                <option value="">미지정</option>
                {classifications.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm">
                <option value="">미지정</option>
                <option value="고정비">고정비</option>
                <option value="변동비">변동비</option>
                <option value="접대비">접대비</option>
                <option value="교통비">교통비</option>
                <option value="식비">식비</option>
                <option value="사무용품">사무용품</option>
                <option value="기타">기타</option>
              </select>
            </div>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <input type="checkbox" checked={isFixed} onChange={e => setIsFixed(e.target.checked)} />
              고정비로 표시
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <input type="checkbox" checked={isDeductible} onChange={e => setIsDeductible(e.target.checked)} />
              공제 가능
            </label>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => onMap({
            dealId: dealId || undefined,
            classification: classification || undefined,
            category: category || undefined,
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
    <div className="mb-5 bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-surface)]/40 rounded-2xl border border-[var(--border)] p-5 shadow-sm">
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
          <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl px-4 py-2.5">
            <div className="text-[10px] text-emerald-500 font-semibold uppercase tracking-wider">6개월 입금</div>
            <div className="text-base font-black mt-0.5 text-emerald-500 mono-number">₩{totalIncome.toLocaleString()}</div>
          </div>
          <div className="bg-rose-500/5 border border-rose-500/15 rounded-xl px-4 py-2.5">
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
