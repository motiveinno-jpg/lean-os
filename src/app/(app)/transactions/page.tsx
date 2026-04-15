"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, getBankTransactions, getBankTransactionStats, getMonthlyIncomeExpense, mapBankTransaction, ignoreBankTransaction, getDeals, getDealClassifications, getClassificationRules, upsertClassificationRule, deleteClassificationRule } from "@/lib/queries";
import type { MonthlyIncomeExpense } from "@/lib/queries";
import { getCorporateCards, upsertCorporateCard, deleteCorporateCard, getCardTransactions, getCardTransactionStats, mapCardTransaction, ignoreCardTransaction, uploadReceiptToCard } from "@/lib/card-transactions";
import { classifyCardTransaction, batchSaveVATClassifications } from "@/lib/card-vat-classification";
import { ClassificationBadge } from "@/components/classification-badge";
import { QueryErrorBanner } from "@/components/query-status";
import { useToast } from "@/components/toast";

type Tab = 'inbox' | 'all' | 'rules' | 'cards' | 'manual';
type FilterStatus = 'all' | 'unmapped' | 'auto_mapped' | 'manual_mapped' | 'ignored';
type CardFilterStatus = 'all' | 'unmapped' | 'auto_mapped' | 'manual_mapped' | 'ignored';

export default function TransactionsPage() {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inbox');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('unmapped');
  const [filterType, setFilterType] = useState<string>('');
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
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  const { data: bankTx = [], isLoading, error: mainError, refetch: mainRefetch } = useQuery({
    queryKey: ['bank-transactions', companyId, filterStatus, filterType],
    queryFn: () => getBankTransactions(companyId!, {
      status: filterStatus === 'all' ? undefined : filterStatus,
      type: filterType || undefined,
    }),
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

  const { data: cardTx = [], isLoading: cardTxLoading } = useQuery({
    queryKey: ['card-transactions', companyId, selectedCardId, cardFilterStatus, cardDateFrom, cardDateTo],
    queryFn: () => getCardTransactions(companyId!, {
      cardId: selectedCardId || undefined,
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

  const mapMut = useMutation({
    mutationFn: (params: { id: string; dealId?: string; classification?: string; category?: string; isFixedCost?: boolean }) =>
      mapBankTransaction(params.id, { ...params, mappedBy: userId! }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-tx-stats"] });
      setMapModal(null);
    },
  });

  const ignoreMut = useMutation({
    mutationFn: (id: string) => ignoreBankTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-tx-stats"] });
    },
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
  });

  const deleteRuleMut = useMutation({
    mutationFn: (id: string) => deleteClassificationRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["classification-rules"] }),
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
  });

  const cardIgnoreMut = useMutation({
    mutationFn: (id: string) => ignoreCardTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["card-tx-stats"] });
    },
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
  });

  const deleteCardMut = useMutation({
    mutationFn: (id: string) => deleteCorporateCard(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["corporate-cards"] }),
  });

  const s = stats || { total: 0, unmapped: 0, autoMapped: 0, manualMapped: 0, totalIncome: 0, totalExpense: 0 };
  const cs = cardStats || { total: 0, unmapped: 0, autoMapped: 0, totalSpent: 0, deductible: 0, nonDeductible: 0 };

  /* Search filter */
  const filteredBankTx = searchQuery.trim()
    ? bankTx.filter((tx: any) => {
        const q = searchQuery.toLowerCase();
        return (
          (tx.counterparty || '').toLowerCase().includes(q) ||
          (tx.description || '').toLowerCase().includes(q) ||
          (tx.category || '').toLowerCase().includes(q)
        );
      })
    : bankTx;

  /* Category breakdown for expense donut chart */
  const categoryBreakdown = bankTx.reduce((acc: Record<string, number>, tx: any) => {
    if (tx.type !== 'expense' && tx.type !== '출금') return acc;
    const cat = tx.category || '미분류';
    acc[cat] = (acc[cat] || 0) + Number(tx.amount);
    return acc;
  }, {} as Record<string, number>);
  const categoryEntries = Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]);
  const categoryTotal = categoryEntries.reduce((s, [, v]) => s + v, 0);

  if (!companyId && !isLoading) {
    return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  }

  if (mainError) {
    return <div className="p-6 text-center text-red-400">데이터를 불러올 수 없습니다. 새로고침해 주세요.</div>;
  }

  return (
    <div className="max-w-[1100px]">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">거래내역</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">은행 거래 자동 수집 + 딜/분류 매핑</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
          <button
            onClick={async () => {
              setCodefSyncing(true);
              try {
                const { syncCodefData } = await import('@/lib/data-sync');
                const result = await syncCodefData(companyId!, 'all');
                if (result.success) {
                  toast('CODEF 동기화 완료', 'success');
                  queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
                  queryClient.invalidateQueries({ queryKey: ['card-transactions'] });
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
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
          >
            {codefSyncing ? '동기화 중...' : 'CODEF 동기화'}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
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

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-[var(--border)]">
        {([['inbox', `Inbox (${s.unmapped})`], ['all', '전체'], ['manual', '수기 입력'], ['rules', '분류 규칙'], ['cards', '법인카드']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => { setTab(t); if (t === 'inbox') setFilterStatus('unmapped'); else if (t === 'all') setFilterStatus('all'); }}
            className={`px-4 py-2.5 text-sm font-semibold transition border-b-2 -mb-px ${
              tab === t ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}>
            {label}
          </button>
        ))}
      </div>

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
                <input type="number" min="1" value={manualForm.amount} onChange={e => setManualForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="1,500,000" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
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
                  queryClient.invalidateQueries({ queryKey: ['bank-stats'] });
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
                  <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
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
              <div className="overflow-x-auto"><table className="w-full min-w-[800px]">
                <thead>
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
                    <th className="text-left px-4 py-3 font-medium">날짜</th>
                    <th className="text-left px-4 py-3 font-medium">거래처</th>
                    <th className="text-left px-4 py-3 font-medium">적요</th>
                    <th className="text-right px-4 py-3 font-medium">금액</th>
                    <th className="text-center px-4 py-3 font-medium">상태</th>
                    <th className="text-center px-4 py-3 font-medium">분류</th>
                    <th className="text-center px-4 py-3 font-medium">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBankTx.map((tx: any) => (
                    <tr key={tx.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition">
                      {tab === 'inbox' && tx.mapping_status === 'unmapped' && (
                        <td className="text-center px-2 py-2.5 w-8">
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
                      <td className="px-4 py-2.5 text-sm">{tx.counterparty || "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] max-w-[180px] truncate">{tx.description || "—"}</td>
                      <td className={`px-4 py-2.5 text-sm text-right font-medium mono-number ${tx.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                        {tx.type === 'income' ? '+' : '-'}₩{Number(tx.amount).toLocaleString()}
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
                        {tx.classification && <ClassificationBadge classification={tx.classification} />}
                        {tx.category && !tx.classification && <span className="text-[10px] text-[var(--text-dim)]">{tx.category}</span>}
                        {tx.deals?.name && <div className="text-[9px] text-[var(--text-dim)] mt-0.5">{tx.deals.name}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {tx.mapping_status === 'unmapped' && (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setMapModal(tx)}
                              className="px-2 py-1 rounded text-[10px] font-semibold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition">
                              매핑
                            </button>
                            <button onClick={() => ignoreMut.mutate(tx.id)}
                              className="px-2 py-1 rounded text-[10px] text-[var(--text-dim)] hover:text-[var(--text-muted)] transition">
                              무시
                            </button>
                          </div>
                        )}
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

          {/* Card Selector + Actions */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <select value={selectedCardId} onChange={e => setSelectedCardId(e.target.value)}
              className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm w-full sm:w-auto sm:min-w-[200px]">
              <option value="">전체 카드</option>
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
              <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
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
                        {tx.corporate_cards?.card_name && (
                          <div className="text-[9px] text-[var(--text-dim)]">{tx.corporate_cards.card_name}</div>
                        )}
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
                  <input type="number" value={cardForm.monthly_limit} onChange={e => setCardForm({ ...cardForm, monthly_limit: e.target.value })}
                    placeholder="5000000" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm" />
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
  const maxVal = Math.max(...data.flatMap(d => [d.income, d.expense]), 1);
  const barAreaH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const totalW = 600;
  const barAreaW = totalW - CHART_PAD.left - CHART_PAD.right;
  const groupW = barAreaW / data.length;
  const barW = groupW * 0.3;

  const netPoints = data.map((d, i) => {
    const net = d.income - d.expense;
    const netMax = Math.max(...data.map(dd => Math.abs(dd.income - dd.expense)), 1);
    const y = CHART_PAD.top + barAreaH / 2 - (net / netMax) * (barAreaH / 2);
    const x = CHART_PAD.left + groupW * i + groupW / 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="mb-5 p-4 rounded-2xl bg-[var(--card)] border border-[var(--border)]">
      <p className="text-xs font-semibold text-[var(--text-muted)] mb-2">월별 입금 / 출금 추이 (최근 6개월)</p>
      <svg viewBox={`0 0 ${totalW} ${CHART_H}`} className="w-full" style={{ maxHeight: CHART_H }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(r => {
          const y = CHART_PAD.top + barAreaH * (1 - r);
          return <line key={r} x1={CHART_PAD.left} x2={totalW - CHART_PAD.right} y1={y} y2={y}
            stroke="var(--border)" strokeWidth={0.5} strokeDasharray={r === 0 ? 'none' : '4 2'} />;
        })}
        {/* Bars */}
        {data.map((d, i) => {
          const x = CHART_PAD.left + groupW * i;
          const incomeH = (d.income / maxVal) * barAreaH;
          const expenseH = (d.expense / maxVal) * barAreaH;
          const mIdx = parseInt(d.month.split('-')[1], 10) - 1;
          return (
            <g key={d.month}>
              {/* Income bar */}
              <rect x={x + groupW / 2 - barW - 1} y={CHART_PAD.top + barAreaH - incomeH}
                width={barW} height={incomeH} rx={3} fill="var(--success)" opacity={0.85} />
              {/* Expense bar */}
              <rect x={x + groupW / 2 + 1} y={CHART_PAD.top + barAreaH - expenseH}
                width={barW} height={expenseH} rx={3} fill="var(--danger)" opacity={0.85} />
              {/* Month label */}
              <text x={x + groupW / 2} y={CHART_H - 6} textAnchor="middle"
                fontSize={11} fill="var(--text-muted)" fontWeight={500}>
                {MONTH_LABELS[mIdx]}
              </text>
              {/* Value labels */}
              {incomeH > 14 && (
                <text x={x + groupW / 2 - barW / 2 - 1} y={CHART_PAD.top + barAreaH - incomeH + 12}
                  textAnchor="middle" fontSize={8} fill="var(--success)" fontWeight={600}>
                  {fmtW(d.income)}
                </text>
              )}
              {expenseH > 14 && (
                <text x={x + groupW / 2 + barW / 2 + 1} y={CHART_PAD.top + barAreaH - expenseH + 12}
                  textAnchor="middle" fontSize={8} fill="var(--danger)" fontWeight={600}>
                  {fmtW(d.expense)}
                </text>
              )}
            </g>
          );
        })}
        {/* Net line overlay */}
        <polyline points={netPoints} fill="none" stroke="var(--primary)" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => {
          const net = d.income - d.expense;
          const netMax = Math.max(...data.map(dd => Math.abs(dd.income - dd.expense)), 1);
          const y = CHART_PAD.top + barAreaH / 2 - (net / netMax) * (barAreaH / 2);
          const x = CHART_PAD.left + groupW * i + groupW / 2;
          return <circle key={i} cx={x} cy={y} r={3} fill="var(--primary)" />;
        })}
      </svg>
      <div className="flex items-center gap-4 mt-2 text-[10px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--success)' }} />입금</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--danger)' }} />출금</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: 'var(--primary)' }} />순이익</span>
      </div>
    </div>
  );
}
