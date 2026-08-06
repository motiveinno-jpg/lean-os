"use client";
import { logRead } from "@/lib/log-read";
import { Ico } from "@/components/ui-icon";

import { useEffect, useMemo, useState } from "react";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import Link from "next/link";
import { createBulkSignatureRequestsToOrgs, normalizeVariableTokens, buildOrgContractSnapshotHtml, type PartnerVarColumn } from "@/lib/signatures";
import { materializeContractTemplate } from "@/lib/documents";
import { upsertPartner } from "@/lib/partners";
import { verifyBusinessNumber } from "@/lib/business-verification";
import { setContractTemplateOrder, sortTemplatesByOrder } from "@/lib/contract-templates";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useModalKeys } from "@/hooks/use-modal-keys";

// ── 단체(거래처) 일괄 발송 마법사 (5단계) ──
type OrgPartner = {
  id: string;
  name: string;
  type?: string | null;
  representative?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  business_number?: string | null;
  address?: string | null;
};

const PARTNER_COLUMN_LABELS: Record<PartnerVarColumn, string> = {
  name: "단체명",
  representative: "대표자",
  contact_name: "담당자",
  contact_email: "담당자 이메일",
  contact_phone: "담당자 연락처",
  business_number: "사업자번호",
  address: "주소",
};

function autoMapToken(token: string): PartnerVarColumn | null {
  const t = token.replace(/\s+/g, "").toLowerCase();
  // 갑(甲) 측은 우리 회사 = commonVariables 에서 회사 설정으로 입력. 자동매핑 X.
  //   예: {갑_회사명} / {our_company_name} / {company_name} (회사 자체)
  if (/^(갑|甲|our|us|company)[_-]/i.test(t)) return null;
  // 을(乙) 측 또는 partner/client/customer 접두사는 거래처 매핑.
  //   접두사 제거 후 본체 매칭.
  const body = t.replace(/^(을|乙|partner|client|customer|counterparty)[_-]/i, "");
  if (/(단체명|회사명|업체명|상호|법인명|partnername|companyname|name)/i.test(body)) return "name";
  if (/(대표자|대표|representative|ceo)/i.test(body)) return "representative";
  if (/(담당자|담당|contactname)/i.test(body) && !/이메일|email/i.test(body)) return "contact_name";
  if (/(이메일|메일|email|mail)/i.test(body)) return "contact_email";
  if (/(사업자번호|사업자등록번호|businessnumber|brn)/i.test(body)) return "business_number";
  if (/(연락처|전화|휴대폰|핸드폰|phone|tel|mobile)/i.test(body)) return "contact_phone";
  if (/(주소|소재지|사업장|address|addr)/i.test(body)) return "address";
  return null;
}

function extractTokens(...sources: any[]): string[] {
  const seen = new Set<string>();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  for (const src of sources) {
    let s: string;
    if (src == null) continue;
    if (typeof src === "string") s = src;
    else {
      try { s = JSON.stringify(src); } catch { continue; }
    }
    // 2026-05-22 RichEditor 서식 span 으로 분절된 {{변수}} 복구 후 추출.
    s = normalizeVariableTokens(s);
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const name = m[1].trim();
      if (!name) continue;
      // 2026-05-28 ?-prefix 토큰(라디오/텍스트) 은 서명자 입력용 — 발송측 변수 매핑 대상 아님.
      if (name.startsWith('?라디오') || name.startsWith('?텍스트')) continue;
      seen.add(name);
    }
  }
  return Array.from(seen);
}

