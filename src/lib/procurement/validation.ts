import {
  RUBRIC,
  type Notice,
  type Review,
  type Settings,
  type Evidence,
  type Citation,
} from "./types";

export class ProcurementError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProcurementError("JSON 객체 형식이어야 합니다.");
  return value as Record<string, unknown>;
}
export function text(
  value: unknown,
  name: string,
  max = 500,
  required = true,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new ProcurementError(
      `${name}: ${required ? "필수 " : ""}문자열이며 최대 ${max}자입니다.`,
    );
  return value.trim();
}
function list(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new ProcurementError(`${name}: 최대 ${max}개 목록입니다.`);
  return value;
}
function flag(value: unknown, name: string): boolean {
  if (typeof value !== "boolean")
    throw new ProcurementError(`${name}: true/false 값이 필요합니다.`);
  return value;
}
export function iso(value: unknown, name: string): string | null {
  if (value === null || value === "") return null;
  const v = text(value, name, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
      v,
    ) ||
    !Number.isFinite(Date.parse(v))
  )
    throw new ProcurementError(
      `${name}: 시간대가 포함된 정확한 일시가 필요합니다.`,
    );
  const offset = /(Z|[+-]\d{2}:\d{2})$/.exec(v)![0];
  const offsetMinutes =
    offset === "Z"
      ? 0
      : (offset.startsWith("-") ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  if (
    Math.abs(offsetMinutes) > 14 * 60 ||
    (offset !== "Z" && Number(offset.slice(4, 6)) > 59)
  )
    throw new ProcurementError(`${name}: 유효한 시간대가 필요합니다.`);
  const local = new Date(Date.parse(v) + offsetMinutes * 60000)
    .toISOString()
    .slice(0, 16);
  if (local !== v.slice(0, 16))
    throw new ProcurementError(`${name}: 존재하지 않는 날짜·시간입니다.`);
  return new Date(v).toISOString();
}
export function safeUrl(value: unknown): string | null {
  if (value === null || value === "") return null;
  const v = text(value, "URL", 3000);
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password) throw new Error();
    return u.href;
  } catch {
    throw new ProcurementError("HTTPS URL만 사용할 수 있습니다.");
  }
}
function ids(value: unknown): string[] {
  return [
    ...new Set(list(value, "증빙 ID", 100).map((v) => text(v, "증빙 ID", 100))),
  ];
}
function citation(value: unknown): Citation | null {
  if (value === null) return null;
  const v = object(value);
  return {
    documentId: text(v.documentId, "원문 ID", 100),
    quote: text(v.quote, "원문 인용", 3000),
    location: text(v.location, "페이지·조항", 200),
  };
}
function choice<T extends string>(
  v: unknown,
  choices: readonly T[],
  name: string,
): T {
  if (!choices.includes(v as T))
    throw new ProcurementError(
      `${name}: ${choices.join(" / ")} 중 하나입니다.`,
    );
  return v as T;
}
export function parseNotice(value: unknown, id = crypto.randomUUID()): Notice {
  const v = object(value);
  const budget = v.budget === null ? null : Number(v.budget);
  if (
    v.budget !== null &&
    (typeof v.budget !== "number" ||
      !Number.isSafeInteger(budget) ||
      budget! < 0)
  )
    throw new ProcurementError("예산은 원 단위의 0 이상 정수 또는 null입니다.");
  const documents = list(v.documents, "원문", 30).map((d) => {
    const x = object(d);
    return {
      id: text(x.id, "원문 ID", 100),
      name: text(x.name, "원문 파일명", 250),
      text: text(x.text, "원문 본문", 200000, false),
      complete: flag(x.complete, "원문 전체 확인"),
      location: text(x.location, "원문 출처", 3000),
    };
  });
  if (new Set(documents.map((d) => d.id)).size !== documents.length)
    throw new ProcurementError("원문 ID가 중복되었습니다.");
  if (documents.reduce((n, d) => n + d.text.length, 0) > 700000)
    throw new ProcurementError(
      "원문 총량은 70만 자 이하여야 합니다. 문서를 나누어 검토하세요.",
    );
  return {
    id,
    noticeNo: text(v.noticeNo, "공고번호", 100),
    revision: text(v.revision, "공고 차수", 20),
    title: text(v.title, "공고명", 500),
    agency: text(v.agency, "발주기관", 300),
    publishedAt: iso(v.publishedAt, "게시일시"),
    deadline: iso(v.deadline, "마감일시"),
    budget,
    url: safeUrl(v.url),
    status: choice(v.status, ["open", "cancelled"], "공고 상태"),
    documents,
    attachments: list(v.attachments, "첨부파일", 30).map((a) => {
      const x = object(a);
      const url = safeUrl(x.url);
      if (!url) throw new ProcurementError("첨부파일 URL이 필요합니다.");
      return { name: text(x.name, "첨부 파일명", 250), url };
    }),
  };
}
export function parseReview(value: unknown): Review {
  const v = object(value);
  const requirements = list(v.requirements, "자격조건", 100).map((r) => {
    const x = object(r);
    return {
      id: text(x.id, "조건 ID", 100),
      label: text(x.label, "조건명", 500),
      status: choice(x.status, ["met", "unmet", "unknown"], "자격 판정"),
      rationale: text(x.rationale, "판단 이유", 5000, false),
      citation: citation(x.citation),
      evidenceIds: ids(x.evidenceIds),
    };
  });
  const scores = list(v.scores, "평가 항목", 5).map((s) => {
    const x = object(s);
    const key = choice(
      x.key,
      RUBRIC.map((r) => r.key),
      "평가 항목",
    );
    const rule = RUBRIC.find((r) => r.key === key)!;
    if (
      x.points !== null &&
      (typeof x.points !== "number" ||
        !Number.isInteger(x.points) ||
        x.points < 0 ||
        x.points > rule.max)
    )
      throw new ProcurementError(
        `${rule.label}: 0~${rule.max}점의 정수 또는 null입니다.`,
      );
    return {
      key,
      points: x.points as number | null,
      rationale: text(x.rationale, "평가 이유", 5000, false),
      citation: citation(x.citation),
      evidenceIds: ids(x.evidenceIds),
    };
  });
  if (scores.length !== 5 || new Set(scores.map((s) => s.key)).size !== 5)
    throw new ProcurementError("평가 항목 5개를 중복 없이 입력하세요.");
  const deliverables = list(v.deliverables, "제출서류", 100).map((d) => {
    const x = object(d);
    return {
      id: text(x.id, "서류 ID", 100),
      label: text(x.label, "서류명", 500),
      citation: citation(x.citation),
      status: choice(x.status, ["missing", "draft", "verified"], "서류 상태"),
      evidenceIds: ids(x.evidenceIds),
      note: text(x.note, "준비 사항", 3000, false),
    };
  });
  if (
    new Set(requirements.map((r) => r.id)).size !== requirements.length ||
    new Set(deliverables.map((d) => d.id)).size !== deliverables.length
  )
    throw new ProcurementError("조건·서류 ID가 중복되었습니다.");
  return {
    requirements,
    scores,
    deliverables,
    sourceReviewed: flag(v.sourceReviewed, "원문 검토 완료"),
    requirementsComplete: flag(v.requirementsComplete, "자격 목록 확정"),
    deliverablesComplete: flag(v.deliverablesComplete, "서류 목록 확정"),
  };
}
export function parseSettings(value: unknown): Settings {
  const v = object(value);
  const keywords = [
    ...new Set(
      list(v.keywords, "검색어", 10).map((s) => text(s, "검색어", 50)),
    ),
  ];
  if (!keywords.length)
    throw new ProcurementError("검색어를 하나 이상 입력하세요.");
  const recipients = [
    ...new Set(
      list(v.recipients, "수신자", 10).map((s) =>
        text(s, "이메일", 254).toLowerCase(),
      ),
    ),
  ];
  if (recipients.some((s) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s)))
    throw new ProcurementError("이메일 주소 형식이 잘못되었습니다.");
  if (
    !Number.isInteger(v.digestHour) ||
    Number(v.digestHour) < 0 ||
    Number(v.digestHour) > 23
  )
    throw new ProcurementError("발송 시각은 한국시간 0~23시입니다.");
  if (
    !Number.isInteger(v.minimumScore) ||
    Number(v.minimumScore) < 0 ||
    Number(v.minimumScore) > 100
  )
    throw new ProcurementError("추천 기준은 0~100점입니다.");
  const digestEnabled = flag(v.digestEnabled, "메일 자동발송"),
    collectionEnabled = flag(v.collectionEnabled, "공고 자동수집");
  if (digestEnabled && (!recipients.length || !collectionEnabled))
    throw new ProcurementError(
      "메일 자동발송에는 수신자와 자동수집 설정이 필요합니다.",
    );
  return {
    keywords,
    recipients,
    digestHour: Number(v.digestHour),
    minimumScore: Number(v.minimumScore),
    digestEnabled,
    collectionEnabled,
  };
}
export function parseEvidence(value: unknown): Evidence {
  const v = object(value);
  return {
    id: crypto.randomUUID(),
    category: choice(
      v.category,
      ["registration", "qualification", "project", "team", "cost", "capacity"],
      "증빙 분류",
    ),
    title: text(v.title, "자료명", 300),
    text: text(v.text, "자료 내용", 100000),
    source: text(v.source, "발급처·원본 위치", 3000),
    documentFileId:
      v.documentFileId === null
        ? null
        : text(v.documentFileId, "오너뷰 파일 ID", 100),
    verified: flag(v.verified, "원본 대조 확인"),
    verifiedAt: null,
    expiresAt: iso(v.expiresAt, "증빙 유효기간"),
    ...(v.project !== undefined ? { project: parseProject(v.project) } : {}),
  };
}

