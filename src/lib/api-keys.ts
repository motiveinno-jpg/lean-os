import { supabase } from "./supabase";
import { encryptCredential } from "./crypto";

/**
 * 회사별 외부 API 인증키 (2026-08-21 사장님 지시)
 *
 * > "플랫폼키는 회사별로 입력 안 하면 쓰지 못하게. 회사가 자기 키를 넣었을 때만 쓸 수 있게.
 * >  넣지 않았을 때는 발급받을 수 있는 사이트로 바로가기 기능 제공"
 *
 * ★ 화면의 주인공은 입력칸이 아니라 **연결 상태**다.
 *   사람이 이 화면에 오는 이유는 키를 넣으려고가 아니라 "왜 안 되지?" 를 보려고다.
 *
 * ★ 키는 저장하는 순간 DB 안에서 암호화되고 **다시는 화면으로 내려오지 않는다.**
 *   어떤 키인지 눈으로 알아볼 만큼만 앞뒤를 잘라 `key_hint` 로 남긴다.
 *
 * ★ 저장 전에 **실제로 한 번 호출해 본다.** 2026-08-21 실증 — 기존 data.go.kr 키가
 *   K-Startup 에 등록돼 있지 않았는데, 배포하고 불러 보기 전까지 아무도 몰랐다.
 */

export type ApiProvider = {
  key: string;
  label: string;
  /** 이 키가 있으면 무엇이 되는가 — 없을 때 무엇을 못 하는지가 사람에게는 더 중요하다 */
  gives: string;
  /** 어디서 발급받나 */
  issuer: string;
  issueUrl: string;
  /** 발급 절차 — 화면에 그대로 적는다. "어떤 걸 받아야 하는지 모르겠다"가 가장 큰 벽이다 */
  steps: string[];
  /** 발급 신청에서 틀리기 쉬운 것 */
  caution?: string;
  /** 이 키가 없으면 못 쓰는 화면 */
  usedBy: { href: string; label: string };
};

