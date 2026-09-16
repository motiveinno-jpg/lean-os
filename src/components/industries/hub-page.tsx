// 업종군 페이지 (2026-09-16 2차) — /industries/<업종군>. 세부 업종 페이지로 보내는 짧은 안내.
//   ▸ 1차에서 이 주소가 전체 내용을 담고 있었다. 이제 자세한 내용은 세부 업종 페이지에 있고,
//     여기는 어느 업종을 고르면 되는지 알려 주는 자리다(같은 내용을 두 곳에 두지 않는다).
import Link from "next/link";
import "@/app/landing-v8.css";
import "@/app/industries.css";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { SIGNUP_HREF, CONSULT_HREF } from "@/components/landing-v8/content";
import { BY_PARENT, PARENTS } from "./index";
import type { Parent } from "./model";

export default function HubPage({ parent }: { parent: Parent }) {
  const subs = BY_PARENT.get(parent.key) ?? [];
  return (
    <div className={`ipg ipg-${parent.key}`}>
      <div className="lp8"><SiteHeader /></div>

      <section className="ipg-hero short">
        <div className="ipg-shot" aria-hidden style={{ backgroundImage: `url(${parent.shot})` }} />
        <div className="ipg-veil" aria-hidden />
        <div className="ipg-wrap">
          <p className="ipg-eyebrow">업종별 활용</p>
          <h1>{parent.name}</h1>
          <p className="ipg-hlead">{parent.lead}</p>
          <div className="ipg-btns">
            <Link className="ipg-btn p" href={SIGNUP_HREF} data-cta={`signup:industry_hub_${parent.key}`}>무료로 시작하기 →</Link>
            <Link className="ipg-btn s" href={CONSULT_HREF} data-cta={`consult:industry_hub_${parent.key}`}>도입 상담</Link>
          </div>
        </div>
      </section>

      <section className="ipg-sec"><div className="ipg-wrap">
        <p className="ipg-eyebrow">세부 업종</p>
        <h2 className="ipg-h2">우리 회사와 가까운 쪽을 고르세요</h2>
        <p className="ipg-lead">업종마다 일하는 순서와 먼저 켤 메뉴가 다릅니다. 고르면 그 업종의 사용법으로 갑니다.</p>
        <div className="ipg-cards">
          {subs.map((s) => (
            <Link key={s.slug} href={`/industries/${s.slug}`}>
              <small>{s.name}</small>
              <b>{s.title[0]} {s.title[1]}</b>
              <p>{s.lead}</p>
              <span className="go">활용법 보기 →</span>
            </Link>
          ))}
        </div>
        <div className="ipg-others">
          {PARENTS.map((p) => (
            <Link key={p.key} href={`/industries/${p.key}`} className={p.key === parent.key ? "on" : ""}>{p.name}</Link>))}
          <Link href="/industries">업종 전체</Link>
        </div>
      </div></section>

      <section className="ipg-fin"><div className="ipg-wrap">
        <h2>업종에 맞게 시작하세요</h2>
        <p>필요 없는 메뉴는 감추고, 쓰는 메뉴부터 켜면 됩니다.</p>
        <div className="ipg-btns">
          <Link className="ipg-btn w" href={SIGNUP_HREF} data-cta={`signup:industry_hub_${parent.key}_finale`}>무료로 시작하기 →</Link>
          <Link className="ipg-btn s" href={CONSULT_HREF} data-cta={`consult:industry_hub_${parent.key}_finale`}>도입 상담 신청</Link>
        </div>
      </div></section>

      <div className="lp8"><SiteFooter /></div>
    </div>
  );
}
