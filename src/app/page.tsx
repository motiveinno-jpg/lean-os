"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { RollingBrandText } from "@/components/brand-logo";
import { supabase } from "@/lib/supabase";

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
const COMPETITORS = [
  { name: "플*스", full: "Flex", cat: "HR/급여", price: "70,000", letter: "F", color: "#6366F1" },
  { name: "먼*이", full: "Monday", cat: "프로젝트", price: "16,000", letter: "M", color: "#FF3D57" },
  { name: "모두*인", full: "Modusign", cat: "전자계약", price: "39,900", letter: "M", color: "#1A73E8" },
  { name: "리*버", full: "Remember", cat: "CRM", price: "4,900", letter: "R", color: "#00BFA5" },
  { name: "채*톡", full: "Channel", cat: "채팅", price: "120,000", letter: "C", color: "#FFCA28" },
  { name: "시*티", full: "Shiftee", cat: "근태", price: "4,000", letter: "S", color: "#9C27B0" },
  { name: "자*스", full: "Jobis", cat: "세무", price: "33,000", letter: "J", color: "#FF6D00" },
];

const PLANS = [
  { name: "무료체험", regularPrice: null, betaPrice: "0", unit: "원", period: "카드 등록 없이 14일", desc: "전 기능 체험", perSeat: null, hl: false, discount: null, features: ["14일간 전 기능 무료 체험", "은행·카드 실계좌 연동", "전자서명 월 3건", "AI 분석 월 5회", "경영 대시보드·리포트", "팀 메신저·게시판"] },
  { name: "프로", regularPrice: null, betaPrice: "55,000", unit: "원/월", period: "VAT 별도 · 인원 무제한", desc: "성장하는 팀의 표준", perSeat: null, hl: true, discount: null, features: ["직원 / 프로젝트 무제한", "은행·카드 자동 동기화", "전자계약 · 전자결재 무제한", "AI 거래 분류 · 리포트 무제한", "거래처 / 파트너 무제한", "재무제표 · 경영흐름 콕핏", "세금계산서·현금영수증 국세청 발행 월 10건"] },
  { name: "울트라", regularPrice: null, betaPrice: "88,000", unit: "원/월", period: "VAT 별도 · 데이터 헤비유저", desc: "동기화·자동화 최대치", perSeat: null, hl: false, discount: null, features: ["기본요금제 전체 +", "세금계산서·현금영수증 국세청 발행 무제한", "AI 브리핑 — 매일 우선순위 액션 플랜", "신기능 우선 제공", "우선 지원"] },
  { name: "엔터프라이즈", regularPrice: null, betaPrice: "별도 협의", unit: "", period: "맞춤 도입 · 50인+", desc: "대규모 · 커스텀", perSeat: null, hl: false, discount: null, features: ["울트라 전체 +", "전담 온보딩 · CSM", "맞춤 기능 개발", "기존 데이터 이관 지원", "SLA 보장"] },
];

const FAQS = [
  { q: "기존 엑셀/관리파일을 가져올 수 있나요?", a: "네. 거래처 목록과 은행·카드 거래내역은 엑셀/CSV 파일을 업로드하면 바로 등록됩니다. 직원 명단 등 다른 데이터는 현재 수동 등록만 지원합니다." },
  { q: "각 기능이 전문 솔루션 수준인가요?", a: "OwnerView의 각 기능은 해당 분야 전문 솔루션과 동등한 품질을 제공합니다. 차이점은 모든 기능이 유기적으로 연결된다는 것입니다." },
  { q: "무료→유료 전환 시 데이터 유지되나요?", a: "물론입니다. 모든 데이터는 100% 유지되며 추가 설정 없이 즉시 확장 기능을 사용할 수 있습니다." },
  { q: "파트너사도 함께 사용할 수 있나요?", a: "네. 링크 하나로 초대 가능하며 별도 요금 없이 프로젝트 확인, 서류 검토, 채팅에 참여할 수 있습니다." },
  { q: "직원은 어떻게 합류하나요?", a: "관리자가 이메일로 초대하거나, 직원이 회사 사업자등록번호로 가입 후 합류 요청을 보내면 관리자 승인 한 번으로 연결됩니다. 카카오/구글 계정으로도 가입할 수 있습니다." },
  { q: "보안은 안전한가요?", a: "역할기반 접근제어(RBAC), 감사로그, SOC2 인증 인프라(Supabase)를 사용하며, 모든 통신은 TLS로 암호화됩니다." },
  { q: "도입 비용이나 세팅비가 있나요?", a: "없습니다. 가입 즉시 사용 가능하며, Enterprise 플랜의 경우 무료 온보딩 지원을 제공합니다." },
];

const FEATURES = [
  {
    tab: "전자결재",
    sim: "payment",
    replaces: "플*스 + 시*티",
    title: "요청 → 결재선 자동 배정 → 원클릭 승인",
    desc: "경비, 지출, 휴가 — 모든 요청이 하나의 결재함에서 관리됩니다. 다단계 결재선, 금액별 자동승인, 우리 회사만의 결재 양식 빌더까지.",
  },
  {
    tab: "프로젝트 파이프라인",
    sim: "pipeline",
    replaces: "먼*이",
    title: "견적 → 계약 → 전자서명까지 한 흐름으로",
    desc: "프로젝트의 전체 라이프사이클을 한 화면에서 관리합니다. 견적 승인 시 계약서 초안 원클릭 생성(설정 시), 협력사 견적 수취, 칸반/테이블 멀티뷰, 휴면 프로젝트 감지(수동 실행).",
  },
  {
    tab: "전자계약",
    sim: "contract",
    replaces: "모두*인",
    title: "문서 작성 → 서명 요청 → 완료까지 원스톱",
    desc: "계약서를 작성해 서명 요청을 보내고, 직인을 자동 합성해 조직 단위로 일괄 발송할 수 있습니다. 완료된 계약서는 일괄 PDF로 내려받을 수 있습니다.",
  },
  {
    tab: "HR & 급여",
    sim: "payroll",
    replaces: "플*스",
    title: "4대보험/원천세 자동 계산 → 명세서 자동 발송",
    desc: "국민연금 4.5%/건보 3.545%*/고용 0.9%/소득세 간이세액표 자동 적용. 급여명세서 생성→대표 승인→전 직원 이메일 자동 발송. 근태·연차·연장근무 자동 퇴근까지.",
  },
  {
    tab: "팀 & 파트너 채팅",
    sim: "chat",
    replaces: "채*톡",
    title: "프로젝트별 채널 + 파트너 실시간 소통 + 액션카드",
    desc: "프로젝트·팀·DM 채널과 파일 공유, 멘션. 외부 파트너도 초대 한 번으로 합류, 플로팅 메신저로 어느 화면에서든 대화.",
  },
  {
    tab: "고객 DB",
    sim: "crm",
    replaces: "리*버",
    title: "거래처 하나에 프로젝트·계약·매출 이력이 쌓입니다",
    desc: "거래처별 프로젝트 이력, 계약서, 매출, 커뮤니케이션 기록이 한곳에 연결됩니다. 휴면 거래처는 버튼 한 번으로 감지하고 리마인더를 보낼 수 있습니다.",
  },
  {
    tab: "서류 자동관리",
    sim: "document",
    replaces: "자*스 + 드라이브",
    title: "작성 → 서명 → 리비전 관리까지 한곳에서",
    desc: "견적서/계약서/급여명세서 등 서류를 작성·서명하고, 리비전·버전을 추적합니다. 회사 스토리지에 안전하게 보관됩니다.",
  },
];

// ═══════════════════════════════════════════
// HERO ROLLING TEXT
// ═══════════════════════════════════════════
const ROLLING_WORDS = ["매출", "계약", "자금", "업무", "조직", "세무"];
const ROLLING_DURATION = 2000;

function RollingText() {
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    const hideTimer = setTimeout(() => setShow(false), ROLLING_DURATION - 300);
    const nextTimer = setTimeout(() => {
      setIdx((i) => (i + 1) % ROLLING_WORDS.length);
      setShow(true);
    }, ROLLING_DURATION);
    return () => { clearTimeout(hideTimer); clearTimeout(nextTimer); };
  }, [idx]);

  return (
    <span className="rolling-text-wrap">
      <span
        className="rolling-text-item"
        style={{
          color: "var(--primary, #2563EB)",
          fontWeight: 800,
          transform: show ? "translateY(0)" : "translateY(-110%)",
          opacity: show ? 1 : 0,
        }}
      >
        {ROLLING_WORDS[idx]}
      </span>
    </span>
  );
}

function OwnerViewLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="40" height="40" rx="10" fill="#111"/>
      <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.2" fill="none"/>
      <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="2.8" strokeLinecap="round"/>
      <polyline points="12,20 15,18 18,19 22,14" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="22" cy="14" r="1.5" fill="#3b82f6"/>
    </svg>
  );
}

