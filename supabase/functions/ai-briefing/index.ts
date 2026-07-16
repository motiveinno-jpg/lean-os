import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AI 경영 브리핑 2.0 (2026-07-10) — "숫자 요약 한 단락" → "실행 가능한 아침 액션 플랜".
//   ① 서버가 직접 데이터 수집(service role): 미수 상위 거래처(이름·금액·경과일), 결재 대기 상위,
//      이번달/지난달 매출, 최근 7일 대형 지출 — 클라이언트가 준 요약 숫자에만 의존하지 않음(정확성).
//   ② claude-opus-4-8 + 구조화 출력(json_schema): headline/summary/actions[]/risks[]/wins[] —
//      액션마다 우선순위·이동 링크 키가 붙어 클라이언트가 바로가기 버튼으로 렌더(실행성).
//   ③ cron 모드(x-brief-secret): 매일 아침 서버가 회사별로 선생성 + 대표에게 알림(웹푸시 연동) — 자동화.
//   비용 통제: 회사당 하루 1회 캐시(ai_briefings). force=true 로 재생성 가능(대표 버튼).
//   fail-open: 어느 단계든 실패하면 { content: null } → 클라이언트 규칙 브리핑 폴백.

const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
const briefSecret = Deno.env.get("BRIEF_CRON_SECRET"); // cron 내부 인증 (아침 선생성)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brief-secret",
};

const won = (n: number): string => {
  const abs = Math.abs(Math.round(n));
  const eok = Math.floor(abs / 1e8);
  const man = Math.floor((abs % 1e8) / 1e4);
  const sign = n < 0 ? "-" : "";
  if (eok > 0 && man > 0) return `${sign}${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${sign}${eok}억원`;
  if (man > 0) return `${sign}${man.toLocaleString()}만원`;
  return `${sign}${abs.toLocaleString()}원`;
};

type Nums = {
  balance: number; forecast30: number; forecast90: number; runwayMonths: number;
  monthlyBurn: number; arOver30: number; pendingApprovals: number; riskCount: number;
  monthRevenue: number; monthTarget: number;
};
type Actions = {
  taxDeadlines?: Array<{ title: string; daysLeft: number }>;
  todos?: Array<{ title: string; priority: number; dueDate: string | null; overdue: boolean }>;
};

const PRIO = ["보통", "높음", "긴급"];

