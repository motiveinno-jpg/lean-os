"use client";

// ── 계정과목 고르기 — 검색(이름·코드)해서 고른다 (2026-08-27 사장님: "카드 전표처리도 계정과목 검색과 계정코드로 입력 가능하게") ──
//   native <select> 는 계정이 90개면 스크롤로만 찾는다. 수집·전표 통장 탭과 같은 PickList(↑↓ Enter · 이름/코드 검색)를 쓴다.
//   전표 모달(카드·통장 일괄)이 같이 쓴다 — 계정 고르는 모양이 화면마다 달라지지 않게.

import { useState } from "react";
import { PickList } from "@/components/pick-list";

export type PickAcct = { id: string; code: string; name: string; account_type?: string | null };

export function AccountPicker({ accounts, value, onChange, placeholder = "계정과목 고르기 (이름·코드 검색)", natureLabel }: {
  accounts: PickAcct[]; value: string; onChange: (id: string, acct: PickAcct | null) => void; placeholder?: string;
  /** 비용이 아닌 계정은 이름 뒤에 성격을 적는다 — 고르면 손익계산서에 안 잡힌다 */
  natureLabel?: (t: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const picked = accounts.find((a) => a.id === value) || null;
  const items = accounts.map((a) => ({
    id: a.id, code: String(a.code),
    name: `${a.name}${natureLabel && a.account_type && a.account_type !== "expense" ? ` · ${natureLabel(a.account_type)}` : ""}`,
  }));
  return (
    <span className="acct-picker">
      <button type="button" className={picked ? "ev-acct acct-picker-btn" : "ev-acct ev-acct-empty acct-picker-btn"} onClick={() => setOpen((v) => !v)}>
        {picked ? `${picked.code} ${picked.name}` : placeholder}
      </button>
      {open && (
        <PickList items={items} placeholder="계정과목 검색 (이름·코드)"
          onPick={(it) => { onChange(it.id, accounts.find((a) => a.id === it.id) || null); setOpen(false); }}
          onClose={() => setOpen(false)} />
      )}
    </span>
  );
}
