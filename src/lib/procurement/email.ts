import { evaluate } from "./core";
import { scopePrecheck } from "./scope";
import type { Analysis } from "./ai";
import {
  RUBRIC,
  type Workspace,
  type Assessment,
  type NoticeRow,
  type ReviewRow,
} from "./types";
const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const kstDay = (now = new Date()) =>
  new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
export function buildDigest(
  ws: Workspace,
  basisHash: string,
  now = new Date(),
): { subject: string; html: string } {
  const entries = ws.notices
    .map((n) => {
      const review = ws.reviews.find((r) => r.notice_id === n.id);
      const stale =
        !!review &&
        (review.content_hash !== n.content_hash ||
          review.evidence_hash !== basisHash);
      const assessment =
        review && !stale
          ? evaluate(
              n.payload,
              review.review,
              ws.evidence,
              ws.settings.minimumScore,
              now,
            )
          : null;
      const analysis = ws.artifacts?.find(
        (a) => a.notice_id === n.id && a.kind === "analysis" && !a.stale,
      )?.body as Analysis | undefined;
      return { n, assessment, stale, review, analysis };
    })
    .filter(
      (e) =>
        e.n.payload.status !== "cancelled" &&
        (!e.n.payload.deadline ||
          Date.parse(e.n.payload.deadline) > now.getTime()) &&
        e.assessment?.recommendation !== "exclude",
    )
    .sort(
      (a, b) =>
        (b.assessment?.total ?? -1) - (a.assessment?.total ?? -1) ||
        { possible: 2, confirm: 1, difficult: 0 }[
          b.analysis?.fit || "confirm"
        ] -
          { possible: 2, confirm: 1, difficult: 0 }[
            a.analysis?.fit || "confirm"
          ],
    )
    .slice(0, 5);
  const latestCollect = ws.runs.find((r) => r.kind === "collect");
  const freshness = !latestCollect
    ? "공고 자동수집을 아직 실행하지 않았습니다. 아래 목록은 전체 공고 수집 결과가 아닙니다."
    : latestCollect.status !== "completed"
      ? "최근 수집이 완료되지 않았습니다. 공고가 누락되었을 수 있으므로 원문 목록을 확인하세요."
      : `최근 수집: ${new Date(latestCollect.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 검색어 ${ws.settings.keywords.join(", ")} · 최근 7일 게시 공고 범위`;
  const labels = {
    recommend: "추천",
    consider: "검토 후보",
    hold: "확인 필요",
    exclude: "제외",
  };
  const render = ({
    n,
    assessment: a,
    stale,
    review,
    analysis,
  }: {
    n: NoticeRow;
    assessment: Assessment | null;
    stale: boolean;
    review?: ReviewRow;
    analysis?: Analysis;
  }) => {
    const notice = n.payload;
    const scope = scopePrecheck(notice, ws.evidence);
    return `<article style="border-top:1px solid #ddd;padding:20px 0"><h2 style="font-size:17px">${esc(notice.title)}</h2>
      <p>${esc(notice.agency)} · ${esc(notice.noticeNo)} / ${esc(notice.revision)}차</p>
      <p>예산: ${notice.budget === null ? "미확인" : notice.budget.toLocaleString("ko-KR") + "원"} · 마감: ${notice.deadline ? esc(new Date(notice.deadline).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })) : "미확인"}</p>
      <p><strong>${stale ? "자료 변경 — 재평가 필요" : a ? labels[a.recommendation] : "상세 검토 대기"}</strong> · ${a?.total === null || !a ? "종합점수 미확정" : a.total + "/100점"}</p>
      <p><strong>실적 기반 사전 분류: ${esc(scope.label)}</strong> · ${scope.complete ? "첨부 원문 기록 있음" : "전체 원문 확인 필요"}</p>
      ${analysis ? `<h3>AI 상세 검토 초안</h3><p>${esc(analysis.summary)}</p><ul>${analysis.tasks.map((t) => `<li>${esc(t.label)}: ${esc(t.reason)}<br>원문: ${esc(t.citation?.location || "확인 필요")} / ${esc(t.citation?.quote || "확인 필요")}</li>`).join("")}</ul><p>조건 확인: ${esc(analysis.questions.join(" / "))}</p>` : "<p>AI 상세 검토는 아직 완료되지 않았습니다.</p>"}
      <ul>${scope.tasks.map((t) => `<li>${esc(t.label)}: ${esc(t.reason)}<br>관련 실적: ${esc(t.evidence.map((e) => e.title).join(", ") || "직접 수행 근거 미확인")}</li>`).join("")}</ul><p>${esc(scope.caveat)}</p>
      ${a ? `<ul>${[...a.blockers, ...a.warnings].map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "<p>원문과 회사 증빙 대조 후 자격·점수를 확정합니다.</p>"}
      ${
        review && !stale
          ? `<h3 style="font-size:15px">항목별 상세 평가</h3>${RUBRIC.map(
              (rule) => {
                const score = review.review.scores.find(
                  (s) => s.key === rule.key,
                );
                const points = a?.criteria.find(
                  (c) => c.key === rule.key,
                )?.points;
                return `<p><strong>${rule.label}: ${points === null || points === undefined ? "미확정" : points + "/" + rule.max + "점"}</strong><br>${esc(score?.rationale || "평가 이유 확인 필요")}<br>원문: ${esc(score?.citation?.location || "미확인")} · ${esc(score?.citation?.quote || "미확인")}<br>회사 자료: ${esc(score?.evidenceIds.map((id) => ws.evidence.find((e) => e.id === id)?.title || "증빙 확인 필요").join(", ") || "미확인")}</p>`;
              },
            ).join("")}`
          : ""
      }
      ${notice.url && /^https:\/\//.test(notice.url) ? `<a href="${esc(notice.url)}">나라장터 원문</a> · ` : ""}<a href="https://www.owner-view.com/procurement">상세 평가와 진행 결정</a>
    </article>`;
  };
  return {
    subject: `[${ws.company.name}] ${kstDay(now)} 홍보 입찰 검토`,
    html: `<!doctype html><html lang="ko"><body style="max-width:720px;margin:auto;padding:24px;font-family:sans-serif;color:#172033"><h1 style="font-size:22px">오늘의 입찰 검토 · 최대 5개 후보</h1><p>${esc(ws.company.name)} · ${kstDay(now)}</p><p>${esc(freshness)}</p><p>점수는 지원 우선순위이며 낙찰 확률을 뜻하지 않습니다. 미확인 조건은 추천으로 확정하지 않습니다.</p>${entries.length ? entries.map(render).join("") : "<p>현재 표시할 미마감 후보가 없습니다. 수집 상태와 검색 범위를 확인하세요.</p>"}</body></html>`,
  };
}
