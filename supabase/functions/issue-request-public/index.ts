// issue-request-public — 세금계산서 발행 요청 링크 화면(/issue-request)의 「이 화면에서 바로 발행」
//
//   ⚠️ verify_jwt = false 로 배포한다 (supabase functions deploy issue-request-public --no-verify-jwt).
//   받는 사람(공급자)은 오너뷰 계정이 없다. 인증은 요청 토큰(48자 hex) 하나다.
//
//   action
//     register  공급자가 자기 회사 정보를 넣으면 팝빌 회원가입(pop-bill/join-member) + 인증서 등록 URL(pop-bill/tax-cert-url).
//               URL 은 윈도우 PC 전용·30초 유효. 입력한 정보는 요청 줄 supplier_profile 에 남는다.
//     issue     작성일자를 받아 공급자 명의로 정발행(regist-invoicer-trustee). 공급받는자 = 요청 회사(보낼 때 찍어 둔 정보).
//
//   지키는 것
//     · 사업자번호는 **요청에 적힌 값만** 쓴다. 화면이 보낸 번호가 다르면 거절한다.
//     · 공급자가 오너뷰 회사면 여기서는 못 쓴다 — 로그인해서 발행한다. 그 회사는 팝빌에 인증서가 이미 있을 수 있어
//       토큰만 가진 사람이 그 회사 명의로 발행하는 길이 된다.
//     · 사업자번호를 첫 등록 메일에 묶는다(tax_invoice_public_issuers). 요청 회사가 공급자 메일을 자기 주소로 적어
//       보내도, 다른 메일로 등록된 사업자번호로는 등록·발행이 안 된다.
//     · 토큰당 10분 12회. 발행은 한 번에 하나(pending 잠금). CF-05001 실패 건 재발행 차단(hometax-issue 와 같은 판정).
//     · 발행 한도·충전 차감은 **요청 회사** 몫(issue_allowance·consume_issue_credit). 사용량은
//       get_monthly_issue_usage 가 issued_via='popbill_public' 줄을 요청 회사 세금계산서 건수에 더해 센다.

import { withSentry } from "../_shared/sentry.ts";
import { createMeterStore, runWithMeter, flushCodefUsage } from "../_shared/codef-meter.ts";
import { CODEF_ENV, CODEF_BASE, getCodefToken, codefRequest } from "../_shared/codef-issue-client.ts";
import {
  buildIssuePayload, normalizeNtsConfirmNum, requestToIssueArgs, type SupplierProfile,
} from "../_shared/tax-invoice-payload.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ISSUE_PATH = "/v1/kr/public/a/tax-invoice/regist-invoicer-trustee";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

const RATE_MAX = 12;
const RATE_WINDOW_SEC = 600;

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const hyphenBizNo = (d: string) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;

/** CODEF 오류 코드 → 공급자가 읽을 안내 (오너뷰 화면 안내는 빼고 링크 화면 기준으로) */
function hintFor(code?: string): string {
  if (!code) return "응답이 없습니다. 잠시 후 다시 시도해 주세요.";
  if (code === "CF-05001") return "공동인증서가 아직 등록되지 않았을 수 있습니다. ① 단계에서 인증서 등록을 마친 뒤 다시 발행해 주세요. 그래도 같으면 다시 누르지 말고 홈택스에서 발행 여부를 먼저 확인해 주세요.";
  if (code.startsWith("CF-03") || code.startsWith("CF-04")) return "인증에 실패했습니다. 공동인증서 상태를 확인해 주세요.";
  if (code.startsWith("CF-12")) return "국세청 응답이 늦습니다. 점검 시간을 피해 다시 시도해 주세요.";
  return `발행 오류(${code})입니다. 홈택스에서 직접 발행하셔도 됩니다.`;
}

