/** 모든 점수·자격 판단은 원문과 회사 증빙으로 역추적한다. 미확인은 0점과 다르다. */
export const RUBRIC = [
  { key: "experience", label: "유사 실적", max: 30 },
  { key: "capability", label: "수행 역량", max: 25 },
  { key: "profit", label: "수익성", max: 20 },
  { key: "capacity", label: "일정·업무 여력", max: 15 },
  { key: "strategy", label: "제안 경쟁력", max: 10 },
] as const;
export type CriterionKey = (typeof RUBRIC)[number]["key"];
export type CompanyBasics = {
  id: string;
  name: string;
  business_number: string | null;
  representative: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  industry: string | null;
  business_type: string | null;
  business_category: string | null;
};
export type SourceDocument = {
  id: string;
  name: string;
  text: string;
  complete: boolean;
  location: string;
};
export type Citation = { documentId: string; quote: string; location: string };
export type Notice = {
  id: string;
  noticeNo: string;
  revision: string;
  title: string;
  agency: string;
  publishedAt: string | null;
  deadline: string | null;
  budget: number | null;
  url: string | null;
  status: "open" | "cancelled";
  documents: SourceDocument[];
  attachments: { name: string; url: string }[];
};
export type Evidence = {
  id: string;
  category:
    "registration" | "qualification" | "project" | "team" | "cost" | "capacity";
  title: string;
  text: string;
  source: string;
  documentFileId: string | null;
  verified: boolean;
  verifiedAt: string | null;
  expiresAt: string | null;
  project?: ProjectRecord;
  revokedReason?: string;
  revokedAt?: string;
  revokedBy?: string;
};
export const PROJECT_SCOPES = [
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
export type ProjectScope = (typeof PROJECT_SCOPES)[number];
export type ProjectRecord = {
  agency: string;
  period: string;
  amount: number | null;
  scopes: ProjectScope[];
  state: "ongoing" | "reported-ended" | "unknown";
  attribution: "company-reported" | "previous-employer" | "uncertain";
  duplicateGroup: string | null;
  issues: string[];
};
export type RequirementCheck = {
  id: string;
  label: string;
  status: "met" | "unmet" | "unknown";
  rationale: string;
  citation: Citation | null;
  evidenceIds: string[];
};
export type ScoreCheck = {
  key: CriterionKey;
  points: number | null;
  rationale: string;
  citation: Citation | null;
  evidenceIds: string[];
};
export type DocumentCheck = {
  id: string;
  label: string;
  citation: Citation | null;
  status: "missing" | "draft" | "verified";
  evidenceIds: string[];
  note: string;
};
export type Review = {
  requirements: RequirementCheck[];
  scores: ScoreCheck[];
  deliverables: DocumentCheck[];
  // 원문·첨부를 사람이 모두 읽고 요구사항을 빠짐없이 옮겼는지. 기본 false.
  sourceReviewed: boolean;
  requirementsComplete: boolean;
  deliverablesComplete: boolean;
};
export type Assessment = {
  eligibility: "eligible" | "ineligible" | "unknown";
  total: number | null;
  knownPoints: number;
  assessedMax: number;
  recommendation: "recommend" | "consider" | "hold" | "exclude";
  blockers: string[];
  warnings: string[];
  evaluatedAt: string;
  criteria: { key: CriterionKey; points: number | null; max: number }[];
};
export type Settings = {
  keywords: string[];
  recipients: string[];
  digestHour: number;
  digestEnabled: boolean;
  collectionEnabled: boolean;
  minimumScore: number;
};
export const DEFAULT_SETTINGS: Settings = {
  keywords: ["홍보"],
  recipients: [],
  digestHour: 8,
  digestEnabled: false,
  collectionEnabled: false,
  minimumScore: 75,
};
export const emptyReview = (): Review => ({
  requirements: [],
  deliverables: [],
  scores: RUBRIC.map((r) => ({
    key: r.key,
    points: null,
    rationale: "",
    citation: null,
    evidenceIds: [],
  })),
  sourceReviewed: false,
  requirementsComplete: false,
  deliverablesComplete: false,
});
export type NoticeRow = {
  id: string;
  payload: Notice;
  content_hash: string;
  created_at: string;
};
export type ReviewRow = {
  id: string;
  notice_id: string;
  content_hash: string;
  evidence_hash: string;
  review: Review;
  assessment: Assessment;
  created_at: string;
  stale?: boolean;
};
export type CaseRow = {
  id: string;
  notice_id: string;
  review_id: string;
  decision: "proceed" | "hold" | "decline";
  note: string;
  created_at: string;
};
export type DraftRow = {
  id: string;
  case_id: string;
  content: string;
  created_at: string;
};
export type RunRow = {
  id: string;
  kind: string;
  status: string;
  summary: string;
  created_at: string;
};
export type Workspace = {
  workforce?: ReturnType<typeof import("./workforce").workforceSummary>;
  company: CompanyBasics;
  profile: {
    open_date: string | null;
    size_class: string | null;
    certifications: string[];
  } | null;
  files: { id: string; file_name: string; created_at: string | null }[];
  settings: Settings;
  evidence: Evidence[];
  notices: NoticeRow[];
  reviews: ReviewRow[];
  cases: CaseRow[];
  drafts: DraftRow[];
  runs: RunRow[];
  ready: boolean;
  integration: {
    g2b: boolean;
    g2bVerified?: boolean;
    mail: boolean;
    scheduler: boolean;
  };
};
