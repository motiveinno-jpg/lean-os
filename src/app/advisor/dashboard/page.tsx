"use client";

// 세무사 포털 — 담당 고객사 대시보드 (2026-08-11)
//   advisor_my_companies RPC 하나로 회사별 요약(당월 매출·매입, 잔고, 직원 수)까지 받는다.
//   카드는 "통장 표지" 문법 — 네이비 표지에 회사명, 지면에 숫자 행.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

type ClientCompany = {
  link_id: string; company_id: string; company_name: string; industry: string | null;
  business_number: string | null; representative: string | null; linked_at: string;
  month_sales: number; month_purchase: number; bank_balance: number; employee_count: number;
};

const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;

export default function AdvisorDashboardPage() {
  const router = useRouter();
  const [advisorName, setAdvisorName] = useState<string>("");
  // 세무사 확인이 끝나야만 RPC 발화 — 비세무사 URL 접속 시 not_advisor 거절 로그가
  //   운영자 오류 목록에 쌓이던 것 (2026-08-12 사장님: 게이트 넣어 안 쌓이게)
  const [advisorReady, setAdvisorReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/advisor"); return; }
      const { data } = await (supabase as any)
        .from("tax_advisors").select("name, office_name, status").eq("auth_id", session.user.id).maybeSingle();
      if (!data || data.status !== "active") { router.replace("/advisor"); return; }
      setAdvisorName(data.office_name ? `${data.name} · ${data.office_name}` : data.name);
      setAdvisorReady(true);
    })();
  }, [router]);

  const { data: clients = [], isLoading, error } = useQuery<ClientCompany[]>({
    queryKey: ["advisor-companies"],
    queryFn: async () => {
      const { data, error: err } = await (supabase as any).rpc("advisor_my_companies");
      if (err) throw err;
      return (data || []) as ClientCompany[];
    },
    staleTime: 60_000,
    enabled: advisorReady,
  });

  const logout = async () => {
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/advisor");
  };

  return (
    <div className="min-h-dvh">
      <header className="adv-topbar">
        <div className="adv-topbar-inner">
          <div className="adv-brand">
            <span className="adv-brand-mark">오너뷰</span>
            <span className="adv-brand-sub">Partners</span>
          </div>
          <div className="adv-topbar-user">
            <span>{advisorName}</span>
            <button className="adv-topbar-btn" onClick={logout}>로그아웃</button>
          </div>
        </div>
      </header>

      <main className="adv-shell">
        <h1 className="adv-page-title">담당 고객사</h1>
        <p className="adv-page-desc">
          {clients.length > 0 ? `${clients.length}개사 — 카드를 누르면 그 회사의 장부가 펼쳐집니다.` : "오너뷰 운영팀이 고객사를 연결하면 여기에 나타납니다."}
        </p>

        {isLoading ? (
          <div className="adv-loading">고객사를 불러오는 중…</div>
        ) : error ? (
          <div className="adv-empty">목록을 불러오지 못했습니다. 새로고침해 주세요.</div>
        ) : clients.length === 0 ? (
          <div className="adv-empty">
            아직 연결된 고객사가 없습니다.<br />
            <span className="text-[12.5px]">고객사 연결은 오너뷰 운영팀(creative@mo-tive.com)이 도와드립니다.</span>
          </div>
        ) : (
          <div className="adv-client-grid">
            {clients.map((c) => {
              const maxAmt = Math.max(Number(c.month_sales) || 0, Number(c.month_purchase) || 0, 1);
              return (
                <div key={c.link_id} role="button" tabIndex={0} className="adv-client-card"
                  onClick={() => router.push(`/advisor/c/${c.company_id}`)}
                  onKeyDown={(e) => e.key === "Enter" && router.push(`/advisor/c/${c.company_id}`)}>
                  <div className="adv-client-cover">
                    <div className="adv-client-name">{c.company_name}</div>
                    <div className="adv-client-bizno">
                      {c.business_number || "사업자번호 미등록"}{c.representative ? ` · ${c.representative}` : ""}
                    </div>
                  </div>
                  <div className="adv-client-body">
                    <dl className="adv-client-row"><dt>통장 잔고</dt><dd>{won(c.bank_balance)}</dd></dl>
                    <dl className="adv-client-row">
                      <dt>이번 달 매출</dt>
                      <dd style={{ color: "var(--adv-in)" }}>{won(c.month_sales)}</dd>
                    </dl>
                    <div className="adv-mini-bar-track"><div className="adv-mini-bar-in" style={{ width: `${(Number(c.month_sales) / maxAmt) * 100}%` }} /></div>
                    <dl className="adv-client-row">
                      <dt>이번 달 매입</dt>
                      <dd style={{ color: "var(--adv-out)" }}>{won(c.month_purchase)}</dd>
                    </dl>
                    <div className="adv-mini-bar-track"><div className="adv-mini-bar-out" style={{ width: `${(Number(c.month_purchase) / maxAmt) * 100}%` }} /></div>
                    <dl className="adv-client-row"><dt>재직 인원</dt><dd>{c.employee_count}명</dd></dl>
                    {/* 오너뷰 본앱 진입 (2026-08-11 사장님): 회사 선택 등록 후 실제 앱으로 — 읽기 전용 세션 */}
                    <button
                      className="adv-enter-app-btn"
                      onClick={async (e) => {
                        e.stopPropagation();
                        const { error: err } = await (supabase as any).rpc("advisor_enter_company", { p_company_id: c.company_id });
                        if (!err) window.location.href = "/dashboard";
                      }}
                    >
                      오너뷰로 열람 →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
