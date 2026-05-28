"use client";

// 2026-05-28 문서 받는 사람 화면 테스트 (split view 미리보기 모달).
//   좌측: 변수 입력 (자동매핑 라벨 + 거래처 샘플 드롭다운) + 서명자 토큰 안내.
//   우측: 라이브 받는 사람 화면 (html-react-parser + RadioInline/TextInline 인라인).
//   발송·DB 저장 0 — 순수 렌더링 미리보기. /sign 페이지와 동일 렌더 흐름 미러링.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import parse, { type HTMLReactParserOptions } from "html-react-parser";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { injectContractInlineStyles } from "@/lib/signatures";
import { parseSiyanFields } from "@/lib/signature-fields";
import {
  buildPartnerReplacements,
  applyTokenReplacements,
  extractTokens,
  autoMapToken,
  PARTNER_COLUMN_LABELS,
  type PartnerLike,
} from "@/lib/signer-replacements";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const RADIO_TOKEN_RE_LOCAL = /\{\{\s*\?라디오\s*:\s*([^}]+?)\s*\}\}/g;
const TEXT_TOKEN_RE_LOCAL = /\{\{\s*\?텍스트\s*:\s*([^}]+?)\s*\}\}/g;

// ── 라이브 입력 컴포넌트 (sign/page.tsx 와 동일 패턴) ──
function RadioInline({ field, value, onChange }: {
  field: { key: string; options: string[] };
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "6px 14px", verticalAlign: "middle" }}>
      {field.options.map((opt) => (
        <label key={opt} style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 13, userSelect: "none" }}>
          <input type="radio" name={field.key} value={opt} checked={value === opt} onChange={() => onChange(opt)} style={{ accentColor: "#4f46e5", margin: 0 }} />
          <span style={{ color: value === opt ? "#4f46e5" : "#334155", fontWeight: value === opt ? 600 : 400 }}>{opt}</span>
        </label>
      ))}
    </span>
  );
}

function TextInline({ field, value, onChange, active }: {
  field: { key: string };
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
      style={{ display: "inline-block", minWidth: 180, padding: "2px 8px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 13, verticalAlign: "middle", outline: "none", marginLeft: 4 }}
    />
  );
}

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

// ── 본문 HTML → React tree (토큰 자리에 RadioInline/TextInline mount) ──
function renderLivePreview(
  html: string,
  signerInputs: Record<string, string>,
  setSignerInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>,
): React.ReactNode {
  const styled = injectContractInlineStyles(html);
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
            <RadioInline key={`r-${key}-${match.idx}`} field={{ key, options }} value={signerInputs[key] || ""} onChange={(v) => setSignerInputs((p) => ({ ...p, [key]: v }))} />,
          );
        }
      } else {
        const { key, when } = parseTextInner(match.inner);
        if (key) {
          const active = !when || signerInputs[when.key] === when.value;
          parts.push(
            <TextInline key={`t-${key}-${match.idx}`} field={{ key }} value={signerInputs[key] || ""} onChange={(v) => setSignerInputs((p) => ({ ...p, [key]: v }))} active={active} />,
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
      if ((node as { type?: string }).type === "text") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = (node as any).data as string;
        if (text && (RADIO_TOKEN_RE_LOCAL.test(text) || TEXT_TOKEN_RE_LOCAL.test(text))) {
          RADIO_TOKEN_RE_LOCAL.lastIndex = 0;
          TEXT_TOKEN_RE_LOCAL.lastIndex = 0;
          return <>{replaceTokensInText(text)}</>;
        }
      }
      return undefined;
    },
  };

  return parse(styled, options);
}

// ============================================================================
// 메인 컴포넌트

export interface DocumentTestPreviewProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any | null; // documents row { id, name, content_json: { body, ... } }
  onClose: () => void;
}

