'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Ico, icoColor } from "@/components/ui-icon";
import Link from 'next/link';
import { resetOnboardingDismiss } from '@/components/onboarding';
import { useMyPermissions, matchCatalogRoute } from '@/lib/permissions';
import { QueryScreen, QueryHead, QueryBody, QueryBar } from "@/components/query-kit";

// 접근 판정 — 앱 게이트와 같은 기준 (2026-08-12 사장님: 직원은 권한에 맞게).
//   쿼리를 떼고 카탈로그 최장 접두 매치; 카탈로그 밖 경로(/onboarding·/mypage 등)는 게이트 비대상 → 통과.
const canReach = (route: string, hasMenu: (r: string) => boolean) => {
  const key = matchCatalogRoute(route.split('?')[0]);
  return !key || hasMenu(key);
};

// ── Types ──
type CategoryTab = '전체' | '재무' | '재고' | '영업' | 'HR' | '운영';

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

// ── Feature Data · 현재 사이드바 메뉴 기준 (2026-09-03 전면 최신화: 재고 그룹·고정자산·세무 신고·
//    지원사업추천·파일보관함·프로젝트 v3·설정 5그룹 반영. 메뉴·기능이 바뀌면 여기도 갱신) ──
const FEATURES: GuideFeature[] = [
  
  {
    id: 'dashboard',
    icon: '📊',
    title: '대시보드',
    category: '재무',
    description:
      '재무 지표와 오늘 할 일을 한 화면에서 봅니다. 위젯은 권한에 맞게 보입니다.',
    route: '/dashboard',
    keyFeatures: [
      '재무 위젯 · 잔액과 매출 현황',
      '오늘 할 일·캘린더 · 일정 화면과 연동',
      '출근 체크 · 바로 출퇴근 기록',
      '승인 대기 · 내가 처리할 결재 확인',
      '권한별 표시 · 금액은 권한자에게만',
    ],
    tips: '재무 위젯이 안 보이면 마스터에게 권한을 요청하세요.',
  },
  {
    id: 'copilot',
    icon: '🤖',
    title: 'AI 참모',
    category: '운영',
    description:
      '회사 데이터를 아는 AI 참모에게 경영 현황을 물어봅니다.',
    route: '/copilot',
    keyFeatures: [
      '데이터 기반 답변 · 회사 현황을 근거로 답변',
      '스스로 조회 · 필요한 데이터를 직접 찾아 답변',
      '경영 질문 · 자유로운 질문에 바로 응답',
      '계약서 초안 · 첨부 문서로 초안 생성',
      '읽기 전용 · 회사 데이터를 바꾸지 않음',
    ],
    tips: '구체적으로 물을수록 좋은 답이 나옵니다.',
  },
  {
    id: 'support-programs',
    icon: '🎁',
    title: '지원사업추천',
    category: '운영',
    description:
      '우리 회사가 받을 수 있는 정부 지원사업만 골라 추천합니다.',
    route: '/support-programs',
    keyFeatures: [
      '맞춤 추천 · 회사 정보로 자격 자동 판정',
      '예상 수령액 · 받을 수 있는 금액 계산',
      '대표·관리자 전용 · 권한자만 접근',
    ],
  },
  {
    id: 'inventory',
    icon: '📦',
    title: '재고',
    category: '재고',
    description:
      '품목과 창고, 주문, 판매·구매·생산까지 재고 흐름을 관리합니다.',
    route: '/inventory/products',
    keyFeatures: [
      '품목 · 규격과 단가 등록',
      '창고관리 · 현재고와 입출고 조정',
      '주문 · 주문서와 견적 관리',
      '판매·구매·생산 · 주문을 불러와 재고 이동',
      '이커머스 · 온라인 주문 수집과 출고',
      '현황·이익관리 · 집계와 품목별 이익률',
    ],
    tips: '재고는 판매·구매·생산 처리 때 움직입니다.',
  },
  {
    id: 'partners',
    icon: '🏢',
    title: '거래처',
    category: '영업',
    description:
      '고객사와 공급사를 등록하고 거래처별 매출·매입을 봅니다.',
    route: '/partners',
    keyFeatures: [
      '거래처 등록 · 사업자번호 자동 검증',
      '거래처 원장 · 거래처별 매출·매입·잔액',
      '연동 활용 · 프로젝트와 전표에서 재사용',
    ],
  },
  {
    id: 'tax-invoices',
    icon: '🧾',
    title: '세금·증빙',
    category: '재무',
    description:
      '세금계산서 수집과 발행, 현금영수증까지 세무 증빙을 한곳에서 처리합니다.',
    route: '/tax-invoices',
    keyFeatures: [
      '홈택스 자동 수집 · 매출·매입 세금계산서 수집',
      '세금계산서 발행 · 작성과 발행 대기함 관리',
      '전자계산서·현금영수증 · 발행과 내역 관리',
      '발행 알림 메일 · 발행 완료 시 자동 통보',
      '부가세 집계 · 분석 메뉴의 부가세에서 확인',
    ],
    tips: '설정의 연동·API 키에서 공동인증서를 등록하면 자동 수집이 시작됩니다.',
  },
  {
    id: 'collect',
    icon: '📥',
    title: '수집·전표',
    category: '재무',
    description:
      '통장·카드·홈택스 거래를 모아 전표로 확정합니다. 재무제표는 확정한 전표만 반영합니다.',
    route: '/collect',
    keyFeatures: [
      '수집 · 통장·카드·홈택스 자료를 한곳에서',
      '자동 분류 · 계정과목과 부가세 구분 자동 매핑',
      '전표 만들기 · 거래를 분개로 확정',
      '거래 매칭 · 세금계산서와 입금 연결',
      '자동분개 규칙 · 반복 거래 자동 처리',
      '수기 기장 · 수집 밖 거래 직접 입력',
      '전표 취소 · 잘못 만든 전표 되돌리기',
    ],
    tips: '전표를 확정해야 재무제표에 반영됩니다.',
  },
  {
    id: 'assets',
    icon: '🏗️',
    title: '고정자산',
    category: '재무',
    description:
      '고정자산을 등록하면 매달 감가상각 전표 초안이 만들어집니다.',
    route: '/finance/assets',
    keyFeatures: [
      '자산 등록 · 취득가와 내용연수 관리',
      '감가상각 · 월별 상각 전표 초안 자동 생성',
      '장부 연계 · 확정한 전표가 재무제표에 반영',
    ],
  },
  {
    id: 'tax-filing',
    icon: '🧮',
    title: '세무 신고',
    category: '재무',
    description:
      '원천세·부가세 신고서를 완성해 홈택스 제출만 남깁니다.',
    route: '/finance/tax-filing',
    keyFeatures: [
      '원천세 · 급여 데이터 기반 신고서 작성',
      '부가세 · 매출·매입 증빙 집계로 신고서 완성',
      '홈택스 제출 · 완성본을 옮겨 직접 제출',
    ],
  },
  {
    id: 'reports',
    icon: '📈',
    title: '분석',
    category: '재무',
    description:
      '경영 요약부터 손익, 자금 전망, 부가세까지 회사 재무를 분석합니다.',
    route: '/reports/summary',
    keyFeatures: [
      '경영 요약 · 회사 재무 핵심 지표를 한 화면에',
      '손익 현황 · 월·분기 매출·비용 추이',
      '자금 전망 · 예정 지출과 자금 흐름 시나리오',
      '회계 자료 · 손익계산서·재무상태표와 원장',
      '거래처 원장·부가세 · 거래처별 장부와 신고용 부가세 집계',
    ],
    tips: '거래 장부의 계정과목 분류가 정확할수록 분석도 정확해집니다.',
  },
  {
    id: 'bank',
    icon: '🏦',
    title: '통장·카드·정기 지출',
    category: '재무',
    description:
      '법인 통장 잔액과 카드 승인내역, 정기 지출을 한곳에서 관리합니다.',
    route: '/bank',
    keyFeatures: [
      '통장 · 계좌와 잔액 통합 조회',
      '카드 · 법인카드 승인내역 자동 수집',
      '정기 지출 · 매달 나가는 구독·고정비 관리',
      '자동 갱신 · 인증서 연동 시 자동 최신화',
    ],
  },
  {
    id: 'projecthub',
    icon: '📁',
    title: '프로젝트',
    category: '영업',
    description:
      '견적부터 계약, 세금계산서, 입금까지 프로젝트별 손익과 미수금을 관리합니다.',
    route: '/projecthub',
    keyFeatures: [
      '견적·계약·서명 · 견적서부터 전자서명까지 연결',
      '거래처 왕복 · 수정 요청 확인 후 재발송',
      '판매전표 자동 발행 · 양측 서명 시 자동 기장',
      '증빙 연결 · 통장·카드·전표를 프로젝트에 연결',
      '손익·미수금 · 마진 집계와 미입금 추적',
      '열람 권한 · 담당만 또는 전체 열람 구분',
    ],
    tips: '지출 항목은 "장부에 이어 두기"로 지출결의 상신까지 연결됩니다.',
  },
  {
    id: 'approvals',
    icon: '✅',
    title: '결재 허브',
    category: '운영',
    description:
      '지출결의서와 휴가 신청 같은 사내 결재를 전자로 처리합니다.',
    route: '/approvals',
    keyFeatures: [
      '새 요청 · 회사 양식으로 작성',
      '내 결재함 · 내가 승인할 문서 처리',
      '결재 정책 · 유형·금액별 결재선 설정',
      '메일 알림 · 승인 차례인 사람에게 자동 발송',
      '전체 현황·참조 · 진행 상황 추적과 참조자 공유',
      'PDF 저장 · 결재 문서를 PDF로 보관',
    ],
    tips: '양식 관리 탭에서 우리 회사 결재 양식을 직접 만들 수 있습니다.',
  },
  {
    id: 'schedule',
    icon: '📅',
    title: '일정 / 할 일',
    category: '운영',
    description:
      '회사와 개인의 일정과 할 일을 캘린더에서 관리합니다.',
    route: '/schedule',
    keyFeatures: [
      '캘린더 · 월/주 단위 일정 관리',
      '할 일 · 담당자·기한이 있는 업무 관리',
      '대시보드 연동 · 오늘 일정·할 일이 대시보드에 표시',
    ],
  },
  {
    id: 'chat',
    icon: '💬',
    title: '메신저·게시판',
    category: '운영',
    description:
      '메신저와 게시판, 공지사항으로 사내 소통을 처리합니다.',
    route: '/chat',
    keyFeatures: [
      '메신저 · 팀원과 실시간 대화, 파일 공유',
      '게시판 · 자유로운 사내 글·자료 공유',
      '공지사항 · 전 구성원 대상 공지',
    ],
  },
  {
    id: 'documents',
    icon: '📂',
    title: '파일보관함',
    category: '운영',
    description:
      '회사 문서와 파일을 폴더로 정리해 보관합니다.',
    route: '/documents',
    keyFeatures: [
      '파일 보관 · 폴더 구조로 회사 문서 정리',
      '전자계약 연계 · 서명 완료 문서를 보관함에서 관리',
      '안전한 삭제 · 내 파일만 삭제',
    ],
  },
  {
    id: 'team',
    icon: '📇',
    title: '구성원 디렉토리',
    category: '운영',
    description:
      '전 구성원이 보는 사내 주소록입니다. 연봉 같은 인사 정보는 보이지 않습니다.',
    route: '/team',
    keyFeatures: [
      '주소록 · 이름·부서·직급·연락처 조회',
      '전원 제공 · 별도 권한 없이 모든 구성원이 사용',
    ],
  },
  {
    id: 'signatures',
    icon: '✍️',
    title: '전자계약',
    category: '운영',
    description:
      '계약서를 링크로 보내고 전자서명을 받습니다.',
    route: '/signatures',
    keyFeatures: [
      '서명 요청 · 이메일이나 링크로 요청',
      '상태 추적 · 대기·완료 실시간 확인',
      '직인 관리 · 회사 직인 등록 후 문서에 날인',
      '문서 보관 · 완료 문서를 파일보관함에서 관리',
      '내 서명 요청 · 내가 서명할 문서 확인',
    ],
  },
  {
    id: 'hr-templates',
    icon: '📄',
    title: '근로계약·서식',
    category: 'HR',
    description:
      '근로계약서와 회사 서식을 템플릿으로 관리하고 전자서명으로 체결합니다.',
    route: '/hr-templates',
    keyFeatures: [
      '템플릿 관리 · 반복 사용 서식 등록',
      'PDF 원본 보존 · 기존 양식을 그대로 재사용',
      '변수 치환 · 성명과 입사일 자동 채움',
      '전자서명 연계 · 완성 문서 바로 서명 요청',
    ],
  },
  {
    id: 'employees',
    icon: '👥',
    title: '구성원',
    category: 'HR',
    description:
      '인사정보부터 급여, 휴가, 증명서, 권한까지 구성원을 관리합니다.',
    route: '/employees',
    keyFeatures: [
      '인사정보 · 부서·직급·입사일·연봉 관리',
      '초대·합류 · 이메일 초대와 가입 승인',
      '급여 · 급여명세서 생성과 발송',
      '휴가 관리 · 연차 자동 부여와 잔여 추적',
      '증명서 발급 · 재직증명서 등 발급',
      '권한 부여 · 구성원별 메뉴 권한 지정',
    ],
    tips: '직원은 마이페이지에서 출퇴근·연차·급여명세서를 봅니다.',
  },
  {
    id: 'attendance',
    icon: '⏰',
    title: '근태 관리',
    category: 'HR',
    description:
      '전 직원의 출퇴근을 한눈에 보고 근무시간을 자동 산정해 급여에 반영합니다.',
    route: '/attendance',
    keyFeatures: [
      '워크보드 · 오늘 전 직원 출퇴근 현황 한눈에',
      '기록 상세·수정 · 일자별 기록 확인과 관리자 정정',
      '자동 산정 · 지각·연장·야간·휴일 근무 계산',
      '가산수당 · 수당 자동 계산과 급여 반영',
      '근태 설정 · 출퇴근 기준 시간 설정',
    ],
  },
  {
    id: 'settings',
    icon: '⚙️',
    title: '회사 설정·요금제',
    category: '운영',
    description:
      '회사 정보, 회계, 연동, 보안과 요금제를 설정합니다.',
    route: '/settings/company',
    keyFeatures: [
      '회사 기초정보 · 사업자 정보와 직인, 양식',
      '구성원·초대 · 부서와 계정 초대 관리',
      '회계·세무 · 통장, 계정과목, 회계마감, 세무 파트너',
      '연동·API 키 · 공동인증서 등록과 자동 수집',
      '보안·시스템 · 접속 보안 등 시스템 설정',
      '요금제 · 구독 플랜과 결제 관리',
    ],
    tips: '자동화는 공동인증서 등록에서 시작합니다.',
  },
];

