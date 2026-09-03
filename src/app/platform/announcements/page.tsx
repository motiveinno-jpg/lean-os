"use client";

// 운영자 — 서비스 공지사항 작성·수정·삭제 (2026-08-06 사장님 지시).
//   여기서 쓴 공지는 전 고객사가 /announcements 에서 열람만 한다.
//   쓰기 권한은 DB announcements_*_operator 정책(is_platform_operator())이 최종 게이트다.
//   2026-09-03 운영자 페이지 v2 — pf-* 디자인(KPI·작성 카드·공지 카드 목록). 데이터·동작은 그대로.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";
import { Ico } from "@/components/ui-icon";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfEmpty, PfSkeleton } from "@/app/platform/_components/pf/ui";

type Announcement = {
  id: string;
  company_id: string | null;
  title: string;
  content: string;
  category: string;
  pinned: boolean;
  author_email: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

const CATEGORY_META: Record<string, { label: string; tone: "info" | "ok" | "warn" | "muted" }> = {
  notice: { label: "공지", tone: "info" },
  update: { label: "업데이트", tone: "ok" },
  maintenance: { label: "점검", tone: "warn" },
  event: { label: "이벤트", tone: "info" },
};

const EMPTY_FORM = { title: "", content: "", category: "notice", pinned: false };

export default function PlatformAnnouncementsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["op-announcements"],
    queryFn: async () => {
      const data = logRead('platform/announcements:data', await supabase
        .from("announcements")
        .select("*")
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false }));
      return (data || []) as Announcement[];
    },
  });

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setShowForm(false);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const title = form.title.trim();
      const content = form.content.trim();
      if (!title || !content) throw new Error("제목과 내용을 입력하세요.");
      if (editing) {
        const { error } = await supabase
          .from("announcements")
          .update({ title, content, category: form.category, pinned: form.pinned, updated_at: new Date().toISOString() })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        // company_id 를 비워 전 고객사 공지로 등록한다(회사별 공지는 레거시 2건만 존재).
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const { error } = await supabase.from("announcements").insert({
          title,
          content,
          category: form.category,
          pinned: form.pinned,
          author_email: authUser?.email || null,
          author_name: "OwnerView 운영팀",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["op-announcements"] });
      toast(editing ? "공지를 수정했습니다." : "공지를 등록했습니다.", "success");
      resetForm();
    },
    onError: (e: any) => toast("저장 실패: " + (e?.message || e?.code || ""), "error"),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["op-announcements"] });
      toast("공지를 삭제했습니다.", "success");
    },
    onError: (e: any) => toast("삭제 실패: " + (e?.message || ""), "error"),
  });

  const startEdit = (a: Announcement) => {
    setEditing(a);
    setForm({ title: a.title, content: a.content, category: a.category, pinned: a.pinned });
    setShowForm(true);
  };

  const pinnedCount = useMemo(() => rows.filter((r) => r.pinned).length, [rows]);
  const thisMonth = useMemo(() => {
    const ym = new Date().toISOString().slice(0, 7);
    return rows.filter((r) => String(r.created_at).slice(0, 7) === ym).length;
  }, [rows]);
  const latestAt = rows[0]?.created_at ? new Date(rows[0].created_at).toLocaleDateString("ko-KR") : "—";

  return (
    <PfPage>
      <PfPageHead
        eyebrow="지원"
        title="공지사항"
        desc="여기서 쓴 공지는 모든 고객사의 공지사항 화면에 바로 보입니다. 상단 고정을 켜면 목록 맨 위에 붙습니다."
        actions={!showForm ? (
          <button onClick={() => { resetForm(); setShowForm(true); }} className="pf-btn pf-btn-primary">+ 공지 작성</button>
        ) : undefined}
      />

      <div className="pf-kpi-grid">
        <PfCard i={1} className="pf-kpi-tile"><PfKpi label="등록된 공지" value={rows.length} unit="건" /></PfCard>
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label="상단 고정" value={pinnedCount} unit="건" accent={pinnedCount > 0} /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="이번 달 작성" value={thisMonth} unit="건" /></PfCard>
        <PfCard i={4} className="pf-kpi-tile"><PfKpi label="마지막 공지" value={latestAt} /></PfCard>
      </div>

      {showForm && (
        <PfCard i={5} hover={false}>
          <PfCardHead title={editing ? "공지 수정" : "새 공지 작성"} sub="저장하면 모든 고객사에 즉시 공개됩니다" />
          <PfCardBody className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="field-input max-w-[140px]"
              >
                {Object.entries(CATEGORY_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="제목"
                className="field-input flex-1 min-w-[200px]"
              />
            </div>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="공지 내용을 입력하세요"
              rows={8}
              className="field-input w-full resize-y"
            />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2 text-[12px] font-semibold text-[var(--text-muted)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                  className="rounded"
                />
                상단 고정
              </label>
              <div className="flex items-center gap-2">
                <button onClick={resetForm} className="pf-btn pf-btn-ghost">취소</button>
                <button
                  onClick={() => saveMut.mutate()}
                  disabled={saveMut.isPending || !form.title.trim() || !form.content.trim()}
                  className="pf-btn pf-btn-primary"
                >
                  {saveMut.isPending ? "저장 중..." : editing ? "수정 저장" : "등록"}
                </button>
              </div>
            </div>
          </PfCardBody>
        </PfCard>
      )}

      <PfCard i={6} hover={false}>
        <PfCardHead title="공지 목록" sub="고정된 공지가 먼저, 그다음 최신순" />
        {isLoading ? (
          <div className="px-5 pb-5"><PfSkeleton h={18} rows={3} /></div>
        ) : rows.length === 0 ? (
          <PfEmpty>등록된 공지가 없습니다</PfEmpty>
        ) : (
          <div className="divide-y divide-[var(--border)]/60">
            {rows.map((a) => {
              const cat = CATEGORY_META[a.category] || CATEGORY_META.notice;
              return (
                <div key={a.id} className={`px-5 py-4 ${a.pinned ? "bg-[var(--primary)]/[0.04]" : ""}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        {a.pinned && <span className="text-[11px]" title="상단 고정"><Ico e="📌" /></span>}
                        <PfBadge tone={cat.tone}>{cat.label}</PfBadge>
                        <span className="font-bold text-[14px] text-[var(--text)]">{a.title}</span>
                        {a.company_id && <PfBadge tone="muted">특정 회사 전용</PfBadge>}
                      </div>
                      <div className="text-[13px] text-[var(--text-muted)] mt-1 leading-relaxed whitespace-pre-wrap">{a.content}</div>
                      <div className="text-[11px] text-[var(--text-dim)] mt-2">
                        {a.author_name || a.author_email || "운영자"} · {new Date(a.created_at).toLocaleString("ko-KR")}
                        {a.updated_at !== a.created_at && " (수정됨)"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => startEdit(a)} className="pf-btn pf-btn-sm">수정</button>
                      <button
                        onClick={async () => { if (await appConfirm("이 공지를 삭제하시겠습니까?", { danger: true })) delMut.mutate(a.id); }}
                        className="pf-btn pf-btn-sm pf-btn-ghost text-[var(--danger)]"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PfCard>
    </PfPage>
  );
}