export function DocumentTestPreview({ doc, onClose }: DocumentTestPreviewProps) {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;

  // 본문 HTML 추출
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cj = (doc?.content_json as any) || {};
  const rawBody: string = typeof cj.body === "string" ? cj.body : "";

  // 토큰 추출 — 일반 변수 + ?-prefix 서명자 필드
  const tokens = useMemo(() => extractTokens(rawBody, cj.title || ""), [rawBody, cj.title]);
  const signerFields = useMemo(() => parseSiyanFields(rawBody).fields, [rawBody]);

  // 상태 — 좌측 변수 입력 / 우측 서명자 라디오·텍스트
  const [testVariables, setTestVariables] = useState<Record<string, string>>({});
  const [testSignerInputs, setTestSignerInputs] = useState<Record<string, string>>({});

  // 토큰 변경 시 누락 키 초기화
  useEffect(() => {
    setTestVariables((prev) => {
      const next: Record<string, string> = {};
      for (const t of tokens) next[t] = prev[t] ?? "";
      return next;
    });
  }, [tokens]);

  // 회사·거래처 fetch (드롭다운 + 회사 정보)
  const { data: company } = useQuery({
    queryKey: ["doc-test-preview-company", companyId],
    queryFn: async () => {
      const { data } = await db.from("companies").select("name, business_number, representative, address").eq("id", companyId).maybeSingle();
      return data || null;
    },
    enabled: !!companyId,
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["doc-test-preview-partners", companyId],
    queryFn: async () => {
      const { data } = await db.from("partners")
        .select("id, name, business_number, representative, contact_name, contact_email, contact_phone, address")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data || []) as PartnerLike[];
    },
    enabled: !!companyId,
  });

  // 거래처 선택 → testVariables 자동 채움
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>("");
  const fillFromPartner = (partnerId: string) => {
    setSelectedPartnerId(partnerId);
    if (!partnerId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pn = (partners as any[]).find((p) => p.id === partnerId);
    if (!pn) return;
    const replacements = buildPartnerReplacements(company || null, pn);
    setTestVariables((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const t of tokens) {
        if (t in replacements && replacements[t]) next[t] = replacements[t];
      }
      return next;
    });
  };

  // 우측 라이브 미리보기 — 본문에 testVariables 적용 후 토큰 치환
  const previewBody = useMemo(() => {
    if (!rawBody) return "";
    // testVariables 를 replacements 와 합성 (사용자 직접 입력 우선)
    const auto = buildPartnerReplacements(company || null, null);
    const merged: Record<string, string> = { ...auto };
    for (const [k, v] of Object.entries(testVariables)) {
      if (v) merged[k] = v;
    }
    return applyTokenReplacements(rawBody, merged);
  }, [rawBody, testVariables, company]);

  // ESC 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!doc) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch justify-center p-2 sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-7xl bg-[var(--bg-card)] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-gradient-to-r from-blue-600/10 to-cyan-500/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg">🔍</span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-[var(--text)] truncate">받는 사람 화면 테스트</h2>
              <p className="text-xs text-[var(--text-muted)] truncate">{doc.name || cj.title || "(이름 없음)"}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] transition shrink-0"
            title="닫기 (ESC)"
            aria-label="닫기"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M6 18L18 6" /></svg>
          </button>
        </div>

        {/* Split body */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
          {/* ── 좌측: 변수 입력 패널 ── */}
          <div className="overflow-y-auto p-5 bg-[var(--bg-surface)] border-r border-[var(--border)]">
            <div className="mb-4">
              <h3 className="text-xs font-bold text-[var(--text)] mb-1">변수 입력 (테스트용)</h3>
              <p className="text-[11px] text-[var(--text-muted)]">실제 발송이 아닙니다. 입력값은 우측 미리보기에만 반영됩니다.</p>
            </div>

            {/* 거래처 샘플 드롭다운 */}
            {partners.length > 0 && (
              <div className="mb-4 p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">거래처 샘플로 채우기</label>
                <select
                  value={selectedPartnerId}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onChange={(e) => fillFromPartner(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
                >
                  <option value="">— 거래처 선택 —</option>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(partners as any[]).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 일반 변수 input 들 */}
            {tokens.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)] py-4 text-center">본문에 변수 토큰이 없습니다.</div>
            ) : (
              <div className="space-y-3">
                {tokens.map((tk) => {
                  const mapped = autoMapToken(tk);
                  const mappedLabel = mapped ? PARTNER_COLUMN_LABELS[mapped] : null;
                  return (
                    <div key={tk}>
                      <div className="flex items-center gap-2 mb-1">
                        <code className="text-[11px] font-mono text-[var(--primary)] bg-[var(--primary)]/10 px-1.5 py-0.5 rounded">{`{{${tk}}}`}</code>
                        {mappedLabel ? (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400">→ {mappedLabel}</span>
                        ) : (
                          <span className="text-[10px] text-[var(--text-dim)]">직접 입력</span>
                        )}
                      </div>
                      <input
                        type="text"
                        value={testVariables[tk] || ""}
                        onChange={(e) => setTestVariables((p) => ({ ...p, [tk]: e.target.value }))}
                        placeholder={mappedLabel || tk}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* ?-prefix 서명자 토큰 안내 */}
            {signerFields.length > 0 && (
              <div className="mt-5 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">서명자가 직접 선택·입력하는 토큰</p>
                <ul className="space-y-1.5">
                  {signerFields.map((f) => (
                    <li key={f.key} className="text-[11px] text-amber-700 dark:text-amber-200">
                      {f.kind === "radio" ? "● 라디오 " : "✏ 텍스트 "}
                      <code className="font-mono">{f.key}</code>
                      {f.kind === "radio" && (
                        <span className="text-amber-600/80 dark:text-amber-300/70"> · 옵션 {f.options.length}개</span>
                      )}
                      {f.kind === "text" && f.when && (
                        <span className="text-amber-600/80 dark:text-amber-300/70"> · 조건: {f.when.key}={f.when.value}</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-amber-700/80 dark:text-amber-300/70 mt-2">→ 우측 미리보기에서 직접 선택·입력해보세요</p>
              </div>
            )}
          </div>

          {/* ── 우측: 라이브 미리보기 ── */}
          <div className="overflow-y-auto bg-white">
            <div className="px-5 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
              <h3 className="text-xs font-bold text-gray-800">받는 사람이 보는 화면 (라이브)</h3>
            </div>
            <div className="p-6">
              {cj.title && (
                <h2 className="text-xl font-bold text-center text-gray-900 mb-6 pb-4 border-b border-gray-100">{cj.title}</h2>
              )}
              {rawBody ? (
                /^\s*</.test(rawBody) ? (
                  <div className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none">
                    {renderLivePreview(previewBody, testSignerInputs, setTestSignerInputs)}
                  </div>
                ) : (
                  <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{previewBody}</div>
                )
              ) : (
                <div className="text-sm text-gray-400 text-center py-12">본문이 비어있습니다.</div>
              )}
            </div>
            <div className="mx-6 mb-6 p-3 rounded-lg bg-blue-50 border border-blue-200 text-[11px] text-blue-800 flex items-start gap-2">
              <span className="text-base leading-none">💡</span>
              <span>이 화면이 받는 사람에게 그대로 이메일로 발송됩니다. 라디오·텍스트는 받는 사람이 직접 선택·입력하는 영역이며, 위 입력값은 미리보기에만 반영됩니다(실제 발송 X).</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

