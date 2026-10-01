import {
  RUBRIC,
  type Notice,
  type Evidence,
  type Review,
  type Citation,
  type Assessment,
  type CompanyBasics,
} from "./types";

const norm = (v: string) => v.replace(/\s+/g, " ").trim();
export function citationValid(c: Citation | null, notice: Notice): boolean {
  if (!c?.documentId || !c.location.trim() || norm(c.quote).length < 8)
    return false;
  const d = notice.documents.find((d) => d.id === c.documentId);
  return !!d && norm(d.text).includes(norm(c.quote));
}
export function usableEvidence(e: Evidence, now: Date): boolean {
  return (
    e.verified &&
    !!e.verifiedAt &&
    Number.isFinite(Date.parse(e.verifiedAt)) &&
    Date.parse(e.verifiedAt) <= now.getTime() &&
    !!e.source.trim() &&
    !!e.text.trim() &&
    (!e.expiresAt ||
      (Number.isFinite(Date.parse(e.expiresAt)) &&
        Date.parse(e.expiresAt) >= now.getTime()))
  );
}
export function evaluate(
  notice: Notice,
  review: Review,
  evidence: Evidence[],
  minimumScore = 75,
  now = new Date(),
): Assessment {
  const blockers: string[] = [],
    warnings: string[] = [];
  const usable = new Set(
    evidence.filter((e) => usableEvidence(e, now)).map((e) => e.id),
  );
  const backed = (ids: string[]) =>
    ids.length > 0 && ids.every((id) => usable.has(id));
  const sourceComplete =
    notice.documents.length > 0 &&
    notice.documents.every((d) => d.complete && d.text.trim()) &&
    notice.attachments.every((a) =>
      notice.documents.some((d) => norm(d.name) === norm(a.name)),
    );
  if (notice.status === "cancelled") blockers.push("취소된 공고입니다.");
  const deadline = notice.deadline ? Date.parse(notice.deadline) : NaN;
  if (!Number.isFinite(deadline))
    blockers.push("정확한 마감일시를 확인해야 합니다.");
  else if (deadline <= now.getTime())
    blockers.push("입찰 마감일시가 지났습니다.");
  if (!sourceComplete || !review.sourceReviewed)
    blockers.push("공고문·제안요청서·첨부서식의 전체 원문 검토가 필요합니다.");
  if (!review.requirementsComplete || !review.requirements.length)
    blockers.push("필수 자격조건 목록을 확정해야 합니다.");
  let unmet = false,
    unknown =
      !review.requirements.length ||
      !review.requirementsComplete ||
      !sourceComplete ||
      !review.sourceReviewed;
  for (const r of review.requirements) {
    if (!citationValid(r.citation, notice) || !r.rationale.trim()) {
      unknown = true;
      blockers.push(`${r.label}: 공고 원문 근거와 판단 이유가 필요합니다.`);
      continue;
    }
    if (r.status === "unmet" && backed(r.evidenceIds)) {
      unmet = true;
      blockers.push(`${r.label}: 필수 자격 미충족`);
    } else if (r.status === "unknown" || !backed(r.evidenceIds)) {
      unknown = true;
      blockers.push(`${r.label}: 유효한 회사 증빙 확인 필요`);
    }
  }
  let knownPoints = 0,
    assessedMax = 0;
  const criteria: Assessment["criteria"] = [];
  const categories: Record<string, Evidence["category"][]> = {
    experience: ["project"],
    capability: ["team", "project"],
    profit: ["cost"],
    capacity: ["capacity"],
    strategy: ["project", "team"],
  };
  for (const rule of RUBRIC) {
    const matches = review.scores.filter((s) => s.key === rule.key);
    const s = matches[0];
    if (
      matches.length !== 1 ||
      s.points === null ||
      !Number.isFinite(s.points) ||
      s.points < 0 ||
      s.points > rule.max ||
      !s.rationale.trim() ||
      !citationValid(s.citation, notice) ||
      !backed(s.evidenceIds) ||
      !evidence.some(
        (e) =>
          s.evidenceIds.includes(e.id) &&
          usable.has(e.id) &&
          categories[rule.key].includes(e.category),
      )
    ) {
      blockers.push(`${rule.label}: 점수·원문 근거·유효한 회사 증빙 확인 필요`);
      criteria.push({ key: rule.key, points: null, max: rule.max });
      continue;
    }
    knownPoints += s.points;
    assessedMax += rule.max;
    criteria.push({ key: rule.key, points: s.points, max: rule.max });
  }
  if (!review.deliverablesComplete || !review.deliverables.length)
    blockers.push("제출서류·서식 목록을 확정해야 합니다.");
  for (const d of review.deliverables) {
    if (!citationValid(d.citation, notice))
      blockers.push(`${d.label}: 요구서류의 공고 원문 근거가 필요합니다.`);
    if (d.status !== "verified" || !backed(d.evidenceIds))
      warnings.push(`${d.label}: 제출 전 준비·검수 필요`);
  }
  if (notice.budget === null)
    warnings.push(
      "예산이 확인되지 않았습니다. 수익성 판단에 실제 견적 근거가 필요합니다.",
    );
  const eligibility = unmet ? "ineligible" : unknown ? "unknown" : "eligible";
  const total =
    assessedMax === 100 && blockers.length === 0 ? knownPoints : null;
  const excluded =
    unmet ||
    notice.status === "cancelled" ||
    (Number.isFinite(deadline) && deadline <= now.getTime());
  return {
    eligibility,
    total,
    knownPoints,
    assessedMax,
    recommendation: excluded
      ? "exclude"
      : blockers.length
        ? "hold"
        : total! >= minimumScore
          ? "recommend"
          : "consider",
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    criteria,
    evaluatedAt: now.toISOString(),
  };
}
export function draftPlan(
  company: CompanyBasics,
  notice: Notice,
  review: Review,
  assessment: Assessment,
): string {
  const field = (v: string | null) => v?.trim() || "[확인 필요]";
  return [
    `# ${notice.title} — 기획·제출 준비 초안`,
    `공고번호: ${notice.noticeNo} / 차수: ${notice.revision}`,
    `작성 상태: 검토용 초안 · 최종 제출 전 원본 서식·가격·투입인력·날인 확인`,
    `## 회사 기본정보 (오너뷰)`,
    `회사명: ${company.name}\n사업자번호: ${field(company.business_number)}\n대표자: ${field(company.representative)}\n주소: ${field(company.address)}\n연락처: ${field(company.phone)}`,
    `## 사업 이해와 기획 방향`,
    `[작성 필요] 목적, 대상, 메시지, 채널, 차별화 방향을 제안요청서 평가기준에 맞춰 작성합니다.`,
    `## 필수 조건 대응표`,
    ...review.requirements.map(
      (r) =>
        `- ${r.label}: ${r.status}\n  근거: ${r.citation?.location || "[확인 필요]"} / ${r.citation?.quote || "[확인 필요]"}\n  회사 증빙: ${r.evidenceIds.join(", ") || "[확인 필요]"}\n  판단: ${r.rationale || "[확인 필요]"}`,
    ),
    `## 제안서 구성`,
    `1. 사업 이해 및 목표\n2. 홍보 전략과 세부 실행계획\n3. 산출물·성과지표\n4. 투입인력·역할·일정\n5. 관련 실적과 증빙\n6. 품질·리스크·보고 체계\n7. 예산·원가 근거`,
    `[작성 필요] 실제 평가항목과 지정 목차에 맞춰 재구성합니다. 미확인 실적·성과·인력·금액은 기입하지 않습니다.`,
    `## 제출서류 대응표`,
    ...review.deliverables.map(
      (d) =>
        `- ${d.label}: ${d.status} / ${d.citation?.location || "[확인 필요]"}\n  준비 사항: ${d.note || "[담당자·완료일 지정 필요]"}`,
    ),
    `## 현재 검토 결과`,
    `자격: ${assessment.eligibility}\n점수: ${assessment.total === null ? "미확정" : assessment.total + "/100"}`,
    ...[...assessment.blockers, ...assessment.warnings].map((b) => `- ${b}`),
    `## 제출 전 확인`,
    `- 최신 정정·취소 공고와 제출 마감일시 재확인\n- 요구한 파일 형식·용량·분량·익명성·분리 제출 여부 확인\n- 증빙 유효기간·회사명·금액·날짜 대조\n- 가격 및 실제 투입인력 확정\n- 서명·날인 및 최종 제출 담당자 확인\n- 제출 완료와 접수 확인 기록 보관`,
  ].join("\n\n");
}