// ═══════════════════════════════════════════
// 4 ENGINES — OwnerView의 핵심 자동화 엔진
// ═══════════════════════════════════════════
const ENGINES = [
  {
    num: "01",
    name: "생존 레이더",
    eng: "Survival Radar",
    icon: "🛡️",
    tagline: "\"우리 회사, 지금 속도면 몇 개월?\" — AI가 매일 답합니다",
    headline: "흩어진 통장을 하나로. 위험은 대표가 묻기 전에 알립니다.",
    desc: "은행 통장·법인카드를 실계좌로 연동하면 잔고와 거래내역이 하루 2회 자동 동기화됩니다. 현금 소진 시점 예측, 생존 개월 수 자동 계산. 현금이 바닥나기 전에 먼저 경고합니다.",
    replaces: "CFO 1명",
    replacesCost: "연 6,000만원",
    color: "#818CF8",
    metrics: [
      { label: "현금 잔고", value: "₩8.2억", sub: "+12%" },
      { label: "생존 개월", value: "4.6개월", sub: "+0.8" },
      { label: "리스크 감지", value: "3건", sub: "실시간" },
    ],
    apis: ["은행·카드 실계좌 연동", "세금계산서·현금영수증 관리", "재무 자동분석", "AI 거래 분류"],
    steps: [
      { step: "계좌 연동", detail: "은행 통장·법인카드 연결 → 잔고·거래내역 자동 동기화" },
      { step: "AI 분류", detail: "수입/지출 자동 분류 + 고정비 패턴 감지" },
      { step: "선제 알림", detail: "현금 소진 시점 예측 + 위험 신호 대표 알림" },
    ],
    features: [
      { icon: "📊", name: "6-Pack 생존지표", desc: "현금·매출·고정비·미수금·생존기간·마진율" },
      { icon: "🔮", name: "경영 흐름 콕핏", desc: "과거 실적부터 90일 현금 예측까지 한 화면" },
      { icon: "⚠️", name: "미수금 자동 경고", desc: "30일 초과 미수금 즉시 알림" },
      { icon: "📈", name: "재무제표 자동 생성", desc: "손익계산서·비용 분석 리포트" },
    ],
  },
  {
    num: "02",
    name: "원클릭 파이프라인",
    eng: "Auto Pipeline",
    icon: "⚡",
    tagline: "견적서 하나 보내면 — 계약·서명까지 한 흐름으로",
    headline: "대표는 승인 버튼만. 계약서 초안은 엔진이 만듭니다.",
    desc: "프로젝트가 성사되면? 견적서→계약서 초안 원클릭 생성(설정 시)→편집→서명 요청 발송. 칸반/테이블로 전체 진행 상황을 한 화면에서 파악합니다.",
    replaces: "영업관리자 + 경리",
    replacesCost: "연 8,000만원",
    color: "#818CF8",
    metrics: [
      { label: "진행 프로젝트", value: "12건", sub: "활성" },
      { label: "평균 수금", value: "D+7", sub: "-12일 단축" },
      { label: "계약 초안", value: "원클릭", sub: "설정 시" },
    ],
    apis: ["전자서명 엔진", "세금계산서 관리", "이메일/알림", "입금 매칭"],
    steps: [
      { step: "견적→계약", detail: "견적 승인 시 계약서 초안 자동 생성(설정 필요) → 내용 작성 후 서명 요청" },
      { step: "서명→완료", detail: "서명 완료 시 계약서 잠금 + 완료 알림" },
      { step: "입금→매칭", detail: "입금 확인 → 송장 매칭 제안 → 확인 후 확정 시 전표 자동 기장" },
    ],
    features: [
      { icon: "📋", name: "칸반 파이프라인", desc: "드래그앤드롭 프로젝트 관리 + 테이블 뷰" },
      { icon: "💬", name: "프로젝트별 전용 채팅", desc: "프로젝트마다 전용 채널 자동 연결" },
      { icon: "😴", name: "휴면 프로젝트 감지", desc: "버튼 한 번으로 미움직임 프로젝트 표시" },
      { icon: "💰", name: "매출 스케줄 추적", desc: "선금/잔금 분리 관리 + 입금 확인" },
    ],
  },
  {
    num: "03",
    name: "AI 인사/총무팀",
    eng: "AI Back Office",
    icon: "🤖",
    tagline: "급여·4대보험·경비·근태·서류 — 사람 대신 AI가 24시간",
    headline: "매월 25일, 대표는 '승인' 한 번. 나머지는 전부 자동.",
    desc: "국민연금 4.5%, 건보 3.545%, 고용 0.9%, 소득세 간이세액표 — 전부 자동 산출. 급여명세서 생성부터 전 직원 이메일 발송까지. 경비 영수증도 OCR로 자동 인식·분류.",
    replaces: "회계 + 인사 담당자",
    replacesCost: "연 4,500만원",
    color: "#818CF8",
    metrics: [
      { label: "급여 처리", value: "자동", sub: "매월 25일" },
      { label: "4대보험", value: "자동계산", sub: "2026 요율" },
      { label: "경비 처리", value: "12건/월", sub: "AI 분류" },
    ],
    apis: ["4대보험공단 요율", "국세청 간이세액표", "급여 배치처리", "자동 명세서"],
    steps: [
      { step: "직원 등록", detail: "4대보험·원천세 요율 자동 매칭" },
      { step: "배치 생성", detail: "급여 배치 생성 시 전 직원 4대보험·원천세 자동 산출 → 대표 검토" },
      { step: "명세서 발송", detail: "대표 승인 → 전 직원 급여명세서 이메일 자동 발송" },
    ],
    features: [
      { icon: "⏰", name: "자동 근태관리", desc: "출퇴근·연차·연장근무 신청·자동 퇴근 처리" },
      { icon: "🧾", name: "경비 OCR 정산", desc: "영수증 촬영 → 자동 인식 → 승인 → 정산" },
      { icon: "📝", name: "근로계약서 전자서명", desc: "계약서 작성 후 전자서명 요청·완료" },
      { icon: "📂", name: "서류 자동관리", desc: "생성·분류·저장·백업·버전관리 올인원" },
    ],
  },
  {
    num: "04",
    name: "거래처 자산화",
    eng: "Client Asset Engine",
    icon: "🏢",
    tagline: "한번 등록한 거래처가 회사의 가장 큰 자산이 됩니다",
    headline: "담당자가 퇴사해도, 고객 관계는 회사에 남습니다.",
    desc: "거래처를 등록하면 프로젝트, 계약서, 매출 등 모든 상호작용이 자동으로 연결·축적됩니다. 휴면 거래처는 버튼 한 번으로 감지해 담당자에게 리마인더를 보낼 수 있습니다.",
    replaces: "CRM + 명함관리 구독",
    replacesCost: "연 200만원+",
    color: "#818CF8",
    metrics: [
      { label: "거래처", value: "47개", sub: "등록" },
      { label: "이력 추적", value: "자동", sub: "견적·계약·매출" },
      { label: "휴면 감지", value: "1클릭", sub: "리마인더 발송" },
    ],
    apis: ["사업자 정보 조회", "거래 이력 추적", "파트너 포털", "채권·채무 원장"],
    steps: [
      { step: "거래처 등록", detail: "거래처 등록 시 프로젝트·계약·매출 이력이 자동 연결" },
      { step: "휴면 감지", detail: "버튼 한 번으로 미거래 거래처 감지·표시" },
      { step: "관계 유지", detail: "휴면 거래처 담당자에게 리마인더 발송 + 파트너 포털" },
    ],
    features: [
      { icon: "📋", name: "거래 이력 자동 축적", desc: "프로젝트·계약·매출·문서가 거래처에 자동 연결" },
      { icon: "🔗", name: "파트너 포털", desc: "링크 하나로 초대, 서류 확인·채팅 참여" },
      { icon: "🏢", name: "사업자 자동조회", desc: "사업자등록번호로 기업정보 자동 입력" },
      { icon: "📒", name: "거래처 원장", desc: "미수금·미지급금 잔액 자동 대사(채권·채무)" },
    ],
  },
];

// 엔진 아이콘 — 이모지 대신 앱(사이드바·리포트)과 동일한 SVG 라인 아이콘 (사장님: 오너뷰엔 이모지 없음)
function EngineGlyph({ num }: { num: string }) {
  const p = { fill: "none" as const, stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 24 24", width: 26, height: 26 };
  switch (num) {
    case "01": return <svg {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>;
    case "02": return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>;
    case "03": return <svg {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>;
    default: return <svg {...p}><path d="M3 21h18M6 21V4h9v17M9 8h3M9 12h3M9 16h3M18 21V9h-3" /></svg>;
  }
}

// ═══════════════════════════════════════════
// SIMULATION COMPONENTS
// ═══════════════════════════════════════════

function PaymentSim() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 20), 266);
    return () => clearInterval(t);
  }, []);

  const items = [
    { name: "AWS 서버 비용", amount: "₩1,230,000", cat: "IT 인프라", status: step >= 2 ? (step >= 6 ? "완료" : step >= 4 ? "승인" : "대기") : "요청" },
    { name: "3월 급여 일괄", amount: "₩18,500,000", cat: "급여", status: step >= 8 ? (step >= 12 ? "완료" : step >= 10 ? "승인" : "대기") : "요청" },
    { name: "스파크플러스 임대료", amount: "₩2,800,000", cat: "고정비", status: step >= 14 ? (step >= 18 ? "완료" : step >= 16 ? "승인" : "대기") : "요청" },
  ];
  const statusColor: Record<string, string> = { "요청": "#94A3B8", "대기": "#F59E0B", "승인": "#3B82F6", "완료": "#10B981" };

  return (
    <div className="payment-sim-card">
      <div className="payment-sim-header lp-row-between">
        <span className="text-xs font-bold text-blue-400">PAYMENT QUEUE</span>
        <span className="payment-sim-count-badge">{items.filter(i => i.status === "완료").length}/3 처리됨</span>
      </div>
      <div className="payment-sim-list">
        {items.map((item, i) => (
          <div key={i} className="payment-sim-item" style={{ opacity: 1, transform: step > i * 4 ? "translateX(0)" : "translateX(20px)" }}>
            <div className="payment-sim-status-icon" style={{ background: `${statusColor[item.status]}20`, color: statusColor[item.status] }}>
              {item.status === "완료" ? "✓" : item.status === "승인" ? "→" : item.status === "대기" ? "!" : "•"}
            </div>
            <div className="payment-sim-item-info">
              <div className="text-xs font-semibold truncate">{item.name}</div>
              <div className="text-[10px] text-slate-400">{item.cat}</div>
            </div>
            <div className="payment-sim-item-amount">
              <div className="text-xs font-bold">{item.amount}</div>
              <div className="text-[10px] font-medium" style={{ color: statusColor[item.status] }}>{item.status}</div>
            </div>
          </div>
        ))}
      </div>
      {/* Progress bar */}
      <div className="payment-sim-progress-track">
        <div className="payment-sim-progress-fill" style={{ width: `${Math.min(100, (step / 18) * 100)}%` }} />
      </div>
    </div>
  );
}