export function OrgBulkWizard({
  companyId,
  userId,
  documents,
  contractTemplates = [],
  templateOrder = [],
  onClose,
  onCreated,
}: {
  companyId: string;
  userId: string;
  documents: any[];
  docTemplates?: any[];          // 레거시(호환용) — 발송 양식 소스는 contractTemplates 로 일원화(2026-07-23)
  contractTemplates?: any[];
  templateOrder?: string[];      // 회사 공통 노출 순서(id 배열) — 드래그로 변경, company_settings 저장
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [submitting, setSubmitting] = useState(false);
  // 100개+ 대량 발송 진행률 (chunk 완료마다 갱신)
  const [progress, setProgress] = useState<{ done: number; total: number; sent: number; failed: number } | null>(null);

  // 계약 양식(contract_templates)을 발송 목록에 노출 — 선택 시 실제 documents 행으로 실체화.
  const bizTemplates = useMemo(() => contractTemplates, [contractTemplates]);
  // 2026-08-03 사장님: 우리 회사 양식은 '문서' 그룹에, 표준(기본) 양식은 '양식 관리' 그룹에.
  const companyTpls = useMemo(() => (contractTemplates as any[]).filter((t: any) => !t.is_system), [contractTemplates]);
  const standardTpls = useMemo(() => (contractTemplates as any[]).filter((t: any) => t.is_system), [contractTemplates]);

  // ── 목록 순서: 드래그로 변경, 회사 전체 공통 적용 (2026-08-03 사장님) ──
  //   저장은 company_settings.settings.contract_template_order — 양식관리 ▲▼ 와 같은 배열을 공유하고
  //   문서 id 도 함께 담아 '문서' 구역의 순서까지 기억한다. 드래그 즉시 로컬 반영 후 서버 저장.
  const qc = useQueryClient();
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const effectiveOrder = localOrder ?? templateOrder;
  type PickItem = { kind: "doc" | "tpl"; id: string; doc?: any; tpl?: any };
  const docSection: PickItem[] = useMemo(() => sortTemplatesByOrder([
    ...documents.map((d) => ({ kind: "doc" as const, id: d.id as string, doc: d })),
    ...companyTpls.map((t: any) => ({ kind: "tpl" as const, id: t.id as string, tpl: t })),
  ], effectiveOrder), [documents, companyTpls, effectiveOrder]);
  const stdSection = useMemo(() => sortTemplatesByOrder(standardTpls as any[], effectiveOrder), [standardTpls, effectiveOrder]);
  const [dragKey, setDragKey] = useState<string | null>(null);   // "구역|id"
  const [dropKey, setDropKey] = useState<string | null>(null);
  const handleDrop = (section: "doc" | "std", targetId: string) => {
    setDropKey(null);
    if (!dragKey) return;
    const [sec, id] = dragKey.split("|");
    setDragKey(null);
    if (sec !== section || id === targetId) return;
    const ids = (section === "doc" ? docSection : stdSection).map((x: any) => x.id as string);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    const combined = section === "doc"
      ? [...ids, ...stdSection.map((x: any) => x.id as string)]
      : [...docSection.map((x) => x.id), ...ids];
    setLocalOrder(combined);
    setContractTemplateOrder(companyId, combined)
      .then(() => qc.invalidateQueries({ queryKey: ["contract-template-order", companyId] }))
      .catch((e) => toast(friendlyError(e, "순서 저장 실패 — 새로고침 후 다시 시도하세요"), "error"));
  };
  const dragProps = (section: "doc" | "std", id: string) => ({
    draggable: true,
    onDragStart: () => setDragKey(`${section}|${id}`),
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDropKey(`${section}|${id}`); },
    onDragLeave: () => setDropKey((k) => (k === `${section}|${id}` ? null : k)),
    onDrop: () => handleDrop(section, id),
    onDragEnd: () => { setDragKey(null); setDropKey(null); },
  });
  const [materializedDocs, setMaterializedDocs] = useState<any[]>([]);
  const [materializing, setMaterializing] = useState(false);
  const allDocuments = useMemo(() => [...documents, ...materializedDocs], [documents, materializedDocs]);

  // Step 1: 계약서 선택
  const [docId, setDocId] = useState<string>("");
  const selectedDoc = useMemo(() => allDocuments.find((d) => d.id === docId), [allDocuments, docId]);

  const selectTemplate = async (tpl: any) => {
    if (materializing) return;
    // 이미 실체화된 적 있으면(같은 이름 문서 존재) 재사용 — 매번 새 문서로 중복 생성 방지.
    // 양식 id 연결 우선 — 이름은 양식관리에서 바뀔 수 있다(2026-08-03)
    const already = allDocuments.find((d) => (tpl.id && (d.content_json as any)?.source_template_id === tpl.id) || d.name === tpl.name);
    if (already) { setDocId(already.id); return; }
    setMaterializing(true);
    try {
      const doc = await materializeContractTemplate(companyId, tpl);
      setMaterializedDocs((prev) => [...prev, doc]);
      setDocId(doc.id);
    } catch (e: any) {
      toast(friendlyError(e, "양식을 문서로 만들지 못했습니다"), "error");
    } finally {
      setMaterializing(false);
    }
  };

  // Step 2: 거래처
  const [partners, setPartners] = useState<OrgPartner[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [pSearch, setPSearch] = useState("");
  const [pType, setPType] = useState("");
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingPartners(true);
      try {
        const data = logRead('_components/OrgBulkWizard:data', await supabase
          .from("partners")
          .select("id, name, type, representative, contact_name, contact_email, contact_phone, business_number, address")
          .eq("company_id", companyId)
          .order("name", { ascending: true }));
        if (alive) setPartners((data || []) as OrgPartner[]);
      } catch (e) {
        if (alive) toast(friendlyError(e, "거래처를 불러오지 못했습니다"), "error");
      } finally {
        if (alive) setLoadingPartners(false);
      }
    })();
    return () => { alive = false; };
  }, [companyId, toast]);

  const partnerTypes = useMemo(() => {
    const s = new Set<string>();
    for (const p of partners) if (p.type) s.add(p.type);
    return Array.from(s);
  }, [partners]);

  const filteredPartners = useMemo(() => {
    return partners.filter((p) => {
      if (pType && p.type !== pType) return false;
      if (pSearch) {
        const q = pSearch.toLowerCase();
        const hay = `${p.name || ""} ${p.contact_name || ""} ${p.representative || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [partners, pType, pSearch]);

  const selectedPartners = useMemo(
    () => partners.filter((p) => selectedPartnerIds.has(p.id)),
    [partners, selectedPartnerIds],
  );

  const togglePartner = (id: string, p?: OrgPartner) => {
    if (p && !p.contact_email) return; // 이메일 없으면 토글 불가
    setSelectedPartnerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 아직 등록 안 된 거래처를 이 화면에서 바로 추가 (2026-08-05 사장님 요청)
  //   — 거래처 관리로 나갔다 오면 작성 중이던 마법사 입력이 날아가므로 여기서 끝낸다.
  const [showAddPartner, setShowAddPartner] = useState(false);
  const [savingPartner, setSavingPartner] = useState(false);
  const emptyNewPartner = { name: "", representative: "", contact_name: "", contact_email: "", contact_phone: "", business_number: "", address: "" };
  const [newPartner, setNewPartner] = useState(emptyNewPartner);

  // 숫자만 쳐도 서식이 잡히게 (2026-08-06 사장님) — 사업자번호 000-00-00000 / 휴대·유선 하이픈.
  const formatBizNoInput = (v: string) => {
    const d = v.replace(/[^0-9]/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  };
  const formatPhoneInput = (v: string) => {
    const d = v.replace(/[^0-9]/g, "").slice(0, 11);
    if (d.startsWith("02")) { // 서울 지역번호는 2자리
      if (d.length <= 2) return d;
      if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
      if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
      return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
    }
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
  };

  // 사업자번호 국세청 실존·상태 확인 — 10자리가 채워지면 자동으로 (디바운스).
  //   폐업·휴업·미등록이면 경고만 하고 저장은 막지 않는다(거래처는 우리 회사 가입과 달리
  //   과거 거래처·폐업 예정처도 등록할 수 있어야 한다). 오타는 여기서 대부분 걸러진다.
  const [bizCheck, setBizCheck] = useState<{ state: "idle" | "checking" | "ok" | "warn" | "error"; msg: string }>({ state: "idle", msg: "" });
  useEffect(() => {
    const digits = newPartner.business_number.replace(/[^0-9]/g, "");
    if (digits.length !== 10) { setBizCheck({ state: "idle", msg: "" }); return; }
    let alive = true;
    setBizCheck({ state: "checking", msg: "국세청 조회 중…" });
    const t = setTimeout(async () => {
      const v = await verifyBusinessNumber(digits).catch(() => null);
      if (!alive) return;
      if (!v) { setBizCheck({ state: "idle", msg: "" }); return; }          // 네트워크 장애 — 조용히 통과
      if (!v.valid) { setBizCheck({ state: "error", msg: "형식이 올바르지 않은 번호입니다" }); return; }
      switch (v.status) {
        case "계속사업자": setBizCheck({ state: "ok", msg: "정상 사업자로 확인됐습니다" }); break;
        case "휴업자": setBizCheck({ state: "warn", msg: "휴업 상태인 사업자입니다" }); break;
        case "폐업자": setBizCheck({ state: "warn", msg: "폐업 처리된 사업자입니다" }); break;
        case "미등록": setBizCheck({ state: "error", msg: "국세청에 등록되지 않은 번호입니다 — 다시 확인해 주세요" }); break;
        default: setBizCheck({ state: "idle", msg: "" });                    // 확인불가(API 장애)
      }
    }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [newPartner.business_number]);

  const saveNewPartner = async () => {
    const name = newPartner.name.trim();
    const email = newPartner.contact_email.trim();
    if (!name) { toast("단체명을 입력하세요", "error"); return; }
    if (!email) { toast("발송할 담당자 이메일을 입력하세요", "error"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("이메일 형식이 올바르지 않습니다", "error"); return; }
    // 국세청에 없는 번호는 오타일 가능성이 크므로 저장을 막는다 (휴업·폐업은 경고만)
    if (bizCheck.state === "error") { toast(bizCheck.msg, "error"); return; }
    setSavingPartner(true);
    try {
      const saved = await upsertPartner({
        companyId,
        name,
        representative: newPartner.representative.trim() || undefined,
        contactName: newPartner.contact_name.trim() || undefined,
        contactEmail: email,
        contactPhone: newPartner.contact_phone.trim() || undefined,
        businessNumber: newPartner.business_number.trim() || undefined,
        address: newPartner.address.trim() || undefined,
      });
      const row = saved as unknown as OrgPartner;
      setPartners((prev) => [...prev, row].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      setSelectedPartnerIds((prev) => new Set(prev).add(row.id)); // 방금 추가한 곳은 바로 선택
      setNewPartner(emptyNewPartner);
      setShowAddPartner(false);
      setPSearch("");
      qc.invalidateQueries({ queryKey: ["partners"] });
      toast(`${row.name} 추가됨 — 선택에 포함했습니다`, "success");
    } catch (e) {
      toast(friendlyError(e, "거래처를 추가하지 못했습니다"), "error");
    } finally {
      setSavingPartner(false);
    }
  };

  // Step 3: 변수 매핑
  const [titleTemplate, setTitleTemplate] = useState("");
  // 사용자가 제목을 직접 편집했는지 — 편집 전이면 문서 변경 시 자동 갱신.
  const [titleEdited, setTitleEdited] = useState(false);
  useEffect(() => {
    if (selectedDoc && !titleEdited) {
      setTitleTemplate(`{{단체명}} - ${selectedDoc.name || "계약서"}`);
    }
  }, [selectedDoc, titleEdited]);

  const tokens = useMemo(() => {
    const body = selectedDoc?.content_json;
    return extractTokens(titleTemplate, body);
  }, [selectedDoc, titleTemplate]);

  // partnerColumn 매핑 ('' 면 공통값)
  const [variableMap, setVariableMap] = useState<Record<string, PartnerVarColumn | "">>({});
  const [commonVariables, setCommonVariables] = useState<Record<string, string>>({});
  const [perPartnerOverrides, setPerPartnerOverrides] = useState<Record<string, Record<string, string>>>({});
  const [showOverrideTable, setShowOverrideTable] = useState(false);

  useEffect(() => {
    setVariableMap((prev) => {
      const next: Record<string, PartnerVarColumn | ""> = { ...prev };
      for (const t of tokens) {
        if (!(t in next)) next[t] = autoMapToken(t) ?? "";
      }
      // 토큰 사라진 키 정리
      for (const k of Object.keys(next)) {
        if (!tokens.includes(k)) delete next[k];
      }
      return next;
    });
    setCommonVariables((prev) => {
      const next: Record<string, string> = {};
      for (const t of tokens) next[t] = prev[t] ?? "";
      return next;
    });
  }, [tokens]);

  // Step 4: 발송자 / 만료
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [sendNow, setSendNow] = useState(true);
  // 2026-06-17 발송 이메일 수정 — 거래처별 수신 이메일 override (미설정 시 contact_email 그대로)
  const [emailOverrides, setEmailOverrides] = useState<Record<string, string>>({});
  // 2026-05-22 발송 전 우리(갑) 직인 적용 — 거래처가 받는 계약서에 우리 도장 미리 찍힘.
  const [applyOurSeal, setApplyOurSeal] = useState(true);
  // 회사(갑) 정보 — 미리보기 갑 변수 치환 + 직인 합성에 사용
  const [company, setCompany] = useState<{ name?: string | null; business_number?: string | null; representative?: string | null; address?: string | null; seal_url?: string | null } | null>(null);
  const hasCompanySeal = company === null ? null : !!company.seal_url;
  useEffect(() => {
    let alive = true;
    (async () => {
      const data = logRead('_components/OrgBulkWizard:data', await supabase
        .from("companies")
        .select("name, business_number, representative, address, seal_url")
        .eq("id", companyId)
        .maybeSingle());
      if (alive) setCompany(data || {});
    })();
    return () => { alive = false; };
  }, [companyId]);

  // Step 5: 미리보기
  const previewPartner = selectedPartners[0] || null;
  const previewVars = useMemo(() => {
    if (!previewPartner) return {};
    const mapped: Record<string, string> = {};
    for (const [token, col] of Object.entries(variableMap)) {
      if (col) {
        const v = (previewPartner as any)[col];
        mapped[token] = v == null ? "" : String(v);
      } else {
        mapped[token] = commonVariables[token] ?? "";
      }
    }
    return { ...mapped, ...(perPartnerOverrides[previewPartner.id] || {}) };
  }, [previewPartner, variableMap, commonVariables, perPartnerOverrides]);

  const previewTitle = useMemo(() => {
    let s = titleTemplate;
    for (const [k, v] of Object.entries(previewVars)) {
      s = s.replace(new RegExp(`\\{\\{\\s*${k.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\}\\}`, "g"), v);
    }
    return s;
  }, [titleTemplate, previewVars]);

  // 실제 발송될 계약서 본문 미리보기 — 발송(runOne)과 동일한 buildOrgContractSnapshotHtml 사용.
  const previewBodyHtml = useMemo(() => {
    if (!previewPartner || !selectedDoc) return "";
    return buildOrgContractSnapshotHtml({
      docBody: (selectedDoc.content_json as { body?: string } | null)?.body || "",
      company,
      partner: previewPartner,
      variableMap,
      commonVariables,
      overrides: perPartnerOverrides[previewPartner.id] || {},
      ourSealUrl: applyOurSeal && hasCompanySeal === true ? (company?.seal_url || null) : null,
    });
  }, [previewPartner, selectedDoc, company, variableMap, commonVariables, perPartnerOverrides, applyOurSeal, hasCompanySeal]);

  const canNext = (() => {
    if (step === 1) return !!docId;
    if (step === 2) return selectedPartners.length > 0;
    if (step === 3) {
      // 공통값으로 매핑된 토큰은 값이 있어야 함 (덮어쓰기 표에서 일부 단체만 다르면 OK)
      for (const [token, col] of Object.entries(variableMap)) {
        if (!col && !(commonVariables[token] || "").trim()) {
          // 모든 단체에 덮어쓰기 있으면 통과
          const allOverridden = selectedPartners.every((p) => (perPartnerOverrides[p.id] || {})[token]);
          if (!allOverridden) return false;
        }
      }
      return !!titleTemplate.trim();
    }
    if (step === 4) return expiresInDays > 0 && expiresInDays <= 90;
    return true;
  })();

  // 발송 예측 헬퍼 (signatures.ts L390 동적 chunk 와 동일 기준)
  const chunkSizeFor = (n: number) => n <= 50 ? 5 : n <= 150 ? 3 : 2;
  const intervalSecFor = (n: number) => n <= 50 ? 1 : n <= 150 ? 2 : 3;
  const estimateMinutes = (n: number) => {
    if (n <= 0) return 0;
    const chunk = chunkSizeFor(n);
    const interval = intervalSecFor(n);
    return Math.max(1, Math.ceil((n / chunk) * interval / 60));
  };

  const submit = async () => {
    if (!docId || selectedPartners.length === 0) return;
    setSubmitting(true);
    setProgress({ done: 0, total: selectedPartners.length, sent: 0, failed: 0 });
    try {
      // variableMap → 빈 값('') 키는 commonVariables 쪽으로 보냄
      const finalMap: Record<string, PartnerVarColumn> = {};
      for (const [token, col] of Object.entries(variableMap)) {
        if (col) finalMap[token] = col;
      }
      const r = await createBulkSignatureRequestsToOrgs({
        companyId,
        createdBy: userId,
        documentId: docId,
        titleTemplate: titleTemplate.trim(),
        expiresInDays,
        partnerIds: selectedPartners.map((p) => p.id),
        variableMap: finalMap,
        commonVariables,
        perPartnerOverrides,
        emailOverrides,
        sendEmails: sendNow,
        applyOurSeal: applyOurSeal && hasCompanySeal === true,
        onProgress: (info) => setProgress(info),
      });
      // 실패/스킵이 있으면 첫 1~2건 사유까지 toast 에 포함 (사용자가 어디서 막혔는지 즉시 인지)
      const partnerNameMap = new Map(selectedPartners.map((p) => [p.id, p.name]));
      const reasonLines: string[] = [];
      for (const e of (r.errors || []).slice(0, 2)) {
        const n = partnerNameMap.get(e.partnerId) || e.partnerId.slice(0, 8);
        reasonLines.push(`• ${n}: ${e.reason}`);
      }
      for (const s of (r.skipped || []).slice(0, 2 - reasonLines.length)) {
        if (reasonLines.length >= 2) break;
        const n = partnerNameMap.get(s.partnerId) || s.partnerId.slice(0, 8);
        reasonLines.push(`• ${n}: ${s.reason} (스킵)`);
      }
      const totalIssues = (r.errors?.length || 0) + (r.skipped?.length || 0);
      const extraTail = totalIssues > reasonLines.length ? ` 외 ${totalIssues - reasonLines.length}건` : "";
      const detail = reasonLines.length > 0 ? `\n${reasonLines.join("\n")}${extraTail}` : "";
      const msg = `발송 ${r.sent}건 · 실패 ${r.failed}건 · 스킵 ${r.skipped.length}건${detail}`;
      toast(msg, r.failed === 0 && r.skipped.length === 0 ? "success" : "error");
      onCreated();
    } catch (e: any) {
      toast(friendlyError(e, "일괄 발송에 실패했습니다"), "error");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  // Enter = 현재 단계의 주 액션 버튼과 동일(다음 단계로 넘기거나, 마지막 단계면 발송)
  useModalKeys(
    true,
    onClose,
    step < 5
      ? (canNext ? () => setStep((s) => (s + 1) as 1 | 2 | 3 | 4 | 5) : undefined)
      : (submitting || selectedPartners.length === 0 ? undefined : submit),
  );

  // ── 렌더 ──
  return (
    <div className="bulk-wizard-modal fixed inset-0">
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-h-[92vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 + 단계 인디케이터 */}
        <div className="bulk-wizard-header">
          <div>
            {/* 2026-08-05 사장님: 진입점이 '새 계약 요청' 하나로 통합돼 제목도 버튼과 같게 맞춤
                (기존 '단체 일괄 서명 발송'). 여러 곳 동시 발송은 부제로 안내. */}
            <h2 className="text-lg font-bold text-[var(--text)]">새 계약 요청</h2>
            <p className="text-xs text-[var(--text-muted)]">
              계약서를 골라 거래처에 발송합니다. 여러 곳을 선택하면 변수만 다르게 채워 한 번에 보냅니다.
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl">×</button>
        </div>

        <div className="bulk-wizard-steps">
          {[
            { n: 1, label: "계약서" },
            { n: 2, label: "거래처" },
            { n: 3, label: "변수 매핑" },
            { n: 4, label: "발송/만료" },
            { n: 5, label: "미리보기" },
          ].map((s, i) => (
            <div key={s.n} className="flex items-center flex-1">
              <div
                className={`flex-1 px-2 py-1 rounded text-center font-semibold ${
                  step === s.n
                    ? "bg-[var(--primary)] text-white"
                    : step > s.n
                      ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                      : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                }`}
              >
                {s.n}. {s.label}
              </div>
              {i < 4 && <span className="px-1 text-[var(--text-dim)]">›</span>}
            </div>
          ))}
        </div>

        {/* Step 1: 계약서 */}
        {step === 1 && (
          <div className="bulk-wizard-step-doc">
            <div className="text-sm font-semibold text-[var(--text)]">발송할 계약서를 선택하세요</div>
            <div className="text-xs text-[var(--text-muted)]">
              기존 문서 또는 "양식 관리"에 등록된 양식 중에서 고르세요. 양식을 고르면 자동으로 문서로 만들어 발송합니다.
              <br />
              <span className="caption">
                <Ico e="💡" /> 변수 토큰 <code className="text-[var(--primary)]">{`{{을_회사명}}`}</code> / <code className="text-[var(--primary)]">{`{{을_사업자번호}}`}</code> / <code className="text-[var(--primary)]">{`{{을_대표자}}`}</code> / <code className="text-[var(--primary)]">{`{{을_주소}}`}</code> 는 거래처별 자동 치환됩니다. <code className="text-[var(--primary)]">{`{{갑_*}}`}</code> 는 회사 공통값.
              </span>
            </div>
            <div className="bulk-wizard-doc-list">
              {documents.length === 0 && bizTemplates.length === 0 ? (
                <div className="p-6 text-center text-sm text-[var(--text-muted)]">작성된 문서·양식이 없습니다.</div>
              ) : (
                <>
                  {docSection.length > 0 && (
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-dim)] uppercase bg-[var(--bg-surface)]/60 sticky top-0">문서 <span className="normal-case font-normal">— 드래그로 순서 변경(모든 구성원 공통)</span></div>
                  )}
                  {docSection.map((item) => {
                    const rowKey = `doc|${item.id}`;
                    const dropHl = dropKey === rowKey ? "ring-1 ring-[var(--primary)]" : "";
                    if (item.kind === "doc") {
                      const d = item.doc;
                      return (
                        <label
                          key={d.id}
                          {...dragProps("doc", item.id)}
                          className={`flex items-center gap-3 p-3 cursor-pointer border-b border-[var(--border)] last:border-b-0 ${
                            docId === d.id ? "bg-[var(--primary)]/10" : "hover:bg-[var(--bg-surface)]"
                          } ${dropHl}`}
                        >
                          <span className="bulk-wizard-drag-handle" title="드래그로 순서 변경">⠿</span>
                          <input
                            type="radio"
                            name="docId"
                            value={d.id}
                            checked={docId === d.id}
                            onChange={() => setDocId(d.id)}
                          />
                          <div className="flex-1">
                            <div className="text-sm text-[var(--text)]">{d.name}</div>
                            <div className="text-[10px] text-[var(--text-muted)]">
                              {d.doc_templates?.name || d.doc_templates?.type || "—"} · 상태 {d.status}
                            </div>
                          </div>
                        </label>
                      );
                    }
                    const t = item.tpl;
                    const materialized = allDocuments.find((d) => (d.content_json as any)?.source_template_id === t.id || d.name === t.name);
                    const checked = !!materialized && docId === materialized.id;
                    return (
                      <label
                        key={t.id}
                        {...dragProps("doc", item.id)}
                        className={`flex items-center gap-3 p-3 cursor-pointer border-b border-[var(--border)] last:border-b-0 ${
                          checked ? "bg-[var(--primary)]/10" : "hover:bg-[var(--bg-surface)]"
                        } ${materializing ? "opacity-60 pointer-events-none" : ""} ${dropHl}`}
                      >
                        <span className="bulk-wizard-drag-handle" title="드래그로 순서 변경">⠿</span>
                        <input
                          type="radio"
                          name="docId"
                          checked={checked}
                          onChange={() => selectTemplate(t)}
                        />
                        <div className="flex-1">
                          <div className="text-sm text-[var(--text)]">{t.name}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">우리 회사 양식 · 선택 시 문서로 생성</div>
                        </div>
                      </label>
                    );
                  })}
                  {stdSection.length > 0 && (
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-dim)] uppercase bg-[var(--bg-surface)]/60 sticky top-0">양식 관리 — 표준 양식</div>
                  )}
                  {stdSection.map((t: any) => {
                    const rowKey = `std|${t.id}`;
                    const dropHl = dropKey === rowKey ? "ring-1 ring-[var(--primary)]" : "";
                    const materialized = allDocuments.find((d) => (d.content_json as any)?.source_template_id === t.id || d.name === t.name);
                    const checked = !!materialized && docId === materialized.id;
                    return (
                      <label
                        key={t.id}
                        {...dragProps("std", t.id)}
                        className={`flex items-center gap-3 p-3 cursor-pointer border-b border-[var(--border)] last:border-b-0 ${
                          checked ? "bg-[var(--primary)]/10" : "hover:bg-[var(--bg-surface)]"
                        } ${materializing ? "opacity-60 pointer-events-none" : ""} ${dropHl}`}
                      >
                        <span className="bulk-wizard-drag-handle" title="드래그로 순서 변경">⠿</span>
                        <input
                          type="radio"
                          name="docId"
                          checked={checked}
                          onChange={() => selectTemplate(t)}
                        />
                        <div className="flex-1">
                          <div className="text-sm text-[var(--text)]">{t.name}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">양식 · 선택 시 문서로 생성</div>
                        </div>
                      </label>
                    );
                  })}
                </>
              )}
            </div>
            {materializing && <div className="text-xs text-[var(--text-muted)]">양식을 문서로 만드는 중...</div>}
          </div>
        )}

        {/* Step 2: 거래처 */}
        {step === 2 && (
          <div className="bulk-wizard-step-partners">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={pSearch}
                onChange={(e) => setPSearch(e.target.value)}
                placeholder="단체명·담당자 검색"
                className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
              />
              {partnerTypes.length > 0 && (
                <select
                  value={pType}
                  onChange={(e) => setPType(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
                >
                  <option value="">전체 타입</option>
                  {partnerTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              <button
                type="button"
                onClick={() => setShowAddPartner((v) => !v)}
                className="btn-ghost btn-sm shrink-0"
              >
                {showAddPartner ? "닫기" : "+ 거래처 추가"}
              </button>
              <span className="text-xs text-[var(--text-muted)]">{selectedPartnerIds.size}곳 선택</span>
            </div>
            {/* 미등록 거래처를 마법사를 벗어나지 않고 바로 추가 (2026-08-05) */}
            {showAddPartner && (
              <div className="bulk-wizard-add-partner">
                <div className="bulk-wizard-add-partner-grid">
                  <label className="bulk-wizard-add-partner-field">
                    <span>단체명 *</span>
                    <input value={newPartner.name} onChange={(e) => setNewPartner((p) => ({ ...p, name: e.target.value }))} placeholder="(주)네이처랩" autoFocus />
                  </label>
                  <label className="bulk-wizard-add-partner-field">
                    <span>담당자 이메일 *</span>
                    <input value={newPartner.contact_email} onChange={(e) => setNewPartner((p) => ({ ...p, contact_email: e.target.value }))} placeholder="contact@example.com" type="email" />
                  </label>
                  <label className="bulk-wizard-add-partner-field">
                    <span>대표자</span>
                    <input value={newPartner.representative} onChange={(e) => setNewPartner((p) => ({ ...p, representative: e.target.value }))} placeholder="홍길동" />
                  </label>
                  <label className="bulk-wizard-add-partner-field">
                    <span>담당자</span>
                    <input value={newPartner.contact_name} onChange={(e) => setNewPartner((p) => ({ ...p, contact_name: e.target.value }))} placeholder="김담당" />
                  </label>
                  <label className="bulk-wizard-add-partner-field">
                    <span>사업자번호</span>
                    {/* 숫자만 입력해도 하이픈이 붙고, 10자리가 되면 국세청에서 실존·상태를 확인한다 */}
                    <input
                      value={newPartner.business_number}
                      onChange={(e) => setNewPartner((p) => ({ ...p, business_number: formatBizNoInput(e.target.value) }))}
                      placeholder="000-00-00000"
                      inputMode="numeric"
                    />
                    {bizCheck.state !== "idle" && (
                      <span className={`bulk-wizard-bizcheck is-${bizCheck.state}`}>
                        {bizCheck.state === "ok" ? "✓ " : bizCheck.state === "checking" ? "" : "⚠ "}{bizCheck.msg}
                      </span>
                    )}
                  </label>
                  <label className="bulk-wizard-add-partner-field">
                    <span>연락처</span>
                    <input
                      value={newPartner.contact_phone}
                      onChange={(e) => setNewPartner((p) => ({ ...p, contact_phone: formatPhoneInput(e.target.value) }))}
                      placeholder="010-0000-0000"
                      inputMode="numeric"
                    />
                  </label>
                  <label className="bulk-wizard-add-partner-field md:col-span-2">
                    <span>주소</span>
                    <input value={newPartner.address} onChange={(e) => setNewPartner((p) => ({ ...p, address: e.target.value }))} placeholder="서울시 …" />
                  </label>
                </div>
                <div className="flex items-center justify-between gap-2 mt-3">
                  <span className="text-[11px] text-[var(--text-dim)]">
                    대표자·사업자번호·주소는 <code className="text-[var(--primary)]">{`{{을_*}}`}</code> 토큰 치환에 쓰입니다. 계약서에 쓰는 값이면 함께 입력하세요.
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => { setShowAddPartner(false); setNewPartner(emptyNewPartner); }} className="btn-ghost btn-sm">취소</button>
                    <button type="button" onClick={saveNewPartner} disabled={savingPartner} className="btn-primary btn-sm disabled:opacity-50">
                      {savingPartner ? "추가 중..." : "추가하고 선택"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="border border-[var(--border)] rounded-lg max-h-[400px] overflow-y-auto">
              {loadingPartners ? (
                <div className="p-6 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
              ) : filteredPartners.length === 0 ? (
                <div className="p-6 text-center text-sm text-[var(--text-muted)]">
                  {partners.length === 0 ? "등록된 거래처가 없습니다." : "검색 결과가 없습니다."}
                  {!showAddPartner && (
                    <button type="button" onClick={() => setShowAddPartner(true)} className="ml-2 text-[var(--primary)] hover:underline">+ 거래처 추가</button>
                  )}
                </div>
              ) : (
                <table className="bulk-wizard-partner-table">
                  <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)] sticky top-0">
                    <tr className="text-left">
                      <th className="p-2 w-10">
                        <input
                          type="checkbox"
                          checked={
                            filteredPartners.filter((p) => p.contact_email).length > 0 &&
                            filteredPartners.filter((p) => p.contact_email).every((p) => selectedPartnerIds.has(p.id))
                          }
                          onChange={(e) => {
                            setSelectedPartnerIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) {
                                for (const p of filteredPartners) if (p.contact_email) next.add(p.id);
                              } else {
                                for (const p of filteredPartners) next.delete(p.id);
                              }
                              return next;
                            });
                          }}
                        />
                      </th>
                      <th className="p-2 text-xs">단체명</th>
                      <th className="p-2 text-xs">대표자</th>
                      <th className="p-2 text-xs">담당자</th>
                      <th className="p-2 text-xs">이메일</th>
                      <th className="p-2 text-xs">사업자번호</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPartners.map((p) => {
                      const noEmail = !p.contact_email;
                      return (
                        <tr
                          key={p.id}
                          className={`border-t border-[var(--border)] ${
                            noEmail ? "opacity-60" : "hover:bg-[var(--bg-surface)]/40 cursor-pointer"
                          }`}
                          onClick={() => !noEmail && togglePartner(p.id, p)}
                        >
                          <td className="p-2">
                            <input
                              type="checkbox"
                              disabled={noEmail}
                              checked={selectedPartnerIds.has(p.id)}
                              onChange={() => togglePartner(p.id, p)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td className="p-2 text-[var(--text)]">{p.name}</td>
                          <td className="p-2 text-[var(--text-muted)]">{p.representative || "—"}</td>
                          <td className="p-2 text-[var(--text-muted)]">{p.contact_name || "—"}</td>
                          <td className="p-2 text-[var(--text-muted)] text-xs">
                            {p.contact_email ? (
                              p.contact_email
                            ) : (
                              <Link
                                href={`/partners?edit=${p.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-yellow-500 hover:underline"
                                title="이메일을 먼저 등록하세요"
                              >
                                <Ico e="⚠" /> 이메일 등록 필요
                              </Link>
                            )}
                          </td>
                          <td className="p-2 text-[var(--text-muted)] text-xs">{p.business_number || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Step 3: 변수 매핑 */}
        {step === 3 && (
          <div className="bulk-wizard-step-variables">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">
                서명요청 제목 (토큰 사용 가능, 예: <code>{"{{단체명}}"}</code>)
              </label>
              <input
                value={titleTemplate}
                onChange={(e) => { setTitleTemplate(e.target.value); setTitleEdited(true); }}
                placeholder="{{단체명}} - 용역계약서"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
              />
            </div>

            {tokens.length === 0 ? (
              <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-xs text-[var(--text-muted)]">
                계약서·제목에서 <code>{"{{토큰}}"}</code> 형식 변수를 찾지 못했습니다. 그대로 발송됩니다.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-[var(--text-muted)]">
                  발견된 변수 {tokens.length}개 — 각 변수를 거래처 컬럼 또는 공통값에 연결하세요.
                </div>
                {tokens.map((token) => {
                  const col = variableMap[token] ?? "";
                  return (
                    <div key={token} className="bulk-wizard-token-row">
                      <div className="col-span-3 px-2 py-1.5 rounded bg-[var(--bg-surface)] text-xs font-mono text-[var(--primary)]">
                        {`{{${token}}}`}
                      </div>
                      <select
                        value={col}
                        onChange={(e) => setVariableMap((prev) => ({ ...prev, [token]: e.target.value as PartnerVarColumn | "" }))}
                        className="col-span-4 px-2 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]"
                      >
                        <option value="">— 공통값 입력 —</option>
                        {(Object.keys(PARTNER_COLUMN_LABELS) as PartnerVarColumn[]).map((k) => (
                          <option key={k} value={k}>거래처 · {PARTNER_COLUMN_LABELS[k]}</option>
                        ))}
                      </select>
                      {col === "" ? (
                        <input
                          value={commonVariables[token] ?? ""}
                          onChange={(e) => setCommonVariables((prev) => ({ ...prev, [token]: e.target.value }))}
                          placeholder="공통값"
                          className="col-span-5 px-2 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]"
                        />
                      ) : (
                        <div className="col-span-5 text-[10px] text-[var(--text-muted)] px-2">
                          단체별 {PARTNER_COLUMN_LABELS[col]} 값으로 자동 치환
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 단체별 덮어쓰기 표 (접기/펴기) */}
                {selectedPartners.length > 0 && tokens.some((t) => !variableMap[t]) && (
                  <div className="mt-3">
                    <button
                      onClick={() => setShowOverrideTable((v) => !v)}
                      className="text-xs text-[var(--primary)] hover:underline"
                    >
                      {showOverrideTable ? "▾" : "▸"} 단체별 값 덮어쓰기 ({selectedPartners.length}곳)
                    </button>
                    {showOverrideTable && (
                      <div className="mt-2 border border-[var(--border)] rounded-lg overflow-x-auto">
                        <table className="bulk-wizard-override-table">
                          <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                            <tr>
                              <th className="p-2 text-left">단체</th>
                              {tokens.filter((t) => !variableMap[t]).map((t) => (
                                <th key={t} className="p-2 text-left font-mono">{`{{${t}}}`}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {selectedPartners.map((p) => (
                              <tr key={p.id} className="border-t border-[var(--border)]">
                                <td className="p-2 text-[var(--text)] whitespace-nowrap">{p.name}</td>
                                {tokens.filter((t) => !variableMap[t]).map((t) => (
                                  <td key={t} className="p-2">
                                    <input
                                      value={(perPartnerOverrides[p.id] || {})[t] ?? ""}
                                      onChange={(e) =>
                                        setPerPartnerOverrides((prev) => ({
                                          ...prev,
                                          [p.id]: { ...(prev[p.id] || {}), [t]: e.target.value },
                                        }))
                                      }
                                      placeholder={commonVariables[t] || "공통값과 동일"}
                                      className="w-full px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]"
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 4: 발송/만료 */}
        {step === 4 && (
          <div className="bulk-wizard-step-send">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">발송자</label>
              <div className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]">
                현재 로그인 사용자 (자동)
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">만료 기간 (일)</label>
              <input
                type="number"
                min={1}
                max={90}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number(e.target.value) || 14)}
                className="w-32 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]"
              />
              <span className="ml-2 text-xs text-[var(--text-muted)]">기본 14일 · 최대 90일</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text)]">
              <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
              생성 즉시 이메일 발송
            </label>

            {/* 수신 이메일 (거래처별 수정 가능) — 기본=담당자(변수 매핑) 이메일, 다른 곳 발송 시 수정 */}
            <div className="pt-3 border-t border-[var(--border)]">
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">수신 이메일 ({selectedPartners.length}곳)</label>
              <p className="text-[11px] text-[var(--text-dim)] mb-2">기본값은 거래처에 등록된 담당자 이메일입니다. 다른 곳으로 보내려면 직접 수정하세요. (비우면 기본 이메일로 발송)</p>
              <div className="bulk-wizard-email-list">
                {selectedPartners.map((p) => {
                  const val = emailOverrides[p.id] ?? (p.contact_email || "");
                  const changed = emailOverrides[p.id] != null && emailOverrides[p.id].trim() !== String(p.contact_email || "").trim();
                  return (
                    <div key={p.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="text-xs text-[var(--text-muted)] w-32 shrink-0 truncate" title={p.name}>{p.name}</span>
                      <input
                        type="email"
                        value={val}
                        onChange={(e) => setEmailOverrides((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder={p.contact_email || "이메일 입력"}
                        className={`flex-1 px-2 py-1 rounded bg-[var(--bg-surface)] border text-xs text-[var(--text)] ${changed ? "border-[var(--primary)]" : "border-[var(--border)]"}`}
                      />
                      {changed && (
                        <button type="button"
                          onClick={() => setEmailOverrides((prev) => { const n = { ...prev }; delete n[p.id]; return n; })}
                          className="text-[10px] text-[var(--text-dim)] hover:text-[var(--primary)] shrink-0" title="기본(담당자) 이메일로 되돌리기">기본값</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 우리(갑) 직인 적용 */}
            <div className="pt-3 border-t border-[var(--border)]">
              <label className={`flex items-center gap-2 text-sm ${hasCompanySeal === false ? "text-[var(--text-dim)]" : "text-[var(--text)]"}`}>
                <input
                  type="checkbox"
                  checked={applyOurSeal && hasCompanySeal !== false}
                  disabled={hasCompanySeal === false}
                  onChange={(e) => setApplyOurSeal(e.target.checked)}
                />
                발송 전 우리 직인(도장) 적용 — 거래처가 받는 계약서에 우리 도장이 미리 찍힙니다
              </label>
              {hasCompanySeal === false && (
                <div className="mt-1.5 text-[11px] text-amber-500">
                  회사 직인이 등록되지 않았습니다. 회사 설정 → 직인에서 먼저 등록하세요. (지금은 우리 도장 없이 발송됩니다)
                </div>
              )}
              {hasCompanySeal === true && applyOurSeal && (
                <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                  계약서 갑(수행기관) 서명란에 직인이 합성되어 발송됩니다. 거래처는 을 서명만 하면 양방향 완성.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 5: 미리보기 */}
        {step === 5 && (
          <div className="bulk-wizard-step-preview">
            <div className="text-xs text-[var(--text-muted)]">
              아래는 선택한 거래처 중 첫 번째 단체 기준 미리보기입니다. 단체별로 값이 다르게 치환됩니다.
            </div>
            {!previewPartner ? (
              <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-yellow-500 text-sm">
                선택된 거래처가 없습니다.
              </div>
            ) : (
              <>
                <div className="bulk-wizard-preview-card">
                  <div className="text-[10px] text-[var(--text-muted)]">미리보기 대상</div>
                  <div className="text-sm text-[var(--text)] font-semibold">{previewPartner.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">→ {(emailOverrides[previewPartner.id]?.trim() || previewPartner.contact_email)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] mb-1">제목 (치환 결과)</div>
                  <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-sm text-[var(--text)]">
                    {previewTitle || "(빈 제목)"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] mb-1">
                    실제 발송될 계약서 미리보기 ({previewPartner.name} 기준 · 변수 치환 완료)
                  </div>
                  {previewBodyHtml ? (
                    <div className="border border-[var(--border)] rounded-lg bg-white max-h-[440px] overflow-auto p-5">
                      <div dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(previewBodyHtml) }} />
                    </div>
                  ) : (
                    <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-yellow-600 text-xs">
                      이 문서엔 본문이 없어 계약서 미리보기를 표시할 수 없습니다. (제목·변수만 발송됩니다)
                    </div>
                  )}
                </div>
                {tokens.length > 0 && (
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] mb-1">변수 치환 결과</div>
                    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                          <tr>
                            <th className="p-2 text-left">변수</th>
                            <th className="p-2 text-left">치환값</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tokens.map((t) => (
                            <tr key={t} className="border-t border-[var(--border)]">
                              <td className="p-2 font-mono text-[var(--primary)]">{`{{${t}}}`}</td>
                              <td className="p-2 text-[var(--text)]">{previewVars[t] || <span className="text-[var(--text-dim)]">(빈 값)</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div className="p-3 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5 text-xs text-[var(--text)] shadow-sm">
                  총 <b>{selectedPartners.length}곳</b>에 발송됩니다. (이메일 미등록 거래처는 자동 스킵)
                </div>

                {/* 발송 예측 (504 인시던트 3차 후속 — 대량 발송 사전 안내) */}
                <div className="mt-3 px-4 py-3 rounded-xl bg-[var(--info-dim)] border border-[var(--info)]/30 text-[var(--info)] text-xs">
                  <div className="font-semibold mb-1"><Ico e="📊" /> 발송 예측</div>
                  <ul className="space-y-0.5">
                    <li>· 거래처: {selectedPartners.length}개 (이메일 미등록 자동 스킵 후 실 발송 기준)</li>
                    <li>· 예상 소요: 약 {estimateMinutes(selectedPartners.length)}분</li>
                    <li>· chunk: {chunkSizeFor(selectedPartners.length)}건 동시 × 간격 {intervalSecFor(selectedPartners.length)}초</li>
                    <li>· 이메일 발송 한도(Resend 등): 시간당 한도 초과 시 일부 지연 가능</li>
                    {selectedPartners.length > 200 && (
                      <li className="text-[var(--warning)]"><Ico e="⚠" /> 200개 초과 — 분할(예: 150 + 150) 발송 권장</li>
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}

        {/* 진행률 바 (submitting + progress 있을 때만 — 100개+ 대량 발송 가시화) */}
        {submitting && progress && progress.total > 0 && (
          <div className="bulk-wizard-progress-bar">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-[var(--text)] font-semibold">
                거래처 발송 중... {progress.done} / {progress.total} ({Math.round((progress.done / progress.total) * 100)}%)
              </span>
              <span className="text-[var(--text-muted)]">
                성공 {progress.sent} · 실패 {progress.failed}
              </span>
            </div>
            <div className="w-full h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--primary)] transition-all duration-300"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* 푸터 */}
        <div className="bulk-wizard-footer">
          <button
            onClick={onClose}
            className="btn-ghost"
          >
            취소
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                onClick={() => setStep((s) => (s - 1) as 1|2|3|4|5)}
                className="btn-secondary"
              >
                ← 이전
              </button>
            )}
            {step < 5 ? (
              <button
                onClick={() => setStep((s) => (s + 1) as 1|2|3|4|5)}
                disabled={!canNext}
                className="btn-primary"
              >
                다음 →
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting || selectedPartners.length === 0}
                className="btn-primary"
              >
                {submitting ? "발송 중..." : `${selectedPartners.length}곳 일괄 발송`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
