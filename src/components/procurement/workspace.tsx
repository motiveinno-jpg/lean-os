"use client";

import {
  useState,
  useId,
  isValidElement,
  cloneElement,
  type ReactNode,
} from "react";
import { DateTimeField } from "@/components/datetime-field";
import { evaluate } from "@/lib/procurement/core";
import { scopePrecheck } from "@/lib/procurement/scope";
import type { Analysis, Proposal } from "@/lib/procurement/ai";
import { INTAKE, intakeMarkdown } from "@/lib/procurement/intake";
import {
  RUBRIC,
  emptyReview,
  type Workspace,
  type Notice,
  type Evidence,
  type Review,
  type Citation,
  type Settings,
} from "@/lib/procurement/types";
import styles from "./workspace.module.css";

export type Action = (body: Record<string, unknown>) => Promise<void>;
const STATUS = {
  recommend: "추천",
  consider: "검토 후보",
  hold: "확인 필요",
  exclude: "제외",
};
const ELIGIBILITY = {
  eligible: "충족 확인",
  ineligible: "미충족",
  unknown: "확인 필요",
};
const fmt = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "미확인";
const localTime = (v: string | null) =>
  v ? new Date(Date.parse(v) + 9 * 3600000).toISOString().slice(0, 16) : "";
const utcTime = (v: string) => (v ? `${v}:00+09:00` : null);
function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ScopePanel({
  notice,
  evidence,
}: {
  notice: Notice;
  evidence: Evidence[];
}) {
  const result = scopePrecheck(notice, evidence);
  return (
    <section className={styles.section} aria-label="실적 기반 수행 범위 대조">
      <h3>실적 기반 사전 분류 · {result.label}</h3>
      <p>{result.caveat}</p>
      {!result.complete && (
        <p>
          전체 원문·첨부가 확보되지 않아 수행 가능 여부를 확정할 수 없습니다.
        </p>
      )}
      {!result.tasks.length && (
        <p>
          현재 규칙으로 구체적인 업무를 식별하지 못했습니다. 전문을 직접
          검토하세요.
        </p>
      )}
      {result.tasks.map((task) => (
        <article key={task.key} className={styles.section}>
          <h4>
            {task.label} ·{" "}
            {task.status === "possible"
              ? "유사 실적 있음"
              : task.status === "difficult"
                ? "직접 수행 근거 부족"
                : "추가 확인"}
          </h4>
          <p>{task.reason}</p>
          {task.hits.map((h, i) => (
            <p className={styles.wrap} key={i}>
              발견 위치: {h.location} / 원문 발췌: {h.quote}
            </p>
          ))}
          {task.evidence.map((e) => (
            <p className={styles.wrap} key={e.id}>
              관련 실적: {e.title} ·{" "}
              {e.state === "ongoing" ? "수행 중" : "수행 상태 대조 필요"} ·{" "}
              {e.verified ? "원본 대조" : "공식 증빙 확인 대기"}
              <br />
              {e.source}
              <br />
              {e.issues.join(" / ")}
            </p>
          ))}
        </article>
      ))}
    </section>
  );
}
function ProjectImport({
  disabled,
  onSave,
}: {
  disabled: boolean;
  onSave: (bundle: unknown) => Promise<void>;
}) {
  const [bundle, setBundle] = useState<unknown>(null),
    [error, setError] = useState("");
  const [count, setCount] = useState(0);
  return (
    <section className={styles.section}>
      <h3>분석한 실적 자료 가져오기</h3>
      <p>
        회사 사업자번호가 일치하는 JSON 자료만 가져옵니다. 중복 가져오기는 같은
        자료를 재등록하지 않습니다. 가져온 자료는 공식 증빙 확인 대기로
        보관하며, 직원 이전 회사 경력과 수행 중 사업을 구분합니다.
      </p>
      <Field label="실적 분석 JSON 파일">
        <input
          type="file"
          accept=".json,application/json"
          disabled={disabled}
          onChange={async (event) => {
            setError("");
            setBundle(null);
            setCount(0);
            try {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 2000000)
                throw new Error("자료는 2MB 이하여야 합니다.");
              const data = JSON.parse(await file.text());
              if (
                !Array.isArray(data.items) ||
                !data.items.length ||
                data.items.length > 100 ||
                !data.companyBusinessNumber
              )
                throw new Error(
                  "대상 사업자번호와 1~100건의 자료가 필요합니다.",
                );
              setBundle(data);
              setCount(data.items.length);
            } catch (e) {
              setError(e instanceof Error ? e.message : "파일을 확인하세요.");
            }
          }}
        />
      </Field>
      {count > 0 && <p>{count}건 준비 · 원본 대조 및 계약 귀속 확인 대기</p>}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={disabled || !bundle}
        onClick={async () => {
          try {
            await onSave(bundle);
            setBundle(null);
            setCount(0);
            setError("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "저장 실패");
          }
        }}
      >
        실적 자료 저장
      </button>
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const direct =
    isValidElement<{ id?: string; "aria-labelledby"?: string }>(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type);
  const control = direct
    ? cloneElement(children, { id, "aria-labelledby": `${id}-label` })
    : children;
  return (
    <div
      className={styles.field}
      role={direct ? undefined : "group"}
      aria-labelledby={direct ? undefined : `${id}-label`}
    >
      <label id={`${id}-label`} htmlFor={direct ? id : undefined}>
        {label}
      </label>
      {control}
    </div>
  );
}
function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

export function ProcurementWorkspace({
  ws,
  onAction,
  refresh,
}: {
  ws: Workspace;
  onAction: Action;
  refresh: () => void;
}) {
  const [tab, setTab] = useState("notices"),
    [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false),
    [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const run: Action = async (body) => {
    setBusy(true);
    setMessage("");
    try {
      await onAction(body);
      setMessage("처리했습니다. 최신 자료를 확인하세요.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "처리하지 못했습니다.");
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const safeRun = (body: Record<string, unknown>) => {
    void run(body).catch(() => {});
  };
  const row = ws.notices.find((n) => n.id === selected),
    savedReview = row && ws.reviews.find((r) => r.notice_id === row.id);
  const aiAnalysis =
    row &&
    ws.artifacts?.find(
      (a) => a.notice_id === row.id && a.kind === "analysis" && !a.stale,
    );
  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            나라장터 · 회사 실적과 증빙을 기준으로
          </p>
          <h1>입찰 검토</h1>
          <p>
            {ws.company.name}의 공고를 찾고, 조건을 대조하고, 진행할 사업을
            준비합니다.
          </p>
        </div>
        <button type="button" onClick={refresh}>
          새로고침
        </button>
      </header>
      {!ws.ready && (
        <div className={styles.notice} role="status">
          입찰 저장소 설치 대기입니다. 오너뷰 기본정보와 자료 요청 목록을 먼저
          확인할 수 있습니다. 공고 저장·자동수집·메일 발송은 저장소 준비 후
          사용할 수 있습니다.
        </div>
      )}
      <div className={styles.stats}>
        <div>
          <strong>{ws.notices.length}</strong>
          <span>저장된 최신 공고</span>
        </div>
        <div>
          <strong>{ws.evidence.filter((e) => e.verified).length}</strong>
          <span>원본 대조한 회사 자료</span>
        </div>
        <div>
          <strong>
            {ws.cases.filter((c) => c.decision === "proceed").length}
          </strong>
          <span>진행 결정 기록</span>
        </div>
        <div>
          <strong>
            {ws.settings.digestEnabled
              ? `${ws.settings.digestHour}시`
              : "준비 중"}
          </strong>
          <span>아침 메일 · 한국시간</span>
        </div>
      </div>
      <nav className={styles.tabs} aria-label="입찰 검토 갈래">
        {[
          ["notices", "공고·상세 검토"],
          ["company", "회사 자료"],
          ["intake", "필요한 자료"],
          ["drafts", "서류 준비"],
          ["settings", "수집·메일 설정"],
          ["history", "실행 이력"],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setMessage("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {message && (
        <div className={styles.notice} role="status">
          {message}
        </div>
      )}
      <fieldset className={styles.body} disabled={busy}>
        {tab === "notices" && (
          <>
            <div className={styles.toolbar}>
              <p>
                점수는 낙찰 확률이 아닙니다. 원문·자격·회사 증빙이 부족하면
                종합점수를 확정하지 않습니다.
              </p>
              <button
                type="button"
                disabled={!ws.ready}
                onClick={() => {
                  setImporting(!importing);
                  setEditing(false);
                }}
              >
                공고 직접 등록
              </button>
              <button
                type="button"
                disabled={!ws.ready || !ws.integration.g2b}
                onClick={() => safeRun({ action: "collect" })}
              >
                공고 가져오기
              </button>
            </div>
            {importing && (
              <NoticeEditor
                key="new"
                onSave={async (notice) => {
                  await run({ action: "notice", notice });
                  setImporting(false);
                }}
              />
            )}
            <div className={styles.columns}>
              <section className={styles.list} aria-label="공고 목록">
                {!ws.notices.length && (
                  <div className={styles.empty}>
                    <h2>아직 수집한 공고가 없습니다</h2>
                    <p>
                      나라장터 연결을 준비하거나 검토할 공고와 첨부 원문을 직접
                      등록하세요. 회사 자료가 없어도 원문 검토부터 시작할 수
                      있습니다.
                    </p>
                  </div>
                )}
                {ws.notices.map((n) => {
                  const r = ws.reviews.find((r) => r.notice_id === n.id);
                  const a =
                    r && !r.stale
                      ? evaluate(
                          n.payload,
                          r.review,
                          ws.evidence,
                          ws.settings.minimumScore,
                        )
                      : null;
                  return (
                    <button
                      type="button"
                      className={styles.noticeRow}
                      key={n.id}
                      aria-pressed={selected === n.id}
                      onClick={() => {
                        setSelected(n.id);
                        setEditing(false);
                      }}
                    >
                      <span className={styles.eyebrow}>
                        {n.payload.agency} · {n.payload.noticeNo}/
                        {n.payload.revision}
                      </span>
                      <strong>{n.payload.title}</strong>
                      <span>
                        실적 대조: {scopePrecheck(n.payload, ws.evidence).label}
                      </span>
                      <span>
                        {n.payload.budget === null
                          ? "예산 미확인"
                          : n.payload.budget.toLocaleString() + "원"}{" "}
                        · 마감 {fmt(n.payload.deadline)}
                      </span>
                      <span>
                        {a
                          ? `${STATUS[a.recommendation]} · ${a.total === null ? "점수 미확정" : a.total + "/100점"}`
                          : r?.stale
                            ? "자료 변경 · 재평가 필요"
                            : "상세 검토 대기"}
                      </span>
                    </button>
                  );
                })}
              </section>
              {row ? (
                <section className={styles.detail}>
                  <div className={styles.toolbar}>
                    <h2>{row.payload.title}</h2>
                    <button type="button" onClick={() => setEditing(!editing)}>
                      원문·공고 정보 보완
                    </button>
                  </div>
                  <p>
                    최신 차수 {row.payload.revision} · 마감{" "}
                    {fmt(row.payload.deadline)}
                  </p>
                  {row.payload.url && (
                    <a href={row.payload.url} target="_blank" rel="noreferrer">
                      나라장터 원문 열기
                    </a>
                  )}
                  <ScopePanel notice={row.payload} evidence={ws.evidence} />
                  <section className={styles.section}>
                    <h3>AI 상세 검토와 사업 선택</h3>
                    <p>
                      업종코드·필수 조건·실적·인력·원가를 원문과 대조합니다. AI
                      초안은 확정 자격·최종 제출 검수를 대신하지 않습니다.
                    </p>
                    <button
                      type="button"
                      disabled={!ws.ready || !ws.integration.ai}
                      onClick={() =>
                        safeRun({ action: "analyze", noticeId: row.id })
                      }
                    >
                      AI로 상세 검토
                    </button>
                    <button
                      type="button"
                      disabled={!ws.ready || !ws.integration.ai}
                      onClick={() =>
                        safeRun({
                          action: "prepare-proposal",
                          noticeId: row.id,
                        })
                      }
                    >
                      이 사업 선택 · 기획서·제안서 작성
                    </button>
                    {ws.jobs
                      ?.filter((j) => j.notice_id === row.id)
                      .slice(0, 3)
                      .map((j) => (
                        <p key={j.id}>
                          {j.kind === "analysis"
                            ? "상세 검토"
                            : "기획·제안서 작성"}{" "}
                          ·{" "}
                          {j.status === "queued"
                            ? "대기"
                            : j.status === "running"
                              ? "작성 중"
                              : j.status === "completed"
                                ? "완료"
                                : "실패"}
                          {j.error ? " / " + j.error : ""}
                        </p>
                      ))}
                    {aiAnalysis && (
                      <AIAnalysisPanel
                        data={
                          aiAnalysis.body as Analysis & {
                            sourceIssues?: string[];
                          }
                        }
                      />
                    )}
                  </section>
                  {row.payload.attachments.length > 0 && (
                    <div className={styles.section}>
                      <h3>공고 첨부 · 전문 확보 필요</h3>
                      {row.payload.attachments.map((a) => (
                        <p key={a.url}>
                          <a href={a.url} target="_blank" rel="noreferrer">
                            {a.name}
                          </a>
                        </p>
                      ))}
                    </div>
                  )}
                  {editing && (
                    <NoticeEditor
                      key={row.id}
                      initial={row.payload}
                      onSave={async (notice) => {
                        await run({ action: "notice", notice });
                        setEditing(false);
                        setSelected(null);
                      }}
                    />
                  )}
                  {savedReview?.stale && (
                    <div className={styles.notice}>
                      공고 또는 회사 자료가 변경되었습니다. 이전 평가는
                      확정값으로 사용하지 않습니다. 원문과 증빙을 다시
                      검토하세요.
                    </div>
                  )}
                  <ReviewEditor
                    key={`${row.id}:${savedReview?.id || aiAnalysis?.id || "new"}`}
                    notice={row.payload}
                    ws={ws}
                    initial={
                      savedReview?.stale
                        ? {
                            ...savedReview.review,
                            sourceReviewed: false,
                            requirementsComplete: false,
                            deliverablesComplete: false,
                            scores: savedReview.review.scores.map((s) => ({
                              ...s,
                              points: null,
                            })),
                          }
                        : savedReview?.review ||
                          (aiAnalysis?.body as Analysis | undefined)?.review
                    }
                    onSave={(review) =>
                      run({ action: "review", noticeId: row.id, review })
                    }
                  />
                  {savedReview && (
                    <DecisionEditor
                      onSave={(decision, note) =>
                        run({
                          action: "decision",
                          noticeId: row.id,
                          reviewId: savedReview.id,
                          decision,
                          note,
                        })
                      }
                    />
                  )}
                </section>
              ) : (
                ws.notices.length > 0 && (
                  <div className={styles.empty}>
                    공고를 선택하면 원문 근거·자격조건·항목별 점수·제출서류를
                    하나씩 검토합니다.
                  </div>
                )
              )}
            </div>
          </>
        )}
        {tab === "company" && (
          <>
            <h2>오너뷰에서 가져온 기본정보</h2>
            <p>
              접속한 회사의 최신 정보입니다. 수정은 오너뷰 회사 기초정보에서
              합니다. 입찰용 증명서는 별도로 대조합니다.
            </p>
            <dl className={styles.basics}>
              {Object.entries({
                회사명: ws.company.name,
                사업자번호: ws.company.business_number,
                대표자: ws.company.representative,
                주소: ws.company.address,
                연락처: ws.company.phone,
                팩스: ws.company.fax,
                업종: ws.company.industry,
                업태: ws.company.business_type,
                종목: ws.company.business_category,
                표준산업분류코드: ws.profile?.ksic_main,
                개업일: ws.profile?.open_date,
                기업규모: ws.profile?.size_class,
              }).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || "미입력 · 확인 필요"}</dd>
                </div>
              ))}
            </dl>
            <a href="/settings?tab=company">회사 기초정보 확인</a>
            <section className={styles.section}>
              <h2>오너뷰 기준 현재 인력</h2>
              {ws.workforce ? (
                <>
                  <p>
                    재직 명단 {ws.workforce.members.length}명 · 조회{" "}
                    {fmt(ws.workforce.observedAt)} · 재직 기준 제외{" "}
                    {ws.workforce.excludedCount}명 · 미담당 업무{" "}
                    {ws.workforce.unassignedCount}건
                  </p>
                  <p>{ws.workforce.caveat}</p>
                  {ws.workforce.members.map((e) => (
                    <article className={styles.section} key={e.id}>
                      <h3>
                        {e.name} · {e.department || "부서 미기재"} ·{" "}
                        {e.position || "직책 미기재"}
                      </h3>
                      <p>
                        직무: {e.role || "미기재 · 역량 확인 필요"} · 미완료
                        배정 {e.assignments.length}건
                      </p>
                      {!e.linked && (
                        <p>
                          직원과 사용자 계정이 연결되지 않아 업무 배정을 대조할
                          수 없습니다.
                        </p>
                      )}
                      {e.assignments.map((t) => (
                        <p key={t.source + t.id}>
                          <a href={`/projects/${t.dealId}`}>
                            {t.project} / {t.title}
                          </a>{" "}
                          · 기한 {t.dueDate || "미기재"}
                          {t.overdue ? " · 기한 경과" : ""}
                        </p>
                      ))}
                    </article>
                  ))}
                </>
              ) : (
                <p>현재 인력 조회 결과가 아직 없습니다.</p>
              )}
            </section>
            {!!ws.profile?.certifications.length && (
              <p>
                회사 카드에 기록된 인증: {ws.profile.certifications.join(", ")}{" "}
                · 증명서 원본·유효기간 확인 전에는 입찰 자격으로 확정하지
                않습니다.
              </p>
            )}
            <div className={styles.section}>
              <h2>회사 증빙과 실적</h2>
              <ProjectImport
                disabled={!ws.ready}
                onSave={(bundle) => run({ action: "import-evidence", bundle })}
              />
              <p>
                원본 위치와 내용을 함께 기록합니다. 원본 대조 확인과 유효기간을
                갖춘 자료만 확정 평가에 사용합니다.
              </p>
              <EvidenceEditor
                files={ws.files}
                disabled={!ws.ready}
                onSave={(evidence) => run({ action: "evidence", evidence })}
              />
              {ws.evidence.map((e) => (
                <article className={styles.section} key={e.id}>
                  <h3>{e.title}</h3>
                  <p>
                    {e.verified ? "원본 대조 확인" : "확인 대기"} · 유효기간{" "}
                    {e.expiresAt ? fmt(e.expiresAt) : "별도 만료일 미기재"}
                  </p>
                  <p>{e.source}</p>
                  {e.project && (
                    <p>
                      귀속:{" "}
                      {e.project.attribution === "company-reported"
                        ? "회사 수행으로 제공"
                        : e.project.attribution === "previous-employer"
                          ? "직원 이전 회사 경력"
                          : "귀속 확인 필요"}{" "}
                      ·{" "}
                      {e.project.state === "ongoing"
                        ? "수행 중"
                        : e.project.state === "reported-ended"
                          ? "기간 종료 기재 · 준공 확인 필요"
                          : "상태 확인 필요"}{" "}
                      ·{" "}
                      {e.project.amount === null
                        ? "금액 미확인"
                        : e.project.amount.toLocaleString() + "원"}
                      <br />
                      {e.project.issues.join(" / ")}
                    </p>
                  )}
                  <p className={styles.wrap}>{e.text}</p>
                  {e.revokedReason && (
                    <p>
                      검증 철회: {e.revokedReason} · {fmt(e.revokedAt || null)}
                    </p>
                  )}
                  {e.verified && (
                    <EvidenceRevocation
                      onSave={(note) =>
                        run({
                          action: "revoke-evidence",
                          evidenceId: e.id,
                          note,
                        })
                      }
                    />
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        {tab === "intake" && (
          <>
            <div className={styles.toolbar}>
              <div>
                <h2>자료 요청 목록</h2>
                <p>
                  각 항목은 보유·미보유·해당 없음·확인 중으로 회신해 주세요.
                  기본정보는 오너뷰에서 가져왔습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  download(
                    "모티브_입찰자동화_자료요청.md",
                    intakeMarkdown(ws.company),
                  )
                }
              >
                전체 요청 목록 내려받기
              </button>
            </div>
            {INTAKE.map((g) => (
              <section key={g.group} className={styles.section}>
                <h3>{g.group}</h3>
                <ul>
                  {g.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
        {tab === "drafts" && (
          <>
            <h2>진행 결정 후 서류 준비</h2>
            {ws.artifacts
              ?.filter((a) => a.kind === "proposal")
              .map((a) => (
                <ProposalPanel key={a.id} artifact={a} />
              ))}
            <p>
              검토용 목차·회사 기본정보·조건 대응표·제출서류 점검표를 만듭니다.
              실제 기획 내용, 원가, 지정 서식과 발표자료는 자료 확보 후
              작성·검수해야 합니다.
            </p>
            {!ws.drafts.length &&
              !ws.artifacts?.some((a) => a.kind === "proposal") && (
                <div className={styles.empty}>
                  진행 결정한 공고가 없습니다. 자격과 평가 근거를 먼저
                  확인하세요.
                </div>
              )}
            {ws.drafts.map((d) => {
              const c = ws.cases.find((c) => c.id === d.case_id);
              const active =
                ws.notices.some((n) => n.id === c?.notice_id) &&
                !ws.reviews.find((r) => r.id === c?.review_id)?.stale;
              return (
                <section key={d.id} className={styles.section}>
                  {!active && (
                    <div className={styles.notice}>
                      정정되거나 교체된 공고의 초안입니다. 최신 공고로 다시
                      검토하세요.
                    </div>
                  )}
                  <div className={styles.toolbar}>
                    <h3>준비 초안 · {fmt(d.created_at)}</h3>
                    <button
                      type="button"
                      onClick={() => download(`입찰준비_${d.id}.md`, d.content)}
                    >
                      초안 내려받기
                    </button>
                  </div>
                  <pre className={styles.wrap}>{d.content}</pre>
                </section>
              );
            })}
          </>
        )}
        {tab === "settings" && (
          <SettingsEditor
            key={JSON.stringify(ws.settings)}
            ws={ws}
            onSave={(settings) => run({ action: "settings", settings })}
            onSend={(previewHash) =>
              run({ action: "send-digest", confirmSend: true, previewHash })
            }
          />
        )}
        {tab === "history" && (
          <>
            <h2>수집·메일 실행 이력</h2>
            <h3>AI 처리 작업</h3>
            {ws.jobs?.map((j) => (
              <article key={j.id} className={styles.section}>
                <p>
                  {j.kind === "analysis" ? "상세 검토" : "기획·제안서"} ·{" "}
                  {j.status} · {fmt(j.created_at)}
                </p>
                {j.error && <p>{j.error}</p>}
                {j.status === "failed" && (
                  <button
                    type="button"
                    onClick={() =>
                      safeRun({ action: "retry-job", jobId: j.id })
                    }
                  >
                    이 작업 재시도
                  </button>
                )}
              </article>
            ))}
            <p>
              실행 완료 여부와 확인해야 할 오류를 기록합니다. 메일 접수 완료는
              실제 수신 완료와 구분합니다.
            </p>
            {!ws.runs.length && (
              <div className={styles.empty}>아직 실행한 작업이 없습니다.</div>
            )}
            {ws.runs.map((r) => (
              <article key={r.id} className={styles.section}>
                <h3>
                  {r.kind === "collect" ? "공고 수집" : "메일 발송"} ·{" "}
                  {r.status === "completed"
                    ? "완료"
                    : r.status === "running"
                      ? "진행 중"
                      : "실패"}
                </h3>
                <p>{fmt(r.created_at)}</p>
                <p>{r.summary || "실행 결과 대기"}</p>
              </article>
            ))}
          </>
        )}
      </fieldset>
    </main>
  );
}
function AIAnalysisPanel({
  data,
}: {
  data: Analysis & { sourceIssues?: string[] };
}) {
  return (
    <section className={styles.section}>
      <h4>AI 분석 초안</h4>
      <p className={styles.wrap}>{data.summary}</p>
      {data.sourceIssues?.map((s, i) => (
        <p key={i}>원문 확보: {s}</p>
      ))}
      {data.tasks.map((t, i) => (
        <p key={i}>
          {t.label}: {t.reason}
          <br />
          {t.citation
            ? `${t.citation.location} / ${t.citation.quote}`
            : "원문 근거 확인 필요"}
        </p>
      ))}
      {data.review.scores.map((s) => (
        <p key={s.key}>
          AI 초안 {RUBRIC.find((r) => r.key === s.key)?.label}:{" "}
          {s.points === null ? "미확인" : s.points + "점"} · {s.rationale}
        </p>
      ))}
      <h4>확인해야 할 항목</h4>
      <ul>
        {data.questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
      <p>
        아래 검토 양식에 초안을 넣었습니다. 원문·증빙을 대조한 뒤 검토 완료
        체크와 평가 저장을 진행하세요.
      </p>
    </section>
  );
}
function ProposalPanel({
  artifact,
}: {
  artifact: NonNullable<Workspace["artifacts"]>[number];
}) {
  const p = artifact.body as Proposal;
  return (
    <article className={styles.section}>
      <h3>{p.title} · AI 작성 검토본</h3>
      {artifact.stale ? (
        <p>공고·회사·인력이 변경되었습니다. 선택한 사업에서 다시 작성하세요.</p>
      ) : (
        <div className={styles.toolbar}>
          <a href={`/api/procurement/artifacts/${artifact.id}?format=docx`}>
            편집 가능한 DOCX 내려받기
          </a>
          <a
            href={`/api/procurement/artifacts/${artifact.id}?format=html`}
            target="_blank"
            rel="noreferrer"
          >
            인쇄·PDF 저장 화면
          </a>
          <a href={`/api/procurement/artifacts/${artifact.id}?format=md`}>
            본문·준비 목록 내려받기
          </a>
        </div>
      )}
      <p>
        최종 제출 전 지정 양식·익명성·가격·인력·발급증명·서명·날인을 확인해야
        합니다.
      </p>
      {p.sections.map((s, i) => (
        <section key={i}>
          <h4>{s.heading}</h4>
          <p className={styles.wrap}>{s.body}</p>
        </section>
      ))}
      <h4>직접 발급·서명·확정해야 할 서류</h4>
      {p.manualDocuments.map((d, i) => (
        <p key={i}>
          {d.name}: {d.reason}
          <br />
          발급처: {d.issuer} · 담당: {d.owner} · 기한: {d.deadline}
          <br />
          {d.citation
            ? d.citation.location + " / " + d.citation.quote
            : "공고 요구 여부 확인 제안"}
        </p>
      ))}
      <h4>추가 자료·확인 사항</h4>
      <ul>
        {p.missingInputs.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </article>
  );
}

function NoticeEditor({
  initial,
  onSave,
}: {
  initial?: Notice;
  onSave: (notice: Notice) => Promise<void>;
}) {
  const [value, setValue] = useState<Notice>(
    initial || {
      id: "",
      noticeNo: "",
      revision: "000",
      title: "",
      agency: "",
      publishedAt: null,
      deadline: null,
      budget: null,
      url: null,
      status: "open",
      documents: [],
      attachments: [],
    },
  );
  const [fileError, setFileError] = useState("");
  const patch = (p: Partial<Notice>) => setValue((v) => ({ ...v, ...p }));
  async function attach(file: File) {
    setFileError("");
    try {
      if (
        !/\.(hwp|hwpx|pdf|docx|xlsx|xls|txt|csv|md)$/i.test(file.name) ||
        file.size > 10 * 1024 * 1024 ||
        !file.size
      )
        throw new Error("지원 문서 형식의 10MB 이하 파일을 선택하세요.");
      const { extractDocumentText } = await import("@/lib/copilot-attachments");
      const text = await extractDocumentText(
        file.name,
        await file.arrayBuffer(),
      );
      if (!text.trim())
        throw new Error(
          "읽을 수 있는 글자가 없습니다. 스캔 문서는 OCR 후 원본과 대조해야 합니다.",
        );
      if (text.length > 200000)
        throw new Error(
          "문서가 20만 자를 넘습니다. 원문을 나누어 등록하세요. 자동으로 잘라 저장하지 않습니다.",
        );
      setValue((v) => ({
        ...v,
        documents: [
          ...v.documents,
          {
            id: crypto.randomUUID(),
            name: file.name,
            text,
            complete: false,
            location: `직접 첨부: ${file.name}`,
          },
        ],
      }));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "문서를 읽지 못했습니다.");
    }
  }
  return (
    <form
      className={styles.section}
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(value).catch(() => {});
      }}
    >
      <h3>{initial ? "공고 정보·원문 보완" : "공고 직접 등록"}</h3>
      <div className={styles.grid}>
        <Field label="공고번호">
          <input
            required
            value={value.noticeNo}
            onChange={(e) => patch({ noticeNo: e.target.value })}
          />
        </Field>
        <Field label="차수">
          <input
            required
            value={value.revision}
            onChange={(e) => patch({ revision: e.target.value })}
          />
        </Field>
        <Field label="공고명">
          <input
            required
            value={value.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>
        <Field label="발주기관">
          <input
            required
            value={value.agency}
            onChange={(e) => patch({ agency: e.target.value })}
          />
        </Field>
        <Field label="예산 (원 · 미확인이면 비워두기)">
          <input
            type="number"
            min="0"
            step="1"
            value={value.budget ?? ""}
            onChange={(e) =>
              patch({ budget: e.target.value ? Number(e.target.value) : null })
            }
          />
        </Field>
        <Field label="나라장터 원문 URL">
          <input
            type="url"
            value={value.url || ""}
            onChange={(e) => patch({ url: e.target.value || null })}
          />
        </Field>
        <Field label="마감일시 (한국시간)">
          <DateTimeField
            value={localTime(value.deadline)}
            onChange={(e) => patch({ deadline: utcTime(e.target.value) })}
          />
        </Field>
        <Field label="게시일시 (한국시간)">
          <DateTimeField
            value={localTime(value.publishedAt)}
            onChange={(e) => patch({ publishedAt: utcTime(e.target.value) })}
          />
        </Field>
        <Field label="공고 상태">
          <select
            value={value.status}
            onChange={(e) =>
              patch({ status: e.target.value as Notice["status"] })
            }
          >
            <option value="open">게시 중</option>
            <option value="cancelled">취소</option>
          </select>
        </Field>
      </div>
      <Field label="공고문·제안요청서·과업지시서·서식 첨부">
        <input
          type="file"
          accept=".hwp,.hwpx,.pdf,.docx,.xlsx,.xls,.txt,.csv,.md"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void attach(f);
            e.target.value = "";
          }}
        />
      </Field>
      <p>
        글자를 추출해 검토합니다. 원본 파일은 오너뷰 파일보관함에 별도로
        보관하세요. 표·이미지·스캔 누락 여부는 원본과 대조해야 합니다.
      </p>
      {fileError && <p role="alert">{fileError}</p>}
      <button
        type="button"
        onClick={() =>
          patch({
            documents: [
              ...value.documents,
              {
                id: crypto.randomUUID(),
                name: "공고 원문",
                text: "",
                complete: false,
                location: "나라장터 공고 원문",
              },
            ],
          })
        }
      >
        원문 텍스트 직접 추가
      </button>
      {value.documents.map((d, i) => {
        const change = (p: Partial<typeof d>) =>
          patch({
            documents: value.documents.map((x, k) =>
              k === i ? { ...x, ...p } : x,
            ),
          });
        return (
          <section className={styles.section} key={d.id}>
            <Field label="원문 이름">
              <input
                required
                value={d.name}
                onChange={(e) => change({ name: e.target.value })}
              />
            </Field>
            <Field label="출처·원본 위치">
              <input
                required
                value={d.location}
                onChange={(e) => change({ location: e.target.value })}
              />
            </Field>
            <Field label="추출된 원문">
              <textarea
                rows={8}
                value={d.text}
                onChange={(e) =>
                  change({ text: e.target.value, complete: false })
                }
              />
            </Field>
            <Check
              checked={d.complete}
              onChange={(complete) => change({ complete })}
            >
              원본 전체와 대조했고, 표·이미지 포함 중요한 내용이 빠지지
              않았습니다.
            </Check>
            <button
              type="button"
              onClick={() =>
                patch({ documents: value.documents.filter((_, k) => k !== i) })
              }
            >
              이 원문 제외
            </button>
          </section>
        );
      })}
      <button className={styles.primary} type="submit">
        공고와 원문 저장
      </button>
    </form>
  );
}

function EvidenceRevocation({
  onSave,
}: {
  onSave: (note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [note, setNote] = useState("");
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}>
        검증 철회
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(note).catch(() => {});
      }}
    >
      <p>
        검증을 철회하면 연결된 평가는 다시 검토해야 합니다. 자료 원본과 철회
        이력은 보존합니다.
      </p>
      <Field label="검증 철회 이유">
        <textarea
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <button type="submit">검증 철회 기록</button>
      <button type="button" onClick={() => setOpen(false)}>
        닫기
      </button>
    </form>
  );
}
function EvidenceEditor({
  files,
  disabled,
  onSave,
}: {
  files: Workspace["files"];
  disabled: boolean;
  onSave: (e: Evidence) => Promise<void>;
}) {
  const initial: Evidence = {
    id: "",
    category: "project",
    title: "",
    text: "",
    source: "",
    documentFileId: null,
    verified: false,
    verifiedAt: null,
    expiresAt: null,
  };
  const [e, setE] = useState(initial);
  return (
    <form
      className={styles.section}
      onSubmit={(ev) => {
        ev.preventDefault();
        void onSave(e)
          .then(() => setE(initial))
          .catch(() => {});
      }}
    >
      <div className={styles.grid}>
        <Field label="자료 분류">
          <select
            value={e.category}
            onChange={(ev) =>
              setE({ ...e, category: ev.target.value as Evidence["category"] })
            }
          >
            {[
              ["project", "사업 실적"],
              ["qualification", "자격·인증"],
              ["registration", "회사 등록"],
              ["team", "인력·역량"],
              ["cost", "원가·견적"],
              ["capacity", "일정·업무 여력"],
            ].map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="자료명">
          <input
            required
            value={e.title}
            onChange={(ev) => setE({ ...e, title: ev.target.value })}
          />
        </Field>
        <Field label="오너뷰 보관 파일 연결">
          <select
            value={e.documentFileId || ""}
            onChange={(ev) =>
              setE({ ...e, documentFileId: ev.target.value || null })
            }
          >
            <option value="">별도 원본 위치 기재</option>
            {files.map((f) => (
              <option value={f.id} key={f.id}>
                {f.file_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="발급처·원본 위치·기준일">
          <input
            required
            value={e.source}
            onChange={(ev) => setE({ ...e, source: ev.target.value })}
          />
        </Field>
        <Field label="유효기간 종료 (한국시간 · 해당하는 경우)">
          <DateTimeField
            value={localTime(e.expiresAt)}
            onChange={(ev) =>
              setE({ ...e, expiresAt: utcTime(ev.target.value) })
            }
          />
        </Field>
      </div>
      <Field label="증빙 내용·사업별 담당 범위·금액·일시 등">
        <textarea
          required
          rows={6}
          value={e.text}
          onChange={(ev) => setE({ ...e, text: ev.target.value })}
        />
      </Field>
      <Check
        checked={e.verified}
        onChange={(verified) => setE({ ...e, verified })}
      >
        원본과 내용·회사명·기간·금액을 직접 대조했습니다.
      </Check>
      <button type="submit" disabled={disabled} className={styles.primary}>
        회사 자료 등록
      </button>
    </form>
  );
}

function CitationEditor({
  notice,
  value,
  onChange,
}: {
  notice: Notice;
  value: Citation | null;
  onChange: (v: Citation) => void;
}) {
  const c = value || {
    documentId: notice.documents[0]?.id || "",
    quote: "",
    location: "",
  };
  return (
    <div className={styles.grid}>
      <Field label="근거 원문">
        <select
          value={c.documentId}
          onChange={(e) => onChange({ ...c, documentId: e.target.value })}
        >
          <option value="">원문 선택</option>
          {notice.documents.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="페이지·조항">
        <input
          value={c.location}
          onChange={(e) => onChange({ ...c, location: e.target.value })}
        />
      </Field>
      <Field label="원문에 실제 있는 근거 문장 (8자 이상)">
        <textarea
          value={c.quote}
          onChange={(e) => onChange({ ...c, quote: e.target.value })}
        />
      </Field>
    </div>
  );
}
function EvidencePicker({
  evidence,
  value,
  onChange,
}: {
  evidence: Evidence[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Field label="대조한 회사 증빙 (여러 개 선택 가능)">
      <select
        multiple
        size={Math.min(Math.max(evidence.length, 2), 5)}
        value={value}
        onChange={(e) =>
          onChange(Array.from(e.target.selectedOptions).map((o) => o.value))
        }
      >
        {evidence.map((e) => (
          <option value={e.id} key={e.id}>
            {e.title} · {e.verified ? "원본 대조" : "미확인"}
          </option>
        ))}
      </select>
    </Field>
  );
}
function ReviewEditor({
  notice,
  ws,
  initial,
  onSave,
}: {
  notice: Notice;
  ws: Workspace;
  initial?: Review;
  onSave: (review: Review) => Promise<void>;
}) {
  const [review, setReview] = useState(initial || emptyReview());
  const assessment = evaluate(
    notice,
    review,
    ws.evidence,
    ws.settings.minimumScore,
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(review).catch(() => {});
      }}
    >
      <div className={styles.section}>
        <h3>검토 결과</h3>
        <p>
          <strong>{STATUS[assessment.recommendation]}</strong> · 자격{" "}
          {ELIGIBILITY[assessment.eligibility]} ·{" "}
          {assessment.total === null
            ? `종합점수 미확정 (평가 완료 ${assessment.assessedMax}/100 배점)`
            : `${assessment.total}/100점`}
        </p>
        <ul>
          {assessment.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        {!!assessment.warnings.length && (
          <ul>
            {assessment.warnings.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </div>
      <section className={styles.section}>
        <h3>1. 원문 전체 검토</h3>
        <Check
          checked={review.sourceReviewed}
          onChange={(v) => setReview({ ...review, sourceReviewed: v })}
        >
          공고문·제안요청서·첨부서식을 모두 읽고 원본과 대조했습니다.
        </Check>
      </section>
      <section className={styles.section}>
        <h3>2. 필수 자격 대조</h3>
        <p>
          업종코드·지역·기업규모·직접생산·실적·공동수급·제재 등 공고가 요구한
          조건을 하나씩 등록합니다.
        </p>
        {review.requirements.map((r, i) => {
          const patch = (p: Partial<typeof r>) =>
            setReview({
              ...review,
              requirements: review.requirements.map((x, k) =>
                k === i ? { ...x, ...p } : x,
              ),
            });
          return (
            <div className={styles.section} key={r.id}>
              <Field label="필수 조건">
                <input
                  required
                  value={r.label}
                  onChange={(e) => patch({ label: e.target.value })}
                />
              </Field>
              <CitationEditor
                notice={notice}
                value={r.citation}
                onChange={(citation) => patch({ citation })}
              />
              <EvidencePicker
                evidence={ws.evidence}
                value={r.evidenceIds}
                onChange={(evidenceIds) => patch({ evidenceIds })}
              />
              <Field label="자격 판단">
                <select
                  value={r.status}
                  onChange={(e) =>
                    patch({ status: e.target.value as typeof r.status })
                  }
                >
                  <option value="unknown">확인 필요</option>
                  <option value="met">충족</option>
                  <option value="unmet">미충족</option>
                </select>
              </Field>
              <Field label="판단 이유·보완 사항">
                <textarea
                  value={r.rationale}
                  onChange={(e) => patch({ rationale: e.target.value })}
                />
              </Field>
              <button
                type="button"
                onClick={() =>
                  setReview({
                    ...review,
                    requirements: review.requirements.filter((_, k) => k !== i),
                    requirementsComplete: false,
                  })
                }
              >
                조건 삭제
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() =>
            setReview({
              ...review,
              requirements: [
                ...review.requirements,
                {
                  id: crypto.randomUUID(),
                  label: "",
                  status: "unknown",
                  rationale: "",
                  citation: null,
                  evidenceIds: [],
                },
              ],
              requirementsComplete: false,
            })
          }
        >
          필수 조건 추가
        </button>
        <Check
          checked={review.requirementsComplete}
          onChange={(v) => setReview({ ...review, requirementsComplete: v })}
        >
          원문에 있는 필수 자격을 빠짐없이 등록했습니다.
        </Check>
      </section>
      <section className={styles.section}>
        <h3>3. 항목별 상세 점수</h3>
        {RUBRIC.map((rule) => {
          const s = review.scores.find((s) => s.key === rule.key)!;
          const patch = (p: Partial<typeof s>) =>
            setReview({
              ...review,
              scores: review.scores.map((x) =>
                x.key === s.key ? { ...x, ...p } : x,
              ),
            });
          return (
            <div className={styles.section} key={rule.key}>
              <h4>
                {rule.label} · {rule.max}점
              </h4>
              <Field label={`${rule.label} 점수 (미확정이면 비워두기)`}>
                <input
                  type="number"
                  min="0"
                  max={rule.max}
                  step="1"
                  value={s.points ?? ""}
                  onChange={(e) =>
                    patch({
                      points: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
              <CitationEditor
                notice={notice}
                value={s.citation}
                onChange={(citation) => patch({ citation })}
              />
              <EvidencePicker
                evidence={ws.evidence}
                value={s.evidenceIds}
                onChange={(evidenceIds) => patch({ evidenceIds })}
              />
              <Field label={`${rule.label} 평가 이유·가점·감점·보완 방법`}>
                <textarea
                  rows={3}
                  value={s.rationale}
                  onChange={(e) => patch({ rationale: e.target.value })}
                />
              </Field>
            </div>
          );
        })}
      </section>
      <section className={styles.section}>
        <h3>4. 제출서류와 서식</h3>
        {review.deliverables.map((d, i) => {
          const patch = (p: Partial<typeof d>) =>
            setReview({
              ...review,
              deliverables: review.deliverables.map((x, k) =>
                k === i ? { ...x, ...p } : x,
              ),
            });
          return (
            <div className={styles.section} key={d.id}>
              <Field label="요구 서류·제출 형식">
                <input
                  required
                  value={d.label}
                  onChange={(e) => patch({ label: e.target.value })}
                />
              </Field>
              <CitationEditor
                notice={notice}
                value={d.citation}
                onChange={(citation) => patch({ citation })}
              />
              <EvidencePicker
                evidence={ws.evidence}
                value={d.evidenceIds}
                onChange={(evidenceIds) => patch({ evidenceIds })}
              />
              <Field label="준비 상태">
                <select
                  value={d.status}
                  onChange={(e) =>
                    patch({ status: e.target.value as typeof d.status })
                  }
                >
                  <option value="missing">미준비</option>
                  <option value="draft">작성 중</option>
                  <option value="verified">최종 대조 완료</option>
                </select>
              </Field>
              <Field label="담당자·준비기한·발급일·제출 방식·확인 사항">
                <textarea
                  value={d.note}
                  onChange={(e) => patch({ note: e.target.value })}
                />
              </Field>
              <button
                type="button"
                onClick={() =>
                  setReview({
                    ...review,
                    deliverables: review.deliverables.filter((_, k) => k !== i),
                    deliverablesComplete: false,
                  })
                }
              >
                서류 삭제
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() =>
            setReview({
              ...review,
              deliverables: [
                ...review.deliverables,
                {
                  id: crypto.randomUUID(),
                  label: "",
                  citation: null,
                  status: "missing",
                  evidenceIds: [],
                  note: "",
                },
              ],
              deliverablesComplete: false,
            })
          }
        >
          제출서류 추가
        </button>
        <Check
          checked={review.deliverablesComplete}
          onChange={(v) => setReview({ ...review, deliverablesComplete: v })}
        >
          제출해야 하는 서류·지정 서식을 빠짐없이 등록했습니다.
        </Check>
      </section>
      <button className={styles.primary} type="submit">
        평가와 근거 저장
      </button>
    </form>
  );
}
function DecisionEditor({
  onSave,
}: {
  onSave: (decision: string, note: string) => Promise<void>;
}) {
  const [decision, setDecision] = useState("hold"),
    [note, setNote] = useState("");
  return (
    <form
      className={styles.section}
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(decision, note).catch(() => {});
      }}
    >
      <h3>5. 회사의 진행 결정</h3>
      <p>
        저장된 최신 평가를 기준으로 결정합니다. 진행 결정은 검토용 서류 준비
        초안을 생성합니다.
      </p>
      <Field label="진행 여부">
        <select value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="hold">보류</option>
          <option value="proceed">진행</option>
          <option value="decline">제외</option>
        </select>
      </Field>
      <Field label="결정 이유·담당자·검토 사항">
        <textarea
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <button type="submit" className={styles.primary}>
        결정 기록
      </button>
    </form>
  );
}
function SettingsEditor({
  ws,
  onSave,
  onSend,
}: {
  ws: Workspace;
  onSave: (s: Settings) => Promise<void>;
  onSend: (previewHash: string) => Promise<void>;
}) {
  const [s, setS] = useState(ws.settings),
    [recipients, setRecipients] = useState(s.recipients.join(", ")),
    [keywords, setKeywords] = useState(s.keywords.join(", ")),
    [confirm, setConfirm] = useState(false),
    [preview, setPreview] = useState<{
      subject: string;
      html: string;
      previewHash: string;
    } | null>(null),
    [previewError, setPreviewError] = useState("");
  async function loadPreview() {
    setPreviewError("");
    try {
      const res = await fetch("/api/procurement?view=digest", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreview(data);
    } catch (e) {
      setPreviewError(
        e instanceof Error ? e.message : "메일 미리보기를 읽지 못했습니다.",
      );
    }
  }
  return (
    <>
      <h2>수집과 아침 메일</h2>
      <p>
        검색어·수신자·시간을 저장하고, 연결 준비가 끝나면 자동 실행을 켭니다.
      </p>
      <div className={styles.notice}>
        나라장터{" "}
        {ws.integration.g2b
          ? "서버 키 설정됨 · 실제 응답 검증 필요"
          : "연결 준비 필요"}{" "}
        / 메일{" "}
        {ws.integration.mail
          ? "발신 설정 있음 · 수신 시험 필요"
          : "발신 설정 필요"}{" "}
        / 예약 실행{" "}
        {ws.integration.scheduler ? "연결 설정 있음" : "연결 준비 필요"}
      </div>
      <form
        className={styles.section}
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({
            ...s,
            recipients: recipients
              .split(/[,;\n]+/)
              .map((v) => v.trim())
              .filter(Boolean),
            keywords: keywords
              .split(/[,\n]+/)
              .map((v) => v.trim())
              .filter(Boolean),
          }).catch(() => {});
        }}
      >
        <Field label="검색어 (쉼표로 구분)">
          <input
            required
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </Field>
        <Field label="수신 이메일 (쉼표로 구분)">
          <textarea
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
          />
        </Field>
        <div className={styles.grid}>
          <Field label="아침 발송 시각 (한국시간)">
            <select
              value={s.digestHour}
              onChange={(e) =>
                setS({ ...s, digestHour: Number(e.target.value) })
              }
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i}시
                </option>
              ))}
            </select>
          </Field>
          <Field label="추천 기준 점수">
            <input
              type="number"
              min="0"
              max="100"
              value={s.minimumScore}
              onChange={(e) =>
                setS({ ...s, minimumScore: Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <Check
          checked={s.collectionEnabled}
          onChange={(v) => setS({ ...s, collectionEnabled: v })}
        >
          정기 공고 수집 사용
        </Check>
        <Check
          checked={s.digestEnabled}
          onChange={(v) => setS({ ...s, digestEnabled: v })}
        >
          아침 메일 자동발송 사용
        </Check>
        <p>
          현재 수집 범위는 용역의 최근 7일 게시 공고입니다. 정정·취소 전수
          감시와 첨부 자동 확보·AI 상세 평가는 후속 연결 대상입니다.
        </p>
        <button type="submit" disabled={!ws.ready} className={styles.primary}>
          설정 저장
        </button>
      </form>
      <section className={styles.section}>
        <h3>수동 메일 발송</h3>
        <p>
          저장된 수신자: {ws.settings.recipients.join(", ") || "없음"}. 현재
          공고와 검토 상태를 보냅니다. 하루 한 번만 발송합니다.
        </p>
        <button
          type="button"
          onClick={() => {
            void loadPreview();
          }}
        >
          메일 본문 미리보기
        </button>
        {previewError && <p role="alert">{previewError}</p>}
        {preview && (
          <>
            <p>{preview.subject}</p>
            <iframe
              title="아침 메일 미리보기"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={preview.html}
              style={{
                width: "100%",
                height: 480,
                border: "1px solid #ddd",
                marginTop: 12,
              }}
            />
          </>
        )}
        <Check checked={confirm} onChange={setConfirm}>
          저장된 수신자를 확인했으며 현재 검토 요약을 발송합니다.
        </Check>
        <button
          type="button"
          disabled={
            !confirm ||
            !preview ||
            !ws.ready ||
            !ws.integration.mail ||
            !ws.settings.recipients.length
          }
          onClick={() => {
            if (preview) void onSend(preview.previewHash).catch(() => {});
          }}
        >
          현재 요약 메일 발송
        </button>
      </section>
    </>
  );
}
