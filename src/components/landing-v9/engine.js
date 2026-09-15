// ══════════════════════════════════════════════════════════════
//  랜딩 v9 장면 엔진 — 목업 4(아티팩트 4fa10ad8)의 스크립트를 그대로 옮기고 정리만 붙였다.
//  ▸ startLanding() 이 돌리고, 돌려준 함수를 부르면 requestAnimationFrame·타이머·관찰자를 전부 멈춘다.
//    (페이지를 떠나거나 개발 모드에서 두 번 붙을 때 장면이 겹쳐 돌지 않게)
//  ▸ 장면 요소는 sections.ts 의 id 를 찾는다. id 를 바꾸면 여기와 같이 바꾼다.
//  ▸ 움직임을 줄인 사용자(prefers-reduced-motion)는 끝 상태로 보여 준다 — 목업과 같은 분기.
// ══════════════════════════════════════════════════════════════
/* eslint-disable */
export function startLanding() {
  let alive = true;
  let rafId = 0;
  const ios = [], intervals = [], timeouts = new Set(), listeners = [];
  const NativeIO = window.IntersectionObserver;
  // 페이지를 떠날 때 React 는 화면을 먼저 걷고 정리 함수를 나중에 부른다 — 그 사이 한 프레임이
  // 사라진 요소를 건드리지 않게, 본문(#rscene)이 문서에 없으면 살아 있어도 멈춘 것으로 본다.
  const live = () => alive && !!document.getElementById("rscene");
  function IO(cb, opt) { const o = new NativeIO((es, ob) => { if (live()) cb(es, ob); }, opt); ios.push(o); return o; }
  const later = (fn, ms) => { const id = window.setTimeout(() => { timeouts.delete(id); if (live()) fn(); }, ms); timeouts.add(id); return id; };
  const every = (fn, ms) => { const id = window.setInterval(() => { if (live()) fn(); }, ms); intervals.push(id); return id; };
  const on = (type, fn, opt) => { window.addEventListener(type, fn, opt); listeners.push([type, fn, opt]); };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (el) => { const r = el.getBoundingClientRect(); const total = el.offsetHeight - innerHeight; return total <= 0 ? 0 : clamp(-r.top / total); };

  /* 등장 */
  if ("IntersectionObserver" in window && !reduce) {
    const rvs = [...document.querySelectorAll(".rv")];
    rvs.forEach((el) => { if (el.getBoundingClientRect().top > innerHeight) el.classList.add("wait"); });
    const io = new IO((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.remove("wait"); io.unobserve(e.target); } }), { threshold:.12 });
    rvs.forEach((el) => io.observe(el));
  }

  /* 왼쪽 진행 표시 */
  const secs = [...document.querySelectorAll("[data-rail]")];
  $("#rail").innerHTML = secs.map(() => "<i></i>").join("");
  const railI = [...document.querySelectorAll("#rail i")];

  /* ① 아이콘 확장 */
  const s1 = $("#s1"), pill = $("#s1p");
  function hero(){
    const p = prog(s1), e = ease(clamp(p / .7));
    const vw = innerWidth, vh = innerHeight, i0 = Math.min(132, vw * .26);
    pill.style.setProperty("--w", lerp(i0, vw, e) + "px"); pill.style.setProperty("--h", lerp(i0, vh, e) + "px");
    pill.style.setProperty("--r", lerp(i0 * .26, 0, clamp((e - .7) / .3)) + "px");
    pill.style.setProperty("--od", String(clamp(e * 2)));
    pill.style.setProperty("--o0", String(1 - clamp(e * 4)));
    pill.style.setProperty("--o1", String(clamp((e - .45) / .3)));
    pill.style.setProperty("--o2", String(clamp((p - .6) / .2))); pill.style.setProperty("--ty", lerp(160, 0, ease(clamp((p - .58) / .32))) + "px");
    const wo = 1 - clamp(e * 2.4); [$("#s1l"), $("#s1r")].forEach((x) => { x.style.opacity = wo; x.style.filter = `blur(${(1 - wo) * 8}px)`; x.style.display = e > .5 ? "none" : ""; });
    $("#s1kick").style.opacity = wo; $("#s1hint").style.opacity = wo;
  }

  /* ② 타이핑 */
  const WORDS = [["통장 정리","거래내역은 자동으로 들어옵니다"],["세금계산서 대사","입금과 자동으로 맞춰집니다"],["급여 계산","4대보험까지 자동으로 계산됩니다"],["재고 파악","저장하는 순간 반영됩니다"]];
  let wIdx = 0, cIdx = 0, del = false;
  function typeTick(){
    const [w, s] = WORDS[wIdx]; const el = $("#typed");
    if (!del) { cIdx++; el.textContent = s.slice(0, cIdx); if (cIdx >= s.length) { del = true; return later(typeTick, 1800); } }
    else { cIdx--; el.textContent = s.slice(0, cIdx); if (cIdx <= 0) { del = false; wIdx = (wIdx + 1) % WORDS.length; $("#typed-word").textContent = WORDS[wIdx][0]; setQuad(wIdx); } }
    later(typeTick, del ? 28 : 70);
  }
  function setQuad(i){ document.querySelectorAll("#quad .qc").forEach((c) => c.classList.toggle("on", +c.dataset.i === i)); }
  setQuad(0);
  if (reduce) $("#typed").textContent = WORDS[0][1]; else typeTick();
  function belt(){}

  /* ③ 흐림→선명 + 증빙이 전표 목록으로 */
  const PAPERS = [["세금계산서","(주)미래테크","외상매출금","8,910,000"],["카드 승인","클라우드 서버","지급수수료","1,240,000"],["통장 입금","온샘디자인","입금 매칭","4,235,000"],["현금영수증","사무용품","소모품비","127,000"],["세금계산서","정우엔지니어링","외상매출금","4,235,000"],["카드 승인","출장 교통비","여비교통비","86,400"]];
  $("#papers").innerHTML = PAPERS.map(([k,n,,a]) => `<div class="paper"><div class="k">${k}</div><div class="n">${n}</div><div class="a num">₩${a}</div><div class="skl" style="width:70%"></div><span class="pst bd gry">미처리</span></div>`).join("");
  $("#lrows").innerHTML = PAPERS.map(([k,n,ac,a]) => `<div class="lrow"><span class="bd gry" style="justify-self:start">${k}</span><span>${n}</span><span class="acct bd ind">${ac}</span><span class="amt num">₩${a}</span><span class="ck"><svg class="li"><use href="#i-tick"/></svg></span></div>`).join("");
  const paperEls = [...document.querySelectorAll(".paper")], rowEls = [...document.querySelectorAll(".lrow")];
  const MESS = [[-360,-40,-18],[260,-90,14],[-120,90,9],[340,110,-11],[-300,160,20],[60,-130,-7]];
  function papers(){
    const p = prog($("#s3")), bl = clamp(p / .25), e = ease(clamp((p - .32) / .5));
    $("#s3a").style.filter = `blur(${(1 - bl) * 14}px)`; $("#s3a").style.opacity = String(clamp(bl * 1.4) * (1 - clamp((p - .4) / .12)));
    $("#s3b").style.opacity = String(clamp((p - .48) / .12)); $("#s3b").style.filter = `blur(${(1 - clamp((p - .48) / .14)) * 12}px)`;
    const led = $("#ledger"); led.style.setProperty("--lo", String(clamp((e - .15) / .3)));
    const origin = $("#papers").getBoundingClientRect(), sc = innerWidth < 760 ? .7 : 1;
    paperEls.forEach((el, i) => { const [mx, my, mr] = MESS[i]; const rr = rowEls[i].getBoundingClientRect();
      const tx = rr.left + rr.width / 2 - origin.left, ty = rr.top + rr.height / 2 - origin.top;
      const q = ease(clamp((e - i * .05) / .75));
      el.style.transform = `translate(${lerp(mx * sc, tx, q)}px, ${lerp(my, ty, q)}px) rotate(${lerp(mr, 0, q)}deg) scale(${lerp(1, .32, q)})`;
      el.style.opacity = String(1 - clamp((q - .75) / .2));
      rowEls[i].style.setProperty("--ro", String(clamp((q - .8) / .2))); });
    led.querySelector("#lsum").style.setProperty("--so", String(clamp((e - .9) / .1)));
  }

  /* ④ 커서 시연 */
  const ROWS = [["i-bank","i","(주)미래테크 입금","+8,910,000","외상매출금"],["i-card","","클라우드 서버 이용료","−1,240,000","지급수수료"],["i-receipt","g","온샘디자인 세금계산서","4,235,000","입금 매칭 제안"],["i-card","","사무용품 구매","−127,000","소모품비"]];
  const demo = $("#demo"), cur = $("#dCursor"), rip = $("#dRipple");
  function at(el){ const d = demo.getBoundingClientRect(), r = el.getBoundingClientRect(); return [r.left - d.left + r.width * .55, r.top - d.top + r.height * .6]; }
  function moveTo(el){ const [x, y] = at(el); cur.style.transform = `translate(${x}px, ${y}px)`; return [x, y]; }
  function click(el){ const [x, y] = at(el); rip.style.left = x + "px"; rip.style.top = y + "px"; rip.classList.remove("go"); void rip.offsetWidth; rip.classList.add("go"); el.classList.add("press"); later(() => el.classList.remove("press"), 160); }
  const wait = (ms) => new Promise((r) => later(r, ms));
  function renderRows(state){ $("#dList").innerHTML = ROWS.map(([ic,c,t,a,acct]) => `<div class="row"><span class="ic ${c}"><svg><use href="#${ic}"/></svg></span><div><div class="t">${t}</div><div class="s num">${a}</div></div><span class="ai">${state === "ai" ? "AI 추천 · " + acct : `<svg class="spin" style="stroke:var(--ink-3)"><use href="#i-spin"/></svg>`}</span></div>`).join(""); }
  async function demoLoop(){
    while (alive) {
      renderRows("load"); $("#dApprove").classList.remove("ready"); $("#dToast").classList.remove("in"); cur.style.transition = "none"; cur.style.transform = "translate(60%, 360px)"; await wait(60); cur.style.transition = "";
      await wait(700); moveTo($("#dCollect")); await wait(1000); click($("#dCollect"));
      const rows = [...document.querySelectorAll("#dList .row")];
      for (const r of rows) { await wait(260); r.classList.add("in"); }
      await wait(1100); renderRows("ai"); document.querySelectorAll("#dList .row").forEach((r) => r.classList.add("in"));
      $("#dApprove").classList.add("ready"); await wait(900);
      moveTo($("#dApprove")); await wait(1000); click($("#dApprove")); await wait(250); $("#dToast").classList.add("in");
      await wait(2600);
    }
  }
  if (reduce) { renderRows("ai"); document.querySelectorAll("#dList .row").forEach((r) => r.classList.add("in")); $("#dApprove").classList.add("ready"); }
  else { renderRows("ai"); document.querySelectorAll("#dList .row").forEach((r) => r.classList.add("in")); new IO((es, o) => { if (es[0].isIntersecting) { o.disconnect(); demoLoop(); } }, { threshold:.4 }).observe(demo); }

  /* ⑤ 계산이 보이는 화면 + 목록 */
  const accB = [...document.querySelectorAll("#acc button")], panes = [...document.querySelectorAll(".pane")];
  let accI = 0, accLock = 0;
  function countIn(el){ const to = +el.dataset.to; const t0 = performance.now(); if (reduce) return;
    const tick = (now) => { const q = Math.min(1, (now - t0) / 1100); el.textContent = "₩" + Math.round(to * (1 - Math.pow(1 - q, 3))).toLocaleString("ko-KR"); if (q < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  const flos = [...document.querySelectorAll(".dtabs span")];
  function setAcc(i){ if (i === accI && panes[i].classList.contains("on")) return; accI = i; accB.forEach((b, j) => b.classList.toggle("on", j === i)); panes.forEach((p, j) => p.classList.toggle("on", j === i)); flos.forEach((f, j) => f.classList.toggle("on", j === i)); countIn(panes[i].querySelector("[data-to]")); }
  accB.forEach((b, i) => b.addEventListener("click", () => { setAcc(i); accLock = performance.now() + 1500; }));
  function acc(){ if (innerWidth < 960 || performance.now() < accLock) return; const i = Math.min(3, Math.floor(prog($("#s5")) * 4)); if (i !== accI) setAcc(i); }

  /* ⑥ 용어가 모임 */
  const TERMS = ["부가세 예정고지","원천세","4대보험","감가상각","매출채권","미지급금","FIFO 원가","BOM","영업이익","순현금흐름","세금계산서","현금영수증","지급명세서","연차 발생","주 52시간","통합고용세액공제","계정과목","차대변","월 마감","거래처 원장"];
  $("#terms").innerHTML = TERMS.map((t) => `<span class="term">${t}</span>`).join("");
  const termEls = [...document.querySelectorAll(".term")];
  const TPOS = TERMS.map((_, i) => { const a = i * 2.39996, rr = .28 + .18 * ((i * 7) % 5) / 4; return [Math.cos(a) * rr, Math.sin(a) * rr * .7]; });
  function terms(){
    const p = prog($("#s6")), e = ease(clamp((p - .1) / .55));
    termEls.forEach((el, i) => { const [x, y] = TPOS[i]; const w = el.offsetWidth;
      el.style.transform = `translate(${x * innerWidth * (1 - e) - w / 2}px, ${y * innerHeight * (1 - e) - innerHeight * .08 * e}px) scale(${1 - .5 * e})`;
      el.style.opacity = String(clamp(p / .1) * (1 - clamp((e - .7) / .3))); el.style.filter = `blur(${e * 3}px)`; });
    $("#s6t").style.opacity = String(clamp((p - .5) / .2)); $("#s6t").style.transform = `translateY(${(1 - clamp((p - .5) / .25)) * 30}px)`;
  }
  const sp = $("#spark"), sx = sp.getContext("2d");
  (function spark(){ const W = sp.width, H = sp.height, pts = [30,34,31,40,38,52,49,66,61,78,74,96]; sx.clearRect(0,0,W,H);
    sx.strokeStyle = "rgba(255,255,255,.12)"; sx.lineWidth = 1; for (let g = 1; g < 4; g++) { sx.beginPath(); sx.moveTo(0, H * g / 4); sx.lineTo(W, H * g / 4); sx.stroke(); }
    sx.beginPath(); pts.forEach((v, i) => { const x = i / (pts.length - 1) * (W - 20) + 10, y = H - 20 - v / 100 * (H - 40); i ? sx.lineTo(x, y) : sx.moveTo(x, y); }); sx.strokeStyle = "#a5f3fc"; sx.lineWidth = 4; sx.stroke();
    const lx = W - 10, ly = H - 20 - 96 / 100 * (H - 40); sx.fillStyle = "#fff"; sx.beginPath(); sx.arc(lx, ly, 8, 0, 7); sx.fill();
    sx.fillStyle = "#c7d2fe"; sx.font = "bold 22px sans-serif"; sx.fillText("외주 용역비 +38%", 16, 34); })();

  /* ⑦ 숫자 올라감 + 수집 피드 */
  const fmt = (n) => Math.round(n).toLocaleString("ko-KR");
  const cio = new IO((es) => es.forEach((e) => { if (!e.isIntersecting) return; cio.unobserve(e.target);
    const el = e.target, to = +el.dataset.count; if (reduce || !to) return; const t0 = performance.now();
    const tick = (now) => { const q = Math.min(1, (now - t0) / 1500); el.textContent = fmt(to * (1 - Math.pow(1 - q, 3))); if (q < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }), { threshold:.6 });
  document.querySelectorAll("[data-count]").forEach((c) => cio.observe(c));
  const FEED = [["i-bank","i","(주)미래테크 입금","기업은행 · AI 추천 외상매출금","+8,910,000"],["i-card","","클라우드 서버 이용료","법인카드 · AI 추천 지급수수료","−1,240,000"],["i-receipt","g","온샘디자인 세금계산서","홈택스 · 입금 매칭 제안","4,235,000"],["i-card","","출장 교통비","법인카드 · 내가 배운 규칙","−86,400"],["i-bank","i","정우엔지니어링 입금","국민은행 · AI 추천 외상매출금","+2,860,000"],["i-receipt","g","사무용품 현금영수증","홈택스 · AI 추천 소모품비","127,000"]];
  let fIdx = 0; const feedEl = $("#feedList");
  function pushFeed(){ const [ic,c,t,sub,a] = FEED[fIdx % FEED.length]; fIdx++;
    const d = document.createElement("div"); d.className = "fi"; d.innerHTML = `<span class="ic ${c}"><svg><use href="#${ic}"/></svg></span><div><div class="t">${t}</div><div class="s">${sub}</div></div><div class="r t num">${a}</div>`;
    feedEl.prepend(d); while (feedEl.children.length > 5) feedEl.lastChild.remove(); }
  for (let k = 0; k < 4; k++) pushFeed();
  new IO((es, o) => { if (!es[0].isIntersecting) return; o.disconnect(); $("#tbarFill").style.width = "58%"; if (!reduce) every(pushFeed, 1600); }, { threshold:.3 }).observe($("#board"));

  /* ⑨ 유리 카드 로딩→체크 */
  new IO((es, o) => { if (!es[0].isIntersecting) return; o.disconnect();
    [...document.querySelectorAll("#glasses .it")].forEach((it, i) => later(() => it.classList.add("done"), reduce ? 0 : 600 + i * 260)); }, { threshold:.35 }).observe($("#glasses"));

  /* ⑩ 단계별 태블릿 화면 */
  const PEOPLE = [["문지훈","o o o o o","31.8h","출근"],["이준호","o o o o n","31.6h","출근"],["배수정","o o o o o","34.5h","출근"],["임하늘","v v o o o","28.6h","휴가 후 복귀"],["오세림","o o o o o","30.1h","출근"]];
  const TABS = [
    `<div class="tscr"><h6>근태 현황 · 9월 3주차 <span class="bd grn">주 52시간 준수</span></h6>
      <div class="sumc"><div><small>출근</small><b>11명</b></div><div><small>휴가</small><b>1명</b></div><div><small>지각</small><b>0건</b></div></div>
      <div class="cal"><div class="hd"><span>구성원</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span></div>${PEOPLE.map(([n,d]) => `<div class="cr"><b>${n}</b>${d.split(" ").map((x) => `<i class="${x}"></i>`).join("")}</div>`).join("")}</div>
      <div class="sendl">${PEOPLE.slice(0,3).map(([n,,h,st]) => `<div class="ln"><div class="t">${n}</div><span class="s" style="margin-left:8px">${h}</span><span class="r bd ind">${st}</span></div>`).join("")}</div></div>`,
    `<div class="tscr"><h6>9월 급여 배치 <span class="bd ind">자동 계산</span></h6>
      <div class="ptab"><div class="pr h"><span>이름</span><span>지급액</span><span>공제</span><span>실지급</span></div>${[["문지훈","4,200,000","548,100","3,651,900"],["이준호","3,800,000","495,900","3,304,100"],["배수정","4,650,000","606,800","4,043,200"],["임하늘","3,400,000","443,700","2,956,300"],["오세림","3,600,000","469,800","3,130,200"]].map((r) => `<div class="pr"><span>${r[0]}</span><span class="num">${r[1]}</span><span class="num">${r[2]}</span><span class="num">${r[3]}</span></div>`).join("")}<div class="pr t"><span>합계 12명</span><span class="num">45,300,000</span><span class="num">5,892,400</span><span class="num">39,407,600</span></div></div>
      <div class="sendl"><div class="ln"><div class="t">연장근무 수당 반영</div><span class="r"><span class="tg on" style="display:inline-block"></span></span></div><div class="ln"><div class="t">4대보험 요율 2026년</div><span class="r bd grn">적용</span></div></div>
      <div style="margin-top:12px;height:48px;border-radius:12px;background:var(--grad);display:grid;place-items:center"><span class="ld"><i></i><i></i><i></i></span></div></div>`,
    `<div class="tscr"><div style="display:flex;align-items:center;gap:12px"><div style="width:52px;height:52px;border-radius:50%;background:var(--ind);display:grid;place-items:center;flex:none"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg></div><div><b style="font-size:18px;color:var(--ink)">명세서 12건 발송 완료</b><div style="font-size:12px;color:var(--ink-3);margin-top:2px">09-25 10:02 · 구성원 앱·메일로 전달</div></div></div>
      <div class="sumc"><div><small>열람</small><b>8명</b></div><div><small>미열람</small><b>4명</b></div><div><small>실지급 합계</small><b style="font-size:14px">₩39,407,600</b></div></div>
      <div class="sendl">${[["문지훈","열람","grn"],["이준호","열람","grn"],["배수정","열람","grn"],["임하늘","발송됨","gry"],["오세림","열람","grn"],["김대표","발송됨","gry"]].map(([n,st,c]) => `<div class="ln"><span class="ic i"><svg><use href="#i-users"/></svg></span><div class="t">${n}</div><span class="r bd ${c}">${st}</span></div>`).join("")}</div></div>`];
  let tabI = -1;
  function setTab(i){ if (i === tabI) return; tabI = i; $("#tab").innerHTML = TABS[i]; document.querySelectorAll("#stp > div").forEach((d, j) => d.classList.toggle("on", j === i)); }
  setTab(0);
  function tabs(){ if (innerWidth < 960) return; setTab(Math.min(2, Math.floor(prog($("#s10")) * 3))); }

  /* ⑪ 점 구체 */
  const gc = $("#globe"), g = gc.getContext("2d");
  function globe(t){ const W = gc.width, H = gc.height; g.clearRect(0,0,W,H); const cx = W/2, cy = H + 230, R = 640;
    for (let la = 0; la <= 90; la += 3.4) { const phi = la*Math.PI/180, rr = R*Math.cos(phi), yy = cy - R*Math.sin(phi), n = Math.max(6, Math.round(rr/8));
      for (let k = 0; k < n; k++) { const th = k/n*Math.PI*2 + t*.12, x = cx + rr*Math.cos(th), z = Math.sin(th), y = yy + rr*.26*z; if (y > H + 4) continue;
        const hl = Math.abs(la-30) < 4 && Math.cos(th - t*.4) > .92;
        g.fillStyle = hl ? "rgba(103,232,249,.95)" : `rgba(165,180,252,${(.25+.6*((z+1)/2))*.8})`; g.beginPath(); g.arc(x, y, hl ? 4.4 : 1.3 + 1.6*((z+1)/2), 0, 7); g.fill(); } } }

  /* ⑫ 꽉 찬 판 + 실크 */
  const full = $("#full"), sc = $("#silk"), s = sc.getContext("2d");
  function fin(){
    const p = prog($("#s12")), e = ease(clamp(p / .6));
    full.style.setProperty("--w", lerp(innerWidth * .62, innerWidth, e) + "px"); full.style.setProperty("--h", lerp(innerHeight * .56, innerHeight, e) + "px"); full.style.setProperty("--r", lerp(36, 0, e) + "px");
    $("#fcta").style.setProperty("--oc", String(clamp((p - .78) / .15)));
  }
  function silk(t){ const W = sc.width = sc.clientWidth, H = sc.height = sc.clientHeight; s.clearRect(0,0,W,H);
    for (let i = 0; i < 60; i++) { const q = i/59; s.beginPath();
      for (let x = -20; x <= W+20; x += 14) { const u = x/W; const y = H*.55 + Math.sin(u*2.6 + t*.35 + q*1.4)*H*.14 + Math.sin(u*5.2 - t*.45 + q*2.6)*H*.04 + (q-.5)*H*.5*(.25+.75*Math.sin(u*Math.PI)**2)*Math.cos(u*1.9 + t*.2); x === -20 ? s.moveTo(x,y) : s.lineTo(x,y); }
      const gr = s.createLinearGradient(0,0,W,0); gr.addColorStop(0,"rgba(165,180,252,0)"); gr.addColorStop(.3,`rgba(165,180,252,${.08+.2*q})`); gr.addColorStop(.7,`rgba(165,243,252,${.08+.2*(1-q)})`); gr.addColorStop(1,"rgba(165,243,252,0)"); s.strokeStyle = gr; s.lineWidth = 1.2; s.stroke(); } }

  /* ⓐ 검은 카드 — 보이면 움직임 시작 */
  new IO((es, o) => { if (!es[0].isIntersecting) return; o.disconnect(); $("#bcards").classList.add("in"); }, { threshold:.25 }).observe($("#bcards"));

  /* ⓑ 13주 자금 캘린더 */
  const WEEKS = ["9/15","9/22","9/29","10/6","10/13","10/20","10/27","11/3","11/10","11/17","11/24","12/1","12/8"];
  const BAL = [2.30,2.42,2.61,2.88,2.74,2.55,2.31,2.05,1.78,1.52,1.31,1.20,1.34];
  const EVT = { 3:["up","+₩2,700만","잔금 입금",0], 4:["dn","−₩1,400만","원천세·4대보험",46], 6:["dn","−₩2,400만","외주 용역비",0], 9:["dn","−₩2,600만","설비 구매",0], 12:["up","+₩1,400만","대금 입금",58] };
  $("#ccols").innerHTML = BAL.map((v, i) => { const ev = EVT[i]; const cls = i === 0 ? " now" : i === 11 ? " min" : "";
    return `<div class="cc${cls}${ev ? " has" : ""}" style="--h:${(v / 4).toFixed(3)}"><div class="cbar"><em class="cv">₩${v.toFixed(1)}억</em>${ev ? `<span class="cev ${ev[0]}" style="--off:${ev[3]}px">${ev[1]}<small>${ev[2]}</small></span>` : ""}${i === 11 ? '<span class="cev flag">최저 잔액<small>운영자금선 위</small></span>' : ""}</div><b class="cx">${i === 0 ? "이번 주" : WEEKS[i]}</b></div>`; }).join("");
  const ccEls = [...document.querySelectorAll("#ccols .cc")];
  function cashcal(){
    const sec = $("#c8"), rc = sec.getBoundingClientRect(); if (rc.bottom < 0 || rc.top > innerHeight) return;
    const p = prog(sec);
    ccEls.forEach((el, i) => { const g = ease(clamp((p - .06 - i * .038) / .09)); el.style.setProperty("--g", g.toFixed(3)); el.classList.toggle("shown", g > .92); });
    $("#csafe").style.opacity = String(clamp((p - .02) / .06));
    $("#tfoot").style.opacity = String(clamp((p - .66) / .08));
  }

  /* ⓒ 재고 스캔 */
  const ITEMS = [
    ["데스크 매트","DM-01 · 본사 창고",142,.71,.3,"grn","입고 +50","#eef2ff",'<rect x="8" y="18" width="48" height="28" rx="6"/><path d="M15 39h34"/>'],
    ["케이블 정리함","CB-12 · 본사 창고",18,.12,.25,"red","발주 제안 50개","#fff1f2",'<rect x="10" y="26" width="44" height="24" rx="4"/><path d="M10 34h44M22 26c0-11 20-11 20 0"/>'],
    ["모니터 받침대","MS-03 · 물류센터 A",64,.5,.2,"ind","출고 예정 12","#ecfeff",'<rect x="10" y="12" width="44" height="28" rx="3"/><path d="M32 40v9M20 52h24"/>'],
    ["무선 충전 패드","WP-07 · 물류센터 A",210,.9,.2,"gry","적정","#f5f3ff",'<circle cx="32" cy="34" r="20"/><path d="M34 22l-8 13h8l-4 11"/>'],
    ["노트북 파우치","NP-02 · 매장 창고",37,.36,.3,"amb","판매 급증","#fff7ed",'<rect x="10" y="18" width="44" height="32" rx="8"/><path d="M10 28h44M42 28v6"/>'],
    ["USB 허브","UH-05 · 물류센터 B",120,.66,.2,"grn","입고 예정 D-3","#f0fdf4",'<rect x="8" y="24" width="48" height="18" rx="5"/><path d="M17 33h4M27 33h4M37 33h4M47 33h2"/>']];
  $("#stock").innerHTML = ITEMS.map(([n, sub, q, v, sf, c, bd, bg, svg], i) => `<div class="sk${i === 0 ? " hero" : ""}${c === "red" ? " low" : ""}"><div class="skv" style="background:${bg}"><svg viewBox="0 0 64 64">${svg}</svg>${i === 0 ? '<span class="beam" id="beam"></span>' : ""}</div><div class="skb"><div class="skn"><b>${n}</b><span>${sub}</span></div><div class="skq"><b class="num"${i === 0 ? ' id="skq0"' : ""}>${q}</b><small>개</small><span class="bd ${c}"${i === 0 ? ' id="skb0"' : ""}>${bd}</span></div><div class="skbar"><i style="--v:${v}"${i === 0 ? ' id="skv0"' : ""}></i><em style="--s:${sf}"></em></div></div></div>`).join("");
  const skEls = [...document.querySelectorAll(".sk")];
  const FLY = [[0,0],[760,-300],[-760,-160],[800,200],[-780,300],[0,620]];
  let skLast = "";
  function stockScene(){
    const sec = $("#c10"), rc = sec.getBoundingClientRect(); if (rc.bottom < 0 || rc.top > innerHeight) return;
    const p = prog(sec), narrow = innerWidth < 760;
    const hb = clamp(p / .12); $("#c10h").style.filter = `blur(${(1 - hb) * 12}px)`; $("#c10h").style.opacity = String(.15 + .85 * hb);
    const box = $("#stock"), hero = skEls[0];
    const hx = box.offsetWidth / 2 - (hero.offsetLeft + hero.offsetWidth / 2), hy = box.offsetHeight / 2 - (hero.offsetTop + hero.offsetHeight / 2);
    const m = ease(clamp((p - .55) / .28)), S0 = narrow ? 1.25 : 1.75;
    hero.style.transform = `translate(${hx * (1 - m)}px, ${hy * (1 - m)}px) scale(${lerp(S0, 1, m)})`;
    const sp = clamp((p - .1) / .26), beam = $("#beam");
    beam.style.top = ((sp * 2) % 1) * 100 + "%"; beam.style.opacity = sp > 0 && sp < 1 ? "1" : "0";
    const qr = ease(clamp((p - .38) / .14));
    const qv = String(Math.round(lerp(92, 142, qr))); if ($("#skq0").textContent !== qv) $("#skq0").textContent = qv;
    $("#skv0").style.setProperty("--v", String(lerp(.46, .71, qr)));
    const st = qr >= 1 ? "done" : sp > 0 && sp < 1 ? "scan" : qr > 0 ? "apply" : "wait";
    if (st !== skLast) { skLast = st; const b = $("#skb0"); b.className = "bd " + (st === "done" ? "grn" : st === "wait" ? "gry" : "ind"); b.textContent = st === "done" ? "입고 +50" : st === "scan" ? "바코드 스캔 중" : st === "apply" ? "재고 반영 중" : "입고 대기"; }
    skEls.forEach((el, i) => { if (!i) return; const q = ease(clamp((p - .58 - i * .03) / .24)); el.style.transform = `translate(${FLY[i][0] * (1 - q)}px, ${FLY[i][1] * (1 - q)}px)`; el.style.opacity = String(q); });
    $("#skcap").style.opacity = String(clamp((p - .86) / .1));
  }

  /* ⓓ 판이 줄고 휴대폰이 올라옴 */
  const mpan = $("#mpanel"), phoneEl = $("#phone"), pss = [...document.querySelectorAll("#phone .ps")];
  function mobile(){
    const sec = $("#c13"), rc = sec.getBoundingClientRect(); if (rc.bottom < 0 || rc.top > innerHeight) return;
    const p = prog(sec), vw = innerWidth, vh = innerHeight, narrow = vw < 760;
    const e = ease(clamp(p / .36)), fw = Math.min(1200, vw * .92), fh = vh * (narrow ? .8 : .72);
    const w = lerp(vw, fw, e), h = lerp(vh, fh, e), cy = lerp(vh / 2, vh * .54, e);
    mpan.style.width = w + "px"; mpan.style.height = h + "px"; mpan.style.left = (vw - w) / 2 + "px"; mpan.style.top = (cy - h / 2) + "px"; mpan.style.borderRadius = lerp(0, 40, e) + "px";
    const sc = narrow ? .62 : Math.min(1, vh / 900), pw = 290 * sc;
    const finalTop = narrow ? vh * .42 : (vh * .54 - fh / 2) - 72 * sc;
    const left = narrow ? vw / 2 - pw / 2 : vw / 2 + fw / 2 - pw - fw * .1;
    const pr = ease(clamp((p - .16) / .3));
    phoneEl.style.transform = `translate(${left}px, ${lerp(vh + 60, finalTop, pr)}px) scale(${sc})`;
    const si = p < .56 ? 0 : p < .82 ? 1 : 2; pss.forEach((x, i) => x.classList.toggle("on", i === si));
    pss[0].classList.toggle("show", p > .4);
    const k = ease(clamp((p - .62) / .16)); $("#knob").style.transform = `translateX(${k * 186}px)`; $("#sfill").style.width = (52 + k * 186) + "px";
  }

  /* ⓔ 메뉴 모음 → 경영 요약 한 칸이 화면 가득 */
  const TILES = [["i-bank","통장 거래","오늘 31건 수집",""],["i-card","카드 승인","632건","p1"],["i-receipt","세금·증빙","42건",""],["i-file","일반전표","128건 확정","p3"],["i-brief","거래처 원장","미수 1곳",""],["i-clock","자금 캘린더","13주","p2"],
    ["i-box","재고 현황","창고 6곳","p2"],["i-cart","구매","발주 3건",""],["i-chart","경영 요약","영업이익 +₩30,620,000","key"],["i-cart","판매","주문 128건","p1"],["i-brief","프로젝트","진행 12건",""],["i-pen","전자계약","서명 4건","p3"],
    ["i-clock","근태","출근 11명",""],["i-users","급여","12명 배치","p3"],["i-pen","결재 허브","대기 3건","p1"],["i-gift","지원사업","매칭 3건",""],["i-search","AI 참모","질문하기","p2"],["i-receipt","세무 신고","원천세 D-5",""]];
  $("#cz").innerHTML = TILES.map(([ic, n, m, c]) => `<div class="tile ${c}"><i><svg><use href="#${ic}"/></svg></i><div><b>${n}</b><small>${m}</small></div></div>`).join("");
  const czEl = $("#cz"), keyT = czEl.querySelector(".key"), tileEls = [...czEl.children];
  function collage(){
    const sec = $("#c15"), rc = sec.getBoundingClientRect(); if (rc.bottom < 0 || rc.top > innerHeight) return;
    const p = prog(sec), vw = innerWidth, vh = innerHeight;
    const base = Math.min(1, (vw - 32) / 960);
    const tcx = keyT.offsetLeft + keyT.offsetWidth / 2, tcy = keyT.offsetTop + keyT.offsetHeight / 2;
    const e = ease(clamp((p - .12) / .36)), S = Math.max(vw / 150, vh / 120) * 1.4;
    const sc = base * Math.pow(S / base, e);
    const dx = (vw / 2 - (czEl.offsetLeft + tcx)) * e, dy = (vh / 2 - (czEl.offsetTop + tcy)) * e;
    czEl.style.transformOrigin = `${tcx}px ${tcy}px`; czEl.style.transform = `translate(${dx}px, ${dy}px) scale(${sc})`;
    tileEls.forEach((el) => { if (el !== keyT) el.style.opacity = String(1 - clamp((e - .1) / .3)); });
    keyT.style.setProperty("--ko", String(1 - clamp((e - .15) / .2)));
    $("#czt").style.opacity = String(1 - clamp((p - .07) / .08));
    $("#czfull").style.opacity = String(clamp((p - .44) / .08));
    reportScene(clamp((p - .5) / .44) * 8.6);
  }

  /* ⓔ-2 경영 보고서 장면 — 왼쪽 수집 목록에서 날아간 거래가 빈 양식을 채움 */
  const RS = $("#rscene");
  const RS_GROUPS = [["재무",[["i-bank","통장 거래","기업·국민·신한",1284,"건"],["i-card","카드 승인","법인카드 4장",632,"건"],["i-receipt","세금계산서","발행·수취",217,"건"],["i-file","일반전표","확정",128,"건"]]],
    ["영업·프로젝트",[["i-brief","거래처 원장","활성 거래처",42,"곳"],["i-cart","판매·주문","판매채널 3곳",128,"건"],["i-brief","프로젝트","진행 중",12,"건"]]],
    ["재고",[["i-box","재고 입출고","창고 6곳",86,"건"]]],
    ["인사·결재",[["i-users","근태·급여","출근 11명",12,"명"],["i-pen","전자결재","처리 완료",23,"건"]]]];
  const rsBars = [34,36,35,38,40.4,40.9].map((v, i) => `<rect x="${4 + i * 19}" y="${40 - v}" width="12" height="${v}" rx="2" fill="${i === 5 ? "#4f46e5" : "#c7d2fe"}"/>`).join("");
  RS.innerHTML = `<div class="rs-ttl"><small>경영 요약</small><h3>매일 쌓이는 데이터가<br>한 장의 경영 보고서가 됩니다</h3></div>
    <div class="rs-src">${RS_GROUPS.map(([g, rows]) => `<div class="rs-g">${g}</div>` + rows.map(([ic, n, sub, c, u]) => `<div class="rs-r"><span class="rs-ico"><svg><use href="#${ic}"/></svg></span><div class="rs-nm"><b>${n}</b><small>${sub}</small></div><span class="rs-n num" data-n="${c}">0</span><em>${u}</em></div>`).join("")).join("")}</div>
    <div class="rs-rp blank">
      <div class="rs-top"><div><div class="rs-t">월간 경영 보고서</div><div class="rs-m">2026년 9월 · (주)가상상사</div></div>
        <table class="rs-appr"><tr><th>담당</th><th>팀장</th><th>대표</th></tr><tr><td><span class="rs-seal">오너뷰<br>작성</span></td><td><small>확인 대기</small></td><td><small>확인 대기</small></td></tr></table></div>
      <div class="rs-meta"><span>작성 <b>오너뷰 자동</b></span><span>기준 <b>9/15 09:00</b></span><span>수신 <b>대표이사</b></span></div>
      <h6>1. 자금 현황</h6>
      <table class="rs-rt"><tr><th>구분</th><th>금액(원)</th><th>전월 대비</th></tr><tr><td>통장 잔액</td><td class="n"><span class="rs-v" data-v="230400000">230,400,000</span></td><td class="c up">▲ 5.5%</td></tr><tr><td>순현금흐름</td><td class="n"><span class="rs-v" data-v="12100000" data-p="+">+12,100,000</span></td><td class="c up">▲ 2.1%</td></tr></table>
      <h6>2. 손익 현황</h6>
      <div class="rs-pl"><div><small>매출</small><b><span class="rs-v" data-v="40880000">40,880,000</span></b> <span class="up" style="font-size:10px">▲1%</span></div><div><small>영업이익</small><b><mark><span class="rs-v" data-v="30620000">30,620,000</span></mark></b></div><svg class="rs-fill" viewBox="0 0 118 40">${rsBars}</svg></div>
      <h6>3. 채권·채무</h6>
      <table class="rs-rt"><tr><td>미수금</td><td class="n"><mark><span class="rs-v" data-v="16500000">16,500,000</span></mark></td><td class="c dn">30일 초과 1곳</td></tr><tr><td>30일 내 지급 예정</td><td class="n"><span class="rs-v" data-v="48613900">48,613,900</span></td><td class="c">충당 가능</td></tr></table>
      <h6>4. 프로젝트 현황</h6>
      <table class="rs-rt"><tr><th>진행 중</th><th>이번 달 정산 예정(원)</th><th>일정 지연</th></tr><tr><td class="c"><span class="rs-v" data-v="12" data-u="건">12건</span></td><td class="n"><span class="rs-v" data-v="8910000">8,910,000</span></td><td class="c dn"><mark>1건 · 물류센터 설비</mark></td></tr></table>
      <h6>5. 이번 주 To-do</h6>
      <ul class="rs-todo"><li class="rs-fill">원천세 신고·납부<em><mark>D-5</mark></em></li><li class="rs-fill">9월 급여 배치 확인<em>9/24</em></li><li class="rs-fill">미수금 회수 연락 · 정우엔지니어링<em>이번 주</em></li></ul>
      <div class="rs-foot"><span>오너뷰 자동 작성 보고서 · 확인 후 결재</span><span>1 / 1</span></div>
    </div>`;
  const RS_CH = ["+8,910,000","−1,240,000","계산서 4,235,000","전표 128건","미수 16,500,000","주문 128건","웹사이트 구축 3회차","입고 +50","급여 45,300,000","결재 23건","원천세 신고","출근 11명"];
  RS_CH.forEach((c) => { const el = document.createElement("span"); el.className = "rs-chip num"; el.textContent = c; RS.appendChild(el); });
  const rsRows = [...RS.querySelectorAll(".rs-r")], rsNums = [...RS.querySelectorAll(".rs-n")], rsChips = [...RS.querySelectorAll(".rs-chip")];
  const rsRep = RS.querySelector(".rs-rp"), rsVals = [...rsRep.querySelectorAll(".rs-v")], rsMarks = [...rsRep.querySelectorAll("mark")], rsSeal = rsRep.querySelector(".rs-seal");
  const rsTargets = [rsVals[0], rsVals[1], rsVals[2], rsVals[3], rsRep.querySelector("svg.rs-fill"), rsVals[4], rsVals[5], rsVals[6], rsVals[7], ...rsRep.querySelectorAll("li.rs-fill")];
  const rsChipRow = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 3, 8];
  function rsPos(el){ if (!(el instanceof HTMLElement)) { const sr = RS.getBoundingClientRect(), k = sr.width / 1100, r = el.getBoundingClientRect(); return [(r.left + r.width / 2 - sr.left) / k, (r.top + r.height / 2 - sr.top) / k]; }
    let x = el.offsetWidth / 2, y = el.offsetHeight / 2, n = el; while (n && n !== RS) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return [x, y]; }
  function reportScene(t){
    // 좁은 화면: 왼쪽 수집 목록·날아가는 칩을 감추고 보고서만 가운데 크게(1100 폭 그대로 줄이면 글자가 안 읽힌다)
    const narrow = innerWidth < 760;
    RS.classList.toggle("narrow", narrow);
    RS.style.setProperty("--k", String(narrow ? Math.min(innerWidth * .94 / 520, (innerHeight - 76) / 900) : Math.min(innerWidth * .96 / 1100, (innerHeight - 76) / 900)));
    const cq = ease(clamp(t / 3.6)); rsNums.forEach((el) => { const v = Math.round(+el.dataset.n * cq).toLocaleString("ko-KR"); if (el.textContent !== v) el.textContent = v; });
    rsTargets.forEach((el, i) => { const st = .5 + i * .36, q = clamp((t - st) / .7), e = ease(q), ch = rsChips[i];
      const [sx, sy] = rsPos(rsRows[rsChipRow[i]]), [tx, ty] = rsPos(el);
      const x = lerp(sx + 120, tx, e), y = lerp(sy, ty, e) - Math.sin(e * Math.PI) * 60;
      ch.style.transform = `translate(${x - ch.offsetWidth / 2}px, ${y - 13}px) scale(${lerp(1, .55, e)})`;
      ch.style.opacity = q <= 0 || q >= 1 ? "0" : String(Math.min(1, q * 5, (1 - q) * 4));
      const done = q >= 1; el.classList.toggle("fill", done);
      if (el.classList.contains("rs-v")) { const f = done ? ease(clamp((t - st - .7) / .6)) : 0; const txt = (el.dataset.p || "") + Math.round(+el.dataset.v * f).toLocaleString("ko-KR") + (el.dataset.u || ""); if (el.textContent !== txt) el.textContent = txt; } });
    rsMarks.forEach((m, i) => m.style.setProperty("--hw", (ease(clamp((t - 6.2 - i * .35) / .4)) * 100).toFixed(1) + "%"));
    const sq = clamp((t - 7.8) / .35); rsSeal.style.setProperty("--so", String(sq)); rsSeal.style.setProperty("--sc", String(sq < 1 ? lerp(1.8, 1, ease(sq)) : 1));
  }



  /* ⓖ 템플릿 — 몇 초마다 다음 템플릿, 눌러도 바뀜 */
  const TPLS = [
    { ic:"i-chart", name:"마케팅 캠페인", cat:"마케팅", sub:"한 줄 = 소재·채널 하나", cols:[["기획","#9aa0b5"],["제작 중","#FDAB3D"],["집행 중","#5559DF"],["종료","#00C875"]],
      cards:[[["추석 할인 문자","문자","gry","9/20","배","b"],["유튜브 리뷰 협찬","유튜브","red","10/02","이","c"]],[["9월 신제품 인스타 광고","인스타","ind","₩1,200,000","임","d"]],[["네이버 검색광고","네이버","grn","월 ₩800,000","문",""],["블로그 체험단","블로그","gry","20명","배","b"]],[["8월 브랜드 캠페인","인스타","ind","CTR 2.4%","임","d"]]] },
    { ic:"i-users", name:"채용 파이프라인", cat:"인사", sub:"한 줄 = 지원자 하나", cols:[["지원","#9aa0b5"],["서류 통과","#5559DF"],["면접","#FDAB3D"],["합격","#00C875"]],
      cards:[[["박서연 · 매장 매니저","지원 9/12","gry","이력서","문",""],["윤지호 · 물류","지원 9/13","gry","포트폴리오","이","c"]],[["최도윤 · 디자이너","서류 통과","ind","포트폴리오","배","b"]],[["정하린 · 회계 담당","면접 9/18","amb","2차","문",""]],[["한유진 · 영업","합격","grn","입사 10/1","문",""]]] },
    { ic:"i-cart", name:"구매·발주", cat:"운영·구매", sub:"한 줄 = 발주 건 하나", cols:[["요청","#9aa0b5"],["발주","#FDAB3D"],["입고","#5559DF"],["정산","#00C875"]],
      cards:[[["사무용 의자 6개","총무팀","gry","₩1,080,000","오","b"]],[["포장 박스 500개","대한포장","amb","₩650,000","이","c"],["프린터 토너","오피스몰","amb","₩240,000","오","b"]],[["케이블 정리함 50개","정우산업","ind","입고 9/16","이","c"]],[["매장 조명 교체","빛나라전기","grn","₩2,300,000","문",""]]] },
    { ic:"i-brief", name:"고객 용역·납품", cat:"프로젝트 관리", sub:"한 줄 = 수주 건 하나", cols:[["견적","#9aa0b5"],["계약","#FDAB3D"],["진행","#5559DF"],["청구","#00C875"]],
      cards:[[["브랜드 리뉴얼 · 든든상회","견적 보냄","gry","₩12,100,000","임","d"]],[["웹사이트 구축 · 미래테크","서명 완료","grn","₩24,300,000","문",""]],[["매장 인테리어 · 온샘","진행률 67%","amb","10/02 검수","배","b"],["물류센터 설비","지연 5일","red","₩74,000,000","이","c"]],[["카탈로그 촬영","2회차 발행","ind","₩4,400,000","문",""]]] }];
  $("#tplSide").innerHTML = TPLS.map((t, i) => `<button type="button" data-i="${i}"><i><svg class="li"><use href="#${t.ic}"/></svg></i><span><b>${t.name}</b><small>${t.cat}</small></span></button>`).join("") +
    `<div class="tpl-more">이 밖에 <b>SNS 게시 일정 · 디자인 요청 · 제품 로드맵 · 신입 온보딩 · 업체 평가</b> 등 26종이 있고, 쓰던 구성은 <b>우리 회사 양식</b>으로 저장합니다.</div>`;
  const tplBtns = [...document.querySelectorAll("#tplSide button")];
  let tplI = 0, tplT0 = performance.now(), tplVis = false; const TPL_DUR = 3800;
  function showTpl(i){ tplI = i; tplT0 = performance.now(); const t = TPLS[i];
    tplBtns.forEach((b, j) => b.classList.toggle("on", j === i)); $("#tplName").textContent = t.name; $("#tplSub").textContent = t.sub;
    $("#tplCols").innerHTML = t.cols.map(([h, c], k) => `<div class="tpl-col"><div class="pc-ch"><i style="background:${c}"></i>${h}<span>${t.cards[k].length}</span></div>${t.cards[k].map(([n, m, bc, v, a, ac], q) => `<div class="tpl-k" style="animation-delay:${k * 70 + q * 60}ms"><b>${n}</b><div class="mt"><span class="bd ${bc}">${m}</span><span class="num">${v}</span><i class="pc-av ${ac}">${a}</i></div></div>`).join("")}</div>`).join(""); }
  tplBtns.forEach((b) => b.addEventListener("click", () => showTpl(+b.dataset.i)));
  showTpl(0);
  new IO((es) => { tplVis = es[0].isIntersecting; if (tplVis) tplT0 = performance.now(); }, { threshold:.3 }).observe($("#tplCols"));
  function tplTick(now){ if (!tplVis || reduce) return; const q = (now - tplT0) / TPL_DUR; $("#tplProg").style.width = Math.min(100, q * 100) + "%"; if (q >= 1) showTpl((tplI + 1) % TPLS.length); }

  /* ⓕ 프로젝트 — 스크롤로 보드 → 협업 → 캘린더 → 간트 */
  const PC_TX = [["1 · 보드","회사가 정한 단계로 일을 나눕니다","할 일·진행 중·검토·완료처럼 단계를 직접 정하고, 카드마다 담당자를 지정합니다. 외부 파트너도 담당으로 넣을 수 있습니다."],
    ["2 · 협업","대화와 파일이 일 옆에 남습니다","카드를 열면 체크리스트·첨부·전자계약이 함께 있고, 댓글에서 @이름으로 부르면 알림이 갑니다. 상태 변경도 기록에 같이 쌓입니다."],
    ["3 · 캘린더","마감이 달력에 모입니다","따로 일정표를 만들지 않아도 마감이 날짜별로 놓이고, 서명 지연·마감 임박 업무는 지금 할 일에 먼저 올라옵니다."],
    ["4 · 간트","기간과 늦어진 일을 한눈에","같은 데이터를 간트로 바꾸면 기간이 막대로 보이고, 오늘 기준으로 늦어진 건이 빨간색으로 표시됩니다."]];
  $("#pcList").innerHTML = PC_TX.map(([k, t, d]) => `<div class="pc-it"><small>${k}</small><b>${t}</b><span>${d}</span><em class="more">프로젝트 자세히 보기 <i>→</i></em></div>`).join("");
  const PC_EV = {18:[["광고 소재 시안","#5559DF"]],20:[["추석 할인 문자","#9aa0b5"]],22:[["인스타 소재 마감","#FDAB3D"]],24:[["광고 집행 시작","#5559DF"]],25:[["장소 계약 서명","#E2445C"]],26:[["보도자료","#9aa0b5"]],27:[["상세페이지 마감","#FDAB3D"],["디자인랩 수정본","#5559DF"]],30:[["POP 인쇄 발주","#9aa0b5"]]};
  let pcCal = ["일","월","화","수","목","금","토"].map((d) => `<div class="wd">${d}</div>`).join("") + '<div class="dc blank"></div>';
  for (let d = 14; d <= 30; d++) pcCal += `<div class="dc${d === 15 ? " today" : ""}">${d}${(PC_EV[d] || []).map(([n, c], q) => `<span class="ev" style="background:${c};transition-delay:${(d - 14) * 45 + q * 40}ms">${n}</span>`).join("")}</div>`;
  $("#pcCalGrid").innerHTML = pcCal;
  const PC_G = [["상세페이지 리뉴얼",.4,4.2,"#FDAB3D",.6,"배수정 · 디자인랩"],["인스타 광고 소재",0,3,"#5559DF",.8,"임하늘"],["출시 행사 장소 계약",1,3.2,"#E2445C",.3,"서명 지연"],["보도자료 작성",2.6,4.6,"#9aa0b5",0,"이준호"],["광고 집행",3.4,7.6,"#00C875",0,"네이버·인스타"]];
  $("#pcGn").innerHTML = `<div class="pc-gr pc-gh"><span class="nm">항목</span><div class="pc-gt">${["9/14","9/21","9/28","10/5","10/12","10/19","10/26","11/2"].map((w) => `<span>${w}</span>`).join("")}</div></div>` +
    PC_G.map(([n, a, b, c, pr, lab], i) => `<div class="pc-gr"><span class="nm">${n}</span><div class="pc-gt"><i class="pc-gbar" style="left:${a * 12.5}%;width:${(b - a) * 12.5}%;--c:${c};transition-delay:${i * 90}ms"><em style="width:${pr * 100}%"></em><span>${lab}</span></i></div></div>`).join("") +
    `<i class="pc-today" style="left:calc(150px + (100% - 150px) * .018)"><span>오늘</span></i>`;
  const pcItems = [...document.querySelectorAll(".pc-it")], pcViews = [...document.querySelectorAll("#pcViews span")], pcStage = $("#pcStage"), pcCis = [...document.querySelectorAll(".pc-ci")];
  const pcLys = [$("#pcBoard"), $("#pcCal"), $("#pcGantt")];
  let pcPhase = -1;
  function projectScene(){
    const sec = $("#c16"), rc = sec.getBoundingClientRect(); if (rc.bottom < 0 || rc.top > innerHeight) return;
    const p = prog(sec), ph = p < .26 ? 0 : p < .52 ? 1 : p < .76 ? 2 : 3;
    if (ph !== pcPhase) { pcPhase = ph; pcItems.forEach((el, j) => el.classList.toggle("on", j === ph));
      pcViews.forEach((b, j) => b.classList.toggle("on", j === [1, 1, 2, 3][ph]));
      pcLys[0].classList.toggle("on", ph <= 1); pcLys[1].classList.toggle("on", ph === 2); pcLys[2].classList.toggle("on", ph === 3);
      pcStage.classList.toggle("open", ph === 1); }
    pcStage.classList.toggle("assigned", p > .08);
    pcCis.forEach((c, k) => c.classList.toggle("in", p > .31 + k * .055));
  }

  function frame(ms){
    if (!live()) return;
    const t = ms / 1000;
    hero(); belt(); papers(); acc(); terms(); tabs(); fin(); cashcal(); stockScene(); mobile(); collage(); projectScene(); tplTick(ms);
    const mid = innerHeight / 2; let ri = 0; secs.forEach((el, i) => { if (el.getBoundingClientRect().top < mid) ri = i; }); railI.forEach((x, i) => x.classList.toggle("on", i === ri));
    globe(reduce ? 0 : t); silk(reduce ? 0 : t);
    if (!reduce) rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
  on("scroll", () => { if (reduce) frame(0); }, { passive:true });

  return () => {
    alive = false;
    cancelAnimationFrame(rafId);
    ios.forEach((o) => o.disconnect());
    intervals.forEach((id) => clearInterval(id));
    timeouts.forEach((id) => clearTimeout(id));
    listeners.forEach(([t, f, o]) => window.removeEventListener(t, f, o));
  };
}