// ── 서버 측 스냅샷 — 각 쿼리는 fail-soft(실패 시 그 항목만 생략) ──
async function collectSnapshot(admin: ReturnType<typeof createClient>, companyId: string) {
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const today = kstNow.toISOString().slice(0, 10);
  const d30 = new Date(kstNow.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const prev = new Date(kstNow.getFullYear(), kstNow.getMonth() - 1, 1);
  const prevStart = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`;
  const d7 = new Date(kstNow.getTime() - 7 * 86400000).toISOString().slice(0, 10);

  const out: string[] = [];
  // 1) 30일+ 미수 상위 거래처 (이름·금액·최장 경과) — "누구한테 얼마 받을지"를 콕 집게
  try {
    const { data } = await admin.from("tax_invoices")
      .select("counterparty_name, total_amount, issue_date")
      .eq("company_id", companyId).eq("type", "sales")
      .not("status", "in", "(matched,void)")
      .lte("issue_date", d30).order("total_amount", { ascending: false }).limit(200);
    if (data && data.length) {
      const byName = new Map<string, { sum: number; oldest: string }>();
      for (const r of data as any[]) {
        const k = String(r.counterparty_name || "미상").replace(/\+/g, " ");
        const cur = byName.get(k) || { sum: 0, oldest: r.issue_date };
        cur.sum += Number(r.total_amount || 0);
        if (r.issue_date < cur.oldest) cur.oldest = r.issue_date;
        byName.set(k, cur);
      }
      const top = [...byName.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 5);
      const days = (d: string) => Math.round((kstNow.getTime() - new Date(d).getTime()) / 86400000);
      out.push("30일+ 미수 상위 거래처(미매칭 매출 계산서 기준):\n" +
        top.map(([n, v]) => `- ${n}: ${won(v.sum)} (최장 ${days(v.oldest)}일 경과)`).join("\n"));
    }
  } catch { /* skip */ }
  // 2) 결재 대기 상위
  try {
    const { data } = await admin.from("approval_requests")
      .select("title, amount, created_at")
      .eq("company_id", companyId).eq("status", "pending")
      .order("created_at", { ascending: true }).limit(50);
    if (data && data.length) {
      const tops = (data as any[]).slice(0, 3)
        .map((r) => `- ${r.title}${Number(r.amount) > 0 ? ` (${won(Number(r.amount))})` : ""} · ${String(r.created_at).slice(0, 10)} 접수`);
      out.push(`승인 대기 결재 ${data.length}건 (가장 오래된 순):\n${tops.join("\n")}`);
    }
  } catch { /* skip */ }
  // 3) 매출 추이 — 이번달 vs 지난달(전체)
  try {
    const [cur, prv] = await Promise.all([
      admin.from("tax_invoices").select("supply_amount").eq("company_id", companyId)
        .eq("type", "sales").neq("status", "void").gte("issue_date", monthStart),
      admin.from("tax_invoices").select("supply_amount").eq("company_id", companyId)
        .eq("type", "sales").neq("status", "void").gte("issue_date", prevStart).lt("issue_date", monthStart),
    ]);
    const sum = (d: any) => (d.data || []).reduce((s: number, r: any) => s + Number(r.supply_amount || 0), 0);
    out.push(`매출(공급가): 이번달 현재 ${won(sum(cur))} / 지난달 전체 ${won(sum(prv))}`);
  } catch { /* skip */ }
  // 4) 최근 7일 대형 지출 3건 — 이상 지출 감지 재료
  try {
    const { data } = await admin.from("bank_transactions")
      .select("counterparty, description, amount, transaction_date")
      .eq("company_id", companyId).eq("type", "expense")
      .gte("transaction_date", d7).order("amount", { ascending: true }).limit(3); // expense 는 음수 → 오름차순=큰 지출
    if (data && data.length) {
      out.push("최근 7일 대형 지출:\n" + (data as any[])
        .map((r) => `- ${r.counterparty || r.description || "미상"}: ${won(Math.abs(Number(r.amount || 0)))} (${r.transaction_date})`).join("\n"));
    }
  } catch { /* skip */ }
  return out.join("\n\n");
}

// ── 구조화 출력 스키마 — 액션 플랜 ──
const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "actions", "risks", "wins"],
  properties: {
    headline: { type: "string", description: "오늘 가장 중요한 것 한 줄 (20자 내외, 명사형 종결 가능)" },
    summary: {
      type: "string",
      description: "오늘 상황 요약 2~3문장. 금액·건수·기한은 <neg>(위험)/<pos>(긍정)/<key>(핵심) 태그로 감싼다. 마크다운·이모지 금지.",
    },
    actions: {
      type: "array",
      description: "오늘 실행할 우선순위 플랜 3~5개. 정말 급한 것부터.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "priority", "link"],
        properties: {
          title: { type: "string", description: "행동 명령형 한 줄 (예: '라온제나 미수금 330만원 회수 연락')" },
          detail: { type: "string", description: "왜 지금 해야 하는지 + 구체적 방법 1문장" },
          priority: { type: "string", enum: ["긴급", "중요", "권장"] },
          link: {
            type: "string",
            enum: ["ar", "approvals", "tax", "todo", "bank", "payments", "pnl", "invoices", "none"],
            description: "이 행동을 실행할 화면: ar=미수금 회수(거래처 원장), approvals=결재, tax=부가세, todo=할일/일정, bank=통장, payments=지급/정기결제, pnl=손익, invoices=세금계산서, none=해당 없음",
          },
        },
      },
    },
    risks: { type: "array", items: { type: "string" }, description: "주시할 리스크 0~3개 (한 줄씩, 태그 사용 가능)" },
    wins: { type: "array", items: { type: "string" }, description: "잘 되고 있는 것 0~2개 (한 줄씩, 태그 사용 가능)" },
  },
} as const;

async function generate(n: Nums | null, a: Actions, companyName: string, snapshot: string): Promise<string> {
  const facts = n ? [
    `현재 통장 잔고: ${won(n.balance)}`,
    n.forecast30 ? `30일 후 예상 잔고: ${won(n.forecast30)} (증감 ${won(n.forecast30 - n.balance)})` : "",
    n.forecast90 ? `90일 후 예상 잔고: ${won(n.forecast90)}` : "",
    n.monthlyBurn ? `월 고정비(소진 속도): ${won(n.monthlyBurn)}` : "",
    n.runwayMonths ? `현재 자금으로 버틸 수 있는 기간: 약 ${n.runwayMonths.toFixed(1)}개월` : "",
    n.arOver30 ? `30일 넘게 밀린 미수금 총액: ${won(n.arOver30)}` : "",
    n.riskCount ? `주의가 필요한 프로젝트: ${n.riskCount}건` : "",
    n.monthTarget > 0 ? `이번 달 매출: ${won(n.monthRevenue)} (목표 ${won(n.monthTarget)}, 달성률 ${Math.round((n.monthRevenue / n.monthTarget) * 100)}%)` : "",
  ].filter(Boolean).join("\n") : "(재무 전망 데이터 없음 — 아래 상세 데이터만 사용)";

  const taxLines = (a.taxDeadlines || []).slice(0, 4).map((t) => `- ${t.title}: ${t.daysLeft <= 0 ? "오늘 마감" : `D-${t.daysLeft}`}`);
  const todoLines = (a.todos || []).slice(0, 8).map((t) => `- [${PRIO[t.priority] || "보통"}] ${t.title}${t.overdue ? " (기한 지남)" : t.dueDate ? ` (마감 ${t.dueDate})` : ""}`);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": anthropicKey!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: BRIEF_SCHEMA } },
      messages: [{
        role: "user",
        content: `너는 중소기업 대표 곁의 유능한 경영 참모다. 우리 회사(${companyName || "회사"})의 오늘 데이터를 보고, 대표가 아침에 읽고 그대로 실행할 수 있는 "오늘의 액션 플랜"을 한국어 존댓말로 만들어라.

원칙:
1) 액션은 추상적 훈수("미수금을 관리하세요")가 아니라 데이터의 실명·실액을 박은 구체 행동("OO에 ${won(3300000)} 미수금 회수 연락")으로 쓴다. 아래 상세 데이터의 거래처명·금액·건수를 그대로 인용하라.
2) 우선순위 판단 기준: 기한 지난 할 일 > D-3 이내 세금·마감 > 현금 위험(런웨이 3개월 미만·잔고 급감) > 금액 큰 미수금 > 오래 묵은 결재 > 매출 목표 격차. '긴급'은 오늘 안 하면 손해가 나는 것에만 붙인다.
3) 제공된 숫자만 사용한다. 데이터에 없는 금액·건수·이름을 지어내지 마라. 급한 게 없으면 없다고 쓰고 중장기 액션(권장)을 제안하라.
4) summary 의 금액·건수·기한은 반드시 <neg>/<pos>/<key> 태그 중 하나로 감싼다(이 3종만). risks/wins 도 같은 태그 사용 가능.
5) 재무가 안정적이면 wins 에 짧게 담고 불안 조성하지 마라. 위험하면 risks 와 긴급 액션으로 명확히.

