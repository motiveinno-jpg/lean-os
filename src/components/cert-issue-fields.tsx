"use client";

// 증명서 발급 시 용도·제출처 선택 필드 (2026-07-29 사장님 — 표준 발급 서식 참고)
//   용도: 대출/신원확인/신용카드발급/비자발급/타사이직 + 사용자입력(직접 입력)
//   제출처: 금융기관/학교/대사관 + 사용자입력(직접 입력)
//   마이페이지(내 증명서)와 직원관리(증명서 발급 모달)가 공용.

import { useEffect, useState } from "react";

export const CERT_PURPOSE_OPTIONS = ["대출", "신원확인", "신용카드발급", "비자발급", "타사이직"];
export const CERT_SUBMIT_TO_OPTIONS = ["금융기관", "학교", "대사관"];

const CUSTOM = "사용자입력";

export function CertChoiceField({ label, options, value, onChange }: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [sel, setSel] = useState("");
  const [custom, setCustom] = useState("");

  // 발급 후 부모가 값을 비우면(리셋) 내부 선택도 초기화
  useEffect(() => {
    if (!value) { setSel(""); setCustom(""); }
  }, [value]);

  const emit = (nextSel: string, nextCustom: string) => {
    onChange(nextSel === CUSTOM ? nextCustom.trim() : nextSel);
  };

  return (
    <div>
      <label className="block text-xs text-[var(--text-muted)] mb-1">{label} (선택)</label>
      <div className="cert-choice-field-row">
        <select
          value={sel}
          onChange={(e) => { const v = e.target.value; setSel(v); emit(v, custom); }}
          className="field-input"
        >
          <option value="">선택 안 함</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={CUSTOM}>직접 입력</option>
        </select>
        {sel === CUSTOM && (
          <input
            value={custom}
            onChange={(e) => { setCustom(e.target.value); emit(CUSTOM, e.target.value); }}
            placeholder={`${label} 직접 입력`}
            className="field-input"
            autoFocus
          />
        )}
      </div>
    </div>
  );
}