const CATEGORY_TABS: CategoryTab[] = ['전체', '재무', '재고', '영업', 'HR', '운영'];

const CATEGORY_TAB_ICONS: Record<CategoryTab, string> = {
  '전체': '🏠',
  '재무': '💰',
  '재고': '📦',
  '영업': '📊',
  'HR': '👥',
  '운영': '⚙️',
};


// ── 기능 카드 (2026-08-12 리디자인 · 사장님: "조잡하고 레이아웃 안 맞음") ──
//   인라인 스타일 → gd- 시맨틱 클래스, 세로 나열 → 2열 그리드, 펼침은 grid-rows 트랜지션.
//   확장 시 카드가 그리드 전체 폭으로 커지며 핵심 기능이 2열로 배치된다.
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
    <div className={`gd-card ${isExpanded ? "gd-card-open" : ""}`} data-gd>
      <button onClick={onToggle} aria-expanded={isExpanded} className="gd-card-head">
        <span className="gd-card-ico" style={{ background: `${icoColor(feature.icon)}1a` }}>
          <Ico e={feature.icon} tone="color" />
        </span>
        <span className="gd-card-titles">
          <span className="gd-card-title-row">
            <span className="gd-card-title">{feature.title}</span>
            <span className="gd-card-chip">{feature.category}</span>
          </span>
          <span className={`gd-card-desc ${isExpanded ? "" : "gd-clamp2"}`}>{feature.description}</span>
        </span>
        <svg className={`gd-caret ${isExpanded ? "gd-caret-open" : ""}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      <div className="gd-card-body">
        <div className="gd-card-body-inner">
          <div className="gd-sec-label">핵심 기능</div>
          <ul className="gd-kf-grid">
            {feature.keyFeatures.map((kf, i) => (
              <li key={i} className="gd-kf">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                <span>{kf}</span>
              </li>
            ))}
          </ul>
          {feature.tips && (
            <div className="gd-tip">
              <span className="gd-tip-badge">TIP</span>
              <span>{feature.tips}</span>
            </div>
          )}
          <Link href={feature.route} className="gd-go">
            바로 가보기
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step-by-Step Workflow Guides
// ═══════════════════════════════════════════

type WorkflowStep = { title: string; description: string; route?: string };
type Workflow = { id: string; icon: string; title: string; description: string; steps: WorkflowStep[] };

// 현재 화면·설정 그룹 기준 (2026-09-03 최신화: 설정 5그룹 라우트·프로젝트 v3 체인·재고 흐름 · 메뉴/흐름이 바뀌면 여기도 갱신)
const WORKFLOWS: Workflow[] = [
  
  {
    id: 'getting-started',
    icon: '🚀',
    title: '시작하기 · 회사 설정',
    description: '가입 후 첫 설정을 10분 안에 마칩니다.',
    steps: [
      { title: '회원가입', description: '이메일로 가입하고 사업자등록번호를 입력합니다.' },
      { title: '온보딩 마법사', description: '회사 정보와 인증서 연동을 마치면 대시보드로 이동합니다.', route: '/onboarding' },
      { title: '회사 정보 확인', description: '회사 기초정보에서 사업자 정보와 주소를 확인합니다.', route: '/settings/company' },
      { title: '통장 등록', description: '자금·통장에서 법인 계좌를 등록하고 용도를 지정합니다.', route: '/settings/finance' },
      { title: '거래처 등록', description: '거래처 메뉴에서 첫 고객사나 공급사를 추가합니다.', route: '/partners' },
      { title: '대시보드 확인', description: '대시보드에서 잔액과 오늘 할 일을 확인합니다.', route: '/dashboard' },
    ],
  },
  {
    id: 'codef-cert',
    icon: '🔐',
    title: '공동인증서 등록 · 자동화의 시작',
    description: '공동인증서를 등록하면 은행·카드·홈택스 자료가 자동으로 들어옵니다.',
    steps: [
      { title: '설정 → 연동·API 키', description: '연동·API 키의 은행연동에서 등록을 시작합니다.', route: '/settings/integration' },
      { title: '인증서 불러오기', description: '저장된 공동인증서를 불러오거나 인증서 파일을 올립니다.' },
      { title: '비밀번호 입력', description: '인증서 비밀번호를 입력합니다. 금융 조회에만 사용됩니다.' },
      { title: '연결 확인', description: '연결됨 상태가 되면 자동 수집이 시작됩니다.' },
    ],
  },
  {
    id: 'bank-card',
    icon: '🏦',
    title: '수집 → 전표 → 재무제표',
    description: '수집된 거래를 전표로 확정하면 재무제표까지 이어집니다.',
    steps: [
      { title: '인증서 등록 (선행)', description: '공동인증서 등록 가이드를 먼저 마칩니다.', route: '/settings/integration' },
      { title: '수집 확인', description: '수집·전표에서 자동으로 쌓인 자료를 확인합니다.', route: '/collect' },
      { title: '전표 만들기', description: '수집된 거래를 계정과목 분개로 확정합니다.', route: '/collect' },
      { title: '수기 거래 입력', description: '현금처럼 수집 밖 거래는 전표입력에서 직접 기록합니다.', route: '/partners/reconciliation/voucher-entry' },
      { title: '재무제표 확인', description: '확정한 전표가 손익계산서와 재무상태표에 반영됩니다.', route: '/reports' },
    ],
  },
  {
    id: 'deal-to-payment',
    icon: '📋',
    title: '프로젝트 → 계약 → 정산 흐름',
    description: '프로젝트를 등록하고 견적부터 입금 확인까지 이어갑니다.',
    steps: [
      { title: '프로젝트 생성', description: '프로젝트명과 거래처, 계약 금액을 입력해 만듭니다.', route: '/projecthub' },
      { title: '견적서 작성·발송', description: '매출 탭에서 견적서를 작성해 거래처에 링크로 보냅니다.', route: '/projecthub' },
      { title: '계약 체결 · 전자서명', description: '견적이 수락되면 계약으로 이어지고 링크로 서명을 받습니다.', route: '/projecthub' },
      { title: '판매전표 자동 발행', description: '서명이 끝나면 판매전표가 기장되고, 세금계산서는 세금·증빙에서 발행합니다.', route: '/tax-invoices' },
      { title: '입금 확인·미수금', description: '프로젝트 화면에서 입금과 미수금, 마진을 확인합니다.', route: '/projecthub' },
    ],
  },
  {
    id: 'inventory-start',
    icon: '📦',
    title: '재고 시작하기 · 품목부터 이익까지',
    description: '품목 등록부터 재고 이동, 이익 확인까지의 흐름입니다.',
    steps: [
      { title: '품목 등록', description: '품목에서 규격과 판매가, 매입가를 등록합니다.', route: '/inventory/products' },
      { title: '기초 재고 입력', description: '창고관리에서 현재 수량을 맞춥니다.', route: '/inventory/stock' },
      { title: '주문서 작성', description: '주문에서 주문서와 견적을 만듭니다.', route: '/inventory/orders' },
      { title: '판매·구매·생산 처리', description: '주문을 불러와 판매·구매·생산으로 처리하면 재고가 움직입니다.', route: '/inventory/sales' },
      { title: '현황·이익 확인', description: '현황에서 집계를, 이익관리에서 품목별 이익률을 확인합니다.', route: '/inventory/status' },
    ],
  },
  {
    id: 'team-setup',
    icon: '👥',
    title: '직원 초대 및 권한 부여',
    description: '팀원을 초대하고 마스터가 구성원별로 메뉴·세부탭 권한을 부여합니다.',
    steps: [
      { title: '직원 등록', description: '구성원 메뉴에서 직원 인사정보를 등록합니다.', route: '/employees' },
      { title: '계정 초대', description: '이메일로 초대하면 직원이 링크로 가입해 연결됩니다.', route: '/employees' },
      { title: '권한 부여', description: '권한 부여 탭에서 구성원별 메뉴 권한을 고릅니다.', route: '/employees' },
      { title: '직원의 셀프서비스', description: '모든 구성원은 마이페이지에서 출퇴근과 연차, 급여명세서를 봅니다.', route: '/mypage' },
      { title: '결재선 설정', description: '결재 정책에서 유형별 결재 단계와 승인자를 설정합니다.', route: '/approvals' },
    ],
  },
];

// ── 워크플로 가이드 · 번호 원 + 세로 연결선 타임라인 (2026-08-12 리디자인) ──
function WorkflowGuides()  {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 권한 필터 (2026-08-12) — 멤버는 접근 가능한 스텝만 남기고, 남은 스텝이 2개 미만인
  //   워크플로(사실상 관리자용)는 통째로 숨긴다. 마스터는 전체.
  const { isMaster, hasMenu, loading } = useMyPermissions();
  const workflows = useMemo(() => {
    if (isMaster) return WORKFLOWS;
    if (loading) return [];
    return WORKFLOWS
      .map((wf) => ({ ...wf, steps: wf.steps.filter((s) => !s.route || canReach(s.route, hasMenu)) }))
      .filter((wf) => wf.steps.length >= 2);
  }, [isMaster, loading, hasMenu]);
  if (workflows.length === 0) return null;
  return (
    <section className="gd-wf-sect" data-gd>
      <h2 className="gd-h2">업무 흐름 따라하기</h2>
      <p className="gd-h2-sub">눌러서 단계별 안내를 펼쳐 보세요.</p>
      <div className="gd-wf-grid">
        {workflows.map((wf) => {
          const isOpen = expandedId === wf.id;
          return (
            <div key={wf.id} className={`gd-card ${isOpen ? "gd-card-open" : ""}`}>
              <button onClick={() => setExpandedId(isOpen ? null : wf.id)} aria-expanded={isOpen} className="gd-card-head">
                <span className="gd-card-ico" style={{ background: `${icoColor(wf.icon)}1a` }}>
                  <Ico e={wf.icon} tone="color" />
                </span>
                <span className="gd-card-titles">
                  <span className="gd-card-title-row">
                    <span className="gd-card-title">{wf.title}</span>
                  </span>
                  <span className="gd-card-desc gd-clamp2">{wf.description}</span>
                </span>
                {/* "총 N단계" — 'N단계'만 쓰면 순번(1단계, 2단계…)으로 읽혀 "1~3단계는 어디 갔냐"는
                    오해가 생겼다 (2026-08-12 사장님). 구성 개수임을 명시. */}
                <span className="gd-wf-count">총 {wf.steps.length}단계</span>
                <svg className={`gd-caret ${isOpen ? "gd-caret-open" : ""}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              <div className="gd-card-body">
                <div className="gd-card-body-inner">
                  <ol className="gd-steps">
                    {wf.steps.map((step, idx) => (
                      <li key={idx} className="gd-step">
                        <span className="gd-step-no">{idx + 1}</span>
                        <div className="gd-step-body">
                          <div className="gd-step-t">{step.title}</div>
                          <div className="gd-step-d">{step.description}</div>
                          {step.route && (
                            <Link href={step.route} className="gd-step-link">해당 화면으로 →</Link>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

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

  // 권한 필터 (2026-08-12 사장님). 마스터는 전체, 멤버·세무사는 부여된 메뉴의 가이드만.
  //   사이드바와 같은 기준(hasMenu: 기본 제공 + 부여 키). 로딩 중엔 잠깐 비워 깜빡임 방지.
  const  { isMaster, hasMenu, loading: permsLoading } = useMyPermissions();
  const visibleFeatures = useMemo(() => {
    if (isMaster) return FEATURES;
    if (permsLoading) return [];
    return FEATURES.filter((f) => canReach(f.route, hasMenu));
  }, [isMaster, permsLoading, hasMenu]);
  const visibleTabCounts = useMemo(() => {
    const counts = { '전체': visibleFeatures.length, '재무': 0, '재고': 0, '영업': 0, 'HR': 0, '운영': 0 } as Record<CategoryTab, number>;
    visibleFeatures.forEach((f) => { counts[f.category] += 1; });
    return counts;
  }, [visibleFeatures]);

  const filteredFeatures = useMemo(() => {
    let result = visibleFeatures;

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
  }, [visibleFeatures, activeTab, searchQuery]);

  const isAllExpanded = filteredFeatures.length > 0 && filteredFeatures.every((f) => expandedIds.has(f.id));

  // 등장 애니메이션은 CSS 키프레임(gd-rise)이 담당 — JS 리빌 제거 (2026-08-12 카드 미표시 사고)

  return (
    <div className="qk-shell gd-root">
      {/* ── 조회 화면 표준 상자 (2026-08-19 확산) — 큰 검색 히어로 + seg-bar → 갈래 탭(카테고리) 상자 안 파란 밑줄 + 조회 줄(빠른검색 ‖ 모두 펼치기 · 초기 설정), 본문만 스크롤 ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print" role="tablist" aria-label="기능 카테고리">
            {CATEGORY_TABS.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button key={tab} type="button" onClick={() => setActiveTab(tab)} role="tab" aria-selected={isActive} className={isActive ? "collect-tab collect-tab-on" : "collect-tab"}>
                  {tab}<span className="collect-tab-cnt">{visibleTabCounts[tab]}</span>
                </button>
              );
            })}
          </div>
          <QueryBar right={<>
            <span className="text-[11px] text-[var(--text-dim)]">{filteredFeatures.length}개 기능</span>
            <button type="button" onClick={isAllExpanded ? collapseAll : expandAll} className="btn-secondary btn-sm">{isAllExpanded ? "모두 접기" : "모두 펼치기"}</button>
            {isMaster && <button type="button" onClick={() => { resetOnboardingDismiss(); window.location.href = "/dashboard"; }} className="btn-secondary btn-sm" title="초기 설정을 다시 시작합니다.">초기 설정 다시 하기</button>}
          </>}>
            <div className="qk-quick-search gd-search-bar">
              <input type="text" className="qk-input h-8 w-full px-2.5 text-xs" placeholder="어떤 기능을 찾으세요?" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} aria-label="기능 검색" />
              {searchQuery && <button type="button" className="btn-secondary btn-sm" onClick={() => setSearchQuery("")} aria-label="검색어 지우기">지움</button>}
            </div>
            <span className="text-[11px] text-[var(--text-dim)]">기능을 검색하거나 업무 흐름을 따라가 보세요.</span>
          </QueryBar>
        </QueryHead>
        <QueryBody>
        <div className="gd-scroll">

      {/* ── 기능 카드 그리드 ── */}
      <div className="gd-grid">
        {filteredFeatures.map((feature) => (
          <FeatureCard key={feature.id} feature={feature} isExpanded={expandedIds.has(feature.id)} onToggle={() => toggleExpand(feature.id)} />
        ))}
      </div>

      {filteredFeatures.length === 0 && (
        <div className="gd-empty" data-gd>
          <div className="gd-empty-ico"><Ico e="🔍" tone="color" /></div>
          <p className="gd-empty-t">검색 결과가 없습니다</p>
          <p className="gd-empty-d">다른 키워드로 검색하거나 카테고리를 바꿔 보세요.</p>
        </div>
      )}

      <WorkflowGuides />

      {/* ── 바로가기 ── */}
      <section className="gd-quick" data-gd>
        <h3 className="gd-h3">바로가기</h3>
        <div className="gd-quick-grid">
          {visibleFeatures.map((f) => (
            <Link key={f.id} href={f.route} className="gd-quick-link">
              <Ico e={f.icon} tone="color" />
              {f.title}
            </Link>
          ))}
        </div>
      </section>
        </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}

