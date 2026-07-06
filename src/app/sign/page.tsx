"use client";

import { Suspense, useEffect, useState, useRef, useCallback, useMemo } from "react";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import parse, { type HTMLReactParserOptions } from "html-react-parser";
import { friendlyError } from "@/lib/friendly-error";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ToastProvider, useToast } from "@/components/toast";
import { logAuditTrail } from "@/lib/audit-trail";
import { generatePackageHash, storeDocumentHash } from "@/lib/document-integrity";
import { injectContractInlineStyles } from "@/lib/signatures";
import { parseSiyanFields, validateInputs, isFieldActive, applySignerInputsToHtml, type SignerField } from "@/lib/signature-fields";
import { buildPartnerReplacements, applyTokenReplacements } from "@/lib/signer-replacements";
import { usePrintIsolation } from "@/lib/use-print-isolation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// 2026-05-28 라이브 서명 본문 렌더 — html-react-parser 로 본문 HTML 을 React tree 로 변환.
//   토큰({{?라디오:...}}/{{?텍스트:...}}) 자리에 RadioInline/TextInline 컴포넌트 직접 mount.
//   table/span/strong/img 등 RichEditor 서식은 라이브러리가 자동 보존. portal/anchor span 불필요.
//   PDF·서명본 모달의 ☑/☐ 정적 합성(applySignerInputsToHtml)은 별도 경로로 유지.

// 토큰 정규식 (signature-fields.ts 와 동일 문법, parser 안에서 사용)
const RADIO_TOKEN_RE_LOCAL = /\{\{\s*\?라디오\s*:\s*([^}]+?)\s*\}\}/g;
const TEXT_TOKEN_RE_LOCAL = /\{\{\s*\?텍스트\s*:\s*([^}]+?)\s*\}\}/g;

// 라디오 인라인 — 본문 토큰 자리에 그대로 mount. 옵션 수평 wrap.
function RadioInline({ field, value, onChange }: {
  field: { key: string; options: string[]; required: boolean };
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "6px 14px", verticalAlign: "middle" }}>
      {field.options.map((opt) => (
        <label key={opt} style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 13, userSelect: "none" }}>
          <input
            type="radio"
            name={field.key}
            value={opt}
            checked={value === opt}
            onChange={() => onChange(opt)}
            style={{ accentColor: "#4f46e5", margin: 0 }}
          />
          <span style={{ color: value === opt ? "#4f46e5" : "#334155", fontWeight: value === opt ? 600 : 400 }}>{opt}</span>
        </label>
      ))}
    </span>
  );
}

// 텍스트 인라인 — when 조건은 호출처에서 active 판단 후 mount.
function TextInline({ field, value, onChange, active }: {
  field: { key: string; when?: { key: string; value: string }; required: boolean };
  value: string;
  onChange: (v: string) => void;
  active: boolean;
}) {
  if (!active) return null;
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`${field.key} 입력`}
      style={{
        display: "inline-block",
        // 2026-05-28 모바일 반응형 — 화면 폭 초과 방지(maxWidth 100%) + 모바일에서 최소폭 줄임.
        minWidth: 140,
        maxWidth: "100%",
        padding: "4px 8px",
        border: "1px solid #cbd5e1",
        borderRadius: 4,
        fontSize: 14,
        verticalAlign: "middle",
        outline: "none",
        marginLeft: 4,
      }}
    />
  );
}

// 토큰 inner 파싱 헬퍼.
function parseRadioInner(inner: string): { key: string; options: string[] } {
  const norm = String(inner).replace(/\s+/g, " ").trim();
  const parts = norm.split("|").map((s) => s.trim()).filter(Boolean);
  return { key: parts[0] || "", options: parts.slice(1) };
}
function parseTextInner(inner: string): { key: string; when?: { key: string; value: string } } {
  const norm = String(inner).replace(/\s+/g, " ").trim();
  const whenIdx = norm.search(/\swhen\s*=/i);
  if (whenIdx >= 0) {
    const key = norm.slice(0, whenIdx).trim();
    const whenStr = norm.slice(whenIdx).replace(/^\s*when\s*=\s*/i, "").trim();
    const eq = whenStr.indexOf("=");
    if (eq > 0) return { key, when: { key: whenStr.slice(0, eq).trim(), value: whenStr.slice(eq + 1).trim() } };
    return { key };
  }
  return { key: norm };
}

// 본문 HTML → React tree (토큰 자리는 RadioInline/TextInline 로 교체).
function renderSignerBody(
  rawHtml: string,
  signerInputs: Record<string, string>,
  setSignerInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>,
): React.ReactNode {
  const styled = injectContractInlineStyles(rawHtml);

  const replaceTokensInText = (text: string): React.ReactNode[] => {
    type M = { idx: number; len: number; type: "radio" | "text"; inner: string };
    const all: M[] = [];
    RADIO_TOKEN_RE_LOCAL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RADIO_TOKEN_RE_LOCAL.exec(text))) all.push({ idx: m.index, len: m[0].length, type: "radio", inner: m[1] });
    TEXT_TOKEN_RE_LOCAL.lastIndex = 0;
    while ((m = TEXT_TOKEN_RE_LOCAL.exec(text))) all.push({ idx: m.index, len: m[0].length, type: "text", inner: m[1] });
    all.sort((a, b) => a.idx - b.idx);

    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const match of all) {
      if (match.idx > cursor) parts.push(text.slice(cursor, match.idx));
      if (match.type === "radio") {
        const { key, options } = parseRadioInner(match.inner);
        if (key && options.length > 0) {
          parts.push(
            <RadioInline
              key={`r-${key}-${match.idx}`}
              field={{ key, options, required: true }}
              value={signerInputs[key] || ""}
              onChange={(v) => setSignerInputs((prev) => ({ ...prev, [key]: v }))}
            />,
          );
        }
      } else {
        const { key, when } = parseTextInner(match.inner);
        if (key) {
          const active = !when || signerInputs[when.key] === when.value;
          parts.push(
            <TextInline
              key={`t-${key}-${match.idx}`}
              field={{ key, when, required: !!when }}
              value={signerInputs[key] || ""}
              onChange={(v) => setSignerInputs((prev) => ({ ...prev, [key]: v }))}
              active={active}
            />,
          );
        }
      }
      cursor = match.idx + match.len;
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
  };

  const options: HTMLReactParserOptions = {
    replace: (node) => {
      // 텍스트 노드 안에 토큰이 있으면 split → React 노드 배열
      if ((node as { type?: string }).type === "text") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = (node as any).data as string;
        if (text && (RADIO_TOKEN_RE_LOCAL.test(text) || TEXT_TOKEN_RE_LOCAL.test(text))) {
          RADIO_TOKEN_RE_LOCAL.lastIndex = 0;
          TEXT_TOKEN_RE_LOCAL.lastIndex = 0;
          return <>{replaceTokensInText(text)}</>;
        }
      }
      // 다른 모든 노드(table/td/span/strong/img 등)는 라이브러리가 자동 재구성
      return undefined;
    },
  };

  return parse(styled, options);
}

