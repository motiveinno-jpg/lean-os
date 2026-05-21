"use client";

// L 계약: 외부 /quote/[token] 페이지의 stage='contract' 승인 시 사용하는
// 서명·도장 캡처 컴포넌트.
//
// 3 모드:
//   - draw: <canvas> 손글씨 → toDataURL('image/png')
//   - type: 텍스트 입력 → canvas 에 손글씨 폰트 렌더 → toDataURL
//   - upload: 이미지(PNG/JPG, 도장 등) → FileReader.readAsDataURL
//
// 결과는 onChange(method, dataUrl) 콜백으로 부모에게 전달.
// 기존 /sign 페이지(employee contract)의 canvas 패턴 차용 (단순화 버전).

import { useCallback, useEffect, useRef, useState } from "react";

export type SignatureMethod = "draw" | "type" | "upload";

interface Props {
  onChange: (method: SignatureMethod | null, dataUrl: string | null) => void;
  /** 작성자 이름 — type 모드 기본값 (예: 거래처 담당자명) */
  defaultTypeName?: string;
}

export function SignatureCapture({ onChange, defaultTypeName = "" }: Props) {
  const [mode, setMode] = useState<SignatureMethod>("draw");
  const [typed, setTyped] = useState(defaultTypeName);
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

  // type mode — 입력값을 canvas 에 손글씨 폰트로 렌더 후 dataUrl
  useEffect(() => {
    if (mode !== "type") return;
    const text = typed.trim();
    if (!text) { onChange(null, null); return; }
    const c = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    c.width = 600 * dpr;
    c.height = 180 * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 600, 180);
    // 한글 손글씨 느낌 — Nanum Myeongjo (이미 globals.css 에 로드됨)
    ctx.fillStyle = "#0f172a";
    ctx.font = "italic bold 72px 'Nanum Myeongjo','Noto Serif KR',serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 300, 90);
    onChange("type", c.toDataURL("image/png"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, typed]);

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
    <div className="space-y-3">
      {/* 모드 탭 */}
      <div className="flex gap-1.5">
        {[
          { v: "draw" as const, label: "✍️ 손글씨" },
          { v: "type" as const, label: "🖊 타이핑" },
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
        <div>
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
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-gray-400">{drawDirty ? "✓ 서명 입력됨" : "서명 미입력"}</span>
            <button type="button" onClick={clearDraw} className="text-[11px] text-gray-500 hover:text-gray-800 underline">지우기</button>
          </div>
        </div>
      )}

      {/* type */}
      {mode === "type" && (
        <div>
          <div className="text-[11px] text-gray-500 mb-1">서명자 이름을 입력하면 손글씨 폰트로 변환됩니다</div>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="홍길동"
            maxLength={20}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
          />
          {typed.trim() && (
            <div className="mt-2 bg-white border border-gray-200 rounded-lg p-3 text-center">
              <span
                className="text-3xl"
                style={{ fontFamily: "'Nanum Myeongjo','Noto Serif KR',serif", fontStyle: "italic", fontWeight: 700, color: "#0f172a" }}
              >
                {typed}
              </span>
            </div>
          )}
        </div>
      )}

      {/* upload */}
      {mode === "upload" && (
        <div>
          <div className="text-[11px] text-gray-500 mb-1">도장/사인 이미지 (PNG/JPG, 권장 흰 배경 + 빨강 도장)</div>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
            className="text-xs"
          />
          {uploadedUrl && (
            <div className="mt-2 bg-white border border-gray-200 rounded-lg p-3 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={uploadedUrl} alt="업로드 도장" className="max-h-32 object-contain" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
