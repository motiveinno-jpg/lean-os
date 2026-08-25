"use client";
import { kstDateStr } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";

// 고객센터 — 사용자가 문의를 등록하고, 내가 보낸 문의·운영자 답변을 확인하는 화면.
//   문의 저장: support_tickets (company 스코프 RLS). 답변은 운영자(/platform/support)가 작성.
//   답변이 등록되면 트리거가 status='answered' + 알림 발송 → 사용자는 여기서 답변 확인.
//   2026-08-04 개편(사장님): 전화 CS 폐지 — 모든 문의를 이 문의함으로 일원화.
//     화면을 크게·세련되게 + 스크린샷 첨부(support-attachments 프라이빗 버킷, 회사 폴더 스코프).
//     첨부는 추후 AI 자동 분석(에러 진단)의 입력이 된다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { friendlyError, reportError } from "@/lib/friendly-error";
import { QueryScreen, QueryHead, QueryBody } from "@/components/query-kit";

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

// 모든 문의를 받는다 — 유형은 분류용일 뿐, 어떤 문의든 등록 가능.
const CATEGORIES: { key: string; label: string; icon: string; desc: string }[] = [
  { key: "general", label: "이용 문의", icon: "💬", desc: "사용법·기능이 궁금할 때" },
  { key: "bug", label: "오류 신고", icon: "🐞", desc: "에러·이상 동작 (스크린샷 첨부 권장)" },
  { key: "data", label: "데이터·연동", icon: "🔌", desc: "은행·홈택스 연동, 수치가 안 맞을 때" },
  { key: "billing", label: "결제·구독", icon: "💳", desc: "요금제·결제·영수증" },
  { key: "account", label: "계정·권한", icon: "🔐", desc: "로그인·권한·구성원 초대" },
  { key: "feature", label: "기능 제안", icon: "💡", desc: "이런 기능이 있으면 좋겠습니다" },
  { key: "etc", label: "기타", icon: "📌", desc: "그 외 모든 문의" },
];
const catMeta = (k: string) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[CATEGORIES.length - 1];

const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: "대기", color: "var(--warning)" },
  in_progress: { label: "처리중", color: "var(--primary)" },
  answered: { label: "완료", color: "var(--success)" },
  closed: { label: "종료", color: "var(--text-dim)" },
};

// 진행 단계 표시 (2026-08-04 사장님: "사용자에게 대기→처리중→완료 단계별로 나타나게")
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

