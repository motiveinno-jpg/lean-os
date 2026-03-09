#!/usr/bin/env npx tsx
/**
 * LeanOS Local Agent — IBK 기업은행 거래내역 자동 다운로드
 *
 * 방식: CDP(Chrome DevTools Protocol) + OpenSSL CMS 서명 (Delfino 다이얼로그 불필요)
 *
 * 실행: npx tsx scripts/local-agent.ts bank
 *
 * 전제:
 * - Chrome이 --remote-debugging-port=9222 로 실행 중
 * - IBK 기업뱅킹 페이지가 열려 있거나 접근 가능
 * - 공동인증서 설치 완료 (~/NPKI 또는 ~/Library/Preferences/NPKI)
 * - macOS Keychain에 "leanos-ibk-cert-pw" 등록
 * - OpenSSL (Homebrew) 설치 (/opt/homebrew/bin/openssl 또는 /usr/local/bin/openssl)
 *
 * 보안 원칙:
 * - 인증서/비밀번호는 로컬 OS 보안 저장소에만 저장
 * - OwnerView 서버/DB에 인증정보 전송 금지
 * - 다운로드된 거래 데이터만 EF를 통해 DB에 저장
 * - 복호화된 개인키는 /tmp에 임시 생성, 사용 후 삭제
 */

import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import WebSocket from 'ws';
import * as crypto from 'crypto';

// ── .env.local 로드 ──
try {
  const envPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    }
  }
} catch { /* ignore */ }

// ── 설정 ──
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://njbvdkuvtdtkxyylwngn.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const COMPANY_ID = process.env.COMPANY_ID || 'c361afb9-8a52-4cac-add9-8992f0f7c09c';
const CDP_PORT = process.env.CDP_PORT || '9222';
const OPENSSL_BIN = fs.existsSync('/opt/homebrew/bin/openssl') ? '/opt/homebrew/bin/openssl' : '/usr/local/bin/openssl';
const OPENSSL_LEGACY_CNF = '/tmp/openssl_legacy.cnf';

const CERT_SEARCH_PATHS = [
  path.join(os.homedir(), 'NPKI'),
  path.join(os.homedir(), 'Library', 'Preferences', 'NPKI'),
];

// IBK 계좌 목록
const IBK_ACCOUNTS = [
  { no: '99002393104017', name: '운영계좌' },
  { no: '06810383504017', name: '보조금_홍보지원' },
  { no: '06810383504024', name: '보조금_SNS활용' },
  { no: '60706445701011', name: '모티브_기타' },
  { no: '99002393104024', name: '2023마케팅PD' },
  { no: '99002393101042', name: '대출' },
];

// ── 로그 ──
function log(msg: string) {
  const ts = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`[${ts}] ${msg}`);
}
function logError(msg: string) {
  const ts = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.error(`[${ts}] ERROR: ${msg}`);
}

// ── 유틸 ──
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function sh(cmd: string, env?: Record<string, string>): string {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000,
      env: env ? { ...process.env, ...env } : undefined,
    }).trim();
  } catch { return ''; }
}

// ═══════════════════════════════════════════════════════════════
// NPKI 인증서 처리
// ═══════════════════════════════════════════════════════════════

function findFiles(dir: string, name: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findFiles(full, name));
      else if (entry.name === name) results.push(full);
    }
  } catch { /* skip */ }
  return results;
}

function findCertDir(): string {
  for (const base of CERT_SEARCH_PATHS) {
    if (!fs.existsSync(base)) continue;
    const certFiles = findFiles(base, 'signCert.der');
    if (certFiles.length > 0) return path.dirname(certFiles[0]);
  }
  throw new Error('공동인증서를 찾을 수 없습니다.');
}

