'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ── Types ──
type GuideCategory = {
  id: string;
  icon: string;
  name: string;
  description: string;
  route: string;
  steps: GuideStep[];
};

type GuideStep = {
  title: string;
  description: string;
  // Cursor animation positions: [startX%, startY%] -> [endX%, endY%]
  cursorFrom: [number, number];
  cursorTo: [number, number];
  clickAt: [number, number];
  // Mockup elements to render
  mockElements: MockElement[];
  spotlightArea?: { x: number; y: number; w: number; h: number };
};

type MockElement = {
  type: 'button' | 'card' | 'input' | 'table-row' | 'tab' | 'badge' | 'chart-bar' | 'text' | 'icon-btn';
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  highlight?: boolean;
};

// ── Categories Data ──
const CATEGORIES: GuideCategory[] = [
  {
    id: 'dashboard',
    icon: '📊',
    name: '대시보드',
    description: '6-Pack 생존지표, 승인 대기, 재무 드릴다운',
    route: '/dashboard',
    steps: [
      {
        title: '생존지표 6-Pack 확인',
        description: '현금 잔고, 번율, 런웨이, 매출채권, 매입채무, 미수금 등 핵심 지표를 한눈에 파악합니다.',
        cursorFrom: [10, 10], cursorTo: [50, 30], clickAt: [50, 30],
        mockElements: [
          { type: 'card', label: '현금 잔고', x: 5, y: 10, w: 28, h: 35, color: '#2563eb' },
          { type: 'card', label: '런웨이', x: 36, y: 10, w: 28, h: 35, color: '#16a34a' },
          { type: 'card', label: '번율', x: 67, y: 10, w: 28, h: 35, color: '#ea580c' },
          { type: 'chart-bar', label: '', x: 5, y: 55, w: 90, h: 35 },
        ],
      },
      {
        title: '승인 대기 처리',
        description: '결제 승인, 문서 승인 등 대기 중인 항목을 빠르게 처리합니다.',
        cursorFrom: [80, 10], cursorTo: [85, 55], clickAt: [85, 55],
        mockElements: [
          { type: 'card', label: '승인 대기 3건', x: 60, y: 10, w: 35, h: 15, color: '#dc2626', highlight: true },
          { type: 'table-row', label: '결제 요청 #1042', x: 60, y: 30, w: 35, h: 10 },
          { type: 'table-row', label: '문서 승인 #2087', x: 60, y: 42, w: 35, h: 10 },
          { type: 'button', label: '승인', x: 78, y: 55, w: 15, h: 8, color: '#2563eb', highlight: true },
        ],
      },
      {
        title: '재무 드릴다운',
        description: '매출/비용 항목을 클릭하면 하위 상세 내역까지 드릴다운하여 확인할 수 있습니다.',
        cursorFrom: [10, 50], cursorTo: [30, 65], clickAt: [30, 65],
        mockElements: [
          { type: 'chart-bar', label: '월별 매출', x: 5, y: 10, w: 55, h: 40 },
          { type: 'card', label: '매출 상세', x: 5, y: 55, w: 55, h: 38, highlight: true },
          { type: 'table-row', label: '제품 A — ₩12,500,000', x: 8, y: 65, w: 48, h: 8 },
          { type: 'table-row', label: '제품 B — ₩8,300,000', x: 8, y: 75, w: 48, h: 8 },
        ],
      },
    ],
  },
  {
    id: 'deals',
    icon: '📋',
    name: '프로젝트/딜',
    description: '딜 생성, 칸반보드, 파이프라인, 마일스톤',
    route: '/deals',
    steps: [
      {
        title: '새 딜 생성',
        description: '"+ 새 딜" 버튼을 눌러 거래처, 금액, 담당자 등 기본 정보를 입력합니다.',
        cursorFrom: [80, 5], cursorTo: [88, 8], clickAt: [88, 8],
        mockElements: [
          { type: 'button', label: '+ 새 딜', x: 80, y: 3, w: 15, h: 8, color: '#2563eb', highlight: true },
          { type: 'input', label: '딜 이름', x: 25, y: 25, w: 50, h: 8 },
          { type: 'input', label: '거래처', x: 25, y: 38, w: 50, h: 8 },
          { type: 'input', label: '예상 금액', x: 25, y: 51, w: 50, h: 8 },
        ],
      },
      {
        title: '칸반보드로 딜 관리',
        description: '드래그 앤 드롭으로 딜의 진행 상태를 변경합니다. (리드 → 제안 → 협상 → 성사)',
        cursorFrom: [15, 40], cursorTo: [55, 40], clickAt: [55, 40],
        mockElements: [
          { type: 'card', label: '리드', x: 3, y: 10, w: 22, h: 80, color: '#94a3b8' },
          { type: 'card', label: '제안', x: 27, y: 10, w: 22, h: 80, color: '#3b82f6' },
          { type: 'card', label: '협상', x: 51, y: 10, w: 22, h: 80, color: '#f59e0b', highlight: true },
          { type: 'card', label: '성사', x: 75, y: 10, w: 22, h: 80, color: '#22c55e' },
        ],
      },
      {
        title: '파이프라인 현황 확인',
        description: '전체 딜의 단계별 금액과 전환율을 시각적으로 확인합니다.',
        cursorFrom: [5, 15], cursorTo: [50, 30], clickAt: [50, 30],
        mockElements: [
          { type: 'chart-bar', label: '파이프라인', x: 5, y: 10, w: 90, h: 35 },
          { type: 'badge', label: '총 12건 / ₩1.2억', x: 5, y: 50, w: 30, h: 8, color: '#2563eb' },
          { type: 'badge', label: '전환율 34%', x: 38, y: 50, w: 22, h: 8, color: '#22c55e' },
        ],
      },
      {
        title: '마일스톤 추적',
        description: '딜 상세에서 마일스톤을 설정하고 진척도를 관리합니다.',
        cursorFrom: [10, 60], cursorTo: [45, 75], clickAt: [45, 75],
        mockElements: [
          { type: 'table-row', label: '1단계: 샘플 발송 ✅', x: 10, y: 60, w: 60, h: 8 },
          { type: 'table-row', label: '2단계: 견적 확정 ✅', x: 10, y: 70, w: 60, h: 8 },
          { type: 'table-row', label: '3단계: 계약서 서명 🔄', x: 10, y: 80, w: 60, h: 8, highlight: true },
        ],
      },
    ],
  },
  {
    id: 'partners',
    icon: '🏢',
    name: '거래처 CRM',
    description: '거래처 등록, 파트너 초대, 360도 뷰',
    route: '/partners',
    steps: [
      {
        title: '거래처 등록',
        description: '사업자등록번호, 회사명, 연락처 등을 입력하여 새 거래처를 등록합니다.',
        cursorFrom: [80, 5], cursorTo: [88, 8], clickAt: [88, 8],
        mockElements: [
          { type: 'button', label: '+ 거래처 등록', x: 75, y: 3, w: 20, h: 8, color: '#2563eb', highlight: true },
          { type: 'input', label: '사업자등록번호', x: 20, y: 25, w: 55, h: 8 },
          { type: 'input', label: '회사명', x: 20, y: 38, w: 55, h: 8 },
          { type: 'input', label: '대표 연락처', x: 20, y: 51, w: 55, h: 8 },
        ],
      },
      {
        title: '파트너 초대',
        description: '이메일로 거래처를 초대하여 공동 작업 환경을 구축합니다.',
        cursorFrom: [60, 20], cursorTo: [75, 35], clickAt: [75, 35],
        mockElements: [
          { type: 'input', label: 'partner@example.com', x: 20, y: 25, w: 45, h: 8 },
          { type: 'button', label: '초대 전송', x: 68, y: 25, w: 15, h: 8, color: '#2563eb', highlight: true },
          { type: 'badge', label: '대기 중 2명', x: 20, y: 40, w: 18, h: 7, color: '#f59e0b' },
          { type: 'badge', label: '활성 5명', x: 42, y: 40, w: 15, h: 7, color: '#22c55e' },
        ],
      },
      {
        title: '360도 뷰',
        description: '거래처별 딜, 결제, 문서, 채팅 이력을 한곳에서 확인합니다.',
        cursorFrom: [10, 30], cursorTo: [50, 50], clickAt: [50, 50],
        mockElements: [
          { type: 'tab', label: '딜 내역', x: 5, y: 10, w: 20, h: 7, highlight: true },
          { type: 'tab', label: '결제', x: 27, y: 10, w: 15, h: 7 },
          { type: 'tab', label: '문서', x: 44, y: 10, w: 15, h: 7 },
          { type: 'tab', label: '채팅', x: 61, y: 10, w: 15, h: 7 },
          { type: 'card', label: '총 거래액 ₩85,000,000', x: 5, y: 25, w: 40, h: 15, color: '#2563eb' },
          { type: 'card', label: '진행 딜 3건', x: 50, y: 25, w: 40, h: 15, color: '#16a34a' },
        ],
      },
    ],
  },
  {
    id: 'payments',
    icon: '💰',
    name: '결제 관리',
    description: '결제 요청, 대표 승인, 급여 배치',
    route: '/payments',
    steps: [
      {
        title: '결제 요청 생성',
        description: '결제 항목, 금액, 계좌를 선택하여 결제 요청을 등록합니다.',
        cursorFrom: [80, 5], cursorTo: [88, 8], clickAt: [88, 8],
        mockElements: [
          { type: 'button', label: '+ 결제 요청', x: 78, y: 3, w: 18, h: 8, color: '#2563eb', highlight: true },
          { type: 'input', label: '결제 항목', x: 20, y: 25, w: 55, h: 8 },
          { type: 'input', label: '금액', x: 20, y: 38, w: 30, h: 8 },
          { type: 'input', label: '수취 계좌', x: 20, y: 51, w: 55, h: 8 },
        ],
      },
      {
        title: '대표 승인 처리',
        description: '대기 중인 결제를 확인하고 승인/반려 처리합니다.',
        cursorFrom: [30, 40], cursorTo: [80, 55], clickAt: [80, 55],
        mockElements: [
          { type: 'table-row', label: '외주비 결제 — ₩5,500,000', x: 5, y: 30, w: 65, h: 10 },
          { type: 'table-row', label: '사무용품 — ₩320,000', x: 5, y: 42, w: 65, h: 10 },
          { type: 'button', label: '승인', x: 72, y: 30, w: 12, h: 8, color: '#22c55e', highlight: true },
          { type: 'button', label: '반려', x: 86, y: 30, w: 10, h: 8, color: '#ef4444' },
        ],
      },
      {
        title: '급여 배치 실행',
        description: '월 급여를 배치로 생성하고 일괄 승인하여 처리합니다.',
        cursorFrom: [10, 60], cursorTo: [50, 75], clickAt: [50, 75],
        mockElements: [
          { type: 'card', label: '2026년 3월 급여', x: 5, y: 10, w: 50, h: 12, color: '#2563eb' },
          { type: 'table-row', label: '김직원 — ₩3,200,000', x: 5, y: 30, w: 60, h: 8 },
          { type: 'table-row', label: '박대리 — ₩3,800,000', x: 5, y: 40, w: 60, h: 8 },
          { type: 'button', label: '배치 승인', x: 35, y: 55, w: 20, h: 8, color: '#2563eb', highlight: true },
          { type: 'badge', label: '총 ₩7,000,000', x: 5, y: 55, w: 22, h: 8, color: '#64748b' },
        ],
      },
    ],
  },
  {
    id: 'tax-invoices',
    icon: '🧾',
    name: '세금계산서',
    description: '발행, 3-Way 매칭, 홈택스 임포트',
    route: '/tax-invoices',
    steps: [
      {
        title: '세금계산서 발행',
        description: '거래처, 품목, 금액을 입력하여 전자세금계산서를 발행합니다.',
        cursorFrom: [80, 5], cursorTo: [88, 8], clickAt: [88, 8],
        mockElements: [
          { type: 'button', label: '+ 계산서 발행', x: 75, y: 3, w: 20, h: 8, color: '#2563eb', highlight: true },
          { type: 'input', label: '공급받는자', x: 15, y: 25, w: 60, h: 8 },
          { type: 'input', label: '공급가액', x: 15, y: 38, w: 30, h: 8 },
          { type: 'text', label: '세액 (자동계산)', x: 48, y: 38, w: 25, h: 8 },
        ],
      },
      {
        title: '3-Way 매칭',
        description: '세금계산서 ↔ 발주서 ↔ 입고증을 자동으로 매칭하여 검증합니다.',
        cursorFrom: [20, 30], cursorTo: [50, 50], clickAt: [50, 50],
        mockElements: [
          { type: 'card', label: '세금계산서', x: 5, y: 20, w: 28, h: 25, color: '#2563eb' },
          { type: 'card', label: '발주서', x: 36, y: 20, w: 28, h: 25, color: '#8b5cf6' },
          { type: 'card', label: '입고증', x: 67, y: 20, w: 28, h: 25, color: '#22c55e' },
          { type: 'badge', label: '매칭 완료 ✓', x: 35, y: 52, w: 25, h: 8, color: '#22c55e', highlight: true },
        ],
      },
      {
        title: '홈택스 임포트',
        description: '홈택스에서 다운받은 엑셀 파일을 업로드하면 자동으로 등록됩니다.',
        cursorFrom: [10, 15], cursorTo: [30, 20], clickAt: [30, 20],
        mockElements: [
          { type: 'button', label: '홈택스 임포트', x: 5, y: 5, w: 22, h: 8, color: '#2563eb', highlight: true },
          { type: 'card', label: 'Excel 파일을 드래그하세요', x: 15, y: 25, w: 65, h: 30, color: '#94a3b8' },
          { type: 'badge', label: '23건 임포트 완료', x: 30, y: 65, w: 30, h: 8, color: '#22c55e' },
        ],
      },
    ],
  },
  {
    id: 'transactions',
    icon: '🏦',
    name: '거래내역',
    description: '거래내역 확인, AI 자동 분류',
    route: '/transactions',
    steps: [
      {
        title: '거래내역 조회',
        description: '연결된 계좌의 거래내역을 기간별, 분류별로 필터링하여 확인합니다.',
        cursorFrom: [10, 10], cursorTo: [30, 15], clickAt: [30, 15],
        mockElements: [
          { type: 'input', label: '2026.01 ~ 2026.03', x: 5, y: 5, w: 30, h: 8, highlight: true },
          { type: 'tab', label: '전체', x: 5, y: 18, w: 12, h: 6, highlight: true },
          { type: 'tab', label: '입금', x: 19, y: 18, w: 12, h: 6 },
          { type: 'tab', label: '출금', x: 33, y: 18, w: 12, h: 6 },
          { type: 'table-row', label: '(주)ABC 입금 — ₩15,000,000', x: 5, y: 30, w: 70, h: 8 },
          { type: 'table-row', label: '급여 출금 — ₩7,000,000', x: 5, y: 40, w: 70, h: 8 },
          { type: 'table-row', label: '사무실 임대료 — ₩1,500,000', x: 5, y: 50, w: 70, h: 8 },
        ],
      },
      {
        title: 'AI 자동 분류',
        description: 'AI가 거래내역을 분석하여 계정과목을 자동으로 분류합니다.',
        cursorFrom: [75, 5], cursorTo: [85, 8], clickAt: [85, 8],
        mockElements: [
          { type: 'button', label: 'AI 분류 실행', x: 75, y: 3, w: 20, h: 8, color: '#8b5cf6', highlight: true },
          { type: 'table-row', label: '인건비 → 급여', x: 10, y: 30, w: 50, h: 8 },
          { type: 'badge', label: '95%', x: 62, y: 30, w: 10, h: 8, color: '#22c55e' },
          { type: 'table-row', label: '임차료 → 임대료', x: 10, y: 42, w: 50, h: 8 },
          { type: 'badge', label: '92%', x: 62, y: 42, w: 10, h: 8, color: '#22c55e' },
          { type: 'table-row', label: '기타 → 미분류', x: 10, y: 54, w: 50, h: 8 },
          { type: 'badge', label: '확인 필요', x: 62, y: 54, w: 15, h: 8, color: '#f59e0b' },
        ],
      },
      {
        title: '분류 결과 확인 및 수정',
        description: 'AI 분류 결과를 검토하고 필요한 경우 수동으로 수정합니다.',
        cursorFrom: [60, 54], cursorTo: [65, 57], clickAt: [65, 57],
        mockElements: [
          { type: 'table-row', label: '기타 출금 — ₩350,000', x: 10, y: 25, w: 55, h: 10 },
          { type: 'badge', label: '미분류', x: 67, y: 27, w: 12, h: 6, color: '#f59e0b', highlight: true },
          { type: 'card', label: '계정과목 선택', x: 60, y: 40, w: 30, h: 30, color: '#e2e8f0' },
          { type: 'text', label: '접대비', x: 63, y: 48, w: 24, h: 5 },
          { type: 'text', label: '복리후생비', x: 63, y: 55, w: 24, h: 5 },
          { type: 'text', label: '소모품비', x: 63, y: 62, w: 24, h: 5 },
        ],
      },
    ],
  },
  {
    id: 'matching',
    icon: '🔍',
    name: '매칭 엔진',
    description: '세금계산서↔거래 자동 매칭',
    route: '/matching',
    steps: [
      {
        title: '자동 매칭 실행',
        description: '"매칭 실행" 버튼으로 세금계산서와 거래내역을 AI가 자동 매칭합니다.',
        cursorFrom: [70, 5], cursorTo: [85, 8], clickAt: [85, 8],
        mockElements: [
          { type: 'button', label: '매칭 실행', x: 75, y: 3, w: 20, h: 8, color: '#2563eb', highlight: true },
          { type: 'card', label: '미매칭 12건', x: 5, y: 18, w: 25, h: 12, color: '#ef4444' },
          { type: 'card', label: '매칭 완료 48건', x: 35, y: 18, w: 25, h: 12, color: '#22c55e' },
          { type: 'card', label: '확인 필요 3건', x: 65, y: 18, w: 25, h: 12, color: '#f59e0b' },
        ],
      },
      {
        title: '매칭 결과 검토',
        description: '자동 매칭된 결과를 검토하고 신뢰도가 낮은 항목을 수동으로 확인합니다.',
        cursorFrom: [10, 40], cursorTo: [50, 55], clickAt: [50, 55],
        mockElements: [
          { type: 'table-row', label: '세금계산서 #1024 ↔ 입금 03/01', x: 5, y: 38, w: 70, h: 8 },
          { type: 'badge', label: '98%', x: 78, y: 38, w: 10, h: 8, color: '#22c55e' },
          { type: 'table-row', label: '세금계산서 #1025 ↔ 입금 03/02', x: 5, y: 48, w: 70, h: 8, highlight: true },
          { type: 'badge', label: '72%', x: 78, y: 48, w: 10, h: 8, color: '#f59e0b' },
          { type: 'button', label: '확인', x: 78, y: 58, w: 12, h: 7, color: '#2563eb', highlight: true },
        ],
      },
      {
        title: '수동 매칭',
        description: '자동 매칭이 어려운 건을 직접 세금계산서와 거래를 연결합니다.',
        cursorFrom: [15, 35], cursorTo: [55, 55], clickAt: [55, 55],
        mockElements: [
          { type: 'card', label: '세금계산서 목록', x: 3, y: 10, w: 45, h: 80, color: '#e2e8f0' },
          { type: 'card', label: '거래내역 목록', x: 52, y: 10, w: 45, h: 80, color: '#e2e8f0' },
          { type: 'table-row', label: '#1030 — ₩2,200,000', x: 6, y: 25, w: 38, h: 8, highlight: true },
          { type: 'table-row', label: '03/05 입금 ₩2,200,000', x: 55, y: 35, w: 38, h: 8, highlight: true },
        ],
      },
    ],
  },
  {
    id: 'documents',
    icon: '📝',
    name: '문서/계약',
    description: '문서 생성, 전자서명, 리비전',
    route: '/documents',
    steps: [
      {
        title: '문서 템플릿 선택',
        description: 'PI, CI, PL, 계약서 등 필요한 문서 템플릿을 선택합니다.',
        cursorFrom: [20, 20], cursorTo: [35, 35], clickAt: [35, 35],
        mockElements: [
          { type: 'card', label: 'PI (견적서)', x: 5, y: 15, w: 28, h: 25, color: '#2563eb' },
          { type: 'card', label: 'CI (상업송장)', x: 36, y: 15, w: 28, h: 25, color: '#8b5cf6' },
          { type: 'card', label: 'PL (포장명세)', x: 67, y: 15, w: 28, h: 25, color: '#ea580c' },
          { type: 'card', label: '계약서', x: 5, y: 48, w: 28, h: 25, color: '#22c55e', highlight: true },
        ],
      },
      {
        title: '전자서명 요청',
        description: '문서를 생성한 뒤, 상대방에게 전자서명을 요청합니다.',
        cursorFrom: [60, 40], cursorTo: [80, 50], clickAt: [80, 50],
        mockElements: [
          { type: 'card', label: '계약서 미리보기', x: 5, y: 10, w: 55, h: 75, color: '#f1f5f9' },
          { type: 'button', label: '서명 요청', x: 65, y: 45, w: 18, h: 8, color: '#2563eb', highlight: true },
          { type: 'badge', label: '상태: 작성완료', x: 65, y: 20, w: 25, h: 7, color: '#f59e0b' },
        ],
      },
      {
        title: '리비전 관리',
        description: '문서 수정 이력을 추적하고 이전 버전과 비교합니다.',
        cursorFrom: [65, 60], cursorTo: [80, 70], clickAt: [80, 70],
        mockElements: [
          { type: 'table-row', label: 'v3 — 2026.03.04 (현재)', x: 10, y: 30, w: 60, h: 8, highlight: true },
          { type: 'table-row', label: 'v2 — 2026.03.02', x: 10, y: 40, w: 60, h: 8 },
          { type: 'table-row', label: 'v1 — 2026.02.28 (초안)', x: 10, y: 50, w: 60, h: 8 },
          { type: 'button', label: '비교', x: 73, y: 30, w: 12, h: 7, color: '#8b5cf6', highlight: true },
        ],
      },
    ],
  },
  {
    id: 'chat',
    icon: '💬',
    name: '팀 채팅',
    description: '채널, 딜별 채팅, 멘션, 액션카드',
    route: '/chat',
    steps: [
      {
        title: '채널 참여',
        description: '팀 채널, 프로젝트 채널, DM 등 필요한 채팅방에 참여합니다.',
        cursorFrom: [5, 20], cursorTo: [20, 35], clickAt: [20, 35],
        mockElements: [
          { type: 'card', label: '채널 목록', x: 2, y: 5, w: 25, h: 90, color: '#f8fafc' },
          { type: 'text', label: '# 일반', x: 4, y: 15, w: 20, h: 5 },
          { type: 'text', label: '# 영업팀', x: 4, y: 22, w: 20, h: 5 },
          { type: 'text', label: '# 딜-ABC컴퍼니', x: 4, y: 29, w: 20, h: 5, highlight: true },
          { type: 'card', label: '채팅 영역', x: 30, y: 5, w: 67, h: 90, color: '#f8fafc' },
        ],
      },
      {
        title: '멘션으로 알림',
        description: '@이름으로 팀원을 멘션하면 즉시 알림이 전달됩니다.',
        cursorFrom: [35, 85], cursorTo: [55, 88], clickAt: [55, 88],
        mockElements: [
          { type: 'card', label: '채팅 영역', x: 5, y: 5, w: 90, h: 75 },
          { type: 'input', label: '@김팀장 견적서 확인 부탁드립니다', x: 5, y: 83, w: 75, h: 10, highlight: true },
          { type: 'button', label: '전송', x: 82, y: 83, w: 12, h: 10, color: '#2563eb' },
        ],
      },
      {
        title: '액션카드 생성',
        description: '채팅 내에서 바로 결제 요청, 문서 생성 등 액션카드를 만듭니다.',
        cursorFrom: [40, 50], cursorTo: [55, 55], clickAt: [55, 55],
        mockElements: [
          { type: 'card', label: '💰 결제 요청 액션카드', x: 15, y: 25, w: 50, h: 30, color: '#eff6ff', highlight: true },
          { type: 'text', label: '금액: ₩5,500,000', x: 20, y: 35, w: 30, h: 5 },
          { type: 'text', label: '항목: 외주 개발비', x: 20, y: 42, w: 30, h: 5 },
          { type: 'button', label: '승인', x: 25, y: 49, w: 12, h: 5, color: '#22c55e' },
          { type: 'button', label: '반려', x: 40, y: 49, w: 12, h: 5, color: '#ef4444' },
        ],
      },
    ],
  },
  {
    id: 'employees',
    icon: '👥',
    name: '인사/급여',
    description: '직원 등록, 급여 자동계산, 근태',
    route: '/employees',
    steps: [
      {
        title: '직원 등록',
        description: '이름, 부서, 직급, 연봉 등 기본 인사 정보를 등록합니다.',
        cursorFrom: [80, 5], cursorTo: [88, 8], clickAt: [88, 8],
        mockElements: [
          { type: 'button', label: '+ 직원 등록', x: 78, y: 3, w: 18, h: 8, color: '#2563eb', highlight: true },
          { type: 'input', label: '이름', x: 20, y: 22, w: 55, h: 8 },
          { type: 'input', label: '부서', x: 20, y: 34, w: 25, h: 8 },
          { type: 'input', label: '직급', x: 48, y: 34, w: 25, h: 8 },
          { type: 'input', label: '연봉', x: 20, y: 46, w: 55, h: 8 },
        ],
      },
      {
        title: '급여 자동 계산',
        description: '연봉 기준으로 4대보험, 소득세를 자동 계산하여 급여명세서를 생성합니다.',
        cursorFrom: [10, 25], cursorTo: [40, 40], clickAt: [40, 40],
        mockElements: [
          { type: 'card', label: '급여 계산', x: 5, y: 10, w: 55, h: 50, color: '#f8fafc' },
          { type: 'text', label: '기본급: ₩3,333,333', x: 10, y: 22, w: 40, h: 5 },
          { type: 'text', label: '국민연금: -₩150,000', x: 10, y: 30, w: 40, h: 5 },
          { type: 'text', label: '건강보험: -₩111,960', x: 10, y: 38, w: 40, h: 5 },
          { type: 'text', label: '소득세: -₩85,420', x: 10, y: 46, w: 40, h: 5 },
          { type: 'badge', label: '실수령: ₩2,985,953', x: 10, y: 55, w: 30, h: 8, color: '#2563eb' },
        ],
      },
      {
        title: '근태 관리',
        description: '출퇴근 기록, 연차 사용 내역, 초과근무를 한눈에 관리합니다.',
        cursorFrom: [60, 20], cursorTo: [75, 35], clickAt: [75, 35],
        mockElements: [
          { type: 'tab', label: '출퇴근', x: 5, y: 8, w: 15, h: 7, highlight: true },
          { type: 'tab', label: '연차', x: 22, y: 8, w: 12, h: 7 },
          { type: 'tab', label: '초과근무', x: 36, y: 8, w: 15, h: 7 },
          { type: 'table-row', label: '03/04 — 09:02 ~ 18:15', x: 5, y: 22, w: 60, h: 8 },
          { type: 'table-row', label: '03/03 — 08:55 ~ 18:30', x: 5, y: 32, w: 60, h: 8 },
          { type: 'badge', label: '잔여 연차: 12일', x: 70, y: 22, w: 22, h: 8, color: '#2563eb' },
        ],
      },
    ],
  },
  {
    id: 'vault',
    icon: '🔒',
    name: '금고/구독',
    description: '구독 관리, 보안 금고',
    route: '/vault',
    steps: [
      {
        title: '구독 현황 확인',
        description: '현재 OwnerView 구독 플랜, 사용량, 결제일을 확인합니다.',
        cursorFrom: [10, 15], cursorTo: [40, 25], clickAt: [40, 25],
        mockElements: [
          { type: 'card', label: 'Pro 플랜', x: 5, y: 10, w: 40, h: 20, color: '#2563eb', highlight: true },
          { type: 'text', label: '₩19,900/월', x: 10, y: 18, w: 20, h: 5 },
          { type: 'text', label: '다음 결제: 2026.04.01', x: 10, y: 25, w: 30, h: 5 },
          { type: 'badge', label: '사용량 73%', x: 50, y: 15, w: 18, h: 7, color: '#f59e0b' },
        ],
      },
      {
        title: '보안 금고',
        description: '중요 문서, 계약서, 인증서를 암호화된 금고에 안전하게 보관합니다.',
        cursorFrom: [10, 50], cursorTo: [35, 60], clickAt: [35, 60],
        mockElements: [
          { type: 'card', label: '보안 금고', x: 5, y: 40, w: 90, h: 50, color: '#f8fafc' },
          { type: 'icon-btn', label: '🔐', x: 10, y: 50, w: 8, h: 8 },
          { type: 'table-row', label: '사업자등록증.pdf', x: 20, y: 50, w: 50, h: 7 },
          { type: 'table-row', label: '통장사본_우리은행.pdf', x: 20, y: 59, w: 50, h: 7 },
          { type: 'table-row', label: '임대차계약서.pdf', x: 20, y: 68, w: 50, h: 7 },
          { type: 'button', label: '+ 파일 추가', x: 20, y: 78, w: 18, h: 7, color: '#2563eb', highlight: true },
        ],
      },
      {
        title: '플랜 변경',
        description: '필요에 따라 구독 플랜을 업그레이드 또는 다운그레이드합니다.',
        cursorFrom: [50, 15], cursorTo: [80, 20], clickAt: [80, 20],
        mockElements: [
          { type: 'card', label: 'Free', x: 5, y: 15, w: 20, h: 30, color: '#94a3b8' },
          { type: 'card', label: 'Starter', x: 28, y: 15, w: 20, h: 30, color: '#3b82f6' },
          { type: 'card', label: 'Pro', x: 51, y: 15, w: 20, h: 30, color: '#8b5cf6', highlight: true },
          { type: 'card', label: 'Enterprise', x: 74, y: 15, w: 20, h: 30, color: '#0f172a' },
          { type: 'button', label: '변경', x: 55, y: 48, w: 12, h: 7, color: '#8b5cf6', highlight: true },
        ],
      },
    ],
  },
  {
    id: 'ai',
    icon: '🤖',
    name: 'AI 어시스턴트',
    description: 'AI 분석, 자동 분류, 예측',
    route: '/ai',
    steps: [
      {
        title: 'AI 대화',
        description: '자연어로 질문하면 AI가 회사 데이터를 기반으로 분석 결과를 제공합니다.',
        cursorFrom: [30, 80], cursorTo: [55, 85], clickAt: [55, 85],
        mockElements: [
          { type: 'card', label: 'AI 채팅', x: 5, y: 5, w: 60, h: 75 },
          { type: 'text', label: '이번 달 매출 현황을 알려줘', x: 10, y: 55, w: 50, h: 5 },
          { type: 'text', label: '3월 매출 ₩45M, 전월 대비 +12%', x: 10, y: 63, w: 50, h: 5 },
          { type: 'input', label: '질문을 입력하세요...', x: 5, y: 83, w: 50, h: 8, highlight: true },
          { type: 'button', label: '전송', x: 57, y: 83, w: 8, h: 8, color: '#2563eb' },
        ],
      },
      {
        title: 'AI 자동 분류',
        description: 'AI가 거래내역, 문서 등을 자동으로 분류하고 태깅합니다.',
        cursorFrom: [70, 15], cursorTo: [85, 25], clickAt: [85, 25],
        mockElements: [
          { type: 'card', label: '대기 중인 작업', x: 68, y: 10, w: 28, h: 40 },
          { type: 'table-row', label: '거래 분류 5건', x: 70, y: 22, w: 23, h: 6 },
          { type: 'table-row', label: '문서 태깅 3건', x: 70, y: 30, w: 23, h: 6 },
          { type: 'button', label: '일괄 처리', x: 72, y: 40, w: 18, h: 7, color: '#8b5cf6', highlight: true },
        ],
      },
      {
        title: 'AI 예측',
        description: '매출, 현금흐름 등의 미래 예측치를 AI가 제공합니다.',
        cursorFrom: [10, 25], cursorTo: [40, 40], clickAt: [40, 40],
        mockElements: [
          { type: 'chart-bar', label: '매출 예측 (6개월)', x: 5, y: 10, w: 60, h: 40 },
          { type: 'badge', label: '예측 신뢰도 87%', x: 5, y: 55, w: 22, h: 8, color: '#22c55e' },
          { type: 'card', label: '예측: 6월 BEP 달성', x: 5, y: 68, w: 40, h: 12, color: '#2563eb', highlight: true },
        ],
      },
    ],
  },
  {
    id: 'settings',
    icon: '⚙️',
    name: '설정',
    description: '회사 정보, 계좌 관리, 초대',
    route: '/settings',
    steps: [
      {
        title: '회사 정보 설정',
        description: '회사명, 사업자등록번호, 주소 등 기본 정보를 설정합니다.',
        cursorFrom: [10, 15], cursorTo: [40, 30], clickAt: [40, 30],
        mockElements: [
          { type: 'input', label: '회사명', x: 10, y: 15, w: 60, h: 8 },
          { type: 'input', label: '사업자등록번호', x: 10, y: 28, w: 40, h: 8 },
          { type: 'input', label: '대표자명', x: 10, y: 41, w: 40, h: 8 },
          { type: 'input', label: '주소', x: 10, y: 54, w: 60, h: 8 },
          { type: 'button', label: '저장', x: 55, y: 67, w: 15, h: 8, color: '#2563eb', highlight: true },
        ],
      },
      {
        title: '계좌 관리',
        description: '결제에 사용할 은행 계좌를 등록하고 관리합니다.',
        cursorFrom: [10, 40], cursorTo: [30, 50], clickAt: [30, 50],
        mockElements: [
          { type: 'card', label: '우리은행 1005-xxx-xxx', x: 10, y: 15, w: 35, h: 15, color: '#2563eb' },
          { type: 'card', label: '국민은행 940-xxx-xxx', x: 50, y: 15, w: 35, h: 15, color: '#f59e0b' },
          { type: 'button', label: '+ 계좌 추가', x: 10, y: 38, w: 20, h: 8, color: '#2563eb', highlight: true },
        ],
      },
      {
        title: '팀원 초대',
        description: '이메일로 팀원을 초대하고 역할(관리자/직원/파트너)을 부여합니다.',
        cursorFrom: [10, 60], cursorTo: [50, 70], clickAt: [50, 70],
        mockElements: [
          { type: 'input', label: 'team@example.com', x: 10, y: 55, w: 40, h: 8, highlight: true },
          { type: 'badge', label: '관리자', x: 53, y: 56, w: 12, h: 6, color: '#8b5cf6' },
          { type: 'button', label: '초대', x: 68, y: 55, w: 12, h: 8, color: '#2563eb' },
          { type: 'table-row', label: '김관리 — 관리자 (활성)', x: 10, y: 70, w: 50, h: 7 },
          { type: 'table-row', label: '박직원 — 직원 (활성)', x: 10, y: 79, w: 50, h: 7 },
        ],
      },
    ],
  },
];

