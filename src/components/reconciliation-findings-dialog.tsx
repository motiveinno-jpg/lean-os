"use client";
// 숫자 대조·국세청 확인 결과 창 — 알림 주소에 ?findings=bank|nts 가 붙으면 앱 어디서든 연다(app-shell 에 한 번).
//   결과는 매일 대조(reconcile_company)·매주 국세청 확인(record_nts_findings)이 reconciliation_findings 에 쌓는다.
//   여기서 사람이 보는 것: 무엇이 왜 걸렸는지 + 관련 거래 줄. 할 수 있는 것: 중복 줄 하나 지우기 · '문제 없음' 표시 · 다시 대조.
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { appConfirm } from "@/components/global-confirm";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";

type Finding = {
  id: string; kind: string; subject_key: string; title: string; detail: Record<string, unknown>;
  first_seen_at: string; dismissed_at: string | null;
};
type TxRow = {
  id: string; transaction_date: string; amount: number; type?: string | null; counterparty?: string | null;
  description?: string | null; merchant_name?: string | null; card_name?: string | null; approval_number?: string | null;
  created_at: string; mapping_status?: string | null; category?: string | null; suggestions?: number;
};

const BANK_KINDS = ["bank_duplicate", "card_duplicate", "bank_balance_gap", "bank_balance_mismatch"];
const NTS_KINDS = ["partner_business_status", "company_business_status", "company_profile_mismatch"];
const KIND_LABEL: Record<string, string> = {
  bank_duplicate: "통장 중복", card_duplicate: "카드 중복", bank_balance_gap: "빠진 거래", bank_balance_mismatch: "잔액 불일치",
  partner_business_status: "거래처 사업자 상태", company_business_status: "우리 회사 사업자 상태", company_profile_mismatch: "회사 기초정보",
};
//   무엇을 하면 되는지 — 종류마다 한 줄
const KIND_HELP: Record<string, string> = {
  bank_duplicate: "같은 계좌·같은 시각·같은 금액·같은 거래 후 잔액인 거래가 두 줄 있습니다. 하나만 남기고 지우세요(분류·연결이 된 줄을 남기는 게 좋습니다).",
  card_duplicate: "같은 카드·같은 승인번호·같은 날·같은 금액이 두 줄 있습니다. 하나만 남기고 지우세요.",
  bank_balance_gap: "이 거래 바로 앞 거래가 장부에 없습니다. 통장 화면에서 그 날짜를 다시 수집해 보세요.",
  bank_balance_mismatch: "은행이 알려 준 통장 잔액과 장부의 마지막 거래 후 잔액이 다릅니다. 최근 거래가 덜 들어왔을 수 있습니다.",
  partner_business_status: "국세청 기준 휴업·폐업·미등록인 거래처입니다. 폐업일 이후 받은 세금계산서는 매입세액 공제가 안 될 수 있습니다.",
  company_business_status: "우리 회사 사업자번호가 국세청 기준 정상이 아닙니다.",
  company_profile_mismatch: "회사 기초정보의 대표자·개업일이 국세청 기록과 다릅니다. 사업자등록증과 맞춰 주세요.",
};
const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString("ko")}원`;

export function ReconciliationFindingsDialog() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const which = params.get("findings");
  const open = which === "bank" || which === "nts";
  const kinds = which === "nts" ? NTS_KINDS : BANK_KINDS;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const close = () => {
    const p = new URLSearchParams(params.toString());
    p.delete("findings");
    router.replace(p.toString() ? `${pathname}?${p}` : pathname);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { data: findings = [], isLoading, refetch } = useQuery<Finding[]>({
    queryKey: ["reconciliation-findings", which],
    enabled: open,
    queryFn: async () => {
      //   생성된 타입에 아직 없는 표(마이그 20261014130000) — 이 조회만 넓게 받는다
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("reconciliation_findings")
        .select("id, kind, subject_key, title, detail, first_seen_at, dismissed_at")
        .is("resolved_at", null).in("kind", kinds)
        .order("dismissed_at", { ascending: true, nullsFirst: true }).order("kind").order("first_seen_at")
        .limit(300);
      if (error) throw error;
      return (data || []) as unknown as Finding[];
    },
  });

  //   중복 건의 실제 거래 줄 — 나란히 보고 어느 줄을 지울지 고른다
  const bankIds = findings.filter((f) => f.kind === "bank_duplicate").flatMap((f) => (f.detail.bank_transaction_ids as string[]) || []);
  const cardIds = findings.filter((f) => f.kind === "card_duplicate").flatMap((f) => (f.detail.card_transaction_ids as string[]) || []);
  const { data: rows = {} } = useQuery<Record<string, TxRow>>({
    queryKey: ["reconciliation-finding-rows", bankIds.join(","), cardIds.join(",")],
    enabled: open && (bankIds.length > 0 || cardIds.length > 0),
    queryFn: async () => {
      const out: Record<string, TxRow> = {};
      if (bankIds.length) {
        const [{ data: b }, { data: s }] = await Promise.all([
          supabase.from("bank_transactions").select("id, transaction_date, amount, type, counterparty, description, created_at, mapping_status, category").in("id", bankIds),
          supabase.from("invoice_settlements").select("bank_transaction_id").in("bank_transaction_id", bankIds),
        ]);
        const sc: Record<string, number> = {};
        for (const x of (s || []) as { bank_transaction_id: string }[]) sc[x.bank_transaction_id] = (sc[x.bank_transaction_id] || 0) + 1;
        for (const r of (b || []) as unknown as TxRow[]) out[r.id] = { ...r, suggestions: sc[r.id] || 0 };
      }
      if (cardIds.length) {
        const { data: c } = await supabase.from("card_transactions").select("id, transaction_date, amount, merchant_name, card_name, approval_number, created_at, mapping_status, category").in("id", cardIds);
        for (const r of (c || []) as unknown as TxRow[]) out[r.id] = r;
      }
      return out;
    },
  });

  const refreshAll = async () => {
    await refetch();
    qc.invalidateQueries({ queryKey: ["reconciliation-finding-rows"] });
  };

  const recheck = async () => {
    setBusy("recheck");
    try {
      const { error } = await supabase.rpc("recheck_my_reconciliation" as never);
      if (error) throw error;
      await refreshAll();
      toast("다시 대조했습니다", "success");
    } catch (e) { toast(friendlyError(e, "다시 대조하지 못했습니다"), "error"); }
    finally { setBusy(null); }
  };

  const removeRow = async (f: Finding, row: TxRow) => {
    const table = f.kind === "card_duplicate" ? "card_transactions" : "bank_transactions";
    const what = f.kind === "card_duplicate" ? `${row.transaction_date} ${row.merchant_name || ""} ${won(row.amount)}` : `${row.transaction_date} ${row.counterparty || row.description || ""} ${won(row.amount)}`;
    if (!(await appConfirm(`이 줄을 지울까요?\n${what}\n같은 거래의 다른 줄은 그대로 남습니다.`, { danger: true }))) return;
    setBusy(row.id);
    try {
      const { data, error } = await supabase.from(table).delete().eq("id", row.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("지우지 못했습니다. 권한이 없거나 이미 지워진 줄입니다.");
      //   지운 뒤 바로 다시 대조 — 같은 건이 해결로 바뀐다(권한이 없으면 다음 날 아침 대조에서)
      await supabase.rpc("recheck_my_reconciliation" as never);
      await refreshAll();
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
      toast("중복 줄을 지웠습니다", "success");
    } catch (e) { toast(friendlyError(e, "지우지 못했습니다"), "error"); }
    finally { setBusy(null); }
  };

  const dismiss = async (f: Finding, on: boolean) => {
    setBusy(f.id);
    try {
      const { error } = await supabase.rpc("dismiss_reconciliation_finding" as never, { p_id: f.id, p_dismiss: on } as never);
      if (error) throw error;
      await refetch();
    } catch (e) { toast(friendlyError(e, "표시하지 못했습니다"), "error"); }
    finally { setBusy(null); }
  };

  if (!open) return null;
  const openOnes = findings.filter((f) => !f.dismissed_at);
  const dismissed = findings.filter((f) => f.dismissed_at);

  const rowLine = (f: Finding, id: string, i: number) => {
    const r = (rows as Record<string, TxRow>)[id];
    if (!r) return <div key={id} className="rf-row rf-dim">불러오는 중이거나 이미 지워진 줄입니다.</div>;
    const isCard = f.kind === "card_duplicate";
    return (
      <div key={id} className="rf-row">
        <span className="rf-row-tag">{i === 0 ? "먼저 들어온 줄" : "나중에 들어온 줄"}</span>
        <span className="rf-row-main">
          {isCard ? `${r.card_name || "카드"} · ${r.merchant_name || "가맹점"} · 승인 ${r.approval_number || "-"}` : `${r.counterparty || "(예금주 없음)"} · ${r.description || "-"}`}
        </span>
        <span className="rf-row-meta">
          {r.category ? `분류 ${r.category}` : "분류 없음"}{!isCard && r.suggestions ? ` · 대금 맞춤 ${r.suggestions}건` : ""} · 들어온 날 {String(r.created_at).slice(0, 10)}
        </span>
        <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => void removeRow(f, r)}>
          {busy === r.id ? "지우는 중…" : "이 줄 지우기"}
        </button>
      </div>
    );
  };

  const item = (f: Finding) => {
    const ids = ((f.kind === "card_duplicate" ? f.detail.card_transaction_ids : f.detail.bank_transaction_ids) as string[] | undefined) || [];
    const partnerIds = (f.detail.partner_ids as string[] | undefined) || [];
    return (
      <div key={f.id} className={f.dismissed_at ? "rf-item rf-item-dismissed" : "rf-item"}>
        <div className="rf-item-head">
          <span className="rf-kind">{KIND_LABEL[f.kind] || f.kind}</span>
          <span className="rf-title">{f.title}</span>
          <span className="rf-since">{String(f.first_seen_at).slice(0, 10)}부터</span>
        </div>
        {!f.dismissed_at && <p className="rf-help">{KIND_HELP[f.kind]}</p>}
        {!f.dismissed_at && (f.kind === "bank_duplicate" || f.kind === "card_duplicate") && <div className="rf-rows">{ids.map((id, i) => rowLine(f, id, i))}</div>}
        <div className="rf-actions">
          {f.kind === "partner_business_status" && partnerIds[0] && <Link className="btn-secondary btn-sm" href={`/partners?id=${partnerIds[0]}`} onClick={close}>거래처 보기</Link>}
          {(f.kind === "company_business_status" || f.kind === "company_profile_mismatch") && <Link className="btn-secondary btn-sm" href="/settings/company" onClick={close}>회사 기초정보</Link>}
          {(f.kind === "bank_balance_gap" || f.kind === "bank_balance_mismatch") && <Link className="btn-secondary btn-sm" href="/bank" onClick={close}>통장 화면</Link>}
          <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => void dismiss(f, !f.dismissed_at)}>
            {f.dismissed_at ? "되돌리기" : "문제 없음"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="rf-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="rf-modal" role="dialog" aria-modal="true" aria-label="대조 결과">
        <div className="rf-head">
          <div>
            <h3 className="rf-modal-title">{which === "nts" ? "국세청 기록 확인 결과" : "통장·카드 숫자 대조 결과"}</h3>
            <p className="rf-modal-desc">
              {isLoading ? "불러오는 중…" : `확인할 곳 ${openOnes.length}건${dismissed.length ? ` · 문제 없음으로 둔 것 ${dismissed.length}건` : ""}`}
              {which === "nts" ? " · 매주 월요일 아침에 다시 확인합니다." : " · 매일 아침 다시 대조합니다. '문제 없음'으로 둔 건은 다시 알리지 않습니다."}
            </p>
          </div>
          <button type="button" className="rf-close" aria-label="닫기" onClick={close}>✕</button>
        </div>
        <div className="rf-body">
          {!isLoading && findings.length === 0 && <div className="collect-empty">확인할 곳이 없습니다. (이미 해결됐거나 볼 권한이 없습니다)</div>}
          {openOnes.map(item)}
          {dismissed.length > 0 && <div className="rf-sep">문제 없음으로 둔 것</div>}
          {dismissed.map(item)}
        </div>
        <div className="rf-foot">
          {which === "bank" && <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => void recheck()}>{busy === "recheck" ? "대조 중…" : "지금 다시 대조"}</button>}
          <button type="button" className="btn-primary btn-sm" onClick={close}>닫기</button>
        </div>
      </div>
    </div>
  );
}