// Supabase에서 인증정보 가져오기 (오너뷰 설정에서 등록)
// 서비스명 매핑: ibk → bank_ibk_0, lottecard → card_lottecard_0, hometax → hometax
async function fetchCredentialFromDB(service: string): Promise<any | null> {
  // 새 형식 + 레거시 형식 모두 조회
  const candidates = [service];
  if (service === 'ibk' || service === 'shinhan' || service === 'woori' || service === 'kookmin') {
    candidates.push(`bank_${service}_0`);
  } else if (service === 'lottecard' || service === 'samsung_card' || service === 'hyundai_card') {
    candidates.push(`card_${service}_0`);
  } else if (service.startsWith('bank_') || service.startsWith('card_')) {
    // 이미 새 형식이면 레거시도 추가
    const legacy = service.replace(/^bank_/, '').replace(/^card_/, '').replace(/_\d+$/, '');
    candidates.push(legacy);
  }

  for (const svc of candidates) {
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/automation_credentials?company_id=eq.${COMPANY_ID}&service=eq.${svc}&select=credentials`,
        { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      if (!resp.ok) continue;
      const rows = await resp.json();
      if (rows.length > 0 && rows[0].credentials) return rows[0].credentials;
    } catch { /* try next */ }
  }
  return null;
}

// 캐시 (세션 중 한 번만 조회)
const _credCache: Record<string, any> = {};
async function getCredential(service: string): Promise<any | null> {
  if (_credCache[service]) return _credCache[service];
  const cred = await fetchCredentialFromDB(service);
  if (cred) { _credCache[service] = cred; return cred; }
  return null;
}

function getCertPassword(): string {
  // 동기 함수 — Keychain에서 가져오기 (폴백)
  const pw = sh('security find-generic-password -s "leanos-ibk-cert-pw" -a "cert" -w');
  if (!pw) throw new Error('인증서 비밀번호 미등록.\n→ 오너뷰 설정 > 인증서 탭에서 등록하거나\n→ bash scripts/setup-keychain.sh 를 실행하세요.');
  return pw;
}

// 비동기 버전 — Supabase 우선, Keychain 폴백
async function getCertPasswordAsync(): Promise<string> {
  const dbCred = await getCredential('ibk');
  if (dbCred?.cert_password) return dbCred.cert_password;
  return getCertPassword(); // keychain fallback
}

/** OpenSSL 레거시 설정 (SEED 암호 지원) */
function ensureOpenSSLConfig(): void {
  if (!fs.existsSync(OPENSSL_LEGACY_CNF)) {
    fs.writeFileSync(OPENSSL_LEGACY_CNF, `
openssl_conf = openssl_init
[openssl_init]
providers = provider_sect
[provider_sect]
default = default_sect
legacy = legacy_sect
[default_sect]
activate = 1
[legacy_sect]
activate = 1
`);
  }
}

/** ASN.1 DER 길이 파싱 */
function parseDERLen(buf: Buffer, pos: number): { len: number; size: number } {
  const first = buf[pos];
  if (first < 0x80) return { len: first, size: 1 };
  const n = first & 0x7f;
  let len = 0;
  for (let i = 0; i < n; i++) len = (len << 8) | buf[pos + 1 + i];
  return { len, size: 1 + n };
}

/** PKCS#8 EncryptedPrivateKeyInfo DER → salt, iterations, iv, encryptedData (순수 Node.js 파싱) */
function parsePKCS8Enc(der: Buffer): { salt: Buffer; iterations: number; iv: Buffer; encryptedData: Buffer } {
  const octetStrings: Buffer[] = [];
  const integers: number[] = [];

  function walk(start: number, end: number) {
    let pos = start;
    while (pos < end) {
      const tag = der[pos++];
      const { len, size } = parseDERLen(der, pos);
      pos += size;
      const valEnd = pos + len;
      if (tag & 0x20) {       // constructed → 재귀
        walk(pos, valEnd);
      } else if (tag === 0x04) { // OCTET STRING
        octetStrings.push(Buffer.from(der.subarray(pos, valEnd)));
      } else if (tag === 0x02) { // INTEGER
        let v = 0;
        for (let i = pos; i < valEnd; i++) v = (v << 8) | der[i];
        integers.push(v);
      }
      pos = valEnd;
    }
  }
  walk(0, der.length);

  const salt = octetStrings.find(o => o.length === 8);
  const iv = octetStrings.find(o => o.length === 16);
  const encryptedData = octetStrings.find(o => o.length > 100);
  const iterations = integers.find(i => i >= 1000) || 2048;

  if (!salt || !iv || !encryptedData)
    throw new Error(`PKCS#8 파싱 실패 (octets: ${octetStrings.map(o => o.length).join(',')})`);

  return { salt, iterations, iv, encryptedData };
}

/** signPri.key → RSA PEM 복호화 + VID_RANDOM 추출 */
function decryptPrivateKey(certDir: string, password: string): { rsaPemPath: string; certPemPath: string; vidRandom: string } {
  const signPriPath = path.join(certDir, 'signPri.key');
  const signCertPath = path.join(certDir, 'signCert.der');

  if (!fs.existsSync(signPriPath)) throw new Error(`signPri.key not found: ${signPriPath}`);
  if (!fs.existsSync(signCertPath)) throw new Error(`signCert.der not found: ${signCertPath}`);

  // /tmp로 복사 (한글 경로 shell 이슈 방지)
  const tmpPri = '/tmp/ibk_signPri.key';
  const tmpCert = '/tmp/ibk_signCert.der';
  fs.copyFileSync(signPriPath, tmpPri);
  fs.copyFileSync(signCertPath, tmpCert);

  // DER cert → PEM
  const certPemPath = '/tmp/ibk_cert.pem';
  sh(`${OPENSSL_BIN} x509 -inform DER -in ${tmpCert} -out ${certPemPath}`);

  // DER 바이너리 직접 파싱 (openssl asn1parse 대신 → regex 실패 원천 차단)
  const derData = fs.readFileSync(tmpPri);
  const { salt, iterations, iv, encryptedData } = parsePKCS8Enc(derData);
  log(`PKCS#8: salt=${salt.toString('hex').substring(0, 8)}..., iter=${iterations}, enc=${encryptedData.length}B`);

  // PBKDF2 키 유도 (SHA-1)
  const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 16, 'sha1');

  // SEED-CBC 복호화 (-nopad → 수동 PKCS#7 패딩 제거)
  const encBinPath = '/tmp/enc_data.bin';
  const decRawPaddedPath = '/tmp/dec_raw_padded.bin';
  fs.writeFileSync(encBinPath, encryptedData);

  ensureOpenSSLConfig();
  const decResult = sh(
    `${OPENSSL_BIN} enc -d -seed-cbc -K ${derivedKey.toString('hex')} -iv ${iv.toString('hex')} -nopad -in ${encBinPath} -out ${decRawPaddedPath}`,
    { OPENSSL_CONF: OPENSSL_LEGACY_CNF }
  );
  if (!fs.existsSync(decRawPaddedPath) || fs.statSync(decRawPaddedPath).size === 0)
    throw new Error(`SEED-CBC 복호화 실패: ${decResult}`);

  // PKCS#7 패딩 제거
  const padded = fs.readFileSync(decRawPaddedPath);
  const padLen = padded[padded.length - 1];
  if (padLen < 1 || padLen > 16) throw new Error(`잘못된 PKCS#7 패딩: ${padLen}`);
  const decData = padded.subarray(0, padded.length - padLen);
  const decPath = '/tmp/dec_raw.bin';
  fs.writeFileSync(decPath, decData);

  // PKCS#8 PrivateKeyInfo → RSA PEM
  const rsaPemPath = '/tmp/ibk_rsa.pem';
  const pKeyResult = sh(`${OPENSSL_BIN} pkey -inform DER -in ${decPath} -out ${rsaPemPath} 2>&1`);
  if (!fs.existsSync(rsaPemPath) || fs.statSync(rsaPemPath).size === 0)
    throw new Error(`RSA 키 변환 실패: ${pKeyResult}`);

  // VID_RANDOM 추출 — 복호화된 DER에서 OID 바이트 시퀀스 직접 검색
  // OID 1.2.410.200004.10.1.1.3 = 06 0A 2A 83 1A 8C 9A 44 0A 01 01 03
  const VID_OID = Buffer.from('060a2a831a8c9a440a010103', 'hex');
  const oidPos = decData.indexOf(VID_OID);
  let vidRandom = '';
  if (oidPos >= 0) {
    // OID 뒤: SET(31 xx) → BIT STRING(03 xx 00 [vid_data...])
    let pos = oidPos + VID_OID.length;
    // SET 건너뛰기
    if (decData[pos] === 0x31) {
      pos++; // SET tag
      const { size: setLenSize } = parseDERLen(decData, pos);
      pos += setLenSize;
    }
    // BIT STRING 파싱
    if (decData[pos] === 0x03) {
      pos++; // BIT STRING tag
      const { len: bitLen, size: bitLenSize } = parseDERLen(decData, pos);
      pos += bitLenSize;
      pos++; // unused bits byte (0x00)
      const vidBytes = decData.subarray(pos, pos + bitLen - 1);
      vidRandom = vidBytes.toString('base64');
    }
  }
  if (!vidRandom) throw new Error('VID_RANDOM 추출 실패');
  log(`VID_RANDOM: ${vidRandom.substring(0, 10)}...`);

  // /tmp 임시파일 정리
  for (const f of [tmpPri, tmpCert, encBinPath, decRawPaddedPath]) {
    try { fs.unlinkSync(f); } catch { /* ok */ }
  }

  return { rsaPemPath, certPemPath, vidRandom };
}

/** CMS 서명 생성 */
function signData(data: string, certPemPath: string, rsaPemPath: string): string {
  const signDataPath = '/tmp/sign_data.txt';
  const signedDerPath = '/tmp/signed.der';

  fs.writeFileSync(signDataPath, data);

  ensureOpenSSLConfig();
  const result = sh(
    `${OPENSSL_BIN} cms -sign -signer ${certPemPath} -inkey ${rsaPemPath} -in ${signDataPath} -outform DER -out ${signedDerPath} -nodetach -nosmimecap 2>&1`,
    { OPENSSL_CONF: OPENSSL_LEGACY_CNF }
  );

  if (!fs.existsSync(signedDerPath) || fs.statSync(signedDerPath).size === 0) {
    throw new Error(`CMS 서명 실패: ${result}`);
  }

  return fs.readFileSync(signedDerPath).toString('base64');
}

// ═══════════════════════════════════════════════════════════════
// CDP 통신
// ═══════════════════════════════════════════════════════════════

class CDPClient {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pendingCallbacks = new Map<number, (result: any) => void>();

  async connect(pageId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${CDP_PORT}/devtools/page/${pageId}`);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.pendingCallbacks.has(msg.id)) {
          this.pendingCallbacks.get(msg.id)!(msg);
          this.pendingCallbacks.delete(msg.id);
        }
      });
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => { this.pendingCallbacks.delete(id); resolve(null); }, 20000);
      this.pendingCallbacks.set(id, (result) => { clearTimeout(timer); resolve(result); });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  /** window.frames[0] 컨텍스트에서 JS 실행 */
  async ev(expression: string, timeout = 20000): Promise<any> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    const res = result?.result?.result || {};
    return res.value ?? res.description ?? null;
  }

  close() { this.ws?.close(); }
}

// ═══════════════════════════════════════════════════════════════
// IBK 거래내역 다운로드 (전체 체인)
// ═══════════════════════════════════════════════════════════════

async function findIBKPage(): Promise<string | null> {
  try {
    const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
    const tabs = await resp.json() as { id: string; url: string }[];
    for (const t of tabs) {
      if (t.url?.includes('ibk.co.kr')) return t.id;
    }
  } catch { /* not available */ }
  return null;
}

async function downloadBankTransactions(): Promise<{ transactions: any[]; accounts: number } | null> {
  // Step 0: CDP 연결
  let cdpOk = false;
  try {
    const resp = await fetch(`http://localhost:${CDP_PORT}/json/version`);
    cdpOk = resp.ok;
  } catch { /* not available */ }
  if (!cdpOk) {
    logError(`CDP 포트 ${CDP_PORT} 미연결. Chrome을 --remote-debugging-port=${CDP_PORT} 로 실행하세요.`);
    return null;
  }

  // Step 1: IBK 페이지 찾기 또는 새로 열기
  let pageId = await findIBKPage();
  if (!pageId) {
    log('IBK 탭 없음 → 새 탭 생성...');
    try {
      const resp = await fetch(`http://localhost:${CDP_PORT}/json/new?https://kiup.ibk.co.kr/uib/jsp/index.jsp`, { method: 'PUT' });
      const tab = await resp.json() as { id: string };
      pageId = tab.id;
      await sleep(8000);
    } catch (e: any) {
      logError(`IBK 탭 생성 실패: ${e.message}`);
      return null;
    }
  }

