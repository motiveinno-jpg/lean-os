"use client";

//   아직 안 만든 단계의 화면 — **메뉴를 숨기지 않는다**(결정 6).
//   회사마다 쓰는 데가 달라 켜고 끄는 판을 만들지 않기로 했으므로, 안 만든 메뉴는 '비어 있을 뿐'이다.
//   비어 있다면 **무엇을 하는 곳이고 무엇부터 하면 되는지**는 말해 줘야 한다.

import Link from "next/link";
import { QueryScreen, QueryHead, QueryBody } from "@/components/query-kit";

export function InventorySoon({
  title, phase, what, willDo, nowDo,
}: {
  title: string; phase: string; what: string; willDo: string[]; nowDo?: { label: string; href: string };
}) {
  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print"><button type="button" className="collect-tab collect-tab-on">{title}</button></div>
          <div className="report-desc">{what}</div>
        </QueryHead>
        <QueryBody>
          <div className="inv-scroll">
            <div className="inv-soon">
              <span className="inv-soon-phase">{phase}</span>
              <h2 className="inv-soon-title">{title} — 아직 만드는 중입니다</h2>
              <p className="inv-soon-what">{what}</p>
              <ul className="inv-soon-list">
                {willDo.map((w) => <li key={w}>{w}</li>)}
              </ul>
              {nowDo && (
                <p className="inv-soon-now">
                  그때까지는 <Link href={nowDo.href} className="bz-link">{nowDo.label}</Link> 로 하시면 됩니다.
                </p>
              )}
            </div>
          </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}
