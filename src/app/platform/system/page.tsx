"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

export default function SystemPage() {
  const { data: companies = [] } = useQuery({
    queryKey: ["p-sys-companies"],
    queryFn: async () => {
      const { data } = await db.from("companies").select("id");
      return data || [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["p-sys-users"],
    queryFn: async () => {
      const { data } = await db.from("users").select("id, role, created_at").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["p-sys-plans"],
    queryFn: async () => {
      const { data } = await db.from("subscription_plans").select("*").order("base_price", { ascending: true });
      return data || [];
    },
  });

  // DB에서 릴리스 노트 조회 (없으면 기본값 사용)
  const { data: releaseLog = FALLBACK_RELEASES } = useQuery({
    queryKey: ["release-notes"],
    queryFn: async () => {
      const { data } = await db
        .from('release_notes')
        .select('version, date, title, changes')
        .order('date', { ascending: false })
        .limit(20);
      if (data && data.length > 0) return data;
      return FALLBACK_RELEASES;
    },
  });

  const roleCounts = users.reduce((acc: Record<string, number>, u: any) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-white">시스템 현황</h1>
        <p className="text-sm text-[#64748b] mt-1">플랫폼 리소스 및 요금제 설정</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* DB Stats */}
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6">
          <h3 className="font-bold text-white mb-4">데이터베이스</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#0b0f1a]">
              <span className="text-sm text-[#94a3b8]">총 회사</span>
              <span className="font-bold text-white">{companies.length}</span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#0b0f1a]">
              <span className="text-sm text-[#94a3b8]">총 사용자</span>
              <span className="font-bold text-white">{users.length}</span>
            </div>
            {Object.entries(roleCounts).map(([role, count]) => (
              <div key={role} className="flex justify-between items-center p-3 rounded-xl bg-[#0b0f1a]">
                <span className="text-sm text-[#64748b]">  {role}</span>
                <span className="text-sm text-[#94a3b8]">{count as number}명</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plans */}
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6">
          <h3 className="font-bold text-white mb-4">요금제</h3>
          <div className="space-y-3">
            {plans.length === 0 ? (
              <div className="text-center py-8 text-sm text-[#64748b]">요금제가 없습니다</div>
            ) : (
              plans.map((p: any) => (
                <div key={p.id} className="p-4 rounded-xl bg-[#0b0f1a] border border-[#1e293b]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white">{p.name}</span>
                    <span className="text-sm font-bold text-blue-400">
                      ₩{(p.base_price || 0).toLocaleString()}/월
                    </span>
                  </div>
                  <div className="text-xs text-[#64748b]">
                    슬러그: {p.slug} · 좌석당 ₩{(p.per_seat_price || 0).toLocaleString()}/월
                    {p.max_deals && ` · 최대 딜 ${p.max_deals}개`}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Environment */}
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6 md:col-span-2">
          <h3 className="font-bold text-white mb-4">환경 정보</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "프레임워크", value: "Next.js 16" },
              { label: "DB", value: "Supabase (PostgreSQL)" },
              { label: "호스팅", value: "GitHub Pages" },
              { label: "도메인", value: "www.owner-view.com" },
            ].map((item) => (
              <div key={item.label} className="p-3 rounded-xl bg-[#0b0f1a]">
                <div className="text-[10px] text-[#64748b] mb-0.5">{item.label}</div>
                <div className="text-sm font-semibold text-white">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Release Log / 작업일지 */}
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6 md:col-span-2">
          <h3 className="font-bold text-white mb-4">작업일지 / 릴리즈 로그</h3>
          <div className="space-y-4 max-h-[600px] overflow-y-auto">
            {releaseLog.map((release: any, idx: number) => (
              <div key={idx} className="p-4 rounded-xl bg-[#0b0f1a] border border-[#1e293b]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{release.version}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${release.type === 'hotfix' ? 'bg-red-500/10 text-red-400' : release.type === 'feature' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                      {release.type === 'hotfix' ? '긴급수정' : release.type === 'feature' ? '기능추가' : 'QA/버그수정'}
                    </span>
                  </div>
                  <span className="text-xs text-[#64748b]">{release.date}</span>
                </div>
                <p className="text-sm text-[#94a3b8] mb-2">{release.summary}</p>
                {release.items.length > 0 && (
                  <ul className="space-y-1">
                    {release.items.map((item: any, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[#64748b]">
                        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.severity === 'critical' ? 'bg-red-400' : item.severity === 'high' ? 'bg-orange-400' : item.severity === 'medium' ? 'bg-yellow-400' : 'bg-gray-400'}`} />
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
      { severity: "medium", text: "거래처/딜/대출 상태 영문→한글 라벨 적용" },
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
    summary: "딜 파이프라인 자동화, 계약 갱신 알림, 견적 추적",
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
