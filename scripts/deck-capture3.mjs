import { chromium } from "playwright";
const BASE="http://localhost:3111";
const HIDE=`nextjs-portal,[data-nextjs-dev-overlay],#channel-plugin-launcher,iframe#ch-plugin-script,div[id^="ch-plugin"]{display:none!important}`;
const b=await chromium.launch({headless:true});
const c=await b.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:2,locale:"ko-KR",timezoneId:"Asia/Seoul"});
const p=await c.newPage();
await p.goto(`${BASE}/auth`); await p.fill('input[type=email]',"demo-ov-owner@mo-tive.com");
await p.fill('input[type=password]',"OvDemo!2026"); await p.click('button[type=submit]'); await p.waitForTimeout(7000);
// 원장 — 거래처 하나 골라서
await p.goto(`${BASE}/partners/ledger`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
await p.addStyleTag({content:HIDE}).catch(()=>{});
await p.locator("button, tr, li").filter({hasText:"가온컴퍼니"}).first().click({timeout:8000}).catch(()=>{});
await p.waitForTimeout(4000);
await p.screenshot({path:"cap/v-ledger2.png"}); console.log("📸 v-ledger2");
// 대시보드 — 위젯 아래쪽까지
await p.goto(`${BASE}/dashboard`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
await p.addStyleTag({content:HIDE}).catch(()=>{});
await p.mouse.wheel(0,700); await p.waitForTimeout(1500);
await p.screenshot({path:"cap/v-dash-scroll.png"}); console.log("📸 v-dash-scroll");
// AI 참모
await p.goto(`${BASE}/copilot`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
await p.addStyleTag({content:HIDE}).catch(()=>{});
await p.screenshot({path:"cap/v-copilot.png"}); console.log("📸 v-copilot");
// 구성원 권한 탭
await p.goto(`${BASE}/employees`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
await p.addStyleTag({content:HIDE}).catch(()=>{});
await p.getByRole("button",{name:/탭 권한|권한/}).first().click({timeout:6000}).catch(()=>{});
await p.waitForTimeout(3500);
await p.screenshot({path:"cap/v-perm.png"}); console.log("📸 v-perm");
await b.close(); console.log("done");
