"use client";

// 오너뷰 안의 것을 대화에 링크로 붙이기 (2026-08-10 사장님 지시).
//   프로젝트 · 게시판 글 · 전자계약(계약서)을 찾아 고르면 `[제목](/경로)` 로 본문에 꽂힌다.
//   받는 사람은 말풍선의 링크를 눌러 그 화면으로 바로 간다.
//
//   ⚠️ 붙는 주소는 **앱 안 경로('/'로 시작)만** 이다 — 바깥 주소를 심을 수 없게 해 둔다
//      (말풍선 렌더도 같은 규칙으로 검사한다).

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

const db = supabase as any;

type Kind = "deal" | "post" | "contract";
type Row = { id: string; label: string; sub?: string; href: string };

const TABS: { key: Kind; label: string }[] = [
  { key: "deal", label: "프로젝트" },
  { key: "post", label: "게시판" },
  { key: "contract", label: "전자계약" },
];

export function ChatLinkPicker({ companyId, onPick, onClose }: {
  companyId: string | null;
  onPick: (item: { label: string; href: string }) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>("deal");
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["chat-link-pick", kind, companyId],
    queryFn: async (): Promise<Row[]> => {
      if (kind === "deal") {
        const data = logRead("ChatLinkPicker:deals", await db.from("deals")
          .select("id, name, status, created_at").eq("company_id", companyId)
          .order("created_at", { ascending: false }).limit(200));
        return (data || []).map((d: any) => ({ id: d.id, label: d.name || "이름 없는 프로젝트", sub: d.status || "", href: `/projecthub/${d.id}` }));
      }
      if (kind === "post") {
        const data = logRead("ChatLinkPicker:posts", await db.from("board_posts")
          .select("id, title, created_at").eq("company_id", companyId)
          .order("created_at", { ascending: false }).limit(200));
        return (data || []).map((p: any) => ({ id: p.id, label: p.title || "제목 없음", sub: String(p.created_at || "").slice(0, 10), href: `/board?post=${p.id}` }));
      }
      const data = logRead("ChatLinkPicker:contracts", await db.from("documents")
        .select("id, name, content_type, document_number, created_at").eq("company_id", companyId)
        .eq("content_type", "contract").order("created_at", { ascending: false }).limit(200));
      return (data || []).map((d: any) => ({ id: d.id, label: d.name || "계약서", sub: d.document_number || String(d.created_at || "").slice(0, 10), href: `/documents?id=${d.id}` }));
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows.slice(0, 60);
    return rows.filter((r) => `${r.label} ${r.sub || ""}`.toLowerCase().includes(t)).slice(0, 60);
  }, [rows, q]);

  return (
    <div ref={boxRef} className="chat-pick chat-pick-wide" role="dialog" aria-label="오너뷰 링크 붙이기">
      <div className="chat-pick-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => { setKind(t.key); setQ(""); }}
            className={`chat-pick-tab ${kind === t.key ? "chat-pick-tab-on" : ""}`}>{t.label}</button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="이름으로 찾기"
        className="chat-pick-search" />
      <div className="chat-pick-body">
        {isLoading && <p className="chat-pick-empty">불러오는 중…</p>}
        {!isLoading && shown.length === 0 && <p className="chat-pick-empty">붙일 수 있는 항목이 없습니다.</p>}
        {shown.map((r) => (
          <button key={r.id} type="button" className="chat-pick-row"
            onClick={() => onPick({ label: r.label, href: r.href })}>
            <b>{r.label}</b>
            {r.sub && <i>{r.sub}</i>}
          </button>
        ))}
      </div>
    </div>
  );
}
