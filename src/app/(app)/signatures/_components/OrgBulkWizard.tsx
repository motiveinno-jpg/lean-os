"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBulkSignatureRequestsToOrgs, normalizeVariableTokens, buildOrgContractSnapshotHtml, type PartnerVarColumn } from "@/lib/signatures";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";

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
  onClose,
  onCreated,
}: {
  companyId: string;
  userId: string;
  documents: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [submitting, setSubmitting] = useState(false);
  // 100개+ 대량 발송 진행률 (chunk 완료마다 갱신)
  const [progress, setProgress] = useState<{ done: number; total: number; sent: number; failed: number } | null>(null);

  // Step 1: 계약서 선택
  const [docId, setDocId] = useState<string>("");
  const selectedDoc = useMemo(() => documents.find((d) => d.id === docId), [documents, docId]);

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
        const { data } = await supabase
          .from("partners")
          .select("id, name, type, representative, contact_name, contact_email, contact_phone, business_number, address")
          .eq("company_id", companyId)
          .order("name", { ascending: true });
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
  // 2026-05-22 발송 전 우리(갑) 직인 적용 — 거래처가 받는 계약서에 우리 도장 미리 찍힘.
  const [applyOurSeal, setApplyOurSeal] = useState(true);
  // 회사(갑) 정보 — 미리보기 갑 변수 치환 + 직인 합성에 사용
  const [company, setCompany] = useState<{ name?: string | null; business_number?: string | null; representative?: string | null; address?: string | null; seal_url?: string | null } | null>(null);
  const hasCompanySeal = company === null ? null : !!company.seal_url;
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await (supabase as any)
        .from("companies")
        .select("name, business_number, representative, address, seal_url")
        .eq("id", companyId)
        .maybeSingle();
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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

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

  // ── 렌더 ──
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-h-[92vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 + 단계 인디케이터 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)]">단체 일괄 서명 발송</h2>
            <p className="text-xs text-[var(--text-muted)]">
              여러 거래처(미가입 단체)에 같은 계약서를 변수만 다르게 채워 한 번에 발송합니다.
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl">×</button>
        </div>

        <div className="flex items-center gap-1 mb-5 text-[11px]">
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
          <div className="space-y-3">
            <div className="text-sm font-semibold text-[var(--text)]">발송할 계약서를 선택하세요</div>
            <div className="text-xs text-[var(--text-muted)]">
              이미 작성된 계약서만 선택할 수 있습니다. 새 계약서가 필요하면 먼저{" "}
              <Link href="/documents" className="text-[var(--primary)] hover:underline">문서함</Link>
              에서 양식(서비스/공급/컨설팅 등) 기반으로 작성해 주세요.
              <br />
              <span className="text-[10px] text-[var(--text-dim)]">
                💡 변수 토큰 <code className="text-[var(--primary)]">{`{{을_회사명}}`}</code> / <code className="text-[var(--primary)]">{`{{을_사업자번호}}`}</code> / <code className="text-[var(--primary)]">{`{{을_대표자}}`}</code> / <code className="text-[var(--primary)]">{`{{을_주소}}`}</code> 는 거래처별 자동 치환됩니다. <code className="text-[var(--primary)]">{`{{갑_*}}`}</code> 는 회사 공통값.
              </span>
            </div>
            <div className="border border-[var(--border)] rounded-lg max-h-[360px] overflow-y-auto">
              {documents.length === 0 ? (
                <div className="p-6 text-center text-sm text-[var(--text-muted)]">작성된 문서가 없습니다.</div>
              ) : (
                documents.map((d) => (
                  <label
                    key={d.id}
                    className={`flex items-center gap-3 p-3 cursor-pointer border-b border-[var(--border)] last:border-b-0 ${
                      docId === d.id ? "bg-[var(--primary)]/10" : "hover:bg-[var(--bg-surface)]"
                    }`}
                  >
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
                ))
              )}
            </div>
          </div>
        )}

        {/* Step 2: 거래처 */}
        {step === 2 && (
          <div className="space-y-3">
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
              <span className="text-xs text-[var(--text-muted)]">{selectedPartnerIds.size}곳 선택</span>
            </div>
            <div className="border border-[var(--border)] rounded-lg max-h-[400px] overflow-y-auto">
              {loadingPartners ? (
                <div className="p-6 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
              ) : filteredPartners.length === 0 ? (
                <div className="p-6 text-center text-sm text-[var(--text-muted)]">거래처가 없습니다.</div>
              ) : (
                <table className="w-full text-sm">
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
                                ⚠ 이메일 등록 필요
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
          <div className="space-y-4">
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
                    <div key={token} className="grid grid-cols-12 gap-2 items-center">
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
                        <table className="text-xs w-full">
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
          <div className="space-y-4">
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
          <div className="space-y-4">
            <div className="text-xs text-[var(--text-muted)]">
              아래는 선택한 거래처 중 첫 번째 단체 기준 미리보기입니다. 단체별로 값이 다르게 치환됩니다.
            </div>
            {!previewPartner ? (
              <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-yellow-500 text-sm">
                선택된 거래처가 없습니다.
              </div>
            ) : (
              <>
                <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] space-y-2">
                  <div className="text-[10px] text-[var(--text-muted)]">미리보기 대상</div>
                  <div className="text-sm text-[var(--text)] font-semibold">{previewPartner.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">→ {previewPartner.contact_email}</div>
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
                      <div dangerouslySetInnerHTML={{ __html: previewBodyHtml }} />
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
                <div className="p-3 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5 text-xs text-[var(--text)]">
                  총 <b>{selectedPartners.length}곳</b>에 발송됩니다. (이메일 미등록 거래처는 자동 스킵)
                </div>

                {/* 발송 예측 (504 인시던트 3차 후속 — 대량 발송 사전 안내) */}
                <div className="mt-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs">
                  <div className="font-semibold mb-1">📊 발송 예측</div>
                  <ul className="space-y-0.5">
                    <li>· 거래처: {selectedPartners.length}개 (이메일 미등록 자동 스킵 후 실 발송 기준)</li>
                    <li>· 예상 소요: 약 {estimateMinutes(selectedPartners.length)}분</li>
                    <li>· chunk: {chunkSizeFor(selectedPartners.length)}건 동시 × 간격 {intervalSecFor(selectedPartners.length)}초</li>
                    <li>· 이메일 발송 한도(Resend 등): 시간당 한도 초과 시 일부 지연 가능</li>
                    {selectedPartners.length > 200 && (
                      <li className="text-yellow-300">⚠️ 200개 초과 — 분할(예: 150 + 150) 발송 권장</li>
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}

        {/* 진행률 바 (submitting + progress 있을 때만 — 100개+ 대량 발송 가시화) */}
        {submitting && progress && progress.total > 0 && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
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
        <div className="flex items-center justify-between gap-2 mt-6 pt-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] text-sm"
          >
            취소
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                onClick={() => setStep((s) => (s - 1) as 1|2|3|4|5)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text)] text-sm"
              >
                ← 이전
              </button>
            )}
            {step < 5 ? (
              <button
                onClick={() => setStep((s) => (s + 1) as 1|2|3|4|5)}
                disabled={!canNext}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                다음 →
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting || selectedPartners.length === 0}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "발송 중..." : `🚀 ${selectedPartners.length}곳 일괄 발송`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
