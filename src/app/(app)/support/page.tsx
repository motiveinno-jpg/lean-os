"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

// 고객센터 — 사용자가 문의를 등록하고, 내가 보낸 문의·운영자 답변을 확인하는 화면.
//   문의 저장: support_tickets (company 스코프 RLS). 답변은 운영자(/platform/support)가 작성.
//   답변이 등록되면 트리거가 status='answered' + 알림 발송 → 사용자는 여기서 답변 확인.
//   2026-08-04 개편: 전화 CS 폐지 — 모든 문의를 이 문의함으로 일원화.
//     화면을 크게·세련되게 + 스크린샷 첨부(support-attachments 프라이빗 버킷, 회사 폴더 스코프).
//     첨부는 추후 AI 자동 분석(에러 진단)의 입력이 된다.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { friendlyError, reportError } from "@/lib/friendly-error";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat } from "@/components/query-kit";
import { useModalKeys } from "@/hooks/use-modal-keys";

const db = supabase;

type Attachment = { path: string; name: string; size: number };

type Ticket = {
  id: string;
  category: string;
  subject: string;
  content: string;
  status: "open" | "answered" | "closed" | string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  attachments: Attachment[] | null;
};

// 모든 문의를 받는다. 유형은 분류용일 뿐, 어떤 문의든 등록 가능.
const CATEGORIES:  { key: string; label: string; icon: string; desc: string }[] = [
  { key: "general", label: "이용 문의", icon: "💬", desc: "사용법·기능이 궁금할 때" },
  { key: "bug", label: "오류 신고", icon: "🐞", desc: "에러·이상 동작을 겪었을 때" },
  { key: "data", label: "데이터·연동", icon: "🔌", desc: "연동이나 수치가 안 맞을 때" },
  { key: "billing", label: "결제·구독", icon: "💳", desc: "요금제·결제·영수증" },
  { key: "account", label: "계정·권한", icon: "🔐", desc: "로그인·권한·구성원 초대" },
  { key: "feature", label: "기능 제안", icon: "💡", desc: "이런 기능이 있으면 좋겠습니다" },
  { key: "etc", label: "기타", icon: "📌", desc: "그 외 모든 문의" },
];
const catMeta = (k: string) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[CATEGORIES.length - 1];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "대기", cls: "ol-sure ol-sure-est" },
  in_progress: { label: "처리중", cls: "ol-sure" },
  answered: { label: "완료", cls: "ol-sure ol-sure-ok" },
  closed: { label: "종료", cls: "ol-sure" },
};

// 진행 단계 표시 ("사용자에게 대기→처리중→완료 단계별로 나타나게")
const STEPS = ["대기", "처리중", "완료"] as const;
const stepIndex = (status: string) => (status === "open" ? 0 : status === "in_progress" ? 1 : 2);

