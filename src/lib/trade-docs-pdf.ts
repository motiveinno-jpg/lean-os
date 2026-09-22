// 거래명세서(판매) · 발주서(구매) PDF (2026-09-22 ERP 공백 2차 ③, docs/20260921_PLAN_erp_gap_audit2.md)
//
//   History — 재고 › 판매·구매 화면은 재고를 움직이지만 **거래처에 건넬 종이**가 없었다. 주문서(견적 역할)만 PDF 가 있었고,
//   판매 뒤 거래명세서·구매 전 발주서는 엑셀 내려받기로 대신했다(이카운트·더존은 기본 출력).
//
//   기준(무엇으로 판단하나)
//   · 거래명세서 = 판매 문서 한 장. 공급자(우리 회사)와 공급받는자(거래처)를 세금계산서와 같은 자리로 놓고, 품목·수량·단가·공급가액·세액·합계 + 인수자 서명란.
//   · 발주서 = 구매 문서 한 장. 수신(공급자=거래처) · 발신(발주자=우리 회사). 발주일·납기·납품장소(창고) + 품목·합계 + 비고.
//   · 회사 정보는 회사 설정(companies)·거래처 정보는 거래처(partners)에서 읽는다. 빈 값은 빈 칸으로 둔다(지어내지 않는다).
//   · 직인은 회사 설정에 등록된 것이 있을 때만 공급자(발주자) 칸에 얹는다.
//   · 저장 전 화면 값으로도 뽑을 수 있다 — 문서번호가 없으면 "(저장 전)" 으로 적어 정식 번호가 아님을 알린다.
//   · 견적서처럼 회사 양식(form-templates) 오버레이는 두지 않는다 — 거래명세서·발주서는 표준 양식 하나로 충분하고, 요청이 생기면 그때 잇는다.

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/lib/supabase";
import { loadKoreanFont, setKoreanFont } from "@/lib/pdf-korean-font";
import { resolveSealUrl } from "@/lib/signatures";
import { todayKst } from "@/lib/kst";

export type TradeLine = { name: string; spec?: string | null; unit?: string | null; qty: number; unitPrice: number; supply: number; vat: number; note?: string | null };
export type TradeDocInput = {
  companyId: string;
  docNo: string | null;          // 저장된 문서번호 · 없으면 (저장 전)
  date: string;                  // 문서 일자
  partnerId: string | null;
  partnerName: string | null;    // 거래처 id 가 없을 때 이름만
  warehouseName?: string | null; // 발주서 납품장소
  dueDate?: string | null;       // 발주서 납기
  note?: string | null;
  lines: TradeLine[];
};

type Party = { name: string; bizno: string; rep: string; address: string; phone: string; type: string; item: string };

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
const qtyStr = (n: number) => (Number.isInteger(n) ? n.toLocaleString("ko-KR") : n.toLocaleString("ko-KR", { maximumFractionDigits: 3 }));
const bizFmt = (s: string) => { const d = String(s || "").replace(/\D/g, ""); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : String(s || ""); };

async function loadParties(companyId: string, partnerId: string | null, partnerName: string | null): Promise<{ me: Party; them: Party; sealDataUrl: string | null }> {
  const { data: c } = await supabase.from("companies").select("name, business_number, representative, address, phone, business_type, business_category, seal_url").eq("id", companyId).maybeSingle();
  const me: Party = { name: c?.name || "", bizno: bizFmt(c?.business_number || ""), rep: c?.representative || "", address: c?.address || "", phone: c?.phone || "", type: (c as any)?.business_type || "", item: (c as any)?.business_category || "" };
  let p: any = null;
  const cols = "name, business_number, representative, address, contact_phone, business_type, business_item";
  if (partnerId) p = (await supabase.from("partners").select(cols).eq("id", partnerId).maybeSingle()).data;
  else if (partnerName) p = (await supabase.from("partners").select(cols).eq("company_id", companyId).eq("name", partnerName).limit(1).maybeSingle()).data;
  const them: Party = { name: p?.name || partnerName || "", bizno: bizFmt(p?.business_number || ""), rep: p?.representative || "", address: p?.address || "", phone: p?.contact_phone || "", type: p?.business_type || "", item: p?.business_item || "" };
  let sealDataUrl: string | null = null;
  try {
    const url = await resolveSealUrl(c?.seal_url);
    if (url) { const blob = await (await fetch(url)).blob(); sealDataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob); }); }
  } catch { sealDataUrl = null; }   // 직인을 못 읽어도 문서는 나간다
  return { me, them, sealDataUrl };
}

const GRAY: [number, number, number] = [235, 235, 235];
const DARK: [number, number, number] = [30, 30, 30];

