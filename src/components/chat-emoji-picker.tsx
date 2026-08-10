"use client";

// 메시지 이모지 고르기 (2026-08-10 사장님 지시) — 작성 상자의 첨부 옆 단추가 연다.
//   외부 라이브러리 없이 자주 쓰는 이모지만 추린다. 고르면 커서 자리에 그대로 꽂힌다.
//   ⚠️ 여기서는 <Ico> 를 쓰지 않는다 — Ico 는 이모지를 선형 아이콘으로 바꾸는데,
//      메시지에 넣을 것은 실제 이모지 글자여야 한다.

import { useEffect, useRef } from "react";

const GROUPS: { title: string; list: string[] }[] = [
  { title: "자주", list: ["👍", "🙏", "👏", "🎉", "🔥", "✅", "❗", "❓", "💯", "👀"] },
  { title: "표정", list: ["😀", "😄", "😊", "😂", "🙂", "😉", "😍", "🤔", "😅", "😢", "😭", "😡", "😴", "🤝"] },
  { title: "일", list: ["📌", "📅", "📝", "📊", "📈", "📉", "💼", "💡", "⏰", "⚠️", "🚀", "🏁"] },
  { title: "돈·물건", list: ["💰", "💳", "🧾", "🎁", "☕", "🍚", "🚗", "🏢", "📦", "🔗"] },
];

export function ChatEmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);

  //   바깥을 누르거나 ESC 면 닫는다
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    //   여는 클릭이 그대로 닫기로 이어지지 않게 다음 틱부터 듣는다
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <div ref={boxRef} className="chat-pick" role="dialog" aria-label="이모지 고르기">
      <div className="chat-pick-body">
        {GROUPS.map((g) => (
          <div key={g.title} className="chat-emoji-group">
            <b>{g.title}</b>
            <div className="chat-emoji-grid">
              {g.list.map((e) => (
                <button key={e} type="button" className="chat-emoji-btn" title={e}
                  onClick={() => onPick(e)}>{e}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