[오늘 재무 요약]
${facts}

[세금 마감]
${taxLines.length ? taxLines.join("\n") : "없음"}

[대표 할 일 목록]
${todoLines.length ? todoLines.join("\n") : "없음"}

[상세 데이터 — 실명·실액 인용 소스]
${snapshot || "(상세 데이터 없음)"}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}`);
  const data = await res.json();
  const textBlock = (data?.content || []).find((b: any) => b.type === "text");
  const text = String(textBlock?.text || "").trim();
  if (!text) throw new Error("empty");
  JSON.parse(text); // 구조 검증 (스키마 강제라 통과 예상 — 실패 시 fail-open)
  return text;
}

// ── cron 모드 — 회사별 선생성 + 대표 알림(웹푸시 연동) ──
async function runCron(admin: ReturnType<typeof createClient>): Promise<Response> {
  const briefDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  // 최근 30일 내 매출 계산서가 있는 활성 회사만 (조용한 회사는 생성 생략 — 비용·노이즈 절감)
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { data: activeRows } = await admin.from("tax_invoices")
    .select("company_id").gte("issue_date", since).limit(2000);
  const companyIds = [...new Set((activeRows || []).map((r: any) => r.company_id))].slice(0, 20);

  let generated = 0, notified = 0;
  for (const companyId of companyIds) {
    try {
      const { data: cached } = await admin.from("ai_briefings")
        .select("id").eq("company_id", companyId).eq("brief_date", briefDate).maybeSingle();
      if (cached) continue; // 이미 생성됨

      const { data: comp } = await admin.from("companies").select("name").eq("id", companyId).maybeSingle();
      // 서버 측 근사 재무: 잔고=bank_accounts 합, 번레이트=정기결제+급여, 런웨이=잔고/번
      let nums: Nums | null = null;
      try {
        const [{ data: accts }, { data: recs }, { data: emps }] = await Promise.all([
          admin.from("bank_accounts").select("balance").eq("company_id", companyId),
          admin.from("recurring_payments").select("amount").eq("company_id", companyId).eq("is_active", true),
          admin.from("employees").select("salary").eq("company_id", companyId).eq("status", "active"),
        ]);
        const balance = (accts || []).reduce((s: number, r: any) => s + Number(r.balance || 0), 0);
        const burn = (recs || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0)
          + (emps || []).reduce((s: number, r: any) => s + Number(r.salary || 0), 0);
        nums = {
          balance, monthlyBurn: burn, runwayMonths: burn > 0 ? balance / burn : 0,
          forecast30: 0, forecast90: 0, arOver30: 0, pendingApprovals: 0, riskCount: 0,
          monthRevenue: 0, monthTarget: 0,
        };
      } catch { /* nums 없이 진행 */ }

      // 세금 마감 서버 계산 (부가세 25일 / 원천세 10일)
      const kst = new Date(Date.now() + 9 * 3600 * 1000);
      const nextDue = (day: number) => {
        const d = new Date(kst.getFullYear(), kst.getMonth(), day);
        if (kst.getDate() > day) d.setMonth(d.getMonth() + 1);
        return Math.round((d.getTime() - new Date(kst.getFullYear(), kst.getMonth(), kst.getDate()).getTime()) / 86400000);
      };
      const taxDeadlines = [
        { title: "부가세 신고/납부", daysLeft: nextDue(25) },
        { title: "원천세 납부", daysLeft: nextDue(10) },
      ].filter((t) => t.daysLeft <= 30);

      const snapshot = await collectSnapshot(admin, companyId as string);
      const content = await generate(nums, { taxDeadlines }, String(comp?.name || ""), snapshot);
      await admin.from("ai_briefings").upsert(
        { company_id: companyId, brief_date: briefDate, content },
        { onConflict: "company_id,brief_date" },
      );
      generated++;

      // 대표(owner)에게 알림 — notifications insert → 트리거가 웹푸시 자동 발송
      try {
        const parsed = JSON.parse(content);
        const { data: owners } = await admin.from("users")
          .select("id").eq("company_id", companyId).eq("role", "owner").limit(3);
        for (const o of (owners || []) as any[]) {
          await admin.from("notifications").insert({
            company_id: companyId, user_id: o.id, type: "system",
            title: "오늘의 AI 경영 브리핑", message: parsed.headline || "아침 브리핑이 준비됐습니다",
            link: "/dashboard",
          });
          notified++;
        }
      } catch { /* 알림 실패는 무시 */ }
    } catch { /* 회사 하나 실패해도 다음 회사 진행 */ }
  }
  return new Response(JSON.stringify({ generated, notified, companies: companyIds.length }), {
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const fail = () => new Response(JSON.stringify({ content: null }), { headers: { ...CORS, "content-type": "application/json" } });
  try {
    if (!anthropicKey) return fail();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // cron 내부 호출 — 시크릿 인증 (매일 아침 선생성 + 알림)
    if (briefSecret && req.headers.get("x-brief-secret") === briefSecret) {
      return await runCron(admin);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return fail();
    const { data: { user } } = await createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser();
    if (!user) return fail();

    const { data: urow } = await admin.from("users").select("company_id").eq("auth_id", user.id).maybeSingle();
    const companyId = urow?.company_id;
    if (!companyId) return fail();

    // AI 브리핑은 울트라/엔터프라이즈 전용 — 서버 강제. 비-울트라는 fail()=규칙 브리핑 폴백(무료 AI 사용 차단).
    const { data: subRow } = await admin.from("subscriptions")
      .select("plan_slug")
      .eq("company_id", companyId)
      .in("status", ["active", "trialing", "paused", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subRow?.plan_slug !== "ultra" && subRow?.plan_slug !== "enterprise") return fail();

    const body = await req.json();
    const n = body?.nums as Nums;
    if (!n || typeof n.balance !== "number") return fail();
    const force = body?.force === true;

    const briefDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    if (!force) {
      const { data: cached } = await admin.from("ai_briefings")
        .select("content").eq("company_id", companyId).eq("brief_date", briefDate).maybeSingle();
      if (cached?.content) {
        return new Response(JSON.stringify({ content: cached.content, cached: true }), { headers: { ...CORS, "content-type": "application/json" } });
      }
    }

    const snapshot = await collectSnapshot(admin, companyId as string);
    const content = await generate(n, (body?.actions as Actions) || {}, String(body?.companyName || ""), snapshot);
    await admin.from("ai_briefings").upsert(
      { company_id: companyId, brief_date: briefDate, content },
      { onConflict: "company_id,brief_date" },
    );
    return new Response(JSON.stringify({ content, cached: false }), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (_e) {
    return fail(); // fail-open → 규칙 브리핑 폴백
  }
});
