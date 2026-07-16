"use client";

// L 계약: 외부 /quote/[token] 페이지의 stage='contract' 승인 시 사용하는
// 서명·도장 캡처 컴포넌트.
//
// 2 모드 (타이핑 서명은 본문 합성 미적용 이슈로 제거 — 2026-05-26):
//   - draw: <canvas> 손글씨 → toDataURL('image/png')
//   - upload: 이미지(PNG/JPG, 도장 등) → FileReader.readAsDataURL
//
// 결과는 onChange(method, dataUrl) 콜백으로 부모에게 전달.
// 기존 /sign 페이지(employee contract)의 canvas 패턴 차용 (단순화 버전).
// SignatureMethod union 의 "type" 은 과거 타이핑 서명 데이터 표시 호환 위해 유지.

import { useCallback, useEffect, useRef, useState } from "react";

export type SignatureMethod = "draw" | "type" | "upload";

interface Props {
  onChange: (method: SignatureMethod | null, dataUrl: string | null) => void;
}

export function SignatureCapture({ onChange }: Props) {
  const [mode, setMode] = useState<SignatureMethod>("draw");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  // draw mode
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const [drawDirty, setDrawDirty] = useState(false);

  // 캔버스 초기화 (DPR 적용 — sign 페이지 패턴)
  const setupCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    if (rect.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.2;
  }, []);

  useEffect(() => {
    if (mode !== "draw") return;
    const id = requestAnimationFrame(setupCanvas);
    const onResize = () => setupCanvas();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
    };
  }, [mode, setupCanvas]);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    isDrawing.current = true;
    lastPt.current = getPoint(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const pt = getPoint(e);
    if (!pt || !lastPt.current) return;
    ctx.beginPath();
    ctx.moveTo(lastPt.current.x, lastPt.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPt.current = pt;
    setDrawDirty(true);
  }
  function onPointerUp() {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    lastPt.current = null;
    // 그릴 때마다 onChange 호출 — 부모가 dataUrl 가져갈 수 있게
    emitDraw();
  }
  function emitDraw() {
    const c = canvasRef.current;
    if (!c) return;
    const url = c.toDataURL("image/png");
    onChange("draw", url);
  }
  function clearDraw() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    setDrawDirty(false);
    onChange(null, null);
  }

  // upload mode
  function handleUpload(file: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("이미지 파일만 업로드 가능합니다");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setUploadedUrl(url);
      onChange("upload", url);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="signature-capture">
      {/* 모드 탭 */}
      <div className="signature-mode-tabs">
        {[
          { v: "draw" as const, label: "✍️ 손글씨" },
          { v: "upload" as const, label: "🟥 도장 업로드" },
        ].map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => { setMode(opt.v); onChange(null, null); }}
            className={`flex-1 px-3 py-2 rounded text-xs font-semibold transition ${
              mode === opt.v
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* draw */}
      {mode === "draw" && (
        <div className="signature-draw-panel">
          <div className="text-[11px] text-gray-500 mb-1">아래 흰 박스 안에 마우스/터치로 서명해 주세요</div>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            style={{ touchAction: "none" }}
            className="w-full h-40 bg-white border-2 border-dashed border-gray-300 rounded-lg cursor-crosshair"
          />
          <div className="signature-draw-footer">
            <span className="text-[10px] text-gray-400">{drawDirty ? "✓ 서명 입력됨" : "서명 미입력"}</span>
            <button type="button" onClick={clearDraw} className="text-[11px] text-gray-500 hover:text-gray-800 underline">지우기</button>
          </div>
        </div>
      )}

      {/* upload */}
      {mode === "upload" && (
        <div className="signature-upload-panel">
          <div className="text-[11px] text-gray-500 mb-1">도장/사인 이미지 (PNG/JPG, 권장 흰 배경 + 빨강 도장)</div>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
            className="text-xs"
          />
          {uploadedUrl && (
            <div className="signature-upload-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={uploadedUrl} alt="업로드 도장" className="max-h-32 object-contain" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