// ── Cursor Simulation Component ──
function CursorSimulation({
  steps,
  currentStep,
  isPlaying,
  onTogglePlay,
}: {
  steps: GuideStep[];
  currentStep: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
}) {
  const step = steps[currentStep];
  if (!step) return null;

  const renderMockElement = (el: MockElement, idx: number) => {
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: `${el.x}%`,
      top: `${el.y}%`,
      width: `${el.w}%`,
      height: `${el.h}%`,
      borderRadius: el.type === 'badge' ? '9999px' : el.type === 'button' || el.type === 'icon-btn' ? '6px' : '8px',
      transition: 'all 0.3s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: el.type === 'button' || el.type === 'badge' || el.type === 'icon-btn' ? 'center' : 'flex-start',
      fontSize: '11px',
      fontWeight: el.type === 'button' || el.type === 'badge' ? 600 : 400,
      overflow: 'hidden',
      whiteSpace: 'nowrap' as const,
      textOverflow: 'ellipsis',
    };

    switch (el.type) {
      case 'button':
        return (
          <div
            key={idx}
            style={{
              ...baseStyle,
              backgroundColor: el.highlight ? (el.color || '#2563eb') : '#e2e8f0',
              color: el.highlight ? '#fff' : '#475569',
              paddingLeft: '8px',
              paddingRight: '8px',
              boxShadow: el.highlight ? `0 2px 8px ${el.color || '#2563eb'}33` : 'none',
              cursor: 'default',
            }}
          >
            {el.label}
          </div>
        );
      case 'card':
        return (
          <div
            key={idx}
            style={{
              ...baseStyle,
              backgroundColor: '#fff',
              border: el.highlight ? `2px solid ${el.color || '#2563eb'}` : '1px solid #e2e8f0',
              color: '#1e293b',
              padding: '8px 10px',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '2px',
              boxShadow: el.highlight ? `0 0 0 3px ${(el.color || '#2563eb')}15` : '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            {el.color && (
              <div style={{ width: '20px', height: '3px', backgroundColor: el.color, borderRadius: '2px', marginBottom: '2px' }} />
            )}
            <span style={{ fontSize: '10px', fontWeight: 600 }}>{el.label}</span>
          </div>
        );
      case 'input':
        return (
          <div
            key={idx}
            style={{
              ...baseStyle,
              backgroundColor: '#fff',
              border: el.highlight ? '2px solid #2563eb' : '1px solid #d1d5db',
              color: '#9ca3af',
              paddingLeft: '8px',
              fontSize: '10px',
            }}
          >
            {el.label}
          </div>
        );
      case 'table-row':
        return (
          <div
            key={idx}
            style={{
              ...baseStyle,
              backgroundColor: el.highlight ? '#eff6ff' : '#fff',
              borderBottom: '1px solid #f1f5f9',
              color: '#334155',
              paddingLeft: '10px',
              fontSize: '10px',
            }}
          >
            {el.label}
          </div>
        );
      case 'tab':
        return (
          <div
            key={idx}
            style={{
              ...baseStyle,
              backgroundColor: 'transparent',
              borderBottom: el.highlight ? '2px solid #2563eb' : '2px solid transparent',
              color: el.highlight ? '#2563eb' : '#94a3b8',
              justifyContent: 'center',
              fontWeight: el.highlight ? 600 : 400,
              fontSize: '10px',
            }}
          >
            {el.label}
          </div>
        );
      case 'badge':
        return (
          <div
            key={idx}
            style={{
              ...baseStyle,
              backgroundColor: el.highlight ? (el.color || '#2563eb') : `${el.color || '#94a3b8'}18`,
              color: el.highlight ? '#fff' : (el.color || '#475569'),
              paddingLeft: '8px',
              paddingRight: '8px',
              fontSize: '10px',
              fontWeight: 600,
            }}
          >
            {el.label}
          </div>
        );
      case 'chart-bar':
        return (
          <div
            key={idx}
            style={{
              ...baseStyle,
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '8px',
              flexDirection: 'column',
              alignItems: 'flex-end',
              justifyContent: 'flex-end',
              gap: '3px',
            }}
          >
            <div style={{ display: 'flex', width: '100%', alignItems: 'flex-end', justifyContent: 'space-around', height: '70%', padding: '0 5%' }}>
              {[40, 65, 55, 80, 70, 90, 75].map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: '10%',
                    height: `${h}%`,
                    backgroundColor: i === 5 ? '#2563eb' : '#93c5fd',
                    borderRadius: '2px 2px 0 0',
                    transition: 'height 0.5s ease',
                  }}
                />
              ))}
            </div>
            {el.label && <span style={{ fontSize: '8px', color: '#94a3b8' }}>{el.label}</span>}
          </div>
        );
      case 'text':
        return (
          <div
            key={idx}
            style={{
              ...baseStyle,
              backgroundColor: 'transparent',
              color: el.highlight ? '#2563eb' : '#475569',
              fontSize: '10px',
              paddingLeft: '4px',
            }}
          >
            {el.label}
          </div>
        );
      case 'icon-btn':
        return (
          <div
            key={idx}
            style={{
              ...baseStyle,
              backgroundColor: '#f1f5f9',
              borderRadius: '8px',
              justifyContent: 'center',
              fontSize: '16px',
            }}
          >
            {el.label}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="relative">
      {/* Mockup area */}
      <div
        className="relative bg-gray-50 border border-gray-200 rounded-xl overflow-hidden"
        style={{ height: '280px' }}
      >
        {/* Mock elements */}
        {step.mockElements.map((el, i) => renderMockElement(el, i))}

        {/* Animated cursor */}
        <div
          className="absolute z-30 pointer-events-none"
          style={{
            animation: isPlaying
              ? `cursorMove_${currentStep} 3s ease-in-out infinite`
              : 'none',
            left: `${step.cursorFrom[0]}%`,
            top: `${step.cursorFrom[1]}%`,
          }}
        >
          {/* Cursor SVG */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z"
              fill="#2563eb"
              stroke="white"
              strokeWidth="1"
            />
          </svg>
        </div>

        {/* Click ripple */}
        {isPlaying && (
          <div
            className="absolute z-20 pointer-events-none"
            style={{
              left: `${step.clickAt[0]}%`,
              top: `${step.clickAt[1]}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              className="rounded-full border-2 border-blue-500"
              style={{
                width: '24px',
                height: '24px',
                animation: 'clickRipple 3s ease-in-out infinite',
                animationDelay: '1.5s',
                opacity: 0,
              }}
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mt-3 px-1">
        <span className="text-xs text-gray-500 font-medium">
          {currentStep + 1} / {steps.length}
        </span>
        <button
          onClick={onTogglePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700"
        >
          {isPlaying ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
              일시정지
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              재생
            </>
          )}
        </button>
      </div>

      {/* Keyframes injection */}
      <style>{`
        @keyframes cursorMove_${currentStep} {
          0% { left: ${step.cursorFrom[0]}%; top: ${step.cursorFrom[1]}%; }
          40% { left: ${step.cursorTo[0]}%; top: ${step.cursorTo[1]}%; }
          50% { left: ${step.clickAt[0]}%; top: ${step.clickAt[1]}%; transform: scale(0.85); }
          55% { transform: scale(1); }
          100% { left: ${step.clickAt[0]}%; top: ${step.clickAt[1]}%; }
        }
        @keyframes clickRipple {
          0% { opacity: 0; transform: translate(-50%,-50%) scale(0.5); }
          50% { opacity: 0; }
          55% { opacity: 0.8; transform: translate(-50%,-50%) scale(0.5); }
          80% { opacity: 0; transform: translate(-50%,-50%) scale(2.5); }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Spotlight Overlay ──
function SpotlightOverlay({
  step,
  stepIndex,
  totalSteps,
  onNext,
  onPrev,
  onClose,
}: {
  step: GuideStep;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const spot = step.spotlightArea || {
    x: step.clickAt[0] - 8,
    y: step.clickAt[1] - 5,
    w: 20,
    h: 15,
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Dark overlay with cutout */}
      <svg className="absolute inset-0 w-full h-full">
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={`${spot.x}%`}
              y={`${spot.y}%`}
              width={`${spot.w}%`}
              height={`${spot.h}%`}
              rx="12"
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#spotlight-mask)"
        />
        {/* Highlight border */}
        <rect
          x={`${spot.x}%`}
          y={`${spot.y}%`}
          width={`${spot.w}%`}
          height={`${spot.h}%`}
          rx="12"
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          className="animate-pulse"
        />
      </svg>

      {/* Tooltip */}
      <div
        className="absolute bg-white rounded-xl shadow-xl border border-gray-200 p-4 max-w-sm z-10"
        style={{
          left: `${Math.min(Math.max(spot.x, 5), 60)}%`,
          top: `${spot.y + spot.h + 3}%`,
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
            {stepIndex + 1}
          </div>
          <h4 className="font-semibold text-gray-900 text-sm">{step.title}</h4>
        </div>
        <p className="text-xs text-gray-600 mb-3 leading-relaxed">{step.description}</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {stepIndex + 1} / {totalSteps}
          </span>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button
                onClick={onPrev}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
              >
                이전
              </button>
            )}
            {stepIndex < totalSteps - 1 ? (
              <button
                onClick={onNext}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                다음
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                완료
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-white/90 hover:bg-white flex items-center justify-center text-gray-500 hover:text-gray-700 shadow transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════
export default function GuidePage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [tutorialMode, setTutorialMode] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selected = CATEGORIES.find((c) => c.id === selectedCategory);

  // Auto-advance steps
  useEffect(() => {
    if (isPlaying && selected) {
      timerRef.current = setInterval(() => {
        setCurrentStep((prev) => (prev + 1) % selected.steps.length);
      }, 4000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, selected]);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  const handleCategoryClick = useCallback((id: string) => {
    setSelectedCategory(id);
    setCurrentStep(0);
    setIsPlaying(true);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedCategory(null);
    setCurrentStep(0);
    setIsPlaying(true);
  }, []);

  const startTutorial = useCallback(() => {
    setTutorialMode(true);
    setTutorialStep(0);
  }, []);

  // Filter categories by search
  const filteredCategories = searchQuery.trim()
    ? CATEGORIES.filter(
        (c) =>
          c.name.includes(searchQuery) ||
          c.description.includes(searchQuery) ||
          c.steps.some((s) => s.title.includes(searchQuery) || s.description.includes(searchQuery))
      )
    : CATEGORIES;

  // ── Category Grid View ──
  if (!selectedCategory) {
    return (
      <div className="min-h-screen bg-gray-50/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">사용 가이드</h1>
            <p className="text-sm text-gray-500">
              OwnerView의 모든 기능을 빠르게 배워보세요
            </p>
          </div>

          {/* Search */}
          <div className="relative mb-6">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="기능 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
            />
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              { label: '전체 기능', value: '14개', color: '#2563eb' },
              { label: '가이드 스텝', value: `${CATEGORIES.reduce((a, c) => a + c.steps.length, 0)}개`, color: '#8b5cf6' },
              { label: '인터랙티브', value: '커서 시뮬레이션', color: '#16a34a' },
              { label: '튜토리얼', value: '스포트라이트', color: '#ea580c' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                <div className="text-xs text-gray-500 mb-0.5">{stat.label}</div>
                <div className="text-sm font-semibold" style={{ color: stat.color }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Category Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategoryClick(cat.id)}
                className="group bg-white rounded-xl border border-gray-100 p-5 text-left shadow-sm hover:shadow-md hover:border-blue-200 transition-all duration-200"
              >
                <div className="flex items-start gap-3">
                  <div className="text-2xl flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform duration-200">
                    {cat.icon}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 text-sm mb-1 group-hover:text-blue-600 transition-colors">
                      {cat.name}
                    </h3>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      {cat.description}
                    </p>
                    <div className="mt-2 flex items-center gap-1 text-xs text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <span>가이드 보기</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {filteredCategories.length === 0 && (
            <div className="text-center py-16">
              <div className="text-3xl mb-3">🔍</div>
              <p className="text-sm text-gray-500">
                &quot;{searchQuery}&quot;에 해당하는 가이드가 없습니다
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Detail View ──
  if (!selected) return null;

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Back + Header */}
        <div className="mb-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            전체 가이드
          </button>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">{selected.icon}</span>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{selected.name}</h1>
              <p className="text-sm text-gray-500">{selected.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <Link
              href={selected.route}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm"
            >
              해당 메뉴로 이동
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <button
              onClick={startTutorial}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              튜토리얼 모드
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Step List (left) */}
          <div className="lg:col-span-2 space-y-3">
            {selected.steps.map((step, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setCurrentStep(idx);
                  setIsPlaying(false);
                }}
                className={`w-full text-left p-4 rounded-xl border transition-all duration-200 ${
                  currentStep === idx
                    ? 'bg-blue-50 border-blue-200 shadow-sm'
                    : 'bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      currentStep === idx
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {idx + 1}
                  </div>
                  <div>
                    <h4
                      className={`text-sm font-semibold mb-0.5 transition-colors ${
                        currentStep === idx ? 'text-blue-700' : 'text-gray-900'
                      }`}
                    >
                      {step.title}
                    </h4>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Simulation Area (right) */}
          <div className="lg:col-span-3">
            <div className="sticky top-6">
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {selected.steps[currentStep]?.title}
                  </h3>
                  <div className="flex items-center gap-1">
                    {selected.steps.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setCurrentStep(idx);
                          setIsPlaying(false);
                        }}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          currentStep === idx ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <CursorSimulation
                  steps={selected.steps}
                  currentStep={currentStep}
                  isPlaying={isPlaying}
                  onTogglePlay={togglePlay}
                />
                <p className="mt-3 text-xs text-gray-500 leading-relaxed">
                  {selected.steps[currentStep]?.description}
                </p>
              </div>

              {/* Navigation Tips */}
              <div className="mt-4 bg-blue-50 rounded-xl border border-blue-100 p-4">
                <div className="flex items-start gap-2">
                  <svg className="flex-shrink-0 mt-0.5 text-blue-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                  <div>
                    <p className="text-xs font-medium text-blue-800 mb-0.5">팁</p>
                    <p className="text-xs text-blue-700 leading-relaxed">
                      좌측 단계를 클릭하면 해당 동작의 시뮬레이션을 확인할 수 있습니다.
                      &quot;튜토리얼 모드&quot;를 활성화하면 스포트라이트 가이드가 시작됩니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Spotlight Overlay */}
      {tutorialMode && selected && selected.steps[tutorialStep] && (
        <SpotlightOverlay
          step={selected.steps[tutorialStep]}
          stepIndex={tutorialStep}
          totalSteps={selected.steps.length}
          onNext={() => setTutorialStep((p) => Math.min(p + 1, selected.steps.length - 1))}
          onPrev={() => setTutorialStep((p) => Math.max(p - 1, 0))}
          onClose={() => {
            setTutorialMode(false);
            setTutorialStep(0);
          }}
        />
      )}
    </div>
  );
}