export const API_PROVIDERS: ApiProvider[] = [
  {
    key: "kstartup",
    label: "K-Startup 창업지원 공고",
    gives: "창업진흥원이 모은 창업 지원사업 공고를 매일 새벽 받아옵니다 (지금 열려 있는 것만 약 280건).",
    issuer: "공공데이터포털",
    issueUrl: "https://www.data.go.kr/data/15125364/openapi.do",
    steps: [
      "공공데이터포털(data.go.kr)에 회원가입하고 로그인합니다.",
      "위 링크의 '창업진흥원_K-Startup 조회서비스' 에서 [활용신청] 을 누릅니다.",
      "활용 목적을 적고 신청하면 보통 1~2일 안에 승인됩니다.",
      "마이페이지 > 오픈API > 인증키에서 일반 인증키를 복사해 아래에 붙여넣습니다.",
    ],
    caution: "Encoding 키·Decoding 키 둘 다 받습니다 — 어느 쪽을 넣어도 됩니다.",
    usedBy: { href: "/support-programs", label: "지원사업추천" },
  },
  {
    key: "bizinfo",
    label: "기업마당 지원사업 공고",
    gives: "중앙부처·지자체·유관기관 지원사업 공고를 받아옵니다. 정책자금·바우처가 여기 있습니다.",
    issuer: "기업마당",
    issueUrl: "https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi",
    steps: [
      "위 링크를 열고 아래로 내려 [활용신청] 폼을 찾습니다. 회원가입·로그인이 필요 없습니다.",
      "기관(기업)명 · 신청자명 · 이메일 · 전화번호 · 시스템명을 채웁니다.",
      "마지막 칸은 '시스템IP주소' 대신 '시스템URL' 을 고르고 회사 홈페이지 주소를 넣습니다.",
      "신청하면 화면 아래에 바로 인증키가 뜨고 이메일로도 옵니다.",
    ],
    caution: "IP 로 등록하면 안 됩니다 — 수집 서버 주소가 고정이 아니라 오늘은 되고 내일 막힙니다. 반드시 URL 로 등록하세요.",
    usedBy: { href: "/support-programs", label: "지원사업추천" },
  },
  {
    key: "smartstore",
    label: "스마트스토어 주문 (네이버 커머스API)",
    gives: "스마트스토어 결제 완료 주문을 재고 › 이커머스 › 주문 가져오기에서 기간으로 불러옵니다.",
    issuer: "네이버 커머스API 센터",
    issueUrl: "https://apicenter.commerce.naver.com/",
    steps: [
      "커머스API 센터에 스마트스토어 판매자 계정으로 로그인합니다.",
      "애플리케이션 > [애플리케이션 등록] 에서 이름을 적고 API 권한에 '주문 조회' 를 켭니다.",
      "등록하면 나오는 애플리케이션 ID(클라이언트 ID)와 시크릿을 복사합니다.",
      "아래 칸에 `클라이언트ID:클라이언트시크릿` 처럼 콜론(:)으로 붙여 한 줄로 넣습니다.",
    ],
    caution: "시크릿은 등록 직후 한 번만 보입니다 — 놓쳤으면 재발급하세요. 콜론(:) 앞뒤에 빈칸을 두지 마세요.",
    usedBy: { href: "/inventory/channels", label: "재고 › 이커머스" },
  },
  {
    key: "coupang",
    label: "쿠팡 주문 (윙 OpenAPI)",
    gives: "쿠팡 윙의 결제 완료(ACCEPT) 주문을 재고 › 이커머스 › 주문 가져오기에서 기간으로 불러옵니다.",
    issuer: "쿠팡 윙 (Wing)",
    issueUrl: "https://wing.coupang.com/",
    steps: [
      "쿠팡 윙에 로그인해 [판매자정보] > [추가판매정보] > Open API 키 발급으로 갑니다.",
      "액세스키(Access Key)와 시크릿키(Secret Key)를 발급받습니다.",
      "업체코드(Vendor ID, A로 시작)는 윙 화면 오른쪽 위 업체 정보에서 확인합니다.",
      "아래 칸에 `액세스키:시크릿키:업체코드` 처럼 콜론(:)으로 붙여 한 줄로 넣습니다.",
    ],
    caution: "시크릿키는 발급 직후 한 번만 보입니다. 키가 유출되면 윙에서 바로 재발급하고 여기도 갈아 넣으세요.",
    usedBy: { href: "/inventory/channels", label: "재고 › 이커머스" },
  },
];

export type ApiKeyRow = {
  id: string;
  provider: string;
  key_hint: string | null;
  status: "pending" | "ok" | "error";
  last_tested_at: string | null;
  last_error: string | null;
  last_used_at: string | null;
  updated_at: string;
};

export const KEY_STATUS_LABEL: Record<string, string> = {
  pending: "확인 전",
  ok: "연결됨",
  error: "오류",
};

/** 어떤 키인지 눈으로 알아볼 만큼만 — 복원은 불가능하다 */
export function hintOf(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return `${k.slice(0, 2)}…${k.slice(-2)}`;
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export async function listApiKeys(companyId: string): Promise<ApiKeyRow[]> {
  const { data } = await supabase
    .from("company_api_keys")
    .select("id, provider, key_hint, status, last_tested_at, last_error, last_used_at, updated_at")
    .eq("company_id", companyId);
  return (data || []) as ApiKeyRow[];
}

/** 저장 전 연결 확인 — 브라우저에서 직접 부르면 CORS 에 막히므로 서버를 거친다 */
export async function testApiKey(provider: string, key: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/integrations/test-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, key }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: !!body.ok, message: String(body.message || (res.ok ? "" : "확인하지 못했습니다")) };
}

/**
 * 키 저장 — **연결 확인에 성공한 것만 받는다.**
 *   틀린 키를 저장해 두면 "넣었는데 왜 안 되지"가 그대로 남는다. 실패는 실패대로 상태에 적는다.
 */