// 본문 끝의 서명 텍스트 블록 제거 — Flex 스타일 footer 로 별도 렌더하기 위해
// 매칭: "{{contract_date}}" / 한국어 날짜 / 서명(인) / {{employee_seal}} 등 마커가 있는 마지막 섹션
function stripSignatureBlock(body: string): string {
  if (!body) return body;
  // HTML 태그 안전 처리 위해 단순 텍스트 기준 split
  // 패턴: "서명(인)" 이 첫 등장하는 지점부터 잘라냄 (그 이후는 footer 가 대체)
  const markers = ["{{company_seal}}", "{{employee_seal}}", "서명(인)"];
  let cutAt = -1;
  for (const m of markers) {
    const idx = body.indexOf(m);
    if (idx >= 0 && (cutAt === -1 || idx < cutAt)) cutAt = idx;
  }
  if (cutAt < 0) return body;
  // 직전 줄(회사명/직위/성명/날짜 안내 블록)부터 함께 자르기 위해 적당히 이전 위치 탐색
  const upTo = body.slice(0, cutAt);
  // 마지막 빈 줄 또는 "{{contract_date}}" 마커를 기준으로 잘라냄
  const dateIdx = upTo.lastIndexOf("{{contract_date}}");
  if (dateIdx >= 0) return body.slice(0, dateIdx).replace(/\s+$/, "");
  const nameMarkerIdx = Math.max(upTo.lastIndexOf("회사명(A)"), upTo.lastIndexOf("회사명 (A)"));
  if (nameMarkerIdx >= 0) return body.slice(0, nameMarkerIdx).replace(/\s+$/, "");
  return body.slice(0, cutAt).replace(/\s+$/, "");
}