function PipelineSim() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 16), 294);
    return () => clearInterval(t);
  }, []);

  const stages = ["견적", "계약", "세금계산서", "입금확인"];
  const activeStage = Math.min(3, Math.floor(step / 4));

  return (
    <div className="pipeline-sim-card lp-card-dark">
      <div className="pipeline-sim-header">
        <span className="text-xs font-bold text-blue-400">DEAL PIPELINE</span>
        <span className="text-[10px] text-slate-400">그**이 식품 납품</span>
      </div>
      {/* Pipeline stages */}
      <div className="pipeline-sim-stages">
        {stages.map((s, i) => (
          <div key={i} className="pipeline-sim-stage">
            <div className={`pipeline-sim-stage-bar ${i <= activeStage ? "bg-blue-500" : "bg-white/10"}`} />
            <span className={`pipeline-sim-stage-label ${i <= activeStage ? "text-blue-300" : "text-slate-500"}`}>{s}</span>
          </div>
        ))}
      </div>
      {/* Current action card */}
      <div className="pipeline-sim-action-card">
        <div className="pipeline-sim-action-header">
          <div className="pipeline-sim-action-icon">
            <span className="text-[10px]">{activeStage === 0 ? "📋" : activeStage === 1 ? "✍️" : activeStage === 2 ? "🧾" : "💰"}</span>
          </div>
          <span className="text-xs font-bold">{stages[activeStage]} {activeStage < 2 ? "자동 생성" : activeStage === 2 ? "연결" : "확인"}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span>금액: ₩35,000,000</span>
          <span className="text-emerald-400">자동 처리 중...</span>
        </div>
        <div className="pipeline-sim-progress-row">
          {[1, 2, 3].map((n) => (
            <div key={n} className="pipeline-sim-progress-track">
              <div className="pipeline-sim-progress-fill" style={{ width: step % 4 >= n ? "100%" : "0%" }} />
            </div>
          ))}
        </div>
      </div>
      {/* Stats */}
      <div className="pipeline-sim-stats">
        {[
          { label: "진행 프로젝트", value: "12건" },
          { label: "이번 달 매출", value: "₩4.2억" },
          { label: "평균 마진", value: "32%" },
        ].map((s) => (
          <div key={s.label} className="pipeline-sim-stat-tile">
            <div className="text-[10px] text-slate-500">{s.label}</div>
            <div className="text-xs font-bold">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContractSim() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 15), 322);
    return () => clearInterval(t);
  }, []);

  const phase = step < 4 ? 0 : step < 8 ? 1 : step < 12 ? 2 : 3;
  const phases = ["초안 작성", "검토 요청", "전자 서명", "계약 완료"];
  const phaseIcon = ["📝", "👀", "✍️", "✅"];

  return (
    <div className="contract-sim-card lp-card-dark">
      <div className="contract-sim-header lp-row-between">
        <span className="text-xs font-bold text-blue-400">E-CONTRACT</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">{phases[phase]}</span>
      </div>
      {/* Document preview */}
      <div className="contract-sim-doc-preview">
        <div className="contract-sim-doc-header">
          <span className="text-lg">{phaseIcon[phase]}</span>
          <div>
            <div className="text-xs font-bold">용역 계약서 v2.1</div>
            <div className="text-[10px] text-slate-400">(주)그**이 × (주)모**브</div>
          </div>
        </div>
        {/* Document lines */}
        {[80, 65, 90, 70, 55].map((w, i) => (
          <div key={i} className="contract-sim-doc-line" style={{ width: `${w}%` }}>
            <div className="contract-sim-doc-line-fill" style={{ width: phase >= 1 ? "100%" : "0%" }} />
          </div>
        ))}
        {/* Signature area */}
        {phase >= 2 && (
          <div className="contract-sim-signature-area">
            <div className="contract-sim-signature-box-us">
              <div className="text-[10px] text-slate-400 mb-1">갑</div>
              <div className={`text-xs font-bold transition-all duration-500 ${phase >= 3 ? "text-emerald-400" : "text-slate-500"}`}>
                {phase >= 3 ? "채희웅 ✓" : "서명 대기"}
              </div>
            </div>
            <div className="contract-sim-signature-box-them">
              <div className="text-[10px] text-slate-400 mb-1">을</div>
              <div className={`text-xs font-bold transition-all duration-500 ${phase >= 3 ? "text-blue-400" : "text-slate-500"}`}>
                {phase >= 3 ? "김대표 ✓" : "서명 대기"}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Phase indicator */}
      <div className="contract-sim-phase-row">
        {phases.map((p, i) => (
          <div key={i} className={`contract-sim-phase-item ${i <= phase ? "bg-blue-500/20 text-blue-300" : "bg-white/5 text-slate-500"}`}>
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}

function PayrollSim() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 12), 368);
    return () => clearInterval(t);
  }, []);

  const employees = [
    { name: "김민수", base: 3500000, net: 2891000 },
    { name: "이서연", base: 4200000, net: 3462000 },
    { name: "박지호", base: 3800000, net: 3133000 },
  ];
  const showCalc = step >= 3;
  const showResult = step >= 6;
  const showApprove = step >= 9;

  return (
    <div className="payroll-sim-card lp-card-dark">
      <div className="payroll-sim-header lp-row-between">
        <span className="text-xs font-bold text-blue-400">PAYROLL</span>
        <span className="text-[10px] text-slate-400">2026년 3월</span>
      </div>
      <div className="payroll-sim-list">
        {employees.map((emp, i) => (
          <div key={i} className="payroll-sim-item" style={{ opacity: step > i ? 1 : 0.3 }}>
            <div className="payroll-sim-avatar">{emp.name[0]}</div>
            <div className="payroll-sim-info">
              <div className="text-xs font-semibold">{emp.name}</div>
              <div className="text-[10px] text-slate-400">기본급 ₩{(emp.base / 10000).toLocaleString()}만</div>
            </div>
            <div className="payroll-sim-amount">
              {showCalc && (
                <div className="text-[10px] text-rose-400 line-through transition-all duration-500">-₩{((emp.base - emp.net) / 10000).toFixed(0)}만</div>
              )}
              {showResult && (
                <div className="text-xs font-bold text-emerald-400 transition-all duration-500">₩{(emp.net / 10000).toFixed(0)}만</div>
              )}
            </div>
          </div>
        ))}
      </div>
      {showCalc && (
        <div className="payroll-sim-deduction-grid">
          {["국민연금 4.5%", "건보 3.545%*", "고용 0.9%", "소득세"].map((d) => (
            <div key={d} className="payroll-sim-deduction-tile">{d}</div>
          ))}
        </div>
      )}
      {showApprove && (
        <div className="payroll-sim-approve-banner">
          대표 승인 완료 → 명세서 일괄 발송 중
        </div>
      )}
    </div>
  );
}

