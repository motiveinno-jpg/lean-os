"use client";

import { TransactionsView } from "../transactions/page";

// /bank — 통장 뷰 (granter 계좌 스타일 개요 포함). TransactionsView 기본값 = inbox + BANK_TABS.
export default function BankPage() {
  return <TransactionsView />;
}
