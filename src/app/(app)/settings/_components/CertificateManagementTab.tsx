"use client";
import { logRead } from "@/lib/log-read";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import React, { useEffect, useState, useRef } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { encryptCredential, decryptJsonCredentials } from "@/lib/crypto";
import { useToast } from "@/components/toast";

function CertFinderSection({ certDerRef, certKeyRef, certFileStatus, certUploading, onUpload }: {
  certDerRef: React.RefObject<HTMLInputElement | null>;
  certKeyRef: React.RefObject<HTMLInputElement | null>;
  certFileStatus: { der: boolean; key: boolean };
  certUploading: boolean;
  onUpload: () => void;
}) {
  const [certSource, setCertSource] = useState<"auto" | "manual" | null>(null);
  const [scanning, setScanning] = useState(false);
  const [foundCerts, setFoundCerts] = useState<{ name: string; derFile: File; keyFile: File | null }[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedCert, setSelectedCert] = useState<number | null>(null);

  // File System Access API를 사용한 인증서 자동 탐색
  async function scanForCerts() {
    setScanning(true);
    setScanError(null);
    setFoundCerts([]);
    setSelectedCert(null);

    try {
      // Check if File System Access API is available
      if (!('showDirectoryPicker' in window)) {
        setScanError("이 브라우저에서는 폴더 자동 탐색을 지원하지 않습니다. Chrome 또는 Edge 브라우저를 사용하거나, 아래 '직접 선택' 방식을 이용해주세요.");
        setScanning(false);
        return;
      }

      const dirHandle = await (window as any).showDirectoryPicker({ mode: "read" });
      const certs: { name: string; derFile: File; keyFile: File | null }[] = [];

      async function scanDir(handle: any, depth: number, path: string) {
        if (depth > 5) return;
        try {
          const entries: { kind: string; name: string; entry: any }[] = [];
          for await (const entry of handle.values()) {
            entries.push({ kind: entry.kind, name: entry.name, entry });
          }
          for (const { kind, name, entry } of entries) {
            if (kind === "directory") {
              await scanDir(entry, depth + 1, `${path}/${name}`);
            } else if (kind === "file" && name.toLowerCase() === "signcert.der") {
              const derFile = await entry.getFile();
              let keyFile: File | null = null;
              const keyEntry = entries.find(e => e.kind === "file" && e.name.toLowerCase() === "signpri.key");
              if (keyEntry) {
                keyFile = await keyEntry.entry.getFile();
              }
              certs.push({ name: path || dirHandle.name, derFile, keyFile });
            }
          }
        } catch { /* permission denied */ }
      }

      await scanDir(dirHandle, 0, "");

      if (certs.length === 0) {
        const isMac = navigator.platform?.toLowerCase().includes("mac");
        setScanError(isMac
          ? "선택한 폴더에서 인증서 파일을 찾을 수 없습니다. macOS에서는 보안 정책으로 일부 폴더(Library 등) 접근이 제한될 수 있습니다. 인증서 파일(signCert.der, signPri.key)을 바탕화면 또는 다운로드 폴더에 복사한 뒤 다시 시도하거나, 아래 '직접 선택' 방식을 이용해주세요."
          : "선택한 폴더에서 인증서 파일(signCert.der)을 찾을 수 없습니다. 다른 폴더를 선택하거나 '직접 선택'을 이용해주세요.");
      } else {
        setFoundCerts(certs);
        if (certs.length === 1) setSelectedCert(0);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setScanError("폴더 접근 중 오류가 발생했습니다. 다시 시도해주세요.");
      }
    }
    setScanning(false);
  }

  // Apply found cert to the file inputs
  function applyFoundCert() {
    if (selectedCert === null || !foundCerts[selectedCert]) return;
    const cert = foundCerts[selectedCert];

    // Create DataTransfer to set files on input elements
    if (certDerRef.current) {
      const dt = new DataTransfer();
      dt.items.add(cert.derFile);
      certDerRef.current.files = dt.files;
    }
    if (cert.keyFile && certKeyRef.current) {
      const dt = new DataTransfer();
      dt.items.add(cert.keyFile);
      certKeyRef.current.files = dt.files;
    }
    onUpload();
  }

  return (
    <div className="certificate-finder-section">
      {/* Step 1: 위치 선택 */}
      {!certSource && (
        <div className="certificate-source-picker">
          <div className="text-xs font-semibold text-[var(--text)]">인증서를 어떻게 등록하시겠습니까?</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={() => { setCertSource("auto"); }}
              className="p-4 rounded-xl border-2 border-dashed border-[var(--primary)]/30 bg-[var(--primary)]/5 hover:bg-[var(--primary)]/10 hover:border-[var(--primary)]/50 transition text-left">
              <div className="text-sm font-bold text-[var(--primary)] mb-1">자동 탐색</div>
              <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                PC나 USB에서 인증서 폴더를 선택하면<br/>자동으로 인증서를 찾아줍니다
              </div>
            </button>
            <button onClick={() => setCertSource("manual")}
              className="p-4 rounded-xl border-2 border-dashed border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--bg-surface)] transition text-left">
              <div className="text-sm font-bold text-[var(--text)] mb-1">직접 선택</div>
              <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                인증서 파일(.der)과 개인키 파일(.key)을<br/>직접 선택하여 업로드합니다
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Auto scan mode */}
      {certSource === "auto" && (
        <div className="certificate-auto-scan-panel">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[var(--text)]">인증서 자동 탐색</div>
            <button onClick={() => { setCertSource(null); setFoundCerts([]); setScanError(null); }} className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]">방식 변경</button>
          </div>

          {/* 위치 안내 */}
          <div className="certificate-location-guide">
            <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-2">인증서가 저장된 폴더를 선택해주세요</div>
            <div className="space-y-1.5 text-[10px] text-[var(--text-dim)]">
              <div className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">PC</span>
                <div>
                  <div>Windows: <span className="font-mono bg-[var(--bg)] px-1 rounded">C:\Users\사용자명\AppData\LocalLow\NPKI</span></div>
                  <div>또는 <span className="font-mono bg-[var(--bg)] px-1 rounded">C:\Program Files\NPKI</span></div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">USB</span>
                <span>USB 드라이브의 <span className="font-mono bg-[var(--bg)] px-1 rounded">NPKI</span> 폴더</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-amber-400 mt-0.5">Mac</span>
                <span><span className="font-mono bg-[var(--bg)] px-1 rounded">~/Library/Preferences/NPKI</span></span>
              </div>
            </div>
          </div>

          <button onClick={scanForCerts} disabled={scanning}
            className="w-full py-3 rounded-xl text-xs font-bold border transition bg-[var(--primary-light)] border-[var(--primary)]/30 text-[var(--primary)] hover:bg-[var(--primary)]/20 disabled:opacity-50">
            {scanning ? "폴더를 탐색하고 있습니다..." : "폴더 선택하여 인증서 찾기"}
          </button>

          {scanError && (
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <div className="text-[11px] text-red-400">{scanError}</div>
            </div>
          )}

          {/* Found certs */}
          {foundCerts.length > 0 && (
            <div className="certificate-found-list">
              <div className="text-[10px] font-semibold text-green-400">{foundCerts.length}개의 인증서를 발견했습니다</div>
              {foundCerts.map((cert, idx) => (
                <button key={idx} onClick={() => setSelectedCert(idx)}
                  className={`w-full p-3 rounded-xl border text-left transition ${selectedCert === idx ? "bg-[var(--primary-light)] border-[var(--primary)]/40" : "bg-[var(--bg-surface)] border-[var(--border)] hover:border-[var(--primary)]"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${selectedCert === idx ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--border)]"}`}>
                      {selectedCert === idx && <span className="text-white text-[8px]">V</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{cert.name || "인증서"}</div>
                      <div className="caption">
                        signCert.der {cert.keyFile ? "+ signPri.key" : "(개인키 없음)"}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
              <button onClick={applyFoundCert} disabled={selectedCert === null || certUploading}
                className="w-full py-2.5 rounded-xl text-xs font-semibold border transition bg-[var(--primary)] border-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-50">
                {certUploading ? "업로드 중..." : "선택한 인증서 등록"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Manual mode */}
      {certSource === "manual" && (
        <div className="certificate-manual-panel">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[var(--text)]">인증서 직접 선택</div>
            <button onClick={() => setCertSource(null)} className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]">방식 변경</button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[10px] text-[var(--text-dim)] font-semibold mb-1">인증서 파일 (.der)</div>
              <div className="flex items-center gap-2">
                <input ref={certDerRef} type="file" className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--primary-light)] file:text-[var(--primary)] hover:file:bg-[var(--primary)]/20 w-full" />
                {certFileStatus.der && <span className="text-green-400 text-[10px] font-semibold whitespace-nowrap">등록됨</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[10px] text-[var(--text-dim)] font-semibold mb-1">개인키 파일 (.key)</div>
              <div className="flex items-center gap-2">
                <input ref={certKeyRef} type="file" className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--primary-light)] file:text-[var(--primary)] hover:file:bg-[var(--primary)]/20 w-full" />
                {certFileStatus.key && <span className="text-green-400 text-[10px] font-semibold whitespace-nowrap">등록됨</span>}
              </div>
            </div>
          </div>
          <button onClick={onUpload} disabled={certUploading}
            className="w-full py-2.5 rounded-xl text-xs font-semibold border transition bg-[var(--primary-light)] border-[var(--primary)]/30 text-[var(--primary)] hover:bg-[var(--primary)]/20 disabled:opacity-50">
            {certUploading ? "업로드 중..." : "인증서 업로드"}
          </button>
        </div>
      )}

      {/* 등록 상태 */}
      {(certFileStatus.der || certFileStatus.key) && (
        <div className="certificate-registration-status">
          <div className="text-[10px] text-green-400 font-semibold">
            {certFileStatus.der && certFileStatus.key ? "인증서 + 개인키 모두 등록됨" : certFileStatus.der ? "인증서만 등록됨 (개인키 필요)" : "개인키만 등록됨 (인증서 필요)"}
          </div>
        </div>
      )}
      <p className="caption">
        인증서 파일은 암호화되어 안전하게 보관됩니다. 홈택스/은행 자동화 시 사용됩니다.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════
// Certificate Management Tab
// ═══════════════════════════════════════════

export function CertificateManagementTab({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const db2 = supabase;
  const queryClient = useQueryClient();
  const BANK_LIST = [
    { value: "ibk", label: "IBK 기업은행" },
    { value: "kb", label: "KB 국민은행" },
    { value: "shinhan", label: "신한은행" },
    { value: "hana", label: "하나은행" },
    { value: "woori", label: "우리은행" },
    { value: "nh", label: "NH 농협은행" },
    { value: "kdb", label: "KDB 산업은행" },
    { value: "sc", label: "SC 제일은행" },
    { value: "daegu", label: "대구은행" },
    { value: "busan", label: "부산은행" },
    { value: "kwangju", label: "광주은행" },
    { value: "suhyup", label: "수협은행" },
  ];
  const CARD_LIST = [
    { value: "lottecard", label: "롯데카드" },
    { value: "samsung", label: "삼성카드" },
    { value: "hyundai", label: "현대카드" },
    { value: "shinhan", label: "신한카드" },
    { value: "kb", label: "KB국민카드" },
    { value: "hana", label: "하나카드" },
    { value: "woori", label: "우리카드" },
    { value: "bc", label: "BC카드" },
    { value: "nh", label: "NH농협카드" },
    { value: "ibkcard", label: "IBK기업은행카드" },
  ];
  type ServiceEntry = { company: string; login_id: string; login_password: string; cert_password?: string };
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [banks, setBanks] = useState<ServiceEntry[]>([]);
  const [cards, setCards] = useState<ServiceEntry[]>([]);
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const [autoSign, setAutoSign] = useState({ auto_sign_tax_invoice: true, auto_sign_bank_transfer: true });
  const [hometaxMethod, setHometaxMethod] = useState<"certificate" | "id_pw">("certificate");
  const [hometaxCert, setHometaxCert] = useState("");
  const [hometaxId, setHometaxId] = useState("");
  const [hometaxPw, setHometaxPw] = useState("");

  // NPKI 인증서 파일 업로드
  const [certUploading, setCertUploading] = useState(false);
  const [certFileStatus, setCertFileStatus] = useState<{ der: boolean; key: boolean }>({ der: false, key: false });
  const certDerRef = useRef<HTMLInputElement>(null);
  const certKeyRef = useRef<HTMLInputElement>(null);

  // 인증서 파일 존재 여부 확인
  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const derList = logRead('_components/CertificateManagementTab:derList', await supabase.storage.from("certificates").list(companyId, { search: "signCert.der" }));
      const keyList = logRead('_components/CertificateManagementTab:keyList', await supabase.storage.from("certificates").list(companyId, { search: "signPri.key" }));
      setCertFileStatus({
        der: (derList || []).some((f: any) => f.name === "signCert.der"),
        key: (keyList || []).some((f: any) => f.name === "signPri.key"),
      });
    })();
  }, [companyId]);

  async function uploadCertFiles() {
    if (!companyId) return;
    const derFile = certDerRef.current?.files?.[0];
    const keyFile = certKeyRef.current?.files?.[0];
    if (!derFile && !keyFile) { toast("업로드할 파일을 선택해주세요.", "error"); return; }
    setCertUploading(true);
    try {
      if (derFile) {
        const { error } = await supabase.storage.from("certificates").upload(`${companyId}/signCert.der`, derFile, { upsert: true });
        if (error) throw new Error("인증서 파일 업로드 실패: " + error.message);
      }
      if (keyFile) {
        const { error } = await supabase.storage.from("certificates").upload(`${companyId}/signPri.key`, keyFile, { upsert: true });
        if (error) throw new Error("개인키 파일 업로드 실패: " + error.message);
      }
      // automation_credentials에 인증서 경로 저장
      await db2.from("automation_credentials").upsert({
        company_id: companyId,
        service: "npki_cert",
        credentials: {
          cert_path: `${companyId}/signCert.der`,
          key_path: `${companyId}/signPri.key`,
          uploaded_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,service" });
      setCertFileStatus({
        der: derFile ? true : certFileStatus.der,
        key: keyFile ? true : certFileStatus.key,
      });
      if (certDerRef.current) certDerRef.current.value = "";
      if (certKeyRef.current) certKeyRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["automation-credentials"] });
      toast("인증서 파일이 업로드되었습니다.", "success");
    } catch (err: any) {
      console.error("cert upload error:", err);
      toast(friendlyError(err, "업로드 실패"), "error");
    } finally { setCertUploading(false); }
  }

  // 인증정보 조회
  const { data: creds = [] } = useQuery({
    queryKey: ["automation-credentials", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const data = logRead('_components/CertificateManagementTab:data', await db2.from("automation_credentials").select("*").eq("company_id", companyId));
      return data || [];
    },
    enabled: !!companyId,
  });

  // 자동서명 설정
  const { data: certSettings } = useQuery({
    queryKey: ["cert-settings", companyId],
    queryFn: async () => { if (!companyId) return null; const data = logRead('_components/CertificateManagementTab:data', await db2.from("companies").select("cert_settings").eq("id", companyId).maybeSingle()); return (data?.cert_settings || {}) as Record<string, unknown>; },
    enabled: !!companyId,
  });

  useEffect(() => { if (certSettings) setAutoSign((prev) => ({ ...prev, ...certSettings })); }, [certSettings]);

  // 기존값 초기화 (decrypt encrypted credentials)
  useEffect(() => {
    if (creds.length === 0) return;

    async function loadDecrypted() {
      // Helper to decrypt a credentials object, falling back gracefully
      async function tryDecrypt(c: Record<string, unknown>): Promise<Record<string, any>> {
        try {
          return await decryptJsonCredentials(c) as Record<string, any>;
        } catch {
          return c as Record<string, any>;
        }
      }

      // 은행 목록
      const bankEntries = creds.filter((c: any) => c.service?.startsWith("bank_"));
      if (bankEntries.length > 0) {
        const decryptedBanks = await Promise.all(bankEntries.map(async (b: any) => {
          const dec = b.credentials ? await tryDecrypt(b.credentials) : {};
          return {
            company: b.service.replace("bank_", "").replace(/_\d+$/, ""),
            login_id: dec.login_id || "",
            login_password: dec.login_password || "",
            cert_password: dec.cert_password || "",
          };
        }));
        setBanks(decryptedBanks);
      }

      // 카드 목록
      const cardEntries = creds.filter((c: any) => c.service?.startsWith("card_"));
      if (cardEntries.length > 0) {
        const decryptedCards = await Promise.all(cardEntries.map(async (c: any) => {
          const dec = c.credentials ? await tryDecrypt(c.credentials) : {};
          return {
            company: c.service.replace("card_", "").replace(/_\d+$/, ""),
            login_id: dec.login_id || "",
            login_password: dec.login_password || "",
            cert_password: dec.cert_password || "",
          };
        }));
        setCards(decryptedCards);
      }

      // 홈택스
      const ht = creds.find((c: any) => c.service === "hometax");
      if (ht?.credentials) {
        const dec = await tryDecrypt(ht.credentials as Record<string, unknown>);
        if (dec.login_method) setHometaxMethod(dec.login_method);
        else if (dec.cert_password && !dec.login_id) setHometaxMethod("certificate");
        else if (dec.login_id) setHometaxMethod("id_pw");
        if (dec.cert_password) setHometaxCert(dec.cert_password);
        if (dec.login_id) setHometaxId(dec.login_id);
        if (dec.login_password) setHometaxPw(dec.login_password);
      }

      // 레거시: 기존 ibk/hometax/lottecard 데이터 마이그레이션
      const ibk = creds.find((c: any) => c.service === "ibk");
      const lc = creds.find((c: any) => c.service === "lottecard");
      if ((ibk?.credentials as any)?.cert_password && bankEntries.length === 0) {
        const dec = await tryDecrypt(ibk!.credentials as Record<string, unknown>);
        setBanks([{ company: "ibk", login_id: "", login_password: "", cert_password: dec.cert_password || "" }]);
      }
      if ((lc?.credentials as any)?.login_id && cardEntries.length === 0) {
        const dec = await tryDecrypt(lc!.credentials as Record<string, unknown>);
        setCards([{ company: "lottecard", login_id: dec.login_id || "", login_password: dec.login_password || "" }]);
      }
    }

    loadDecrypted();
  }, [creds]);

  function addBank() { setBanks([...banks, { company: "ibk", login_id: "", login_password: "", cert_password: "" }]); }
  function removeBank(i: number) { setBanks(banks.filter((_, idx) => idx !== i)); }
  function updateBank(i: number, field: string, val: string) { setBanks(banks.map((b, idx) => idx === i ? { ...b, [field]: val } : b)); }
  function addCard() { setCards([...cards, { company: "lottecard", login_id: "", login_password: "", cert_password: "" }]); }
  function removeCard(i: number) { setCards(cards.filter((_, idx) => idx !== i)); }
  function updateCard(i: number, field: string, val: string) { setCards(cards.map((c, idx) => idx === i ? { ...c, [field]: val } : c)); }

  async function saveAll() {
    if (!companyId) return;
    setSaving(true);
    try {
      // Supabase 에러 체크 헬퍼
      function check<T>(result: { data: T; error: any }, label: string): T {
        if (result.error) throw new Error(`${label}: ${result.error.message}`);
        return result.data;
      }

      // 기존 은행/카드 인증정보 삭제 후 다시 저장
      check(await db2.from("automation_credentials").delete().eq("company_id", companyId).like("service", "bank_%"), "은행 삭제");
      check(await db2.from("automation_credentials").delete().eq("company_id", companyId).like("service", "card_%"), "카드 삭제");
      check(await db2.from("automation_credentials").delete().eq("company_id", companyId).eq("service", "hometax"), "홈택스 삭제");
      // 레거시 데이터도 정리
      check(await db2.from("automation_credentials").delete().eq("company_id", companyId).in("service", ["ibk", "lottecard"]), "레거시 삭제");

      // 은행 저장 (encrypt sensitive fields server-side)
      for (let i = 0; i < banks.length; i++) {
        const b = banks[i];
        if (!b.cert_password && !b.login_id) continue;
        const bankCreds: Record<string, string> = { bank_name: b.company, login_id: b.login_id };
        if (b.login_password) bankCreds.login_password = (await encryptCredential(b.login_password)) || "";
        if (b.cert_password) bankCreds.cert_password = (await encryptCredential(b.cert_password)) || "";
        check(await db2.from("automation_credentials").insert({
          company_id: companyId,
          service: `bank_${b.company}_${i}`,
          credentials: bankCreds,
          updated_at: new Date().toISOString(),
        }), `은행 ${b.company} 저장`);
      }

      // 카드 저장 (encrypt sensitive fields server-side)
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (!c.login_id && !c.cert_password) continue;
        const cardCreds: Record<string, string> = { card_company: c.company, login_id: c.login_id };
        if (c.login_password) cardCreds.login_password = (await encryptCredential(c.login_password)) || "";
        if (c.cert_password) cardCreds.cert_password = (await encryptCredential(c.cert_password)) || "";
        check(await db2.from("automation_credentials").insert({
          company_id: companyId,
          service: `card_${c.company}_${i}`,
          credentials: cardCreds,
          updated_at: new Date().toISOString(),
        }), `카드 ${c.company} 저장`);
      }

      // 홈택스 독립 저장 (encrypt sensitive fields server-side)
      const hometaxCreds: Record<string, string> = { login_method: hometaxMethod };
      if (hometaxMethod === "certificate" && hometaxCert) {
        hometaxCreds.cert_password = (await encryptCredential(hometaxCert)) || "";
      } else if (hometaxMethod === "id_pw" && hometaxId) {
        hometaxCreds.login_id = hometaxId;
        if (hometaxPw) hometaxCreds.login_password = (await encryptCredential(hometaxPw)) || "";
      }
      if (hometaxCert || hometaxId) {
        check(await db2.from("automation_credentials").upsert({
          company_id: companyId, service: "hometax",
          credentials: hometaxCreds,
          updated_at: new Date().toISOString(),
        }, { onConflict: "company_id,service" }), "홈택스 저장");
      }

      // 자동서명 설정
      check(await db2.from("companies").update({ cert_settings: autoSign }).eq("id", companyId), "자동서명 설정");

      queryClient.invalidateQueries({ queryKey: ["automation-credentials"] });
      queryClient.invalidateQueries({ queryKey: ["cert-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      console.error("credential save error:", err);
      toast("저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error");
    } finally { setSaving(false); }
  }

  if (!companyId) return <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;

  return (
    <div className="settings-certificate-tab">
      {/* 안내 */}
      <div className="certificate-intro-banner">
        <div className="text-sm font-semibold text-[var(--text)] mb-1">인증서 & 자동화 설정</div>
        <p className="text-xs text-[var(--text-muted)]">
          은행, 홈택스, 카드 로그인 정보를 등록하면 거래내역과 세금계산서가 자동으로 수집됩니다.
          공동인증서 파일(.der, .key)을 업로드하고 비밀번호를 등록하면 자동화가 활성화됩니다.
        </p>
      </div>

      {/* 공동인증서 파일 업로드 — 위치 자동 탐색 */}
      <div className="certificate-upload-card glass-card">
        <div className="flex items-center gap-3 mb-4">
          <span className="kpi-icon text-lg">📜</span>
          <div>
            <div className="text-sm font-bold">공동인증서 (NPKI)</div>
            <div className="text-[11px] text-[var(--text-dim)]">홈택스, 은행 자동화에 필요한 공동인증서 파일</div>
          </div>
        </div>

        {/* 인증서 위치 안내 + 자동 탐색 */}
        <CertFinderSection
          certDerRef={certDerRef}
          certKeyRef={certKeyRef}
          certFileStatus={certFileStatus}
          certUploading={certUploading}
          onUpload={uploadCertFiles}
        />
      </div>

      {/* 은행 */}
      <div className="bank-credentials-card glass-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="kpi-icon info text-lg">🏦</span>
            <div>
              <div className="text-sm font-bold">은행 계좌</div>
              <div className="text-[11px] text-[var(--text-dim)]">거래내역 자동 수집 + 홈택스 세금계산서</div>
            </div>
          </div>
          <button onClick={addBank} className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold">+ 은행 추가</button>
        </div>
        {banks.length === 0 ? (
          <button onClick={addBank} className="w-full py-6 rounded-xl border-2 border-dashed border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition">
            은행을 추가하세요
          </button>
        ) : (
          <div className="space-y-4">
            {banks.map((b, i) => {
              const bankLoginMethod = (b as any).login_method || (b.cert_password && !b.login_id ? "certificate" : b.login_id ? "id_pw" : "certificate");
              return (
              <div key={i} className="bank-credential-row">
                <div className="flex items-center gap-2">
                  <select value={b.company} onChange={(e) => updateBank(i, "company", e.target.value)}
                    className="flex-1 px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
                    {BANK_LIST.map((bk) => <option key={bk.value} value={bk.value}>{bk.label}</option>)}
                  </select>
                  <button onClick={() => removeBank(i)} className="px-2 py-2 text-red-400/60 hover:text-red-400 text-xs">삭제</button>
                </div>
                <div className="text-[10px] text-[var(--text-dim)] font-semibold mb-1">로그인 방식</div>
                <div className="flex gap-2 mb-2">
                  <button onClick={() => { const arr = [...banks]; (arr[i] as any).login_method = "certificate"; setBanks(arr); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${bankLoginMethod === "certificate" ? "bg-[var(--primary-light)] border-[var(--primary)]/50 text-[var(--primary)]" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
                    📜 공동인증서
                  </button>
                  <button onClick={() => { const arr = [...banks]; (arr[i] as any).login_method = "id_pw"; setBanks(arr); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${bankLoginMethod === "id_pw" ? "bg-[var(--primary-light)] border-[var(--primary)]/50 text-[var(--primary)]" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
                    🔑 아이디/비밀번호
                  </button>
                </div>
                {bankLoginMethod === "certificate" ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <input type={showPw[`bank_cert_${i}`] ? "text" : "password"} value={b.cert_password || ""} onChange={(e) => updateBank(i, "cert_password", e.target.value)}
                        placeholder="공동인증서 비밀번호" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
                      <button type="button" onClick={() => setShowPw((p) => ({ ...p, [`bank_cert_${i}`]: !p[`bank_cert_${i}`] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                        {showPw[`bank_cert_${i}`] ? "숨기기" : "보기"}
                      </button>
                    </div>
                    <p className="caption">상단에 등록된 공동인증서를 사용합니다</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input type="text" value={b.login_id} onChange={(e) => updateBank(i, "login_id", e.target.value)} placeholder="인터넷뱅킹 아이디"
                      className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
                    <div className="relative">
                      <input type={showPw[`bank_pw_${i}`] ? "text" : "password"} value={b.login_password} onChange={(e) => updateBank(i, "login_password", e.target.value)} placeholder="비밀번호"
                        className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
                      <button type="button" onClick={() => setShowPw((p) => ({ ...p, [`bank_pw_${i}`]: !p[`bank_pw_${i}`] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                        {showPw[`bank_pw_${i}`] ? "숨기기" : "보기"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 홈택스 (레거시 — 신규 등록은 위의 "금융기관 연결" 섹션에서 "홈택스" 선택) */}
      <div className="hometax-legacy-card glass-card">
        <div className="flex items-center gap-3 mb-2">
          <span className="kpi-icon success text-lg">🏛️</span>
          <div>
            <div className="text-sm font-bold">홈택스 (레거시 입력)</div>
            <div className="text-[11px] text-[var(--text-dim)]">세금계산서 자동 조회 · 인증서 또는 ID/PW 선택</div>
          </div>
        </div>
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700">
          ⚠️ 이 입력은 더 이상 동기화에 사용되지 않습니다. 홈택스 연동은 <b>'은행연동' 탭 → 금융기관 연결 → 홈택스</b> 버튼으로 등록하세요.
        </div>
        <div className="mb-3">
          <div className="text-[10px] text-[var(--text-dim)] font-semibold mb-2">로그인 방식</div>
          <div className="flex gap-2">
            <button onClick={() => setHometaxMethod("certificate")}
              className={`flex-1 py-2.5 rounded-lg text-xs font-semibold border transition ${hometaxMethod === "certificate" ? "bg-[var(--primary-light)] border-[var(--primary)]/50 text-[var(--primary)]" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
              📜 공동인증서
            </button>
            <button onClick={() => setHometaxMethod("id_pw")}
              className={`flex-1 py-2.5 rounded-lg text-xs font-semibold border transition ${hometaxMethod === "id_pw" ? "bg-[var(--primary-light)] border-[var(--primary)]/50 text-[var(--primary)]" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
              🔑 아이디/비밀번호
            </button>
          </div>
        </div>
        {hometaxMethod === "certificate" ? (
          <div className="relative">
            <input type={showPw["hometax_cert"] ? "text" : "password"} value={hometaxCert} onChange={(e) => setHometaxCert(e.target.value)}
              placeholder="공동인증서 비밀번호" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
            <button type="button" onClick={() => setShowPw((p) => ({ ...p, hometax_cert: !p.hometax_cert }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
              {showPw["hometax_cert"] ? "숨기기" : "보기"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={hometaxId} onChange={(e) => setHometaxId(e.target.value)} placeholder="홈택스 ID"
              className="px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
            <div className="relative">
              <input type={showPw["hometax_pw"] ? "text" : "password"} value={hometaxPw} onChange={(e) => setHometaxPw(e.target.value)} placeholder="비밀번호"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
              <button type="button" onClick={() => setShowPw((p) => ({ ...p, hometax_pw: !p.hometax_pw }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                {showPw["hometax_pw"] ? "숨기기" : "보기"}
              </button>
            </div>
          </div>
        )}
        <p className="text-[10px] text-[var(--text-dim)] mt-2">세무자동화 탭에서도 동일하게 설정할 수 있습니다</p>
      </div>

      {/* 카드 */}
      <div className="card-credentials-card glass-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="kpi-icon danger text-lg">💳</span>
            <div>
              <div className="text-sm font-bold">법인카드</div>
              <div className="text-[11px] text-[var(--text-dim)]">카드 이용내역 자동 수집</div>
            </div>
          </div>
          <button onClick={addCard} className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold">+ 카드 추가</button>
        </div>
        {cards.length === 0 ? (
          <button onClick={addCard} className="w-full py-6 rounded-xl border-2 border-dashed border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition">
            카드를 추가하세요
          </button>
        ) : (
          <div className="space-y-4">
            {cards.map((c, i) => {
              const cardLoginMethod = (c as any).login_method || (c.cert_password && !c.login_id ? "certificate" : c.login_id ? "id_pw" : "certificate");
              return (
              <div key={i} className="card-credential-row">
                <div className="flex items-center gap-2">
                  <select value={c.company} onChange={(e) => updateCard(i, "company", e.target.value)}
                    className="flex-1 px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
                    {CARD_LIST.map((cd) => <option key={cd.value} value={cd.value}>{cd.label}</option>)}
                  </select>
                  <button onClick={() => removeCard(i)} className="px-2 py-2 text-red-400/60 hover:text-red-400 text-xs">삭제</button>
                </div>
                <div className="text-[10px] text-[var(--text-dim)] font-semibold mb-1">로그인 방식</div>
                <div className="flex gap-2 mb-2">
                  <button onClick={() => { const arr = [...cards]; (arr[i] as any).login_method = "certificate"; setCards(arr); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${cardLoginMethod === "certificate" ? "bg-[var(--primary-light)] border-[var(--primary)]/50 text-[var(--primary)]" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
                    📜 공동인증서
                  </button>
                  <button onClick={() => { const arr = [...cards]; (arr[i] as any).login_method = "id_pw"; setCards(arr); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${cardLoginMethod === "id_pw" ? "bg-[var(--primary-light)] border-[var(--primary)]/50 text-[var(--primary)]" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
                    🔑 아이디/비밀번호
                  </button>
                </div>
                {cardLoginMethod === "certificate" ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <input type={showPw[`card_cert_${i}`] ? "text" : "password"} value={c.cert_password || ""} onChange={(e) => updateCard(i, "cert_password", e.target.value)}
                        placeholder="공동인증서 비밀번호" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
                      <button type="button" onClick={() => setShowPw((p) => ({ ...p, [`card_cert_${i}`]: !p[`card_cert_${i}`] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                        {showPw[`card_cert_${i}`] ? "숨기기" : "보기"}
                      </button>
                    </div>
                    <p className="caption">상단에 등록된 공동인증서를 사용합니다</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input type="text" value={c.login_id} onChange={(e) => updateCard(i, "login_id", e.target.value)} placeholder="카드사 아이디"
                      className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
                    <div className="relative">
                      <input type={showPw[`card_pw_${i}`] ? "text" : "password"} value={c.login_password} onChange={(e) => updateCard(i, "login_password", e.target.value)} placeholder="비밀번호"
                        className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
                      <button type="button" onClick={() => setShowPw((p) => ({ ...p, [`card_pw_${i}`]: !p[`card_pw_${i}`] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                        {showPw[`card_pw_${i}`] ? "숨기기" : "보기"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 자동서명 규칙 */}
      <div className="auto-sign-rules-card glass-card">
        <h2 className="section-title">자동서명 규칙</h2>
        <div className="space-y-3">
          <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] cursor-pointer">
            <div><div className="text-sm font-medium">세금계산서 자동서명</div><div className="text-xs text-[var(--text-dim)] mt-0.5">승인 완료 시 인증서로 자동 전자서명</div></div>
            <input type="checkbox" checked={autoSign.auto_sign_tax_invoice} onChange={(e) => setAutoSign({ ...autoSign, auto_sign_tax_invoice: e.target.checked })} className="w-5 h-5 rounded accent-[var(--primary)]" />
          </label>
          <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] cursor-pointer">
            <div><div className="text-sm font-medium">은행이체 자동서명</div><div className="text-xs text-[var(--text-dim)] mt-0.5">이체 실행 시 인증서 전자서명</div></div>
            <input type="checkbox" checked={autoSign.auto_sign_bank_transfer} onChange={(e) => setAutoSign({ ...autoSign, auto_sign_bank_transfer: e.target.checked })} className="w-5 h-5 rounded accent-[var(--primary)]" />
          </label>
        </div>
      </div>

      {/* 저장 */}
      <button onClick={saveAll} disabled={saving}
        className="btn-primary w-full">
        {saving ? "저장 중..." : saved ? "저장 완료" : "설정 저장"}
      </button>

      <p className="text-[10px] text-[var(--text-dim)] text-center">
        인증정보는 RLS 정책으로 보호되며, 회사 대표만 조회할 수 있습니다.
      </p>
    </div>
  );
}