function TicketSteps({ status }: { status: string }) {
  const cur = stepIndex(status);
  return (
    <div className="support-steps" aria-label={`진행 상태: ${STEPS[cur]}`}>
      {STEPS.map((label, i) => (
        <span key={label} className="contents">
          {i > 0 && <span className="support-step-line" data-done={i <= cur ? "1" : undefined} />}
          <span className="support-step" data-state={i < cur ? "done" : i === cur ? "current" : undefined}>
            <span className="support-step-dot" />
            <span className="support-step-label">{label}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

const fmtDate = (s: string) => {
  const d = new Date(s);
  return `${kstDateStr(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const MAX_FILES = 5;
const MAX_FILE_MB = 8;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// 첨부 스크린샷 · 프라이빗 버킷이라 서명 URL(1시간)로만 열람
function TicketShots({ attachments }: { attachments: Attachment[] }) {
  const paths = attachments.map((a) => a.path).join(",");
  const { data: urls = [] } = useQuery<{ path: string; url: string }[]>({
    queryKey: ["support-shot-urls", paths],
    queryFn: async () => {
      const out: { path: string; url: string }[] = [];
      for (const a of attachments) {
        const { data } = await db.storage.from("support-attachments").createSignedUrl(a.path, 3600);
        if (data?.signedUrl) out.push({ path: a.path, url: data.signedUrl });
      }
      return out;
    },
    staleTime: 30 * 60 * 1000,
  });
  if (!attachments.length) return null;
  return (
    <div className="support-ticket-shots">
      {urls.map((u) => (
        <a key={u.path} href={u.url} target="_blank" rel="noreferrer" className="support-ticket-shot" title="새 탭에서 크게 보기">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u.url} alt="첨부 스크린샷" className="w-full h-full object-cover" />
        </a>
      ))}
    </div>
  );
}

export default function SupportPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const { toast } = useToast();
  const qc = useQueryClient();

  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 답변 알림 딥링크(?id=티켓) — 해당 문의를 펼치고 내역으로 스크롤 (
  //   답변 알림을 눌러도 대시보드로 갔다 → notification-routes 에 /support?id= 매핑 추가와 세트)
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get("id");
      if (id) {
        setOpenId(id);
        // 목록 렌더 후 해당 문의로 스크롤
        setTimeout(() => document.getElementById(`ticket-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
      }
    } catch { /* noop */ }
  }, []);
  const previews = useMemo(() => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [files]);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!IMAGE_TYPES.has(f.type)) { toast(`${f.name}: 이미지 파일(PNG/JPG/WEBP/GIF)만 첨부할 수 있습니다`, "error"); continue; }
      if (f.size > MAX_FILE_MB * 1024 * 1024) { toast(`${f.name}: ${MAX_FILE_MB}MB 이하만 첨부할 수 있습니다`, "error"); continue; }
      if (next.length >= MAX_FILES) { toast(`사진은 최대 ${MAX_FILES}장까지 첨부할 수 있습니다`, "error"); break; }
      next.push(f);
    }
    setFiles(next);
  };

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ["support-tickets", userId],
    queryFn: async () => {
      const data = logRead('support/page:data', await db
        .from("support_tickets")
        .select("id, category, subject, content, status, answer, answered_at, created_at, attachments")
        .eq("user_id", userId ?? "")
        .order("created_at", { ascending: false }));
      // attachments 는 이 세션에서 추가된 컬럼 — 타입 재생성 전이라 unknown 경유 캐스팅
      return (data || []) as unknown as Ticket[];
    },
    enabled: !!userId,
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      // 1) 티켓 먼저 생성 (첨부 실패해도 문의 자체는 접수되도록)
      const { data: inserted, error } = await db.from("support_tickets").insert({
        company_id: companyId as string,
        user_id: userId as string,
        category,
        subject: subject.trim(),
        content: content.trim(),
      }).select("id").single();
      if (error) throw error;
      // 2) 스크린샷 업로드 → 경로를 티켓에 연결
      const uploaded: Attachment[] = [];
      let failed = 0;
      for (const f of files) {
        const ext = (f.name.split(".").pop() || "png").toLowerCase().slice(0, 8);
        const path = `${companyId}/${inserted.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await db.storage.from("support-attachments").upload(path, f, { contentType: f.type });
        if (upErr) { failed++; continue; }
        uploaded.push({ path, name: f.name.slice(0, 120), size: f.size });
      }
      if (uploaded.length > 0) {
        // error 를 봐야 한다: 실패하면 "사진 N장 첨부" 라고 알리면서 티켓엔
        //   첨부가 없고, 올린 스크린샷만 스토리지에 남았다.
        const { error: attErr } = await (db as any).from("support_tickets").update({ attachments: uploaded }).eq("id", inserted.id);
        if (attErr) {
          await db.storage.from("support-attachments").remove(uploaded.map((u) => u.path)).catch(() => {});
          failed += uploaded.length;
          uploaded.length = 0;
        }
      }
      
      // 3) AI 자동 진단 · 접수 완료와 무관하게 백그라운드 실행 (실패해도 무시, 결과는 운영자 화면에)
      db.auth.getSession().then(({ data: { session } }) => {
        if (!session || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
        fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/support-ticket-analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ ticket_id: inserted.id }),
        }).catch(() => { /* 진단 실패는 접수와 무관 */ });
      });
      return { failed, uploaded: uploaded.length };
    },
    onSuccess: (r) => {
      toast(
        r.failed > 0
          ? `문의가 접수되었습니다. (사진 ${r.uploaded}장 첨부, ${r.failed}장 실패 · 필요하면 다시 첨부해 주세요)`
          : "문의가 접수되었습니다. 영업일 1일 이내에 처리 후 답변드리겠습니다.",
        r.failed > 0 ? "info" : "success",
      );
      setSubject(""); setContent(""); setCategory("general"); setFiles([]); setComposeOpen(false);
      qc.invalidateQueries({ queryKey: ["support-tickets", userId] });
    },
    onError: (e) => {
      reportError("support.submit", e);
      toast(friendlyError(e, "문의 접수에 실패했습니다"), "error");
    },
  });

  useModalKeys(composeOpen, () => { if (!submitMut.isPending) setComposeOpen(false); });
  const canSubmit = subject.trim().length > 0 && content.trim().length > 0 && !submitMut.isPending;
  const answeredCount = useMemo(() => tickets.filter((t) => t.status === "answered").length, [tickets]);

  //   2026-10-01 UI 점검 9순위: 문의 작성 폼이 본문 위를 차지하고(유형 카드 7장 격자), 내역은 카드 목록이었다 →
  //   본문 = 내 문의 표(줄 클릭 = 아래 펼침), 작성 = 「새 문의」 팝업(유형은 한 줄 셀렉트). 파란 버튼은 「새 문의」·「접수」 하나씩(팝업 안팎).
  return (
    <div className="qk-shell support-page-root">
      <QueryScreen>
        <QueryHead>
          <QueryBar right={<button type="button" className="btn-primary btn-sm" onClick={() => setComposeOpen(true)}>새 문의</button>}>
            <span className="support-desc"><b>무엇이든 문의하세요</b> · 모든 문의는 여기서 받고, 영업일 1일 이내에 답변드립니다.</span>
          </QueryBar>
          <ResultStrip>
            <Stat label="내 문의" value={`${tickets.length}건`} />
            <Stat label="답변 완료" value={`${answeredCount}건`} tone={answeredCount > 0 ? "plus" : undefined} />
          </ResultStrip>
        </QueryHead>
        <QueryBody>
        <div className="support-scroll">
        {isLoading ? (
          <div className="collect-empty">불러오는 중…</div>
        ) : tickets.length === 0 ? (
          <div className="collect-empty">아직 등록한 문의가 없습니다. 「새 문의」로 첫 문의를 남겨 보세요.</div>
        ) : (
          <table className="ev-table ev-lined support-table">
            <thead>
              <tr><th>접수일</th><th>유형</th><th>제목</th><th>사진</th><th>상태</th></tr>
            </thead>
            <tbody>
            {tickets.map((t) => {
              const st = STATUS_META[t.status] || STATUS_META.open;
              const cm = catMeta(t.category);
              const expanded = openId === t.id;
              const shots = Array.isArray(t.attachments) ? t.attachments : [];
              return (
                <Fragment key={t.id}>
                  <tr id={`ticket-${t.id}`} className={`support-row ${expanded ? "support-row-open" : ""}`} onClick={() => setOpenId(expanded ? null : t.id)}>
                    <td className="support-date mono-number">{fmtDate(t.created_at)}</td>
                    <td className="support-cat">{cm.label}</td>
                    <td className="support-subject">{t.subject}</td>
                    <td className="support-shots-cnt">{shots.length > 0 ? `${shots.length}장` : "—"}</td>
                    <td className="support-status"><span className={st.cls}>{st.label}</span></td>
                  </tr>
                  {expanded && (
                    <tr className="support-detail-row">
                      <td colSpan={5}>
                        <div className="support-ticket-body">
                          {t.status !== "closed" && <TicketSteps status={t.status} />}
                          <div className="support-ticket-content">{t.content}</div>
                          {shots.length > 0 && <TicketShots attachments={shots} />}
                          {t.answer ? (
                            <div className="support-answer-block">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <span className="text-[11px] font-bold text-[var(--primary)]">운영팀 답변</span>
                                {t.answered_at && <span className="text-[10px] text-[var(--text-dim)] mono-number">{fmtDate(t.answered_at)}</span>}
                              </div>
                              <div className="text-[12.5px] text-[var(--text)] whitespace-pre-wrap leading-relaxed">{t.answer}</div>
                            </div>
                          ) : (
                            <div className="support-no-answer">아직 답변이 등록되지 않았습니다. 운영팀이 확인 중입니다.</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            </tbody>
          </table>
        )}
        </div>
        </QueryBody>
      </QueryScreen>

      {/* ═══ 새 문의 — 팝업 (목록 줄이 밀리지 않게) ═══ */}
      {composeOpen && (
        <div className="support-modal" onClick={() => { if (!submitMut.isPending) setComposeOpen(false); }}>
          <div className="support-modal-box" role="dialog" aria-modal="true" aria-label="새 문의" onClick={(e) => e.stopPropagation()}>
            <div className="support-modal-head">
              <h3>새 문의</h3>
              <button type="button" className="btn-secondary btn-sm" disabled={submitMut.isPending} onClick={() => setComposeOpen(false)}>닫기</button>
            </div>
            <div className="support-compose-grid">
              <label className="support-section-label">유형</label>
              <div>
                <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label} — {c.desc}</option>)}
                </select>
              </div>

              <label className="support-section-label">제목 <span className="text-[var(--danger)]">*</span></label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={120}
                placeholder="문의 내용을 한 줄로 요약해 주세요."
                className="field-input"
              />

              <label className="support-section-label">내용 <span className="text-[var(--danger)]">*</span></label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onPaste={(e) => {
                  const imgs = Array.from(e.clipboardData?.files || []).filter((f) => IMAGE_TYPES.has(f.type));
                  if (imgs.length) { e.preventDefault(); addFiles(imgs); }
                }}
                placeholder={"어떤 화면에서 무엇을 했을 때 어떻게 되었는지 적어 주세요.\n캡처 이미지를 붙여넣으면 자동으로 첨부됩니다."}
                className="support-textarea field-input"
              />

              <label className="support-section-label">화면 사진</label>
              <div>
                <div
                  className="support-dropzone"
                  data-drag={dragging ? "1" : undefined}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                >
                  <span className="text-[12.5px] font-semibold text-[var(--text)]">클릭해서 사진 선택 또는 여기로 끌어다 놓기</span>
                  <span className="text-[11px] text-[var(--text-dim)]">선택 · 최대 {MAX_FILES}장 · 장당 {MAX_FILE_MB}MB. 오류 화면을 첨부하면 원인을 더 빨리 찾습니다.</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    className="hidden"
                    onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
                  />
                </div>
                {previews.length > 0 && (
                  <div className="support-attach-previews">
                    {previews.map((p, i) => (
                      <div key={p.url} className="support-attach-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                        <button type="button" className="support-attach-remove" title="첨부 제거"
                          onClick={() => setFiles(files.filter((_, idx) => idx !== i))}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="support-modal-foot">
              <button type="button" disabled={!canSubmit} onClick={() => submitMut.mutate()} className="btn-primary btn-sm">
                {submitMut.isPending ? "접수 중…" : `문의 접수${files.length ? ` (사진 ${files.length}장)` : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
