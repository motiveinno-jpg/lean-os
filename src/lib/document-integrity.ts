/**
 * OwnerView Document Hash Integrity Verification
 * SHA-256 기반 문서 무결성 검증 엔진
 */

import { supabase } from './supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Hash Utilities ──

/**
 * SHA-256 해시 생성 (Web Crypto API - 브라우저 + Edge Functions 호환)
 */
export async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 문서 콘텐츠(HTML 또는 JSON 문자열)의 SHA-256 해시 반환
 */
export async function generateDocumentHash(content: string): Promise<string> {
  return hashString(content);
}

// ── Package-level Hash ──

/**
 * 패키지 내 모든 문서 + 서명 데이터를 결합한 SHA-256 해시 생성
 */
export async function generatePackageHash(packageId: string): Promise<string> {
  // 패키지 아이템 조회 (문서 콘텐츠 + 서명 데이터 포함)
  const { data: items, error } = await db
    .from('hr_contract_package_items')
    .select('id, sort_order, signature_data, documents(content_json)')
    .eq('package_id', packageId)
    .order('sort_order');

  if (error) throw new Error(`패키지 아이템 조회 실패: ${error.message}`);
  if (!items || items.length === 0) throw new Error('패키지에 문서가 없습니다');

  // 정렬 순서대로 콘텐츠 + 서명을 직렬화하여 결합
  const parts: string[] = [];

  for (const item of items) {
    // 문서 콘텐츠
    if (item.documents?.content_json) {
      parts.push(JSON.stringify(item.documents.content_json));
    }
    // 서명 데이터
    if (item.signature_data) {
      parts.push(JSON.stringify(item.signature_data));
    }
  }

  return hashString(parts.join('|'));
}

// ── Hash Storage ──

/**
 * 패키지 notes 필드에 해시 + 타임스탬프를 JSON으로 저장
 */
export async function storeDocumentHash(packageId: string, hash: string): Promise<void> {
  // 기존 notes 읽기
  const { data: pkg, error: fetchError } = await db
    .from('hr_contract_packages')
    .select('notes')
    .eq('id', packageId)
    .single();

  if (fetchError) throw new Error(`패키지 조회 실패: ${fetchError.message}`);

  // 기존 JSON 파싱 (notes가 비어있거나 일반 텍스트일 수 있음)
  let meta: Record<string, unknown> = {};
  if (pkg?.notes) {
    try {
      meta = JSON.parse(pkg.notes);
    } catch {
      // JSON이 아닌 경우 텍스트로 보존
      meta = { text: pkg.notes };
    }
  }

  meta.document_hash = hash;
  meta.hash_generated_at = new Date().toISOString();

  const { error: updateError } = await db
    .from('hr_contract_packages')
    .update({ notes: JSON.stringify(meta) })
    .eq('id', packageId);

  if (updateError) throw new Error(`해시 저장 실패: ${updateError.message}`);
}

// ── Integrity Verification ──

export interface IntegrityResult {
  valid: boolean;
  storedHash: string;
  currentHash: string;
}

/**
 * 현재 문서 내용으로 해시를 재생성하여 저장된 해시와 비교
 */
export async function verifyDocumentIntegrity(packageId: string): Promise<IntegrityResult> {
  // 저장된 해시 읽기
  const { data: pkg, error: fetchError } = await db
    .from('hr_contract_packages')
    .select('notes')
    .eq('id', packageId)
    .single();

  if (fetchError) throw new Error(`패키지 조회 실패: ${fetchError.message}`);

  let storedHash = '';
  if (pkg?.notes) {
    try {
      const meta = JSON.parse(pkg.notes);
      storedHash = meta.document_hash || '';
    } catch {
      // notes가 JSON이 아니면 해시 없음
    }
  }

  if (!storedHash) {
    throw new Error('저장된 해시가 없습니다. 먼저 storeDocumentHash를 호출하세요.');
  }

  // 현재 콘텐츠로 해시 재생성
  const currentHash = await generatePackageHash(packageId);

  return {
    valid: storedHash === currentHash,
    storedHash,
    currentHash,
  };
}
