'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { resetOnboardingDismiss } from '@/components/onboarding';

// ── Types ──
type CategoryTab = '전체' | '재무' | '영업' | 'HR' | '운영';

type GuideFeature = {
  id: string;
  icon: string;
  title: string;
  category: CategoryTab;
  description: string;
  route: string;
  keyFeatures: string[];
  tips?: string;
};

// ── Feature Data (14 features) ──
const FEATURES: GuideFeature[] = [
  {
    id: 'dashboard',
    icon: '📊',
    title: '대시보드',
    category: '재무',
    description:
      '회사의 생존지표 6-Pack(현금잔고, 번율, 런웨이, 매출채권, 매입채무, 미수금)을 실시간으로 모니터링합니다. AI 브리핑이 매일 아침 핵심 변동사항을 요약해 드리며, 승인 대기 항목도 한눈에 처리할 수 있습니다.',
    route: '/dashboard',
    keyFeatures: [
      '6-Pack 생존지표 카드 — 현금잔고, 번율, 런웨이, 매출채권, 매입채무, 미수금',
      'AI 데일리 브리핑 — 전일 대비 변동사항 자동 요약',
      '승인 대기함 — 결제/문서/휴가 승인을 대시보드에서 즉시 처리',
      '재무 드릴다운 — 매출/비용 항목 클릭 시 상세 내역 확인',
      '기간별 트렌드 차트 — 월별/분기별 추이 시각화',
    ],
    tips: '대시보드는 로그인 후 첫 화면입니다. 매일 아침 확인하면 회사 상태를 빠르게 파악할 수 있습니다.',
  },
  {
    id: 'deals',
    icon: '📋',
    title: '딜 파이프라인',
    category: '영업',
    description:
      '프로젝트와 거래(딜)를 생성하고, 진행 상태를 칸반보드/테이블/캘린더/간트차트 4가지 뷰로 관리합니다. 리드부터 성사까지 전 과정을 추적하며, 파이프라인 금액과 전환율을 실시간으로 확인할 수 있습니다.',
    route: '/deals',
    keyFeatures: [
      '4가지 뷰 — 칸반보드, 테이블, 캘린더, 간트차트',
      '드래그 앤 드롭 — 칸반에서 딜 상태를 직관적으로 변경',
      '파이프라인 대시보드 — 단계별 금액, 건수, 전환율 시각화',
      '마일스톤 추적 — 딜별 세부 단계와 진척도 관리',
      '거래처 연동 — 딜에서 바로 거래처/담당자 확인',
    ],
    tips: '칸반보드에서 카드를 드래그하면 딜 상태가 자동으로 변경됩니다.',
  },
  {
    id: 'tax-invoices',
    icon: '🧾',
    title: '세금계산서',
    category: '재무',
    description:
      '전자세금계산서를 발행하고, 수신한 계산서를 관리합니다. 홈택스 엑셀 파일을 임포트할 수 있으며, 세금계산서-발주서-입고증 간 3-Way 매칭으로 누락이나 불일치를 자동 검증합니다.',
    route: '/tax-invoices',
    keyFeatures: [
      '전자세금계산서 발행 — 거래처/품목/금액 입력, 세액 자동계산',
      '3-Way 매칭 — 세금계산서 + 발주서 + 입고증 자동 대사',
      '홈택스 임포트 — 엑셀 파일 업로드로 일괄 등록',
      '매입/매출 분류 — 탭으로 구분하여 관리',
      '부가세 신고 지원 — 기간별 합계 자동 집계',
    ],
    tips: '홈택스에서 다운받은 엑셀을 드래그 앤 드롭하면 한 번에 등록됩니다.',
  },
  {
    id: 'transactions',
    icon: '🏦',
    title: '거래내역',
    category: '재무',
    description:
      '법인 계좌의 입출금 거래내역을 조회하고, AI가 거래 내용을 분석하여 계정과목을 자동 분류합니다. 분류 결과를 검토하고 필요시 수동 수정할 수 있어 회계 처리 시간을 크게 줄여줍니다.',
    route: '/transactions',
    keyFeatures: [
      '거래내역 조회 — 기간별, 입금/출금 필터링',
      'AI 자동 분류 — 거래 내용 분석 후 계정과목 자동 매핑',
      '신뢰도 표시 — AI 분류 결과에 대한 확신도 퍼센트 제공',
      '수동 수정 — 미분류/오분류 항목을 직접 계정과목 지정',
      '분류 학습 — 수동 수정 내역을 AI가 학습하여 정확도 향상',
    ],
  },
  {
    id: 'employees',
    icon: '👥',
    title: '직원관리',
    category: 'HR',
    description:
      '직원 인사정보를 등록하고, 연봉 기준으로 4대보험과 소득세를 자동 계산하여 급여명세서를 생성합니다. 출퇴근 기록, 연차 관리, 초과근무 현황까지 HR 업무를 한곳에서 처리할 수 있습니다.',
    route: '/employees',
    keyFeatures: [
      '인사정보 관리 — 이름, 부서, 직급, 입사일, 연봉 등록',
      '급여 자동계산 — 4대보험(국민연금/건강/고용/산재) + 소득세 산출',
      '급여명세서 생성 — 기본급, 공제항목, 실수령액 자동 계산',
      '근태 관리 — 출퇴근 기록, 연차 잔여일, 초과근무 추적',
      '급여 배치 — 월급여 일괄 생성 및 승인 처리',
    ],
    tips: '연봉을 입력하면 실수령액이 즉시 계산되어 표시됩니다.',
  },
  {
    id: 'documents',
    icon: '📝',
    title: '문서관리',
    category: '운영',
    description:
      'PI(견적서), CI(상업송장), PL(포장명세), 계약서 등 비즈니스 문서를 템플릿 기반으로 빠르게 생성합니다. 문서 버전 관리(리비전)를 지원하여 수정 이력을 추적하고, 이전 버전과 비교할 수 있습니다.',
    route: '/documents',
    keyFeatures: [
      '문서 템플릿 — PI, CI, PL, 계약서 등 사전 정의된 양식',
      '버전 관리 — 문서 수정 시 리비전 자동 생성',
      '버전 비교 — 이전 버전과의 차이점 확인',
      '전자서명 연동 — 문서에서 바로 서명 요청 가능',
      '문서 검색 — 제목, 거래처, 날짜 등으로 빠른 검색',
    ],
  },
  {
    id: 'signatures',
    icon: '✍️',
    title: '전자서명',
    category: '운영',
    description:
      '계약서, 동의서 등 서명이 필요한 문서에 대해 전자서명을 요청하고 관리합니다. 서명 상태(대기/완료/거부)를 실시간으로 추적하며, 서명 완료 시 자동으로 알림을 받을 수 있습니다.',
    route: '/signatures',
    keyFeatures: [
      '서명 요청 — 이메일로 상대방에게 전자서명 요청',
      '서명 상태 추적 — 대기/진행/완료/거부 실시간 확인',
      '다중 서명자 — 순차 또는 동시 서명 설정',
      '서명 완료 알림 — 모든 서명 완료 시 자동 통보',
      '법적 효력 — 전자서명법 준수, 서명 이력 보관',
    ],
  },
  {
    id: 'partners',
    icon: '🏢',
    title: '거래처',
    category: '영업',
    description:
      '거래처(고객사, 공급사, 협력사)를 등록하고, 사업자등록번호/연락처/담당자 정보를 체계적으로 관리합니다. 거래처별 딜, 결제, 문서, 채팅 이력을 360도 뷰로 한곳에서 조회할 수 있습니다.',
    route: '/partners',
    keyFeatures: [
      '거래처 등록 — 사업자등록번호, 회사명, 연락처, 담당자',
      '파트너 초대 — 이메일로 거래처를 플랫폼에 초대',
      '360도 뷰 — 딜/결제/문서/채팅 이력 통합 조회',
      '거래처 분류 — 고객사/공급사/협력사 태그 관리',
      '거래 현황 — 거래처별 매출/매입 금액 요약',
    ],
  },
  {
    id: 'chat',
    icon: '💬',
    title: '채팅',
    category: '운영',
    description:
      '팀원 간 실시간 메시징을 지원합니다. 팀 채널, 프로젝트별 채널, 1:1 DM을 만들 수 있으며, @멘션으로 알림을 보내고, 채팅 내에서 결제 요청/문서 생성 등 액션카드를 바로 만들 수 있습니다.',
    route: '/chat',
    keyFeatures: [
      '채널 관리 — 팀 채널, 프로젝트 채널, DM 생성',
      '@멘션 알림 — 팀원을 멘션하면 즉시 알림 전달',
      '액션카드 — 채팅에서 바로 결제 요청/문서 생성',
      '딜 연동 채팅 — 딜별 전용 채팅방 자동 생성',
      '파일 공유 — 채팅 내 파일/이미지 첨부 및 미리보기',
    ],
  },
  {
    id: 'vault',
    icon: '🔒',
    title: 'Vault',
    category: '운영',
    description:
      'SaaS 구독 서비스를 등록하고 월별 비용/결제일/담당자를 관리합니다. 거래내역에서 반복 결제를 자동 탐지하여 미등록 구독을 발견하고, 회사 자산(노트북, 모니터 등)과 보안 문서(사업자등록증, 통장사본 등)도 한곳에서 관리합니다.',
    route: '/vault',
    keyFeatures: [
      '구독 관리 — SaaS 서비스별 비용, 결제일, 담당자 등록',
      '자동 탐지 — 거래내역에서 반복 결제 패턴 감지',
      '자산 관리 — 회사 장비/기기 등록 및 상태 추적',
      '보안 문서 금고 — 사업자등록증, 통장사본 등 안전 보관',
      '만료일 알림 — 문서/구독 만료 전 자동 알림',
    ],
  },
  {
    id: 'loans',
    icon: '🏛️',
    title: '대출',
    category: '재무',
    description:
      '법인 대출 현황을 등록하고, 상환 일정/이자율/잔액을 한눈에 관리합니다. 대출별 상환 스케줄을 자동 생성하며, 상환일 도래 시 알림을 받을 수 있어 연체를 방지합니다.',
    route: '/loans',
    keyFeatures: [
      '대출 등록 — 금융기관, 대출금, 이자율, 만기일 입력',
      '상환 스케줄 — 원리금/원금균등 상환 일정 자동 생성',
      '상환 추적 — 납입 현황, 잔여 원금 실시간 확인',
      '상환일 알림 — 상환 예정일 전 자동 알림',
      '대출 현황 요약 — 전체 대출 잔액, 월 상환액 대시보드',
    ],
  },
  {
    id: 'matching',
    icon: '🔍',
    title: '매칭',
    category: '재무',
    description:
      '세금계산서와 거래내역(입출금)을 AI가 자동 매칭하여 대사(reconciliation) 작업을 처리합니다. 매칭 신뢰도를 표시하고, 낮은 신뢰도 항목은 수동 매칭으로 직접 연결할 수 있습니다.',
    route: '/matching',
    keyFeatures: [
      'AI 자동 매칭 — 세금계산서와 거래내역 자동 대사',
      '신뢰도 표시 — 매칭별 확신도 퍼센트 제공',
      '수동 매칭 — 미매칭/저신뢰 항목을 직접 연결',
      '매칭 현황 — 매칭 완료/미매칭/확인 필요 건수 요약',
      '미수금 관리 — 매칭되지 않은 매출 계산서로 미수금 추적',
    ],
  },
  {
    id: 'reports',
    icon: '📈',
    title: 'P&L / B/S',
    category: '재무',
    description:
      '손익계산서(P&L)와 재무상태표(B/S)를 자동 생성합니다. 거래내역과 계정과목 분류를 기반으로 기간별 재무제표를 실시간 확인할 수 있으며, 전기 대비 비교와 항목별 드릴다운을 지원합니다.',
    route: '/reports',
    keyFeatures: [
      '손익계산서 — 매출/비용/영업이익/당기순이익 자동 산출',
      '재무상태표 — 자산/부채/자본 현황 자동 집계',
      '기간 비교 — 전월/전분기/전년 대비 증감 분석',
      '항목 드릴다운 — 계정과목 클릭 시 상세 거래 내역 확인',
      'PDF 내보내기 — 재무제표를 PDF로 다운로드',
    ],
    tips: '거래내역의 계정과목 분류가 정확할수록 재무제표도 정확해집니다.',
  },
  {
    id: 'settings',
    icon: '⚙️',
    title: '설정',
    category: '운영',
    description:
      '회사 기본 정보(상호, 사업자등록번호, 주소)를 설정하고, 결제에 사용할 은행 계좌를 관리합니다. 팀원 초대와 역할 부여, 알림 설정, 보안 설정 등 서비스 전반의 환경을 구성합니다.',
    route: '/settings',
    keyFeatures: [
      '회사 정보 — 상호, 사업자등록번호, 대표자, 주소 설정',
      '계좌 관리 — 결제용 은행 계좌 등록/수정/삭제',
      '팀원 초대 — 이메일로 초대, 관리자/직원/파트너 역할 부여',
      '알림 설정 — 이메일/인앱 알림 항목별 on/off',
      '보안 설정 — 비밀번호 변경, 2단계 인증 등',
    ],
  },
];