  const cdp = new CDPClient();
  await cdp.connect(pageId);
  log(`CDP 연결: ${pageId}`);

  const W = 'window.frames[0]';

  // Step 2: 로그인 상태 확인
  const currentUrl = await cdp.ev(`(function(){ try { return ${W}.location.href; } catch(e) { return 'err:' + e.message; } })()`);
  log(`현재 URL: ${currentUrl}`);

  const isLoggedIn = typeof currentUrl === 'string' &&
    !currentUrl.includes('login') &&
    !currentUrl.includes('err:') &&
    !currentUrl.includes('guest') &&
    currentUrl.includes('online');

  if (!isLoggedIn) {
    // Step 3: 프로그래밍 방식 로그인
    log('로그인 필요 → 인증서 로그인 시작...');

    // 인증서 준비
    const certDir = findCertDir();
    const certPw = getCertPassword();
    log(`인증서 디렉토리: ${certDir}`);

    const { rsaPemPath, certPemPath, vidRandom } = decryptPrivateKey(certDir, certPw);
    log('인증서 복호화 + VID_RANDOM 추출 완료');

    // 로그인 페이지로 이동
    await cdp.ev(`${W}.location.href='/uib/jsp/guest/main/e_certi_one_login.jsp'`);
    await sleep(5000);

    // Nonce 가져오기
    const nonce = await cdp.ev(`(function(){
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/uib/sw/wizvera/delfino/svc/delfino_nonce.jsp', false);
      xhr.send();
      return xhr.responseText.trim();
    })()`);

    if (!nonce || typeof nonce !== 'string' || nonce.length < 10) {
      logError(`Nonce 가져오기 실패: ${nonce}`);
      cdp.close();
      return null;
    }
    log(`Nonce: ${nonce.substring(0, 20)}...`);

    // 서명
    const signPayload = 'cert-login&delfinoNonce=' + encodeURIComponent(nonce);
    const signedB64 = signData(signPayload, certPemPath, rsaPemPath);
    log(`서명 완료 (${signedB64.length} chars)`);

    // 로그인 폼 제출
    const loginResult = await cdp.ev(`(function(){
      var w = ${W};
      var d = w.document;
      var f = d.form1;

      d.cookie = '_CORP_CERT_LOGIN_YN=Y; path=/';
      f.certLoginType.value = 'C';

      w.createHiddenField(f, 'gb_signed_msg', '${signedB64}');
      w.createHiddenField(f, 'VID_RANDOM', '${vidRandom}');
      w.createHiddenField(f, 'certStore', 'LOCAL_DISK');
      w.createHiddenField(f, 'CERT_CHECK_TYPE_', '_CHECK_TYPE_LOGIN_');
      w.createHiddenField(f, 'log_signed_msg', '');
      w.createHiddenField(f, 'consentTtitle', '');
      w.createHiddenField(f, 'consent', '');
      w.createHiddenField(f, 'sign_tx_id', '');
      w.createHiddenField(f, 'cert_tx_id', '');
      w.createHiddenField(f, 'IBKC_LGN_YN', '');

      f.action = '/uib/jsp/login/ei_login_proc.jsp';
      f.target = '_self';
      w.createHiddenField(f, 'HTML_TOKEN_EXCEPT_URL', f.action);
      f.submit();
      return 'submitted';
    })()`);

    log(`로그인 제출: ${loginResult}`);
    await sleep(6000);

    // 로그인 확인
    const afterUrl = await cdp.ev(`(function(){ try { return ${W}.location.href; } catch(e) { return 'err:' + e.message; } })()`);
    log(`로그인 후 URL: ${afterUrl}`);

    if (typeof afterUrl === 'string' && afterUrl.includes('login')) {
      logError('로그인 실패');
      cdp.close();
      return null;
    }
    log('로그인 성공!');
  } else {
    log('이미 로그인된 상태');
  }

  // Step 4: 거래내역조회 페이지 이동
  log('거래내역조회 페이지 이동...');
  await cdp.ev(`${W}.location.href='/uib/jsp/online/inq/inq15/inq1510/CINQ151000_i.jsp'`);
  await sleep(5000);

  const txUrl = await cdp.ev(`(function(){ try { return ${W}.location.href; } catch(e) { return 'err:' + e.message; } })()`);
  if (!txUrl?.includes('CINQ151000')) {
    // 세션 만료 → 계좌 목록으로 먼저
    await cdp.ev(`${W}.location.href='/uib/jsp/online/inq/inq10/inq1010/EINQ101000_i.jsp'`);
    await sleep(4000);
  }

  // Step 5: 각 계좌별 거래내역 조회 (월별 + M→N 콤보로 전체 추출)
  const allTransactions: any[] = [];
  let processedAccounts = 0;

  // 월별 청크 생성: 최근 1개월
  const monthChunks: { from: string; to: string; label: string }[] = [];
  const today = new Date();
  const fmt = (dt: Date) => `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
  const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
  monthChunks.push({
    from: fmt(oneMonthAgo),
    to: fmt(today),
    label: `${oneMonthAgo.getFullYear()}-${String(oneMonthAgo.getMonth() + 1).padStart(2, '0')} ~ ${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
  });
  log(`조회 기간: 최근 1개월`);

  /** 테이블에서 거래 데이터 추출하는 JS */
  const EXTRACT_TX_JS = `(function(){
    try {
      var d = ${W}.document;
      var tables = d.querySelectorAll('table');
      var allTx = [];
      for(var t=0; t<tables.length; t++) {
        var rows = tables[t].querySelectorAll('tr');
        if(rows.length < 3) continue;
        var headers = rows[0].querySelectorAll('th, td');
        var headerText = '';
        for(var k=0; k<headers.length; k++) headerText += headers[k].innerText.trim();
        if(headerText.indexOf('거래일시') < 0 && headerText.indexOf('거래후') < 0) continue;
        for(var j=1; j<rows.length; j++) {
          var cells = rows[j].querySelectorAll('td');
          if(cells.length < 5) continue;
          var tx = {
            date: cells[1] ? cells[1].innerText.trim() : '',
            withdrawal: cells[2] ? cells[2].innerText.trim() : '',
            deposit: cells[3] ? cells[3].innerText.trim() : '',
            balance: cells[4] ? cells[4].innerText.trim() : '',
            description: cells[5] ? cells[5].innerText.trim() : '',
            counterpart_acct: cells[6] ? cells[6].innerText.trim() : '',
            counterpart_bank: cells[7] ? cells[7].innerText.trim() : '',
            counterpart_name: cells[13] ? cells[13].innerText.trim() : ''
          };
          if(tx.date && tx.date.match(/\\d{4}/)) allTx.push(tx);
        }
      }
      return JSON.stringify(allTx);
    } catch(e) { return JSON.stringify({error: e.message}); }
  })()`;

  for (const account of IBK_ACCOUNTS) {
    log(`\n계좌 조회: ${account.name} (${account.no})`);
    let accountTotal = 0;

    for (const chunk of monthChunks) {
      // 매 쿼리마다 거래내역 페이지 새로 이동 (상태 초기화)
      await cdp.ev(`${W}.location.href='/uib/jsp/online/inq/inq15/inq1510/CINQ151000_i.jsp'`);
      await sleep(3500);

      const fromY = chunk.from.substring(0, 4);
      const fromM = chunk.from.substring(4, 6);
      const fromD = chunk.from.substring(6, 8);
      const toY = chunk.to.substring(0, 4);
      const toM = chunk.to.substring(4, 6);
      const toD = chunk.to.substring(6, 8);

      // Step A: 계좌 선택 + uf_setDay 초기화 (셀렉트 옵션 생성)
      await cdp.ev(`(function(){
        var w = ${W}; var f = w.document.form1;
        f.gnrl_lf_acno.value = '${account.no}';
        w.setCounts(500);
        w.uf_setDay(90);
      })()`);
      await sleep(500);

      // Step B: 셀렉트 옵션 동적 추가 + 날짜 값 오버라이드 (별도 eval)
      await cdp.ev(`(function(){
        var d = ${W}.document; var f = d.form1;
        function ensureOpts(sel, vals) {
          var ex = {};
          for(var i=0; i<sel.options.length; i++) ex[sel.options[i].value] = true;
          for(var j=0; j<vals.length; j++) {
            if(!ex[vals[j]]) { var o = d.createElement('option'); o.value=vals[j]; o.text=vals[j]; sel.appendChild(o); }
          }
        }
        var ms=['01','02','03','04','05','06','07','08','09','10','11','12'];
        var ds=[]; for(var i=1;i<=31;i++) ds.push(i<10?'0'+i:''+i);
        ensureOpts(f.inqy_sttg_ymd_mm, ms); ensureOpts(f.inqy_sttg_ymd_dd, ds);
        ensureOpts(f.inqy_eymd_mm, ms); ensureOpts(f.inqy_eymd_dd, ds);
        f.inqy_sttg_ymd_yy.value='${fromY}'; f.inqy_sttg_ymd_mm.value='${fromM}'; f.inqy_sttg_ymd_dd.value='${fromD}';
        f.inqy_eymd_yy.value='${toY}'; f.inqy_eymd_mm.value='${toM}'; f.inqy_eymd_dd.value='${toD}';
      })()`);
      await sleep(300);

      // Step C: uf_submit('M') — 별도 eval로 실행 (셀렉트 값이 확실히 반영된 후)
      await cdp.ev(`${W}.uf_submit('M')`);
      await sleep(5000);

      // grid_cnt 확인
      const gridCnt = await cdp.ev(`(function(){
        var f = ${W}.document.form1;
        return f.grid_cnt ? parseInt(f.grid_cnt.value) || 0 : 0;
      })()`);

      if (typeof gridCnt === 'number' && gridCnt === 0) {
        log(`  [${chunk.label}] 0건`);
        continue;
      }

      // N 쿼리: 나머지 데이터 로드 (rebound 배치 가져오기)
      await cdp.ev(`${W}.uf_submit('N')`);
      await sleep(4000);

      // 거래 데이터 추출
      const txJson = await cdp.ev(EXTRACT_TX_JS);

      try {
        const txs = JSON.parse(txJson);
        if (Array.isArray(txs)) {
          for (const tx of txs) {
            tx.account_no = account.no;
            tx.account_name = account.name;
          }
          allTransactions.push(...txs);
          accountTotal += txs.length;
          log(`  [${chunk.label}] ${txs.length}건 (서버 ${gridCnt}건)`);

          if (typeof gridCnt === 'number' && gridCnt > txs.length + 2) {
            log(`  ⚠ 누락: 서버 ${gridCnt}건 > 추출 ${txs.length}건`);
          }
        } else {
          logError(`  [${chunk.label}] 파싱 에러: ${JSON.stringify(txs).substring(0, 100)}`);
        }
      } catch {
        logError(`  [${chunk.label}] JSON 파싱 실패: ${txJson?.substring(0, 100)}`);
      }
    } // end monthChunks loop

    log(`  → 합계: ${accountTotal}건`);
    if (accountTotal > 0) processedAccounts++;
  }

  cdp.close();

  log(`\n총 ${allTransactions.length}건 (${processedAccounts}개 계좌)`);

  // 임시 파일 정리
  for (const f of ['/tmp/sign_data.txt', '/tmp/signed.der', '/tmp/enc_data.bin', '/tmp/dec_pad.bin', '/tmp/dec_raw.bin']) {
    try { fs.unlinkSync(f); } catch { /* ok */ }
  }
  // 개인키 파일은 마지막에 삭제
  try { fs.unlinkSync('/tmp/ibk_rsa.pem'); } catch { /* ok */ }

  return { transactions: allTransactions, accounts: processedAccounts };
}