/** 공급자·공급받는자 표 한 장 — 세금계산서식 6칸(등록번호·상호·대표·주소·업태/종목·전화) */
function partyTable(doc: jsPDF, x: number, y: number, w: number, title: string, p: Party, styles: any) {
  autoTable(doc, {
    startY: y, margin: { left: x }, tableWidth: w, theme: "grid", styles,
    head: [[{ content: title, colSpan: 2, styles: { fillColor: GRAY, textColor: DARK, halign: "center", fontStyle: "bold" } }]],
    body: [
      ["등록번호", p.bizno], ["상호", p.name], ["대표자", p.rep], ["주소", p.address],
      ["업태 / 종목", [p.type, p.item].filter(Boolean).join(" / ")], ["전화", p.phone],
    ],
    columnStyles: { 0: { cellWidth: 24, fillColor: GRAY, fontStyle: "bold", halign: "center" }, 1: { cellWidth: w - 24 } },
  });
  return (doc as any).lastAutoTable.finalY as number;
}

function linesTable(doc: jsPDF, y: number, M: number, usableW: number, lines: TradeLine[], styles: any, opts: { noteHead: string }) {
  const body = lines.map((l, i) => [String(i + 1), l.name, l.spec || "", qtyStr(l.qty), l.unit || "", won(l.unitPrice), won(l.supply), won(l.vat), l.note || ""]);
  const supply = lines.reduce((s, l) => s + (l.supply || 0), 0), vat = lines.reduce((s, l) => s + (l.vat || 0), 0);
  autoTable(doc, {
    startY: y, margin: { left: M, right: M }, theme: "grid", styles: { ...styles, halign: "center" },
    head: [["No", "품목", "규격", "수량", "단위", "단가", "공급가액", "세액", opts.noteHead]],
    body,
    //   총액은 따로 한 줄 — 비고 칸(좁음)에 넣으면 두 줄로 꺾인다(운영 검증에서 발견)
    foot: [[
      { content: "합계", colSpan: 6, styles: { fillColor: GRAY, fontStyle: "bold", halign: "center" } },
      { content: won(supply), styles: { fillColor: GRAY, fontStyle: "bold", halign: "right" } },
      { content: won(vat), styles: { fillColor: GRAY, fontStyle: "bold", halign: "right" } },
      { content: "", styles: { fillColor: GRAY } },
    ], [
      { content: "총액 (공급가액 + 세액)", colSpan: 6, styles: { fillColor: GRAY, fontStyle: "bold", halign: "center" } },
      { content: `${won(supply + vat)} 원`, colSpan: 3, styles: { fillColor: GRAY, fontStyle: "bold", halign: "right" } },
    ]],
    headStyles: { fillColor: GRAY, textColor: DARK, fontStyle: "bold", halign: "center", font: "NanumGothic" },
    columnStyles: { 0: { cellWidth: 9 }, 1: { halign: "left", cellWidth: 44 }, 2: { halign: "left", cellWidth: 24 }, 3: { cellWidth: 16, halign: "right" }, 4: { cellWidth: 11 }, 5: { cellWidth: 22, halign: "right" }, 6: { cellWidth: 25, halign: "right" }, 7: { cellWidth: 20, halign: "right" }, 8: { halign: "left" } },
  });
  return { y: (doc as any).lastAutoTable.finalY as number, supply, vat };
}

function footer(doc: jsPDF, label: string) {
  const n = doc.getNumberOfPages(), pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); setKoreanFont(doc, "normal"); doc.setTextColor(150, 150, 150); doc.text(`${label} · ${i} / ${n}`, pw / 2, ph - 6, { align: "center" }); }
}

function titleBlock(doc: jsPDF, title: string, M: number, usableW: number, right: string[]) {
  const pw = doc.internal.pageSize.getWidth();
  let y = 14;
  doc.setDrawColor(30, 30, 30); doc.setLineWidth(0.5); doc.rect(M, y, usableW, 13);
  doc.setFontSize(17); setKoreanFont(doc, "bold"); doc.setTextColor(20, 20, 20);
  doc.text(title, pw / 2, y + 9, { align: "center" });
  y += 17;
  doc.setFontSize(8.5); setKoreanFont(doc, "normal"); doc.setTextColor(70, 70, 70);
  right.forEach((t, i) => doc.text(t, pw - M, y + i * 4.5, { align: "right" }));
  return y + right.length * 4.5 + 2;
}

