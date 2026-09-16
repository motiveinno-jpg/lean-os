// 업종 페이지 화면 (2026-09-16 2차) — 목업 7cb87224 그대로.
//   ▸ 서버에서 그린다. 스크롤 연출은 없고, 히어로 그림 안에서만 CSS 로 움직인다(대표: 아래쪽엔 애니메이션 없음).
//   ▸ 히어로는 업종군마다 다른 그림(7종), 본문 섹션도 업종군마다 골라 쓴다.
//   ▸ 머리·바닥은 공개 페이지 공용 site-shell(결정 227) — .lp8 껍데기로 감싼다.
import Link from "next/link";
import "@/app/landing-v8.css";
import "@/app/industries.css";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { SIGNUP_HREF, CONSULT_HREF } from "@/components/landing-v8/content";
import { INDUSTRIES, PARENT_BY_KEY } from "./index";
import type { Hero, Industry, Section, Ui } from "./model";

/* ── 화면 흉내 한 장 ─────────────────────────────── */
function Screen({ ui }: { ui: Ui }) {
  return (
    <div className="ipg-ui">
      <div className="ipg-uih">{ui.title}{ui.badge ? <span className={`ipg-bd ${ui.badge.tone ?? ""}`}>{ui.badge.t}</span> : null}</div>
      {ui.rows.map((r, i) => (
        <div className="ipg-row" key={i}>
          <span className="t">{r.t}</span>
          {r.s ? <span className="s">{r.s}</span> : null}
          {r.r ? (r.badge
            ? <span className="r"><span className={`ipg-bd ${r.tone ?? ""}`}>{r.r}</span></span>
            : <span className={`r ${r.tone ?? ""}`}>{r.r}</span>) : null}
        </div>
      ))}
      {ui.kv ? <div className="ipg-kv">{ui.kv.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div> : null}
      {ui.bars ? <div className="ipg-bars">{ui.bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div> : null}
      {ui.foot ? <div className="ipg-foot">{ui.foot}</div> : null}
    </div>
  );
}

/* ── 히어로 그림 일곱 가지 ───────────────────────── */
function HeroArt({ hero }: { hero: Hero }) {
  if (hero.kind === "pipeline") return (
    <div className="ipg-pipe">
      {hero.nodes.map(([t, s, v], i) => (
        <div key={t}>
          <div className={`node${hero.hot === i ? " hot" : ""}`}>
            <i>{i + 1}</i><div><b>{t}</b><span>{s}</span></div><em>{v}</em>
          </div>
          {i < hero.nodes.length - 1 ? <div className="link"><i /></div> : null}
        </div>
      ))}
    </div>
  );
  if (hero.kind === "inbox") return (
    <div className="ipg-inbox">
      <div className="tiles">{hero.tiles.map(([n, v], i) => (
        <div key={n}><small><i className={`d${i}`} />{n}</small><b>{v}</b></div>))}</div>
      <div className="ordbox">
        <div className="h">오늘 들어온 주문<span>수집 완료</span></div>
        {hero.orders.map(([t, v, tone], i) => (
          <div className="o" key={t} style={{ animationDelay: `${i * 0.5}s` }}><i className={tone} />{t}<b>{v}</b></div>))}
        <div className="foot">{hero.foot.map(([k, v]) => <span key={k}>{k} <b>{v}</b></span>)}</div>
      </div>
      <div className="gauges">{hero.gauges.map(([n, v, w]) => (
        <div key={n}><small>{n}</small><b>{v}</b><div className="bar"><i style={{ width: `${w}%` }} /></div></div>))}</div>
    </div>
  );
  if (hero.kind === "board") return (
    <div className="ipg-boardwrap">
      <div className="ipg-board">{hero.cols.map(([name, color, cards]) => (
        <div className="col" key={name}>
          <h5><i style={{ background: color }} />{name}</h5>
          {cards.map(([t, s], i) => <div className={`k${i === 0 ? " move" : ""}`} key={t}><b>{t}</b><span>{s}</span></div>)}
        </div>))}
      </div>
      <div className="ipg-gantt">{hero.gantt.map(([n, l, w]) => (
        <div className="g" key={n}><span>{n}</span><div className="track"><i style={{ left: `${l}%`, width: `${w}%` }} /></div></div>))}
      </div>
    </div>
  );
  if (hero.kind === "site") return (
    <div className="ipg-site">
      <h5>{hero.name}<span>{hero.progress}</span></h5>
      {hero.rows.map(([n, l, w, pin]) => (
        <div className="gr" key={n}><span>{n}</span>
          <div className="tr"><i style={{ left: `${l}%`, width: `${w}%` }} />{pin !== null ? <span className="pin" style={{ left: `${pin}%` }} /> : null}</div>
        </div>))}
      <div className="money">{hero.money.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
    </div>
  );
  if (hero.kind === "grid") return (
    <div className="ipg-whgrid">
      <div className="cells">{hero.cells.map(([n, v, tone]) => (
        <div className={`cell ${tone}`} key={n}><small>{n}</small><b>{v}</b></div>))}</div>
      <div className="note">{hero.note.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
    </div>
  );
  if (hero.kind === "log") return (
    <div className="ipg-loghero">
      <div className="h">{hero.head[0]}<span>{hero.head[1]}</span></div>
      {hero.rows.map(([time, what, detail, tone], i) => (
        <div className="lr" key={time + what} style={{ animationDelay: `${i * 0.4}s` }}>
          <time>{time}</time><b>{what}</b><span>{detail}</span><i className={tone} />
        </div>))}
      <div className="kv">{hero.kv.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
    </div>
  );
  // month
  const marks = new Map(hero.marks.map((m) => [m[0], m]));
  return (
    <div className="ipg-monthhero">
      <div className="cal">
        {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => {
          const m = marks.get(d);
          return <div key={d} className={`d${m ? ` on ${m[2]}` : ""}`}><span>{d}</span>{m ? <em>{m[1]}</em> : null}</div>;
        })}
      </div>
      <div className="side">{hero.side.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
    </div>
  );
}

/* ── 본문 섹션 ───────────────────────────────────── */
function Head({ eyebrow, title, lead }: { eyebrow?: string; title: string; lead?: string }) {
  return (<>
    {eyebrow ? <p className="ipg-eyebrow">{eyebrow}</p> : null}
    <h2 className="ipg-h2">{title}</h2>
    {lead ? <p className="ipg-lead">{lead}</p> : null}
  </>);
}

function Block({ s, slug }: { s: Section; slug: string }) {
  switch (s.kind) {
    case "flow": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className="ipg-flow">{s.steps.map(([a, b, c]) => (
        <div className="ipg-fl" key={a}><small>{a}</small><b>{b}</b><span>{c}</span></div>))}</div>
    </>);
    case "cases": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className="ipg-use">{s.items.map((c) => (
        <div className="ipg-uc" key={c.no}>
          <div className="tx">
            <span className="no">{c.no}</span>
            <h3>{c.title}</h3>
            <div className="steps">{c.steps.map((st, i) => (
              <div key={i}><em>{i + 1}</em><span dangerouslySetInnerHTML={{ __html: st }} /></div>))}</div>
            <div className="ipg-chips">{c.chips.map((ch) => <span key={ch}>{ch}</span>)}</div>
          </div>
          <div className="vis"><Screen ui={c.ui} /></div>
        </div>))}</div>
    </>);
    case "clock": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className="ipg-clock">{s.slots.map(([t, b, p, mini]) => (
        <div key={t}><time>{t}</time><b>{b}</b><p>{p}</p>
          <div className="mini">{mini.map(([k, v]) => <span key={k}>{k}<b>{v}</b></span>)}</div>
        </div>))}</div>
    </>);
    case "calc": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className="ipg-calc">
        <div className="stack">
          {s.rows.map(([lab, pct, val, color]) => (
            <div className="row" key={lab}><span className="lab">{lab}</span>
              <span className="bar"><i style={{ width: `${pct}%`, background: color }} /></span>
              <span className="val">{val}</span></div>))}
          <div className="row sum"><span className="lab">{s.sum[0]}</span>
            <span className="bar"><i style={{ width: `${s.sum[1]}%`, background: "#34d399" }} /></span>
            <span className="val">{s.sum[2]}</span></div>
        </div>
        <div className="cmp">
          {s.compare.map(([n, sub, v, tone]) => (
            <div key={n}><small>{n}</small><b>{sub}</b><em className={tone}>{v}</em></div>))}
          {s.note ? <div className="note"><small>한 줄 정리</small><b>{s.note}</b></div> : null}
        </div>
      </div>
    </>);
    case "checks": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className="ipg-checks">{s.items.map(([t, d], i) => (
        <div key={t}><i>{i + 1}</i><div><b>{t}</b><span>{d}</span></div></div>))}</div>
    </>);
    case "signal": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className="ipg-signal">{s.groups.map((g) => (
        <div className={`sg ${g.tone}`} key={g.title}>
          <h4><i />{g.title}<span>{g.count}</span></h4>
          {g.items.map(([n, d]) => <div className="si" key={n}><b>{n}</b><span>{d}</span></div>)}
        </div>))}</div>
    </>);
    case "table": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className="ipg-tablewrap">
        <table className="ipg-table">
          <thead><tr>{s.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{s.rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={j === 0 ? "first" : ""}>{c}</td>)}</tr>))}</tbody>
        </table>
      </div>
      {s.foot ? <p className="ipg-foot-note">{s.foot}</p> : null}
    </>);
    case "sites": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className="ipg-sites">{s.items.map((it) => (
        <div className="sc" key={it.name} style={{ ["--p" as string]: it.pct, ["--c" as string]: `var(--${it.tone})` }}>
          <h4>{it.name}</h4><p className="amt">{it.sub}</p>
          <div className="ring"><div><b>{it.pct}%</b><small>원가율</small></div></div>
          <ul>{it.rows.map(([k, v]) => <li key={k}>{k}<b>{v}</b></li>)}</ul>
        </div>))}</div>
    </>);
    case "journey": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className="ipg-journey">{s.steps.map((st, i) => (
        <div className="jr" key={st.title}>
          <i>{i + 1}</i>
          <div><b>{st.title}</b><p>{st.desc}</p></div>
          <div className="out">{st.out.map(([k, v, tone]) => (
            <span key={k}>{k}{tone ? <b><span className={`ipg-bd ${tone}`}>{v}</span></b> : <b>{v}</b>}</span>))}</div>
        </div>))}</div>
    </>);
    case "logs": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className="ipg-logs">{s.rows.map(([time, what, detail, tone]) => (
        <div className="lg" key={time + what}><time>{time}</time><span className={`ipg-bd ${tone}`}>{what}</span><b>{detail}</b></div>))}
        {s.foot ? <div className="lgfoot">{s.foot}</div> : null}
      </div>
    </>);
    case "month": {
      const marks = new Map(s.marks.map((m) => [m[0], m]));
      return (<>
        <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
        <div className="ipg-month">
          <div className="cal">
            {["일", "월", "화", "수", "목", "금", "토"].map((w) => <div className="wd" key={w}>{w}</div>)}
            {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => {
              const m = marks.get(d);
              return <div key={d} className={`d${m ? ` on ${m[2]}` : ""}`}><span>{d}</span>{m ? <em>{m[1]}</em> : null}</div>;
            })}
          </div>
          <div className="notes">{s.notes.map(([t, d]) => <div key={t}><b>{t}</b><span>{d}</span></div>)}</div>
        </div>
      </>);
    }
    case "probs": return (<>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className="ipg-probs">{s.items.map(([q, a, p]) => (
        <div className="ipg-pb" key={q}><p className="q">{q}</p><p className="a">{a}</p><p>{p}</p></div>))}</div>
    </>);
    case "start": return (
      <div className="ipg-start">
        <h3>{s.title ?? "도입 첫 주, 이 순서대로 하면 됩니다"}</h3>
        <div className="cols">{s.cols.map(([when, what, items]) => (
          <div className="col" key={when}><small>{when}</small><b>{what}</b>
            <ul>{items.map((it) => <li key={it}>{it}</li>)}</ul></div>))}</div>
      </div>
    );
    case "menus": return (<>
      <Head eyebrow="쓰는 메뉴" title={s.title ?? "먼저 켜는 메뉴"} lead={s.lead} />
      <div className="ipg-menus">
        <div className="mg"><h4>꼭 쓰는 메뉴</h4>
          <div className="list">{s.main.map(([m, d]) => <div key={m}><b>{m}</b><span>{d}</span></div>)}</div></div>
        <div className="mg"><h4>이어서 켜면 좋은 메뉴</h4>
          <div className="list">{s.next.map(([m, d]) => <div key={m}><b>{m}</b><span>{d}</span></div>)}</div></div>
      </div>
      <div className="ipg-others">
        {INDUSTRIES.map((o) => (
          <Link key={o.slug} href={`/industries/${o.slug}`} className={o.slug === slug ? "on" : ""}>{o.name}</Link>))}
        <Link href="/features">기능 전체 보기</Link>
      </div>
    </>);
  }
}