function AISim() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 18), 220);
    return () => clearInterval(t);
  }, []);

  const alerts = [
    { type: "위험", msg: "A사 미수금 30일 초과 — ₩12,000,000", color: "#EF4444", show: step >= 2 },
    { type: "주의", msg: "현금 소진 예상: 1.8개월", color: "#F59E0B", show: step >= 5 },
    { type: "자동", msg: "거래내역 47건 자동 분류 완료", color: "#3B82F6", show: step >= 8 },
    { type: "예측", msg: "3월 예상 매출: ₩2.8억 (전월 +15%)", color: "#10B981", show: step >= 11 },
    { type: "추천", msg: "고정비 12% 절감 가능 (상세 보기)", color: "#8B5CF6", show: step >= 14 },
  ];

  return (
    <div className="ai-sim-card lp-card-dark">
      <div className="ai-sim-header lp-row-between">
        <span className="text-xs font-bold text-blue-400">AI ENGINE</span>
        <div className="ai-sim-live-indicator">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-[10px] text-emerald-400">실시간 분석 중</span>
        </div>
      </div>
      <div className="ai-sim-list">
        {alerts.map((a, i) => (
          <div
            key={i}
            className="ai-sim-alert"
            style={{ opacity: a.show ? 1 : 0, transform: a.show ? "translateY(0)" : "translateY(10px)" }}
          >
            <div className="ai-sim-alert-icon" style={{ background: `${a.color}20`, color: a.color }}>
              {a.type[0]}
            </div>
            <div className="ai-sim-alert-text">
              <div className="text-[10px] font-medium" style={{ color: a.color }}>{a.type}</div>
              <div className="text-[11px] text-slate-300 truncate">{a.msg}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatSim() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 16), 235);
    return () => clearInterval(t);
  }, []);

  const msgs = [
    { from: "김대리", role: "팀원", msg: "그**이 3월분 견적서 검토 부탁드립니다", time: "14:02", show: step >= 1 },
    { from: "시스템", role: "AI", msg: "📋 견적서 #Q-2024-031 자동 생성 완료 — ₩35,000,000", time: "14:02", show: step >= 3, isAction: true },
    { from: "채대표", role: "대표", msg: "확인했습니다. 승인합니다.", time: "14:05", show: step >= 5 },
    { from: "시스템", role: "AI", msg: "✅ 견적 승인 → 계약서 자동 생성 중...", time: "14:05", show: step >= 7, isAction: true },
    { from: "파트너", role: "외부", msg: "계약서 서명 완료했습니다", time: "14:30", show: step >= 9, isPartner: true },
    { from: "시스템", role: "AI", msg: "🧾 매출 등록 + 입금 스케줄 자동 추적 시작", time: "14:30", show: step >= 11, isAction: true },
  ];

  return (
    <div className="chat-sim-card lp-card-dark">
      <div className="chat-sim-header lp-row-between">
        <span className="text-xs font-bold text-blue-400">TEAM CHAT</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">실시간</span>
      </div>
      <div className="chat-sim-list">
        {msgs.map((m, i) => (
          <div key={i} className={`chat-sim-message ${m.show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}>
            <div className={`chat-sim-avatar ${m.isAction ? "bg-blue-500/20 text-blue-400" : m.isPartner ? "bg-purple-500/20 text-purple-400" : "bg-white/10 text-slate-400"}`}>
              {m.isAction ? "AI" : m.from[0]}
            </div>
            <div className={`chat-sim-bubble ${m.isAction ? "bg-blue-500/10 border border-blue-500/20 text-blue-300" : "bg-white/5 text-slate-300"}`}>
              <div className="chat-sim-bubble-meta">
                <span className="font-semibold text-[10px]">{m.from}</span>
                <span className="text-[9px] text-slate-500">{m.time}</span>
              </div>
              {m.msg}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CRMSim() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 14), 265);
    return () => clearInterval(t);
  }, []);

  const clients = [
    { name: "(주)그**이", deals: 5, total: "₩1.8억", last: "2일 전", status: "활성", show: step >= 1 },
    { name: "(주)한**업", deals: 3, total: "₩9,500만", last: "5일 전", status: "활성", show: step >= 3 },
    { name: "블**션 LLC", deals: 2, total: "₩6,200만", last: "12일 전", status: "주의", show: step >= 5 },
    { name: "스**텍", deals: 1, total: "₩3,400만", last: "25일 전", status: "휴면", show: step >= 7 },
  ];
  const showInsight = step >= 10;

  return (
    <div className="crm-sim-card lp-card-dark">
      <div className="crm-sim-header lp-row-between">
        <span className="text-xs font-bold text-blue-400">CLIENT DB</span>
        <span className="text-[10px] text-slate-400">{clients.filter(c => c.show).length}개 거래처</span>
      </div>
      <div className="crm-sim-list">
        {clients.map((c, i) => (
          <div key={i} className={`crm-sim-client ${c.show ? "opacity-100" : "opacity-0"}`}>
            <div className="crm-sim-avatar">{c.name[3]}</div>
            <div className="crm-sim-info">
              <div className="text-[11px] font-semibold truncate">{c.name}</div>
              <div className="text-[9px] text-slate-400">{c.deals}건 거래 · {c.last}</div>
            </div>
            <div className="crm-sim-stats">
              <div className="text-[10px] font-bold">{c.total}</div>
              <div className={`text-[9px] font-medium ${c.status === "활성" ? "text-emerald-400" : c.status === "주의" ? "text-amber-400" : "text-red-400"}`}>{c.status}</div>
            </div>
          </div>
        ))}
      </div>
      {showInsight && (
        <div className="crm-sim-insight-banner">
          💡 AI: 블루오션 12일 미접촉 — 리마인더 발송 추천
        </div>
      )}
    </div>
  );
}

function DocSim() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 16), 250);
    return () => clearInterval(t);
  }, []);

  const docs = [
    { name: "용역계약서_그릭데이_v2.pdf", type: "계약", status: step >= 3 ? "잠금" : step >= 1 ? "서명완료" : "검토중", icon: "📝" },
    { name: "3월_급여명세서.xlsx", type: "급여", status: step >= 7 ? "백업완료" : step >= 5 ? "생성됨" : "대기", icon: "💰" },
    { name: "세금계산서_2024031.pdf", type: "세금", status: step >= 11 ? "매칭완료" : step >= 9 ? "발행됨" : "대기", icon: "🧾" },
    { name: "프로젝트_결과보고서.pdf", type: "보고", status: step >= 14 ? "아카이브" : step >= 13 ? "백업중" : "작성중", icon: "📊" },
  ];
  const statusColors: Record<string, string> = { "검토중": "#F59E0B", "서명완료": "#3B82F6", "잠금": "#10B981", "대기": "#64748B", "생성됨": "#3B82F6", "백업완료": "#10B981", "발행됨": "#8B5CF6", "매칭완료": "#10B981", "작성중": "#F59E0B", "백업중": "#3B82F6", "아카이브": "#10B981" };

  return (
    <div className="doc-sim-card lp-card-dark">
      <div className="doc-sim-header lp-row-between">
        <span className="text-xs font-bold text-blue-400">DOCUMENT HUB</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">자동관리</span>
      </div>
      <div className="doc-sim-list">
        {docs.map((d, i) => (
          <div key={i} className="doc-sim-item">
            <span className="text-sm">{d.icon}</span>
            <div className="doc-sim-info">
              <div className="text-[11px] font-semibold truncate">{d.name}</div>
              <div className="text-[9px] text-slate-400">{d.type}</div>
            </div>
            <span className="doc-sim-status-badge" style={{ background: `${statusColors[d.status]}20`, color: statusColors[d.status] }}>{d.status}</span>
          </div>
        ))}
      </div>
      <div className="doc-sim-stats">
        {[{ l: "자동분류", v: "47건" }, { l: "자동백업", v: "128건" }, { l: "버전관리", v: "v2.1" }].map(s => (
          <div key={s.l} className="doc-sim-stat-tile">
            <div className="text-[9px] text-slate-500">{s.l}</div>
            <div className="text-[10px] font-bold">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SIM_MAP: Record<string, () => ReturnType<typeof PaymentSim>> = {
  payment: PaymentSim,
  pipeline: PipelineSim,
  contract: ContractSim,
  payroll: PayrollSim,
  ai: AISim,
  chat: ChatSim,
  crm: CRMSim,
  document: DocSim,
};

// ═══════════════════════════════════════════
// SCROLL ANIMATION HOOK
// ═══════════════════════════════════════════
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// ═══════════════════════════════════════════
// HERO FLOATING ELEMENTS
// ═══════════════════════════════════════════
function FloatingElements() {
  return (
    <div className="hero-floating-elements">
      {/* Floating icons */}
      {[
        { icon: "📊", x: "10%", y: "20%", delay: "0s", dur: "20s" },
        { icon: "📄", x: "85%", y: "15%", delay: "3s", dur: "22s" },
        { icon: "💰", x: "75%", y: "70%", delay: "1s", dur: "18s" },
        { icon: "👥", x: "15%", y: "75%", delay: "5s", dur: "24s" },
        { icon: "📋", x: "50%", y: "10%", delay: "2s", dur: "19s" },
        { icon: "✍️", x: "90%", y: "45%", delay: "4s", dur: "21s" },
        { icon: "🤖", x: "5%", y: "45%", delay: "6s", dur: "23s" },
        { icon: "🏦", x: "60%", y: "80%", delay: "7s", dur: "17s" },
      ].map((f, i) => (
        <div
          key={i}
          className="hero-floating-icon"
          style={{
            left: f.x,
            top: f.y,
            animation: `float-y ${f.dur} ease-in-out ${f.delay} infinite alternate`,
          }}
        >
          {f.icon}
        </div>
      ))}
      {/* Connection lines (decorative SVG paths) */}
      <svg className="hero-connection-lines" xmlns="http://www.w3.org/2000/svg">
        <path d="M100,100 Q400,50 700,200 T1200,150" fill="none" stroke="white" strokeWidth="1" />
        <path d="M200,400 Q500,300 800,450 T1300,350" fill="none" stroke="white" strokeWidth="1" />
        <path d="M0,250 Q300,200 600,350 T1100,250" fill="none" stroke="white" strokeWidth="0.5" />
      </svg>
      {/* Gradient orbs */}
      <div className="hero-float-orb-1" />
      <div className="hero-float-orb-2" />
    </div>
  );
}

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════
export default function LandingPage() {
  const [activeFeat, setActiveFeat] = useState(0);
  const [teamSize, setTeamSize] = useState(10);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [partnerForm, setPartnerForm] = useState({ company: "", name: "", email: "", phone: "", message: "" });
  const [partnerSent, setPartnerSent] = useState(false);
  const [partnerSending, setPartnerSending] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // 2026-05-22 랜딩 라이트/다크 토글 (앱 테마와 독립). 기본 다크, localStorage 유지.
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    try {
      const s = localStorage.getItem("landing-theme");
      if (s === "light" || s === "dark") setTheme(s);
    } catch { /* ignore */ }
  }, []);
  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try { localStorage.setItem("landing-theme", next); } catch { /* ignore */ }
      return next;
    });
  };

  async function handlePartnerSubmit() {
    if (!partnerForm.company || !partnerForm.name || !partnerForm.email || !partnerForm.message) return;
    setPartnerSending(true);
    try {
      await supabase.from("partnership_inquiries").insert({
        company_name: partnerForm.company,
        contact_name: partnerForm.name,
        email: partnerForm.email,
        phone: partnerForm.phone || null,
        message: partnerForm.message,
      });
      setPartnerSent(true);
    } catch {
      setPartnerSent(false);
    } finally {
      setPartnerSending(false);
    }
  }
  // revView removed — revenue simulation moved to separate IR report

  // Auto-rotate features
  useEffect(() => {
    const t = setInterval(() => setActiveFeat((p) => (p + 1) % FEATURES.length), 9000);
    return () => clearInterval(t);
  }, []);

  // 2026-07 가격 재확인: 플렉스는 10인까지 70,000원 정액(+인원당 7,000원, 여기선 10인 기준 정액으로 반영) — per-person 계산에서 제외.
  // 모두싸인 Team 플랜 39,900원으로 정정(기존 55,000원 오기재).
  const competitorTotal = teamSize * (16000 + 4900 + 4000) + 70000 + 39900 + 120000 + 33000;
  // 오너뷰는 인원 무관 월 55,000 정액 (50인 초과는 엔터프라이즈 별도 협의)
  const reflectTotal = teamSize <= 50 ? 55000 : null;
  const savings = competitorTotal - (reflectTotal ?? 55000);
  const savingsPercent = Math.round((savings / competitorTotal) * 100);
  const reflectPlan = teamSize <= 50 ? "프로" : "엔터프라이즈";

  const heroRef = useInView();
  const featRef = useInView();
  const compRef = useInView();
  const priceRef = useInView();
  const partnerRef = useInView();

  const SimComponent = SIM_MAP[FEATURES[activeFeat].sim];

  return (
    <div className="landing-root" data-theme={theme} style={{ fontFamily: "'Inter', 'Pretendard Variable', Pretendard, -apple-system, system-ui, sans-serif" }}>
      <style>{`
        @keyframes float-y { from { transform: translateY(0px) rotate(0deg); } to { transform: translateY(-30px) rotate(5deg); } }
        @keyframes slide-up { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes count-flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .animate-up { animation: slide-up 0.8s ease-out forwards; }
        .animate-scale { animation: fade-in-scale 0.6s ease-out forwards; }
      `}</style>

      {/* ── NAV ── */}
      <nav className="site-nav">
        <div className="nav-inner">
          <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="nav-logo-link">
            <OwnerViewLogo size={32} />
            <span className="text-lg font-bold text-white tracking-tight"><RollingBrandText /></span>
          </a>
          <div className="nav-links-desktop">
            <a href="#features" className="lp-nav-link">주요기능</a>
            <a href="#engines" className="lp-nav-link">엔진</a>
            <a href="#featuremap" className="lp-nav-link">기능 맵</a>
            <a href="#compare" className="lp-nav-link">비교</a>
            <a href="#pricing" className="lp-nav-link">가격</a>
            <a href="#partner" className="lp-nav-link">제휴문의</a>
            <a href="#faq" className="lp-nav-link">FAQ</a>
          </div>
          <div className="nav-actions">
            {/* 모바일 햄버거 메뉴 버튼 */}
            <button
              className="nav-hamburger-button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="메뉴 열기"
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
            <button
              onClick={toggleTheme}
              className="landing-theme-toggle"
              aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
              title={theme === "dark" ? "라이트 모드" : "다크 모드"}
            >
              {theme === "dark" ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path strokeLinecap="round" d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>
              )}
            </button>
            <Link href="/auth" className="text-sm text-slate-300 hover:text-white transition hidden sm:block">로그인</Link>
            <Link href="/auth" className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition shadow-lg shadow-blue-600/20 hidden sm:block">무료로 시작하기</Link>
          </div>
        </div>
        {/* 모바일 드롭다운 메뉴 */}
        {isMobileMenuOpen && (
          <div className="mobile-nav-menu">
            <a href="#features" onClick={() => setIsMobileMenuOpen(false)} className="mobile-nav-link">주요기능</a>
            <a href="#engines" onClick={() => setIsMobileMenuOpen(false)} className="mobile-nav-link">도입효과</a>
            <a href="#pricing" onClick={() => setIsMobileMenuOpen(false)} className="mobile-nav-link">요금제</a>
            <a href="#faq" onClick={() => setIsMobileMenuOpen(false)} className="mobile-nav-link">FAQ</a>
            <div className="mobile-nav-auth-row">
              <Link href="/auth" className="text-sm text-slate-300 hover:text-white transition py-1">로그인</Link>
              <Link href="/auth" className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition shadow-lg shadow-blue-600/20 text-center">무료로 시작하기</Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── HERO ── */}
      <section className="hero-section" ref={heroRef.ref}>
        {/* Subtle geometric background */}
        <div className="hero-bg-decoration">
          <div className="hero-bg-orb-1" />
          <div className="hero-bg-orb-2" />
          {/* Subtle dot grid pattern */}
          <div className="hero-dot-grid" style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        </div>
        <div className="hero-content">
          {/* OwnerView Logo — large */}
          <div className={`hero-logo-wrap ${heroRef.inView ? "animate-scale" : "opacity-0"}`}>
            <OwnerViewLogo size={72} className="mx-auto" />
          </div>

          <h1 className={`hero-headline ${heroRef.inView ? "animate-up" : "opacity-0"}`}>
            회사의 <RollingText /> 현황
            <br />
            자동으로 한눈에!
          </h1>
          <p className={`hero-subtext ${heroRef.inView ? "animate-up" : "opacity-0"}`}>
            현금, 프로젝트, 세무, 급여, 결재 — 회사 운영의 모든 것을 하나로
          </p>
          <p className={`hero-tagline ${heroRef.inView ? "animate-up" : "opacity-0"}`}>
            중소기업 대표를 위한 올인원 운영 플랫폼
          </p>
          <div className={`hero-cta ${heroRef.inView ? "animate-up" : "opacity-0"}`}>
            <Link href="/auth" className="hero-cta-primary">
              무료로 시작하기
            </Link>
            <Link href="/demo" className="hero-cta-secondary">
              데모 체험
            </Link>
            <a href="#features" className="hero-cta-tertiary">
              기능 둘러보기 →
            </a>
          </div>
          {/* 신뢰 카운터 */}
          <div className={`hero-trust-counter ${heroRef.inView ? "animate-up" : "opacity-0"}`}>
            <div className="hero-trust-stat">
              <div className="text-2xl md:text-3xl font-black text-white">30<span className="text-blue-400">+</span></div>
              <div className="text-[11px] text-slate-500 mt-0.5">통합 기능</div>
            </div>
            <div className="hero-trust-divider" />
            <div className="hero-trust-stat">
              <div className="text-2xl md:text-3xl font-black text-white">4</div>
              <div className="text-[11px] text-slate-500 mt-0.5">자동화 엔진</div>
            </div>
            <div className="hero-trust-divider" />
            <div className="hero-trust-stat">
              <div className="text-2xl md:text-3xl font-black text-white">89<span className="text-emerald-400">%</span></div>
              <div className="text-[11px] text-slate-500 mt-0.5">비용 절감</div>
            </div>
            <div className="hero-trust-divider" />
            <div className="hero-trust-stat">
              <div className="text-2xl md:text-3xl font-black text-white">0<span className="text-slate-500">원</span></div>
              <div className="text-[11px] text-slate-500 mt-0.5">도입비용</div>
            </div>
          </div>
          {/* Trust badges */}
          <div className={`hero-trust-badges ${heroRef.inView ? "animate-up" : "opacity-0"}`}>
            <span className="hero-trust-badge"><span className="text-emerald-400">✓</span> 카드 등록 없이 무료</span>
            <span className="hero-trust-badge"><span className="text-emerald-400">✓</span> 가입 즉시 세팅 완료</span>
            <span className="hero-trust-badge"><span className="text-emerald-400">✓</span> 24시간 자동 운영</span>
            <span className="hero-trust-badge"><span className="text-emerald-400">✓</span> RLS 기반 데이터 보안</span>
          </div>

          {/* Hero mini dashboard mockup */}
          <div className={`hero-dashboard-mockup ${heroRef.inView ? "animate-up" : "opacity-0"}`}>
            <div className="hero-dashboard-window">
              <div className="hero-dashboard-titlebar">
                <div className="hero-dashboard-dot-red" />
                <div className="hero-dashboard-dot-yellow" />
                <div className="hero-dashboard-dot-green" />
                <span className="text-[10px] text-slate-500 ml-2">OwnerView Dashboard — CEO View</span>
              </div>
              <div className="hero-dashboard-stats">
                {[
                  { label: "현금", value: "₩8.2억", color: "#3B82F6", change: "+12%" },
                  { label: "매출", value: "₩4.5억", color: "#10B981", change: "+23%" },
                  { label: "고정비", value: "₩1.8억", color: "#F59E0B", change: "-5%" },
                  { label: "생존", value: "4.6개월", color: "#8B5CF6", change: "+0.8" },
                ].map((c) => (
                  <div key={c.label} className="hero-dashboard-stat-tile">
                    <div className="text-[10px] text-slate-500">{c.label}</div>
                    <div className="text-sm font-bold text-white">{c.value}</div>
                    <div className="text-[10px] font-medium" style={{ color: c.color }}>{c.change}</div>
                  </div>
                ))}
              </div>
              <div className="hero-dashboard-widgets">
                {[
                  { label: "승인 대기", count: "3건", color: "#F59E0B" },
                  { label: "진행 프로젝트", count: "12건", color: "#3B82F6" },
                  { label: "AI 알림", count: "5건", color: "#EF4444" },
                ].map((w) => (
                  <div key={w.label} className="hero-dashboard-widget">
                    <div className="w-2 h-5 rounded-full" style={{ background: w.color }} />
                    <div>
                      <div className="text-[10px] text-slate-500">{w.label}</div>
                      <div className="text-xs font-bold text-white">{w.count}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PAIN POINT → SOLUTION ── */}
      <section className="pain-point-section">
        <div className="lp-container">
          <div className="pain-point-header">
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
              대표님, 이거 다 <span className="text-amber-400">혼자</span> 하고 계시죠?
            </h2>
            <p className="text-slate-400 text-lg">회계사 부르고, 세무사 연락하고, 엑셀 정리하고, 계약서 찾고...</p>
          </div>
          <div className="pain-point-grid">
            {[
              { keyword: "급여 자동화", pain: "급여일마다 엑셀 뒤지며 4대보험 수동 계산", solve: "AI가 4대보험/원천세 자동 계산 → 급여명세서·이체 내역 자동 정리, 대표는 확인만", icon: "💰" },
              { keyword: "계약 파이프라인", pain: "견적서 보냈는데 계약서는 또 따로 만들어야 함", solve: "견적 승인 → 계약서 자동 생성 → 서명 → 세금계산서까지 전자동 파이프라인", icon: "📋" },
              { keyword: "입금 자동 매칭", pain: "거래처가 입금했는지 통장 앱 왔다갔다 확인", solve: "세금계산서↔계약↔입금 3-Way 매칭. 빠진 건 AI가 찾아 매칭 제안", icon: "🏦" },
              { keyword: "근태·경비 자동", pain: "직원 연차 몇 일 남았는지, 경비 정산 밀린 건 있는지", solve: "근태/휴가/경비 전부 자동 계산. 대표는 승인 버튼만 누르면 끝", icon: "📊" },
              { keyword: "서류 3초 검색", pain: "계약서 어디 저장했더라? 작년 견적서 찾느라 30분", solve: "모든 서류 자동 분류·저장·백업. 검색 한 번이면 3초 만에 찾기", icon: "📁" },
              { keyword: "업무 히스토리 보존", pain: "파트너사와 카톡으로 업무하다 중요한 내용 유실", solve: "프로젝트별 전용 채팅 채널 + 견적·서명·승인 액션카드. 비즈니스 히스토리 영구 보존", icon: "💬" },
            ].map((item) => (
              <div key={item.pain} className="pain-point-card group">
                <div className="pain-point-card-body">
                  <span className="pain-point-icon">{item.icon}</span>
                  <div className="pain-point-text">
                    <span className="pain-point-keyword-badge">{item.keyword}</span>
                    <div className="pain-point-pain-text">{item.pain}</div>
                    <div className="pain-point-solve-text">→ {item.solve}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-center">
            <div className="pain-point-summary">
              <p className="text-lg md:text-xl font-bold text-white mb-1">
                회계 · 인사 · 총무 · 재무 · 법무 담당자 없이도
              </p>
              <p className="text-sm text-slate-400">
                <span className="text-blue-400 font-semibold">직원이 있는 것보다 더 한눈에 보이고, 실수 없이, 24시간 돌아가는</span> 라이브 회사 데이터
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4 ENGINES ── */}
      <section className="engines-section" id="engines">
        <div className="max-w-6xl mx-auto">
          <div className="engines-header">
            <div className="engines-eyebrow-badge">
              다른 SaaS와 근본이 다릅니다
            </div>
            <h2 className="text-4xl md:text-6xl font-extrabold text-white mb-6 leading-tight">
              기능이 아닙니다.<br /><span className="text-[#818CF8]">4개의 엔진</span>입니다.
            </h2>
            <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
              공공 API + AI + 한국 특화 로직을 조합해<br className="hidden md:block" />
              경쟁사가 쉽게 따라올 수 없는 자동화 엔진을 만들었습니다
            </p>
          </div>

          <div className="space-y-8">
            {ENGINES.map((engine, idx) => {
              return (
              <div key={engine.num} className="engine-row group">
                {/* Engine card */}
                <div className="engine-card">
                  {/* Accent bar */}
                  <div className="engine-accent-bar" style={{ background: engine.color }} />

                  <div className="engine-body">
                    {/* Header — Icon + Name + Badge */}
                    <div className="engine-header">
                      <div className="engine-icon-badge" style={{ background: `${engine.color}15`, color: engine.color }}>
                        <EngineGlyph num={engine.num} />
                      </div>
                      <div className="engine-title-wrap">
                        <div className="engine-name-row">
                          <h3 className="text-2xl md:text-3xl font-extrabold text-white">{engine.name}</h3>
                          <span className="engine-number-badge" style={{ background: `${engine.color}18`, color: engine.color }}>
                            ENGINE {engine.num}
                          </span>
                        </div>
                        <span className="engine-eng-label">{engine.eng}</span>
                      </div>
                      {/* Cost badge — desktop */}
                      <div className="engine-cost-badge-desktop">
                        <div className="text-xs text-slate-500 line-through">{engine.replaces} {engine.replacesCost}</div>
                        <div className="text-sm font-bold" style={{ color: engine.color }}>이 엔진 하나로 대체</div>
                      </div>
                    </div>

                    {/* Tagline — big and bold */}
                    <div className="engine-tagline" style={{ background: `${engine.color}08`, borderLeft: `4px solid ${engine.color}` }}>
                      <p className="text-base md:text-xl font-extrabold text-white leading-snug mb-1">{engine.tagline}</p>
                      <p className="text-sm text-slate-400">{engine.headline}</p>
                    </div>

                    {/* Description */}
                    <p className="text-sm md:text-base text-slate-300 leading-relaxed mb-8">{engine.desc}</p>

                    {/* 2-column: Steps + Features / Metrics */}
                    <div className="engine-columns">
                      {/* Left: 3 Steps as flow */}
                      <div className="engine-steps-col">
                        <div className="engine-steps-label">작동 방식 — 3단계</div>
                        <div className="engine-steps-list">
                          {engine.steps.map((s, i) => (
                            <div key={i} className="engine-step-item">
                              <div className="engine-step-number" style={{ background: engine.color, color: "white" }}>
                                {i + 1}
                              </div>
                              <div className="engine-step-text">
                                <div className="text-sm font-bold text-white mb-0.5">{s.step}</div>
                                <div className="text-xs text-slate-400 leading-relaxed">{s.detail}</div>
                              </div>
                              {i < 2 && <div className="hidden" />}
                            </div>
                          ))}
                        </div>

                        {/* API tags */}
                        <div className="engine-api-tags">
                          <span className="text-[10px] text-slate-600 font-bold uppercase">연동 API:</span>
                          {engine.apis.map((api) => (
                            <span key={api} className="engine-api-tag" style={{ borderColor: `${engine.color}25`, color: engine.color, background: `${engine.color}08` }}>{api}</span>
                          ))}
                        </div>
                      </div>

                      {/* Right: Features + Metrics */}
                      <div className="engine-features-col">
                        <div className="engine-features-label">핵심 기능</div>
                        <div className="engine-features-grid">
                          {engine.features.map((f) => (
                            <div key={f.name} className="engine-feature-item">
                              <span className="engine-feature-icon" style={{ background: `${engine.color}1a`, boxShadow: `inset 0 0 0 1px ${engine.color}22`, color: engine.color }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                              </span>
                              <div className="engine-feature-text">
                                <div className="text-xs font-bold text-white mb-0.5 leading-tight">{f.name}</div>
                                <div className="text-[10px] text-slate-400 leading-snug">{f.desc}</div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Metrics row — 예시 대시보드 미리보기 (샘플 수치) */}
                        <div className="engine-metrics-row">
                          {engine.metrics.map((m) => (
                            <div key={m.label} className="engine-metric-tile">
                              <div className="text-[10px] text-slate-500">{m.label}</div>
                              <div className="text-base font-extrabold text-white">{m.value}</div>
                              <div className="text-[10px] font-semibold" style={{ color: engine.color }}>{m.sub}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 text-[10px] text-slate-600 text-right">※ 예시 대시보드 화면입니다</div>
                      </div>
                    </div>

                    {/* Mobile cost badge */}
                    <div className="engine-cost-badge-mobile">
                      <div className="text-xs text-slate-500 line-through">{engine.replaces} {engine.replacesCost}</div>
                      <div className="text-sm font-bold" style={{ color: engine.color }}>이 엔진으로 대체</div>
                    </div>
                  </div>
                </div>
              </div>
            );})}
          </div>

          {/* Total savings */}
          <div className="mt-16 text-center">
            <div className="engines-savings-summary">
              <div className="engines-savings-cost-col">
                <div className="text-sm text-slate-500 mb-2">4개 엔진 총 절감 인건비</div>
                <div className="text-4xl md:text-5xl font-extrabold text-white">연 <span className="text-blue-400">1.87억원</span></div>
              </div>
              <div className="engines-savings-divider" />
              <div className="engines-savings-price-col">
                <div className="text-sm text-slate-500 mb-2">OwnerView 프로 요금제</div>
                <div className="text-2xl font-bold text-white">월 <span className="text-blue-400">55,000원</span> 정액</div>
                <div className="text-sm text-emerald-400 font-semibold mt-1">인원 무제한 · VAT 별도</div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* ── FEATURE MAP — 실제 제품 기능 전체 (2026-07 최신화) ── */}
      <section className="feature-map-section" id="featuremap">
        <div className="max-w-6xl mx-auto">
          <div className="feature-map-header">
            <div className="feature-map-eyebrow">
              지금 바로 쓸 수 있는 기능들
            </div>
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
              오너뷰 <span className="text-blue-400">기능 맵</span>
            </h2>
            <p className="text-slate-400 text-lg">약속이 아니라, 오늘 로그인하면 전부 있는 기능입니다</p>
          </div>
          <div className="feature-map-grid">
            {[
              {
                group: "파이낸스",
                icon: "💰",
                color: "#3B82F6",
                items: [
                  "경영 흐름 콕핏 — 과거 실적 + 90일 현금 예측",
                  "은행·카드 실계좌 자동 동기화",
                  "거래 매칭 확정 시 분개전표 자동 기장",
                  "거래처 원장 (미수·미지급 채권/채무)",
                  "세금계산서 · 현금영수증 관리",
                  "손익계산서 · 비용 분석",
                ],
              },
              {
                group: "워크스페이스",
                icon: "⚡",
                color: "#8B5CF6",
                items: [
                  "프로젝트 파이프라인 — 견적→계약 원클릭",
                  "태스크 · 간트 · 성과 체크인",
                  "전자계약 — 양식 오버레이 · 직인 · 일괄 발송",
                  "전자결재 — 커스텀 양식 빌더 · 다단계 결재선",
                  "일정 / 할 일 · 게시판",
                  "팀 메신저 (채널 · DM · 플로팅)",
                ],
              },
              {
                group: "인사관리",
                icon: "👥",
                color: "#10B981",
                items: [
                  "구성원 관리 · 근로계약 전자서명",
                  "근태 — 출퇴근 · 연차 · 휴가 신청",
                  "연장근무 신청 · 자동 퇴근 처리",
                  "급여명세서 자동 생성 · 이메일 발송",
                  "경비 청구 — 영수증 OCR 자동 인식",
                  "탭별 접근 권한 (RBAC)",
                ],
              },
              {
                group: "편의 · 연동",
                icon: "🔗",
                color: "#F59E0B",
                items: [
                  "커스텀 대시보드 위젯 + 아침 브리핑",
                  "카카오 알림톡 · Slack · 텔레그램 알림",
                  "사업자번호 가입 · 팀 합류 승인",
                  "파트너 포털 · 외부 견적 승인 링크",
                  "거래처·거래내역 엑셀 업로드",
                  "글로벌 검색 (⌘K) · 다크 모드",
                ],
              },
            ].map((g) => (
              <div key={g.group} className="feature-map-group-card">
                <div className="feature-map-accent-bar" style={{ background: g.color }} />
                <div className="feature-map-card-body">
                  <div className="feature-map-card-header">
                    <div className="feature-map-icon" style={{ background: `${g.color}15` }}>{g.icon}</div>
                    <h3 className="text-lg font-extrabold text-white">{g.group}</h3>
                  </div>
                  <ul className="feature-map-list">
                    {g.items.map((it) => (
                      <li key={it} className="feature-map-list-item">
                        <span className="feature-map-check" style={{ color: g.color }}>✓</span>
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPETITOR COMPARISON (witty half-logos) ── */}
      <section className="competitor-section" id="compare" ref={compRef.ref}>
        <div className="lp-container">
          <div className={`competitor-header ${compRef.inView ? "animate-up" : "opacity-0"}`}>
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
              이 서비스들, <span className="text-red-400">전부 쓰고 계시죠?</span>
            </h2>
            <p className="text-slate-400 text-lg">10인 기준 매달 <span className="text-red-400 font-bold">51만원+</span>를 7개 서비스에 분산 결제하는 대신 —</p>
          </div>

          {/* Competitor half-logo cards */}
          <div className={`competitor-grid ${compRef.inView ? "animate-up" : "opacity-0"}`}>
            {COMPETITORS.map((c) => (
              <div key={c.name} className="competitor-card group">
                {/* Half-clipped letter logo */}
                <div className="competitor-logo-wrap">
                  <div className="competitor-logo-box" style={{ background: `${c.color}20`, color: c.color }}>
                    <span className="[clip-path:inset(0_50%_0_0)]">{c.letter}</span>
                  </div>
                  {/* Slash through */}
                  <div className="competitor-logo-slash">
                    <div className="w-[140%] h-[1.5px] bg-red-400/60 -rotate-45" />
                  </div>
                </div>
                <div className="text-xs font-bold text-white/80">{c.name}</div>
                <div className="text-[10px] text-slate-500">{c.cat}</div>
                <div className="text-[10px] text-red-400 font-medium mt-1">₩{c.price}</div>
              </div>
            ))}
          </div>

          {/* Arrow down to OwnerView */}
          <div className="competitor-arrow-wrap">
            <div className="text-slate-500 text-sm mb-3">전부 합치면</div>
            <svg className="w-6 h-6 text-blue-400 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
          </div>

          {/* Cost Calculator */}
          <div className={`cost-calculator ${compRef.inView ? "animate-up" : "opacity-0"}`}>
            <div className="cost-calculator-header">
              <div>
                <h3 className="text-xl font-bold text-white mb-1">비용 비교 계산기</h3>
                <p className="text-sm text-slate-400">경쟁사는 인원마다 늘지만, 오너뷰는 월 55,000원 정액</p>
              </div>
              <div className="cost-calculator-slider-wrap">
                <span className="text-3xl font-extrabold text-white">{teamSize}<span className="text-lg text-slate-400">명</span></span>
                <input type="range" min={3} max={100} value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))} className="w-40 accent-blue-500" />
              </div>
            </div>
            <div className="cost-calculator-grid">
              <div className="cost-calculator-stat-red">
                <div className="text-xs text-red-400 mb-1">개별 구독 합계</div>
                <div className="text-3xl font-extrabold text-red-400">{Math.round(competitorTotal / 10000).toLocaleString()}<span className="text-base font-normal">만원/월</span></div>
              </div>
              <div className="cost-calculator-stat-blue">
                <div className="text-xs text-blue-400 mb-1">OwnerView {reflectPlan} <span className="text-emerald-400">(정액)</span></div>
                <div className="text-3xl font-extrabold text-blue-400">{reflectTotal === null ? "별도 협의" : reflectTotal.toLocaleString()}<span className="text-base font-normal">{reflectTotal === null ? "" : "원/월"}</span></div>
              </div>
              <div className="cost-calculator-stat-emerald">
                <div className="text-xs text-emerald-400 mb-1">매월 절감액</div>
                <div className="text-3xl font-extrabold text-emerald-400">{Math.round(savings / 10000).toLocaleString()}<span className="text-base font-normal">만원 ({savingsPercent}%)</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES + LIVE SIMULATION ── */}
      <section className="live-demo-section" id="features" ref={featRef.ref}>
        <div className="lp-container">
          <div className={`live-demo-header ${featRef.inView ? "animate-up" : "opacity-0"}`}>
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
              실시간 <span className="text-blue-400">라이브 데모</span>
            </h2>
            <p className="text-slate-400 text-lg">각 기능이 실제로 어떻게 동작하는지 확인하세요</p>
          </div>

          {/* Feature tabs */}
          <div className={`live-demo-tabs ${featRef.inView ? "animate-up" : "opacity-0"}`}>
            {FEATURES.map((f, i) => (
              <button
                key={i}
                onClick={() => setActiveFeat(i)}
                className={`feature-tab-button ${
                  activeFeat === i
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
                    : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-white/5"
                }`}
              >
                {f.tab}
              </button>
            ))}
          </div>

          {/* Feature content + Sim */}
          <div className="live-demo-grid">
            {/* Left: Info */}
            <div className="feature-info-card">
              <div className="feature-info-badge">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                {FEATURES[activeFeat].replaces} 대체
              </div>
              <h3 className="text-xl md:text-2xl font-bold text-white mb-3">{FEATURES[activeFeat].title}</h3>
              <p className="text-sm text-slate-400 mb-6 leading-relaxed">{FEATURES[activeFeat].desc}</p>
              <div className="feature-info-cta">
                <Link href="/auth" className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition">무료로 체험</Link>
              </div>
            </div>
            {/* Right: Live Simulation */}
            <div className="live-demo-sim-col">
              <SimComponent />
              <div className="live-demo-sim-caption">
                <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                  실시간 시뮬레이션 — 실제 동작 미리보기
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* ── HOW IT WORKS — 도입 장벽 제거 ── */}
      <section className="onboarding-section">
        <div className="lp-container">
          <div className="onboarding-header">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">&quot;도입이 어렵지 않나요?&quot;</h2>
            <p className="text-gray-500 text-lg">아닙니다. <span className="text-blue-600 font-bold">거래처 목록·거래내역은 엑셀만 올리면 바로 등록</span>됩니다.</p>
          </div>
          <div className="onboarding-subtext">
            <p className="text-sm text-gray-400 max-w-2xl mx-auto">
              지금 쓰고 있는 거래처 목록, 은행·카드 거래내역 — 엑셀이든 CSV든 그냥 드래그해서 올리세요.
              항목을 자동으로 인식해 등록합니다. 직원 명단 등 나머지 데이터는 대시보드에서 직접 등록하며 시작하시면 됩니다.
            </p>
          </div>
          <div className="onboarding-steps-grid">
            {[
              { step: "01", title: "간편 가입", desc: "카카오/구글 3초, 사업자번호로 회사 개설", icon: "👤", color: "#3B82F6" },
              { step: "02", title: "기존 파일 업로드", desc: "거래처·거래내역 엑셀/CSV 드래그&드롭", icon: "📤", color: "#8B5CF6" },
              { step: "03", title: "자동 등록", desc: "거래처·거래내역 자동 인식·등록", icon: "✅", color: "#10B981" },
              { step: "04", title: "바로 경영 시작", desc: "대시보드에서 전체 현황 파악", icon: "🚀", color: "#F59E0B" },
            ].map((s, i) => (
              <div key={s.step} className="onboarding-step-card group">
                {i < 3 && <div className="onboarding-step-connector" />}
                <div className="onboarding-step-body">
                  <div className="onboarding-step-icon">{s.icon}</div>
                  <div className="onboarding-step-badge" style={{ background: `${s.color}15`, color: s.color }}>STEP {s.step}</div>
                  <h4 className="font-bold text-lg mb-1">{s.title}</h4>
                  <p className="text-sm text-gray-500">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          {/* Social proof */}
          <div className="mt-10 text-center">
            <div className="onboarding-social-proof">
              <span className="text-emerald-600 text-sm font-semibold">도입 비용</span>
              <span className="text-2xl font-extrabold text-emerald-700">0원</span>
              <span className="text-xs text-emerald-500">카드 등록 없이 무료로 시작</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="pricing-section" id="pricing" ref={priceRef.ref}>
        <div className="lp-container">
          <div className={`pricing-header ${priceRef.inView ? "animate-up" : "opacity-0"}`}>
            <div className="pricing-eyebrow">
              14일 무료체험 · 카드 등록 없이 시작
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">심플한 4단계 요금제</h2>
            <p className="text-gray-500 text-lg">14일 무료로 전 기능을 써보고, 필요할 때 정액 요금제로 전환하세요</p>
          </div>

          <div className="pricing-plans-grid">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`plan-card ${
                  plan.hl
                    ? "bg-blue-600 text-white shadow-2xl shadow-blue-600/30 scale-[1.03] hover:scale-[1.06] hover:-translate-y-1.5 hover:shadow-blue-600/50 relative ring-2 ring-blue-400/50"
                    : "bg-white border border-gray-200 hover:border-blue-300 hover:shadow-xl hover:-translate-y-1.5 hover:scale-[1.02]"
                }`}
              >
                {plan.hl && <div className="plan-best-badge">BEST</div>}
                {plan.discount && <div className={`plan-discount-badge ${plan.hl ? "bg-emerald-400/20 text-emerald-200" : "bg-emerald-50 text-emerald-600"}`}>{plan.discount}</div>}
                <h4 className={`text-lg font-bold mb-0.5 ${plan.hl ? "" : "text-gray-900"}`}>{plan.name}</h4>
                <p className={`text-xs mb-3 ${plan.hl ? "text-blue-200" : "text-gray-400"}`}>{plan.desc}</p>
                {plan.regularPrice && (
                  <div className={`text-sm line-through mb-1 ${plan.hl ? "text-blue-300" : "text-gray-400"}`}>
                    정상가 {plan.regularPrice}{plan.unit}
                  </div>
                )}
                <div className="mb-0.5">
                  <span className="text-3xl font-extrabold">{plan.betaPrice}</span>
                  <span className={`text-sm ${plan.hl ? "text-blue-200" : "text-gray-400"}`}>{plan.unit}</span>
                </div>
                {plan.period && <div className={`text-xs mb-4 ${plan.hl ? "text-blue-200" : "text-gray-400"}`}>{plan.period}</div>}
                {!plan.period && <div className="mb-4" />}
                <ul className="plan-features-list">
                  {plan.features.map((f, i) => (
                    <li key={i} className="plan-feature-item">
                      <svg className={`plan-feature-check ${plan.hl ? "text-blue-200" : "text-emerald-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      <span className={plan.hl ? "text-blue-50" : "text-gray-600"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href={plan.betaPrice === "별도 협의" ? "#partner" : "/auth"} className={`plan-cta-button ${plan.hl ? "bg-white text-blue-600 hover:bg-blue-50 shadow-md" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
                  {plan.betaPrice === "별도 협의" ? "가격 문의하기" : "무료로 시작하기"}
                </Link>
              </div>
            ))}
          </div>

          {/* 프로 vs 울트라 — 실제 차등 항목만 비교 (마케팅 문구 아님, 코드로 집행되는 항목) */}
          <div className="plan-diff-table">
            <table className="w-full text-sm border-collapse rounded-2xl overflow-hidden border border-gray-200">
              <thead>
                <tr className="plan-diff-header-row">
                  <th className="plan-diff-header-cell-label">항목</th>
                  <th className="plan-diff-header-cell-pro">프로</th>
                  <th className="plan-diff-header-cell-ultra">울트라</th>
                </tr>
              </thead>
              <tbody className="plan-diff-body">
                <tr className="plan-diff-row">
                  <td className="plan-diff-cell">세금계산서 국세청 발행</td>
                  <td className="plan-diff-value-cell-pro">월 10건</td>
                  <td className="plan-diff-value-cell-ultra">무제한</td>
                </tr>
                <tr className="plan-diff-row">
                  <td className="plan-diff-cell">현금영수증 국세청 발행</td>
                  <td className="plan-diff-value-cell-pro">월 10건</td>
                  <td className="plan-diff-value-cell-ultra">무제한</td>
                </tr>
                <tr className="plan-diff-row">
                  <td className="plan-diff-cell">AI 브리핑 (매일 우선순위 액션 플랜)</td>
                  <td className="plan-diff-value-cell-dash">—</td>
                  <td className="plan-diff-value-cell-ultra">제공</td>
                </tr>
                <tr className="plan-diff-row">
                  <td className="plan-diff-cell">신기능 얼리 액세스 · 우선 지원</td>
                  <td className="plan-diff-value-cell-dash">—</td>
                  <td className="plan-diff-value-cell-ultra">제공</td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </section>

      {/* Revenue simulation removed — now in separate IR report HTML */}

      {/* ── PARTNERSHIP INQUIRY ── */}
      <section className="partner-section" id="partner" ref={partnerRef.ref}>
        <div className="max-w-3xl mx-auto">
          <div className={`partner-header ${partnerRef.inView ? "animate-up" : "opacity-0"}`}>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">제휴 & 도입 문의</h2>
            <p className="text-gray-500 text-lg">Enterprise 도입, API 연동, 리셀러 제휴를 상담해 드립니다</p>
          </div>
          {partnerSent ? (
            <div className="partner-success-message">
              <div className="partner-success-icon">✅</div>
              <h3 className="text-xl font-bold text-emerald-700 mb-2">문의가 접수되었습니다</h3>
              <p className="text-sm text-emerald-600">영업일 기준 1일 이내에 회신드리겠습니다.</p>
            </div>
          ) : (
            <div className={`partner-form-card ${partnerRef.inView ? "animate-up" : "opacity-0"}`}>
              <div className="partner-fields-grid">
                <div className="partner-field">
                  <label className="lp-field-label">회사명 *</label>
                  <input type="text" value={partnerForm.company} onChange={(e) => setPartnerForm({ ...partnerForm, company: e.target.value })} placeholder="(주)회사명" className="lp-input" />
                </div>
                <div className="partner-field">
                  <label className="lp-field-label">담당자명 *</label>
                  <input type="text" value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} placeholder="홍길동" className="lp-input" />
                </div>
                <div className="partner-field">
                  <label className="lp-field-label">이메일 *</label>
                  <input type="email" value={partnerForm.email} onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })} placeholder="email@company.com" className="lp-input" />
                </div>
                <div className="partner-field">
                  <label className="lp-field-label">연락처</label>
                  <input type="tel" value={partnerForm.phone} onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })} placeholder="010-0000-0000" className="lp-input" />
                </div>
              </div>
              <div className="partner-message-field">
                <label className="lp-field-label">문의 내용 *</label>
                <textarea value={partnerForm.message} onChange={(e) => setPartnerForm({ ...partnerForm, message: e.target.value })} placeholder="도입 규모, 필요 기능, 연동 요구사항 등을 알려주세요" rows={4} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 resize-none" />
              </div>
              <button
                onClick={handlePartnerSubmit}
                disabled={partnerSending || !partnerForm.company || !partnerForm.name || !partnerForm.email || !partnerForm.message}
                className="partner-submit-button"
              >
                {partnerSending ? "접수 중..." : "문의 보내기"}
              </button>
              <p className="text-[11px] text-gray-400 mt-3 text-center">제출된 정보는 상담 목적으로만 사용되며, 개인정보처리방침에 따라 관리됩니다.</p>
            </div>
          )}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="faq-section" id="faq">
        <div className="max-w-3xl mx-auto">
          <div className="faq-header">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">자주 묻는 질문</h2>
          </div>
          <div className="faq-list">
            {FAQS.map((faq, i) => (
              <div key={i} className="faq-item">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="faq-toggle-button">
                  <span className="faq-question">{faq.q}</span>
                  <svg className={`faq-chevron ${openFaq === i ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className={`faq-answer-panel ${openFaq === i ? "max-h-40 pb-5" : "max-h-0"}`}>
                  <div className="faq-answer-text">{faq.a}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="final-cta-section">
        <div className="final-cta-bg">
          <div className="final-cta-orb-1" />
          <div className="final-cta-orb-2" />
        </div>
        <div className="final-cta-content">
          <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4 tracking-tight">
            회사 현황, 한눈에 보고 싶다면<br /><span className="text-blue-400">OwnerView를 시작하세요.</span>
          </h2>
          <p className="text-slate-400 text-lg mb-8">거래처 목록·거래내역은 엑셀만 올리면 바로 등록. 카드 등록 없이 무료로 시작.</p>
          <Link href="/auth" className="final-cta-button">
            무료로 시작하기
          </Link>
          <p className="final-cta-login-row">
            이미 계정이 있으신가요? <Link href="/auth" className="text-blue-400 hover:underline">로그인</Link>
          </p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="site-footer">
        <div className="lp-container">
          <div className="footer-top-row">
            <div className="footer-brand">
              <OwnerViewLogo size={28} />
              <span className="text-white font-bold tracking-tight"><RollingBrandText /></span>
              <span className="text-xs text-slate-600 ml-2">Company Operating System</span>
            </div>
            <div className="footer-links">
              <a href="#features" className="lp-nav-link">기능</a>
              <a href="#pricing" className="lp-nav-link">가격</a>
              <a href="#partner" className="lp-nav-link">제휴문의</a>
              <a href="#faq" className="lp-nav-link">FAQ</a>
            </div>
          </div>
          <div className="footer-bottom-row">
            <div className="footer-company-info">
              <div>(주)모티브이노베이션 | 대표: 채희웅</div>
              <div>사업자등록번호: 155-88-02209 | 통신판매업신고번호: 제 2023-서울강남-04603호</div>
              <div>경기 화성시 동탄구 동탄첨단산업1로 27 IX타워 A동 2514호, 2515호</div>
            </div>
            <div className="footer-legal-wrap">
              <div className="footer-legal-links">
                <Link href="/terms" className="lp-nav-link">이용약관</Link>
                <Link href="/privacy" className="hover:text-white transition font-semibold">개인정보처리방침</Link>
                <Link href="/refund" className="lp-nav-link">환불규정</Link>
                <a href="mailto:creative@mo-tive.com" className="lp-nav-link">creative@mo-tive.com</a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