// ═══════════════════════════════════════════════════════════════
// 데이터 변환 + EF 업로드
// ═══════════════════════════════════════════════════════════════

function parseAmount(s: string): number {
  if (!s || s === '0') return 0;
  return parseInt(s.replace(/[,\s]/g, ''), 10) || 0;
}

function parseDate(s: string): string | null {
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function transformTransactions(rawTxs: any[]): any[] {
  const transformed: any[] = [];
  for (const tx of rawTxs) {
    const date = parseDate(tx.date || '');
    if (!date) continue;

    const withdrawal = parseAmount(tx.withdrawal || '');
    const deposit = parseAmount(tx.deposit || '');
    const balance = parseAmount(tx.balance || '');

    let amount: number, type: string;
    if (withdrawal > 0) { amount = withdrawal; type = 'expense'; }
    else if (deposit > 0) { amount = deposit; type = 'income'; }
    else continue;

    const counterparty = tx.description || tx.counterpart_name || '';

    transformed.push({
      transaction_date: date,
      amount,
      balance_after: balance || null,
      type,
      counterparty: counterparty.substring(0, 100) || null,
      description: `[${tx.account_name || ''}]`,
      memo: null,
      raw_data: {
        account_no: tx.account_no || '',
        account_name: tx.account_name || '',
        date_full: tx.date || '',
        counterpart_acct: tx.counterpart_acct || '',
        counterpart_bank: tx.counterpart_bank || '',
        counterpart_name: tx.counterpart_name || '',
        source: 'ibk_auto',
      },
      source: 'local-agent',
    });
  }
  return transformed;
}

async function uploadToEF(transactions: any[]): Promise<boolean> {
  const EF_URL = `${SUPABASE_URL}/functions/v1/receive-bank-transactions`;
  const BATCH_SIZE = 50;
  let totalSuccess = 0;

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    const payload = JSON.stringify({ transactions: batch, source: 'local-agent' });

    try {
      const resp = await fetch(EF_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'x-api-key': COMPANY_ID,
        },
        body: payload,
      });

      if (resp.ok) {
        const result = await resp.json();
        log(`  배치 ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length}건 → ${JSON.stringify(result).substring(0, 100)}`);
        totalSuccess += batch.length;
      } else {
        const errText = await resp.text();
        logError(`  배치 ${Math.floor(i / BATCH_SIZE) + 1}: HTTP ${resp.status} → ${errText.substring(0, 200)}`);
      }
    } catch (e: any) {
      logError(`  배치 ${Math.floor(i / BATCH_SIZE) + 1}: ${e.message}`);
    }
  }

  log(`업로드 완료: ${totalSuccess}/${transactions.length}건`);
  return totalSuccess === transactions.length;
}

async function recordRun(status: 'completed' | 'failed', summary: Record<string, any>) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/automation_runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        company_id: COMPANY_ID, trigger: 'local_agent', run_type: 'bank_download', status, summary,
      }),
    });
    log(`automation_runs: ${status}`);
  } catch (err: any) { logError(`automation_runs 실패: ${err.message}`); }
}

// ═══════════════════════════════════════════════════════════════
// 로컬 JSON 저장 (백업)
// ═══════════════════════════════════════════════════════════════

function saveLocalBackup(transactions: any[]): string {
  const dir = path.join(os.homedir(), 'Downloads', 'leanos-bank');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `ibk_tx_${new Date().toISOString().split('T')[0]}.json`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(transactions, null, 2), 'utf-8');
  return filePath;
}

// ═══════════════════════════════════════════════════════════════
// 홈택스 세금계산서 다운로드
// ═══════════════════════════════════════════════════════════════

function getHometaxPassword(): string {
  const pw = sh('security find-generic-password -s "leanos-hometax" -a "cert" -w');
  if (!pw) throw new Error('홈택스 비밀번호 미등록.\n→ 오너뷰 설정 > 인증서 탭에서 등록하거나\n→ bash scripts/setup-keychain.sh 를 실행하세요.');
  return pw;
}

async function getHometaxPasswordAsync(): Promise<string> {
  const dbCred = await getCredential('hometax');
  if (dbCred?.cert_password) return dbCred.cert_password;
  return getHometaxPassword();
}

async function findHometaxPage(): Promise<string | null> {
  try {
    const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
    const tabs = await resp.json() as { id: string; url: string }[];
    for (const t of tabs) {
      if (t.url?.includes('hometax.go.kr')) return t.id;
    }
  } catch { /* not available */ }
  return null;
}