Deno.serve(withSentry("issue-request-public", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST 만 받습니다." }, 405);

  const meterStore = createMeterStore("issue-request-public");
  return await runWithMeter(meterStore, async () => {
    try {
      const body = await req.json().catch(() => ({}));
      const action = String(body?.action || "");
      const token = String(body?.token || "");
      if (action !== "register" && action !== "issue") return json({ error: "알 수 없는 요청입니다." }, 400);
      if (!/^[0-9a-f]{48}$/.test(token)) return json({ error: "유효하지 않은 링크입니다." }, 404);
      meterStore.action = `issue-request-${action}`;

      // ── 요청 확인 ──
      const { data: r } = await admin.from("tax_invoice_requests").select("*").eq("token", token).maybeSingle();
      if (!r) return json({ error: "유효하지 않은 링크입니다." }, 404);
      if (r.status === "canceled") return json({ error: "요청 회사가 취소한 요청입니다." }, 409);
      if (r.status === "issued") return json({ error: "이미 발행 완료로 기록된 요청입니다." }, 409);
      if (r.expires_at && Date.parse(r.expires_at) < Date.now()) return json({ error: "기한이 지난 요청입니다. 요청 회사에 다시 보내 달라고 해 주세요." }, 409);
      meterStore.companyId = r.company_id;

      const { data: allowed } = await admin.rpc("issue_request_rate_hit", {
        p_request_id: r.id, p_max: RATE_MAX, p_window_seconds: RATE_WINDOW_SEC,
      });
      if (allowed === false) return json({ error: "요청이 너무 잦습니다. 10분 뒤에 다시 시도해 주세요." }, 429);

      const corpNum = digits(r.supplier_business_number);
      if (corpNum.length !== 10) return json({ error: "요청에 적힌 공급자 사업자번호가 올바르지 않습니다." }, 400);

      //   오너뷰 회사는 로그인해서 발행한다 (위 '지키는 것' 두 번째)
      const { data: ovCompanies } = await admin.from("companies").select("id")
        .in("business_number", [corpNum, hyphenBizNo(corpNum)]).limit(1);
      if (r.supplier_company_id || (ovCompanies && ovCompanies.length > 0)) {
        return json({
          error: "오너뷰를 쓰는 회사입니다. 오너뷰에 로그인해 세금·증빙 › 받은 발행 요청에서 발행해 주세요.",
          code: "USE_OWNERVIEW",
        }, 409);
      }

      const boundEmail = String(r.supplier_email || "").trim().toLowerCase();
      const clientId = Deno.env.get("CODEF_CLIENT_ID");
      const clientSecret = Deno.env.get("CODEF_CLIENT_SECRET");
      if (!clientId || !clientSecret) return json({ error: "발행 연동 설정이 없습니다. 홈택스에서 직접 발행해 주세요." }, 500);

      // ── register: 회원가입 + 인증서 등록 URL ──
      if (action === "register") {
        if (digits(body?.business_number) !== corpNum) {
          return json({ error: "사업자등록번호가 요청에 적힌 공급자 번호와 다릅니다. 요청 회사에 확인해 주세요." }, 400);
        }
        const p = body?.profile || {};
        const profile: SupplierProfile = {
          corp_name: clip(p.corp_name, 100),
          ceo_name: clip(p.ceo_name, 50),
          addr: clip(p.addr, 300),
          biz_type: clip(p.biz_type, 100),
          biz_class: clip(p.biz_class, 100),
          tel: clip(p.tel, 30),
          contact_name: clip(p.contact_name, 50),
          email: boundEmail,
        };
        const missing = [
          !profile.corp_name && "상호", !profile.ceo_name && "대표자", !profile.addr && "주소",
          !profile.biz_type && "업태", !profile.biz_class && "종목", !profile.tel && "전화번호",
        ].filter(Boolean);
        if (missing.length) return json({ error: `빠진 칸이 있습니다: ${missing.join(", ")}` }, 400);
        if (!/^[0-9+\-() ]{8,30}$/.test(profile.tel || "")) return json({ error: "전화번호를 숫자로 입력해 주세요." }, 400);

        //   사업자번호 ↔ 메일 묶기 — 먼저 넣은 사람이 이긴다(on conflict do nothing)
        await admin.from("tax_invoice_public_issuers")
          .upsert({ corp_num: corpNum, bound_email: boundEmail, first_request_id: r.id }, { onConflict: "corp_num", ignoreDuplicates: true });
        const { data: bound } = await admin.from("tax_invoice_public_issuers").select("bound_email").eq("corp_num", corpNum).maybeSingle();
        if (!bound || String(bound.bound_email).toLowerCase() !== boundEmail) {
          return json({
            error: "이 사업자번호는 다른 메일 주소로 등록돼 있어 이 화면에서 발행할 수 없습니다. 홈택스에서 직접 발행해 주세요.",
            code: "BOUND_TO_OTHER_EMAIL",
          }, 409);
        }

        try {
          const tk = await getCodefToken(clientId, clientSecret);
          const joinResp = await codefRequest(tk, "/v1/kr/public/a/pop-bill/join-member", {
            corpNum,
            CEOName: profile.ceo_name,
            corpName: profile.corp_name,
            corpAddress: profile.addr,
            bizType: profile.biz_type,
            bizClass: profile.biz_class,
            contactName: profile.contact_name || profile.ceo_name,
            contactTEL: profile.tel,
            contactEmail: profile.email,
            contactFAX: "",
          });
          const certResp = await codefRequest(tk, "/v1/kr/public/a/pop-bill/tax-cert-url", { corpNum });
          const certURL = certResp?.data?.certURL || certResp?.data?.certUrl || certResp?.certURL || "";

          const now = new Date().toISOString();
          await admin.from("tax_invoice_public_issuers").update({
            profile, join_result: { join: joinResp?.result, cert: certResp?.result, codefEnv: CODEF_ENV, codefBase: CODEF_BASE },
            cert_url_issued_at: certURL ? now : null, updated_at: now,
          }).eq("corp_num", corpNum);
          await admin.from("tax_invoice_requests").update({
            supplier_profile: { ...profile, registered_at: now },
          }).eq("id", r.id);

          if (!certURL) {
            return json({
              error: `인증서 등록 주소를 받지 못했습니다 — 회원가입(${joinResp?.result?.code || "-"}) / 인증서(${certResp?.result?.code || "-"}: ${certResp?.result?.message || ""})`,
            }, 400);
          }
          return json({
            success: true, certURL,
            message: "인증서 등록 창을 30초 안에 여세요. 등록을 마치면 ② 단계에서 발행합니다.",
          });
        } catch (e) {
          return json({ error: "회원가입·인증서 주소 요청에 실패했습니다: " + ((e as Error)?.message || "") }, 502);
        }
      }

      // ── issue: 정발행 ──
      const writeDate = String(body?.write_date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(writeDate) || Number.isNaN(Date.parse(`${writeDate}T00:00:00Z`))) {
        return json({ error: "작성일자를 입력해 주세요." }, 400);
      }
      if (writeDate > kstToday()) return json({ error: "작성일자는 오늘보다 늦을 수 없습니다." }, 400);

      const profile = r.supplier_profile as SupplierProfile | null;
      if (!profile?.corp_name) return json({ error: "먼저 ① 공급자 정보 입력·인증서 등록을 해 주세요." }, 409);
      const { data: bound } = await admin.from("tax_invoice_public_issuers").select("bound_email").eq("corp_num", corpNum).maybeSingle();
      if (!bound || String(bound.bound_email).toLowerCase() !== boundEmail) {
        return json({ error: "이 사업자번호는 다른 메일 주소로 등록돼 있어 이 화면에서 발행할 수 없습니다. 홈택스에서 직접 발행해 주세요.", code: "BOUND_TO_OTHER_EMAIL" }, 409);
      }

      //   진행 중이면 막는다 — 결과를 모르는 채 다시 보내면 중복 발행이다
      if (r.public_issue_status === "pending") {
        return json({ error: "발행이 진행 중이거나 결과 확인이 필요합니다. 다시 누르지 말고 홈택스에서 발행 여부를 확인해 주세요.", code: "PENDING" }, 409);
      }
      //   CF-05001 인시던트 가드(hometax-issue 와 같은 판정): 검증 반려가 아닌 CF-05001 은 실제로 발행됐을 수 있다
      const prev = r.public_response as { result?: { code?: string; extraMessage?: string } } | null;
      if (r.public_issue_status === "failed" && prev?.result?.code === "CF-05001") {
        const extra = String(prev?.result?.extraMessage || "");
        const validationRejected = /동일하지\s*않|필수|형식|올바르지|유효하지|누락|\[-1100/.test(extra);
        if (!validationRejected) {
          return json({
            error: "재발행 차단: 앞선 시도가 실패로 표시됐지만 실제로는 발행됐을 수 있습니다. 다시 보내면 중복 발행됩니다.",
            hint: "홈택스에서 발행 여부(승인번호)를 확인한 뒤, 발행됐다면 「홈택스에서 직접 발행」 칸에 승인번호를 적어 주세요.",
            code: "CF05001_REISSUE_BLOCKED",
          }, 409);
        }
      }

      //   발행 한도 — 요청 회사 몫
      const { data: allowance } = await admin.rpc("issue_allowance", { p_company_id: r.company_id, p_kind: "tax" });
      const allow = (allowance || {}) as { unlimited?: boolean; allowed?: boolean };
      if (!allow.unlimited && allow.allowed === false) {
        return json({
          error: "요청 회사의 이번 달 발행 가능 건수가 남아 있지 않아 이 화면에서는 발행할 수 없습니다. 홈택스에서 직접 발행해 주세요.",
          code: "PLAN_LIMIT_EXCEEDED",
        }, 429);
      }

      //   발행 잠금 — 상태가 그대로일 때만 pending 으로 (동시에 두 번 눌러도 하나만 지나간다)
      const { data: claimed } = await admin.from("tax_invoice_requests")
        .update({ public_issue_status: "pending" })
        .eq("id", r.id).in("status", ["sent", "viewed"])
        .or("public_issue_status.is.null,public_issue_status.eq.failed")
        .select("id");
      if (!claimed || claimed.length === 0) {
        return json({ error: "발행이 진행 중이거나 이미 끝났습니다. 화면을 새로고침해 주세요.", code: "PENDING" }, 409);
      }

      const payload = buildIssuePayload(requestToIssueArgs(r, profile, writeDate));
      let resp: { result?: { code?: string; message?: string; extraMessage?: string }; data?: Record<string, string> };
      try {
        const tk = await getCodefToken(clientId, clientSecret);
        resp = await codefRequest(tk, ISSUE_PATH, payload);
      } catch (e) {
        await admin.from("tax_invoice_requests").update({
          public_issue_status: "failed",
          public_response: { result: { code: "NETWORK_ERROR", message: (e as Error)?.message || "" }, request: payload },
        }).eq("id", r.id);
        return json({ error: "발행 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);
      }

      const code = resp?.result?.code;
      if (code === "CF-00000") {
        //   sendToNtsYn:"N" — 승인번호는 다음 영업일 국세청 전송 뒤에 붙는다. 그때까지 null.
        //   요청 회사의 매입 수집이 들어오면 DB 트리거가 사업자번호·합계·작성일로 묶고 번호를 채운다.
        const confirm = normalizeNtsConfirmNum(
          resp.data?.ntsconfirmNum || resp.data?.ntsConfirmNum || resp.data?.resIssueNum || resp.data?.resApprovalNo || "",
        ) || null;
        const { error: saveErr } = await admin.from("tax_invoice_requests").update({
          status: "issued", issued_via: "popbill_public", write_date: writeDate,
          issued_at: new Date().toISOString(), nts_confirm_no: confirm,
          public_issue_status: "issued", public_response: { ...resp, request: payload },
        }).eq("id", r.id);
        if (saveErr) {
          console.error("[issue-request-public] issued but save failed:", saveErr.message);
          return json({ error: "발행은 됐지만 기록에 실패했습니다. 다시 누르지 마세요.", code: "ISSUED_STATE_SAVE_FAILED" }, 502);
        }
        try {
          await admin.rpc("consume_issue_credit", { p_company_id: r.company_id });
        } catch (e) {
          console.error("[issue-request-public] consume_issue_credit failed:", (e as Error)?.message);
        }
        return json({
          success: true, nts_confirm_no: confirm,
          message: "발행했습니다. 국세청 전송은 다음 영업일에 이뤄지고, 그때 승인번호가 붙습니다.",
        });
      }

      await admin.from("tax_invoice_requests").update({
        public_issue_status: "failed",
        public_response: { ...resp, request: payload, _codefEnv: CODEF_ENV },
      }).eq("id", r.id);
      return json({
        error: `발행하지 못했습니다 (${code || "응답 없음"}): ${resp?.result?.message || ""}`.trim(),
        hint: hintFor(code), code,
      }, 400);
    } catch (err) {
      return json({ error: (err as Error)?.message || "Internal error" }, 500);
    } finally {
      await flushCodefUsage(meterStore);
    }
  });
}));
