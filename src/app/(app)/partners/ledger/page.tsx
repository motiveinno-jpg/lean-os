"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllPaginated } from "@/lib/supabase-paginated";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";

// 거래처원장 — 거래처별 매출/매입 세금계산서 합계 + 클릭 시 세부 내역
interface Row {
  vendor: string;
  bizno: string | null;
  salesAmount: number;
  salesCount: number;
  purchaseAmount: number;
  purchaseCount: number;
  net: number; // sales - purchase
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

export default function PartnerLedgerPage() {
  const { role } = useUser();
  if (role === 'employee' || role === 'partner') {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">접근 권한이 없습니다.</div>;
  }
  const [rows, setRows] = useState<Row[]>([]);
  const [details, setDetails] = useState<Record<string, any[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    (async () => {
      const u = await getCurrentUser();
      if (!u) { setLoading(false); return; }
      // 페이지네이션 — PostgREST 1000건 제약 회피
      const all = await fetchAllPaginated<any>((from, to) => {
        let q = (supabase as any)
          .from('tax_invoices')
          .select('id, counterparty_name, counterparty_bizno, total_amount, supply_amount, tax_amount, type, status, issue_date, item_name, nts_confirm_no')
          .eq('company_id', u.company_id)
          .order('issue_date', { ascending: false });
        if (dateFrom) q = q.gte('issue_date', dateFrom);
        if (dateTo) q = q.lte('issue_date', dateTo);
        return q.range(from, to);
      });

      // 거래처별 그룹
      const map = new Map<string, Row & { invoices: any[] }>();
      for (const inv of all) {
        const vendor = (inv.counterparty_name || '(거래처 미상)').trim() || '(거래처 미상)';
        const key = `${vendor}|${inv.counterparty_bizno || ''}`;
        const cur = map.get(key) || {
          vendor, bizno: inv.counterparty_bizno || null,
          salesAmount: 0, salesCount: 0, purchaseAmount: 0, purchaseCount: 0,
          net: 0, invoices: [] as any[],
        };
        const amt = Number(inv.total_amount || 0);
        if (inv.type === 'sales' || inv.type === '매출') {
          cur.salesAmount += amt; cur.salesCount++;
        } else if (inv.type === 'purchase' || inv.type === '매입') {
          cur.purchaseAmount += amt; cur.purchaseCount++;
        }
        cur.invoices.push(inv);
        map.set(key, cur);
      }
      const list = Array.from(map.values())
        .map(v => ({ ...v, net: v.salesAmount - v.purchaseAmount }))
        .sort((a, b) => (b.salesAmount + b.purchaseAmount) - (a.salesAmount + a.purchaseAmount));

      const detailMap: Record<string, any[]> = {};
      for (const v of list) detailMap[v.vendor + '|' + (v.bizno || '')] = (v as any).invoices;

      setRows(list as Row[]);
      setDetails(detailMap);
      setLoading(false);
    })();
  }, [dateFrom, dateTo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.vendor.toLowerCase().includes(q) || (r.bizno || '').includes(q));
  }, [rows, search]);

  const totals = useMemo(() => filtered.reduce((acc, r) => ({
    sales: acc.sales + r.salesAmount,
    purchase: acc.purchase + r.purchaseAmount,
    net: acc.net + r.net,
  }), { sales: 0, purchase: 0, net: 0 }), [filtered]);

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-[var(--text)]">거래처원장</h1>
        <p className="text-xs text-[var(--text-dim)] mt-1">거래처별 매출/매입 세금계산서 합계 · 클릭 시 세부 건별 펼침 · 출처: tax_invoices</p>
      </div>

      {/* 필터 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 p-3 rounded-xl bg-[var(--bg-surface)]">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="거래처/사업자번호 검색"
          className="px-3 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg w-56" />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg" />
        <span className="text-xs text-[var(--text-dim)]">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg" />
        {(search || dateFrom || dateTo) && (
          <button onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); }}
            className="px-2 py-1.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]">초기화</button>
        )}
        <span className="ml-auto text-[11px] text-[var(--text-dim)]">{filtered.length}개 거래처 표시</span>
      </div>

      {/* 합계 카드 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">매출 합계</div>
          <div className="text-base font-bold text-[#10b981] mono-number">₩{fmt(totals.sales)}</div>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">매입 합계</div>
          <div className="text-base font-bold text-[var(--danger)] mono-number">₩{fmt(totals.purchase)}</div>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">순합 (매출−매입)</div>
          <div className={`text-base font-bold mono-number ${totals.net >= 0 ? 'text-[#10b981]' : 'text-[var(--danger)]'}`}>
            ₩{fmt(totals.net)}
          </div>
        </div>
      </div>

      {/* 거래처 표 */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-sm text-[var(--text-dim)]">세금계산서 거래가 없습니다.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-[var(--bg-surface)] sticky top-0 z-10">
              <tr className="text-[11px] text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-4 py-2.5 font-semibold">거래처</th>
                <th className="text-right px-4 py-2.5 font-semibold">매출</th>
                <th className="text-right px-4 py-2.5 font-semibold">매입</th>
                <th className="text-right px-4 py-2.5 font-semibold">순합</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const key = r.vendor + '|' + (r.bizno || '');
                const isExpanded = expanded === key;
                const invs = details[key] || [];
                return (
                  <>
                    <tr key={key}
                      onClick={() => setExpanded(isExpanded ? null : key)}
                      className="cursor-pointer hover:bg-[var(--bg-surface)] border-b border-[var(--border)]/50 transition">
                      <td className="px-4 py-2.5 text-sm">
                        <span className="text-[var(--text-dim)] inline-block w-3">{isExpanded ? '▾' : '▸'}</span>
                        <span className="text-[var(--text)] ml-1">{r.vendor}</span>
                        {r.bizno && <span className="ml-2 text-[10px] text-[var(--text-dim)]">{r.bizno}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right mono-number text-[#10b981]">
                        {r.salesCount > 0 ? <>₩{fmt(r.salesAmount)} <span className="text-[9px] text-[var(--text-dim)]">({r.salesCount})</span></> : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-right mono-number text-[var(--danger)]">
                        {r.purchaseCount > 0 ? <>₩{fmt(r.purchaseAmount)} <span className="text-[9px] text-[var(--text-dim)]">({r.purchaseCount})</span></> : '-'}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold mono-number ${r.net >= 0 ? 'text-[#10b981]' : 'text-[var(--danger)]'}`}>
                        ₩{fmt(r.net)}
                      </td>
                    </tr>
                    {isExpanded && invs.map((inv: any) => (
                      <tr key={inv.id} className="bg-[var(--bg-surface)]/40 border-b border-[var(--border)]/40">
                        <td className="px-4 py-1.5 pl-12 text-[11px] text-[var(--text-muted)]">
                          <span className="mono-number">{inv.issue_date}</span>
                          <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[9px]"
                            style={{ background: (inv.type === 'sales' || inv.type === '매출') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                     color: (inv.type === 'sales' || inv.type === '매출') ? '#10b981' : '#ef4444' }}>
                            {inv.type === 'sales' || inv.type === '매출' ? '매출' : '매입'}
                          </span>
                          {inv.item_name && <span className="ml-2 text-[var(--text-dim)]">{inv.item_name}</span>}
                          {inv.nts_confirm_no && <span className="ml-2 text-[9px] text-[var(--text-dim)]">{inv.nts_confirm_no}</span>}
                        </td>
                        <td colSpan={2} className="px-4 py-1.5 text-[10px] text-[var(--text-dim)]">
                          <span className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] text-[var(--text-muted)]">{inv.status}</span>
                        </td>
                        <td className="px-4 py-1.5 text-right text-[11px] font-semibold mono-number text-[var(--text)]">
                          ₩{fmt(Number(inv.total_amount || 0))}
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
