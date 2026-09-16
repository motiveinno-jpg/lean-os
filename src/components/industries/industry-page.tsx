// 업종별 페이지 화면 (2026-09-16) — 목업 6f6574b2 그대로.
//   ▸ 서버에서 그린다. 스크롤 연출·자바스크립트 없음(대표: 여기는 애니메이션 많이 필요 없다).
//   ▸ 머리·바닥은 공개 페이지 공용 site-shell(결정 227) — 스타일이 .lp8 에 걸려 있어 그 껍데기로 감싼다.
//   ▸ 스타일은 app/industries.css 안 .ipg 에 갇혀 있어 랜딩·앱과 섞이지 않는다.
import Link from "next/link";
import "@/app/landing-v8.css";
import "@/app/industries.css";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { SIGNUP_HREF, CONSULT_HREF } from "@/components/landing-v8/content";
import { INDUSTRIES, type Industry, type Ui } from "./data";

function Screen({ ui }: { ui: Ui }) {
  return (
    <div className="ipg-ui">
      <div className="ipg-uih">
        {ui.title}
        {ui.badge ? <span className={`ipg-bd ${ui.badge.tone ?? ""}`}>{ui.badge.t}</span> : null}
      </div>
      {ui.rows.map((r, i) => (
        <div className="ipg-row" key={i}>
          <span className="t">{r.t}</span>
          {r.s ? <span className="s">{r.s}</span> : null}
          {r.r ? (
            r.tone && r.tone !== "ind" && ["완료", "정산 완료", "지연", "대기", "수금 완료", "전표 생성", "검토 중", "서명 대기", "보관", "진행 중", "승인", "출고", "이동", "부분 출고"].includes(r.r)
              ? <span className="r"><span className={`ipg-bd ${r.tone}`}>{r.r}</span></span>
              : <span className={`r ${r.tone ?? ""}`}>{r.r}</span>
          ) : null}
        </div>
      ))}
      {ui.kv ? (
        <div className="ipg-kv">{ui.kv.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
      ) : null}
      {ui.bars ? (
        <div className="ipg-bars">{ui.bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
      ) : null}
      {ui.foot ? <div className="ipg-foot">{ui.foot}</div> : null}
    </div>
  );
}

export default function IndustryPage({ data }: { data: Industry }) {
  const d = data;
  return (
    <div className="ipg">
      <div className="lp8"><SiteHeader /></div>

      {/* 히어로 — 실제 화면 위에 카드 세 장 */}
      <section className="ipg-hero">
        <div className="ipg-shot" aria-hidden style={{ backgroundImage: `url(${d.shot})` }} />
        <div className="ipg-veil" aria-hidden />
        <div className="ipg-wrap ipg-heroin">
          <div>
            <p className="ipg-eyebrow">{d.label}</p>
            <h1>{d.title[0]}<br />{d.title[1]}</h1>
            <p className="ipg-hlead">{d.lead}</p>
            <div className="ipg-why">
              {d.why.map(([b, s], i) => (
                <div key={b}><i>{i + 1}</i><span><b>{b}</b><span>{s}</span></span></div>
              ))}
            </div>
            <div className="ipg-btns">
              <Link className="ipg-btn p" href={SIGNUP_HREF} data-cta={`signup:industry_${d.slug}_hero`}>무료로 시작하기 →</Link>
              <Link className="ipg-btn s" href={CONSULT_HREF} data-cta={`consult:industry_${d.slug}_hero`}>{d.name} 도입 상담</Link>
            </div>
            <p className="ipg-hnote">{d.also}</p>
          </div>
          <div className="ipg-vis">
            <div className="main"><Screen ui={d.hero} /></div>
            <div className="card-a"><Screen ui={d.heroA} /></div>
            <div className="card-b"><Screen ui={d.heroB} /></div>
            <p className="cap">{d.heroCap}</p>
          </div>
        </div>
      </section>

      {/* 일하는 순서 */}
      <section className="ipg-sec">
        <div className="ipg-wrap">
          <p className="ipg-eyebrow">일하는 순서</p>
          <h2 className="ipg-h2">{d.flowTitle}</h2>
          <p className="ipg-lead">{d.flowLead}</p>
          <div className="ipg-flow">
            {d.flow.map(([step, todo, menu]) => (
              <div className="ipg-fl" key={step}><small>{step}</small><b>{todo}</b><span>{menu}</span></div>
            ))}
          </div>
        </div>
      </section>

      {/* 특징별 사용법 */}
      <section className="ipg-sec alt">
        <div className="ipg-wrap">
          <p className="ipg-eyebrow">특징별 사용법</p>
          <h2 className="ipg-h2">{d.casesTitle}</h2>
          <p className="ipg-lead">{d.casesLead}</p>
          <div className="ipg-use">
            {d.cases.map((c) => (
              <div className="ipg-uc" key={c.no}>
                <div className="tx">
                  <span className="no">{c.no}</span>
                  <h3>{c.title}</h3>
                  <div className="steps">
                    {c.steps.map((s, i) => (
                      <div key={i}><em>{i + 1}</em><span dangerouslySetInnerHTML={{ __html: s }} /></div>
                    ))}
                  </div>
                  <div className="ipg-chips">{c.chips.map((ch) => <span key={ch}>{ch}</span>)}</div>
                </div>
                <div className="vis"><Screen ui={c.ui} /></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 자주 겪는 문제 + 도입 첫 주 */}
      <section className="ipg-sec">
        <div className="ipg-wrap">
          <p className="ipg-eyebrow">자주 겪는 문제</p>
          <h2 className="ipg-h2">{d.probsTitle}</h2>
          <div className="ipg-probs">
            {d.probs.map(([q, a, p]) => (
              <div className="ipg-pb" key={q}><p className="q">{q}</p><p className="a">{a}</p><p>{p}</p></div>
            ))}
          </div>
          <div className="ipg-start">
            <h3>도입 첫 주, 이 순서대로 하면 됩니다</h3>
            <div className="cols">
              {d.start.map(([when, what, items]) => (
                <div className="col" key={when}>
                  <small>{when}</small><b>{what}</b>
                  <ul>{items.map((it) => <li key={it}>{it}</li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 쓰는 메뉴 + 다른 업종 */}
      <section className="ipg-sec alt">
        <div className="ipg-wrap">
          <p className="ipg-eyebrow">쓰는 메뉴</p>
          <h2 className="ipg-h2">{d.name} 회사가 먼저 켜는 메뉴</h2>
          <p className="ipg-lead">쓰지 않는 메뉴는 감출 수 있습니다. 아래 순서대로 켜면 됩니다.</p>
          <div className="ipg-menus">
            <div className="mg">
              <h4>꼭 쓰는 메뉴</h4>
              <div className="list">{d.menusMain.map(([m, s]) => <div key={m}><b>{m}</b><span>{s}</span></div>)}</div>
            </div>
            <div className="mg">
              <h4>이어서 켜면 좋은 메뉴</h4>
              <div className="list">{d.menusNext.map(([m, s]) => <div key={m}><b>{m}</b><span>{s}</span></div>)}</div>
            </div>
          </div>
          <div className="ipg-others">
            {INDUSTRIES.map((o) => (
              <Link key={o.slug} href={`/industries/${o.slug}`} className={o.slug === d.slug ? "on" : ""}>{o.name}</Link>
            ))}
            <Link href="/features">기능 전체 보기</Link>
          </div>
        </div>
      </section>

      {/* 마무리 */}
      <section className="ipg-fin">
        <div className="ipg-wrap">
          <h2>{d.finTitle}</h2>
          <p>{d.finLead}</p>
          <div className="ipg-btns">
            <Link className="ipg-btn w" href={SIGNUP_HREF} data-cta={`signup:industry_${d.slug}_finale`}>무료로 시작하기 →</Link>
            <Link className="ipg-btn s" href={CONSULT_HREF} data-cta={`consult:industry_${d.slug}_finale`}>도입 상담 신청</Link>
          </div>
        </div>
      </section>
      <p className="ipg-note">화면 속 회사명·거래처·금액은 모두 가상 예시입니다.</p>

      <div className="lp8"><SiteFooter /></div>
    </div>
  );
}
