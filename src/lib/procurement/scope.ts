import type { Evidence, Notice, ProjectScope } from "./types";

// 후보 선별용 규칙이다. 단어 발견을 필수 과업이나 입찰 자격 충족으로 확정하지 않는다.
export const SCOPE_RULES: {
  key: ProjectScope | "software" | "construction" | "broadcast" | "printing";
  label: string;
  pattern: RegExp;
  specialist?: boolean;
  conditional?: boolean;
}[] = [
  {
    key: "ads",
    label: "온라인 광고 운영",
    pattern:
      /검색광고|검색 광고|네이버\s*(SA|키워드|검색)|카카오모먼트|퍼포먼스\s*마케팅|광고\s*(집행|캠페인)|디스플레이\s*광고/iu,
  },
  {
    key: "social",
    label: "SNS·채널·체험단 운영",
    pattern: /SNS|소셜미디어|블로그|체험단|인플루언서|틱톡|TIKTOK|META/iu,
  },
  {
    key: "product",
    label: "제품 촬영·상세페이지",
    pattern: /상세\s*페이지|제품\s*촬영|상품\s*촬영/iu,
  },
  {
    key: "video",
    label: "홍보 영상·콘텐츠 제작",
    pattern: /영상\s*(제작|촬영|편집)|콘텐츠\s*(제작|개발)|숏폼|홍보\s*영상/iu,
  },
  {
    key: "live",
    label: "라이브커머스·라이브 교육 송출",
    pattern: /라이브\s*커머스|라이브\s*(방송|교육)|생방송\s*송출/iu,
  },
  {
    key: "education",
    label: "마케팅·커머스 교육 운영",
    pattern:
      /마케팅\s*교육|교육\s*(운영|프로그램|교재)|클래스\s*운영|현장\s*실습/iu,
  },
  {
    key: "consulting",
    label: "마케팅 컨설팅",
    pattern: /컨설팅|마케팅\s*진단/iu,
  },
  {
    key: "program",
    label: "참여기업·지원사업 관리",
    pattern:
      /소상공인|참여\s*(기업|업체)|지원사업|지원\s*사업|만족도\s*조사|간담회|입점\s*지원|온라인\s*기획전/iu,
  },
  {
    key: "branding",
    label: "브랜드·BI 기획",
    pattern: /브랜딩|브랜드\s*(기획|개발)|\b(BI|CI)\b/iu,
  },
  {
    key: "character",
    label: "캐릭터·굿즈 디자인",
    pattern: /캐릭터|굿즈/iu,
    conditional: true,
  },
  {
    key: "showroom",
    label: "쇼룸·전시·해외 현장 운영",
    pattern: /쇼룸|박람회|전시\s*(운영|설치|공간)|해외\s*행사/iu,
    conditional: true,
  },
  {
    key: "xr",
    label: "XR 콘텐츠",
    pattern: /\b(XR|VR|AR)\b|실감\s*콘텐츠/iu,
    conditional: true,
  },
  {
    key: "software",
    label: "시스템·앱 개발",
    pattern:
      /시스템\s*(개발|구축)|플랫폼\s*(개발|구축)|앱\s*개발|응용\s*소프트웨어|정보시스템|웹사이트\s*구축/iu,
    specialist: true,
  },
  {
    key: "construction",
    label: "시설·전기·구조물 시공",
    pattern:
      /전기\s*공사|시설\s*공사|구조물\s*시공|전광판\s*설치|옥외\s*광고물\s*설치/iu,
    specialist: true,
  },
  {
    key: "broadcast",
    label: "방송사 편성·대규모 매체 구매",
    pattern: /방송사\s*편성|지상파|TV\s*광고|신문\s*광고|전국\s*매체\s*구매/iu,
    specialist: true,
  },
  {
    key: "printing",
    label: "인쇄·물품 대량 제조·납품",
    pattern: /대량\s*(인쇄|제조)|인쇄물\s*납품|물품\s*제조|기념품\s*제조/iu,
    specialist: true,
  },
];
export const SCOPE_LABELS = {
  possible: "수행 가능 후보",
  confirm: "추가 확인 필요",
  difficult: "수행 어려움 후보",
} as const;
export function scopePrecheck(notice: Notice, evidence: Evidence[]) {
  const projects = evidence.filter(
    (e) => e.category === "project" && e.project && !e.revokedReason,
  );
  const complete =
    notice.documents.length > 0 &&
    notice.documents.every((d) => d.complete && d.text.trim()) &&
    notice.attachments.every((a) =>
      notice.documents.some((d) => d.name.trim() === a.name.trim()),
    );
  const text = notice.documents.length
    ? notice.documents.map((d) => ({
        location: d.location || d.name,
        text: d.text,
      }))
    : [{ location: "공고 제목 · 전문 미확보", text: notice.title }];
  const tasks = SCOPE_RULES.flatMap((rule) => {
    const hits = text
      .flatMap((d) =>
        d.text
          .split(/[\n。.!?]+/u)
          .filter((line) => rule.pattern.test(line))
          .map((line) => ({
            location: d.location,
            quote: line.trim().slice(0, 500),
            contextual:
              /제외|하지\s*않|해당\s*없|별도\s*업체|발주처.{0,15}제공/u.test(
                line,
              ),
          })),
      )
      .slice(0, 5);
    if (!hits.length) return [];
    const matches = projects.filter(
      (e) =>
        e.project!.scopes.includes(rule.key as ProjectScope) &&
        e.project!.attribution === "company-reported",
    );
    const credible = matches.filter(
      (e) => !e.project!.duplicateGroup && e.project!.state !== "unknown",
    );
    const active = hits.some((h) => !h.contextual);
    const status = !active
      ? "confirm"
      : rule.specialist && !credible.length
        ? "difficult"
        : !credible.length || rule.conditional
          ? "confirm"
          : "possible";
    return [
      {
        key: rule.key,
        label: rule.label,
        status,
        hits,
        evidence: matches.map((e) => ({
          id: e.id,
          title: e.title,
          source: e.source,
          state: e.project!.state,
          verified: e.verified,
          issues: e.project!.issues,
        })),
        reason: !active
          ? "제외·발주처 제공 등 문맥입니다. 실제 요구 과업인지 대조해야 합니다."
          : rule.specialist && !credible.length
            ? "제공된 회사 실적에서 직접 수행 근거를 찾지 못했습니다. 전문 인력·자격·협력사 확보 전에는 진행을 보류합니다."
            : !credible.length
              ? "유사한 회사 직접 수행 근거가 부족하거나 귀속·중복 확인이 필요합니다."
              : rule.conditional
                ? "관련 실적은 있으나 제작 규모·현장 운영·전문 기술·외주 범위를 별도 확인해야 합니다."
                : "제공된 회사 실적과 업무 범위가 겹칩니다. 계약상 직접 수행 범위와 최신 인력·원가·자격은 추가 확인해야 합니다.",
      },
    ];
  });
  const status =
    !complete || !tasks.length || !projects.length
      ? "confirm"
      : tasks.some((t) => t.status === "difficult")
        ? "difficult"
        : tasks.some((t) => t.status === "confirm")
          ? "confirm"
          : "possible";
  return {
    status,
    label: SCOPE_LABELS[status],
    complete,
    tasks,
    caveat:
      "실적 기반 사전 분류입니다. 원문에서 발견한 표현이 필수 과업인지 사람이 대조해야 하며, 입찰 자격·수행 확정·종합점수를 대신하지 않습니다. 수행 종료로 기재된 실적도 준공·실적증명서 확인 전에는 완료 인정 실적으로 확정하지 않습니다.",
  };
}
