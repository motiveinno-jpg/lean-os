import {
  DEFAULT_SETTINGS,
  RUBRIC,
  type Workspace,
  type Notice,
  type Evidence,
  type Review,
} from "../types";
import { noticeHash, evidenceHash } from "../fingerprint";
import { evaluate } from "../core";

export const now = new Date("2026-09-30T00:00:00Z");
export const notice: Notice = {
  id: "00000000-0000-4000-8000-000000000001",
  noticeNo: "TEST-001",
  revision: "000",
  title: "검증용 홍보 콘텐츠 운영 용역",
  agency: "검증용 기관",
  publishedAt: "2026-09-29T00:00:00Z",
  deadline: "2027-10-20T09:00:00Z",
  budget: 100000000,
  url: "https://www.g2b.go.kr/",
  status: "open",
  attachments: [],
  documents: [
    {
      id: "source-1",
      name: "제안요청서.txt",
      text: "홍보 콘텐츠 운영 실적과 전문 인력이 필요합니다. 적정 원가와 실제 수행 일정을 제안하여야 합니다. 제안서와 실적증명서를 제출하여야 합니다.",
      complete: true,
      location: "검증용 제안요청서",
    },
  ],
};
export const evidence: Evidence[] = (
  ["qualification", "project", "team", "cost", "capacity"] as const
).map((category, i) => ({
  id: `evidence-${i}`,
  category,
  title: `검증용 ${category} 증빙`,
  text: "검증용 자료입니다. 실제 회사 실적으로 사용하지 않습니다.",
  source: "검증용 원본",
  documentFileId: null,
  verified: true,
  verifiedAt: "2026-09-29T00:00:00Z",
  expiresAt: "2027-12-31T23:59:00Z",
}));
export const citation = {
  documentId: "source-1",
  quote: "홍보 콘텐츠 운영 실적과 전문 인력이 필요합니다.",
  location: "제안요청서 1페이지",
};
export const review: Review = {
  sourceReviewed: true,
  requirementsComplete: true,
  deliverablesComplete: true,
  requirements: [
    {
      id: "req-1",
      label: "공고 필수 자격",
      status: "met",
      rationale: "검증용 자격 원본 대조",
      citation,
      evidenceIds: ["evidence-0"],
    },
  ],
  scores: RUBRIC.map((r, i) => ({
    key: r.key,
    points: r.max,
    rationale: `검증용 ${r.label} 평가 이유`,
    citation,
    evidenceIds: [`evidence-${[1, 2, 3, 4, 1][i]}`],
  })),
  deliverables: [
    {
      id: "doc-1",
      label: "실적증명서",
      citation,
      status: "verified",
      evidenceIds: ["evidence-1"],
      note: "원본 확인",
    },
  ],
};
export function fixtureWorkspace(): Workspace {
  const company = {
    id: "00000000-0000-4000-8000-000000000002",
    name: "검증용 회사 (실제 모티브 데이터 아님)",
    business_number: "000-00-00000",
    representative: "검증 담당자",
    address: "검증용 주소",
    phone: null,
    fax: null,
    industry: "검증용",
    business_type: null,
    business_category: null,
  };
  const settings = { ...DEFAULT_SETTINGS };
  return {
    company,
    settings,
    profile: null,
    files: [],
    evidence: structuredClone(evidence),
    notices: [
      {
        id: notice.id,
        payload: structuredClone(notice),
        content_hash: noticeHash(notice),
        created_at: now.toISOString(),
      },
    ],
    reviews: [
      {
        id: "review-1",
        notice_id: notice.id,
        content_hash: noticeHash(notice),
        evidence_hash: evidenceHash(evidence, company, settings),
        review: structuredClone(review),
        assessment: evaluate(notice, review, evidence, 75, now),
        created_at: now.toISOString(),
      },
    ],
    cases: [],
    drafts: [],
    runs: [],
    ready: true,
    integration: { g2b: false, mail: false, scheduler: false },
  };
}