async function downloadHometaxInvoices(): Promise<{ invoices: any[]; type: string } | null> {
  let cdpOk = false;
  try {
    const resp = await fetch(`http://localhost:${CDP_PORT}/json/version`);
    cdpOk = resp.ok;
  } catch { /* */ }
  if (!cdpOk) {
    logError(`CDP 포트 ${CDP_PORT} 미연결.`);
    return null;
  }

  // 홈택스 탭 찾기/생성
  let pageId = await findHometaxPage();
  if (!pageId) {
    log('홈택스 탭 없음 → 새 탭 생성...');
    try {
      const resp = await fetch(`http://localhost:${CDP_PORT}/json/new?https://www.hometax.go.kr`, { method: 'PUT' });
      const tab = await resp.json() as { id: string };
      pageId = tab.id;
      await sleep(8000);
    } catch (e: any) {
      logError(`홈택스 탭 생성 실패: ${e.message}`);
      return null;
    }
  }

  const cdp = new CDPClient();
  await cdp.connect(pageId);
  log(`CDP 연결: ${pageId}`);

  // 로그인 상태 확인
  const currentUrl = await cdp.ev(`window.location.href`);
  log(`현재 URL: ${currentUrl}`);

  const isLoggedIn = typeof currentUrl === 'string' && currentUrl.includes('main');

  if (!isLoggedIn) {
    log('홈택스 공인인증서 로그인 시작...');

    // 공인인증서 로그인 페이지로 이동
    await cdp.ev(`window.location.href='https://www.hometax.go.kr/websquare/websquare.wq?w2xPath=/ui/pp/index_pp.xml'`);
    await sleep(5000);

    // 인증서 로그인 버튼 클릭 (공동인증서/금융인증서 탭)
    await cdp.ev(`(function(){
      // 공동인증서 로그인 버튼 찾기
      var btns = document.querySelectorAll('a, button, span');
      for(var i=0; i<btns.length; i++){
        var txt = btns[i].innerText || btns[i].textContent || '';
        if(txt.indexOf('공동인증서') >= 0 || txt.indexOf('인증서') >= 0){
          btns[i].click();
          return 'clicked: ' + txt.trim();
        }
      }
      return 'not_found';
    })()`);
    await sleep(3000);

    // 인증서 준비 (IBK와 동일 인증서 사용)
    const certDir = findCertDir();
    const certPw = getHometaxPassword();
    const { rsaPemPath, certPemPath, vidRandom } = decryptPrivateKey(certDir, certPw);
    log('인증서 복호화 완료');

    // 홈택스 인증 요청 데이터 (SOAP/XML 기반)
    // 홈택스는 NTS SignKorea 플러그인을 통해 인증서 서명을 수행
    // CDP에서는 플러그인 대신 직접 서명 생성 후 주입

    // Step 1: 인증 nonce 요청
    const authResult = await cdp.ev(`(function(){
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/wqAction.do', false);
        xhr.setRequestHeader('Content-Type', 'application/xml; charset=UTF-8');
        xhr.send('<map id="postParam"><popupYn>false</popupYn><realScreenId>index_pp</realScreenId></map>');
        return xhr.status + ':' + xhr.responseText.substring(0, 200);
      } catch(e) { return 'err:' + e.message; }
    })()`);
    log(`홈택스 인증 요청: ${authResult?.substring(0, 100)}`);

    // 홈택스 인증서 로그인은 SignKorea ActiveX/플러그인 의존성이 높음
    // CDP로 직접 인증서 서명 주입이 어려운 경우 → 수동 로그인 대기
    log('');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('  홈택스는 브라우저에서 수동 로그인이 필요합니다');
    log('  Chrome에서 홈택스에 공인인증서로 로그인한 후');
    log('  다시 이 명령을 실행하세요.');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('');
    log('로그인 확인 대기 중... (30초)');

    // 30초간 로그인 대기
    for (let i = 0; i < 6; i++) {
      await sleep(5000);
      const url = await cdp.ev(`window.location.href`);
      if (typeof url === 'string' && (url.includes('main') || url.includes('index'))) {
        log('로그인 감지!');
        break;
      }
      log(`  대기 중... (${(i + 1) * 5}초)`);
    }

    // 임시 파일 정리
    try { fs.unlinkSync(rsaPemPath); } catch { /* ok */ }
    try { fs.unlinkSync(certPemPath); } catch { /* ok */ }
  }

  // 세금계산서 조회 페이지 이동 (매출)
  log('매출 세금계산서 조회...');
  await cdp.ev(`window.location.href='https://www.hometax.go.kr/websquare/websquare.wq?w2xPath=/ui/ab/a/a/UTXPPABA001.xml'`);
  await sleep(5000);

  // 기간 설정 (최근 1개월)
  const today = new Date();
  const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
  const fromDate = `${oneMonthAgo.getFullYear()}${String(oneMonthAgo.getMonth() + 1).padStart(2, '0')}${String(oneMonthAgo.getDate()).padStart(2, '0')}`;
  const toDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  // 조회 기간 입력 + 조회 버튼 클릭
  await cdp.ev(`(function(){
    try {
      // 날짜 입력 필드 찾기
      var inputs = document.querySelectorAll('input[type="text"], input[type="date"]');
      var dateInputs = [];
      for(var i=0; i<inputs.length; i++){
        var v = inputs[i].value || '';
        if(v.match(/\\d{4}[-.]?\\d{2}[-.]?\\d{2}/)) dateInputs.push(inputs[i]);
      }
      if(dateInputs.length >= 2){
        dateInputs[0].value = '${fromDate.substring(0,4)}-${fromDate.substring(4,6)}-${fromDate.substring(6,8)}';
        dateInputs[0].dispatchEvent(new Event('change', {bubbles:true}));
        dateInputs[1].value = '${toDate.substring(0,4)}-${toDate.substring(4,6)}-${toDate.substring(6,8)}';
        dateInputs[1].dispatchEvent(new Event('change', {bubbles:true}));
      }
      // 조회 버튼 클릭
      var btns = document.querySelectorAll('a, button');
      for(var j=0; j<btns.length; j++){
        var txt = btns[j].innerText || '';
        if(txt.trim() === '조회하기' || txt.trim() === '조회'){
          btns[j].click();
          return 'queried';
        }
      }
      return 'no_button';
    } catch(e) { return 'err:' + e.message; }
  })()`);
  await sleep(5000);

  // 테이블에서 세금계산서 데이터 추출
  const invoiceJson = await cdp.ev(`(function(){
    try {
      var rows = document.querySelectorAll('table tbody tr, .w2grid .w2grid-row');
      var invoices = [];
      for(var i=0; i<rows.length; i++){
        var cells = rows[i].querySelectorAll('td, .w2grid-cell');
        if(cells.length < 5) continue;
        var cellTexts = [];
        for(var j=0; j<cells.length; j++) cellTexts.push(cells[j].innerText.trim());
        // 일반적인 홈택스 세금계산서 컬럼: 작성일자, 공급자사업자번호, 공급자상호, 공급가액, 세액, 합계
        invoices.push({
          date: cellTexts[0] || '',
          supplier_biz_no: cellTexts[1] || '',
          supplier_name: cellTexts[2] || '',
          supply_amount: cellTexts[3] || '',
          tax_amount: cellTexts[4] || '',
          total_amount: cellTexts[5] || '',
          raw: cellTexts.join('|')
        });
      }
      return JSON.stringify(invoices);
    } catch(e) { return JSON.stringify({error: e.message}); }
  })()`);

  let invoices: any[] = [];
  try {
    const parsed = JSON.parse(invoiceJson);
    if (Array.isArray(parsed)) {
      invoices = parsed.filter((inv: any) => inv.date && inv.date.match(/\d{4}/));
      log(`매출 세금계산서: ${invoices.length}건 추출`);
    }
  } catch {
    logError(`세금계산서 파싱 실패: ${invoiceJson?.substring(0, 100)}`);
  }

  cdp.close();
  return { invoices, type: 'sales' };
}

function transformHometaxInvoices(rawInvoices: any[], invoiceType: string): any[] {
  return rawInvoices.map(inv => ({
    issue_date: parseDate(inv.date) || inv.date,
    supplier_biz_no: inv.supplier_biz_no?.replace(/[^0-9]/g, '') || null,
    supplier_name: inv.supplier_name || null,
    supply_amount: parseAmount(inv.supply_amount || '0'),
    tax_amount: parseAmount(inv.tax_amount || '0'),
    total_amount: parseAmount(inv.total_amount || '0'),
    invoice_type: invoiceType,
    source: 'hometax_auto',
    raw_data: inv,
  }));
}

