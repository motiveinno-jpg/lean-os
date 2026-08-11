"use client";

// 배운 규칙 보기·지우기 (2026-08-11, 수집·전표 4단계)
//
//   자동으로 계정을 붙여 주는 이상, **무엇을 배웠는지 볼 수 있고 지울 수 있어야** 한다.
//   안 보이는 자동화는 틀렸을 때 고칠 방법이 없다. (제안은 자동, 확정은 사람 — 그 원칙의 짝)

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { ruleTag } from "@/lib/voucher-rules";
import { SOURCES } from "@/lib/collect";

type Row = {
  id: string;
  source_kind: string;
  match_label: string;
  match_key: string;
  hit_count: number;
  vat_type: string | null;
  last_used_at: string;
  chart_of_accounts?: { code: string; name: string } | null;
};

const KIND_LABEL: Record<string, string> = Object.fromEntries(SOURCES.map((s) => [s.key, s.label]));

export function RulesDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<string>("all");

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["voucher-rules-all", companyId],
    queryFn: async () => {
      const data = logRead("rules:list", await (supabase as any)
        .from("voucher_account_rules")
        .select("id, source_kind, match_label, match_key, hit_count, vat_type, last_used_at, chart_of_accounts(code, name)")
        .eq("company_id", companyId)
        .order("hit_count", { ascending: false }).order("last_used_at", { ascending: false })
        .limit(500));
      return ((data as any[]) || []) as Row[];
    },
  });

  const remove = async (id: string) => {
    //   RLS 로 막히면 delete 는 **오류 없이 0행**이다 — 그대로 두면 '지웠습니다'만 뜨고
    //   실제로는 남아 있는 조용한 실패가 된다(실제로 겪었다). 지워진 행을 돌려받아 확인한다.
    const { data, error } = await (supabase as any)
      .from("voucher_account_rules").delete().eq("id", id).select("id");
    if (error) { toast("규칙을 지우지 못했습니다", "error"); return; }
    if (!data || (data as any[]).length === 0) {
      toast("규칙을 지울 권한이 없습니다 — 대표·관리자만 지울 수 있습니다", "error");
      return;
    }
    qc.invalidateQueries({ queryKey: ["voucher-rules-all"] });
    qc.invalidateQueries({ queryKey: ["voucher-rules"] });
    toast("규칙을 지웠습니다 — 다음부터는 직접 고릅니다", "success");
  };

  const shown = rows.filter((r) => kind === "all" || r.source_kind === kind);

  return (
    <div className="collect-overlay" onClick={onClose}>
      <div className="collect-box rules-box" onClick={(e) => e.stopPropagation()}>
        <div className="collect-box-head">
          <b>배운 규칙</b>
          <button type="button" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="collect-box-body">
          <div className="collect-seg-row">
            <div className="collect-seg">
              <button type="button" onClick={() => setKind("all")} className={kind === "all" ? "collect-seg-on" : ""}>전체</button>
              {SOURCES.map((s) => (
                <button key={s.key} type="button" onClick={() => setKind(s.key)}
                  className={kind === s.key ? "collect-seg-on" : ""}>{s.label}</button>
              ))}
            </div>
            <span className="collect-dim text-[11px]">{shown.length}개</span>
          </div>

          {isLoading ? (
            <div className="collect-empty">읽는 중…</div>
          ) : shown.length === 0 ? (
            <div className="collect-empty">
              아직 배운 규칙이 없습니다 — 전표를 만들면 그때 고른 계정을 기억합니다.
            </div>
          ) : (
            <div className="ev-scroll">
              <table className="ev-table rules-table">
                <thead>
                  <tr><th>자료</th><th>상대</th><th>계정</th><th>유형</th><th className="tr">배운 횟수</th><th /></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td className="ev-dim">{KIND_LABEL[r.source_kind] || r.source_kind}</td>
                      <td className="ev-ell">{r.match_label || <span className="ev-dim">{r.match_key.slice(0, 18)}…</span>}</td>
                      <td>{r.chart_of_accounts ? `${r.chart_of_accounts.code} ${r.chart_of_accounts.name}` : "—"}</td>
                      <td className="ev-dim">{r.vat_type || "—"}</td>
                      <td className="tr">
                        <span className="ev-via">{ruleTag(r.hit_count)}</span>
                        <b className="mono-number ml-1.5">{r.hit_count}</b>
                      </td>
                      <td className="tr">
                        <button type="button" onClick={() => remove(r.id)} className="rules-del">지우기</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="collect-note">
            ※ 전표를 만들 때 고른 계정을 <b>상대(거래처·가맹점·입금자)별로</b> 기억합니다.
            <b>3번 이상</b>이면 <b>학습</b>, 그 전엔 <b>지난번</b>으로 표시합니다.
            다른 계정을 고르면 그쪽 횟수가 올라 <b>결국 뒤집히므로</b> 굳이 지우지 않아도 됩니다 —
            잘못 배운 게 확실할 때만 지우세요.
          </p>
        </div>
      </div>
    </div>
  );
}
