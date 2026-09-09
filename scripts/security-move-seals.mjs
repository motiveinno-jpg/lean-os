// 회사 직인을 공개 버킷(company-assets)에서 비공개 버킷(company-private/{companyId}/seal/)으로 옮긴다.
//   화면·PDF 는 companies.seal_url 을 resolveSealUrl 로 서명해 읽고, 계약서 HTML 에는 data: 로 박히므로
//   옮긴 뒤에도 기존 문서·다운로드 흐름은 그대로다. 옛 주소를 문서 HTML 이 직접 물고 있으면 그 회사는 옛 파일을 지우지 않는다.
//
//   실행(미리보기):  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/security-move-seals.mjs
//   실제 이동:       … node scripts/security-move-seals.mjs --apply [--keep-old] [--out moved.json]
//   되돌리기:        … node scripts/security-move-seals.mjs --rollback moved.json
import fs from "node:fs";

const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!URL_ || !KEY) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요"); process.exit(2); }
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const KEEP_OLD = args.includes("--keep-old");
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : `seal-move-${new Date().toISOString().slice(0, 10)}.json`;
const ROLLBACK = args.includes("--rollback") ? args[args.indexOf("--rollback") + 1] : null;

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(path, init = {}) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { ...H, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return json;
}
async function download(bucket, path) {
  const res = await fetch(`${URL_}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: H });
  if (!res.ok) throw new Error(`download ${bucket}/${path} → ${res.status}`);
  return { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") || "application/octet-stream" };
}
async function upload(bucket, path, body, type) {
  const res = await fetch(`${URL_}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST", headers: { ...H, "Content-Type": type, "x-upsert": "true" }, body,
  });
  if (!res.ok) throw new Error(`upload ${bucket}/${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
}
async function remove(bucket, path) {
  const res = await fetch(`${URL_}/storage/v1/object/${bucket}`, { method: "DELETE", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [path] }) });
  if (!res.ok) throw new Error(`delete ${bucket}/${path} → ${res.status}`);
}
const parse = (url) => { const m = String(url || "").match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/); return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null; };
const publicUrl = (bucket, path) => `${URL_}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;

// 문서 HTML 이 옛 경로를 직접 물고 있는지 (계약서는 data: 로 합성되지만, 오래된 문서가 주소를 갖고 있을 수 있다)
const HTML_COLS = [["signature_requests", "template_snapshot_html"], ["signature_requests", "signed_contract_html"], ["signature_requests", "our_signed_contract_html"], ["quote_approvals", "signed_contract_html"], ["contract_templates", "body_html"]];
async function referencedCount(companyId, oldPath) {
  let n = 0;
  for (const [t, c] of HTML_COLS) {
    const rows = await rest(`/rest/v1/${t}?company_id=eq.${companyId}&${c}=like.*${encodeURIComponent(oldPath.replace(/[%_]/g, "\\$&"))}*&select=id&limit=1`);
    n += Array.isArray(rows) ? rows.length : 0;
  }
  return n;
}

if (ROLLBACK) {
  const moved = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
  for (const m of moved) {
    try {
      const probe = await fetch(`${URL_}/storage/v1/object/${m.oldBucket}/${m.oldPath.split("/").map(encodeURIComponent).join("/")}`, { method: "HEAD", headers: H });
      if (!probe.ok) { const f = await download(m.newBucket, m.newPath); await upload(m.oldBucket, m.oldPath, f.body, f.type); }
      await rest(`/rest/v1/companies?id=eq.${m.companyId}`, { method: "PATCH", body: JSON.stringify({ seal_url: m.oldUrl }) });
      console.log(`RESTORED ${m.companyId} ← ${m.oldBucket}/${m.oldPath}`);
    } catch (e) { console.error(`FAIL ${m.companyId}: ${e.message}`); }
  }
  process.exit(0);
}

const companies = await rest(`/rest/v1/companies?seal_url=like.*%2Fcompany-assets%2F*&select=id,name,seal_url&order=name`);
console.log(`${APPLY ? "이동" : "미리보기"}: 공개 버킷 직인 ${companies.length}건`);
const moved = [];
for (const co of companies) {
  const ref = parse(co.seal_url);
  if (!ref || ref.bucket !== "company-assets") { console.log(`SKIP ${co.name}: 주소 해석 실패 ${co.seal_url}`); continue; }
  const base = ref.path.split("/").pop();
  const newPath = `${co.id}/seal/${base}`;
  const refs = await referencedCount(co.id, ref.path);
  const keepOld = KEEP_OLD || refs > 0;
  console.log(`${APPLY ? "MOVE" : "PLAN"} ${co.name}: company-assets/${ref.path} → company-private/${newPath}${keepOld ? " (옛 파일 유지" + (refs ? `, 문서 ${refs}건이 옛 주소 참조` : "") + ")" : ""}`);
  if (!APPLY) continue;
  try {
    const f = await download("company-assets", ref.path);
    await upload("company-private", newPath, f.body, f.type);
    const newUrl = publicUrl("company-private", newPath);
    await rest(`/rest/v1/companies?id=eq.${co.id}`, { method: "PATCH", body: JSON.stringify({ seal_url: newUrl }) });
    if (!keepOld) await remove("company-assets", ref.path);
    moved.push({ companyId: co.id, oldBucket: "company-assets", oldPath: ref.path, oldUrl: co.seal_url, newBucket: "company-private", newPath, newUrl, oldKept: keepOld });
  } catch (e) { console.error(`FAIL ${co.name}: ${e.message}`); }
}
if (APPLY) { fs.writeFileSync(OUT, JSON.stringify(moved, null, 2)); console.log(`완료 ${moved.length}건 — 되돌리기 정보: ${OUT}`); }