function parseProject(value: unknown): import("./types").ProjectRecord {
  const v = object(value);
  const scopes = [
    "ads",
    "social",
    "product",
    "video",
    "live",
    "education",
    "consulting",
    "program",
    "branding",
    "character",
    "showroom",
    "xr",
  ] as const;
  if (
    !Array.isArray(v.scopes) ||
    v.scopes.length > scopes.length ||
    new Set(v.scopes).size !== v.scopes.length
  )
    throw new ProcurementError("실적 업무 범위를 확인하세요.");
  if (
    v.amount !== null &&
    (typeof v.amount !== "number" ||
      !Number.isSafeInteger(v.amount) ||
      v.amount < 0)
  )
    throw new ProcurementError(
      "계약금액은 원 단위 정수 또는 미확인 값이어야 합니다.",
    );
  if (!Array.isArray(v.issues) || v.issues.length > 30)
    throw new ProcurementError("실적 확인 사항을 확인하세요.");
  return {
    agency: text(v.agency, "발주처", 500),
    period: text(v.period, "사업기간", 300),
    amount: v.amount as number | null,
    scopes: v.scopes.map((s) => choice(s, scopes, "실적 업무 범위")),
    state: choice(
      v.state,
      ["ongoing", "reported-ended", "unknown"],
      "수행 상태",
    ),
    attribution: choice(
      v.attribution,
      ["company-reported", "previous-employer", "uncertain"],
      "실적 귀속",
    ),
    duplicateGroup:
      v.duplicateGroup === null
        ? null
        : text(v.duplicateGroup, "중복 확인 그룹", 300),
    issues: v.issues.map((s) => text(s, "확인 사항", 2000)),
  };
}
export function parseEvidenceImport(
  value: unknown,
  businessNumber: string | null,
) {
  const v = object(value);
  const key = text(v.companyBusinessNumber, "대상 사업자번호", 30).replace(
    /\D/g,
    "",
  );
  if (
    !businessNumber ||
    !/^\d{10}$/.test(key) ||
    businessNumber.replace(/\D/g, "") !== key
  )
    throw new ProcurementError(
      "자료의 사업자번호와 접속한 오너뷰 회사가 다릅니다. 회사정보를 먼저 대조하세요.",
      403,
    );
  if (!Array.isArray(v.items) || !v.items.length || v.items.length > 100)
    throw new ProcurementError("자료는 1~100건씩 가져오세요.");
  return v.items.map((item) =>
    parseEvidence({
      ...object(item),
      verified: false,
      documentFileId: null,
      expiresAt: null,
    }),
  );
}
