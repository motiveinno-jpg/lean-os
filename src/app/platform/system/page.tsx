"use client";
import { logRead } from "@/lib/log-read";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase;

export default function SystemPage() {
  const [expanded, setExpanded] = useState<null | "companies" | "users">(null);
  const toggle = (k: "companies" | "users") => setExpanded((cur) => (cur === k ? null : k));

  const { data: companies = [] } = useQuery({
    queryKey: ["p-sys-companies"],
    queryFn: async () => {
      const data = logRead('system/page:data', await db
        .from("companies")
        .select("id, name, business_number, created_at")
        .order("created_at", { ascending: false }));
      return data || [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["p-sys-users"],
    queryFn: async () => {
      const data = logRead('system/page:data', await db
        .from("users")
        .select("id, name, email, role, created_at, company_id")
        .order("created_at", { ascending: false }));
      return data || [];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["p-sys-plans"],
    queryFn: async () => {
      const data = logRead('system/page:data', await db.from("subscription_plans").select("*").order("base_price", { ascending: true }));
      return data || [];
    },
  });

  // 릴리스 노트는 코드 상수로 관리 (release_notes 테이블·입력 UI 미구축, 쿼리 구조도 렌더와 불일치했음)
  const releaseLog = FALLBACK_RELEASES;

  const roleCounts = users.reduce((acc: Record<string, number>, u: any) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-[var(--text)]">시스템 현황</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">플랫폼 리소스 및 요금제 설정</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* DB Stats */}
        <div className="platform-db-stats-card glass-card">
          <h3 className="section-title text-[var(--text)]">데이터베이스</h3>
          <div className="space-y-3">
            {/* 총 회사 — 클릭 시 목록 토글 */}
            <button
              onClick={() => toggle("companies")}
              className="w-full flex justify-between items-center p-3 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)]/70 transition text-left"
            >
              <span className="text-sm text-[var(--text-muted)] flex items-center gap-1.5">
                총 회사
                <svg className={`w-3.5 h-3.5 transition-transform ${expanded === "companies" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
              <span className="font-bold mono-number text-[var(--text)]">{companies.length}</span>
            </button>
            {expanded === "companies" && (
              <div className="platform-company-list">
                {companies.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[var(--text-dim)]">회사가 없습니다</div>
                ) : (
                  companies.map((c: any) => (
                    <Link
                      key={c.id}
                      href={`/platform/companies/${c.id}`}
                      className="platform-company-row"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-[var(--text)] font-medium truncate">{c.name || "(이름 없음)"}</div>
                        <div className="text-[11px] text-[var(--text-dim)]">
                          {c.business_number || "사업자번호 미등록"}
                          {c.created_at && ` · 가입 ${new Date(c.created_at).toLocaleDateString("ko-KR")}`}
                        </div>
                      </div>
                      <span className="text-[var(--text-dim)] text-xs shrink-0 ml-2">상세 →</span>
                    </Link>
                  ))
                )}
              </div>
            )}

            {/* 총 사용자 — 클릭 시 목록 토글 */}
            <button
              onClick={() => toggle("users")}
              className="w-full flex justify-between items-center p-3 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)]/70 transition text-left"
            >
              <span className="text-sm text-[var(--text-muted)] flex items-center gap-1.5">
                총 사용자
                <svg className={`w-3.5 h-3.5 transition-transform ${expanded === "users" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
              <span className="font-bold mono-number text-[var(--text)]">{users.length}</span>
            </button>
            {expanded === "users" && (
              <div className="platform-user-list">
                {users.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[var(--text-dim)]">사용자가 없습니다</div>
                ) : (
                  users.map((u: any) => (
                    <Link
                      key={u.id}
                      href={`/platform/members?q=${encodeURIComponent(u.email || "")}`}
                      className="platform-user-row"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-[var(--text)] font-medium truncate">{u.name || "(이름 없음)"}</div>
                        <div className="text-[11px] text-[var(--text-dim)] truncate">{u.email || u.id}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="badge badge-muted">{u.role}</span>
                        {u.created_at && <span className="text-[10px] text-[var(--text-dim)]">{new Date(u.created_at).toLocaleDateString("ko-KR")}</span>}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            )}

            {/* 역할별 카운트 (기존 유지) */}
            {Object.entries(roleCounts).map(([role, count]) => (
              <div key={role} className="platform-role-count-row">
                <span className="text-sm text-[var(--text-dim)] capitalize">{role}</span>
                <span className="text-sm text-[var(--text-muted)]">{count as number}명</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plans */}
        <div className="platform-plans-card glass-card">
          <h3 className="section-title text-[var(--text)]">요금제</h3>
          <div className="space-y-3">
            {plans.length === 0 ? (
              <div className="text-center py-8 text-sm text-[var(--text-dim)]">요금제가 없습니다</div>
            ) : (
              plans.map((p: any) => (
                <div key={p.id} className="platform-plan-row">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-[var(--text)]">{p.name}</span>
                    <span className="text-sm font-bold mono-number text-[var(--primary)]">
                      ₩{(p.base_price || 0).toLocaleString()}/월
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-dim)]">
                    슬러그: {p.slug} · 좌석당 ₩{(p.per_seat_price || 0).toLocaleString()}/월
                    {p.max_deals && ` · 최대 프로젝트 ${p.max_deals}개`}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Environment */}
        <div className="platform-env-card glass-card">
          <h3 className="section-title text-[var(--text)]">환경 정보</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "프레임워크", value: "Next.js 16" },
              { label: "DB", value: "Supabase (PostgreSQL)" },
              { label: "호스팅", value: "Vercel" },
              { label: "도메인", value: "www.owner-view.com" },
            ].map((item) => (
              <div key={item.label} className="platform-env-item">
                <div className="text-[10px] text-[var(--text-dim)] mb-0.5">{item.label}</div>
                <div className="text-sm font-semibold text-[var(--text)]">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Release Log / 작업일지 */}
        <div className="platform-release-log-card glass-card">
          <h3 className="section-title text-[var(--text)]">작업일지 / 릴리즈 로그</h3>
          <div className="space-y-4 max-h-[600px] overflow-y-auto">
            {releaseLog.map((release: any, idx: number) => (
              <div key={idx} className="platform-release-item">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[var(--text)]">{release.version}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${release.type === 'hotfix' ? 'bg-[var(--danger-dim)] text-[var(--danger)]' : release.type === 'feature' ? 'bg-[var(--info-dim)] text-[var(--info)]' : 'bg-[var(--success-dim)] text-[var(--success)]'}`}>
                      {release.type === 'hotfix' ? '긴급수정' : release.type === 'feature' ? '기능추가' : 'QA/버그수정'}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--text-dim)]">{release.date}</span>
                </div>
                <p className="text-sm text-[var(--text-muted)] mb-2">{release.summary}</p>
                {release.items.length > 0 && (
                  <ul className="space-y-1">
                    {release.items.map((item: any, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
                        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.severity === 'critical' ? 'bg-[var(--danger)]' : item.severity === 'high' ? 'bg-[var(--warning)]' : item.severity === 'medium' ? 'bg-[var(--info)]' : 'bg-[var(--text-dim)]'}`} />
                        <span>{item.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Release Log Data (fallback) ──
const FALLBACK_RELEASES: { version: string; date: string; type: string; summary: string; items: { severity: string; text: string }[] }[] = [
  {
    version: "v2.4.0",
    date: "2026-03-12",
    type: "qa",
    summary: "전체 QA 및 버그 수정 (32건 수정, 4개 QA 에이전트 병렬 테스트)",
    items: [
      { severity: "critical", text: "leave_balances 타사 데이터 유출 — company_id 필터 추가" },
      { severity: "critical", text: "HR 계약서 변수 불일치 — 영문 템플릿 키 매핑 추가" },
      { severity: "critical", text: "데이터 동기화 크래시 — approval_request_id 컬럼 미존재 대응" },
      { severity: "critical", text: "deal_cost_schedule, getCashPulseData company_id 필터 누락" },
      { severity: "critical", text: "갱신 알림 조건 반전, SSR window.location 크래시" },
      { severity: "high", text: "fillVariables JSON 특수문자 이스케이프 처리" },
      { severity: "high", text: "거래처 문서 컬럼명 title→name, Vault 동적 Tailwind 수정" },
      { severity: "high", text: "회원가입 오류 시 대시보드 리다이렉트 방지" },
      { severity: "medium", text: "거래처/프로젝트/대출 상태 영문→한글 라벨 적용" },
      { severity: "medium", text: "일반 문서 서명 HR 테이블 오기록 수정" },
      { severity: "medium", text: "결재 단계(stages) DB 저장 누락 수정" },
      { severity: "medium", text: "사이드바 admin 역할 '관리자' 라벨 추가" },
      { severity: "low", text: "userId! non-null assertion 15+ 개소 안전 가드 추가" },
      { severity: "low", text: "모바일 결재 그리드, 미사용 XLSX import 제거" },
    ],
  },
  {
    version: "v2.3.0",
    date: "2026-03-11",
    type: "feature",
    summary: "현금 예산 엔진, 데이터 동기화, 전자서명/직인, 4대보험 EDI",
    items: [
      { severity: "high", text: "12개월 현금 예산 대시보드 + 일별 현금 흐름 예측" },
      { severity: "high", text: "원클릭 데이터 동기화 (계좌, 카드, 고정비, 매출)" },
      { severity: "medium", text: "전자서명 요청→발송→열람→서명 파이프라인" },
      { severity: "medium", text: "회사 직인 자동 적용 + 문서 잠금" },
      { severity: "medium", text: "4대보험 EDI 파일 자동 생성" },
      { severity: "low", text: "복식부기 원장 엔진 + 계정과목 23종" },
    ],
  },
  {
    version: "v2.2.0",
    date: "2026-03-10",
    type: "feature",
    summary: "프로젝트 파이프라인 자동화, 계약 갱신 알림, 견적 추적",
    items: [
      { severity: "high", text: "견적 승인 → 계약서 자동 생성 → 직인 → 서명 요청" },
      { severity: "medium", text: "계약 갱신 D-30/14/7 자동 알림" },
      { severity: "medium", text: "견적서 열람/승인 토큰 기반 추적" },
      { severity: "low", text: "카드 매입세액 자동 분류 엔진" },
    ],
  },
  {
    version: "v2.1.0",
    date: "2026-03-08",
    type: "feature",
    summary: "비밀번호 토글, 법률 페이지, 인증 UI 개선",
    items: [
      { severity: "medium", text: "로그인/회원가입 비밀번호 보기 토글" },
      { severity: "medium", text: "이용약관, 개인정보처리방침, 환불정책 페이지" },
      { severity: "low", text: "하단 탭바 모바일 네비게이션" },
    ],
  },
];