async function uploadHometaxInvoices(invoices: any[]): Promise<boolean> {
  const BATCH_SIZE = 50;
  let totalSuccess = 0;

  for (let i = 0; i < invoices.length; i += BATCH_SIZE) {
    const batch = invoices.slice(i, i + BATCH_SIZE);
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/tax_invoices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(batch.map(inv => ({
          company_id: COMPANY_ID,
          issue_date: inv.issue_date,
          counterparty: inv.supplier_name,
          supply_amount: inv.supply_amount,
          tax_amount: inv.tax_amount,
          total_amount: inv.total_amount,
          type: inv.invoice_type === 'sales' ? 'issued' : 'received',
          status: 'received',
          description: `[홈택스 자동] ${inv.supplier_biz_no || ''}`,
          raw_data: inv.raw_data,
        }))),
      });
      if (resp.ok) {
        totalSuccess += batch.length;
        log(`  세금계산서 배치 ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length}건 OK`);
      } else {
        logError(`  세금계산서 배치 실패: HTTP ${resp.status}`);
      }
    } catch (e: any) {
      logError(`  세금계산서 배치 오류: ${e.message}`);
    }
  }

  log(`세금계산서 업로드: ${totalSuccess}/${invoices.length}건`);
  return totalSuccess === invoices.length;
}

// ═══════════════════════════════════════════════════════════════
// 롯데카드 법인카드 거래내역 다운로드
// ═══════════════════════════════════════════════════════════════

function getLotteCardCredentials(): { id: string; pw: string } {
  const pw = sh('security find-generic-password -s "leanos-lottecard" -a "chae8512" -w');
  if (!pw) throw new Error('롯데카드 인증정보 미등록.\n→ 오너뷰 설정 > 인증서 탭에서 등록하거나\n→ bash scripts/setup-keychain.sh 를 실행하세요.');
  return { id: 'chae8512', pw };
}

async function getLotteCardCredentialsAsync(): Promise<{ id: string; pw: string }> {
  const dbCred = await getCredential('lottecard');
  if (dbCred?.login_id && dbCred?.login_password) {
    return { id: dbCred.login_id, pw: dbCred.login_password };
  }
  return getLotteCardCredentials();
}

async function findLotteCardPage(): Promise<string | null> {
  try {
    const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
    const tabs = await resp.json() as { id: string; url: string }[];
    for (const t of tabs) {
      if (t.url?.includes('lottecard.co.kr')) return t.id;
    }
  } catch { /* not available */ }
  return null;
}

async function downloadLotteCardTransactions(): Promise<{ transactions: any[] } | null> {
  let cdpOk = false;
  try {
    const resp = await fetch(`http://localhost:${CDP_PORT}/json/version`);
    cdpOk = resp.ok;
  } catch { /* */ }
  if (!cdpOk) {
    logError(`CDP 포트 ${CDP_PORT} 미연결.`);
    return null;
  }

  // 롯데카드 탭 찾기/생성
  let pageId = await findLotteCardPage();
  if (!pageId) {
    log('롯데카드 탭 없음 → 새 탭 생성...');
    try {
      const resp = await fetch(`http://localhost:${CDP_PORT}/json/new?https://www.lottecard.co.kr/app/LPCOAA00_T100.lc`, { method: 'PUT' });
      const tab = await resp.json() as { id: string };
      pageId = tab.id;
      await sleep(8000);
    } catch (e: any) {
      logError(`롯데카드 탭 생성 실패: ${e.message}`);
      return null;
    }
  }

  const cdp = new CDPClient();
  await cdp.connect(pageId);
  log(`CDP 연결: ${pageId}`);

  // 로그인 상태 확인
  const currentUrl = await cdp.ev(`window.location.href`);
  log(`현재 URL: ${currentUrl}`);

  const isLoggedIn = typeof currentUrl === 'string' &&
    !currentUrl.includes('login') && !currentUrl.includes('LOGIN') &&
    !currentUrl.includes('LPCOAA00');

  if (!isLoggedIn) {
    log('롯데카드 ID/PW 로그인...');
    const creds = getLotteCardCredentials();

    // 로그인 페이지 이동
    await cdp.ev(`window.location.href='https://www.lottecard.co.kr/app/LPCOAA00_T100.lc'`);
    await sleep(5000);

    // ID/PW 입력 + 로그인
    const loginResult = await cdp.ev(`(function(){
      try {
        // ID 필드 찾기
        var idField = document.querySelector('input[name="userId"], input[id="userId"], input[name="id"], input[placeholder*="아이디"]');
        var pwField = document.querySelector('input[name="userPwd"], input[id="userPwd"], input[name="password"], input[type="password"]');

        if(!idField || !pwField) {
          // 폼 필드 탐색
          var inputs = document.querySelectorAll('input[type="text"], input[type="email"]');
          var pwInputs = document.querySelectorAll('input[type="password"]');
          if(inputs.length > 0) idField = inputs[0];
          if(pwInputs.length > 0) pwField = pwInputs[0];
        }

        if(!idField || !pwField) return 'fields_not_found';

        // React/Vue 호환 값 설정
        var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(idField, '${creds.id}');
        idField.dispatchEvent(new Event('input', {bubbles:true}));
        idField.dispatchEvent(new Event('change', {bubbles:true}));

        nativeInputValueSetter.call(pwField, '${creds.pw}');
        pwField.dispatchEvent(new Event('input', {bubbles:true}));
        pwField.dispatchEvent(new Event('change', {bubbles:true}));

        // 로그인 버튼 클릭
        var btns = document.querySelectorAll('a, button, input[type="submit"]');
        for(var i=0; i<btns.length; i++){
          var txt = (btns[i].innerText || btns[i].value || '').trim();
          if(txt === '로그인' || txt === 'LOGIN' || txt === '로그인하기'){
            btns[i].click();
            return 'submitted';
          }
        }
        // form submit fallback
        var forms = document.querySelectorAll('form');
        if(forms.length > 0) { forms[0].submit(); return 'form_submitted'; }
        return 'no_login_btn';
      } catch(e) { return 'err:' + e.message; }
    })()`);

    log(`롯데카드 로그인: ${loginResult}`);
    await sleep(8000);

    // 로그인 결과 확인
    const afterUrl = await cdp.ev(`window.location.href`);
    log(`로그인 후 URL: ${afterUrl}`);
    if (typeof afterUrl === 'string' && (afterUrl.includes('LOGIN') || afterUrl.includes('LPCOAA00'))) {
      logError('롯데카드 로그인 실패');
      cdp.close();
      return null;
    }
    log('롯데카드 로그인 성공!');
  }

  // 법인카드 이용내역 조회 페이지 이동
  log('법인카드 이용내역 조회...');
  await cdp.ev(`window.location.href='https://www.lottecard.co.kr/app/LPCOBP60_T100.lc'`);
  await sleep(5000);

  // 기간 설정 (최근 1개월) + 조회
  const today = new Date();
  const fromDt = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
  const fromStr = `${fromDt.getFullYear()}${String(fromDt.getMonth() + 1).padStart(2, '0')}${String(fromDt.getDate()).padStart(2, '0')}`;
  const toStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  await cdp.ev(`(function(){
    try {
      var inputs = document.querySelectorAll('input[type="text"], input[type="date"]');
      var dateInputs = [];
      for(var i=0; i<inputs.length; i++){
        var id = inputs[i].id || inputs[i].name || '';
        if(id.match(/date|dt|ymd|from|to|start|end/i) || inputs[i].value.match(/\\d{4}/)){
          dateInputs.push(inputs[i]);
        }
      }
      if(dateInputs.length >= 2){
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(dateInputs[0], '${fromStr}');
        dateInputs[0].dispatchEvent(new Event('change', {bubbles:true}));
        nativeSetter.call(dateInputs[1], '${toStr}');
        dateInputs[1].dispatchEvent(new Event('change', {bubbles:true}));
      }
      // 조회 버튼
      var btns = document.querySelectorAll('a, button');
      for(var j=0; j<btns.length; j++){
        var txt = (btns[j].innerText || '').trim();
        if(txt === '조회' || txt === '조회하기' || txt === '검색'){
          btns[j].click();
          return 'queried';
        }
      }
      return 'no_query_btn';
    } catch(e) { return 'err:' + e.message; }
  })()`);
  await sleep(5000);

  // 카드 거래내역 추출
  const cardJson = await cdp.ev(`(function(){
    try {
      var rows = document.querySelectorAll('table tbody tr, .list-area li, .card-list li');
      var txs = [];
      for(var i=0; i<rows.length; i++){
        var cells = rows[i].querySelectorAll('td, span, div.item');
        if(cells.length < 3) continue;
        var cellTexts = [];
        for(var j=0; j<cells.length; j++) cellTexts.push(cells[j].innerText.trim());
        // 롯데카드 컬럼: 이용일, 가맹점명, 이용금액, 할부, 승인상태
        txs.push({
          date: cellTexts[0] || '',
          merchant: cellTexts[1] || '',
          amount: cellTexts[2] || '',
          installment: cellTexts[3] || '',
          status: cellTexts[4] || '',
          raw: cellTexts.join('|')
        });
      }
      return JSON.stringify(txs);
    } catch(e) { return JSON.stringify({error: e.message}); }
  })()`);

  let transactions: any[] = [];
  try {
    const parsed = JSON.parse(cardJson);
    if (Array.isArray(parsed)) {
      transactions = parsed.filter((tx: any) => tx.date && tx.date.match(/\d{4}/));
      log(`법인카드 거래내역: ${transactions.length}건 추출`);
    }
  } catch {
    logError(`카드 거래내역 파싱 실패: ${cardJson?.substring(0, 100)}`);
  }

  cdp.close();
  return { transactions };
}

