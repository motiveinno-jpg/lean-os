"use client";

// 매입매출전표입력 — 증빙에서 시작하는 전표 (2026-08-11 사장님 지시로 신설).
//
//   일반전표(voucher-entry)는 차·대를 직접 치는 화면이다. 그런데 회사가 실제로 치는 전표의
//   대부분은 세금계산서·카드·현금영수증에서 시작하고, 그건 **유형(과세/영세/면세/불공제)에 따라
//   분개도 부가세 신고서도 이미 정해져 있다**. 그래서 화면을 갈랐다.
//
//   손으로 치는 건 위 한 줄(유형·거래처·금액)뿐이고, 아래 분개는 lib/vat-voucher 의 규칙이 만든다.
//   만들어진 줄은 고칠 수 있다 — 계정만 회사 사정에 맞게(예: 제품매출 → 용역매출).

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { DateField } from "@/components/date-field";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { friendlyError } from "@/lib/friendly-error";
import {
  VAT_TYPES, SETTLE_LABEL, buildVoucherLines, vatOf, vatType,
  type SettleType, type DraftLine,
} from "@/lib/vat-voucher";

type Acct = { id: string; code: string; name: string; account_type: string };
type Pt = { id: string; name: string; business_number: string | null };
type ItemLine = { key: number; name: string; spec: string; qty: string; unitCost: string };
type JLine = { key: number; side: "debit" | "credit"; account: Acct | null; amount: string; locked?: boolean };

const won = (n: number) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
const numOf = (s: string) => Number(String(s).replace(/[^0-9]/g, "")) || 0;
let K = 1;

export default function SalePurchaseVoucherPage() {
  const { role } = useUser();
  //   전표는 회사 장부라 관리자만 — 일반전표 화면과 같은 기준
  if (role !== "owner" && role !== "admin") {
    return <AccessDenied detail="매입매출전표는 대표·관리자 전용입니다." />;
  }
  return <SalePurchaseInner />;
}

