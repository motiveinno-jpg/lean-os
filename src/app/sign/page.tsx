"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ToastProvider, useToast } from "@/components/toast";
import { logAuditTrail, getAuditTrail, generateAuditTrailCertificateHTML } from "@/lib/audit-trail";
import { verifyDocumentIntegrity, generatePackageHash, storeDocumentHash } from "@/lib/document-integrity";
import { generateDocumentPDF } from "@/lib/document-generator";
import { injectContractInlineStyles } from "@/lib/signatures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

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
function ContractSignatureFooter(props: {
  contractDate?: string;
  companyName?: string;
  representative?: string;
  sealUrl?: string | null;
  sealAppliedAt?: string | null;
  employeeName?: string;
  birthDate?: string;
  signature?: { type: "draw" | "type"; data: string } | null;
}) {
  const { contractDate, companyName, representative, sealUrl, sealAppliedAt, employeeName, birthDate, signature } = props;
  const fmtDate = (d?: string): string => {
    if (!d) return "";
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}년 ${m[2]}월 ${m[3]}일` : String(d);
  };
  const labelCls = "text-[11px] text-gray-500 leading-7";
  const valueCls = "text-[12px] text-gray-900 font-medium leading-7";
  return (
    <div className="mt-8 pt-6 border-t border-gray-200">
      <div className="grid grid-cols-5 gap-3 items-start">
        {/* 1. 날짜 */}
        <div className={`${valueCls} text-left pt-2`}>{fmtDate(contractDate)}</div>
        {/* 2. 회사 라벨 */}
        <div className="text-left">
          <div className={labelCls}>회사명(A)</div>
          <div className={labelCls}>직위/성명(A)</div>
          <div className={`${labelCls} mt-6`}>서명(인)</div>
        </div>
        {/* 3. 회사 값 + 직인 */}
        <div className="text-center">
          <div className={valueCls}>{companyName || ""}</div>
          <div className={valueCls}>{representative ? `대표 / ${representative}` : "—"}</div>
          <div className="mt-1 h-16 flex items-center justify-center">
            {sealUrl && sealAppliedAt ? (
              <img src={sealUrl} alt="회사 직인" className="h-16 inline-block" />
            ) : (
              <span className="text-[10px] text-gray-400">(직인 미적용)</span>
            )}
          </div>
        </div>
        {/* 4. 사원 라벨 */}
        <div className="text-left">
          <div className={labelCls}>생년월일(B)</div>
          <div className={labelCls}>성명(B)</div>
          <div className={`${labelCls} mt-6`}>서명(인)</div>
        </div>
        {/* 5. 사원 값 + 서명 */}
        <div className="text-center">
          <div className={valueCls}>{fmtDate(birthDate) || "—"}</div>
          <div className={valueCls}>{employeeName || ""}</div>
          <div className="mt-1 h-16 flex items-center justify-center">
            {signature?.type === "draw" && typeof signature.data === "string" ? (
              <img src={signature.data} alt="서명" className="h-16 inline-block" />
            ) : signature?.type === "type" ? (
              <span className="text-2xl italic text-gray-900" style={{ fontFamily: "cursive, serif" }}>{signature.data}</span>
            ) : (
              <span className="text-[10px] text-gray-400">(미서명)</span>
            )}
          </div>
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
  companies?: { name: string; seal_url?: string | null; representative?: string | null } | null;
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
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
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
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [pkg, setPkg] = useState<PackageData | null>(null);
  const [activeItem, setActiveItem] = useState<number>(0);
  const [signMode, setSignMode] = useState<"draw" | "type" | "saved" | null>(null);
  const [typedName, setTypedName] = useState("");
  const [signing, setSigning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [savedSignature, setSavedSignature] = useState<{ type: string; data: string } | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; hash: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

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
        .select("*, employees(name, email, department, position, birth_date), companies(name, seal_url, representative)")
        .eq("sign_token", token)
        .maybeSingle();

      if (!p) {
        // Fallback: check general document signature_requests
        //   2026-05-21 단체일괄 본문 치환: partner_id 도 select → 거래처별 본문 변수 치환
        const { data: sigReq } = await db
          .from("signature_requests")
          .select("*, documents(name, content_json, status, company_id)")
          .eq("sign_token", token)
          .maybeSingle();

        if (sigReq) {
          const expired = sigReq.expires_at ? new Date(sigReq.expires_at) < new Date() : false;
          // 2026-05-21: anon RLS 우회 — SECURITY DEFINER RPC 로 company + partner 한 번에 조회.
          //   sign_token 검증 후 안전하게 갑/을 컨텍스트 반환.
          //   기존 partners RLS = company_id = get_my_company_id() 가 anon 차단해 표시 단 치환 불가했던 회귀 정공 fix.
          const { data: ctx } = await db.rpc('get_signature_context_by_token', { p_sign_token: token });
          const company = ctx?.company || null;
          const partner = ctx?.partner || null;

          // 본문 변수 치환 — content_json.body 안의 토큰을 회사(갑)·거래처(을) 데이터로 채움.
          //   사용자 양식 토큰 패턴 매우 다양 ({{갑_회사명}}, {{갑}}, {{사업자등록번호}}, {{대표자명}} 등).
          //   매핑 없는 토큰은 원형 유지 (오타 발견용).
          //   주의: {{사업자등록번호}} / {{대표자명}} 처럼 갑/을 구분 없는 단독 토큰은 모호.
          //         양식 작성 시 사용자가 양쪽 다 같은 토큰 쓰면 동일 값 표시 — 정공은 {{갑_*}}/{{을_*}} 권장.
          //         단독 토큰은 partner(을) 우선 매핑 (계약서의 lead party 가 일반적으로 을).
          const fillBody = (body: unknown): unknown => {
            if (typeof body !== "string") return body;
            const c = company || {};
            const pn = partner || {};
            const replacements: Record<string, string> = {
              // ─── 갑 (우리 회사) — 명시 접두사 ───
              "갑_회사명": String(c.name || ""),
              "갑_사업자번호": String(c.business_number || ""),
              "갑_대표자": String(c.representative || ""),
              "갑_주소": String(c.address || ""),
              "company_name": String(c.name || ""),
              // ─── 을 (거래처) — 명시 접두사 ───
              "을_회사명": String(pn.name || ""),
              "을_단체명": String(pn.name || ""),
              "을_사업자번호": String(pn.business_number || ""),
              "을_대표자": String(pn.representative || ""),
              "을_담당자": String(pn.contact_name || ""),
              "을_이메일": String(pn.contact_email || ""),
              "을_연락처": String(pn.contact_phone || ""),
              "을_전화": String(pn.contact_phone || ""),
              "을_주소": String(pn.address || ""),
              "partner_name": String(pn.name || ""),
              // ─── 단독 토큰 (사용자 자유 양식) ───
              "갑": String(c.name || ""),
              "을": String(pn.name || ""),
              // 갑/을 구분 없는 단독 토큰 — 을(거래처) 우선 매핑
              "회사명": String(pn.name || ""),
              "단체명": String(pn.name || ""),
              "사업자등록번호": String(pn.business_number || c.business_number || ""),
              "사업자번호": String(pn.business_number || c.business_number || ""),
              "대표자명": String(pn.representative || c.representative || ""),
              "대표자": String(pn.representative || c.representative || ""),
              "주소": String(pn.address || c.address || ""),
              "담당자": String(pn.contact_name || ""),
              "이메일": String(pn.contact_email || ""),
              "연락처": String(pn.contact_phone || ""),
              "전화": String(pn.contact_phone || ""),
              "전화번호": String(pn.contact_phone || ""),
              // 공통값
              "날짜": new Date().toLocaleDateString('ko-KR'),
              "오늘": new Date().toLocaleDateString('ko-KR'),
              "계약일": new Date().toLocaleDateString('ko-KR'),
            };
            return body.replace(/\{\{?\s*([^}{\s]+?)\s*\}\}?/g, (full, key: string) => {
              const k = String(key).trim();
              if (k in replacements) return replacements[k];
              return full; // 매핑 없는 토큰(예: {{계약금액}}) 은 원형 유지
            });
          };
          const filledContentJson = sigReq.documents?.content_json
            ? { ...sigReq.documents.content_json, body: fillBody(sigReq.documents.content_json.body) }
            : sigReq.documents?.content_json;
          const filledDocuments = sigReq.documents
            ? { ...sigReq.documents, content_json: filledContentJson }
            : sigReq.documents;

          setPkg({
            id: sigReq.id,
            title: sigReq.title,
            status: sigReq.status,
            expired,
            companies: company || { name: "" },
            employees: { name: sigReq.signer_name, email: sigReq.signer_email, department: "", position: "" },
            items: filledDocuments ? [{ id: sigReq.id, title: filledDocuments.name || sigReq.title, status: sigReq.status === 'signed' ? 'signed' : 'pending', documents: filledDocuments, sort_order: 0 }] : [],
            _isGeneralDoc: true,
            _signatureRequestId: sigReq.id,
          } as any);
          // Mark as viewed
          if (sigReq.status === 'sent') {
            await db.from("signature_requests").update({ status: "viewed", viewed_at: new Date().toISOString() }).eq("id", sigReq.id);
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
    } else if (signMode === "type") {
      if (!typedName.trim()) return;
      sigData = { type: "type", data: typedName.trim() };
    } else {
      return;
    }

    setSigning(true);

    try {
      const isGeneralDoc = (pkg as any)._isGeneralDoc;

      if (isGeneralDoc) {
        // General document signing: update signature_requests table
        const { saveSignature } = await import("@/lib/signatures");
        await saveSignature((pkg as any)._signatureRequestId, sigData);
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
      if (item.documents && isGeneralDoc) {
        await db
          .from("documents")
          .update({ status: "locked", locked_at: new Date().toISOString() })
          .eq("id", (item as any).document_id);
      }

      // Show success feedback immediately
      toast("서명이 완료되었습니다", "success");

      // Check if all items signed
      const updatedItems = pkg.items.map((it, i) =>
        i === activeItem ? { ...it, status: "signed" as const, signed_at: new Date().toISOString() } : it
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
        setTypedName("");
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
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
          <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 text-xl font-black flex items-center justify-center mx-auto mb-4">
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
          <div className="w-14 h-14 rounded-2xl bg-yellow-50 text-yellow-600 text-xl font-black flex items-center justify-center mx-auto mb-4">
            !
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">서명 기한 만료</h1>
          <p className="text-gray-500 text-sm">서명 기한이 만료되었습니다. 회사 담당자에게 재발송을 요청해주세요.</p>
        </div>
      </div>
    );
  }

  // ── Helpers for completed view ──
  async function handleViewAuditTrail() {
    if (!pkg) return;
    try {
      const auditEntries = await getAuditTrail(pkg.id);
      // Extract hash from notes
      let packageHash = 'N/A';
      if (pkg.notes) {
        try {
          const meta = JSON.parse(pkg.notes);
          packageHash = meta.document_hash || 'N/A';
        } catch { /* ignore */ }
      }
      // Re-fetch notes to get latest hash
      try {
        const { data: freshPkg } = await db
          .from("hr_contract_packages")
          .select("notes")
          .eq("id", pkg.id)
          .maybeSingle();
        if (freshPkg?.notes) {
          const meta = JSON.parse(freshPkg.notes);
          if (meta.document_hash) packageHash = meta.document_hash;
        }
      } catch { /* ignore */ }

      const html = generateAuditTrailCertificateHTML({
        packageTitle: pkg.title,
        companyName: pkg.companies?.name || '',
        employeeName: pkg.employees?.name || '',
        signerEmail: pkg.employees?.email || '',
        documentNames: pkg.items.map((i) => i.title),
        auditEntries,
        documentHash: packageHash,
      });
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); }
    } catch (e) {
      console.error('Audit trail error:', e);
      toast('감사추적인증서를 불러오는 중 오류가 발생했습니다.', "error");
    }
  }

  async function handleDownloadSignedPDF() {
    if (!pkg) return;
    try {
      // Gather all document sections into a single text content
      const allSections: string[] = [];
      const signatures: Array<{
        signerName: string;
        signatureType: 'draw' | 'type';
        signatureData: string;
        signedAt: string;
        documentTitle?: string;
      }> = [];

      for (const item of pkg.items) {
        const doc = item.documents;
        if (!doc?.content_json) continue;
        const cj = doc.content_json;
        if (cj.title) allSections.push(cj.title);
        if (cj.sections) {
          for (const sec of cj.sections) {
            if (sec.heading) allSections.push(`\n${sec.heading}`);
            if (sec.body) allSections.push(sec.body);
          }
        } else if (cj.body) {
          // Built-in/사용자 편집 템플릿: 단일 body — HTML 이면 plain text 로 변환 + 서명 블록 strip
          allSections.push(`\n${item.title || ''}`);
          let bodyText = String(cj.body);
          if (/^\s*</.test(bodyText)) {
            // HTML → text (브라우저 DOM 으로 안전하게 변환)
            const tmp = document.createElement('div');
            tmp.innerHTML = bodyText;
            bodyText = tmp.textContent || tmp.innerText || '';
          }
          // 본문 끝의 서명 placeholder 블록 제거 (footer 가 따로 렌더)
          bodyText = stripSignatureBlock(bodyText);
          allSections.push(bodyText);
        }
        allSections.push(''); // blank line between documents

        // 서명 정보 수집
        const sig: any = (item as any).signature_data;
        const signedAt = (item as any).signed_at;
        if (sig && signedAt && (sig.type === 'draw' || sig.type === 'type')) {
          signatures.push({
            signerName: pkg.employees?.name || '',
            signatureType: sig.type,
            signatureData: sig.data,
            signedAt,
            documentTitle: item.title,
          });
        }
      }

      const blob = await generateDocumentPDF({
        title: pkg.title,
        content: allSections.join('\n'),
        companyName: pkg.companies?.name || '',
        companyInfo: { representative: pkg.companies?.representative || undefined },
        signerBirthDate:
          pkg.contract_meta?.["생년월일"]
          || pkg.contract_meta?.["birth_date"]
          || (pkg.employees as any)?.birth_date,
        signatures,
        // 직인이 적용된 패키지면 PDF 우측 하단에 도장 오버레이
        sealUrl: pkg.seal_applied_at && pkg.seal_url ? pkg.seal_url : undefined,
        applyStamp: !!(pkg.seal_applied_at && pkg.seal_url),
      });

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pkg.title || '서명완료문서'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('PDF generation error:', e);
      toast('PDF 생성 중 오류가 발생했습니다.', 'error');
    }
  }

  async function handleVerifyIntegrity() {
    if (!pkg) return;
    setVerifying(true);
    try {
      const result = await verifyDocumentIntegrity(pkg.id);
      setVerifyResult({ valid: result.valid, hash: result.storedHash });
    } catch (e: any) {
      console.error('Integrity check error:', e);
      setVerifyResult({ valid: false, hash: e.message || '검증 실패' });
    } finally {
      setVerifying(false);
    }
  }

  // ── Completed ──
  if (completed) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                {pkg.title}
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700">
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
          {/* Signed documents — inline render */}
          {pkg.items.map((item, idx) => {
            const cj: any = item.documents?.content_json;
            const sig: any = (item as any).signature_data;
            const signedAt = (item as any).signed_at;
            return (
              <div key={item.id} className="bg-white rounded-2xl border border-gray-200 p-6 md:p-8 mb-4 shadow-sm">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                  <h3 className="text-sm font-bold text-gray-800">
                    문서 {idx + 1} · {item.title}
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-semibold">
                    ✓ 서명완료
                  </span>
                </div>
                {cj?.title && (
                  <h2 className="text-xl font-bold text-center text-gray-900 mb-6 pb-4 border-b border-gray-100">
                    {cj.title}
                  </h2>
                )}
                {cj?.sections?.map((section: any, i: number) => (
                  <div key={i} className="mb-5">
                    {section.heading && (
                      <h4 className="text-sm font-bold text-gray-800 mb-2">{section.heading}</h4>
                    )}
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                      {section.body}
                    </p>
                  </div>
                ))}
                {(!Array.isArray(cj?.sections) || cj.sections.length === 0) && cj?.body && (
                  /^\s*</.test(String(cj.body)) ? (
                    <div className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: injectContractInlineStyles(stripSignatureBlock(String(cj.body))) }} />
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
                    representative={pkg.companies?.representative || ''}
                    sealUrl={pkg.seal_url}
                    sealAppliedAt={pkg.seal_applied_at}
                    employeeName={pkg.contract_meta?.["구성원 이름"] || pkg.contract_meta?.["직원명"] || pkg.employees?.name}
                    birthDate={pkg.contract_meta?.["생년월일"] || pkg.contract_meta?.["birth_date"] || (pkg.employees as any)?.birth_date}
                    signature={sig as { type: 'draw' | 'type'; data: string }}
                  />
                )}
              </div>
            );
          })}

          {/* Audit trail certificate button */}
          <button
            onClick={handleViewAuditTrail}
            className="mt-4 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            감사추적인증서 보기
          </button>

          {/* Signed document PDF download */}
          <button
            onClick={handleDownloadSignedPDF}
            className="mt-3 w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            서명된 계약서 PDF 다운로드
          </button>

          {/* Document integrity verification */}
          <div className="mt-4 p-4 bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">문서 무결성 검증</p>
              <button
                onClick={handleVerifyIntegrity}
                disabled={verifying}
                className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition disabled:opacity-50"
              >
                {verifying ? '검증 중...' : '검증하기'}
              </button>
            </div>
            {verifyResult && (
              <div className="mt-3">
                {verifyResult.valid ? (
                  <div className="flex items-start gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
                    <span className="text-green-600 mt-0.5">&#10003;</span>
                    <div>
                      <p className="text-sm font-medium text-green-700">문서가 서명 후 변경되지 않았습니다</p>
                      <p className="text-xs text-green-600/70 mt-1 font-mono break-all">SHA-256: {verifyResult.hash}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
                    <span className="text-red-600 mt-0.5">&#10007;</span>
                    <div>
                      <p className="text-sm font-medium text-red-700">문서가 변경된 것으로 감지됩니다</p>
                      <p className="text-xs text-red-600/70 mt-1 font-mono break-all">{verifyResult.hash}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main Signing UI ──
  const currentItem = pkg.items[activeItem];
  const signedCount = pkg.items.filter((i) => i.status === "signed").length;
  const content = currentItem?.documents?.content_json;

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
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
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
                  ? "bg-green-50 text-green-700"
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
          <div className="bg-white rounded-2xl border border-green-200 p-6 md:p-8 shadow-sm">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-green-700">서명 완료</span>
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
                <div className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: injectContractInlineStyles(stripSignatureBlock(String(content.body))) }} />
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
                  <div className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: injectContractInlineStyles(stripSignatureBlock(String(content.body))) }} />
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

            {/* Signature Area */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h3 className="text-sm font-bold text-gray-800 mb-4">서명</h3>

              {!signMode && (
                <div className="space-y-3">
                  {/* 저장된 서명 (있을 때만) */}
                  {savedSignature && (
                    <button
                      onClick={() => setSignMode("saved")}
                      className="w-full py-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:border-blue-400 transition text-center"
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
                  <div className="flex gap-3">
                    <button
                      onClick={() => setSignMode("draw")}
                      className="flex-1 py-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition text-center"
                    >
                      <svg className="w-6 h-6 mx-auto mb-1 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                      </svg>
                      <span className="text-xs font-medium text-gray-600">직접 그리기</span>
                    </button>
                    <button
                      onClick={() => setSignMode("type")}
                      className="flex-1 py-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition text-center"
                    >
                      <svg className="w-6 h-6 mx-auto mb-1 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                      </svg>
                      <span className="text-xs font-medium text-gray-600">텍스트 입력</span>
                    </button>
                  </div>
                </div>
              )}

              {signMode === "saved" && savedSignature && (
                <div>
                  <div className="p-6 bg-gray-50 rounded-xl border-2 border-blue-200 text-center mb-4">
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
                      disabled={signing}
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
                      disabled={signing || !hasInk}
                      className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-40"
                    >
                      {signing ? "처리 중..." : "서명 완료"}
                    </button>
                  </div>
                </div>
              )}

              {signMode === "type" && (
                <div>
                  <input
                    type="text"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    placeholder="서명할 이름을 입력하세요"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-lg text-center mb-3 focus:outline-none focus:border-blue-500"
                    style={{ fontFamily: "cursive, serif", fontSize: "24px" }}
                  />
                  <p className="text-xs text-gray-400 mb-4">서명으로 사용할 이름을 입력하세요</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setSignMode(null); setTypedName(""); }}
                      className="px-4 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleSign}
                      disabled={signing || !typedName.trim()}
                      className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
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
