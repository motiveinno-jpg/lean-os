// supabase/functions/verify-business-number/index.ts
// 국세청 사업자등록번호 진위확인 Edge Function (Deno runtime)
// Uses 공공데이터포털 NTS Businessman API to verify Korean business registration numbers.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface VerifyRequest {
  businessNumbers: string[];
}

interface BusinessStatus {
  b_no: string;
  b_stt: string; // 계속사업자, 휴업자, 폐업자
  b_stt_cd: string; // 01, 02, 03
  tax_type: string;
  tax_type_cd: string;
  end_dt: string;
  utcc_yn: string;
  tax_type_change_dt: string;
  invoice_apply_dt: string;
  rbf_tax_type: string;
  rbf_tax_type_cd: string;
}

interface VerifyResponse {
  success: boolean;
  message: string;
  results?: BusinessStatus[];
  errors?: string[];
}

// ─── Business number checksum validation ───
function isValidBusinessNumber(bno: string): boolean {
  const cleaned = bno.replace(/[^0-9]/g, "");
  if (cleaned.length !== 10) return false;

  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned[i]) * weights[i];
  }
  sum += Math.floor((parseInt(cleaned[8]) * 5) / 10);
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(cleaned[9]);
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("DATA_GO_KR_API_KEY");
    if (!apiKey) {
      return jsonResponse(500, {
        success: false,
        message: "DATA_GO_KR_API_KEY 환경변수가 설정되지 않았습니다.",
      });
    }

    // Parse request
    const { businessNumbers }: VerifyRequest = await req.json();

    if (
      !businessNumbers ||
      !Array.isArray(businessNumbers) ||
      businessNumbers.length === 0
    ) {
      return jsonResponse(400, {
        success: false,
        message: "businessNumbers 배열이 필요합니다.",
      });
    }

    if (businessNumbers.length > 10) {
      return jsonResponse(400, {
        success: false,
        message: "한 번에 최대 10개까지 조회할 수 있습니다.",
      });
    }

    // ─── Step 1: Validate format & checksum ───
    const errors: string[] = [];
    const cleanedNumbers: string[] = [];

    for (const bno of businessNumbers) {
      const cleaned = bno.replace(/[^0-9]/g, "");
      if (cleaned.length !== 10) {
        errors.push(`${bno}: 10자리 숫자가 아닙니다.`);
        continue;
      }
      if (!isValidBusinessNumber(cleaned)) {
        errors.push(`${bno}: 체크섬이 올바르지 않습니다.`);
        continue;
      }
      cleanedNumbers.push(cleaned);
    }

    if (cleanedNumbers.length === 0) {
      return jsonResponse(400, {
        success: false,
        message: "유효한 사업자번호가 없습니다.",
        errors,
      });
    }

    // ─── Step 2: Call 국세청 API ───
    console.log(
      `[verify-business-number] Querying ${cleanedNumbers.length} numbers: ${cleanedNumbers.join(", ")}`
    );

    const apiUrl =
      "https://api.odcloud.kr/api/nts-businessman/v1/status";

    const response = await fetch(
      `${apiUrl}?serviceKey=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ b_no: cleanedNumbers }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[verify-business-number] API error: ${response.status} ${errorText}`
      );
      return jsonResponse(502, {
        success: false,
        message: `국세청 API 호출 실패 (HTTP ${response.status})`,
        errors: [errorText],
      });
    }

    const apiData = await response.json();

    // The API returns { status_code, match_cnt, request_cnt, data: [...] }
    if (apiData.status_code !== "OK" && apiData.status_code !== undefined) {
      // Some responses use different status codes
      console.warn(
        `[verify-business-number] API status_code: ${apiData.status_code}`
      );
    }

    const results: BusinessStatus[] = (apiData.data || []).map(
      (item: any) => ({
        b_no: item.b_no || "",
        b_stt: item.b_stt || "",
        b_stt_cd: item.b_stt_cd || "",
        tax_type: item.tax_type || "",
        tax_type_cd: item.tax_type_cd || "",
        end_dt: item.end_dt || "",
        utcc_yn: item.utcc_yn || "",
        tax_type_change_dt: item.tax_type_change_dt || "",
        invoice_apply_dt: item.invoice_apply_dt || "",
        rbf_tax_type: item.rbf_tax_type || "",
        rbf_tax_type_cd: item.rbf_tax_type_cd || "",
      })
    );

    console.log(
      `[verify-business-number] Got ${results.length} results, match_cnt: ${apiData.match_cnt}`
    );

    return jsonResponse(200, {
      success: true,
      message: `${results.length}건 조회 완료`,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error("[verify-business-number] Unexpected error:", err);
    return jsonResponse(500, {
      success: false,
      message: "서버 오류가 발생했습니다.",
      errors: [err.message || "Unknown error"],
    });
  }
});

function jsonResponse(status: number, body: VerifyResponse) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