// Flex 스타일 5열 서명 푸터 — 화면 렌더용 React 컴포넌트
// 2026-05-22 내부 /contracts/signed 와 동일한 갑/을 서명 박스 푸터.
//   갑(회사) = 회사명·사업자번호·대표자 + 직인 이미지 / 을(서명자) = 성명·생년월일 + 서명 이미지.
function ContractSignatureFooter(props: {
  contractDate?: string;
  companyName?: string;
  representative?: string;
  businessNumber?: string | null;
  sealUrl?: string | null;
  sealAppliedAt?: string | null;
  employeeName?: string;
  birthDate?: string;
  // 을이 거래처(회사)인 경우 — 있으면 회사 구조(회사명/사업자번호/대표자), 없으면 개인(성명/생년월일)
  signerCompanyName?: string;
  signerBusinessNumber?: string | null;
  signerRepresentative?: string;
  signature?: { type: "draw" | "type"; data: string } | null;
}) {
  const { contractDate, companyName, representative, businessNumber, sealUrl, sealAppliedAt, employeeName, birthDate, signerCompanyName, signerBusinessNumber, signerRepresentative, signature } = props;
  const signerIsCompany = !!(signerCompanyName && signerCompanyName.trim());
  const fmtDate = (d?: string): string => {
    if (!d) return "";
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}년 ${m[2]}월 ${m[3]}일` : String(d);
  };
  return (
    <div className="mt-12 pt-6 border-t border-gray-200 grid grid-cols-2 gap-12 print:break-inside-avoid">
      {/* 갑 (회사) */}
      <div>
        <div className="text-sm font-bold mb-2">갑 (회사)</div>
        <div className="text-xs space-y-1.5 text-gray-900">
          <div>회사명: {companyName || "—"}</div>
          <div>사업자등록번호: {businessNumber || "—"}</div>
          <div className="flex items-center gap-3 mt-1">
            <span>대표자: {representative || "—"} (인)</span>
            {sealUrl ? (
              <img src={sealUrl} alt="회사 직인" className="h-12 inline-block" />
            ) : (
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-dashed border-gray-300 text-[9px] text-gray-400">직인</span>
            )}
          </div>
          {sealAppliedAt && <div className="text-[10px] text-gray-500 mt-1">{new Date(sealAppliedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</div>}
        </div>
      </div>
      {/* 을 (서명자) */}
      <div>
        <div className="text-sm font-bold mb-2">을 ({signerIsCompany ? "회사" : "서명자"})</div>
        <div className="text-xs space-y-1.5 text-gray-900">
          {signerIsCompany ? (
            <>
              <div>회사명: {signerCompanyName || "—"}</div>
              <div>사업자등록번호: {signerBusinessNumber || "—"}</div>
              <div className="flex items-center gap-3 mt-1">
                <span>대표자: {signerRepresentative || "—"} (인)</span>
                {signature?.type === "draw" && typeof signature.data === "string" ? (
                  <img src={signature.data} alt="서명" className="h-12 inline-block" />
                ) : signature?.type === "type" ? (
                  <span className="text-2xl italic text-gray-900" style={{ fontFamily: "cursive, serif" }}>{signature.data}</span>
                ) : (
                  <span className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-dashed border-gray-300 text-[9px] text-gray-400">서명</span>
                )}
              </div>
              {contractDate && <div className="text-[10px] text-gray-500 mt-1">{fmtDate(contractDate)}</div>}
            </>
          ) : (
          <>
          <div>성명: {employeeName || "—"}</div>
          <div>생년월일: {fmtDate(birthDate) || "—"}</div>
          <div className="flex items-center gap-3 mt-1">
            <span>서명 (인)</span>
            {signature?.type === "draw" && typeof signature.data === "string" ? (
              <img src={signature.data} alt="서명" className="h-12 inline-block" />
            ) : signature?.type === "type" ? (
              <span className="text-2xl italic text-gray-900" style={{ fontFamily: "cursive, serif" }}>{signature.data}</span>
            ) : (
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-dashed border-gray-300 text-[9px] text-gray-400">서명</span>
            )}
          </div>
          {contractDate && <div className="text-[10px] text-gray-500 mt-1">{fmtDate(contractDate)}</div>}
          </>
          )}
        </div>
      </div>
    </div>
  );
}

type PackageData = {
  id: string;
  title: string;
  status: string;
  expired: boolean;
  company_id?: string;
  employees: { name: string; email?: string; department?: string; position?: string };
  companies?: { name: string; seal_url?: string | null; representative?: string | null; business_number?: string | null } | null;
  notes?: string;
  // notes JSON 파싱 결과 — seal_applied_at 있으면 직인 표시
  seal_url?: string | null;
  seal_applied_at?: string | null;
  seal_company_name?: string | null;
  // Step 3 에서 입력한 필수 정보 (생년월일, 계약일 등)
  contract_meta?: Record<string, string> | null;
  items: {
    id: string;
    title: string;
    status: string;
    sort_order: number;
    signed_at?: string;
    documents: { name: string; content_json: any; status: string } | null;
  }[];
};

export default function SignPage() {
  return (
    <ToastProvider>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <SignContent />
      </Suspense>
    </ToastProvider>
  );
}

function SignContent() {
  usePrintIsolation();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [pkg, setPkg] = useState<PackageData | null>(null);
  const [activeItem, setActiveItem] = useState<number>(0);
  const [signMode, setSignMode] = useState<"draw" | "saved" | null>(null);
  const [signing, setSigning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [savedSignature, setSavedSignature] = useState<{ type: string; data: string } | null>(null);
  // 2026-05-28 본문 라디오/조건부 텍스트 토큰 입력값 — fieldKey -> 입력 문자열
  const [signerInputs, setSignerInputs] = useState<Record<string, string>>({});

  // Canvas ref for drawing (high-quality signature pad)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  // Stroke state: current stroke points + history of completed strokes for undo / emptiness detection
  const currentStroke = useRef<Array<{ x: number; y: number; t: number }>>([]);
  const strokes = useRef<Array<Array<{ x: number; y: number; t: number }>>>([]);
  const lastWidth = useRef<number>(2);
  const [hasInk, setHasInk] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  // Initialize canvas with devicePixelRatio scaling for crisp retina rendering
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.fillStyle = "#0f172a";
  }, []);

  // Redraw all completed strokes (used after undo)
  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    strokes.current.forEach((stroke) => renderStroke(ctx, stroke));
    setHasInk(strokes.current.length > 0);
    void dpr;
    void rect;
  }, []);

  // Render one stroke with velocity-based variable line width + quadratic smoothing
  function renderStroke(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number; t: number }>) {
    if (pts.length === 0) return;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 1.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    let prevWidth = 2.4;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = Math.max(1, p1.t - p0.t);
      const velocity = dist / dt;
      // Slower = thicker, faster = thinner
      const targetWidth = Math.max(1.1, Math.min(3.4, 3.4 - velocity * 12));
      const width = prevWidth + (targetWidth - prevWidth) * 0.35;
      prevWidth = width;

      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;

      ctx.lineWidth = width;
      ctx.beginPath();
      if (i === 1) {
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(midX, midY);
      } else {
        const p_1 = pts[i - 2];
        const prevMidX = (p_1.x + p0.x) / 2;
        const prevMidY = (p_1.y + p0.y) / 2;
        ctx.moveTo(prevMidX, prevMidY);
        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
      }
      ctx.stroke();
    }
  }

  useEffect(() => {
    if (signMode !== "draw") return;
    // Wait a tick for the canvas to mount
    const id = requestAnimationFrame(() => {
      setupCanvas();
      redrawAll();
    });
    const onResize = () => {
      setupCanvas();
      redrawAll();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
    };
  }, [signMode, setupCanvas, redrawAll]);
  void lastWidth;

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }

    loadPackage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadPackage() {
    try {
      // Get package by sign_token
      const { data: p } = await db
        .from("hr_contract_packages")
        .select("*, employees(name, email, department, position, birth_date), companies(name, seal_url, representative, business_number)")
        .eq("sign_token", token)
        .maybeSingle();

      if (!p) {
        // Fallback: check general document signature_requests
        //   2026-05-22 anon RLS 우회 — signature_requests SELECT 가 authenticated 전용이라
        //   외부 수신자(비로그인)는 직접 조회 시 "유효하지 않은 링크" 가 됨.
        //   sign_token 검증 SECURITY DEFINER RPC 로 행+문서 반환 (token = secret).
        const { data: sigReq } = await db.rpc("get_signature_request_by_token", { p_token: token });

        if (sigReq) {
          const expired = sigReq.expires_at ? new Date(sigReq.expires_at) < new Date() : false;
          // 2026-05-21: anon RLS 우회 — SECURITY DEFINER RPC 로 company + partner 한 번에 조회.
          //   sign_token 검증 후 안전하게 갑/을 컨텍스트 반환.
          //   기존 partners RLS = company_id = get_my_company_id() 가 anon 차단해 표시 단 치환 불가했던 회귀 정공 fix.
          const { data: ctx } = await db.rpc('get_signature_context_by_token', { p_sign_token: token });
          const company = ctx?.company || null;
          const partner = ctx?.partner || null;

          // 본문 — 발송 시점에 저장한 snapshot(template_snapshot_html) 우선 사용.
          //   2026-06-17 snapshot 에는 발송자가 입력한 공통변수(날짜 등)·직인이 그대로 박혀 있음.
          //   라이브 재렌더(fillBody)는 공통변수가 없어 날짜 토큰이 오늘로 바뀌던 버그 → snapshot 으로 일원화.
          //   snapshot 없는 레거시 요청만 fillBody 폴백(회사·거래처 데이터로 치환).
          const fillBody = (body: unknown): unknown => {
            if (typeof body !== "string") return body;
            const replacements = buildPartnerReplacements(company, partner);
            return applyTokenReplacements(body, replacements);
          };
          const snapshotHtml = (sigReq as any).template_snapshot_html;
          const effectiveBody = (typeof snapshotHtml === "string" && snapshotHtml.trim())
            ? snapshotHtml
            : fillBody(sigReq.documents?.content_json?.body);
          const filledContentJson = sigReq.documents?.content_json
            ? { ...sigReq.documents.content_json, body: effectiveBody }
            : sigReq.documents?.content_json;
          const filledDocuments = sigReq.documents
            ? { ...sigReq.documents, content_json: filledContentJson }
            : sigReq.documents;

          // 2026-05-28 옛 서명 — DB 에 저장된 signer_inputs 복원 (서명본 모달·완료화면 합성용)
          if (sigReq.signer_inputs && typeof sigReq.signer_inputs === 'object') {
            try { setSignerInputs(sigReq.signer_inputs as Record<string, string>); } catch { /* noop */ }
          }

          setPkg({
            id: sigReq.id,
            title: sigReq.title,
            status: sigReq.status,
            expired,
            companies: company || { name: "" },
            employees: { name: sigReq.signer_name, email: sigReq.signer_email, department: "", position: "" },
            // 갑 직인 — ctx.company.seal_url (거래처 서명 완료 화면 갑 박스 직인 표시)
            seal_url: company?.seal_url || null,
            // 을(거래처) 회사정보 — partner 있으면 footer 가 회사 구조(회사명/사업자번호/대표자)로 분기
            contract_meta: partner
              ? {
                  "을_회사명": String(partner.name || ""),
                  "을_사업자번호": String(partner.business_number || ""),
                  "을_대표자": String(partner.representative || ""),
                }
              : null,
            items: filledDocuments ? [{ id: sigReq.id, title: filledDocuments.name || sigReq.title, status: sigReq.status === 'signed' ? 'signed' : 'pending', documents: filledDocuments, sort_order: 0 }] : [],
            _isGeneralDoc: true,
            _signatureRequestId: sigReq.id,
          } as any);
          // Mark as viewed — anon RLS 우회 SECDEF RPC (실패해도 비차단)
          if (sigReq.status === 'sent') {
            try { await db.rpc("mark_signature_viewed_by_token", { p_token: token }); } catch { /* 비차단 */ }
          }
          setLoading(false);
          return;
        }

        setInvalid(true);
        setLoading(false);
        return;
      }

      // Check expiration
      const expired = p.expires_at ? new Date(p.expires_at) < new Date() : false;

      // Get items
      const { data: items } = await db
        .from("hr_contract_package_items")
        .select("*, documents(name, content_json, status)")
        .eq("package_id", p.id)
        .order("sort_order");

      // notes JSON 파싱 — seal_applied_at, seal_url, contract_meta(Step 3 입력값) 추출
      let sealUrl: string | null = null;
      let sealAppliedAt: string | null = null;
      let sealCompanyName: string | null = null;
      let contractMeta: Record<string, string> | null = null;
      if (p.notes) {
        try {
          const parsed = JSON.parse(p.notes);
          if (typeof parsed === 'object' && parsed) {
            sealUrl = parsed.seal_url || null;
            sealAppliedAt = parsed.seal_applied_at || null;
            sealCompanyName = parsed.seal_company_name || null;
            if (parsed.contract_meta && typeof parsed.contract_meta === 'object') {
              contractMeta = parsed.contract_meta as Record<string, string>;
            }
          }
        } catch { /* notes not JSON */ }
      }
      // 2026-05-26 갑 직인 fallback — notes.seal_url 누락 시 회사 등록 직인(companies.seal_url) 사용.
      //   sealAppliedAt 도 없으면 발송 시각(sent_at)/현재로 채워 푸터가 직인 img 를 렌더하게.
      const companySeal = (p.companies as any)?.seal_url || null;
      if (!sealUrl && companySeal) {
        sealUrl = companySeal;
        sealAppliedAt = sealAppliedAt || p.sent_at || p.created_at || new Date().toISOString();
      }
      setPkg({ ...p, expired, items: items || [], seal_url: sealUrl, seal_applied_at: sealAppliedAt, seal_company_name: sealCompanyName, contract_meta: contractMeta });

      // Load saved signature from employee
      if (p.employee_id) {
        const { data: emp } = await db
          .from("employees")
          .select("saved_signature")
          .eq("id", p.employee_id)
          .maybeSingle();
        if (emp?.saved_signature) {
          setSavedSignature(emp.saved_signature);
        }
      }

      // Check if already completed
      if (p.status === "completed") {
        setCompleted(true);
      }

      // Find first unsigned item
      const firstUnsigned = (items || []).findIndex(
        (i: any) => i.status === "pending"
      );
      if (firstUnsigned >= 0) setActiveItem(firstUnsigned);

      setLoading(false);

      // Audit: document_opened
      try {
        logAuditTrail(p.id, {
          action: 'document_opened',
          timestamp: new Date().toISOString(),
          actor: p.employees?.name || 'unknown',
          userAgent: navigator.userAgent,
          details: `서명 페이지 접속`,
        });
      } catch (e) {
        console.error('Audit log error:', e);
      }
    } catch {
      setInvalid(true);
      setLoading(false);
    }
  }

  // Canvas drawing handlers (high-quality smooth signature pad)
  const getPoint = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top, t: performance.now() };
  };

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if ("touches" in e) e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    isDrawing.current = true;
    currentStroke.current = [getPoint(e)];
  }, []);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current) return;
    if ("touches" in e) e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pt = getPoint(e);
    const stroke = currentStroke.current;
    // Skip points too close together to prevent jitter
    const last = stroke[stroke.length - 1];
    if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.8) return;
    stroke.push(pt);

    // Incremental render: just the last segment
    if (stroke.length >= 2) {
      const i = stroke.length - 1;
      const p0 = stroke[i - 1];
      const p1 = stroke[i];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = Math.max(1, p1.t - p0.t);
      const velocity = dist / dt;
      const targetWidth = Math.max(1.1, Math.min(3.4, 3.4 - velocity * 12));
      lastWidth.current = lastWidth.current + (targetWidth - lastWidth.current) * 0.35;

      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;

      ctx.lineWidth = lastWidth.current;
      ctx.beginPath();
      if (stroke.length === 2) {
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(midX, midY);
      } else {
        const p_1 = stroke[i - 2];
        const prevMidX = (p_1.x + p0.x) / 2;
        const prevMidY = (p_1.y + p0.y) / 2;
        ctx.moveTo(prevMidX, prevMidY);
        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
      }
      ctx.stroke();
    }
    if (!hasInk) setHasInk(true);
  }, [hasInk]);

  const endDraw = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    if (currentStroke.current.length > 0) {
      strokes.current.push(currentStroke.current);
      currentStroke.current = [];
      lastWidth.current = 2.4;
    }
  }, []);

  const clearCanvas = () => {
    strokes.current = [];
    currentStroke.current = [];
    lastWidth.current = 2.4;
    setHasInk(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  };

  const undoStroke = () => {
    if (strokes.current.length === 0) return;
    strokes.current.pop();
    redrawAll();
  };

  async function handleSign() {
    if (!pkg) return;
    const item = pkg.items[activeItem];
    if (!item || item.status === "signed") return;

    let sigData: { type: "draw" | "type"; data: string };

    if (signMode === "saved" && savedSignature) {
      sigData = savedSignature as { type: "draw" | "type"; data: string };
    } else if (signMode === "draw") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (strokes.current.length === 0) {
        toast("서명을 그려주세요", "error");
        return;
      }
      sigData = { type: "draw", data: canvas.toDataURL("image/png") };
    } else {
      return;
    }

    setSigning(true);

    try {
      const isGeneralDoc = (pkg as any)._isGeneralDoc;

      if (isGeneralDoc) {
        // General document signing: update signature_requests table
        const { saveSignature } = await import("@/lib/signatures");
        // 외부(anon) 서명 — sign_token 전달로 SECDEF RPC 경로 사용 (RLS 우회).
        // 2026-05-28 본문 라디오/조건부 텍스트 입력값을 jsonb 컬럼+합성본 HTML 에 반영.
        await saveSignature(
          (pkg as any)._signatureRequestId,
          sigData,
          undefined,
          token,
          signerFields.length > 0 ? signerInputs : null,
        );
      } else {
        // HR contract package — Edge Function 으로 처리 (익명 이메일 링크도 동일 경로)
        // service role 이 RLS 우회하여 item 업데이트 + 전체 완료 시 알림까지 한 번에 수행.
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const res = await fetch(`${supabaseUrl}/functions/v1/complete-signing`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: anonKey,
          },
          body: JSON.stringify({
            signToken: token,
            itemId: item.id,
            signatureData: sigData,
            saveAsDefault: saveAsDefault && signMode !== "saved",
          }),
        });
        const respJson = await res.json().catch(() => ({}));
        if (!res.ok || respJson?.success === false || respJson?.error) {
          throw new Error(respJson?.error || `HTTP ${res.status}`);
        }
      }

      // saved_signature 는 Edge Function 에서 처리 (HR 계약). 일반 문서는 별도 처리 불필요.
      if (!isGeneralDoc && saveAsDefault && signMode !== "saved") {
        setSavedSignature(sigData);
      } else if (isGeneralDoc && saveAsDefault && signMode !== "saved" && (pkg as any).employee_id) {
        try {
          await db
            .from("employees")
            .update({ saved_signature: sigData })
            .eq("id", (pkg as any).employee_id);
          setSavedSignature(sigData);
        } catch (e) {
          console.error("Failed to save default signature:", e);
        }
      }

      // Audit: signature_submitted
      try {
        logAuditTrail(pkg.id, {
          action: sigData.type === 'draw' ? 'signature_drawn' : 'signature_typed',
          timestamp: new Date().toISOString(),
          actor: pkg.employees?.name || 'unknown',
          details: `서명 방식: ${sigData.type === 'draw' ? '직접 그리기' : '텍스트 입력'}`,
        });
      } catch (e) {
        console.error('Audit log error:', e);
      }

      // HR 계약은 Edge Function 에서 이미 documents lock + 패키지 상태 + 알림까지 처리.
      // 일반 문서만 별도 lock 필요.
      if (item.documents && isGeneralDoc && (item as any).document_id) {
        await db
          .from("documents")
          .update({ status: "locked", locked_at: new Date().toISOString() })
          .eq("id", (item as any).document_id);
      }

      // Show success feedback immediately
      toast("서명이 완료되었습니다", "success");

      // Check if all items signed
      // 2026-05-22 fix: signature_data 를 로컬 item 에 반영해야 완료 화면 서명 푸터(갑 직인·을 서명)가
      //   렌더됨. 누락 시 completed 화면에 서명 구역이 안 보였음(새로고침 전까지).
      const updatedItems = pkg.items.map((it, i) =>
        i === activeItem ? { ...it, status: "signed" as const, signed_at: new Date().toISOString(), signature_data: sigData } : it
      );
      const allSigned = updatedItems.every((it) => it.status === "signed");

      if (allSigned && isGeneralDoc) {
        // General document: show completed screen
        setPkg({ ...pkg, items: updatedItems });
        setCompleted(true);
      } else if (allSigned && !isGeneralDoc) {
        // HR 계약 — Edge Function 이 패키지 상태 + 알림 처리 완료. UI 만 갱신.
        setCompleted(true);

        // Generate and store document hash (best-effort, anon 환경에선 실패 가능)
        try {
          const packageHash = await generatePackageHash(pkg.id);
          await storeDocumentHash(pkg.id, packageHash);
        } catch (e) {
          console.error('Hash generation error:', e);
        }

        // Send completion notification email (best-effort)
        try {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const signerEmail = pkg.employees?.email || '';
          const companyName = pkg.companies?.name || '';
          if (supabaseUrl && signerEmail) {
            await fetch(`${supabaseUrl}/functions/v1/send-contract-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
              },
              body: JSON.stringify({
                to: signerEmail,
                employeeName: pkg.employees?.name || '',
                companyName,
                packageTitle: pkg.title,
                documentCount: updatedItems.length,
                signUrl: window.location.href,
                type: 'completion',
                completedAt: new Date().toISOString(),
              }),
            });
          }
        } catch (e) {
          console.error('Completion email failed:', e);
        }
      }
      // partially_signed 상태는 Edge Function 이 이미 처리.

      // Move to next unsigned item
      setPkg({ ...pkg, items: updatedItems });
      const nextUnsigned = updatedItems.findIndex((it, i) => i > activeItem && it.status === "pending");
      if (nextUnsigned >= 0) {
        setActiveItem(nextUnsigned);
        setSignMode(null);
        clearCanvas();
      }
    } catch (err: any) {
      toast("서명 처리 중 오류: " + (friendlyError(err, "알 수 없는 오류")), "error");
    } finally {
      setSigning(false);
    }
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500">계약서를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // ── Invalid ──
  if (invalid || !pkg) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
        <div className="w-full max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-[var(--danger-dim)] text-[var(--danger)] text-xl font-black flex items-center justify-center mx-auto mb-4">
            !
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">유효하지 않은 링크</h1>
          <p className="text-gray-500 text-sm">
            서명 링크가 만료되었거나 유효하지 않습니다. 담당자에게 문의해주세요.
          </p>
        </div>
      </div>
    );
  }

  // ── Expired ──
  if (pkg.expired) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
        <div className="w-full max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-[var(--warning-dim)] text-[var(--warning)] text-xl font-black flex items-center justify-center mx-auto mb-4">
            !
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">서명 기한 만료</h1>
          <p className="text-gray-500 text-sm">서명 기한이 만료되었습니다. 회사 담당자에게 재발송을 요청해주세요.</p>
        </div>
      </div>
    );
  }

  // ── Helpers for completed view ──



  // ── Completed ──
  if (completed) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10 print:hidden">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                {pkg.title}
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--success-dim)] text-[var(--success)]">
                  서명 완료
                </span>
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                서명자: {pkg.employees?.name} · 문서 {pkg.items.length}건
              </p>
            </div>
          </div>
        </header>

        <div className="max-w-3xl mx-auto px-4 py-6">
          {/* 2026-05-22 내부(/contracts/signed)와 동일하게 — 화면 HTML 그대로 print→PDF.
              .print-area 만 visible(globals.css), jsPDF text 변환 폐기. */}
          <div className="print-area">
          {/* Signed documents — inline render */}
          {pkg.items.map((item, idx) => {
            const cj: any = item.documents?.content_json;
            const sig: any = (item as any).signature_data;
            const signedAt = (item as any).signed_at;
            return (
              <div key={item.id} className="bg-white rounded-2xl border border-gray-200 p-6 md:p-8 mb-4 shadow-sm print:border-0 print:shadow-none print:rounded-none print:p-0 print:mb-8 print:break-inside-avoid">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 print:hidden">
                  <h3 className="text-sm font-bold text-gray-800">
                    문서 {idx + 1} · {item.title}
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--success-dim)] text-[var(--success)] font-semibold">
                    ✓ 서명완료
                  </span>
                </div>
                {cj?.title && (
                  <h2 className="text-xl font-bold text-center text-gray-900 mb-6 pb-4 border-b border-gray-100">
                    {cj.title}
                  </h2>
                )}
                {/* 견적서 — 수신 + 품목 표(실제 내역). body/sections 만 그리던 탓에 품목이 안 보이던 문제 수정 */}
                {cj?.header?.partnerName && (
                  <div className="text-sm text-gray-700 mb-3"><b>수신:</b> {cj.header.partnerName} 귀하</div>
                )}
                {Array.isArray(cj?.items) && cj.items.length > 0 && (
                  <div className="mb-5 overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-gray-600">
                          <th className="px-3 py-2 text-left border-b border-gray-200">품목명</th>
                          <th className="px-3 py-2 text-right border-b border-gray-200">수량</th>
                          <th className="px-3 py-2 text-right border-b border-gray-200">단가</th>
                          <th className="px-3 py-2 text-right border-b border-gray-200">공급가액</th>
                          <th className="px-3 py-2 text-right border-b border-gray-200">세액</th>
                          <th className="px-3 py-2 text-right border-b border-gray-200">합계</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cj.items.map((it: any, i: number) => {
                          const supply = Number(it.supplyAmount || it.amount || 0);
                          const tax = Number(it.taxAmount || 0);
                          return (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="px-3 py-2 text-gray-800">{it.name || "-"}</td>
                              <td className="px-3 py-2 text-right">{it.quantity ?? ""}</td>
                              <td className="px-3 py-2 text-right">{Number(it.unitPrice || 0).toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">{supply.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">{tax.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right font-semibold">{(supply + tax).toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-300 font-bold text-gray-900">
                          <td className="px-3 py-2" colSpan={3}>합계</td>
                          <td className="px-3 py-2 text-right">{cj.items.reduce((s: number, it: any) => s + Number(it.supplyAmount || it.amount || 0), 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right">{cj.items.reduce((s: number, it: any) => s + Number(it.taxAmount || 0), 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right">₩{cj.items.reduce((s: number, it: any) => s + Number(it.supplyAmount || it.amount || 0) + Number(it.taxAmount || 0), 0).toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                {cj?.sections?.map((section: any, i: number) => {
                  const heading = section.heading || section.title;
                  const bodyText = String(section.body || section.content || "").replace(/\[품목\s?테이블\][\s\S]*?(?=\n\n|$)/g, "").trim();
                  if (!heading && !bodyText) return null;
                  return (
                    <div key={i} className="mb-5">
                      {heading && <h4 className="text-sm font-bold text-gray-800 mb-2">{heading}</h4>}
                      {bodyText && <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{bodyText}</p>}
                    </div>
                  );
                })}
                {(!Array.isArray(cj?.sections) || cj.sections.length === 0) && cj?.body && (
                  /^\s*</.test(String(cj.body)) ? (
                    <div className="text-sm sm:text-[15px] text-gray-700 leading-relaxed prose prose-sm sm:prose-base max-w-none overflow-x-auto" dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(injectContractInlineStyles(applySignerInputsToHtml(stripSignatureBlock(String(cj.body)), signerInputs))) }} />
                  ) : (
                    <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                      {stripSignatureBlock(String(cj.body))}
                    </div>
                  )
                )}
                {/* Flex 스타일 서명/직인 푸터 */}
                {sig && signedAt && (
                  <ContractSignatureFooter
                    contractDate={pkg.contract_meta?.["계약일"] || pkg.contract_meta?.["contract_date"] || signedAt}
                    companyName={pkg.seal_company_name || pkg.companies?.name || ''}
                    businessNumber={pkg.companies?.business_number}
                    representative={pkg.companies?.representative || ''}
                    sealUrl={pkg.seal_url}
                    sealAppliedAt={pkg.seal_applied_at}
                    employeeName={pkg.contract_meta?.["구성원 이름"] || pkg.contract_meta?.["직원명"] || pkg.employees?.name}
                    birthDate={pkg.contract_meta?.["생년월일"] || pkg.contract_meta?.["birth_date"] || (pkg.employees as any)?.birth_date}
                    signerCompanyName={pkg.contract_meta?.["을_회사명"] || pkg.contract_meta?.["거래처명"] || pkg.contract_meta?.["거래처 회사명"] || undefined}
                    signerBusinessNumber={pkg.contract_meta?.["을_사업자번호"] || pkg.contract_meta?.["을_사업자등록번호"] || pkg.contract_meta?.["거래처 사업자번호"]}
                    signerRepresentative={pkg.contract_meta?.["을_대표자"] || pkg.contract_meta?.["거래처 대표자"]}
                    signature={sig as { type: 'draw' | 'type'; data: string }}
                  />
                )}
              </div>
            );
          })}
          </div>

          {/* Signed document PDF download — 내부와 동일하게 화면 HTML 인쇄→PDF */}
          <button
            onClick={() => window.print()}
            className="mt-3 w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2 print:hidden"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            🖨 인쇄 / PDF 저장
          </button>

        </div>

        <style jsx global>{`
          @media print {
            body { background: white !important; }
            @page { margin: 18mm; }
          }
        `}</style>
      </div>
    );
  }

  // ── Main Signing UI ──
  const currentItem = pkg.items[activeItem];
  const signedCount = pkg.items.filter((i) => i.status === "signed").length;
  const content = currentItem?.documents?.content_json;

  // 2026-05-28 본문 토큰 파싱 — 라디오/조건부 텍스트 필드 추출.
  //   sections 가 있으면 합쳐 검사, 없으면 body 단독.
  const bodySrc: string = (() => {
    if (!content) return '';
    if (Array.isArray(content.sections) && content.sections.length > 0) {
      return content.sections.map((s: any) => `${s.heading || ''}\n${s.body || ''}`).join('\n');
    }
    return typeof content.body === 'string' ? content.body : '';
  })();
  const { fields: signerFields } = parseSiyanFields(bodySrc);
  const inputsValidation = validateInputs(signerFields, signerInputs);
  const hasSignerInputs = signerFields.length > 0;
  const inputsOk = inputsValidation.ok;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">{pkg.title}</h1>
            <p className="text-xs text-gray-500">
              {pkg.employees?.name} ({pkg.employees?.department || ""})
            </p>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--info-dim)] text-[var(--info)]">
              {signedCount}/{pkg.items.length} 완료
            </span>
          </div>
        </div>
      </header>

      {/* Document Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 flex gap-1 overflow-x-auto py-2">
          {pkg.items.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveItem(idx);
                setSignMode(null);
                // Audit: document_viewed
                try {
                  logAuditTrail(pkg.id, {
                    action: 'document_viewed',
                    timestamp: new Date().toISOString(),
                    actor: pkg.employees?.name || 'unknown',
                    details: `문서 확인: ${item.title}`,
                  });
                } catch (e) {
                  console.error('Audit log error:', e);
                }
              }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                idx === activeItem
                  ? "bg-blue-600 text-white"
                  : item.status === "signed"
                  ? "bg-[var(--success-dim)] text-[var(--success)]"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {item.status === "signed" && "✓ "}
              {item.title}
            </button>
          ))}
        </div>
      </div>

      {/* Document Content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {currentItem?.status === "signed" ? (
          <div className="bg-white rounded-2xl border border-[var(--success)]/30 p-6 md:p-8 shadow-sm">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
              <div className="w-8 h-8 rounded-full bg-[var(--success-dim)] flex items-center justify-center">
                <svg className="w-4 h-4 text-[var(--success)]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-[var(--success)]">서명 완료</span>
              <span className="text-[10px] text-gray-400 ml-auto">
                {currentItem.signed_at ? new Date(currentItem.signed_at).toLocaleString("ko-KR") : "-"}
              </span>
            </div>
            {content?.title && (
              <h2 className="text-xl font-bold text-center text-gray-900 mb-6 pb-4 border-b border-gray-100">
                {content.title}
              </h2>
            )}
            {content?.sections?.map((section: any, i: number) => (
              <div key={i} className="mb-5">
                {section.heading && (
                  <h3 className="text-sm font-bold text-gray-800 mb-2">{section.heading}</h3>
                )}
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {section.body}
                </p>
              </div>
            ))}
            {(!Array.isArray(content?.sections) || content.sections.length === 0) && content?.body && (
              /^\s*</.test(String(content.body)) ? (
                // 서명 완료 상태 — 저장된 signer_inputs 로 ☑/☐ 정적 합성(편집 불가).
                <div className="text-sm sm:text-[15px] text-gray-700 leading-relaxed prose prose-sm sm:prose-base max-w-none overflow-x-auto" dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(injectContractInlineStyles(applySignerInputsToHtml(stripSignatureBlock(String(content.body)), signerInputs))) }} />
              ) : (
                <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {stripSignatureBlock(String(content.body))}
                </div>
              )
            )}
            {/* Flex 스타일 서명 푸터 */}
            {(currentItem as any).signature_data && (
              <ContractSignatureFooter
                contractDate={pkg.contract_meta?.["계약일"] || pkg.contract_meta?.["contract_date"] || (currentItem as any).signed_at}
                companyName={pkg.seal_company_name || pkg.companies?.name || ''}
                representative={pkg.companies?.representative || ''}
                sealUrl={pkg.seal_url}
                sealAppliedAt={pkg.seal_applied_at}
                employeeName={pkg.contract_meta?.["구성원 이름"] || pkg.contract_meta?.["직원명"] || pkg.employees?.name}
                birthDate={pkg.contract_meta?.["생년월일"] || pkg.contract_meta?.["birth_date"] || (pkg.employees as any)?.birth_date}
                signature={(currentItem as any).signature_data}
              />
            )}
          </div>
        ) : (
          <>
            {/* Document body */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 md:p-8 mb-6 shadow-sm">
              {content?.title && (
                <h2 className="text-xl font-bold text-center text-gray-900 mb-6 pb-4 border-b border-gray-100">
                  {content.title}
                </h2>
              )}
              {content?.sections?.map((section: any, i: number) => (
                <div key={i} className="mb-5">
                  {section.heading && (
                    <h3 className="text-sm font-bold text-gray-800 mb-2">{section.heading}</h3>
                  )}
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {section.body}
                  </p>
                </div>
              ))}
              {/* Built-in 템플릿은 sections 가 아닌 단일 body 텍스트 — fallback 렌더.
                  2026-05-21: sections:[] (빈 배열, truthy) 회귀 fix — Array.length 명시 검사. */}
              {(!Array.isArray(content?.sections) || content.sections.length === 0) && content?.body && (
                /^\s*</.test(String(content.body)) ? (
                  // 라이브 서명 화면 — html-react-parser 로 본문을 React tree 로 변환.
                  // 토큰({{?라디오:...}}/{{?텍스트:...}}) 자리에 RadioInline/TextInline 직접 mount.
                  // 토큰 없는 일반 서식도 parse() 결과는 동일(라이브러리 자동 재구성).
                  <div className="text-sm sm:text-[15px] text-gray-700 leading-relaxed prose prose-sm sm:prose-base max-w-none overflow-x-auto">
                    {renderSignerBody(stripSignatureBlock(String(content.body)), signerInputs, setSignerInputs)}
                  </div>
                ) : (
                  <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {stripSignatureBlock(String(content.body))}
                  </div>
                )
              )}
              {(!Array.isArray(content?.sections) || content.sections.length === 0) && !content?.body && (
                <div className="text-center text-gray-400 text-sm py-8">
                  문서 내용을 불러올 수 없습니다 — 관리자에게 문의해주세요.
                </div>
              )}
            </div>

            {/* 2026-05-28 서명자 입력 — 본문 토큰 자리에 인라인 렌더(html-react-parser).
                별도 입력 카드 제거. 미입력 항목만 작은 알림 바로 표시(서명 완료 가드). */}
            {hasSignerInputs && !inputsOk && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-[var(--warning-dim)] border border-[var(--warning)]/25 text-xs text-[var(--warning)] flex items-start gap-2">
                <span className="text-base leading-none mt-0.5">⚠️</span>
                <span>
                  본문에서 <strong>{inputsValidation.missing.join(", ")}</strong> 항목을 선택·입력해 주세요.
                </span>
              </div>
            )}

            {/* Signature Area */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h3 className="text-sm font-bold text-gray-800 mb-4">서명</h3>

              {!signMode && (
                <div className="space-y-3">
                  {/* 저장된 서명 (있을 때만) */}
                  {savedSignature && (
                    <button
                      onClick={() => setSignMode("saved")}
                      className="w-full py-4 rounded-xl border-2 border-[var(--info)]/30 bg-[var(--info-dim)] hover:border-[var(--info)] transition text-center"
                    >
                      <div className="flex items-center justify-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="text-sm font-semibold text-blue-700">저장된 서명 사용</span>
                      </div>
                      {savedSignature.type === "draw" ? (
                        <img src={savedSignature.data} alt="저장된 서명" className="h-12 mx-auto opacity-60" />
                      ) : (
                        <span className="text-xl italic text-blue-800" style={{ fontFamily: "cursive, serif" }}>{savedSignature.data}</span>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => setSignMode("draw")}
                    className="w-full py-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-[var(--info)] hover:bg-[var(--info-dim)] transition text-center"
                  >
                    <svg className="w-6 h-6 mx-auto mb-1 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                    </svg>
                    <span className="text-xs font-medium text-gray-600">직접 그리기</span>
                  </button>
                </div>
              )}

              {signMode === "saved" && savedSignature && (
                <div>
                  <div className="p-6 bg-[var(--bg-surface)] rounded-xl border-2 border-[var(--info)]/30 text-center mb-4">
                    <p className="text-xs text-gray-500 mb-2">저장된 서명</p>
                    {savedSignature.type === "draw" ? (
                      <img src={savedSignature.data} alt="서명" className="h-16 mx-auto" />
                    ) : (
                      <p className="text-3xl italic text-gray-800" style={{ fontFamily: "cursive, serif" }}>{savedSignature.data}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSignMode(null)}
                      className="px-4 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50"
                    >
                      다른 방식
                    </button>
                    <button
                      onClick={handleSign}
                      disabled={signing || !inputsOk}
                      className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
                    >
                      {signing ? "처리 중..." : "서명 완료"}
                    </button>
                  </div>
                </div>
              )}

              {signMode === "draw" && (
                <div>
                  <div className="relative border-2 border-gray-200 rounded-xl overflow-hidden mb-3 bg-white">
                    <canvas
                      ref={canvasRef}
                      className="w-full h-[180px] cursor-crosshair touch-none select-none"
                      style={{ touchAction: "none" }}
                      onMouseDown={startDraw}
                      onMouseMove={draw}
                      onMouseUp={endDraw}
                      onMouseLeave={endDraw}
                      onTouchStart={startDraw}
                      onTouchMove={draw}
                      onTouchEnd={endDraw}
                    />
                    {/* Baseline guide */}
                    <div className="pointer-events-none absolute inset-x-8 bottom-8 border-b border-dashed border-gray-200" />
                    {!hasInk && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span className="text-gray-300 text-sm">여기에 서명하세요</span>
                      </div>
                    )}
                    <div className="absolute top-2 right-2 flex gap-1">
                      <button
                        onClick={undoStroke}
                        disabled={!hasInk}
                        className="px-2 py-1 text-xs bg-white/90 hover:bg-white rounded border border-gray-200 text-gray-600 disabled:opacity-40"
                        type="button"
                      >
                        ↶ 되돌리기
                      </button>
                      <button
                        onClick={clearCanvas}
                        disabled={!hasInk}
                        className="px-2 py-1 text-xs bg-white/90 hover:bg-white rounded border border-gray-200 text-gray-600 disabled:opacity-40"
                        type="button"
                      >
                        전체 지우기
                      </button>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-500 mb-4 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={saveAsDefault}
                      onChange={(e) => setSaveAsDefault(e.target.checked)}
                      className="w-3.5 h-3.5 rounded"
                    />
                    기본 서명으로 저장 (다음 문서에서 자동 재사용)
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setSignMode(null); clearCanvas(); }}
                      className="px-4 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleSign}
                      disabled={signing || !hasInk || !inputsOk}
                      className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-40"
                    >
                      {signing ? "처리 중..." : "서명 완료"}
                    </button>
                  </div>
                </div>
              )}

            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-8">
        <div className="max-w-3xl mx-auto px-4 py-4 text-center">
          <p className="text-xs text-gray-400">OwnerView 전자서명 시스템</p>
        </div>
      </footer>
    </div>
  );
}