function transformCardTransactions(rawTxs: any[]): any[] {
  return rawTxs.map(tx => ({
    transaction_date: parseDate(tx.date) || tx.date,
    merchant_name: tx.merchant || null,
    amount: parseAmount(tx.amount || '0'),
    installment: tx.installment || '일시불',
    status: tx.status || 'approved',
    card_company: 'lottecard',
    card_type: 'credit',
    source: 'lottecard_auto',
    raw_data: tx,
  }));
}

async function uploadCardTransactions(transactions: any[]): Promise<boolean> {
  const BATCH_SIZE = 50;
  let totalSuccess = 0;

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/card_transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(batch.map(tx => ({
          company_id: COMPANY_ID,
          transaction_date: tx.transaction_date,
          merchant_name: tx.merchant_name,
          amount: tx.amount,
          installment: tx.installment,
          card_company: tx.card_company,
          card_type: tx.card_type,
          status: 'pending',
          description: `[롯데카드 자동]`,
          raw_data: tx.raw_data,
        }))),
      });
      if (resp.ok) {
        totalSuccess += batch.length;
        log(`  카드 배치 ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length}건 OK`);
      } else {
        logError(`  카드 배치 실패: HTTP ${resp.status}`);
      }
    } catch (e: any) {
      logError(`  카드 배치 오류: ${e.message}`);
    }
  }

  log(`카드 거래 업로드: ${totalSuccess}/${transactions.length}건`);
  return totalSuccess === transactions.length;
}

// ═══════════════════════════════════════════════════════════════
// 환경 점검
// ═══════════════════════════════════════════════════════════════

async function preflight(): Promise<boolean> {
  console.log('');
  console.log('='.repeat(60));
  console.log('  LeanOS Local Agent — 환경 점검');
  console.log(`  ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`  OS: ${os.platform()} ${os.release()}`);
  console.log('  지원: IBK은행 / 홈택스 / 롯데카드');
  console.log('='.repeat(60));
  console.log('');

  let allOk = true;

  // 1. 인증서
  try { const d = findCertDir(); log(`[OK] 공동인증서: ${d}`); }
  catch (e: any) { logError(`[FAIL] ${e.message}`); allOk = false; }

  // 2. 인증정보 — IBK (Supabase 우선, Keychain 폴백)
  try { const pw = await getCertPasswordAsync(); log(`[OK] IBK 인증서 비밀번호 (${_credCache['ibk'] ? 'DB' : 'Keychain'})`); }
  catch (e: any) { logError(`[FAIL] IBK: ${e.message}`); allOk = false; }

  // 2b. 인증정보 — 홈택스
  try { const pw = await getHometaxPasswordAsync(); log(`[OK] 홈택스 비밀번호 (${_credCache['hometax'] ? 'DB' : 'Keychain'})`); }
  catch (e: any) { logError(`[FAIL] 홈택스: ${e.message}`); allOk = false; }

  // 2c. 인증정보 — 롯데카드
  try { const cred = await getLotteCardCredentialsAsync(); log(`[OK] 롯데카드: ${cred.id} (${_credCache['lottecard'] ? 'DB' : 'Keychain'})`); }
  catch (e: any) { logError(`[FAIL] 롯데카드: ${e.message}`); allOk = false; }

  // 3. OpenSSL
  const opensslVer = sh(`${OPENSSL_BIN} version 2>&1`);
  if (opensslVer.includes('OpenSSL')) log(`[OK] OpenSSL: ${opensslVer}`);
  else { logError(`[FAIL] OpenSSL 미설치: brew install openssl`); allOk = false; }

  // 4. Supabase
  if (SUPABASE_ANON_KEY) log('[OK] Supabase ANON KEY');
  else { logError('[FAIL] SUPABASE_ANON_KEY 미설정'); allOk = false; }

  // 5. CDP
  try {
    const r = await fetch(`http://localhost:${CDP_PORT}/json/version`);
    if (r.ok) log(`[OK] CDP 포트 ${CDP_PORT}`);
    else { logError(`[FAIL] CDP ${CDP_PORT} 응답 없음`); allOk = false; }
  } catch { logError(`[FAIL] CDP ${CDP_PORT} 연결 불가`); allOk = false; }

  console.log('');
  if (allOk) log('환경 점검 통과 ✓');
  else logError('환경 점검 실패 — 위 항목을 확인하세요');
  console.log('');

  return allOk;
}

// ═══════════════════════════════════════════════════════════════
// 메인
// ═══════════════════════════════════════════════════════════════

async function main() {
  const command = process.argv[2];

  if (!command || command === 'check') {
    await preflight();
    return;
  }

  if (command === 'bank') {
    const ok = await preflight();
    if (!ok) {
      await recordRun('failed', { error: 'preflight_failed' });
      process.exit(1);
    }

    log('IBK 거래내역 다운로드 시작...');
    const result = await downloadBankTransactions();

    if (result && result.transactions.length > 0) {
      const backupPath = saveLocalBackup(result.transactions);
      log(`로컬 백업: ${backupPath}`);

      const transformed = transformTransactions(result.transactions);
      log(`변환: ${transformed.length}건 (${result.accounts}개 계좌)`);

      log('EF 업로드 시작...');
      const uploaded = await uploadToEF(transformed);

      if (uploaded) {
        await recordRun('completed', {
          total_transactions: transformed.length,
          accounts: result.accounts,
          backup: backupPath,
        });
        log('전체 파이프라인 완료!');
      } else {
        await recordRun('failed', { step: 'ef_upload', total: transformed.length });
        logError('EF 업로드 실패 — Import Hub에서 수동 업로드하세요');
      }
    } else {
      await recordRun('failed', { step: 'browser_download' });
      logError('거래내역 추출 실패');
    }
    return;
  }

  if (command === 'hometax') {
    const ok = await preflight();
    if (!ok) { process.exit(1); }

    log('홈택스 세금계산서 다운로드 시작...');
    const result = await downloadHometaxInvoices();

    if (result && result.invoices.length > 0) {
      const transformed = transformHometaxInvoices(result.invoices, result.type);
      log(`변환: ${transformed.length}건 (${result.type})`);

      const uploaded = await uploadHometaxInvoices(transformed);
      if (uploaded) {
        await recordRun('completed', { service: 'hometax', total: transformed.length, type: result.type });
        log('홈택스 파이프라인 완료!');
      } else {
        await recordRun('failed', { service: 'hometax', step: 'upload' });
        logError('홈택스 업로드 실패');
      }
    } else {
      logError('세금계산서 추출 실패 — 홈택스에 먼저 로그인 후 재시도하세요');
    }
    return;
  }

  if (command === 'card') {
    const ok = await preflight();
    if (!ok) { process.exit(1); }

    log('롯데카드 거래내역 다운로드 시작...');
    const result = await downloadLotteCardTransactions();

    if (result && result.transactions.length > 0) {
      const transformed = transformCardTransactions(result.transactions);
      log(`변환: ${transformed.length}건`);

      const uploaded = await uploadCardTransactions(transformed);
      if (uploaded) {
        await recordRun('completed', { service: 'lottecard', total: transformed.length });
        log('롯데카드 파이프라인 완료!');
      } else {
        await recordRun('failed', { service: 'lottecard', step: 'upload' });
        logError('롯데카드 업로드 실패');
      }
    } else {
      logError('카드 거래내역 추출 실패');
    }
    return;
  }

  if (command === 'all') {
    await runAll();
    return;
  }

  if (command === 'watch') {
    await watchSyncJobs();
    return;
  }

  console.log('사용법:');
  console.log('  npx tsx scripts/local-agent.ts check    — 환경 점검');
  console.log('  npx tsx scripts/local-agent.ts bank     — IBK 거래내역 다운로드');
  console.log('  npx tsx scripts/local-agent.ts hometax  — 홈택스 세금계산서 다운로드');
  console.log('  npx tsx scripts/local-agent.ts card     — 롯데카드 거래내역 다운로드');
  console.log('  npx tsx scripts/local-agent.ts all      — 전체 (은행+홈택스+카드)');
  console.log('  npx tsx scripts/local-agent.ts watch    — 대기 모드 (대시보드 동기화 버튼 감지)');
}