function SalePurchaseInner() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(todayKst());

  // ── 매입매출 정보 ──
  const [vatCode, setVatCode] = useState("11");
  const [settle, setSettle] = useState<SettleType>("credit");
  const [partner, setPartner] = useState<Pt | null>(null);
  const [partnerQuery, setPartnerQuery] = useState("");
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [items, setItems] = useState<ItemLine[]>([{ key: K++, name: "", spec: "", qty: "1", unitCost: "" }]);
  //   비용/매출 계정 — 유형이 정하지 못하는 유일한 칸이라 사람이 고른다
  const [mainAccount, setMainAccount] = useState<Acct | null>(null);
  const [mainQuery, setMainQuery] = useState("");
  const [mainOpen, setMainOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const t = vatType(vatCode)!;

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: u } = await supabase.from("users").select("company_id").eq("auth_id", data.user.id).maybeSingle();
      if (u?.company_id) setCompanyId(u.company_id);
    });
  }, []);

  //   유형을 바꾸면 그 유형에서 가장 흔한 결제 방법으로 맞춰 준다 (바꾸고 싶으면 바꾸면 된다).
  //   매출↔매입이 뒤집히면 골라 둔 계정도 비운다 — 매출 계정이 비용 자리에 남으면 분개가 거짓말이 된다.
  useEffect(() => {
    const next = vatType(vatCode);
    if (!next) return;
    setSettle(next.defaultSettle);
    setMainAccount((prev) => {
      if (!prev) return prev;
      const want = next.side === "sale" ? "revenue" : "expense";
      return prev.account_type === want ? prev : null;
    });
  }, [vatCode]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["sp-voucher-accounts", companyId],
    queryFn: async () => {
      const data = logRead("sale-purchase:accounts", await supabase
        .from("chart_of_accounts").select("id, code, name, account_type")
        .eq("company_id", companyId!).order("code"));
      return (data || []) as Acct[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["sp-voucher-partners", companyId],
    queryFn: async () => {
      const data = logRead("sale-purchase:partners", await supabase
        .from("partners").select("id, name, business_number")
        .eq("company_id", companyId!).eq("is_active", true).order("name"));
      return (data || []) as Pt[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });

  const acctByCode = useMemo(() => {
    const m = new Map<string, Acct>();
    for (const a of accounts) m.set(String(a.code), a);
    return m;
  }, [accounts]);

  const supply = items.reduce((s, it) => s + Math.round((Number(it.qty) || 1) * numOf(it.unitCost)), 0);
  const vat = vatOf(vatCode, supply);
  const total = supply + vat;

  //   규칙이 만든 분개 → 화면 줄. 사람이 계정을 바꾸면 그 줄만 덮어쓴다.
  const [overrides, setOverrides] = useState<Record<number, Acct | null>>({});
  const draft: DraftLine[] = useMemo(
    () => buildVoucherLines({
      vatCode, settle, supply,
      mainCode: mainAccount?.code ?? null,
      mainName: mainAccount?.name ?? null,
    }),
    [vatCode, settle, supply, mainAccount],
  );
  const lines: JLine[] = draft.map((d, i) => ({
    key: i,
    side: d.side,
    account: overrides[i] !== undefined ? overrides[i] : (d.code ? acctByCode.get(d.code) || null : null),
    amount: won(d.amount),
    locked: d.locked,
  }));
  //   유형·금액이 바뀌면 손으로 고친 계정은 지운다(엉뚱한 줄에 남지 않게)
  useEffect(() => { setOverrides({}); }, [vatCode, settle]);

  const debitSum = lines.filter((l) => l.side === "debit").reduce((s, l) => s + numOf(l.amount), 0);
  const creditSum = lines.filter((l) => l.side === "credit").reduce((s, l) => s + numOf(l.amount), 0);
  const balanced = debitSum > 0 && debitSum === creditSum;
  const allAccounts = lines.every((l) => !!l.account);
  const canSave = balanced && allAccounts && !!partner && supply > 0 && !saving;

  const patchItem = (key: number, patch: Partial<ItemLine>) =>
    setItems((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addItem = () => setItems((rs) => [...rs, { key: K++, name: "", spec: "", qty: "1", unitCost: "" }]);
  const removeItem = (key: number) =>
    setItems((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [{ key: K++, name: "", spec: "", qty: "1", unitCost: "" }]));

  const reset = () => {
    setItems([{ key: K++, name: "", spec: "", qty: "1", unitCost: "" }]);
    setPartner(null); setPartnerQuery(""); setMainAccount(null); setMainQuery(""); setOverrides({});
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = lines.map((l) => ({
        account_id: l.account!.id,
        debit: l.side === "debit" ? numOf(l.amount) : 0,
        credit: l.side === "credit" ? numOf(l.amount) : 0,
        memo: items.map((it) => it.name).filter(Boolean).join(" · ").slice(0, 200),
        partner_id: partner?.id || null,
      }));
      const { error } = await (supabase.rpc as any)("save_sale_purchase_voucher", {
        p_entry_date: entryDate,
        p_vat_type: vatCode,
        p_supply_amount: supply,
        p_vat_amount: vat,
        p_description: `${t.label} ${partner?.name || ""}`.trim(),
        p_lines: payload,
      });
      if (error) throw error;
      toast(`매입매출전표를 저장했습니다 (${t.label} · ${won(total)}원)`, "success");
      qc.invalidateQueries({ queryKey: ["sp-voucher-list"] });
      reset();
    } catch (e: any) {
      const m = String(e?.message || "");
      toast(
        m.includes("PERIOD_LOCKED") ? "마감된 달이라 전표를 저장할 수 없습니다."
        : m.includes("FORBIDDEN") ? "전표를 저장할 권한이 없습니다."
        : m.includes("UNBALANCED") ? "차변과 대변이 맞지 않습니다."
        : `저장 실패: ${friendlyError(e, "알 수 없는 오류")}`,
        "error",
      );
    } finally { setSaving(false); }
  };

  // ── 오늘 저장된 매입매출전표 ──
  const { data: saved = [] } = useQuery({
    queryKey: ["sp-voucher-list", companyId, entryDate],
    queryFn: async () => {
      const data = logRead("sale-purchase:list", await supabase
        .from("journal_entries")
        .select("id, voucher_no, vat_type, supply_amount, vat_amount, description, journal_lines(debit, credit, chart_of_accounts(code, name))")
        .eq("company_id", companyId!).eq("entry_date", entryDate).eq("entry_kind" as never, "sale_purchase")
        .order("voucher_no"));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  const filteredPartners = partners.filter((p) =>
    !partnerQuery || p.name.toLowerCase().includes(partnerQuery.toLowerCase()) || (p.business_number || "").includes(partnerQuery));
  const filterAccts = (q: string, onlyExpense?: boolean) => accounts.filter((a) =>
    (!onlyExpense || a.account_type === (t.side === "sale" ? "revenue" : "expense"))
    && (!q || a.name.toLowerCase().includes(q.toLowerCase()) || String(a.code).includes(q))).slice(0, 40);

  return (
    <div className="sp-voucher-page">
      {/* 머리 — 일자 · 저장 */}
      <div className="sp-toolbar page-sticky-header">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-[var(--text-dim)]">일자</label>
          <DateField value={entryDate} onChange={(e) => setEntryDate(e.target.value)}
            className="field-input px-2.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)]" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={reset} className="btn-secondary btn-sm">새 전표</button>
          <button type="button" onClick={save} disabled={!canSave} className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>

      {/* ① 매입매출 정보 */}
      <section className="sp-card glass-card">
        <div className="sp-card-head">
          <b>① 매입매출 정보</b>
          <span>세금계산서·카드·현금영수증에 적힌 그대로</span>
        </div>

        <div className="sp-head-grid">
          <div className="sp-field">
            <label>유형</label>
            <select value={vatCode} onChange={(e) => setVatCode(e.target.value)}
              className="field-input w-full px-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs">
              <optgroup label="매출">
                {VAT_TYPES.filter((v) => v.side === "sale").map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
              </optgroup>
              <optgroup label="매입">
                {VAT_TYPES.filter((v) => v.side === "purchase").map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
              </optgroup>
            </select>
            <span className="sp-hint">{t.hint}</span>
          </div>

          <div className="sp-field relative">
            <label>거래처 <i>*</i></label>
            <input value={partner?.name || partnerQuery}
              onChange={(e) => { setPartner(null); setPartnerQuery(e.target.value); setPartnerOpen(true); }}
              onFocus={() => setPartnerOpen(true)}
              onBlur={() => setTimeout(() => setPartnerOpen(false), 200)}
              placeholder="상호 · 사업자번호로 검색"
              className="field-input w-full px-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs" />
            {partnerOpen && filteredPartners.length > 0 && (
              <div className="sp-drop">
                {filteredPartners.slice(0, 10).map((p) => (
                  <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setPartner(p); setPartnerQuery(p.name); setPartnerOpen(false); }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{p.name}</span>
                      {p.business_number && <span className="caption shrink-0">{p.business_number}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sp-field">
            <label>분개유형</label>
            <select value={settle} onChange={(e) => setSettle(e.target.value as SettleType)}
              className="field-input w-full px-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs">
              {(Object.keys(SETTLE_LABEL) as SettleType[]).map((s) => <option key={s} value={s}>{SETTLE_LABEL[s]}</option>)}
            </select>
            <span className="sp-hint">상대 계정(돈이 오간 쪽)을 정합니다</span>
          </div>

          <div className="sp-field relative">
            <label>{t.side === "sale" ? "매출 계정" : "비용 계정"} <i>*</i></label>
            <input value={mainAccount ? `${mainAccount.code} ${mainAccount.name}` : mainQuery}
              onChange={(e) => { setMainAccount(null); setMainQuery(e.target.value); setMainOpen(true); }}
              onFocus={() => setMainOpen(true)}
              onBlur={() => setTimeout(() => setMainOpen(false), 200)}
              placeholder={t.side === "sale" ? "예: 404 제품매출" : "예: 830 소모품비"}
              className="field-input w-full px-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs" />
            {mainOpen && (
              <div className="sp-drop">
                {filterAccts(mainQuery, true).map((a) => (
                  <button key={a.id} type="button" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setMainAccount(a); setMainQuery(""); setMainOpen(false); }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] text-xs">
                    <span className="mono-number text-[var(--text-dim)] mr-2">{a.code}</span>{a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 품목 줄 */}
        <div className="sp-items">
          <div className="sp-items-scroll">
            <div className="sp-items-grid">
              <div className="sp-item-row sp-item-head">
                <span /><span>품목</span><span>규격</span>
                <span className="text-right">수량</span><span className="text-right">단가</span><span className="text-right">공급가액</span><span />
              </div>
              {items.map((it, i) => (
                <div key={it.key} className="sp-item-row">
                  <span className="sp-item-no">{i + 1}</span>
                  <input value={it.name} onChange={(e) => patchItem(it.key, { name: e.target.value })}
                    placeholder="품목" className="sp-item-input" />
                  <input value={it.spec} onChange={(e) => patchItem(it.key, { spec: e.target.value })}
                    placeholder="규격" className="sp-item-input" />
                  <input value={it.qty} onChange={(e) => patchItem(it.key, { qty: e.target.value })}
                    inputMode="decimal" placeholder="1" className="sp-item-input text-right" />
                  <CurrencyInput value={it.unitCost} onValueChange={(raw: string) => patchItem(it.key, { unitCost: raw })}
                    placeholder="0" className="sp-item-input text-right" />
                  <span className="sp-item-sum">{won((Number(it.qty) || 1) * numOf(it.unitCost))}</span>
                  <button type="button" onClick={() => removeItem(it.key)} className="sp-item-del" title="이 줄 지우기">✕</button>
                </div>
              ))}
            </div>
          </div>
          <div className="sp-items-foot">
            <button type="button" onClick={addItem} className="btn-secondary btn-sm">+ 품목 줄</button>
            <div className="sp-totals">
              <div><small>공급가액</small><b>{won(supply)}</b></div>
              <div><small>부가세</small><b>{won(vat)}{!t.taxed && <em> (세액 없음)</em>}</b></div>
              <div className="sp-total-grand"><small>합계</small><b>{won(total)}</b></div>
            </div>
          </div>
        </div>
      </section>

      {/* ② 분개 */}
      <section className="sp-card glass-card">
        <div className="sp-card-head sp-card-head-je">
          <b>② 분개</b>
          <span>{t.label} · {SETTLE_LABEL[settle]} → 규칙이 만든 줄입니다 · 계정을 눌러 바꿀 수 있습니다</span>
        </div>

        {lines.length === 0 ? (
          <div className="sp-empty">품목 금액을 입력하면 분개가 만들어집니다.</div>
        ) : (
          <>
            <div className="sp-items-scroll">
              <div className="sp-je-grid">
                <div className="sp-je-row sp-item-head">
                  <span>구분</span><span>계정과목</span><span className="text-right">차변</span><span className="text-right">대변</span>
                </div>
                {lines.map((l, i) => (
                  <div key={l.key} className="sp-je-row">
                    <span className={l.side === "debit" ? "sp-dc sp-dc-d" : "sp-dc sp-dc-c"}>
                      {l.side === "debit" ? "차변" : "대변"}
                    </span>
                    <div className="relative">
                      <button type="button" onClick={() => { setPickerFor(pickerFor === i ? null : i); setPickerQuery(""); }}
                        className={l.account ? "sp-acct-btn" : "sp-acct-btn sp-acct-empty"}
                        title={l.locked ? "부가세 줄 — 유형이 정한 계정입니다" : "눌러서 계정 바꾸기"}>
                        {l.account
                          ? <><span className="mono-number text-[var(--text-dim)] mr-1.5">{l.account.code}</span>{l.account.name}</>
                          : (draft[i]?.name || "계정을 고르세요")}
                        {l.locked && <span className="sp-lock" title="유형이 정한 줄">자동</span>}
                      </button>
                      {pickerFor === i && (
                        <div className="sp-drop sp-drop-wide">
                          <input autoFocus value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)}
                            placeholder="계정과목 검색 (이름·코드)"
                            className="w-full px-2.5 py-2 text-xs bg-[var(--bg-surface)] border-b border-[var(--border)] focus:outline-none" />
                          <div className="max-h-52 overflow-y-auto">
                            {filterAccts(pickerQuery).map((a) => (
                              <button key={a.id} type="button"
                                onClick={() => { setOverrides((o) => ({ ...o, [i]: a })); setPickerFor(null); }}
                                className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] text-xs">
                                <span className="mono-number text-[var(--text-dim)] mr-2">{a.code}</span>{a.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="sp-amt">{l.side === "debit" ? l.amount : ""}</span>
                    <span className="sp-amt">{l.side === "credit" ? l.amount : ""}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="sp-je-foot">
              <div><small>차변합</small><b>{won(debitSum)}</b></div>
              <div><small>대변합</small><b>{won(creditSum)}</b></div>
              <span className={balanced ? "sp-balance sp-balance-ok" : "sp-balance"}>
                {balanced ? "✓ 차·대 일치" : "차·대가 맞지 않습니다"}
              </span>
            </div>
            {!allAccounts && (
              <div className="sp-warn">계정이 비어 있는 줄이 있습니다 — 계정을 고르면 저장할 수 있습니다.</div>
            )}
          </>
        )}
      </section>

      {/* 오늘 저장분 */}
      <section className="sp-card glass-card">
        <div className="sp-card-head">
          <b>{entryDate} 매입매출전표</b>
          <span>{saved.length}건</span>
        </div>
        {saved.length === 0 ? (
          <div className="sp-empty">이 일자에 저장된 매입매출전표가 없습니다.</div>
        ) : (
          <div className="sp-items-scroll">
            <table className="sp-saved-table">
              <thead>
                <tr><th>NO</th><th>유형</th><th>적요</th><th className="text-right">공급가액</th><th className="text-right">부가세</th><th className="text-right">합계</th></tr>
              </thead>
              <tbody>
                {saved.map((e: any) => (
                  <tr key={e.id}>
                    <td className="mono-number">{e.voucher_no}</td>
                    <td><span className="sp-type-pill">{vatType(e.vat_type)?.label || e.vat_type}</span></td>
                    <td className="truncate max-w-[260px]">{e.description || "—"}</td>
                    <td className="text-right mono-number">{won(e.supply_amount)}</td>
                    <td className="text-right mono-number">{won(e.vat_amount)}</td>
                    <td className="text-right mono-number font-bold text-[var(--primary)]">{won(Number(e.supply_amount || 0) + Number(e.vat_amount || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="sp-note">
        ※ 매입매출전표는 <b>부가세가 붙는 거래</b>(세금계산서·카드·현금영수증)를 칩니다 —
        통장 이체·대체·결산 분개는 <b>일반전표</b>에서 칩니다. 여기 친 유형이 부가세 신고 집계의 기준이 됩니다.
      </p>
    </div>
  );
}
