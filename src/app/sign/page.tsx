"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logAuditTrail, getAuditTrail, generateAuditTrailCertificateHTML } from "@/lib/audit-trail";
import { verifyDocumentIntegrity, generatePackageHash, storeDocumentHash } from "@/lib/document-integrity";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type PackageData = {
  id: string;
  title: string;
  status: string;
  expired: boolean;
  company_id?: string;
  employees: { name: string; email?: string; department?: string; position?: string };
  companies?: { name: string } | null;
  notes?: string;
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
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <SignContent />
    </Suspense>
  );
}

function SignContent() {
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

  // Canvas ref for drawing
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

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
        .select("*, employees(name, email, department, position), companies(name)")
        .eq("sign_token", token)
        .single();

      if (!p) {
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

      setPkg({ ...p, expired, items: items || [] });

      // Load saved signature from employee
      if (p.employee_id) {
        const { data: emp } = await db
          .from("employees")
          .select("saved_signature")
          .eq("id", p.employee_id)
          .single();
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

  // Canvas drawing handlers
  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    isDrawing.current = true;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, []);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1e293b";
    ctx.lineTo(x, y);
    ctx.stroke();
  }, []);

  const endDraw = useCallback(() => {
    isDrawing.current = false;
  }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
      sigData = { type: "draw", data: canvas.toDataURL("image/png") };
    } else if (signMode === "type") {
      if (!typedName.trim()) return;
      sigData = { type: "type", data: typedName.trim() };
    } else {
      return;
    }

    setSigning(true);

    try {
      // Update item
      await db
        .from("hr_contract_package_items")
        .update({
          status: "signed",
          signed_at: new Date().toISOString(),
          signature_data: sigData,
        })
        .eq("id", item.id);

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

      // Lock associated document
      if (item.documents) {
        await db
          .from("documents")
          .update({ status: "locked", locked_at: new Date().toISOString() })
          .eq("id", (item as any).document_id);
      }

      // Check if all items signed
      const updatedItems = pkg.items.map((it, i) =>
        i === activeItem ? { ...it, status: "signed" as const, signed_at: new Date().toISOString() } : it
      );
      const allSigned = updatedItems.every((it) => it.status === "signed");
      const someSigned = updatedItems.some((it) => it.status === "signed");

      if (allSigned) {
        await db
          .from("hr_contract_packages")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", pkg.id);
        setCompleted(true);

        // Generate and store document hash
        try {
          const packageHash = await generatePackageHash(pkg.id);
          await storeDocumentHash(pkg.id, packageHash);
        } catch (e) {
          console.error('Hash generation error:', e);
        }

        // Audit: document_completed
        try {
          await logAuditTrail(pkg.id, {
            action: 'document_completed',
            timestamp: new Date().toISOString(),
            actor: pkg.employees?.name || 'unknown',
            details: `전체 ${updatedItems.length}건 서명 완료`,
          });
        } catch (e) {
          console.error('Audit log error:', e);
        }

        // Send completion notification email
        try {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const signerEmail = pkg.employees?.email || '';
          const companyName = pkg.companies?.name || '';
          if (supabaseUrl && signerEmail) {
            await fetch(`${supabaseUrl}/functions/v1/send-contract-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
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
      } else if (someSigned) {
        await db
          .from("hr_contract_packages")
          .update({ status: "partially_signed" })
          .eq("id", pkg.id);
      }

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
      alert("서명 처리 중 오류: " + (err.message || "알 수 없는 오류"));
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
          .single();
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
      alert('감사추적인증서를 불러오는 중 오류가 발생했습니다.');
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
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
        <div className="w-full max-w-md">
          {/* Success message */}
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-extrabold text-gray-900 mb-2">서명 완료</h1>
            <p className="text-gray-600 text-sm">
              모든 문서에 서명이 완료되었습니다
            </p>
            <p className="text-gray-400 text-xs mt-1">
              서명 완료 문서와 감사추적인증서가 이메일로 발송됩니다
            </p>
          </div>

          {/* Package info */}
          <div className="mt-6 p-4 bg-white rounded-xl border border-gray-200">
            <p className="text-sm text-gray-600">{pkg.title}</p>
            <p className="text-xs text-gray-400 mt-1">
              서명자: {pkg.employees?.name} | 문서: {pkg.items.length}건
            </p>
          </div>

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
          <div className="bg-white rounded-2xl border border-green-200 p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-green-700 font-semibold">이 문서는 서명 완료되었습니다</p>
            <p className="text-xs text-gray-400 mt-1">
              서명 시각: {currentItem.signed_at ? new Date(currentItem.signed_at).toLocaleString("ko-KR") : "-"}
            </p>
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
                  <div className="relative border-2 border-gray-200 rounded-xl overflow-hidden mb-3">
                    <canvas
                      ref={canvasRef}
                      width={600}
                      height={200}
                      className="w-full h-[150px] cursor-crosshair touch-none bg-gray-50"
                      onMouseDown={startDraw}
                      onMouseMove={draw}
                      onMouseUp={endDraw}
                      onMouseLeave={endDraw}
                      onTouchStart={startDraw}
                      onTouchMove={draw}
                      onTouchEnd={endDraw}
                    />
                    <button
                      onClick={clearCanvas}
                      className="absolute top-2 right-2 px-2 py-1 text-xs bg-white/80 hover:bg-white rounded border border-gray-200 text-gray-500"
                    >
                      지우기
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mb-4">위 영역에 서명을 그려주세요</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setSignMode(null); clearCanvas(); }}
                      className="px-4 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50"
                    >
                      취소
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
