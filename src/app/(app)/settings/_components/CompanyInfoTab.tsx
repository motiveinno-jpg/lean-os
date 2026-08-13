"use client";
import { logRead } from "@/lib/log-read";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useEffect, useState, useRef, useCallback } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { appConfirm } from "@/components/global-confirm";
import { verifyBusinessNumber } from "@/lib/business-verification";
import {
  VAT_BUSINESS_TYPES, vatBusinessTypeOf, guessVatBusinessType, type VatBusinessType,
} from "@/lib/vat-business-type";
import { PermissionTree } from "../../employees/_components/PermissionTree";
import { useMyPermissions } from "@/lib/permissions";

export function CompanyInfoTab({ companyId }: { companyId: string | null }) {
  const db = supabase;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    name: "",
    business_number: "",
    representative: "",
    address: "",
    phone: "",
    business_type: "",
    business_category: "",
    capital: "",
    //   과세유형 — 무엇을 발행할 수 있는지가 여기서 갈린다 (2026-08-13). 기본은 과세.
    vat_type: "taxable" as VatBusinessType,
  });
  //   국세청 조회로 알아낸 과세유형 — 저장된 값과 다르면 "이렇게 바꿀까요"만 권한다(자동으로 안 바꾼다)
  const [vatHint, setVatHint] = useState<VatBusinessType | null>(null);
  const [sealUrl, setSealUrl] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"seal" | "logo" | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [generatingSeal, setGeneratingSeal] = useState(false);
  const [sealPreview, setSealPreview] = useState<string | null>(null);
  const [sealVariant, setSealVariant] = useState<"corporate" | "double" | "single" | "square">("corporate");
  const sealInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const { data: company, isLoading } = useQuery({
    queryKey: ["company-info", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const data = logRead('_components/CompanyInfoTab:data', await db
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .maybeSingle());
      return data;
    },
    enabled: !!companyId,
  });

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name || "",
        business_number: company.business_number || "",
        representative: company.representative || "",
        address: company.address || "",
        phone: company.phone || "",
        business_type: company.business_type || "",
        business_category: company.business_category || "",
        capital: (company.tax_settings as any)?.capital != null ? String((company.tax_settings as any).capital) : "",
        vat_type: vatBusinessTypeOf(company.tax_settings),
      });
      setSealUrl(company.seal_url || null);
      setLogoUrl(company.logo_url || null);
    }
  }, [company]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("회사 ID 없음");
      const { error } = await db
        .from("companies")
        .update({
          name: form.name,
          business_number: form.business_number || null,
          representative: form.representative || null,
          address: form.address || null,
          phone: form.phone || null,
          business_type: form.business_type || null,
          business_category: form.business_category || null,
          // 자본금 — 전용 컬럼이 없어 tax_settings(jsonb)에 저장. 재무상태표(자본금)가 읽음.
          tax_settings: {
            ...((company?.tax_settings as Record<string, unknown> | null) || {}),
            capital: form.capital ? Number(String(form.capital).replace(/[^0-9]/g, "")) : null,
            //   과세유형 — 세금계산서/계산서 발행 가능 여부를 이 값이 정한다 (발행 엣지도 같은 값을 본다)
            vat_type: form.vat_type,
          },
        })
        .eq("id", companyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-info"] });
      setSaved(true);
      toast("회사 정보가 저장되었습니다.", "success");
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: any) => {
      toast(`저장 실패: ${friendlyError(err, "알 수 없는 오류")}`, "error");
    },
  });

  const formatBusinessNumber = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  };

  // 사업자번호 국세청 자동확인 (2026-08-10 사장님 제보: 없는 번호로도 수정되던 것) — 거래처 추가와 동일 패턴.
  //   10자리 입력 시 즉시 조회해 상태 표시, 저장 시 미등록·체크섬 오류는 차단(휴폐업은 확인 후 진행).
  const [bizStatus, setBizStatus] = useState<{ status: string; loading: boolean } | null>(null);
  const onBizNoChange = (val: string) => {
    const formatted = formatBusinessNumber(val);
    setForm((f) => ({ ...f, business_number: formatted }));
    setBizStatus(null);
    setVatHint(null);
    const raw = formatted.replace(/\D/g, "");
    if (raw.length === 10) {
      setBizStatus({ status: "조회중", loading: true });
      verifyBusinessNumber(raw).then((r) => {
        setBizStatus({ status: r.valid ? r.status : "체크섬오류", loading: false });
        //   국세청이 알려 준 과세유형은 **제안까지만** — 겸영은 조회로 알 수 없어 사람이 정해야 한다
        setVatHint(guessVatBusinessType(r.taxType));
      });
    }
  };

  const handleSave = async () => {
    if (!form.name) return;
    const digits = form.business_number.replace(/\D/g, "");
    const savedDigits = (company?.business_number || "").replace(/\D/g, "");
    if (digits && digits !== savedDigits) {
      if (digits.length !== 10) { toast("사업자번호는 10자리여야 합니다.", "error"); return; }
      const r = await verifyBusinessNumber(digits);
      if (!r.valid) { toast("올바르지 않은 사업자번호입니다 (검증 실패) — 다시 확인해 주세요.", "error"); return; }
      if (r.status === "미등록") { toast("국세청에 등록되지 않은 사업자번호입니다 — 확인 후 다시 입력해 주세요.", "error"); return; }
      if (r.status === "휴업자" || r.status === "폐업자") {
        const ok = await appConfirm(`국세청 기준 ${r.status} 상태의 번호입니다. 이 번호로 저장할까요?`, { title: "사업자 상태 확인", confirmLabel: "저장" });
        if (!ok) return;
      }
      // 확인불가(API 장애)는 저장 허용 — 장애로 사장님 발이 묶이지 않게 (fail-open)
    }
    saveMut.mutate();
  };

  const handleFileUpload = useCallback(async (file: File, type: "seal" | "logo") => {
    if (!companyId) return;
    setUploadError("");

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("파일 크기는 5MB 이하여야 합니다.");
      return;
    }

    // Validate file type
    const validTypes = ["image/png", "image/jpg", "image/jpeg"];
    if (!validTypes.includes(file.type)) {
      setUploadError("PNG, JPG, JPEG 파일만 업로드 가능합니다.");
      return;
    }

    setUploading(type);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const filePath = `${companyId}/${type}_${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("company-assets")
        .upload(filePath, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from("company-assets")
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      // Update company record
      const updateField = type === "seal" ? "seal_url" : "logo_url";
      const { error: dbErr } = await db
        .from("companies")
        .update({ [updateField]: publicUrl } as never)
        .eq("id", companyId);

      if (dbErr) throw dbErr;

      if (type === "seal") setSealUrl(publicUrl);
      else setLogoUrl(publicUrl);

      queryClient.invalidateQueries({ queryKey: ["company-info"] });
    } catch (err: any) {
      setUploadError(err.message || "업로드 실패");
    } finally {
      setUploading(null);
    }
  }, [companyId, queryClient]);

  const handleRemoveFile = useCallback(async (type: "seal" | "logo") => {
    if (!companyId) return;
    const updateField = type === "seal" ? "seal_url" : "logo_url";
    await db
      .from("companies")
      .update({ [updateField]: null } as never)
      .eq("id", companyId);

    if (type === "seal") setSealUrl(null);
    else setLogoUrl(null);
    queryClient.invalidateQueries({ queryKey: ["company-info"] });
  }, [companyId, queryClient]);

  // 자동 직인 생성 — Canvas 로 PNG 만든 후 storage 업로드
  async function regenerateSealPreview(variant?: "corporate" | "double" | "single" | "square") {
    if (!form.name?.trim()) {
      setUploadError("회사명을 먼저 입력하세요.");
      return;
    }
    setUploadError("");
    try {
      const { generateCompanySealDataUrl } = await import("@/lib/seal-generator");
      const dataUrl = await generateCompanySealDataUrl(form.name, {
        variant: variant || sealVariant,
        title: "대표이사",
      });
      setSealPreview(dataUrl);
    } catch (err: any) {
      setUploadError("직인 생성 실패: " + (err?.message || ""));
    }
  }

  async function handleAutoGenerateSeal() {
    if (!companyId || !form.name?.trim()) {
      setUploadError("회사명을 먼저 입력하세요.");
      return;
    }
    setUploadError("");
    setGeneratingSeal(true);
    try {
      const { generateCompanySeal } = await import("@/lib/seal-generator");
      const blob = await generateCompanySeal(form.name, { variant: sealVariant, title: "대표이사" });
      const filePath = `${companyId}/seal_auto_${Date.now()}.png`;
      const { error: uploadErr } = await supabase.storage
        .from("company-assets")
        .upload(filePath, blob, { upsert: true, contentType: "image/png" });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage
        .from("company-assets")
        .getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;
      const { error: dbErr } = await db
        .from("companies")
        .update({ seal_url: publicUrl })
        .eq("id", companyId);
      if (dbErr) throw dbErr;
      setSealUrl(publicUrl);
      setSealPreview(null);
      queryClient.invalidateQueries({ queryKey: ["company-info"] });
    } catch (err: any) {
      setUploadError(err.message || "직인 자동 생성 실패");
    } finally {
      setGeneratingSeal(false);
    }
  }

  if (!companyId) {
    return (
      <div className="glass-card p-6">
        <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="glass-card p-6">
        <div className="text-center py-8">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <div className="text-sm text-[var(--text-muted)]">회사 정보 로딩 중...</div>
        </div>
      </div>
    );
  }

  const isNewCompany = !company || (!company.business_number && !company.representative && !company.address);

  return (
    <div className="space-y-6">
      {/* Onboarding prompt for new companies */}
      {isNewCompany && (
        <div className="company-info-onboarding-banner">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text)] mb-1">회사 정보를 설정해주세요</p>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                견적서, 세금계산서, 계약서 등 비즈니스 문서에 사용됩니다. 사업자번호와 대표자명을 먼저 입력하시면 자동 서류 생성이 가능합니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Company Basic Info — 정의형 행(좌 라벨 | 우 입력) 문법 (2026-08-13 시안 B 작업면) */}
      <div className="company-info-basic-form stg-sec">
        <div className="stg-sec-head">
          <div>
            <h2 className="stg-sec-title">기본 정보</h2>
            <p className="stg-sec-desc">견적서·세금계산서·계약서 등 공식 문서에 그대로 찍히는 값입니다.</p>
          </div>
        </div>
        <div className="stg-frow">
          <div className="stg-frow-label"><b>회사명 *</b></div>
          <div className="stg-frow-body">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="(주)모티브이노베이션"
              className="field-input"
            />
          </div>
        </div>
        <div className="stg-frow">
          <div className="stg-frow-label"><b>사업자번호</b><small>국세청에서 실시간 검증합니다</small></div>
          <div className="stg-frow-body">
            <input
              value={form.business_number}
              onChange={(e) => onBizNoChange(e.target.value)}
              placeholder="000-00-00000"
              maxLength={12}
              className="field-input"
            />
            {bizStatus && (
              <p className={`stg-frow-hint font-semibold ${
                bizStatus.loading ? "text-[var(--text-dim)]"
                  : bizStatus.status === "계속사업자" ? "text-[var(--success)]"
                  : bizStatus.status === "휴업자" || bizStatus.status === "확인불가" ? "text-[var(--warning)]"
                  : "text-[var(--danger)]"
              }`}>
                {bizStatus.loading ? "국세청 조회중..."
                  : bizStatus.status === "계속사업자" ? "✓ 정상 사업자"
                  : bizStatus.status === "휴업자" ? "휴업 상태의 번호입니다"
                  : bizStatus.status === "폐업자" ? "폐업된 번호입니다"
                  : bizStatus.status === "미등록" ? "국세청에 등록되지 않은 번호입니다 — 저장할 수 없습니다"
                  : bizStatus.status === "체크섬오류" ? "올바르지 않은 번호입니다 — 저장할 수 없습니다"
                  : "국세청 확인 불가 (일시 장애)"}
              </p>
            )}
          </div>
        </div>
        <div className="stg-frow">
          <div className="stg-frow-label"><b>대표자 · 전화번호</b></div>
          <div className="stg-frow-body flex flex-col sm:flex-row gap-2.5">
            <input
              value={form.representative}
              onChange={(e) => setForm({ ...form, representative: e.target.value })}
              placeholder="홍길동"
              className="field-input sm:!max-w-[180px]"
            />
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="02-1234-5678"
              className="field-input sm:!max-w-[220px]"
            />
          </div>
        </div>
        <div className="stg-frow">
          <div className="stg-frow-label"><b>업태 · 업종</b></div>
          <div className="stg-frow-body flex flex-col sm:flex-row gap-2.5">
            <input
              value={form.business_type}
              onChange={(e) => setForm({ ...form, business_type: e.target.value })}
              placeholder="서비스업"
              className="field-input sm:!max-w-[180px]"
            />
            <input
              value={form.business_category}
              onChange={(e) => setForm({ ...form, business_category: e.target.value })}
              placeholder="소프트웨어 개발"
              className="field-input sm:!max-w-[220px]"
            />
          </div>
        </div>
        {/* 과세유형 — 무엇을 발행할 수 있는지가 여기서 갈린다 (2026-08-13 사장님 지시).
            예전엔 발행 폼에만 과세/영세율/면세 칸이 있고 회사가 무슨 사업자인지는 아무도 안 봐서,
            광고대행(전부 과세)인 회사에서도 '면세'를 골라 전자계산서를 낼 수 있었다. */}
        <div className="stg-frow">
          <div className="stg-frow-label">
            <b>과세유형</b>
            <small>{VAT_BUSINESS_TYPES.find((v) => v.value === form.vat_type)?.desc}</small>
          </div>
          <div className="stg-frow-body">
            <select
              value={form.vat_type}
              onChange={(e) => setForm({ ...form, vat_type: e.target.value as VatBusinessType })}
              className="field-input"
            >
              {VAT_BUSINESS_TYPES.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
            {/*   국세청이 알려 준 값은 **권하기만** 한다 — 겸영은 조회로 알 수 없어 사람이 정해야 한다 */}
            {vatHint && vatHint !== form.vat_type && (
              <p className="stg-frow-hint">
                국세청 조회로는 <b className="text-[var(--text)]">{VAT_BUSINESS_TYPES.find((v) => v.value === vatHint)?.label}</b> 입니다.
                <button type="button" className="ml-1.5 underline font-semibold text-[var(--primary)]"
                  onClick={() => setForm((f) => ({ ...f, vat_type: vatHint }))}>
                  이걸로 바꾸기
                </button>
                <br />면세 품목을 함께 파는 겸영이면 <b className="text-[var(--text)]">과세 + 면세 겸영</b>으로 두세요.
              </p>
            )}
          </div>
        </div>
        <div className="stg-frow">
          <div className="stg-frow-label"><b>자본금 (원)</b><small>재무상태표 자본 항목 · 등기부상 자본금</small></div>
          <div className="stg-frow-body">
            <input
              inputMode="numeric"
              value={form.capital ? Number(String(form.capital).replace(/[^0-9]/g, "")).toLocaleString("ko-KR") : ""}
              onChange={(e) => setForm({ ...form, capital: e.target.value.replace(/[^0-9]/g, "") })}
              placeholder="예: 10,000,000"
              className="field-input text-right mono-number sm:!max-w-[220px]"
            />
          </div>
        </div>
        <div className="stg-frow stg-frow-wide">
          <div className="stg-frow-label"><b>주소</b></div>
          <div className="stg-frow-body">
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="서울특별시 강남구 테헤란로 123"
              className="field-input"
            />
          </div>
        </div>
        <div className="stg-sec-actions">
          <button
            onClick={() => { void handleSave(); }}
            disabled={!form.name || saveMut.isPending}
            className="btn-primary"
          >
            {saveMut.isPending ? "저장 중..." : saved ? "저장 완료" : "회사 정보 저장"}
          </button>
        </div>
      </div>

      {/* Seal & Logo Upload */}
      <div className="company-seal-logo-panel stg-sec">
        <div className="stg-sec-head mb-5">
          <div>
            <h2 className="stg-sec-title">직인 및 로고</h2>
            <p className="stg-sec-desc">전자계약 서명과 견적서·명세서 머리에 사용됩니다.</p>
          </div>
        </div>
        {uploadError && (
          <div className="p-3 rounded-xl bg-red-500/10 text-red-400 text-xs mb-4">{uploadError}</div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Seal Upload */}
          <div className="company-seal-upload">
            <label className="field-label mb-2">직인 (회사 도장)</label>
            <div className="company-asset-dropzone">
              {sealUrl ? (
                <>
                  <img
                    src={sealUrl}
                    alt="직인"
                    className="company-asset-img"
                  />
                  <div className="flex gap-2 mt-2 flex-wrap justify-center">
                    <button
                      onClick={() => sealInputRef.current?.click()}
                      className="text-xs text-[var(--primary)] hover:underline"
                    >
                      변경
                    </button>
                    <button
                      onClick={() => regenerateSealPreview()}
                      disabled={!form.name?.trim()}
                      className="text-xs text-[var(--success)] hover:underline disabled:opacity-50"
                      title={!form.name?.trim() ? "회사명을 먼저 입력하세요" : ""}
                    >
                      🪄 자동 재생성
                    </button>
                    <button
                      onClick={() => handleRemoveFile("seal")}
                      className="text-xs text-red-400/60 hover:text-red-400"
                    >
                      삭제
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-[var(--text-dim)]">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-center">
                    <button
                      onClick={() => sealInputRef.current?.click()}
                      disabled={uploading === "seal" || generatingSeal}
                      className="text-xs text-[var(--primary)] font-semibold hover:underline disabled:opacity-50"
                    >
                      {uploading === "seal" ? "업로드 중..." : "직접 업로드"}
                    </button>
                    <span className="text-[var(--text-dim)] text-xs">·</span>
                    <button
                      onClick={() => regenerateSealPreview()}
                      disabled={uploading === "seal" || generatingSeal || !form.name?.trim()}
                      className="text-xs text-[var(--success)] font-semibold hover:underline disabled:opacity-50"
                      title={!form.name?.trim() ? "회사명을 먼저 입력하세요" : ""}
                    >
                      🪄 자동 생성
                    </button>
                  </div>
                  <p className="caption">PNG, JPG (최대 5MB) · 또는 회사명으로 법인인감 자동 생성</p>
                </>
              )}
            </div>
            <input
              ref={sealInputRef}
              type="file"
              accept=".png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file, "seal");
                e.target.value = "";
              }}
            />

            {/* 자동 생성 미리보기 + 스타일 선택 */}
            {sealPreview && (
              <div className="company-seal-preview-panel">
                <div className="flex items-start gap-4">
                  <img src={sealPreview} alt="직인 미리보기" className="w-32 h-32 object-contain bg-white rounded-lg p-2" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-[var(--text)] mb-2">직인 스타일</p>
                    <div className="flex gap-1.5 flex-wrap mb-3">
                      {[
                        { v: "corporate" as const, label: "법인인감" },
                        { v: "double" as const, label: "이중 원형" },
                        { v: "single" as const, label: "단일 원형" },
                        { v: "square" as const, label: "사각형" },
                      ].map((opt) => (
                        <button
                          key={opt.v}
                          onClick={() => { setSealVariant(opt.v); regenerateSealPreview(opt.v); }}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition ${
                            sealVariant === opt.v
                              ? "bg-[var(--primary)] text-white"
                              : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleAutoGenerateSeal}
                        disabled={generatingSeal}
                        className="btn-primary !text-xs !px-3 !py-1.5"
                      >
                        {generatingSeal ? "저장 중..." : "이 직인 사용"}
                      </button>
                      <button
                        onClick={() => setSealPreview(null)}
                        className="btn-secondary !text-xs !px-3 !py-1.5"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Logo Upload */}
          <div className="company-logo-upload">
            <label className="field-label mb-2">회사 로고</label>
            <div className="company-asset-dropzone">
              {logoUrl ? (
                <>
                  <img
                    src={logoUrl}
                    alt="로고"
                    className="company-asset-img"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => logoInputRef.current?.click()}
                      className="text-xs text-[var(--primary)] hover:underline"
                    >
                      변경
                    </button>
                    <button
                      onClick={() => handleRemoveFile("logo")}
                      className="text-xs text-red-400/60 hover:text-red-400"
                    >
                      삭제
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-[var(--text-dim)]">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploading === "logo"}
                    className="text-xs text-[var(--primary)] font-semibold hover:underline disabled:opacity-50"
                  >
                    {uploading === "logo" ? "업로드 중..." : "로고 업로드"}
                  </button>
                  <p className="caption">PNG, JPG (최대 5MB)</p>
                </>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept=".png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file, "logo");
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </div>

      {/* 회사 문서 (법인 서류) — 계약 발송·현황에서 이관(2026-07-23). 업로드 상태·보기·교체·삭제 지원 */}
      <CompanyDocsSection companyId={companyId} />

      {/* 결재 상신 총괄 알림 (2026-08-13 사장님: 승인 차례가 아닌 총책임자에게도 메일) */}
      <ApprovalNotifySection companyId={companyId} />

      {/* 보안 — 접속 허용 IP (옵션, 2026-08-11 사장님: 쓰는 회사만) */}
      <IpRestrictionSection companyId={companyId} />

      {/* 세무 파트너 — 제휴 세무사 연결/해제 (2026-08-11 사장님 ①②) */}
      <TaxAdvisorSection />
    </div>
  );
}

/* ── 세무 파트너: 제휴 세무사 목록에서 골라 연결, 연결된 세무사 표시·해제·권한 부여 ──
   연결된 세무사는 /advisor 포털과 오너뷰 열람 모드(읽기 전용)로 이 회사를 볼 수 있다 —
   단, 여기서 부여한 메뉴 권한만 보인다(일반 구성원과 동일 모델, 연결 시 세무 기본 패키지 자동 부여).
   목록·연결·해제·권한은 전부 SECURITY DEFINER RPC — 관리자(마스터 포함)만. */
function TaxAdvisorSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [permOpenFor, setPermOpenFor] = useState<string | null>(null); // link_id
  const [logsOpen, setLogsOpen] = useState(false);

  // 열람 감사 로그 (2026-08-11) — 세무사가 우리 회사를 본앱으로 열람한 기록
  const { data: accessLogs = [] } = useQuery({
    queryKey: ["company-advisor-access-logs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("company_advisor_access_logs", { p_limit: 20 });
      if (error) throw error;
      return (data || []) as { accessed_at: string; advisor_name: string; office_name: string | null }[];
    },
    enabled: logsOpen,
  });

  const { data: myAdvisors = [] } = useQuery({
    queryKey: ["company-my-advisors"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("company_my_advisors");
      if (error) throw error;
      return (data || []) as { link_id: string; advisor_id: string; name: string; office_name: string | null; specialty: string | null; email: string; phone: string | null; linked_at: string }[];
    },
  });
  // 마스터 전용 RPC — 비마스터는 호출 자체를 안 한다 (forbidden 거절이 운영자
  //   오류 목록에 쌓이던 것, 2026-08-12 사장님: 게이트 넣어 안 쌓이게)
  const { isMaster } = useMyPermissions();
  const { data: catalog = [], error: catalogError } = useQuery({
    queryKey: ["company-advisor-catalog"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("company_list_advisors");
      if (error) throw error;
      return (data || []) as { id: string; name: string; office_name: string | null; specialty: string | null; linked: boolean }[];
    },
    retry: false, // 관리자 아니면 forbidden — 조용히 숨김
    enabled: isMaster,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["company-my-advisors"] });
    queryClient.invalidateQueries({ queryKey: ["company-advisor-catalog"] });
  };
  const linkMut = useMutation({
    mutationFn: async (advisorId: string) => {
      const { error } = await (supabase as any).rpc("company_link_advisor", { p_advisor_id: advisorId });
      if (error) throw error;
      // 세무사에게 연결 안내 메일 — 베스트에포트 (2026-08-12)
      supabase.functions.invoke("advisor-notify", { body: { event: "linked", advisor_id: advisorId } }).catch(() => {});
    },
    onSuccess: () => { toast("세무사가 연결되었습니다.", "success"); invalidate(); },
    onError: () => toast("연결에 실패했습니다.", "error"),
  });
  const unlinkMut = useMutation({
    mutationFn: async ({ linkId, advisorId }: { linkId: string; advisorId: string }) => {
      const { error } = await (supabase as any).rpc("company_unlink_advisor", { p_link_id: linkId });
      if (error) throw error;
      supabase.functions.invoke("advisor-notify", { body: { event: "unlinked", advisor_id: advisorId } }).catch(() => {});
    },
    onSuccess: () => { toast("연결을 해제했습니다. 해당 세무사의 열람이 즉시 차단됩니다.", "success"); invalidate(); },
    onError: () => toast("해제에 실패했습니다.", "error"),
  });

  // 관리자가 아니어서 카탈로그 자체가 forbidden 이면 섹션 미노출 (연결된 세무사가 있으면 표시는 유지)
  if (catalogError && myAdvisors.length === 0) return null;
  const unlinked = catalog.filter((a) => !a.linked);

  return (
    <div className="company-advisor-section stg-sec">
      <div className="stg-sec-head mb-4">
        <div>
          <h3 className="stg-sec-title">세무 파트너</h3>
          <p className="stg-sec-desc">
            오너뷰 제휴 세무사를 연결하면 자료 요청 없이 우리 회사 장부를 열람(읽기 전용)하며 기장·신고를 도와줍니다. 추가 좌석 비용은 없습니다.
          </p>
        </div>
      </div>

      {myAdvisors.length > 0 && (
        <div className="company-advisor-list">
          {myAdvisors.map((a) => (
            <div key={a.link_id}>
              <div className="company-advisor-row">
                <div className="min-w-0">
                  <span className="font-bold text-sm">{a.name}</span>
                  {a.office_name && <span className="text-xs text-[var(--text-muted)] ml-1.5">{a.office_name}</span>}
                  <div className="text-[11px] text-[var(--text-dim)] mt-0.5 truncate">
                    {a.email}{a.phone ? ` · ${a.phone}` : ""}{a.specialty ? ` · ${a.specialty}` : ""} · {String(a.linked_at).slice(0, 10)} 연결
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    className="company-advisor-perm-btn"
                    onClick={() => setPermOpenFor(permOpenFor === a.link_id ? null : a.link_id)}
                  >{permOpenFor === a.link_id ? "권한 닫기" : "권한 설정"}</button>
                  <button
                    className="company-advisor-unlink-btn"
                    disabled={unlinkMut.isPending}
                    onClick={async () => {
                      if (await appConfirm(`${a.name} 세무사와의 연결을 해제하시겠습니까?\n해제 즉시 우리 회사 데이터 열람이 차단됩니다.`, { danger: true, confirmLabel: "해제" }))
                        unlinkMut.mutate({ linkId: a.link_id, advisorId: a.advisor_id });
                    }}
                  >연결 해제</button>
                </div>
              </div>
              {permOpenFor === a.link_id && <AdvisorPermissionPanel linkId={a.link_id} advisorName={a.name} />}
            </div>
          ))}
          {/* 열람 이력 — 세무사가 언제 우리 회사에 들어와서 봤는지 (감사 추적) */}
          <button className="company-advisor-logs-toggle" onClick={() => setLogsOpen((v) => !v)}>
            {logsOpen ? "열람 이력 닫기" : "열람 이력 보기"}
          </button>
          {logsOpen && (
            accessLogs.length === 0 ? (
              <div className="text-[11px] text-[var(--text-dim)] px-1 py-2">아직 열람 기록이 없습니다.</div>
            ) : (
              <div className="company-advisor-log-list">
                {accessLogs.map((l, i) => (
                  <div key={i} className="company-advisor-log-row">
                    <span className="font-semibold">{l.advisor_name}</span>
                    {l.office_name && <span className="text-[var(--text-dim)]">{l.office_name}</span>}
                    <span className="ml-auto text-[var(--text-dim)]">
                      {new Date(l.accessed_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 열람
                    </span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {!catalogError && (
        myAdvisors.length === 0 && unlinked.length === 0 ? (
          <p className="text-xs text-[var(--text-dim)] mt-3">아직 등록된 제휴 세무사가 없습니다. 준비되는 대로 이곳에서 선택할 수 있습니다.</p>
        ) : unlinked.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] font-bold text-[var(--text-muted)] mb-2">제휴 세무사 목록</div>
            <div className="company-advisor-list">
              {unlinked.map((a) => (
                <div key={a.id} className="company-advisor-row">
                  <div className="min-w-0">
                    <span className="font-bold text-sm">{a.name}</span>
                    {a.office_name && <span className="text-xs text-[var(--text-muted)] ml-1.5">{a.office_name}</span>}
                    {a.specialty && <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{a.specialty}</div>}
                  </div>
                  <button
                    className="company-advisor-link-btn"
                    disabled={linkMut.isPending}
                    onClick={async () => {
                      if (await appConfirm(`${a.name} 세무사를 연결하시겠습니까?\n연결하면 우리 회사의 재무·인사 데이터를 열람(읽기 전용)할 수 있습니다.`, { confirmLabel: "연결" }))
                        linkMut.mutate(a.id);
                    }}
                  >연결</button>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

/* ── 결재 상신 총괄 알림 — company_settings.settings.approval_notify_email (선택) ──
   결재가 상신되면 승인 차례인 사람 외에 이 주소로도 알림 메일이 간다 (2026-08-13 사장님:
   "승인 차례가 아닌 회사 총책임자한테도 메일이 가게"). 비우면 발송 안 함.
   발송 배선은 sendApprovalMails(kind='requested') 가 이 값을 읽어 1통 추가한다. */
function ApprovalNotifySection({ companyId }: { companyId: string | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [addr, setAddr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: row } = useQuery({
    queryKey: ["company-settings-security", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("company_settings").select("id, settings").eq("company_id", companyId!).maybeSingle();
      return data as { id: string; settings: Record<string, unknown> | null } | null;
    },
    enabled: !!companyId,
  });
  useEffect(() => {
    if (loaded || row === undefined) return;
    setAddr(String((row?.settings as any)?.approval_notify_email || ""));
    setLoaded(true);
  }, [row, loaded]);

  const saveMut = useMutation({
    mutationFn: async (next: string) => {
      const nextSettings = { ...((row?.settings as Record<string, unknown>) || {}), approval_notify_email: next || null };
      if (row?.id) {
        const { error } = await (supabase as any).from("company_settings").update({ settings: nextSettings }).eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("company_settings").insert({ company_id: companyId, settings: nextSettings });
        if (error) throw error;
      }
    },
    onSuccess: (_d, next) => {
      toast(next ? "총괄 알림 주소를 저장했습니다." : "총괄 알림을 끕니다 (주소 비움).", "success");
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["company-settings-security", companyId] });
    },
    onError: (e: any) => toast(`저장 실패: ${friendlyError(e, "알 수 없는 오류")}`, "error"),
  });

  const handleSave = () => {
    const v = addr.trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast("메일 주소 형식을 확인하세요.", "error"); return; }
    saveMut.mutate(v);
  };

  return (
    <div className="company-approval-notify-panel stg-sec">
      <div className="stg-sec-head">
        <div>
          <h2 className="stg-sec-title">결재 상신 알림 — 총책임자</h2>
          <p className="stg-sec-desc">결재가 올라오면 승인 차례인 사람 외에 이 주소로도 알림 메일을 보냅니다. 비워두면 보내지 않습니다.</p>
        </div>
      </div>
      <div className="stg-frow">
        <div className="stg-frow-label"><b>총괄 수신 메일</b><small>선택 — 예: 대표·경영지원 총괄</small></div>
        <div className="stg-frow-body">
          <div className="flex gap-2">
            <input
              type="email"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="예: ceo@company.com — 비우면 발송 안 함"
              className="field-input flex-1"
            />
            <button type="button" onClick={handleSave} disabled={saveMut.isPending} className="btn-secondary btn-sm shrink-0 self-center">
              {saved ? "저장 완료" : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 보안: 접속 허용 IP — company_settings.settings.ip_restriction { enabled, ips[] } ──
   켠 회사만 적용(IpGate 가 앱 전역에서 판정). 켤 때 현재 IP 를 자동 포함해 스스로 잠기는 사고를 막는다. */
function IpRestrictionSection({ companyId }: { companyId: string | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [ipsText, setIpsText] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [myIp, setMyIp] = useState("");
  const [loaded, setLoaded] = useState(false);

  const { data: row } = useQuery({
    queryKey: ["company-settings-security", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("company_settings").select("id, settings").eq("company_id", companyId!).maybeSingle();
      return data as { id: string; settings: Record<string, unknown> | null } | null;
    },
    enabled: !!companyId,
  });

  useEffect(() => {
    fetch("/api/my-ip").then((r) => r.json()).then((d) => setMyIp(d.ip || "")).catch(() => {});
  }, []);

  useEffect(() => {
    if (!row || loaded) return;
    const conf = (row.settings as any)?.ip_restriction || {};
    setEnabled(!!conf.enabled);
    setIpsText(Array.isArray(conf.ips) ? conf.ips.join("\n") : "");
    setLoaded(true);
  }, [row, loaded]);

  const saveMut = useMutation({
    mutationFn: async ({ nextEnabled, nextIps }: { nextEnabled: boolean; nextIps: string[] }) => {
      if (!row?.id) throw new Error("회사 설정 행이 없습니다 — 연동·인증 탭을 먼저 한 번 열어주세요");
      const nextSettings = { ...(row.settings || {}), ip_restriction: { enabled: nextEnabled, ips: nextIps } };
      const { error } = await (supabase as any).from("company_settings").update({ settings: nextSettings }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast("접속 허용 IP 설정이 저장되었습니다.", "success");
      queryClient.invalidateQueries({ queryKey: ["company-settings-security", companyId] });
    },
    onError: (e: any) => toast(`저장 실패: ${friendlyError(e, "알 수 없는 오류")}`, "error"),
  });

  const parseIps = () => ipsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

  const handleSave = async () => {
    let ips = parseIps();
    if (enabled) {
      if (ips.length === 0) { toast("허용할 IP를 1개 이상 입력하세요.", "error"); return; }
      // 잠금 사고 방지 — 켜는 순간 현재 접속 IP 가 목록에 없으면 자동 포함
      if (myIp && !ips.includes(myIp)) {
        if (await appConfirm(`현재 접속 중인 IP(${myIp})가 목록에 없습니다. 저장하면 이 기기도 차단됩니다.\n현재 IP를 목록에 추가하고 저장할까요?`, { title: "현재 IP 자동 추가", confirmLabel: "추가하고 저장" })) {
          ips = [...ips, myIp];
          setIpsText(ips.join("\n"));
        }
      }
    }
    saveMut.mutate({ nextEnabled: enabled, nextIps: ips });
  };

  return (
    <div className="company-ip-restriction-panel stg-sec">
      <div className="stg-sec-head">
        <div>
          <h2 className="stg-sec-title">보안 — 접속 허용 IP</h2>
          <p className="stg-sec-desc">
            켜면 등록한 IP(사무실 인터넷 등)에서만 접속할 수 있습니다.
            {myIp && <> 현재 이 기기의 IP: <b className="mono-number text-[var(--text)]">{myIp}</b></>}
          </p>
        </div>
      </div>
      <label className="stg-trow">
        <span>
          <span className="stg-trow-t">허용된 IP에서만 접속 가능</span>
          <span className="stg-trow-s block">끄면 어디서든 접속됩니다</span>
        </span>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-5 h-5 rounded accent-[var(--primary)]" />
      </label>
      <div className="stg-frow stg-frow-wide">
        <div className="stg-frow-label"><b>허용 IP 목록</b><small>한 줄에 하나씩</small></div>
        <div className="stg-frow-body">
          <textarea
            value={ipsText}
            onChange={(e) => setIpsText(e.target.value)}
            placeholder={"예)\n211.234.56.78\n121.140.11.22"}
            rows={4}
            className="field-input font-mono text-[12px] leading-relaxed"
            style={{ height: "auto" }}
          />
        </div>
      </div>
      <div className="stg-sec-actions">
        {myIp && (
          <button type="button" className="btn-secondary btn-sm mr-auto"
            onClick={() => { const ips = parseIps(); if (!ips.includes(myIp)) setIpsText([...ips, myIp].join("\n")); }}>
            현재 IP 추가
          </button>
        )}
        <button type="button" onClick={() => { void handleSave(); }} disabled={saveMut.isPending} className="btn-primary btn-sm">
          {saveMut.isPending ? "저장 중..." : "보안 설정 저장"}
        </button>
      </div>
    </div>
  );
}

/* ── 회사 문서 섹션 — storage: documents/company-docs/{companyId}/{key}_{ts}.{ext} ──
   업로드 여부 표시 + 보기(서명 URL)·교체(기존 삭제 후 업로드)·삭제. 계약 발송·증명서 발급이 같은 경로 참조. */
const COMPANY_DOCS = [
  { key: "business_reg", label: "사업자등록증", desc: "사업자등록증 사본" },
  { key: "employment_rules", label: "취업규칙", desc: "회사 취업규칙/사규" },
  { key: "corporate_reg", label: "법인등기부등본", desc: "법인 등기부등본" },
  { key: "seal_cert", label: "인감증명서", desc: "법인 인감증명서" },
  { key: "bank_cert", label: "통장사본", desc: "법인 통장 사본" },
  { key: "etc_docs", label: "기타 문서", desc: "기타 회사 필수 문서" },
];

function CompanyDocsSection({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { data: files = [] } = useQuery({
    queryKey: ["company-docs", companyId],
    queryFn: async () => {
      if (!companyId) return [] as { name: string }[];
      const { data } = await supabase.storage.from("documents").list(`company-docs/${companyId}`, {
        limit: 100, sortBy: { column: "created_at", order: "desc" },
      });
      return (data || []) as { name: string }[];
    },
    enabled: !!companyId,
  });

  const pathOf = (name: string) => `company-docs/${companyId}/${name}`;
  const filesFor = (key: string) => files.filter((f) => f.name.startsWith(key + "_"));
  // 정렬이 최신순이라 첫 매치가 현재 파일
  const latestFor = (key: string) => filesFor(key)[0];

  const doUpload = async (key: string, file: File) => {
    if (!companyId) return;
    setBusyKey(key);
    try {
      const ext = file.name.split(".").pop();
      const path = `company-docs/${companyId}/${key}_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
      if (error) throw error;
      // 업로드 성공 후 기존(같은 key) 파일 정리 → 교체
      const old = filesFor(key).map((f) => pathOf(f.name));
      if (old.length) await supabase.storage.from("documents").remove(old);
      toast("업로드 완료", "success");
      qc.invalidateQueries({ queryKey: ["company-docs", companyId] });
    } catch (err: any) {
      toast("업로드 실패: " + (err?.message || ""), "error");
    } finally {
      setBusyKey(null);
    }
  };

  const doRemove = async (key: string, label: string) => {
    if (!companyId) return;
    if (!(await appConfirm(`"${label}"을(를) 삭제하시겠습니까?`, { danger: true }))) return;
    setBusyKey(key);
    try {
      const paths = filesFor(key).map((f) => pathOf(f.name));
      if (paths.length) {
        const { error } = await supabase.storage.from("documents").remove(paths);
        if (error) throw error;
      }
      toast("삭제되었습니다", "success");
      qc.invalidateQueries({ queryKey: ["company-docs", companyId] });
    } catch (err: any) {
      toast("삭제 실패: " + (err?.message || ""), "error");
    } finally {
      setBusyKey(null);
    }
  };

  const doView = async (name: string) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(pathOf(name), 3600);
    if (error || !data?.signedUrl) { toast("파일을 열 수 없습니다", "error"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <div className="stg-sec">
      <div className="stg-sec-head mb-1">
        <div>
          <h2 className="stg-sec-title">회사 문서</h2>
          <p className="stg-sec-desc">사업자등록증·법인등기부등본 등 법인 서류 — 계약서 발송·증명서 발급에 활용됩니다.</p>
        </div>
      </div>
      {COMPANY_DOCS.map((doc) => {
        const cur = latestFor(doc.key);
        const busy = busyKey === doc.key;
        return (
          <div key={doc.key} className="stg-drow">
            <div className="stg-drow-main">
              <div className="stg-drow-t">{doc.label}</div>
              <div className="stg-drow-s">{doc.desc}</div>
            </div>
            <span className={`stg-badge ${cur ? "stg-badge-ok" : ""}`}>{cur ? "업로드됨" : "미등록"}</span>
            {cur ? (
              <>
                <button onClick={() => doView(cur.name)} disabled={busy} className="stg-drow-act disabled:opacity-50">보기</button>
                <label className={`stg-drow-act cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
                  교체
                  <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" disabled={busy}
                    onChange={(ev) => { const f = ev.target.files?.[0]; if (f) doUpload(doc.key, f); ev.target.value = ""; }} />
                </label>
                <button onClick={() => doRemove(doc.key, doc.label)} disabled={busy} className="stg-drow-act stg-drow-act-danger disabled:opacity-50">삭제</button>
              </>
            ) : (
              <label className={`stg-drow-act !text-[var(--primary)] font-semibold cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
                {busy ? "업로드 중…" : "업로드"}
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" disabled={busy}
                  onChange={(ev) => { const f = ev.target.files?.[0]; if (f) doUpload(doc.key, f); ev.target.value = ""; }} />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── 세무사 권한 부여 패널 — 구성원 권한(PermissionTree)과 동일 카탈로그, 저장은 링크 단위 RPC ── */
function AdvisorPermissionPanel({ linkId, advisorName }: { linkId: string; advisorName: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const { data: saved, isLoading } = useQuery({
    queryKey: ["advisor-permissions", linkId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("advisor_permissions").select("perm_key").eq("link_id", linkId);
      return new Set<string>((data || []).map((r: any) => r.perm_key));
    },
  });
  useEffect(() => { if (saved && !dirty) setChecked(new Set(saved)); }, [saved, dirty]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("set_advisor_permissions", {
        p_link_id: linkId, p_perm_keys: Array.from(checked),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast(`${advisorName} 세무사의 열람 권한이 저장되었습니다`, "success");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["advisor-permissions", linkId] });
    },
    onError: (e: any) => toast(friendlyError(e, "권한 저장 실패"), "error"),
  });

  const toggle = (keys: string[], on: boolean) => {
    setChecked((cur) => {
      const next = new Set(cur);
      for (const k of keys) { if (on) next.add(k); else next.delete(k); }
      return next;
    });
    setDirty(true);
  };

  if (isLoading) return <div className="text-xs text-[var(--text-dim)] py-3 pl-1">권한 불러오는 중…</div>;

  return (
    <div className="company-advisor-perm-panel">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="text-[11px] text-[var(--text-muted)]">
          체크된 메뉴만 {advisorName} 세무사에게 보입니다(전부 읽기 전용). 연결 시 세무 업무 기본 세트가 자동 부여되어 있습니다.
        </div>
        <button onClick={() => saveMut.mutate()} disabled={!dirty || saveMut.isPending} className="btn-primary btn-sm disabled:opacity-40">
          {saveMut.isPending ? "저장 중…" : "저장"}
        </button>
      </div>
      <PermissionTree checked={checked} onToggle={toggle} viewerIsMaster={false} />
      {dirty && <div className="text-[11px] text-[var(--warning)] mt-2">변경사항이 있습니다 — 저장을 눌러야 반영됩니다.</div>}
    </div>
  );
}