export async function saveApiKey(
  companyId: string, userId: string | null, provider: string, key: string,
  test: { ok: boolean; message: string },
): Promise<void> {
  const encrypted = await encryptCredential(key.trim());
  if (!encrypted) throw new Error("인증키를 암호화하지 못했습니다.");

  const { error } = await supabase.from("company_api_keys").upsert({
    company_id: companyId,
    provider,
    key_encrypted: encrypted,
    key_hint: hintOf(key),
    status: test.ok ? "ok" : "error",
    last_tested_at: new Date().toISOString(),
    last_error: test.ok ? null : test.message,
    created_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "company_id,provider" });
  if (error) throw error;
}

export async function deleteApiKey(companyId: string, provider: string): Promise<void> {
  const { error } = await supabase.from("company_api_keys")
    .delete().eq("company_id", companyId).eq("provider", provider);
  if (error) throw error;
}

/** 이미 저장된 키로 다시 확인 — 기관 쪽에서 키를 막았을 수도 있다 */
export async function retestApiKey(provider: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/integrations/test-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, useStored: true }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: !!body.ok, message: String(body.message || "") };
}

// ── 다른 탭에서 관리하는 연동 ─────────────────────────────────────────────

/**
 * 연결 현황은 **키를 여기서 넣는 것만 보여주면 반쪽**이다 (2026-08-21 사장님 지적).
 *   은행·카드·홈택스·광고는 각자 전용 화면에서 붙이지만, "무엇이 연결됐나" 는 한 곳에서 봐야 한다.
 *   그래서 상태만 여기로 모아 보여주고, 손보는 것은 [관리] 로 그 탭에 보낸다.
 *
 * ⚠️ 알림(Slack·카카오)은 **일부러 뺐다.** company_settings.slack_webhook_url 컬럼은 있지만
 *   값이 0건이고 읽는 코드도 없다(2026-08-21 grep·실측). 동작하지 않는 줄을 그려 두면
 *   "연결하면 되겠지" 라고 믿게 만든다 — 기능이 실제로 생기면 그때 넣는다.
 */
export type LinkedIntegration = {
  key: string;
  label: string;
  gives: string;
  status: "ok" | "partial" | "error" | "none";
  detail: string;
  /** 손보러 가는 곳 */
  href: string;
};

const ymd = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }) : null;

export async function loadLinkedIntegrations(companyId: string): Promise<LinkedIntegration[]> {
  const [settingsRes, hometaxRes, adsRes] = await Promise.all([
    supabase.from("company_settings").select("codef_connected_id, codef_connected_at").eq("company_id", companyId).maybeSingle(),
    supabase.from("automation_credentials").select("id, updated_at").eq("company_id", companyId).eq("service", "hometax").maybeSingle(),
    supabase.from("ad_accounts").select("status").eq("company_id", companyId),
  ]);

  const cs = settingsRes.data;
  const ht = hometaxRes.data;
  const ads = (adsRes.data || []) as { status: string }[];
  const adErr = ads.filter((a) => a.status === "error").length;

  return [
    {
      key: "codef",
      label: "은행·카드 (CODEF)",
      gives: "공동인증서로 통장·카드 거래를 자동으로 받아옵니다.",
      status: cs?.codef_connected_id ? "ok" : "none",
      detail: cs?.codef_connected_id ? `${ymd(cs.codef_connected_at) ?? ""} 연결` : "인증서를 등록하면 거래가 자동으로 들어옵니다",
      href: "/settings?tab=bank",
    },
    {
      key: "hometax",
      label: "홈택스",
      gives: "세금계산서·현금영수증을 받아옵니다.",
      status: ht?.id ? "ok" : "none",
      detail: ht?.id ? `${ymd(ht.updated_at) ?? ""} 등록` : "아직 등록하지 않았습니다",
      href: "/settings?tab=bank",
    },
    {
      key: "ads",
      label: "광고 계정",
      gives: "네이버·카카오·메타 광고 성과를 받아옵니다.",
      status: ads.length === 0 ? "none" : adErr === 0 ? "ok" : adErr === ads.length ? "error" : "partial",
      detail: ads.length === 0 ? "등록된 광고 계정이 없습니다"
        : adErr === 0 ? `${ads.length}개 연결됨`
        : `${ads.length}개 중 ${adErr}개 오류`,
      href: "/settings?tab=ads",
    },
  ];
}
