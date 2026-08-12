"use client";

// 수집·전표 2단계 — 자료별 조회 + 전표 만들기 (2026-08-11)
//
//   화면을 옮기지 않고 여기서 끝낸다. 목록에 **차변·대변 계정이 미리 채워져** 있고,
//   고른 줄을 그대로 전표로 만든다.
//
//   ★ 격자·분개는 새로 만들지 않는다 — 매입매출전표가 쓰는 lib/vat-voucher(유형 10종·분개 생성·
//     음수 처리)와 save_sale_purchase_voucher RPC 를 그대로 쓴다. 두 화면의 결과가 달라지면 안 된다.
//
//   계정 추천 = **같은 거래처로 지난번에 쓴 계정**. 4단계(자동분개 학습)의 뿌리다.
//   지금은 규칙을 따로 저장하지 않고 이미 만든 전표를 되읽는다 — 사람이 고른 것이 곧 근거다.

import { useMemo, useState } from "react";
import { PickList } from "@/components/pick-list";
import { fetchMerchantKinds, fillMerchantKinds, type MerchantKind } from "@/lib/merchant-tax-type";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import {
  VAT_TYPES, STD, buildVoucherLines, vatType, suggestVatType, normalizeSides,
  type SettleType,
} from "@/lib/vat-voucher";
import type { SourceKey } from "@/lib/collect";
import { fetchRuleMap, ruleKeyOf, learnAccount, ruleTag, type RuleKind } from "@/lib/voucher-rules";

type Acct = { id: string; code: string; name: string; account_type: string };
type Row = {
  id: string;
  date: string;
  partnerId: string | null;
  partnerName: string;
  bizno: string;
  item: string;
  supply: number;
  vat: number;
  vatCode: string;
  settle: SettleType;
  posted: boolean;
  voucherNo: number | null;
  /** 카드 비목 — 회사설정의 '카드 비목 → 계정' 매핑을 찾는 열쇠 */
  cardCategory?: string | null;
};

const won = (n: number) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
//   카드 자동분류는 {"label":"통신비",…} JSON 문자열이라 이름만 꺼낸다 (다른 화면과 같은 규칙)
function cardLabelOf(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return "";
  if (v.startsWith("{")) { try { return String(JSON.parse(v)?.label || "").trim(); } catch { return ""; } }
  return v;
}

/** 표준 계정(상대·부가세)은 추천 대상이 아니다 — 사람이 고르는 건 매출·비용 계정이다 */
const STD_CODES = new Set<string>([STD.bank, STD.ar, STD.vatIn, STD.ap, STD.payable, STD.vatOut]);

//   '3. 일반' — 부가세 유형 코드가 아니라 **일반전표로 보내라**는 표시다.
//   국세청 부가세 유형(11·51·57…)과 겹치지 않는 값이라 섞일 일이 없다 (2026-08-12).
const GENERAL_CODE = "3";

const SETTLE_BY_KIND: Record<string, SettleType> = {
  tax_invoice: "credit", exempt_invoice: "credit", cash_receipt: "cash", card: "card",
};