const CATEGORY_TABS: CategoryTab[] = ['전체', '재무', '영업', 'HR', '운영'];

const CATEGORY_TAB_ICONS: Record<CategoryTab, string> = {
  '전체': '🏠',
  '재무': '💰',
  '영업': '📊',
  'HR': '👥',
  '운영': '⚙️',
};

const CATEGORY_TAB_COUNTS: Record<CategoryTab, number> = FEATURES.reduce(
  (acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  },
  { '전체': FEATURES.length, '재무': 0, '영업': 0, 'HR': 0, '운영': 0 } as Record<CategoryTab, number>,
);

// ── Accordion Card Component ──
function FeatureCard({
  feature,
  isExpanded,
  onToggle,
}: {
  feature: GuideFeature;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        border: `1px solid ${isExpanded ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: '12px',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        boxShadow: isExpanded ? '0 4px 12px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* Header — always visible */}
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px 20px',
          textAlign: 'left',
          cursor: 'pointer',
          background: 'none',
          border: 'none',
          color: 'var(--text)',
        }}
        aria-expanded={isExpanded}
      >
        <span
          style={{
            fontSize: '24px',
            lineHeight: '1.2',
            flexShrink: 0,
            marginTop: '2px',
          }}
        >
          {feature.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <h3
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: 'var(--text)',
                margin: 0,
              }}
            >
              {feature.title}
            </h3>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 500,
                padding: '2px 8px',
                borderRadius: '9999px',
                backgroundColor: 'var(--primary-light, #EFF6FF)',
                color: 'var(--primary)',
              }}
            >
              {feature.category}
            </span>
          </div>
          <p
            style={{
              fontSize: '13px',
              color: 'var(--text-muted)',
              margin: 0,
              lineHeight: 1.6,
              display: isExpanded ? 'block' : '-webkit-box',
              WebkitLineClamp: isExpanded ? undefined : 2,
              WebkitBoxOrient: isExpanded ? undefined : 'vertical',
              overflow: isExpanded ? 'visible' : 'hidden',
            }}
          >
            {feature.description}
          </p>
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            marginTop: '4px',
            transition: 'transform 0.2s ease',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expandable content */}
      <div
        style={{
          maxHeight: isExpanded ? '600px' : '0px',
          overflow: 'hidden',
          transition: 'max-height 0.3s ease',
        }}
      >
        <div
          style={{
            padding: '0 20px 20px 56px',
          }}
        >
          {/* Key Features */}
          <div style={{ marginBottom: '16px' }}>
            <h4
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '10px',
              }}
            >
              핵심 기능
            </h4>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {feature.keyFeatures.map((kf, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    fontSize: '13px',
                    color: 'var(--text)',
                    lineHeight: 1.5,
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0, marginTop: '2px' }}
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{kf}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Tip */}
          {feature.tips && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: 'var(--primary-light, #EFF6FF)',
                marginBottom: '16px',
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0, marginTop: '1px' }}
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              <p style={{ fontSize: '12px', color: 'var(--primary)', margin: 0, lineHeight: 1.5 }}>
                {feature.tips}
              </p>
            </div>
          )}

          {/* Action Link */}
          <Link
            href={feature.route}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#FFFFFF',
              backgroundColor: 'var(--primary)',
              borderRadius: '8px',
              textDecoration: 'none',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary-hover, #1D4ED8)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary)';
            }}
          >
            {feature.title} 시작하기
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════
export default function GuidePage() {
  const [activeTab, setActiveTab] = useState<CategoryTab>('전체');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedIds(new Set(FEATURES.map((f) => f.id)));
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  const filteredFeatures = useMemo(() => {
    let result = FEATURES;

    if (activeTab !== '전체') {
      result = result.filter((f) => f.category === activeTab);
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter(
        (f) =>
          f.title.toLowerCase().includes(query) ||
          f.description.toLowerCase().includes(query) ||
          f.keyFeatures.some((kf) => kf.toLowerCase().includes(query)),
      );
    }

    return result;
  }, [activeTab, searchQuery]);

  const isAllExpanded = filteredFeatures.length > 0 && filteredFeatures.every((f) => expandedIds.has(f.id));

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg)',
      }}
    >
      <div
        style={{
          maxWidth: '860px',
          margin: '0 auto',
          padding: '32px 16px 64px',
        }}
      >
        {/* ── Header ── */}
        <div style={{ marginBottom: '28px' }}>
          <h1
            style={{
              fontSize: '22px',
              fontWeight: 800,
              color: 'var(--text)',
              margin: '0 0 4px',
            }}
          >
            사용 가이드
          </h1>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-muted)',
              margin: 0,
            }}
          >
            OwnerView의 모든 기능을 확인하고 빠르게 시작하세요. 총 {FEATURES.length}개 기능을 제공합니다.
          </p>
        </div>

        {/* ── Onboarding Reset ── */}
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', margin: '0 0 2px' }}>
              초기 설정 다시 하기
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              회사 정보, 통장, 카드, 직원 등 초기 설정을 다시 시작합니다.
            </p>
          </div>
          <button
            onClick={() => {
              resetOnboardingDismiss();
              window.location.href = '/dashboard';
            }}
            style={{
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: 'var(--primary)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            온보딩 다시 시작
          </button>
        </div>

        {/* ── Search ── */}
        <div style={{ position: 'relative', marginBottom: '16px' }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="기능명, 설명, 핵심 기능 키워드로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="기능 검색"
            style={{
              width: '100%',
              paddingLeft: '38px',
              paddingRight: '16px',
              paddingTop: '10px',
              paddingBottom: '10px',
              fontSize: '13px',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--primary)';
              e.currentTarget.style.boxShadow = '0 0 0 3px var(--primary-light, rgba(37,99,235,0.1))';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
        </div>

        {/* ── Category Tabs ── */}
        <div
          style={{
            display: 'flex',
            gap: '6px',
            marginBottom: '16px',
            overflowX: 'auto',
            paddingBottom: '4px',
          }}
          role="tablist"
          aria-label="기능 카테고리"
        >
          {CATEGORY_TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                role="tab"
                aria-selected={isActive}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#FFFFFF' : 'var(--text-muted)',
                  backgroundColor: isActive ? 'var(--primary)' : 'var(--bg-card)',
                  border: `1px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: '14px' }}>{CATEGORY_TAB_ICONS[tab]}</span>
                {tab}
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: '9999px',
                    backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : 'var(--bg)',
                    color: isActive ? '#FFFFFF' : 'var(--text-muted)',
                  }}
                >
                  {CATEGORY_TAB_COUNTS[tab]}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Expand/Collapse Controls ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px',
          }}
        >
          <p
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              margin: 0,
            }}
          >
            {filteredFeatures.length}개 기능
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={isAllExpanded ? collapseAll : expandAll}
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--primary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '6px',
              }}
            >
              {isAllExpanded ? '모두 접기' : '모두 펼치기'}
            </button>
          </div>
        </div>

        {/* ── Feature Cards ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {filteredFeatures.map((feature) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              isExpanded={expandedIds.has(feature.id)}
              onToggle={() => toggleExpand(feature.id)}
            />
          ))}
        </div>

        {/* ── Empty State ── */}
        {filteredFeatures.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '64px 16px',
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</div>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 4px' }}>
              검색 결과가 없습니다
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              다른 키워드로 검색하거나 카테고리 탭을 변경해 보세요.
            </p>
          </div>
        )}

        {/* ── Quick Links Footer ── */}
        <div
          style={{
            marginTop: '40px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '20px',
          }}
        >
          <h3
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: 'var(--text)',
              margin: '0 0 12px',
            }}
          >
            바로가기
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '8px',
            }}
          >
            {FEATURES.map((f) => (
              <Link
                key={f.id}
                href={f.route}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--text)',
                  textDecoration: 'none',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  transition: 'border-color 0.15s ease, background-color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.backgroundColor = 'var(--primary-light, #EFF6FF)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <span style={{ fontSize: '16px' }}>{f.icon}</span>
                {f.title}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
