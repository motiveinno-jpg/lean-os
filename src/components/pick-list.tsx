"use client";

// 검색해서 고르는 드롭다운 — **키보드로 다 되게** (2026-08-12 사장님 지시)
//
//   같은 모양의 드롭다운이 여섯 군데에 복사돼 있었다(수집·전표 증빙 2, 통장 1, 매입매출전표 계정·거래처).
//   전부 마우스로만 고를 수 있었다 — 숫자를 치고 나면 손이 마우스로 가야 해서 흐름이 끊긴다.
//   따로 고치면 또 제각각이 되므로 하나로 모으고, 여기서만 키보드를 책임진다.
//
//   조작:  ↑ ↓ 이동  ·  Enter 고르기  ·  Esc 닫기  ·  Tab 도 닫는다(다음 칸으로)
//   · 열면 검색칸에 바로 커서가 간다. 글자를 치면 **첫 줄이 저절로 골라진 상태**라 Enter 만 누르면 된다.
//   · 고른 줄은 목록이 길어도 화면 안으로 따라 들어온다(scrollIntoView).

import { useEffect, useRef, useState } from "react";

export type PickItem = { id: string; code?: string | null; name: string };

export function PickList<T extends PickItem>({
  items, onPick, onClose, placeholder = "검색 (이름·코드)", empty = "찾는 것이 없습니다", onCreate, createLabel,
}: {
  items: T[];
  onPick: (item: T) => void;
  onClose: () => void;
  placeholder?: string;
  empty?: string;
  /** 주면 목록 끝에 "＋ 새로 등록" 줄이 생긴다 — 없는 항목을 여기서 바로 만들게 (2026-09-02 사장님: 매입매출전표에서 거래처 바로 등록).
   *  검색어가 그대로 넘어가므로 이름 칸을 미리 채울 수 있다. ↑↓ 로 닿고 Enter 로 누른다. 결과가 0건이면 Enter 한 번이 곧 등록이다. */
  onCreate?: (q: string) => void;
  createLabel?: (q: string) => string;
}) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  //   ⚠️ 닫기는 **여기서** 책임진다. 여는 쪽이 입력칸 blur 로 닫으면, 이 컴포넌트의 자동 포커스가
  //     그 blur 를 일으켜 열자마자 닫힌다(실제로 그렇게 만들었다가 잡았다).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    //   여는 클릭이 그대로 '바깥 클릭'으로 잡히지 않게 다음 틱부터 듣는다
    const id = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", onDown); };
  }, [onClose]);

  const t = q.trim().toLowerCase();
  const shown = t
    ? items.filter((a) => a.name.toLowerCase().includes(t) || String(a.code ?? "").toLowerCase().includes(t))
    : items;
  //   '새로 등록' 줄은 목록 끝의 가상 항목(index = shown.length) — ↑↓·Enter 가 똑같이 닿는다
  const createAt = onCreate ? shown.length : -1;
  const lastAt = onCreate ? shown.length : shown.length - 1;
  const createText = createLabel ? createLabel(q.trim()) : (q.trim() ? `"${q.trim()}" 새로 등록` : "새로 등록");

  //   검색어가 바뀌면 고른 자리를 첫 줄로 되돌린다 — 안 그러면 엉뚱한 줄이 골라진 채로 남는다
  useEffect(() => { setAt(0); }, [q]);

  //   고른 줄을 화면 안으로. 목록이 길 때 ↓ 를 눌러도 안 보이면 어디 있는지 알 수 없다.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-at="${at}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, Math.max(0, lastAt))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      if (onCreate && at === createAt) { onCreate(q.trim()); return; }
      const sel = shown[at];
      if (sel) onPick(sel);
    } else if (e.key === "Escape" || e.key === "Tab") {
      //   Tab 은 막지 않는다 — 닫고 다음 칸으로 자연스럽게 넘어가게 둔다
      if (e.key === "Escape") e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="spv-drop spv-drop-acct" ref={boxRef} onKeyDown={onKey}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder} className="spv-drop-search" />
      <div className="spv-drop-list" ref={listRef}>
        {shown.map((a, i) => (
          <button key={a.id} type="button" data-at={i}
            className={i === at ? "pick-on" : undefined}
            onMouseEnter={() => setAt(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(a)}>
            {a.code != null && <span className="spv-drop-code">{a.code}</span>}
            <span className="spv-drop-name">{a.name}</span>
            {i === at && <span className="pick-enter">↵</span>}
          </button>
        ))}
        {shown.length === 0 && <div className="pick-empty">{empty}</div>}
        {onCreate && (
          <button type="button" data-at={createAt}
            className={at === createAt ? "pick-create pick-on" : "pick-create"}
            onMouseEnter={() => setAt(createAt)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onCreate(q.trim())}>
            <span className="spv-drop-code">＋</span>
            <span className="spv-drop-name">{createText}</span>
            {at === createAt && <span className="pick-enter">↵</span>}
          </button>
        )}
      </div>
    </div>
  );
}