export function EvidenceTab({ companyId, from, to, kind }: { companyId: string; from: string; to: string; kind: SourceKey }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [onlyTodo, setOnlyTodo] = useState(true);
  const [dir, setDir] = useState<"all" | "sale" | "purchase">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [override, setOverride] = useState<Record<string, { vatCode?: string; acct?: Acct }>>({});
  const [pick, setPick] = useState<{ id: string; q: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["collect-accounts", companyId],
    queryFn: async () => {
      const data = logRead("collect:accounts", await supabase
        .from("chart_of_accounts").select("id, code, name, account_type")
        .eq("company_id", companyId).order("code"));
      return (data || []) as Acct[];
    },
    staleTime: 300_000,
  });
  const acctByCode = useMemo(() => {
    const m = new Map<string, Acct>();
    for (const a of accounts) m.set(String(a.code), a);
    return m;
  }, [accounts]);

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["collect-rows", companyId, from, to, kind],
    queryFn: () => fetchRows(companyId, from, to, kind),
  });

  //   학습된 규칙 — 2단계에서 전표를 되읽던 방식을 표로 올렸다(4단계).
  //   거래처가 없는 자료(카드 가맹점·현금영수증 상호)도 이제 배운다.
  const { data: rules } = useQuery({
    queryKey: ["voucher-rules", companyId, kind],
    queryFn: () => fetchRuleMap(companyId, kind as RuleKind),
    staleTime: 60_000,
  });

  //   카드 비목 → 계정 매핑(회사설정에서 만든 것) — 가맹점 이름이 아니라 **분류(category)** 기준이다
  const { data: cardMap = {} } = useQuery<Record<string, Acct>>({
    queryKey: ["collect-card-map", companyId],
    queryFn: async () => {
      const data = logRead("collect:cardmap", await supabase
        .from("card_account_mappings")
        .select("category, chart_of_accounts(id, code, name, account_type)")
        .eq("company_id", companyId));
      const out: Record<string, Acct> = {};
      for (const r of ((data as any[]) || [])) {
        if (r.category && r.chart_of_accounts) out[String(r.category)] = r.chart_of_accounts as Acct;
      }
      return out;
    },
    enabled: kind === "card",
    staleTime: 300_000,
  });

  /** 이 줄의 학습 열쇠 — 자료마다 다르다(세금계산서는 거래처, 카드는 가맹점명 …) */
  const keyOf = (r: Row) => ruleKeyOf(kind as RuleKind, { partnerId: r.partnerId, name: r.partnerName, fallback: r.item });

  /** 이 줄에 붙일 매출·비용 계정과 그 근거 */
  const acctOf = (r: Row): { acct: Acct | null; via: "고름" | "지난번" | "학습" | "규칙" | null } => {
    const o = override[r.id]?.acct;
    if (o) return { acct: o, via: "고름" };
    const hit = rules?.get(keyOf(r).key);
    if (hit?.account) return { acct: hit.account as Acct, via: ruleTag(hit.hit_count) };
    //   카드는 회사설정의 '비목 → 계정' 표도 본다 (학습보다 뒤 — 사람이 고른 게 우선)
    if (kind === "card" && r.cardCategory && cardMap[r.cardCategory]) {
      return { acct: cardMap[r.cardCategory], via: "규칙" };
    }
    return { acct: null, via: null };
  };
  const vatCodeOf = (r: Row) => override[r.id]?.vatCode ?? r.vatCode;

  const shown = rows.filter((r) => {
    if (onlyTodo && r.posted) return false;
    if (dir !== "all" && vatType(vatCodeOf(r))?.side !== dir) return false;
    return true;
  });
  const selRows = shown.filter((r) => sel.has(r.id));
  const sumSupply = shown.reduce((n, r) => n + r.supply, 0);
  const sumVat = shown.reduce((n, r) => n + r.vat, 0);

  const linesFor = (r: Row) => {
    const { acct } = acctOf(r);
    //   ★ '3. 일반'은 부가세 유형이 아니라 buildVoucherLines 가 만들 줄이 없다(빈 배열이 나온다).
    //     그러면 화면이 분개를 못 그려 터진다 — 실제로 그랬다. 여기서 두 줄을 직접 만든다:
    //     차) 비용 전액 / 대) 미지급금 전액. 부가세를 안 떼므로 합계 그대로다. (2026-08-12)
    if (vatCodeOf(r) === GENERAL_CODE) {
      const total = r.supply + r.vat;
      const pay = acctByCode.get(STD.payable);
      return [
        { side: "debit" as const, code: acct?.code ?? null, name: acct?.name || "비용 계정을 고르세요", amount: total },
        { side: "credit" as const, code: pay?.code ?? STD.payable, name: pay?.name || "미지급금", amount: total },
      ];
    }
    return buildVoucherLines({
      vatCode: vatCodeOf(r), settle: r.settle, supply: r.supply, vat: r.vat,
      mainCode: acct?.code ?? null, mainName: acct?.name ?? null,
    });
  };

  //   계정이 안 정해진 줄은 전표를 못 만든다 — 몇 건인지 먼저 알려 준다
  const notReady = selRows.filter((r) => linesFor(r).some((l) => !l.code || !acctByCode.get(l.code)));

  const makeVouchers = async () => {
    if (selRows.length === 0 || saving) return;
    setSaving(true);
    let ok = 0;
    const fails: string[] = [];
    for (const r of selRows) {
      const lines = linesFor(r);
      const resolved = lines.map((l) => (l.code ? acctByCode.get(l.code) ?? null : null));
      if (lines.length < 2 || resolved.some((a) => !a)) {
        fails.push(`${r.partnerName}: 계정을 먼저 고르세요`);
        continue;
      }
      const norm = normalizeSides(lines.map((l) => ({ side: l.side, amount: l.amount })));
      const payload = lines.map((l, i) => ({
        account_id: resolved[i]!.id,
        debit: norm[i].side === "debit" ? norm[i].amount : 0,
        credit: norm[i].side === "credit" ? norm[i].amount : 0,
        memo: r.item || "",
        partner_id: r.partnerId,
      }));
      //   ★ '3. 일반'은 부가세 전표가 아니다 — **일반전표**로 보낸다.
      //     부가세를 안 떼므로 금액은 합계 그대로 가고, 분개는 차) 비용 / 대) 미지급금 두 줄이다.
      if (vatCodeOf(r) === GENERAL_CODE) {
        const total = r.supply + r.vat;
        const g = [
          { account_id: resolved[0]!.id, debit: total, credit: 0, memo: r.item || "", partner_id: r.partnerId },
          { account_id: (acctByCode.get(STD.payable) ?? resolved[resolved.length - 1]!)!.id, debit: 0, credit: total, memo: r.item || "", partner_id: null },
        ];
        const { error: ge } = await (supabase.rpc as any)("save_manual_voucher", {
          p_entry_date: r.date, p_voucher_type: "cash_out",
          p_description: r.item || r.partnerName, p_lines: g,
        });
        if (ge) { fails.push(`${r.partnerName}: ${friendlyError(ge, "일반전표 저장 실패")}`); }
        else ok += 1;
        continue;
      }
      const { error } = await (supabase.rpc as any)("save_sale_purchase_voucher", {
        p_entry_date: r.date,
        p_vat_type: vatCodeOf(r),
        p_supply_amount: r.supply,
        p_vat_amount: r.vat,
        p_description: r.item || r.partnerName,
        p_lines: payload,
        p_reference_type: REF_TYPE[kind],
        p_reference_id: r.id,
      });
      if (error) {
        const m = String(error.message || "");
        fails.push(`${r.partnerName}: ${
          m.includes("PERIOD_LOCKED") ? "마감된 달"
          : m.includes("ALREADY_POSTED") ? "이미 전표가 있음"
          : m.includes("UNBALANCED") ? "차·대 불일치"
          : friendlyError(error, "저장 실패")}`);
      } else {
        ok += 1;
        //   사람이 고른 것을 배운다 — 다음에 같은 상대가 나오면 미리 채운다
        const main = acctOf(r).acct;
        if (main) {
          const k = keyOf(r);
          await learnAccount({ kind: kind as RuleKind, key: k.key, label: k.label, accountId: main.id, vatType: vatCodeOf(r) });
        }
      }
    }
    setSel(new Set());
    qc.invalidateQueries({ queryKey: ["collect-rows"] });
    qc.invalidateQueries({ queryKey: ["collect-status"] });
    qc.invalidateQueries({ queryKey: ["voucher-rules"] });
    setSaving(false);
    if (ok > 0 && fails.length === 0) toast(`전표 ${ok}건을 만들었습니다`, "success");
    else if (ok > 0) toast(`${ok}건 성공 · ${fails.length}건 실패 — ${fails[0]}`, "info");
    else toast(`전표를 만들지 못했습니다 — ${fails[0] ?? "알 수 없는 오류"}`, "error");
  };

  const toggle = (id: string) =>
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = shown.length > 0 && shown.every((r) => sel.has(r.id) || r.posted);

  //   PickList 에 넘길 **자르지 않은** 목록 — 검색은 PickList 안에서 한다.
  //   (filterAccts 는 40개로 잘라서, 그걸 넘기면 앞 40개 안에서만 검색된다 — 실제로 그렇게 만들었다가 잡았다)
  const acctsOf = (side: "sale" | "purchase") =>
    accounts.filter((a) => a.account_type === (side === "sale" ? "revenue" : "expense"));

  //   자료 종류에 맞는 유형만 고르게 한다 (2026-08-12 사장님 지시).
  //     카드 매입에 '11. 과세매출'·'51. 과세매입'(세금계산서용)이 섞여 나와, 열 개 중 아홉이 쓸 일 없는 것이었다.
  //     카드는 **57 카과 · 58 카면 · 59 카영** 셋이면 되고, 부가세와 무관한 일반경비는
  //     매입매출전표가 아니라 **일반전표**로 보내야 한다(아래 '3. 일반').
  const typeOptions = useMemo(() => {
    if (kind === "card") return [
      //   ★ '3. 일반' 은 부가세 유형이 아니라 **보낼 곳**이다 (2026-08-12 사장님 지시).
      //     부가세 신고와 무관한 카드 사용(불공제도 아니고 매입세액도 없는 일반경비)은
      //     매입매출전표가 아니라 **일반전표**로 가야 한다 — 매입매출전표에 넣으면 신고 집계에 섞인다.
      { code: GENERAL_CODE, label: "3. 일반 (일반전표로)" } as (typeof VAT_TYPES)[number],
      ...VAT_TYPES.filter((v) => ["57", "58", "59"].includes(v.code)),
    ];
    if (kind === "cash_receipt") return VAT_TYPES.filter((v) => ["22", "61"].includes(v.code));
    return VAT_TYPES;   // 세금계산서·계산서는 전부
  }, [kind]);

  //   가맹점 과세유형(구분) — 이미 조회해 둔 것을 그린다
  const { data: merchantKinds = {} } = useQuery<Record<string, MerchantKind>>({
    queryKey: ["merchant-kinds", companyId],
    queryFn: () => fetchMerchantKinds(companyId),
    enabled: !!companyId, staleTime: 300_000,
  });
  const [filling, setFilling] = useState(false);
  //   아직 구분을 모르는 가맹점 수 — 버튼에 그대로 보여 준다(몇 개를 물어볼 건지 알고 누르게)
  const unknownBiznos = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const d = r.bizno.replace(/[^0-9]/g, "");
      if (d.length === 10 && !merchantKinds[d]) set.add(d);
    }
    return [...set];
  }, [rows, merchantKinds]);
  const fillKinds = async () => {
    setFilling(true);
    try {
      const n = await fillMerchantKinds(companyId, unknownBiznos);
      await qc.invalidateQueries({ queryKey: ["merchant-kinds", companyId] });
      toast(n > 0 ? `가맹점 구분 ${n}곳을 채웠습니다` : "새로 알아낸 구분이 없습니다 (국세청에 없는 번호일 수 있습니다)", n > 0 ? "success" : "info");
    } catch (e: any) {
      toast(`구분 조회 실패: ${e?.message || "알 수 없는 오류"}`, "error");
    } finally { setFilling(false); }
  };

  const filterAccts = (q: string, side: "sale" | "purchase") =>
    accounts.filter((a) =>
      a.account_type === (side === "sale" ? "revenue" : "expense")
      && (!q || a.name.toLowerCase().includes(q.toLowerCase()) || String(a.code).includes(q))).slice(0, 40);

  return (
    <div className="ev-wrap">
      {/* 필터 */}
      <div className="collect-toolbar">
        <div className="collect-seg">
          {(["all", "sale", "purchase"] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDir(d)} className={dir === d ? "collect-seg-on" : ""}>
              {d === "all" ? "전체" : d === "sale" ? "매출" : "매입"}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setOnlyTodo((v) => !v)}
          className={onlyTodo ? "ev-filter ev-filter-on" : "ev-filter"}>
          {onlyTodo ? "전표 미처리만" : "전체 보기"}
        </button>
        <span className="collect-toolbar-hint">
          {shown.length}건 · 공급가액 <b className="mono-number">{won(sumSupply)}</b> · 부가세 <b className="mono-number">{won(sumVat)}</b>
          {/*   ★ 잘렸으면 반드시 말한다 — 조용히 500건만 보여 주면 '이게 전부'로 읽힌다 */}
          {rows.length >= 500 && <b className="ev-cut"> · 최근 500건만 표시 (기간을 좁혀 주세요)</b>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {notReady.length > 0 && <span className="ev-warn">{notReady.length}건은 계정을 골라야 합니다</span>}
          {/*   구분(법인·일반·간이·면세)은 카드 원자료에 없다 — 국세청에 물어 채운다.
                아직 모르는 **가맹점 수**만 물어보므로 거래 건수와 무관하다 (2026-08-12) */}
          {kind === "card" && unknownBiznos.length > 0 && (
            <button type="button" onClick={fillKinds} disabled={filling}
              className="btn-secondary btn-sm disabled:opacity-50"
              title="가맹점 사업자번호로 국세청에 과세유형을 물어 '구분' 칸을 채웁니다">
              {filling ? "구분 조회 중…" : `구분 채우기 (${unknownBiznos.length}곳)`}
            </button>
          )}
          <button type="button" onClick={makeVouchers} disabled={selRows.length === 0 || saving}
            className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "만드는 중…" : `전표 만들기${selRows.length > 0 ? ` (${selRows.length})` : ""}`}
          </button>
        </div>
      </div>

      {/* 목록 */}
      {isLoading ? (
        <div className="collect-empty">읽는 중…</div>
      ) : shown.length === 0 ? (
        <div className="collect-empty">
          {onlyTodo ? "전표를 만들 자료가 없습니다 — 이 달치는 다 처리했습니다." : "이 달에 받아온 자료가 없습니다."}
        </div>
      ) : (
        <div className="ev-scroll glass-card">
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <button type="button" aria-label="전체 선택"
                    onClick={() => setSel(allOn ? new Set() : new Set(shown.filter((r) => !r.posted).map((r) => r.id)))}
                    className={allOn ? "collect-chk collect-chk-on" : "collect-chk"}>{allOn ? "✓" : ""}</button>
                </th>
                <th>일자</th><th>거래처</th><th>사업자등록번호</th><th>구분</th><th>유형</th><th>품명</th>
                <th className="tr">공급가액</th><th className="tr">부가세</th><th className="tr">합계</th>
                <th>차변계정</th><th>대변계정</th><th>상태</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                //   ★ '3. 일반'은 VAT_TYPES 에 없어 vatType() 이 null 이다 — `!` 로 단정하면
                //     아래에서 t.side 를 읽다 화면이 통째로 죽는다(실제로 그랬다).
                //     매입(purchase) 쪽으로 취급한다 — 카드 사용은 언제나 우리가 쓴 돈이다. (2026-08-12)
                const vt = vatType(vatCodeOf(r));
                const isGeneral = vatCodeOf(r) === GENERAL_CODE;
                const t = vt ?? { code: GENERAL_CODE, label: "3. 일반", side: "purchase" as const, taxed: false, deductible: false, hint: "", defaultSettle: "card" as const };
                const { acct, via } = acctOf(r);
                const lines = linesFor(r);
                const debit = lines.filter((l) => l.side === "debit");
                const credit = lines.filter((l) => l.side === "credit");
                const main = t.side === "sale" ? credit[0] : debit[0];
                const counter = t.side === "sale" ? debit[0] : credit[credit.length - 1];
                const on = sel.has(r.id);
                return (
                  <tr key={r.id} className={r.posted ? "ev-posted" : on ? "ev-on" : ""}>
                    <td>
                      {!r.posted && (
                        <button type="button" onClick={() => toggle(r.id)} aria-label="선택"
                          className={on ? "collect-chk collect-chk-on" : "collect-chk"}>{on ? "✓" : ""}</button>
                      )}
                    </td>
                    <td className="mono-number">{r.date.slice(5)}</td>
                    <td className="ev-ell">{r.partnerName}</td>
                    <td className="mono-number ev-dim">{r.bizno || "—"}</td>
                    {/*   구분 — 법인·일반·간이·면세. 카드 원자료엔 없어 국세청 조회로 채운다 (2026-08-12) */}
                    <td className="tc">
                      {merchantKinds[r.bizno.replace(/[^0-9]/g, "")]
                        ? <em className="ev-kind">{merchantKinds[r.bizno.replace(/[^0-9]/g, "")]}</em>
                        : <span className="ev-dim">—</span>}
                    </td>
                    <td>
                      {r.posted ? (
                        <em className={t.side === "sale" ? "spv-type spv-type-s" : "spv-type spv-type-b"}>{isGeneral ? "일반" : t.label.split(". ")[1]}</em>
                      ) : (
                        <select className="ev-sel" value={vatCodeOf(r)}
                          onChange={(e) => setOverride((o) => ({ ...o, [r.id]: { ...o[r.id], vatCode: e.target.value } }))}>
                          {typeOptions.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="ev-ell">{r.item}</td>
                    <td className={r.supply < 0 ? "tr mono-number ev-minus" : "tr mono-number"}>{won(r.supply)}</td>
                    <td className="tr mono-number">{won(r.vat)}</td>
                    <td className="tr mono-number ev-total">{won(r.supply + r.vat)}</td>
                    <td>
                      {t.side === "purchase" && !r.posted ? (
                        <span className="relative inline-block">
                          <button type="button" onClick={() => setPick(pick?.id === r.id ? null : { id: r.id, q: "" })}
                            className={acct ? "ev-acct" : "ev-acct ev-acct-empty"}>
                            {acct ? `${acct.code} ${acct.name}` : "비용 계정 고르기"}
                            {via && via !== "고름" && <em className="ev-via">{via}</em>}
                          </button>
                          {pick?.id === r.id && (
                            <PickList items={acctsOf("purchase")} placeholder="계정과목 검색 (이름·코드)"
                              onPick={(a) => { setOverride((o) => ({ ...o, [r.id]: { ...o[r.id], acct: a } })); setPick(null); }}
                              onClose={() => setPick(null)} />
                          )}
                        </span>
                      ) : (
                        <span className="ev-dim">{debit[0]?.code ? `${debit[0].code} ${debit[0].name}` : "—"}</span>
                      )}
                    </td>
                    <td>
                      {t.side === "sale" && !r.posted ? (
                        <span className="relative inline-block">
                          <button type="button" onClick={() => setPick(pick?.id === r.id ? null : { id: r.id, q: "" })}
                            className={acct ? "ev-acct" : "ev-acct"}>
                            {main?.code ? `${main.code} ${main.name}` : "매출 계정"}
                            {via && via !== "고름" && <em className="ev-via">{via}</em>}
                          </button>
                          {pick?.id === r.id && (
                            <PickList items={acctsOf("sale")} placeholder="계정과목 검색 (이름·코드)"
                              onPick={(a) => { setOverride((o) => ({ ...o, [r.id]: { ...o[r.id], acct: a } })); setPick(null); }}
                              onClose={() => setPick(null)} />
                          )}
                        </span>
                      ) : (
                        <span className="ev-dim">{counter?.code ? `${counter.code} ${counter.name}` : "—"}</span>
                      )}
                    </td>
                    <td>
                      {r.posted
                        ? <span className="ev-st ev-st-done">#{r.voucherNo ?? "—"} 확정</span>
                        : <span className="ev-st ev-st-todo">미처리</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="collect-note">
        ※ 계정은 <b>전에 고른 것</b>을 배워 두었다가 미리 붙입니다 —
        1~2번은 <b>지난번</b>, 3번 이상이면 <b>학습</b> 꼬리표가 붙습니다.
        다른 계정을 고르면 그쪽 횟수가 올라 <b>결국 뒤집힙니다</b>.
        <b>제안은 자동, 확정은 사람</b> — 전표는 <b>전표 만들기</b>를 눌러야 생깁니다.
        만든 전표는 <b>매입매출전표</b> 메뉴에서 그대로 보이고, 지우면 이 목록으로 되돌아옵니다.
      </p>
    </div>
  );
}

const REF_TYPE: Record<string, string> = {
  tax_invoice: "tax_invoice", exempt_invoice: "tax_invoice",
  cash_receipt: "cash_receipt", card: "card_transaction",
};

/** 이미 전표가 된 줄에 전표번호를 붙인다 — '#3 확정'처럼 어느 전표인지 보여야 찾아갈 수 있다 */
async function attachVoucherNo(rows: Row[], entryIds: (string | null)[]): Promise<Row[]> {
  const ids = [...new Set(entryIds.filter(Boolean) as string[])];
  if (ids.length === 0) return rows;
  const data = logRead("collect:voucherno", await supabase
    .from("journal_entries").select("id, voucher_no").in("id", ids));
  const byId = new Map(((data as any[]) || []).map((e) => [e.id, e.voucher_no as number | null]));
  return rows.map((r, i) => {
    const eid = entryIds[i];
    return eid ? { ...r, voucherNo: byId.get(eid) ?? null } : r;
  });
}

// ── 자료별 읽기 ───────────────────────────────────────────────────────────
async function fetchRows(companyId: string, from: string, to: string, kind: SourceKey): Promise<Row[]> {
  const settle = SETTLE_BY_KIND[kind] ?? "credit";

  if (kind === "card") {
    const data = logRead("collect:rows-card", await supabase.from("card_transactions")
      .select("id, transaction_date, merchant_name, amount, category, classification, journal_entry_id, raw_data")
      .eq("company_id", companyId)
      .gte("transaction_date", from).lte("transaction_date", to)
      .order("transaction_date").limit(500));
    const src = ((data as any[]) || []).filter((r) => Number(r.amount || 0) !== 0);
    const built = src.map((r) => {
      const amt = Number(r.amount || 0);
      const label = cardLabelOf(r.classification) || r.category || "";
      const supply = Math.round(amt / 1.1);
      return {
        id: r.id, date: String(r.transaction_date),
        //   카드 원자료의 가맹점 사업자번호 — 과세유형(구분)을 국세청에서 찾을 열쇠다 (2026-08-12)
        partnerId: null, partnerName: r.merchant_name || "—", bizno: String(r.raw_data?.merchantBusinessNo || ""),
        item: label || "카드 사용", supply, vat: amt - supply,
        vatCode: suggestVatType({ kind: "card", direction: "purchase", memo: `${r.merchant_name || ""} ${label}` }),
        settle, posted: !!r.journal_entry_id, voucherNo: null, cardCategory: r.category || null,
      } as Row;
    });
    return attachVoucherNo(built, src.map((r) => r.journal_entry_id ?? null));
  }

  if (kind === "cash_receipt") {
    const data = logRead("collect:rows-cash", await supabase.from("cash_receipts")
      .select("id, type, issue_date, counterparty_name, counterparty_bizno, supply_amount, tax_amount, amount, journal_entry_id")
      .eq("company_id", companyId)
      .gte("issue_date", from).lte("issue_date", to)
      .order("issue_date").limit(500));
    const src = ((data as any[]) || []);
    const built = src.map((r) => {
      const supply = Number(r.supply_amount || 0) || Math.round(Number(r.amount || 0) / 1.1);
      const direction = r.type === "income" ? "sale" : "purchase";
      return {
        id: r.id, date: String(r.issue_date),
        partnerId: null, partnerName: r.counterparty_name || "—", bizno: r.counterparty_bizno || "",
        item: "현금영수증", supply,
        vat: Number(r.tax_amount || 0) || (Number(r.amount || 0) - supply),
        vatCode: suggestVatType({ kind: "cash_receipt", direction }),
        settle, posted: !!r.journal_entry_id, voucherNo: null,
      } as Row;
    });
    return attachVoucherNo(built, src.map((r) => r.journal_entry_id ?? null));
  }

  //   세금계산서 / 전자계산서 — 같은 표(tax_invoices)에 tax_kind 로 갈린다
  const q = supabase.from("tax_invoices")
    .select("id, type, issue_date, counterparty_name, counterparty_bizno, partner_id, item_name, supply_amount, tax_amount, tax_kind, expense_category, journal_entry_id")
    .eq("company_id", companyId).neq("status", "void")
    .gte("issue_date", from).lte("issue_date", to)
    .order("issue_date").limit(500);
  const data = logRead("collect:rows-ti", await (kind === "exempt_invoice" ? q.eq("tax_kind", "exempt") : q.neq("tax_kind", "exempt")));
  const src = ((data as any[]) || []);
  const built = src.map((r) => {
    const direction = (r.type === "sales" || r.type === "매출") ? "sale" : "purchase";
    return {
      id: r.id, date: String(r.issue_date),
      partnerId: r.partner_id || null, partnerName: r.counterparty_name || "—", bizno: r.counterparty_bizno || "",
      item: r.item_name || "—",
      supply: Number(r.supply_amount || 0), vat: Number(r.tax_amount || 0),
      vatCode: suggestVatType({
        kind: "tax_invoice", direction, taxKind: r.tax_kind,
        memo: `${r.item_name || ""} ${r.expense_category || ""}`,
      }),
      settle, posted: !!r.journal_entry_id, voucherNo: null,
    } as Row;
  });
  return attachVoucherNo(built, src.map((r) => r.journal_entry_id ?? null));
}
