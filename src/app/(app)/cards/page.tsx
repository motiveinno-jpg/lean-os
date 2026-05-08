"use client";

import { TransactionsView } from "../transactions/page";

export default function CardsPage() {
  return <TransactionsView initialTab="cards" visibleTabs={["cards"]} />;
}
