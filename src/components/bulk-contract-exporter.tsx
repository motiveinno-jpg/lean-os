"use client";

/**
 * 서명완료 계약서 일괄 PDF 저장 (2026-06-05)
 *
 * 단건 저장은 ContractViewer 의 window.print() 라 한 건씩 수동 저장해야 했다.
 * 이 컴포넌트는 ContractViewer 를 화면 밖에서 1건씩 렌더 → .print-area 캡처(html2canvas-pro)
 * → jsPDF 로 PDF 화 → JSZip 에 담아 1개의 zip 으로 내려준다.
 *
 * 충실도: 갑/을 서명 푸터는 ContractViewer 가 partner fetch 까지 끝낸 뒤(loading=false)
 * 비로소 .print-area 를 렌더하므로, .print-area 가 나타난 시점이면 서명 합성이 이미 끝나 있다.
 * → 렌더 로직을 중복하지 않고 그대로 캡처(드리프트 0).
 *
 * 파일명: `소상공인 개별계약서_(업체명).pdf`. 업체명 중복 시 ` (2)` 등 suffix.
 */

import { useEffect, useRef, useState } from "react";
import { ContractViewer } from "./contract-viewer";

export type ExportItem = { id: string; companyName: string };

function sanitize(s: string): string {
  // 파일명 금지문자 제거 + 공백 정리
  return (s || "무명").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() || "무명";
}

function uniqueName(used: Set<string>, company: string): string {
  const base = `소상공인 개별계약서_${sanitize(company)}`;
  let name = `${base}.pdf`;
  let n = 2;
  while (used.has(name)) name = `${base} (${n++}).pdf`;
  used.add(name);
  return name;
}

// .print-area 가 나타나고 그 안의 이미지(직인·서명 data URL / seal_url)가 모두 로드될 때까지 대기.
function waitForReady(host: HTMLElement | null, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const pa = host?.querySelector(".print-area") as HTMLElement | null;
      if (pa) {
        const imgs = Array.from(pa.querySelectorAll("img"));
        const allLoaded = imgs.every(
          (im) => im.complete && (im.naturalHeight > 0 || im.src.startsWith("data:")),
        );
        if (allLoaded) return resolve();
      }
      if (performance.now() - start > timeoutMs) return resolve(); // best-effort
      setTimeout(tick, 120);
    };
    tick();
  });
}

// canvas → A4 세로 PDF (높으면 여러 페이지로 분할, 10mm 여백)
function makePdf(jsPDFCtor: any, canvas: HTMLCanvasElement) {
  const pdf = new jsPDFCtor("p", "mm", "a4");
  const pageW = 210, pageH = 297, margin = 10;
  const imgW = pageW - margin * 2;
  const imgH = (canvas.height * imgW) / canvas.width;
  const imgData = canvas.toDataURL("image/jpeg", 0.92);
  const usableH = pageH - margin * 2;
  let heightLeft = imgH;
  pdf.addImage(imgData, "JPEG", margin, margin, imgW, imgH);
  heightLeft -= usableH;
  while (heightLeft > 0) {
    pdf.addPage();
    const pos = margin - (imgH - heightLeft);
    pdf.addImage(imgData, "JPEG", margin, pos, imgW, imgH);
    heightLeft -= usableH;
  }
  return pdf;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BulkContractExporter({
  items,
  zipName = "소상공인_개별계약서_일괄.zip",
  onProgress,
  onDone,
}: {
  items: ExportItem[];
  zipName?: string;
  onProgress?: (done: number, total: number) => void;
  onDone: (okCount: number, failed: string[]) => void;
}) {
  const [idx, setIdx] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const zipRef = useRef<any>(null);
  const usedNamesRef = useRef<Set<string>>(new Set());
  const failedRef = useRef<string[]>([]);
  const busyRef = useRef(false);

  useEffect(() => {
    if (items.length === 0) {
      onDone(0, []);
      return;
    }
    if (idx >= items.length || busyRef.current) return;
    busyRef.current = true;
    const item = items[idx];

    (async () => {
      try {
        if (!zipRef.current) {
          const JSZip = (await import("jszip")).default;
          zipRef.current = new JSZip();
        }
        await waitForReady(hostRef.current, 15000);
        const printArea = hostRef.current?.querySelector(".print-area") as HTMLElement | null;
        if (!printArea) throw new Error("render-timeout");

        const html2canvas = (await import("html2canvas-pro")).default;
        const canvas = await html2canvas(printArea, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
          // @media print 전용 숨김요소(예: "우리 서명" 버튼)는 캡처에서 제외
          ignoreElements: (el: Element) => (el as HTMLElement).classList?.contains("print:hidden"),
        });

        const { jsPDF } = await import("jspdf");
        const pdf = makePdf(jsPDF, canvas);
        const blob = pdf.output("blob");
        zipRef.current.file(uniqueName(usedNamesRef.current, item.companyName), blob);
      } catch {
        failedRef.current.push(item.companyName);
      } finally {
        onProgress?.(idx + 1, items.length);
        busyRef.current = false;
        if (idx + 1 < items.length) {
          setIdx(idx + 1);
        } else {
          const zipBlob = await zipRef.current.generateAsync({ type: "blob" });
          triggerDownload(zipBlob, zipName);
          onDone(items.length - failedRef.current.length, [...failedRef.current]);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items]);

  if (idx >= items.length) return null;
  return (
    <div
      ref={hostRef}
      aria-hidden
      style={{ position: "fixed", left: -99999, top: 0, width: 820, background: "#fff", zIndex: -1, pointerEvents: "none" }}
    >
      {/* key=id → id 바뀔 때마다 재마운트되어 새 계약서 fetch */}
      <ContractViewer key={items[idx].id} id={items[idx].id} />
    </div>
  );
}