/** 거래명세서 — 판매 문서 */
export async function buildTradeStatementPdf(input: TradeDocInput): Promise<Blob> {
  const { me, them, sealDataUrl } = await loadParties(input.companyId, input.partnerId, input.partnerName);
  const doc = new jsPDF("p", "mm", "a4");
  await loadKoreanFont(doc);
  const pw = doc.internal.pageSize.getWidth(), M = 12, usableW = pw - M * 2;
  const styles: any = { fontSize: 8.5, cellPadding: 1.8, font: "NanumGothic", lineColor: [160, 160, 160], lineWidth: 0.15, textColor: DARK };
  let y = titleBlock(doc, "거 래 명 세 서", M, usableW, [`거래일자 ${input.date}`, `문서번호 ${input.docNo || "(저장 전)"}`]);

  const gap = 5, half = (usableW - gap) / 2;
  const y1 = partyTable(doc, M, y, half, "공급받는자", them, styles);
  const y2 = partyTable(doc, M + half + gap, y, half, "공급자", me, styles);
  if (sealDataUrl) { try { doc.addImage(sealDataUrl, "PNG", pw - M - 20, y + 8, 18, 18); } catch { /* 직인 실패는 무시 */ } }
  y = Math.max(y1, y2) + 5;

  doc.setFontSize(9); setKoreanFont(doc, "normal"); doc.setTextColor(40, 40, 40);
  doc.text(`아래와 같이 거래(납품)하였음을 확인합니다.`, M, y + 1);
  y += 5;
  const t = linesTable(doc, y, M, usableW, input.lines, styles, { noteHead: "비고" });
  y = t.y + 6;

  if (input.note) { doc.setFontSize(8.5); doc.setTextColor(60, 60, 60); doc.text(`비고: ${input.note}`, M, y, { maxWidth: usableW }); y += 8; }

  //   인수자 서명란 — 거래명세서의 존재 이유(받았다는 확인)
  autoTable(doc, {
    startY: y, margin: { left: pw - M - 80 }, tableWidth: 80, theme: "grid", styles,
    body: [[{ content: "인수자", styles: { fillColor: GRAY, fontStyle: "bold", halign: "center", cellWidth: 20 } }, { content: "                    (서명)", styles: { halign: "right", minCellHeight: 12 } }]],
  });
  footer(doc, `${me.name} 거래명세서`);
  return doc.output("blob");
}

/** 발주서 — 구매 문서 */
export async function buildPurchaseOrderPdf(input: TradeDocInput): Promise<Blob> {
  const { me, them, sealDataUrl } = await loadParties(input.companyId, input.partnerId, input.partnerName);
  const doc = new jsPDF("p", "mm", "a4");
  await loadKoreanFont(doc);
  const pw = doc.internal.pageSize.getWidth(), M = 12, usableW = pw - M * 2;
  const styles: any = { fontSize: 8.5, cellPadding: 1.8, font: "NanumGothic", lineColor: [160, 160, 160], lineWidth: 0.15, textColor: DARK };
  let y = titleBlock(doc, "발 주 서", M, usableW, [`발주일자 ${input.date}`, `문서번호 ${input.docNo || "(저장 전)"}`, `납기 ${input.dueDate || "협의"}`]);

  const gap = 5, half = (usableW - gap) / 2;
  const y1 = partyTable(doc, M, y, half, "수신 (공급자)", them, styles);
  const y2 = partyTable(doc, M + half + gap, y, half, "발신 (발주자)", me, styles);
  if (sealDataUrl) { try { doc.addImage(sealDataUrl, "PNG", pw - M - 20, y + 8, 18, 18); } catch { /* 직인 실패는 무시 */ } }
  y = Math.max(y1, y2) + 5;

  doc.setFontSize(9); setKoreanFont(doc, "normal"); doc.setTextColor(40, 40, 40);
  doc.text(`아래와 같이 발주하오니 납기 내 납품 바랍니다.`, M, y + 1);
  y += 5;
  const t = linesTable(doc, y, M, usableW, input.lines, styles, { noteHead: "비고" });
  y = t.y + 6;

  const info: string[] = [];
  info.push(`납품장소: ${[input.warehouseName, me.address].filter(Boolean).join(" · ") || "-"}`);
  if (input.dueDate) info.push(`납기일: ${input.dueDate}`);
  if (input.note) info.push(`비고: ${input.note}`);
  info.push(`작성일: ${todayKst()}`);
  doc.setFontSize(8.5); doc.setTextColor(60, 60, 60);
  info.forEach((s, i) => doc.text(s, M, y + i * 5, { maxWidth: usableW }));
  footer(doc, `${me.name} 발주서`);
  return doc.output("blob");
}

/** 팝업 버튼 공용 — 만들고 바로 내려받기 */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