// 첨부 스크린샷 — 프라이빗 버킷이라 서명 URL(1시간)로만 열람
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
  const fileRef = useRef<HTMLInputElement>(null);

  // 답변 알림 딥링크(?id=티켓) — 해당 문의를 펼치고 내역으로 스크롤 (2026-08-04 사장님 제보:
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
        // error 를 봐야 한다 (2026-08-20 감사): 실패하면 "사진 N장 첨부" 라고 알리면서 티켓엔
        //   첨부가 없고, 올린 스크린샷만 스토리지에 남았다.
        const { error: attErr } = await (db as any).from("support_tickets").update({ attachments: uploaded }).eq("id", inserted.id);
        if (attErr) {
          await db.storage.from("support-attachments").remove(uploaded.map((u) => u.path)).catch(() => {});
          failed += uploaded.length;
          uploaded.length = 0;
        }
      }
      // 3) AI 자동 진단 — 접수 완료와 무관하게 백그라운드 실행 (실패해도 무시, 결과는 운영자 화면에)
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
          ? `문의가 접수되었습니다. (사진 ${r.uploaded}장 첨부, ${r.failed}장 실패 — 필요하면 다시 첨부해 주세요)`
          : "문의가 접수되었습니다. 영업일 1일 이내에 처리 후 답변드리겠습니다.",
        r.failed > 0 ? "info" : "success",
      );
      setSubject(""); setContent(""); setCategory("general"); setFiles([]);
      qc.invalidateQueries({ queryKey: ["support-tickets", userId] });
    },
    onError: (e) => {
      reportError("support.submit", e);
      toast(friendlyError(e, "문의 접수에 실패했습니다"), "error");
    },
  });

  const canSubmit = subject.trim().length > 0 && content.trim().length > 0 && !submitMut.isPending;
  const answeredCount = useMemo(() => tickets.filter((t) => t.status === "answered").length, [tickets]);

  return (
    <div className="qk-shell support-page-root">
      {/* ── 조회 화면 표준 상자 (2026-08-19 확산) — 히어로 → 설명 줄 하나, 문의 작성·내 문의 내역은 본문(스크롤) 얇은 판 ── */}
      <QueryScreen>
        <QueryHead>
          <div className="report-desc support-desc">
            <b>무엇이든 문의하세요 — 모든 문의는 여기서 받습니다.</b> 전화 상담 없이 문의함으로 운영됩니다 · 영업일 1일 이내 답변 · 화면 사진을 첨부하면 더 빠르게 해결됩니다 · 접수·답변 시 알림 · 첨부 사진은 우리 회사만 봅니다
          </div>
        </QueryHead>
        <QueryBody>
        <div className="support-scroll">

      {/* ═══ 문의 작성 ═══ */}
      <div className="support-compose-card glass-card">
        <div>
          <span className="support-section-label">1. 문의 유형</span>
          <div className="support-category-grid">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                data-active={category === c.key ? "1" : undefined}
                onClick={() => setCategory(c.key)}
                className="support-category-card"
              >
                <span className="support-category-name"><Ico e={c.icon} /> {c.label}</span>
                <span className="support-category-desc">{c.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="support-section-label">2. 제목 <span className="text-red-500">*</span></span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={120}
            placeholder="한 줄로 요약해 주세요 (예: 통장 잔액이 실제와 다르게 보여요)"
            className="support-input field-input"
          />
        </div>

        <div>
          <span className="support-section-label">3. 내용 <span className="text-red-500">*</span></span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData?.files || []).filter((f) => IMAGE_TYPES.has(f.type));
              if (imgs.length) { e.preventDefault(); addFiles(imgs); }
            }}
            placeholder={"어떤 화면에서, 무엇을 했을 때, 어떻게 되었는지 적어주시면 가장 빠르게 해결됩니다.\n(캡처한 이미지를 여기에 붙여넣기(Ctrl+V)해도 자동으로 첨부됩니다)"}
            className="support-textarea field-input"
          />
        </div>

        <div>
          <span className="support-section-label">4. 화면 사진 첨부 <span className="text-[var(--text-dim)] font-normal">(선택 · 최대 {MAX_FILES}장, 장당 {MAX_FILE_MB}MB)</span></span>
          <div
            className="support-dropzone"
            data-drag={dragging ? "1" : undefined}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          >
            <span className="text-2xl"><Ico e="🖼️" /></span>
            <span className="text-[13px] font-semibold text-[var(--text)]">클릭해서 사진 선택 또는 여기로 끌어다 놓기</span>
            <span className="text-[11px] text-[var(--text-dim)]">오류 화면·에러 메시지 캡처를 첨부하면 원인을 훨씬 빨리 찾습니다</span>
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

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => submitMut.mutate()}
          className="support-submit-btn btn-primary"
        >
          {submitMut.isPending ? "접수 중…" : `문의 접수하기${files.length ? ` (사진 ${files.length}장 포함)` : ""}`}
        </button>
      </div>

      {/* ═══ 내 문의 내역 ═══ */}
      <div className="support-history-card glass-card">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">HISTORY</div>
            <div className="text-base font-bold text-[var(--text)]">내 문의 내역</div>
          </div>
          <div className="text-[12px] text-[var(--text-muted)]">
            전체 {tickets.length}건{answeredCount > 0 && <span className="text-emerald-500 font-semibold"> · 답변 {answeredCount}건</span>}
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-[var(--text-muted)] py-8 text-center">불러오는 중…</div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-14">
            <div className="text-4xl mb-3"><Ico e="💬" /></div>
            <div className="text-sm font-semibold text-[var(--text)]">아직 등록한 문의가 없습니다.</div>
            <div className="text-[11px] text-[var(--text-dim)] mt-1.5">위에서 첫 문의를 남겨보세요.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => {
              const st = STATUS_META[t.status] || STATUS_META.open;
              const cm = catMeta(t.category);
              const expanded = openId === t.id;
              const shots = Array.isArray(t.attachments) ? t.attachments : [];
              return (
                <div key={t.id} id={`ticket-${t.id}`} className="support-ticket-item">
                  <button type="button" onClick={() => setOpenId(expanded ? null : t.id)} className="support-ticket-head">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]"><Ico e={cm.icon} /> {cm.label}</span>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ color: st.color, background: `color-mix(in srgb, ${st.color} 12%, transparent)` }}
                      >
                        {st.label}
                      </span>
                      {shots.length > 0 && <span className="text-[10px] text-[var(--text-dim)]"><Ico e="📎" /> {shots.length}</span>}
                      <span className="ml-auto text-[10px] text-[var(--text-dim)] mono-number">{fmtDate(t.created_at)}</span>
                    </div>
                    <div className="text-sm font-semibold text-[var(--text)] truncate">{t.subject}</div>
                    {t.status !== "closed" && <TicketSteps status={t.status} />}
                  </button>
                  {expanded && (
                    <div className="support-ticket-body">
                      <div className="text-[12.5px] text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed py-2">{t.content}</div>
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
                        <div className="mt-2 text-[11px] text-[var(--text-dim)] bg-[var(--bg-surface)]/50 rounded-lg px-3 py-2">
                          아직 답변이 등록되지 않았습니다. 운영팀이 확인 중입니다.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
        </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}
