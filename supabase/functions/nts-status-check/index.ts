//   국세청 기록 정기 확인 — 회사·거래처 사업자 상태와 회사 기초정보(대표자·개업일)를 국세청 공개 API 로 맞춰 본다.
//   크론(매주 월요일, 마이그 20261014140000)이 x-cron-secret 으로 부른다. 대상·기록·알림은 DB 함수가 맡는다
//   (nts_check_targets / record_nts_findings). feature_rollout('nts_status_check') 이 켜진 회사만.
//
//   상태조회(status): 번호 100개씩. 휴업(02)·폐업(03)·미등록(tax_type 에 '등록되지 않은')을 찾는다.
//   진위확인(validate): 번호+대표자+개업일 — 회사 기초정보 값이 다 있을 때만. 국세청은 어느 칸이 틀렸는지 알려 주지 않는다.
//   호출이 실패한 종류는 기록하지 않는다(실패를 '문제 없음'으로 읽어 열린 건을 해결로 돌리지 않게).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withSentry } from "../_shared/sentry.ts";
import { tfetch } from "../_shared/http.ts";

const NTS = "https://api.odcloud.kr/api/nts-businessman/v1";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type StatusRow = { b_no: string; b_stt_cd: string; b_stt: string; tax_type: string; end_dt: string };

async function ntsStatus(key: string, bnos: string[]): Promise<Map<string, StatusRow> | null> {
  const out = new Map<string, StatusRow>();
  for (let i = 0; i < bnos.length; i += 100) {
    const r = await tfetch(`${NTS}/status?serviceKey=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ b_no: bnos.slice(i, i + 100) }),
    }, 30000);
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    if (!d || !Array.isArray(d.data)) return null;
    for (const it of d.data) out.set(String(it.b_no || ""), it as StatusRow);
  }
  return out;
}

async function ntsValidate(key: string, bno: string, pnm: string, sdt: string): Promise<boolean | null> {
  const r = await tfetch(`${NTS}/validate?serviceKey=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ businesses: [{ b_no: bno, start_dt: sdt, p_nm: pnm }] }),
  }, 30000);
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  const v = ((d?.data || [])[0] || {}).valid;
  return v === "01" ? true : v === "02" ? false : null;
}

const fmtBno = (b: string) => `${b.slice(0, 3)}-${b.slice(3, 5)}-${b.slice(5)}`;
const fmtYmd = (s: string) => (s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : "");

//   문제 있는 상태면 사람이 읽을 말로, 계속사업자면 null
function badStatus(s: StatusRow | undefined): string | null {
  if (!s) return null;
  if (/등록되지 않은/.test(s.tax_type || "")) return "국세청에 등록되지 않은 번호";
  if (s.b_stt_cd === "02") return "휴업";
  if (s.b_stt_cd === "03") return `폐업${s.end_dt ? `(${fmtYmd(s.end_dt)})` : ""}`;
  return null;
}

Deno.serve(withSentry("nts-status-check", async (req: Request) => {
  const secret = Deno.env.get("NTS_CHECK_SECRET") || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json(401, { error: "Unauthorized" });
  const key = Deno.env.get("DATA_GO_KR_API_KEY");
  if (!key) return json(500, { error: "DATA_GO_KR_API_KEY 없음" });

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: targets, error } = await admin.rpc("nts_check_targets");
  if (error) return json(500, { error: error.message });

  const report: unknown[] = [];
  for (const t of (targets || []) as any[]) {
    const companyBno = String(t.business_number || "");
    const partners = (t.partners || []) as { id: string; name: string; business_number: string }[];
    const kinds: string[] = [];
    const findings: unknown[] = [];

    // ① ③ 상태조회 — 회사 번호와 거래처 번호를 한 번에
    const bnos = [...new Set([companyBno, ...partners.map((p) => p.business_number)].filter((b) => b.length === 10))];
    const st = bnos.length ? await ntsStatus(key, bnos) : new Map<string, StatusRow>();
    if (st) {
      if (companyBno.length === 10) {
        kinds.push("company_business_status");
        const bad = badStatus(st.get(companyBno));
        if (bad) findings.push({
          kind: "company_business_status", subject_key: companyBno,
          title: `우리 회사 사업자번호(${fmtBno(companyBno)}) — 국세청: ${bad}`,
          detail: { business_number: companyBno, status: st.get(companyBno) },
        });
      }
      kinds.push("partner_business_status");
      const byBno = new Map<string, string[]>();
      for (const p of partners) byBno.set(p.business_number, [...(byBno.get(p.business_number) || []), p.name]);
      for (const [b, names] of byBno) {
        const bad = badStatus(st.get(b));
        if (!bad) continue;
        findings.push({
          kind: "partner_business_status", subject_key: b,
          title: `거래처 ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` 외 ${names.length - 2}곳` : ""}(${fmtBno(b)}) — 국세청: ${bad}`,
          detail: { business_number: b, partner_ids: partners.filter((p) => p.business_number === b).map((p) => p.id), status: st.get(b) },
        });
      }
    }

    // ② 진위확인 — 번호·대표자·개업일이 다 있을 때만
    if (companyBno.length === 10 && t.representative && t.open_date) {
      const ok = await ntsValidate(key, companyBno, String(t.representative), String(t.open_date).replace(/\D/g, ""));
      if (ok !== null) {
        kinds.push("company_profile_mismatch");
        if (!ok) findings.push({
          kind: "company_profile_mismatch", subject_key: companyBno,
          title: `회사 기초정보의 대표자(${t.representative})·개업일(${t.open_date})이 국세청 기록과 다릅니다 — 사업자등록증과 맞춰 주세요`,
          detail: { business_number: companyBno, representative: t.representative, open_date: t.open_date },
        });
      }
    }

    const { data: n, error: recErr } = await admin.rpc("record_nts_findings", { p_company: t.company_id, p_kinds: kinds, p_findings: findings });
    report.push({ company_id: t.company_id, checked: bnos.length, kinds, findings: findings.length, new: n ?? null, error: recErr?.message, status_api: st ? "ok" : "failed" });
  }
  return json(200, { ok: true, report });
}));
