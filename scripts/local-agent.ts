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

function getCertPassword(): string {
  const pw = sh('security find-generic-password -s "leanos-ibk-cert-pw" -a "cert" -w');
  if (!pw) throw new Error('Keychain에서 IBK 인증서 비밀번호를 찾을 수 없습니다.\n→ bash scripts/setup-keychain.sh 를 먼저 실행하세요.');
  return pw;
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

  // 월별 청크 생성: 1년(12개월) → 각 달의 1일~말일
  const monthChunks: { from: string; to: string; label: string }[] = [];
  const today = new Date();
  const curYear = today.getFullYear();
  const curMonth = today.getMonth(); // 0-based
  for (let m = 11; m >= 0; m--) {
    const startMonth = new Date(curYear, curMonth - m, 1);
    const endMonth = m === 0 ? today : new Date(curYear, curMonth - m + 1, 0); // 말일
    const fmt = (dt: Date) => `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
    monthChunks.push({
      from: fmt(startMonth),
      to: fmt(endMonth),
      label: `${startMonth.getFullYear()}-${String(startMonth.getMonth() + 1).padStart(2, '0')}`,
    });
  }
  log(`조회 기간: 12개월 → ${monthChunks.length}개 월별 청크`);

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
// 환경 점검
// ═══════════════════════════════════════════════════════════════

async function preflight(): Promise<boolean> {
  console.log('');
  console.log('='.repeat(60));
  console.log('  LeanOS IBK Local Agent — 환경 점검');
  console.log(`  ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`  OS: ${os.platform()} ${os.release()}`);
  console.log('  방식: CDP + OpenSSL CMS 서명 (Delfino 불필요)');
  console.log('='.repeat(60));
  console.log('');

  let allOk = true;

  // 1. 인증서
  try { const d = findCertDir(); log(`[OK] 공동인증서: ${d}`); }
  catch (e: any) { logError(`[FAIL] ${e.message}`); allOk = false; }

  // 2. Keychain
  try { getCertPassword(); log('[OK] Keychain 비밀번호'); }
  catch (e: any) { logError(`[FAIL] ${e.message}`); allOk = false; }

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
  if (allOk) log('환경 점검 통과');
  else logError('환경 점검 실패');
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
      // 로컬 백업 저장
      const backupPath = saveLocalBackup(result.transactions);
      log(`로컬 백업: ${backupPath}`);

      // EF용 데이터 변환
      const transformed = transformTransactions(result.transactions);
      log(`변환: ${transformed.length}건 (${result.accounts}개 계좌)`);

      // EF 업로드
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

  console.log('사용법:');
  console.log('  npx tsx scripts/local-agent.ts check  — 환경 점검');
  console.log('  npx tsx scripts/local-agent.ts bank   — IBK 거래내역 다운로드');
}

main().catch(err => {
  logError(`치명적 오류: ${err.message}`);
  process.exit(1);
});
