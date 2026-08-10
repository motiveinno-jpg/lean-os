// 쓰는 만큼 늘어나는 입력칸 — 회의록 · 메모 · 메신저처럼 길이를 미리 알 수 없는 글에 쓴다.
//   (2026-08-10) 회의록에서 만들어 쓰던 것을 메신저도 쓰게 되면서 공용 자리로 옮겼다.
//   max 를 넘으면 그 높이에서 멈추고 그 안에서 스크롤한다 — 화면을 다 잡아먹지 않게.

const DEFAULT_MAX = 520;

export function growTextarea(el: HTMLTextAreaElement | null, max = DEFAULT_MAX) {
  if (!el) return;
  //   먼저 auto 로 되돌려야 줄을 지웠을 때 다시 줄어든다(현재 높이 기준으로 재면 안 준다)
  el.style.height = "auto";
  const want = el.scrollHeight + 2;   // +2 — 테두리 때문에 마지막 줄이 살짝 잘리는 것 방지
  el.style.height = `${Math.min(want, max)}px`;
  el.style.overflowY = want > max ? "auto" : "hidden";
}