export default function IndustryPage({ data }: { data: Industry }) {
  const d = data;
  const parent = PARENT_BY_KEY.get(d.parent);
  return (
    <div className={`ipg ipg-${d.parent}`}>
      <div className="lp8"><SiteHeader /></div>

      <section className="ipg-hero">
        <div className="ipg-shot" aria-hidden style={{ backgroundImage: `url(${d.shot})` }} />
        <div className="ipg-veil" aria-hidden />
        <div className="ipg-wrap ipg-heroin">
          <div>
            <p className="ipg-eyebrow">{d.label}</p>
            <h1>{d.title[0]}<br />{d.title[1]}</h1>
            <p className="ipg-hlead">{d.lead}</p>
            <div className="ipg-btns">
              <Link className="ipg-btn p" href={SIGNUP_HREF} data-cta={`signup:industry_${d.slug}_hero`}>무료로 시작하기 →</Link>
              <Link className="ipg-btn s" href={CONSULT_HREF} data-cta={`consult:industry_${d.slug}_hero`}>{d.name} 도입 상담</Link>
            </div>
            <div className="ipg-kpis">{d.kpis.map(([v, k]) => <div key={k}><b>{v}</b>{k}</div>)}</div>
          </div>
          <div className="ipg-art"><HeroArt hero={d.hero} /></div>
        </div>
      </section>

      {d.sections.map((s, i) => (
        <section className={`ipg-sec${i % 2 === 1 ? " alt" : ""}`} key={i}>
          <div className="ipg-wrap"><Block s={s} slug={d.slug} /></div>
        </section>
      ))}

      <section className="ipg-fin"><div className="ipg-wrap">
        <h2>{d.finTitle}</h2>
        <p>{d.finLead}</p>
        <div className="ipg-btns">
          <Link className="ipg-btn w" href={SIGNUP_HREF} data-cta={`signup:industry_${d.slug}_finale`}>무료로 시작하기 →</Link>
          <Link className="ipg-btn s" href={CONSULT_HREF} data-cta={`consult:industry_${d.slug}_finale`}>도입 상담 신청</Link>
        </div>
        {parent ? <p className="ipg-parentlink"><Link href={`/industries/${parent.key}`}>{parent.name} 업종 전체 보기 →</Link></p> : null}
      </div></section>
      <p className="ipg-note">화면 속 회사명·거래처·금액은 모두 가상 예시입니다.</p>

      <div className="lp8"><SiteFooter /></div>
    </div>
  );
}