// ═══════════════════════════════════════════════════════════════
// 전체 실행 (bank + hometax + card)
// ═══════════════════════════════════════════════════════════════

async function runAll(): Promise<{ bank: number; hometax: number; card: number }> {
  const ok = await preflight();
  if (!ok) { process.exit(1); }

  const result = { bank: 0, hometax: 0, card: 0 };
  log('═══ 전체 자동화 시작 ═══');

  // 1. IBK 은행
  log('\n[1/3] IBK 은행...');
  const bankResult = await downloadBankTransactions();
  if (bankResult && bankResult.transactions.length > 0) {
    const backupPath = saveLocalBackup(bankResult.transactions);
    const transformed = transformTransactions(bankResult.transactions);
    await uploadToEF(transformed);
    result.bank = transformed.length;
    log(`  IBK: ${transformed.length}건 완료`);
  } else { logError('  IBK: 추출 실패'); }

  // 2. 홈택스
  log('\n[2/3] 홈택스...');
  const htResult = await downloadHometaxInvoices();
  if (htResult && htResult.invoices.length > 0) {
    const transformed = transformHometaxInvoices(htResult.invoices, htResult.type);
    await uploadHometaxInvoices(transformed);
    result.hometax = transformed.length;
    log(`  홈택스: ${transformed.length}건 완료`);
  } else { logError('  홈택스: 추출 실패'); }

  // 3. 롯데카드
  log('\n[3/3] 롯데카드...');
  const cardResult = await downloadLotteCardTransactions();
  if (cardResult && cardResult.transactions.length > 0) {
    const transformed = transformCardTransactions(cardResult.transactions);
    await uploadCardTransactions(transformed);
    result.card = transformed.length;
    log(`  롯데카드: ${transformed.length}건 완료`);
  } else { logError('  롯데카드: 추출 실패'); }

  log('\n═══ 전체 자동화 종료 ═══');
  return result;
}

// ═══════════════════════════════════════════════════════════════
// Watch 모드 — sync_jobs 테이블 폴링
// 대시보드 "데이터 동기화" 버튼 클릭 → pending 잡 생성 → 여기서 감지 → 실행
// ═══════════════════════════════════════════════════════════════

const WATCH_INTERVAL_MS = 10_000; // 10초마다 폴링

async function watchSyncJobs() {
  log('═══ Watch 모드 시작 — sync_jobs 폴링 중 ═══');
  log(`  회사: ${COMPANY_ID}`);
  log(`  폴링 간격: ${WATCH_INTERVAL_MS / 1000}초`);
  log('  종료: Ctrl+C\n');

  // 초기 환경 점검 (경고만, 종료하지 않음 — 실제 수집 시 개별 실패 처리)
  const ok = await preflight();
  if (!ok) {
    log('⚠ 환경 점검 일부 실패 — 수집 시 해당 서비스는 건너뜁니다.');
    log('  설정 > 인증서 탭에서 등록하면 정상 동작합니다.\n');
  }

  while (true) {
    try {
      // 1. pending 상태의 sync_jobs 조회
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/sync_jobs?company_id=eq.${COMPANY_ID}&status=eq.pending&order=created_at.asc&limit=1`,
        {
          headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey': SUPABASE_ANON_KEY,
          },
        }
      );

      if (!res.ok) {
        logError(`sync_jobs 조회 실패: ${res.status}`);
        await sleep(WATCH_INTERVAL_MS);
        continue;
      }

      const jobs = await res.json();

      if (jobs.length === 0) {
        // 대기 중 — 조용히 폴링
        await sleep(WATCH_INTERVAL_MS);
        continue;
      }

      const job = jobs[0];
      log(`\n★ 동기화 요청 감지! (job: ${job.id})`);
      log(`  targets: ${JSON.stringify(job.targets)}`);
      log(`  요청 시각: ${job.created_at}`);

      // 2. 상태 → in_progress
      await updateSyncJob(job.id, 'in_progress');

      // 3. 타겟에 따라 선택적 실행
      const targets: string[] = job.targets || ['bank', 'hometax', 'card'];
      const summary: Record<string, any> = {};

      if (targets.includes('bank')) {
        log('\n[수집] IBK 은행...');
        try {
          const bankResult = await downloadBankTransactions();
          if (bankResult && bankResult.transactions.length > 0) {
            saveLocalBackup(bankResult.transactions);
            const transformed = transformTransactions(bankResult.transactions);
            await uploadToEF(transformed);
            summary.bank = transformed.length;
            log(`  은행: ${transformed.length}건 완료`);
          } else {
            summary.bank = 0;
            log('  은행: 0건 (데이터 없음 또는 인증 미설정)');
          }
        } catch (e: any) { summary.bank = -1; logError(`  은행 오류: ${e.message}`); }
      }

      if (targets.includes('hometax')) {
        log('\n[수집] 홈택스...');
        try {
          const htResult = await downloadHometaxInvoices();
          if (htResult && htResult.invoices.length > 0) {
            const transformed = transformHometaxInvoices(htResult.invoices, htResult.type);
            await uploadHometaxInvoices(transformed);
            summary.hometax = transformed.length;
            log(`  홈택스: ${transformed.length}건 완료`);
          } else {
            summary.hometax = 0;
            log('  홈택스: 0건 (데이터 없음 또는 인증 미설정)');
          }
        } catch (e: any) { summary.hometax = -1; logError(`  홈택스 오류: ${e.message}`); }
      }

      if (targets.includes('card')) {
        log('\n[수집] 롯데카드...');
        try {
          const cardResult = await downloadLotteCardTransactions();
          if (cardResult && cardResult.transactions.length > 0) {
            const transformed = transformCardTransactions(cardResult.transactions);
            await uploadCardTransactions(transformed);
            summary.card = transformed.length;
            log(`  카드: ${transformed.length}건 완료`);
          } else {
            summary.card = 0;
            log('  카드: 0건 (데이터 없음 또는 인증 미설정)');
          }
        } catch (e: any) { summary.card = -1; logError(`  카드 오류: ${e.message}`); }
      }

      // 4. 완료 상태 업데이트
      const hasError = Object.values(summary).some(v => v === -1);
      await updateSyncJob(job.id, hasError ? 'completed' : 'completed', summary);
      await recordRun(hasError ? 'completed' : 'completed', { trigger: 'sync_job', job_id: job.id, ...summary });
      log(`\n★ 동기화 완료 — 은행:${summary.bank || 0} 홈택스:${summary.hometax || 0} 카드:${summary.card || 0}`);
      log('  다음 요청 대기 중...\n');

    } catch (err: any) {
      logError(`watch 루프 오류: ${err.message}`);
    }

    await sleep(WATCH_INTERVAL_MS);
  }
}

async function updateSyncJob(jobId: string, status: string, resultSummary?: Record<string, any>) {
  try {
    const body: Record<string, any> = { status };
    if (status === 'in_progress') {
      body.started_at = new Date().toISOString();
    }
    if (status === 'completed' || status === 'failed') {
      body.completed_at = new Date().toISOString();
    }
    if (resultSummary) {
      body.result = resultSummary;
    }

    await fetch(`${SUPABASE_URL}/rest/v1/sync_jobs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(body),
    });
    log(`  sync_job ${jobId} → ${status}`);
  } catch (err: any) {
    logError(`sync_job 업데이트 실패: ${err.message}`);
  }
}

main().catch(err => {
  logError(`치명적 오류: ${err.message}`);
  process.exit(1);
});
