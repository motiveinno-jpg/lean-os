// 광고 메일 본문(운영자가 textarea 에 쓴 평문) → 메일용 HTML·텍스트 두 벌.
//
//   · 줄바꿈은 <br> 로 박는다. white-space:pre-wrap 은 네이버·다음·아웃룩 웹메일이 지워 버려
//     본문이 한 덩어리로 붙어 도착한다.
//   · 줄 앞 공백·연속 공백은 &nbsp; 로 — 들여쓴 줄이 왼쪽으로 붙지 않게.
//   · 링크: [보일 글자](https://주소) → 글자에 링크.  그냥 적은 https://주소 도 링크.
//     텍스트판에는 "보일 글자 (https://주소)" 로 남긴다.
//   · http/https 만 링크로 만든다(javascript: 등은 글자 그대로).
import { escapeHtml } from "./mail-guard.ts";

const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>\[\]()]+[^\s<>\[\]().,!?'"])/g;
const A_STYLE = "color:#4f46e5;text-decoration:underline";

function keepSpaces(escaped: string): string {
  return escaped.replace(/^ +/, (m) => "&nbsp;".repeat(m.length)).replace(/ {2,}/g, (m) => " " + "&nbsp;".repeat(m.length - 1));
}

function lineToHtml(line: string): string {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(LINK_RE)) {
    out += keepSpaces(escapeHtml(line.slice(last, m.index)));
    const [, label, labelUrl, bareUrl] = m;
    const url = labelUrl || bareUrl;
    out += `<a href="${escapeHtml(url)}" style="${A_STYLE}" target="_blank">${escapeHtml(label || bareUrl)}</a>`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + keepSpaces(escapeHtml(line.slice(last)));
}

export function renderCampaignBody(bodyText: string): { html: string; text: string } {
  const lines = bodyText.replace(/\r\n?/g, "\n").split("\n");
  const html = lines.map(lineToHtml).join("<br>\n");
  const text = lines
    .map((l) => l.replace(LINK_RE, (_all, label, labelUrl, bareUrl) => (label ? `${label} (${labelUrl})` : bareUrl)))
    .join("\n");
  return { html, text };
}

/** 본문에서 주소 없이 [글자] 만 남은 곳 — 복사해 오면서 링크가 떨어진 흔적 */
export function orphanLinkLabels(bodyText: string): string[] {
  const out: string[] = [];
  for (const m of bodyText.matchAll(/\[([^\]\n]+)\](?!\()/g)) {
    if (!/^https?:\/\//.test(m[1])) out.push(m[1]);
  }
  return out;
}
