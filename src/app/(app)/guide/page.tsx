'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Ico, icoColor } from "@/components/ui-icon";
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

// ── Feature Data — 현재 사이드바 메뉴 기준 (2026-08-03 전면 최신화. 메뉴·기능이 바뀌면 여기도 갱신) ──
const FEATURES: GuideFeature[] = [
  {
    id: 'dashboard',
    icon: '📊',
    title: '대시보드',
    category: '재무',
    description:
      '로그인 후 첫 화면입니다. 통장 잔액과 자금 흐름, 매출 현황 같은 재무 지표부터 오늘 할 일, 캘린더, 출근 체크까지 회사의 하루를 한 화면에서 시작합니다. 재무·경영 위젯은 권한이 있는 구성원에게만 보입니다.',
    route: '/dashboard',
    keyFeatures: [
      '재무 현황 위젯 — 통장 잔액, 자금 흐름, 매출 현황을 한눈에',
      '오늘 할 일·캘린더 — 일정/할 일 화면과 자동 연동',
      '출근 체크 — 대시보드에서 바로 출퇴근 기록',
      '승인 대기 — 내가 처리할 결재·요청을 바로 확인',
      '권한별 표시 — 금액 정보는 권한 부여된 구성원에게만 노출',
    ],
    tips: '재무 위젯이 안 보인다면 마스터에게 대시보드 재무 위젯 권한을 요청하세요.',
  },
  {
    id: 'copilot',
    icon: '🤖',
    title: 'AI 참모',
    category: '운영',
    description:
      '회사 데이터를 알고 있는 AI 참모에게 경영 현황을 바로 물어볼 수 있습니다. 자금·매출·인사 현황 질문부터 계약서 초안 작성까지, 대표의 의사결정을 돕는 읽기 전용 참모입니다.',
    route: '/copilot',
    keyFeatures: [
      '데이터 기반 답변 — 우리 회사의 자금·매출·인사 현황을 근거로 답변',
      '경영 질문 — "이번 달 지출이 왜 늘었지?" 같은 질문에 바로 응답',
      '계약서 초안 — 대화 중 필요한 계약서를 첨부 문서로 생성',
      '읽기 전용 — AI는 데이터를 조회만 할 뿐 회사 데이터를 변경하지 않음',
    ],
    tips: '구체적으로 물을수록 좋은 답이 나옵니다. 예: "지난달 대비 인건비 변화 알려줘"',
  },
  {
    id: 'partners',
    icon: '🏢',
    title: '거래처',
    category: '영업',
    description:
      '고객사·공급사 정보를 등록하고 관리합니다. 사업자등록번호를 입력하면 국세청에서 실시간으로 유효성을 확인하며, 거래처 원장에서 거래처별 매출·매입 흐름을 조회할 수 있습니다.',
    route: '/partners',
    keyFeatures: [
      '거래처 등록 — 사업자번호 국세청 실시간 검증',
      '거래처 원장 — 거래처별 매출·매입·잔액 흐름 조회',
      '연동 활용 — 프로젝트, 세금계산서, 전표에서 거래처 정보 재사용',
    ],
  },
  {
    id: 'tax-invoices',
    icon: '🧾',
    title: '세금·증빙',
    category: '재무',
    description:
      '공동인증서를 연동하면 홈택스의 매출·매입 전자세금계산서가 자동으로 수집됩니다. 세금계산서 발행, 부가세 집계, 현금영수증까지 세무 증빙 업무를 한곳에서 처리합니다.',
    route: '/tax-invoices',
    keyFeatures: [
      '홈택스 자동 수집 — 매출/매입 세금계산서를 자동으로 가져오기',
      '세금계산서 발행 — 거래처·품목·금액 입력, 발행 대기함으로 관리',
      '부가세 집계 — 기간별 매출·매입 부가세 자동 합산',
      '현금영수증 — 발행과 내역 관리 (세금·증빙 메뉴 안)',
      '요약 탭 — 기간별 증빙 현황을 한눈에',
    ],
    tips: '설정 > 인증서에서 공동인증서를 등록하면 자동 수집이 시작됩니다.',
  },
  {
    id: 'transactions',
    icon: '📒',
    title: '거래 장부',
    category: '재무',
    description:
      '은행·카드 거래내역이 자동으로 수집되어 하나의 장부에 쌓입니다. 거래 내용을 분석해 계정과목을 자동 분류하고 부가세 구분까지 제안하므로, 검토하고 필요한 것만 고치면 장부가 완성됩니다.',
    route: '/transactions',
    keyFeatures: [
      '자동 수집 — 인증서 연동 시 은행 입출금·카드 승인내역 자동 반영',
      '자동 분류 — 거래 내용 기반 계정과목·부가세 구분 자동 매핑',
      '수동 보정 — 잘못 분류된 건은 직접 지정, 이후 같은 거래에 반영',
      '전표입력 — 수기 거래는 전표입력 화면에서 직접 기록',
    ],
  },
  {
    id: 'reports',
    icon: '📈',
    title: '분석',
    category: '재무',
    description:
      '수집된 거래와 장부를 바탕으로 기간별 매출·비용 추이와 손익을 분석합니다. 월 결산 흐름과 함께 회사의 재무 상태 변화를 추적할 수 있습니다.',
    route: '/reports',
    keyFeatures: [
      '기간별 분석 — 월/분기 단위 매출·비용 추이',
      '손익 확인 — 수입과 지출을 계정과목 기준으로 집계',
      '결산 연계 — 설정의 회계마감과 함께 월 단위 마감 관리',
    ],
    tips: '거래 장부의 계정과목 분류가 정확할수록 분석도 정확해집니다.',
  },
  {
    id: 'bank',
    icon: '🏦',
    title: '통장·카드·정기 지출',
    category: '재무',
    description:
      '여러 은행에 흩어진 법인 통장 잔액을 한 화면에 모아 보고, 법인카드 승인내역과 매달 나가는 정기 지출(구독·고정비)을 관리합니다. 자산관리 그룹의 통장/카드/정기 지출 메뉴로 나뉘어 있습니다.',
    route: '/bank',
    keyFeatures: [
      '통장 — 계좌·잔액 통합 조회, 개요와 거래내역 탭',
      '카드 — 법인카드 승인내역 자동 수집·조회',
      '정기 지출 — 매달 반복되는 구독·고정비 등록과 추천',
      '자동 갱신 — 인증서 연동 시 잔액·내역이 자동으로 최신화',
    ],
  },
  {
    id: 'projecthub',
    icon: '📁',
    title: '프로젝트',
    category: '영업',
    description:
      '프로젝트(거래) 단위로 돈의 흐름을 추적합니다. 목표 금액 → 계약 → 세금계산서 발행 → 입금 → 마진까지 이어지는 흐름을 개요에서 한눈에 보고, 프로젝트별 손익과 미수금을 관리합니다.',
    route: '/projecthub',
    keyFeatures: [
      '흐름 추적 — 목표 → 계약 → 발행 → 입금 → 마진 단계별 현황',
      '프로젝트 손익 — 프로젝트별 수입·지출·마진 집계',
      '미수금 관리 — 발행했지만 입금 안 된 금액 추적',
      '견적서 — 프로젝트에서 견적서 작성·관리',
      '열람 권한 — 내 담당 프로젝트만 / 전체 열람을 권한으로 구분',
    ],
  },
  {
    id: 'approvals',
    icon: '✅',
    title: '결재 허브',
    category: '운영',
    description:
      '지출결의서, 휴가 신청 같은 사내 결재를 전자로 처리합니다. 회사 양식으로 새 요청을 올리면 결재선(단계)을 따라 승인이 진행되고, 완료된 결재 문서는 PDF로 저장할 수 있습니다.',
    route: '/approvals',
    keyFeatures: [
      '새 요청 — 회사 양식 기반 작성, 표·이미지 등 서식 지원',
      '내 결재함 — 내가 승인할 차례인 문서를 모아 처리',
      '결재 정책 — 유형·금액별 결재선(단계·승인자) 설정',
      '전체 현황·참조 — 진행 상황 추적과 참조자 공유',
      'PDF 저장 — 결재 문서를 화면과 동일한 양식의 PDF로 보관',
    ],
    tips: '양식 관리 탭에서 우리 회사 결재 양식을 직접 만들 수 있습니다.',
  },
  {
    id: 'schedule',
    icon: '📅',
    title: '일정 / 할 일',
    category: '운영',
    description:
      '회사와 개인의 일정, 할 일을 캘린더에서 관리합니다. 등록한 일정과 할 일은 대시보드에도 함께 표시되어 하루 업무를 놓치지 않게 합니다.',
    route: '/schedule',
    keyFeatures: [
      '캘린더 — 월/주 단위 일정 관리',
      '할 일 — 담당자·기한이 있는 업무 관리',
      '대시보드 연동 — 오늘 일정·할 일이 대시보드에 표시',
    ],
  },
  {
    id: 'chat',
    icon: '💬',
    title: '메신저·게시판',
    category: '운영',
    description:
      '팀원 간 실시간 메신저와 사내 게시판, 공지사항으로 회사 소통을 해결합니다. 외부 메신저 없이 업무 대화와 공지를 오너뷰 안에서 처리할 수 있습니다.',
    route: '/chat',
    keyFeatures: [
      '메신저 — 팀원과 실시간 대화, 파일 공유',
      '게시판 — 자유로운 사내 글·자료 공유',
      '공지사항 — 전 구성원 대상 공지 (작성은 권한자만)',
    ],
  },
  {
    id: 'signatures',
    icon: '✍️',
    title: '전자계약',
    category: '운영',
    description:
      '계약서를 링크로 보내고 법적 효력 있는 전자서명을 받습니다. 서명 상태를 실시간으로 추적하고, 완료된 문서는 보관함에 안전하게 저장됩니다. 직인 관리도 함께 지원합니다.',
    route: '/signatures',
    keyFeatures: [
      '서명 요청 — 이메일·링크로 상대방에게 전자서명 요청',
      '상태 추적 — 대기/완료 상태 실시간 확인',
      '직인 관리 — 회사 직인 등록 후 문서에 날인',
      '문서 보관 — 완료 문서를 파일보관함에서 관리',
      '내 서명 요청 — 내가 서명할 문서는 별도 메뉴에서 확인',
    ],
  },
  {
    id: 'hr-templates',
    icon: '📄',
    title: '근로계약·서식',
    category: 'HR',
    description:
      '근로계약서와 회사 서식을 템플릿으로 관리합니다. 기존 PDF 양식을 올리면 원본 모양 그대로 보존한 채 이름·날짜 같은 값만 변수로 바꿔 쓸 수 있고, 완성된 계약서는 전자서명으로 바로 체결합니다.',
    route: '/hr-templates',
    keyFeatures: [
      '템플릿 관리 — 근로계약서 등 반복 사용 서식 등록',
      'PDF 원본 보존 편집 — 기존 양식 PDF를 모양 그대로 재사용',
      '변수 치환 — 성명·입사일 등을 변수로 지정해 자동 채움',
      '전자서명 연계 — 완성 문서를 바로 서명 요청으로 전달',
    ],
  },
  {
    id: 'employees',
    icon: '👥',
    title: '구성원',
    category: 'HR',
    description:
      '직원 인사정보부터 급여, 휴가, 증명서, 권한까지 사람에 관한 모든 것을 관리합니다. 이메일로 초대하면 직원이 직접 로그인해 마이페이지에서 출퇴근을 찍고 급여명세서를 확인합니다.',
    route: '/employees',
    keyFeatures: [
      '인사정보 — 부서·직급·입사일·연봉 관리',
      '초대·합류 — 이메일 초대와 가입 요청 승인으로 계정 연결',
      '급여 — 4대보험·소득세 반영 급여명세서 생성·발송',
      '휴가 관리 — 법정 연차 매달 자동 부여, 잔여·사용 추적',
      '증명서 발급 — 재직증명서 등 발급',
      '권한 부여 — 마스터가 구성원별 메뉴·탭 권한 지정',
    ],
    tips: '직원은 마이페이지에서 본인 출퇴근·연차·급여명세서를 직접 확인할 수 있습니다.',
  },
  {
    id: 'attendance',
    icon: '⏰',
    title: '근태 관리',
    category: 'HR',
    description:
      '전 직원의 출퇴근을 워크보드에서 한눈에 보고, 지각·연장·야간·휴일 근무를 자동 산정합니다. 산정된 근무시간은 가산수당 계산으로 이어져 급여에 자동 반영됩니다.',
    route: '/attendance',
    keyFeatures: [
      '워크보드 — 오늘 전 직원 출퇴근 현황 한눈에',
      '기록 상세·수정 — 일자별 기록 확인과 관리자 정정',
      '자동 산정 — 지각/연장/야간/휴일 근무시간 자동 계산',
      '가산수당 — 근무시간 기반 수당 자동 계산 후 급여 반영',
      '근태 설정 — 회사별 출퇴근 기준 시간·규칙 설정',
    ],
  },
  {
    id: 'settings',
    icon: '⚙️',
    title: '회사 설정·요금제',
    category: '운영',
    description:
      '회사 정보, 팀·권한, 자금·통장, 계정과목, 회계마감, 은행연동·인증서, 부서, 근태 기준, 결재선, 회사 양식까지 서비스 전반을 설정합니다. 요금제 메뉴에서 구독 플랜과 결제를 관리합니다.',
    route: '/settings',
    keyFeatures: [
      '회사정보·부서 — 사업자 정보와 조직 구성',
      '인증서·은행연동 — 공동인증서 등록으로 금융·홈택스 자동 수집 시작',
      '자금·통장 — 계좌 등록과 용도(운영/세금/급여/예비) 관리',
      '근태·가산수당, 승인·결재 — 회사 규칙과 결재선 설정',
      '요금제 — 구독 플랜 변경, 월간/연간 결제 관리',
    ],
    tips: '공동인증서 등록이 자동화의 시작점입니다. 설정 > 인증서에서 등록하세요.',
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


// ── 기능 카드 (2026-08-12 리디자인 — 사장님: "조잡하고 레이아웃 안 맞음") ──
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

// 현재 화면·설정 탭 기준 (2026-08-03 최신화 — 메뉴/흐름이 바뀌면 여기도 갱신)
const WORKFLOWS: Workflow[] = [
  {
    id: 'getting-started',
    icon: '🚀',
    title: '시작하기 — 회사 설정',
    description: '회원가입 후 첫 설정을 완료하는 과정입니다. 10분이면 시작할 수 있습니다.',
    steps: [
      { title: '회원가입', description: '이메일로 가입하고 사업자등록번호를 입력하면 국세청에서 실시간으로 확인합니다. 이미 등록된 회사라면 마스터에게 합류 요청을 보낼 수 있습니다.' },
      { title: '온보딩 마법사', description: '가입 직후 온보딩에서 회사 정보(사업자등록증 첨부)와 인증서 연동(통장·카드·홈택스 자동 수집)을 마치면 대시보드로 이동하며 화면 사용법 투어가 시작됩니다.', route: '/onboarding' },
      { title: '회사 정보 확인', description: '설정 → 회사정보에서 사업자등록번호, 대표자명, 주소를 확인·보완합니다. 세금계산서와 계약서 등 공식 문서에 사용됩니다.', route: '/settings?tab=company-info' },
      { title: '통장 등록', description: '설정 → 자금·통장에서 법인 계좌를 등록하고 용도(운영/세금/급여/예비)를 지정합니다.', route: '/settings?tab=cash' },
      { title: '거래처 등록', description: '거래처 메뉴에서 첫 번째 고객사 또는 공급사를 추가합니다. 사업자등록번호는 국세청에서 자동 검증됩니다.', route: '/partners' },
      { title: '대시보드 확인', description: '설정이 끝나면 대시보드에서 잔액·자금 흐름과 오늘 할 일이 표시되기 시작합니다.', route: '/dashboard' },
    ],
  },
  {
    id: 'codef-cert',
    icon: '🔐',
    title: '공동인증서 등록 — 자동화의 시작',
    description: '공동인증서를 등록하면 은행/카드 거래내역과 홈택스 세금계산서를 자동으로 가져올 수 있습니다.',
    steps: [
      { title: '설정 → 인증서', description: '설정 페이지의 인증서 탭에서 등록을 시작합니다.', route: '/settings?tab=certificate' },
      { title: '인증서 불러오기', description: 'PC에 CodefCert 프로그램을 설치하면 저장된 공동인증서(구 공인인증서)를 자동으로 찾아줍니다. 프로그램 설치가 어려우면 PFX/P12 파일을 직접 업로드해도 됩니다.' },
      { title: '비밀번호 입력', description: '인증서 비밀번호를 입력하면 암호화되어 안전하게 전송됩니다. 금융 데이터 조회에만 사용됩니다.' },
      { title: '연결 확인', description: '등록이 완료되면 연결됨 상태가 표시되고, 이후 은행·카드·홈택스 데이터가 자동으로 수집되기 시작합니다.' },
    ],
  },
  {
    id: 'bank-card',
    icon: '🏦',
    title: '은행/카드 자동 수집',
    description: '인증서 연동 후 거래내역이 자동으로 수집되고, 계정과목이 자동 분류됩니다.',
    steps: [
      { title: '인증서 등록 (선행)', description: '위의 "공동인증서 등록" 가이드를 먼저 완료하세요. 설정 → 은행연동에서 연동할 은행·카드사를 관리할 수 있습니다.', route: '/settings?tab=bank' },
      { title: '자동 수집 확인', description: '통장 메뉴에서 계좌 잔액과 거래내역이, 카드 메뉴에서 승인내역이 자동으로 쌓이는 것을 확인합니다.', route: '/bank' },
      { title: '자동 분류 검토', description: '거래 장부에서 자동 분류된 계정과목과 부가세 구분을 검토합니다. 잘못 분류된 항목은 직접 수정하면 됩니다.', route: '/transactions' },
      { title: '수기 거래 입력', description: '자동 수집 밖의 거래(현금 등)는 전표입력에서 직접 기록합니다.', route: '/partners/reconciliation/voucher-entry' },
      { title: '분석 확인', description: '장부가 쌓이면 분석 메뉴에서 기간별 매출·비용 추이를 확인할 수 있습니다.', route: '/reports' },
    ],
  },
  {
    id: 'deal-to-payment',
    icon: '📋',
    title: '프로젝트 → 계약 → 정산 흐름',
    description: '수주한 프로젝트를 등록하고 견적 → 계약 → 세금계산서 발행 → 입금 확인까지 이어갑니다.',
    steps: [
      { title: '프로젝트 생성', description: '프로젝트 메뉴에서 새 프로젝트를 만듭니다. 프로젝트명, 거래처, 계약 금액을 입력하면 목표 대비 진행 흐름 추적이 시작됩니다.', route: '/projecthub' },
      { title: '견적서 작성', description: '프로젝트에서 견적서를 작성해 거래처에 전달합니다.', route: '/projecthub' },
      { title: '계약 체결 — 전자서명', description: '전자계약에서 계약서를 만들어 서명 요청을 보냅니다. 상대방은 링크로 접속해 그 자리에서 서명하고, 완료 문서는 보관함에 저장됩니다.', route: '/signatures' },
      { title: '세금계산서 발행', description: '세금·증빙에서 세금계산서를 발행합니다. 발행 대기함으로 발행 건을 관리할 수 있습니다.', route: '/tax-invoices' },
      { title: '입금 확인·미수금', description: '입금이 들어오면 거래 장부에 자동 수집됩니다. 프로젝트 화면에서 발행 대비 입금·미수금과 마진을 확인하세요.', route: '/projecthub' },
    ],
  },
  {
    id: 'team-setup',
    icon: '👥',
    title: '직원 초대 및 권한 부여',
    description: '팀원을 초대하고 마스터가 구성원별로 메뉴·세부탭 권한을 부여합니다.',
    steps: [
      { title: '직원 등록', description: '구성원 메뉴에서 직원의 인사정보(부서·직급·입사일·연봉)를 등록합니다.', route: '/employees' },
      { title: '계정 초대', description: '이메일로 초대를 보내면 직원이 링크로 가입해 회사에 연결됩니다. 직원이 먼저 가입 요청을 보낸 경우 마스터가 승인하면 됩니다.', route: '/employees' },
      { title: '권한 부여', description: '역할 구분 대신 마스터 1명이 구성원별로 필요한 메뉴와 세부탭 권한을 골라 부여합니다. 구성원 화면의 권한 부여 탭에서 설정하세요.', route: '/employees' },
      { title: '직원의 셀프서비스', description: '권한과 무관하게 모든 구성원은 마이페이지에서 본인 출퇴근 체크, 연차 확인, 급여명세서 열람을 할 수 있습니다.', route: '/mypage' },
      { title: '결재선 설정', description: '결재 허브 → 결재 정책에서 지출결의·휴가 등 유형별 결재 단계와 승인자를 설정합니다.', route: '/approvals' },
    ],
  },
];

// ── 워크플로 가이드 — 번호 원 + 세로 연결선 타임라인 (2026-08-12 리디자인) ──
function WorkflowGuides() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <section className="gd-wf-sect" data-gd>
      <h2 className="gd-h2">업무 흐름 따라하기</h2>
      <p className="gd-h2-sub">처음 하는 업무는 이 순서대로 — 눌러서 단계별 안내를 펼쳐 보세요.</p>
      <div className="gd-wf-grid">
        {WORKFLOWS.map((wf) => {
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

  // 스크롤 리빌 — data-gd 요소가 화면에 들어오면 순차 fade-up (2026-08-12)
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-gd]:not(.gd-in)"));
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("gd-in"); io.unobserve(e.target); } }),
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [filteredFeatures]);

  return (
    <div className="gd-root">
      {/* ── 헤더 — 큰 검색이 주인공 ── */}
      <div className="gd-hero" data-gd>
        <div className="gd-hero-top">
          <div>
            <h1 className="gd-hero-title">사용 가이드</h1>
            <p className="gd-hero-sub">오너뷰의 모든 기능을 한 곳에서 — 검색하거나, 업무 흐름을 따라가 보세요.</p>
          </div>
          <button
            onClick={() => { resetOnboardingDismiss(); window.location.href = "/dashboard"; }}
            className="gd-onboard-btn"
            title="회사 정보·통장·카드·직원 등 초기 설정을 다시 시작합니다"
          >
            초기 설정 다시 하기
          </button>
        </div>
        <div className="gd-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input
            type="text"
            placeholder="어떤 기능을 찾으세요? (예: 세금계산서, 연차, 결재)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="기능 검색"
          />
          {searchQuery && (
            <button className="gd-search-clear" onClick={() => setSearchQuery("")} aria-label="검색어 지우기">✕</button>
          )}
        </div>
      </div>

      {/* ── 카테고리 + 펼침 컨트롤 ── */}
      <div className="gd-toolbar" data-gd>
        <div className="seg-bar max-w-full overflow-x-auto" role="tablist" aria-label="기능 카테고리">
          {CATEGORY_TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button key={tab} onClick={() => setActiveTab(tab)} role="tab" aria-selected={isActive}
                className={`seg-item flex items-center gap-1.5 ${isActive ? "seg-item-active" : ""}`}>
                <span className="text-[14px]">{CATEGORY_TAB_ICONS[tab]}</span>
                {tab}
                <span className={`gd-tab-count ${isActive ? "gd-tab-count-on" : ""}`}>{CATEGORY_TAB_COUNTS[tab]}</span>
              </button>
            );
          })}
        </div>
        <div className="gd-toolbar-right">
          <span className="gd-count">{filteredFeatures.length}개 기능</span>
          <button onClick={isAllExpanded ? collapseAll : expandAll} className="gd-expand-btn">
            {isAllExpanded ? "모두 접기" : "모두 펼치기"}
          </button>
        </div>
      </div>

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
          {FEATURES.map((f) => (
            <Link key={f.id} href={f.route} className="gd-quick-link">
              <Ico e={f.icon} tone="color" />
              {f.title}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

