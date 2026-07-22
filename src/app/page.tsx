"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
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
  { name: "프로", regularPrice: null, betaPrice: "55,000", unit: "원/월", period: "VAT 별도 · 인원 무제한", desc: "성장하는 팀의 표준", perSeat: null, hl: true, discount: null, features: ["직원 / 프로젝트 무제한", "은행·카드 자동 동기화", "전자결재 무제한 · 전자계약(서명) 월 20건", "AI 거래 분류 · 리포트 무제한", "거래처 / 파트너 무제한", "재무제표 · 경영흐름 콕핏", "세금계산서 국세청 발행 월 10건 · 현금영수증 발행(베타)"] },
  { name: "울트라", regularPrice: null, betaPrice: "88,000", unit: "원/월", period: "VAT 별도 · 발행량 많은 팀", desc: "국세청 발행 무제한 + AI 브리핑", perSeat: null, hl: false, discount: null, features: ["프로의 모든 기능 그대로", "세금계산서 국세청 발행 무제한 · 현금영수증 발행(베타)", "AI 브리핑 — 매일 우선순위 액션 플랜", "신기능 얼리 액세스", "우선 지원"] },
  { name: "엔터프라이즈", regularPrice: null, betaPrice: "별도 협의", unit: "", period: "맞춤 도입 · 50인+", desc: "대규모 · 커스텀", perSeat: null, hl: false, discount: null, features: ["울트라 전체 +", "전담 온보딩 · CSM", "맞춤 기능 개발", "기존 데이터 이관 지원", "SLA 협의"] },
];

const FAQS = [
  { q: "기존 엑셀/관리파일을 가져올 수 있나요?", a: "네. 거래처 목록과 은행·카드 거래내역은 엑셀/CSV 파일을 업로드하면 바로 등록됩니다. 직원 명단 등 다른 데이터는 현재 수동 등록만 지원합니다." },
  { q: "각 기능이 전문 솔루션 수준인가요?", a: "OwnerView는 회계·급여·전자계약·세무 등 실무에 필요한 핵심 기능을 한 곳에서 제공합니다. 강점은 흩어진 도구 대신 모든 기능이 유기적으로 연결된다는 점입니다." },
  { q: "무료→유료 전환 시 데이터 유지되나요?", a: "네. 입력하신 데이터는 그대로 유지되며, 추가 설정 없이 확장 기능을 이용할 수 있습니다." },
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
// LANDING V2 — 애니메이션 헬퍼
// ═══════════════════════════════════════════

// 스크롤 진입 시 리빌(블러+슬라이드). stagger=true 면 직계 자식들이 순차 등장.
function Reveal({ children, className = "", stagger = false }: { children: ReactNode; className?: string; stagger?: boolean }) {
  const { ref, inView } = useInView(0.12);
  return (
    <div ref={ref} className={`${stagger ? "lp2-stagger" : "lp2-reveal"} ${inView ? "lp2-in" : ""} ${className}`}>
      {children}
    </div>
  );
}

// 뷰포트 진입 시 0 → to 카운트업 숫자.
function CountUp({ to, decimals = 0, suffix = "", prefix = "", duration = 1800 }: { to: number; decimals?: number; suffix?: string; prefix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStarted(true); }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (!started) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setVal(to * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, to, duration]);
  return (
    <span ref={ref}>
      {prefix}{val.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}{suffix}
    </span>
  );
}

// 마우스 위치 따라 3D 틸트 (--lp2-rx/--lp2-ry CSS 변수 갱신).
function useTilt(max = 6) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--lp2-ry", `${(px * max).toFixed(2)}deg`);
      el.style.setProperty("--lp2-rx", `${(-py * max).toFixed(2)}deg`);
    };
    const onLeave = () => {
      el.style.setProperty("--lp2-ry", "0deg");
      el.style.setProperty("--lp2-rx", "0deg");
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => { el.removeEventListener("mousemove", onMove); el.removeEventListener("mouseleave", onLeave); };
  }, [max]);
  return ref;
}

// 히어로 목업 — 6-Pack 스탯 + 현금 스파크라인(선 드로잉) + 위젯. 수치는 예시 데이터.
function HeroMockup() {
  const tiltRef = useTilt(5);
  const { ref, inView } = useInView(0.25);
  return (
    <div ref={ref} className={`lp2-mock-scene lp2-reveal ${inView ? "lp2-in" : ""}`}>
      <div ref={tiltRef} className="lp2-mock">
        <div className="lp2-mock-float lp2-mock-float-a">
          <span className="w-2 h-5 rounded-full bg-amber-400" />
          <div>
            <div className="text-[10px] text-slate-500">승인 대기</div>
            <div className="text-xs font-bold text-white">3건</div>
          </div>
        </div>
        <div className="lp2-mock-float lp2-mock-float-b">
          <span className="w-2 h-5 rounded-full bg-emerald-400" />
          <div>
            <div className="text-[10px] text-slate-500">AI 브리핑</div>
            <div className="text-xs font-bold text-white">오늘의 액션 4건</div>
          </div>
        </div>
        <div className="lp2-mock-titlebar">
          <div className="lp2-mock-dot bg-red-400/80" />
          <div className="lp2-mock-dot bg-yellow-400/80" />
          <div className="lp2-mock-dot bg-green-400/80" />
          <span className="text-[10px] text-slate-500 ml-2">OwnerView Dashboard — CEO View</span>
        </div>
        <div className="lp2-mock-body">
          <div className="lp2-mock-stats">
            {[
              { label: "현금", value: "₩8.2억", color: "#818CF8", change: "+12%" },
              { label: "매출", value: "₩4.5억", color: "#34D399", change: "+23%" },
              { label: "고정비", value: "₩1.8억", color: "#FBBF24", change: "-5%" },
              { label: "런웨이", value: "4.6개월", color: "#C084FC", change: "+0.8" },
            ].map((c) => (
              <div key={c.label} className="lp2-mock-stat">
                <div className="text-[10px] text-slate-500">{c.label}</div>
                <div className="text-sm font-bold text-white">{c.value}</div>
                <div className="text-[10px] font-semibold" style={{ color: c.color }}>{c.change}</div>
              </div>
            ))}
          </div>
          <div className="lp2-mock-chart-wrap">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-400">현금 흐름 — 90일 예측</span>
              <span className="text-[9px] text-slate-600">예시 데이터</span>
            </div>
            <svg viewBox="0 0 400 90" className="w-full h-[72px]" preserveAspectRatio="none">
              <defs>
                <linearGradient id="lp2SparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366F1" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path className="lp2-spark-area" d="M0,70 C40,62 70,66 100,52 C130,40 160,48 200,38 C240,30 270,36 310,24 C340,16 370,20 400,12 L400,90 L0,90 Z" fill="url(#lp2SparkFill)" />
              <path className="lp2-spark-line" d="M0,70 C40,62 70,66 100,52 C130,40 160,48 200,38 C240,30 270,36 310,24 C340,16 370,20 400,12" fill="none" stroke="#818CF8" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="lp2-mock-widgets mt-4">
            {[
              { label: "진행 프로젝트", count: "12건", color: "#818CF8" },
              { label: "미수금 30일+", count: "1건", color: "#FB7185" },
              { label: "이번 달 서명", count: "5건", color: "#34D399" },
            ].map((w) => (
              <div key={w.label} className="lp2-mock-widget">
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
  );
}

// 마퀴 칩 — 전부 실제 탑재 기능명 (기능 맵과 동일 소스).
const MARQUEE_FEATURES = [
  "경영 흐름 콕핏", "은행·카드 실계좌 동기화", "AI 거래 자동분류", "분개전표 자동 기장", "거래처 원장",
  "세금계산서 관리", "손익계산서 자동 생성", "프로젝트 파이프라인", "전자계약 · 직인", "전자결재 양식 빌더",
  "근태 · 연차 관리", "급여명세서 자동 발송", "경비 영수증 OCR", "팀 메신저", "파트너 포털",
  "엑셀 업로드", "글로벌 검색 ⌘K", "커스텀 대시보드 위젯", "카카오 알림톡", "감사 로그 · RBAC",
];

// ═══════════════════════════════════════════
// MAIN COMPONENT — Landing v2
// ═══════════════════════════════════════════
export default function LandingPage() {
  const [activeFeat, setActiveFeat] = useState(0);
  const [teamSize, setTeamSize] = useState(10);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [partnerForm, setPartnerForm] = useState({ company: "", name: "", email: "", phone: "", message: "" });
  const [partnerSent, setPartnerSent] = useState(false);
  const [partnerSending, setPartnerSending] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  // 랜딩 라이트/다크 토글 (앱 테마와 독립, localStorage 유지 — 기존 키 그대로)
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

  // 상단 스크롤 진행바
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setScrollProgress(max > 0 ? (doc.scrollTop / max) * 100 : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  // 라이브 데모 탭 자동 순환
  useEffect(() => {
    const t = setInterval(() => setActiveFeat((p) => (p + 1) % FEATURES.length), 9000);
    return () => clearInterval(t);
  }, []);

  // 2026-07 가격 재확인: 플렉스는 10인까지 70,000원 정액 — per-person 계산에서 제외.
  const competitorTotal = teamSize * (16000 + 4900 + 4000) + 70000 + 39900 + 120000 + 33000;
  const reflectTotal = teamSize <= 50 ? 55000 : null;
  const savings = competitorTotal - (reflectTotal ?? 55000);
  const savingsPercent = Math.round((savings / competitorTotal) * 100);
  const reflectPlan = teamSize <= 50 ? "프로" : "엔터프라이즈";

  const SimComponent = SIM_MAP[FEATURES[activeFeat].sim];

  return (
    <div className="lp2-root" data-theme={theme}>
      {/* 스크롤 진행바 */}
      <div className="lp2-progress" style={{ width: `${scrollProgress}%` }} />

      {/* ── NAV — 플로팅 글래스 바 ── */}
      <nav className="lp2-nav">
        <div className="lp2-nav-inner">
          <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="lp2-nav-logo">
            <OwnerViewLogo size={30} />
            <span className="text-base font-bold tracking-tight" style={{ color: "var(--lp-text)" }}><RollingBrandText /></span>
          </a>
          <div className="lp2-nav-links">
            <a href="#features" className="lp2-nav-link">라이브 데모</a>
            <a href="#engines" className="lp2-nav-link">엔진</a>
            <a href="#featuremap" className="lp2-nav-link">기능 맵</a>
            <a href="#compare" className="lp2-nav-link">비교</a>
            <a href="#pricing" className="lp2-nav-link">가격</a>
            <a href="#partner" className="lp2-nav-link">제휴문의</a>
            <a href="#faq" className="lp2-nav-link">FAQ</a>
          </div>
          <div className="lp2-nav-actions">
            <button className="lp2-hamburger" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} aria-label="메뉴 열기" aria-expanded={isMobileMenuOpen}>
              {isMobileMenuOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
              )}
            </button>
            <button onClick={toggleTheme} className="lp2-theme-btn" aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"} title={theme === "dark" ? "라이트 모드" : "다크 모드"}>
              {theme === "dark" ? (
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path strokeLinecap="round" d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>
              ) : (
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></svg>
              )}
            </button>
            <Link href="/auth" className="lp2-nav-login">로그인</Link>
            <Link href="/auth" className="lp2-nav-cta">무료로 시작하기</Link>
          </div>
        </div>
        {isMobileMenuOpen && (
          <div className="lp2-mobile-menu">
            <a href="#features" onClick={() => setIsMobileMenuOpen(false)} className="lp2-mobile-link">라이브 데모</a>
            <a href="#engines" onClick={() => setIsMobileMenuOpen(false)} className="lp2-mobile-link">엔진</a>
            <a href="#pricing" onClick={() => setIsMobileMenuOpen(false)} className="lp2-mobile-link">요금제</a>
            <a href="#faq" onClick={() => setIsMobileMenuOpen(false)} className="lp2-mobile-link">FAQ</a>
            <div className="flex items-center gap-3 pt-2">
              <Link href="/auth" className="lp2-mobile-link flex-1 text-center">로그인</Link>
              <Link href="/auth" className="lp2-btn-primary flex-1 !px-4 !py-2.5 text-sm">무료로 시작하기</Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── HERO ── */}
      <section className="lp2-hero">
        <div className="lp2-aurora-wrap">
          <div className="lp2-aurora-a" />
          <div className="lp2-aurora-b" />
          <div className="lp2-aurora-c" />
          <div className="lp2-grid-pattern" />
        </div>
        <div className="lp2-hero-inner">
          <Reveal>
            <div className="lp2-hero-badge">
              <span className="lp2-hero-badge-dot" />
              약속이 아니라, 오늘 로그인하면 전부 있는 기능입니다
            </div>
          </Reveal>
          <Reveal>
            <h1 className="lp2-hero-title">
              회사의 <RollingText /> 현황
              <br />
              <span className="lp2-grad-text">자동으로 한눈에</span>
            </h1>
          </Reveal>
          <Reveal>
            <p className="lp2-hero-sub">현금, 프로젝트, 세무, 급여, 결재 — 회사 운영의 모든 것을 하나로</p>
            <p className="lp2-hero-tagline">중소기업 대표를 위한 올인원 운영 플랫폼</p>
          </Reveal>
          <Reveal>
            <div className="lp2-hero-cta-row">
              <Link href="/auth" className="lp2-btn-primary">
                무료로 시작하기
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" /></svg>
              </Link>
              <Link href="/demo" className="lp2-btn-ghost">데모 체험</Link>
              <a href="#features" className="lp2-btn-text">기능 둘러보기 →</a>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp2-hero-stats">
              <div className="lp2-hero-stat">
                <div className="lp2-hero-stat-value"><CountUp to={30} /><span style={{ color: "var(--lp-indigo)" }}>+</span></div>
                <div className="lp2-hero-stat-label">통합 기능</div>
              </div>
              <div className="lp2-hero-stat">
                <div className="lp2-hero-stat-value"><CountUp to={4} duration={1200} /></div>
                <div className="lp2-hero-stat-label">자동화 엔진</div>
              </div>
              <div className="lp2-hero-stat">
                <div className="lp2-hero-stat-value"><CountUp to={89} /><span style={{ color: "var(--lp-emerald)" }}>%</span></div>
                <div className="lp2-hero-stat-label">비용 절감</div>
              </div>
              <div className="lp2-hero-stat">
                <div className="lp2-hero-stat-value">0<span style={{ color: "var(--lp-text-3)" }}>원</span></div>
                <div className="lp2-hero-stat-label">도입 비용</div>
              </div>
            </div>
            <div className="lp2-hero-checks">
              {["카드 등록 없이 무료", "가입 즉시 세팅 완료", "24시간 자동 운영", "RLS 기반 데이터 보안"].map((t) => (
                <span key={t} className="lp2-hero-check">
                  <svg className="w-3.5 h-3.5" style={{ color: "var(--lp-emerald)" }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  {t}
                </span>
              ))}
            </div>
          </Reveal>
          <HeroMockup />
        </div>
      </section>

      {/* ── 기능 칩 마퀴 — 실제 탑재 기능 ── */}
      <div className="lp2-marquee-section">
        <div className="lp2-marquee-fade-l" />
        <div className="lp2-marquee-fade-r" />
        <div className="lp2-marquee-track">
          {[...MARQUEE_FEATURES, ...MARQUEE_FEATURES].map((f, i) => (
            <span key={i} className="lp2-marquee-chip">
              <svg className="w-3 h-3" style={{ color: "var(--lp-indigo)" }} fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* ── PAIN POINT → SOLUTION ── */}
      <section className="lp2-section">
        <div className="lp2-container">
          <Reveal className="lp2-section-head">
            <h2 className="lp2-h2">대표님, 이거 다 <span className="lp2-grad-text">혼자</span> 하고 계시죠?</h2>
            <p className="lp2-sub">회계사 부르고, 세무사 연락하고, 엑셀 정리하고, 계약서 찾고...</p>
          </Reveal>
          <Reveal stagger className="lp2-pain-grid">
            {[
              { keyword: "급여 자동화", pain: "급여일마다 엑셀 뒤지며 4대보험 수동 계산", solve: "4대보험/원천세 자동 계산 → 급여명세서 자동 생성·발송, 대표는 확인만" },
              { keyword: "계약 파이프라인", pain: "견적서 보냈는데 계약서는 또 따로 만들어야 함", solve: "견적 승인 → 계약서 초안 원클릭 생성(설정 시) → 전자서명까지 한 흐름" },
              { keyword: "입금 자동 매칭", pain: "거래처가 입금했는지 통장 앱 왔다갔다 확인", solve: "세금계산서↔계약↔입금 3-Way 매칭. 빠진 건 AI가 찾아 매칭 제안" },
              { keyword: "근태·경비 자동", pain: "직원 연차 몇 일 남았는지, 경비 정산 밀린 건 있는지", solve: "근태/휴가/경비 전부 자동 계산. 대표는 승인 버튼만 누르면 끝" },
              { keyword: "서류 3초 검색", pain: "계약서 어디 저장했더라? 작년 견적서 찾느라 30분", solve: "모든 서류 자동 분류·저장·백업. 글로벌 검색(⌘K) 한 번이면 끝" },
              { keyword: "업무 히스토리 보존", pain: "파트너사와 카톡으로 업무하다 중요한 내용 유실", solve: "프로젝트별 전용 채팅 채널 + 액션카드로 비즈니스 히스토리 영구 보존" },
            ].map((item) => (
              <div key={item.keyword} className="lp2-pain-card">
                <span className="lp2-pain-badge">{item.keyword}</span>
                <div className="lp2-pain-pain">{item.pain}</div>
                <div className="lp2-pain-solve">→ {item.solve}</div>
              </div>
            ))}
          </Reveal>
          <Reveal>
            <div className="lp2-pain-summary">
              <p className="text-lg md:text-xl font-bold mb-1" style={{ color: "var(--lp-text)" }}>회계 · 인사 · 총무 · 재무 담당자 없이도</p>
              <p className="text-sm" style={{ color: "var(--lp-text-2)" }}>
                <span className="font-semibold" style={{ color: "var(--lp-indigo)" }}>한눈에 보이고, 실수 없이, 24시간 돌아가는</span> 라이브 회사 데이터
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 4 ENGINES ── */}
      <section className="lp2-section" id="engines" style={{ background: "var(--lp-bg-soft)" }}>
        <div className="lp2-container">
          <Reveal className="lp2-section-head">
            <div className="lp2-eyebrow">다른 SaaS와 근본이 다릅니다</div>
            <h2 className="lp2-h2">기능이 아닙니다.<br /><span className="lp2-grad-text">4개의 엔진</span>입니다.</h2>
            <p className="lp2-sub">공공 API + AI + 한국 특화 로직을 조합해 만든 자동화 엔진</p>
          </Reveal>
          <div className="space-y-6">
            {ENGINES.map((engine) => (
              <Reveal key={engine.num}>
                <div className="lp2-engine-card">
                  <div className="lp2-engine-glow" />
                  <div className="lp2-engine-body">
                    <div className="lp2-engine-head">
                      <span className="lp2-engine-num">{engine.num}</span>
                      <div className="flex-1 min-w-0 pt-2">
                        <div className="lp2-engine-name-row">
                          <span style={{ color: "var(--lp-indigo)" }}><EngineGlyph num={engine.num} /></span>
                          <h3 className="text-2xl md:text-3xl font-extrabold" style={{ color: "var(--lp-text)" }}>{engine.name}</h3>
                          <span className="lp2-engine-api-tag">{engine.eng}</span>
                        </div>
                        <div className="mt-2 text-xs" style={{ color: "var(--lp-text-3)" }}>
                          <span className="line-through">{engine.replaces} {engine.replacesCost}</span>
                          <span className="ml-2 font-bold" style={{ color: "var(--lp-indigo)" }}>이 엔진 하나로 대체</span>
                        </div>
                      </div>
                    </div>
                    <div className="lp2-engine-tagline">
                      <p className="text-base md:text-xl font-extrabold leading-snug mb-1" style={{ color: "var(--lp-text)" }}>{engine.tagline}</p>
                      <p className="text-sm" style={{ color: "var(--lp-text-2)" }}>{engine.headline}</p>
                    </div>
                    <p className="text-sm md:text-base leading-relaxed" style={{ color: "var(--lp-text-2)" }}>{engine.desc}</p>
                    <div className="lp2-engine-cols">
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-widest mb-4" style={{ color: "var(--lp-text-3)" }}>작동 방식 — 3단계</div>
                        <div className="space-y-4">
                          {engine.steps.map((s, i) => (
                            <div key={i} className="lp2-engine-step">
                              {i < 2 && <div className="lp2-engine-step-line" />}
                              <div className="lp2-engine-step-num">{i + 1}</div>
                              <div>
                                <div className="text-sm font-bold mb-0.5" style={{ color: "var(--lp-text)" }}>{s.step}</div>
                                <div className="text-xs leading-relaxed" style={{ color: "var(--lp-text-2)" }}>{s.detail}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-6">
                          <span className="text-[10px] font-bold uppercase" style={{ color: "var(--lp-text-3)" }}>연동:</span>
                          {engine.apis.map((api) => (
                            <span key={api} className="lp2-engine-api-tag">{api}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-widest mb-4" style={{ color: "var(--lp-text-3)" }}>핵심 기능</div>
                        <div className="grid sm:grid-cols-2 gap-3">
                          {engine.features.map((f) => (
                            <div key={f.name} className="lp2-engine-feature">
                              <svg className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--lp-indigo)" }} fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                              <div>
                                <div className="text-xs font-bold mb-0.5 leading-tight" style={{ color: "var(--lp-text)" }}>{f.name}</div>
                                <div className="text-[10px] leading-snug" style={{ color: "var(--lp-text-2)" }}>{f.desc}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="lp2-engine-metrics">
                          {engine.metrics.map((m) => (
                            <div key={m.label} className="lp2-engine-metric">
                              <div className="text-[10px]" style={{ color: "var(--lp-text-3)" }}>{m.label}</div>
                              <div className="text-base font-extrabold" style={{ color: "var(--lp-text)" }}>{m.value}</div>
                              <div className="text-[10px] font-semibold" style={{ color: "var(--lp-indigo)" }}>{m.sub}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 text-[10px] text-right" style={{ color: "var(--lp-text-3)" }}>※ 예시 대시보드 화면입니다</div>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-14">
            <div className="lp2-engine-savings">
              <div className="text-center">
                <div className="text-sm mb-2" style={{ color: "var(--lp-text-3)" }}>4개 엔진 총 절감 인건비</div>
                <div className="text-4xl md:text-5xl font-extrabold" style={{ color: "var(--lp-text)" }}>연 <span className="lp2-grad-text">1.87억원</span></div>
              </div>
              <div className="lp2-engine-savings-divider" />
              <div className="text-center">
                <div className="text-sm mb-2" style={{ color: "var(--lp-text-3)" }}>OwnerView 프로 요금제</div>
                <div className="text-2xl font-bold" style={{ color: "var(--lp-text)" }}>월 <span style={{ color: "var(--lp-indigo)" }}>55,000원</span> 정액</div>
                <div className="text-sm font-semibold mt-1" style={{ color: "var(--lp-emerald)" }}>인원 무제한 · VAT 별도</div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── LIVE DEMO — 8개 실시간 시뮬레이션 ── */}
      <section className="lp2-section" id="features">
        <div className="lp2-container">
          <Reveal className="lp2-section-head">
            <div className="lp2-eyebrow">클릭 없이 그냥 보세요</div>
            <h2 className="lp2-h2">실시간 <span className="lp2-grad-text">라이브 데모</span></h2>
            <p className="lp2-sub">각 기능이 실제로 어떻게 동작하는지 확인하세요</p>
          </Reveal>
          <Reveal>
            <div className="lp2-demo-tabs">
              {FEATURES.map((f, i) => (
                <button key={i} onClick={() => setActiveFeat(i)} className={`lp2-demo-tab ${activeFeat === i ? "lp2-demo-tab-active" : ""}`}>
                  {f.tab}
                  {activeFeat === i && <span key={`p-${activeFeat}`} className="lp2-demo-tab-progress" />}
                </button>
              ))}
            </div>
            <div className="lp2-demo-grid">
              <div className="lp2-demo-info" key={`info-${activeFeat}`}>
                <div className="lp2-sim-enter">
                  <div className="lp2-demo-replace-badge">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--lp-amber)" }} />
                    {FEATURES[activeFeat].replaces} 대체
                  </div>
                  <h3 className="text-xl md:text-2xl font-bold mb-3" style={{ color: "var(--lp-text)" }}>{FEATURES[activeFeat].title}</h3>
                  <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--lp-text-2)" }}>{FEATURES[activeFeat].desc}</p>
                  <Link href="/auth" className="lp2-btn-primary !px-5 !py-2.5 text-sm w-fit">무료로 체험</Link>
                </div>
              </div>
              <div className="lp2-demo-stage">
                <div key={`sim-${activeFeat}`} className="lp2-sim-enter">
                  <SimComponent />
                </div>
                <div className="text-center mt-3">
                  <span className="inline-flex items-center gap-1.5 text-[10px]" style={{ color: "var(--lp-text-3)" }}>
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    실시간 시뮬레이션 — 실제 동작 미리보기
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── FEATURE MAP — 벤토 그리드 ── */}
      <section className="lp2-section" id="featuremap" style={{ background: "var(--lp-bg-soft)" }}>
        <div className="lp2-container">
          <Reveal className="lp2-section-head">
            <div className="lp2-eyebrow">지금 바로 쓸 수 있는 기능들</div>
            <h2 className="lp2-h2">오너뷰 <span className="lp2-grad-text">기능 맵</span></h2>
            <p className="lp2-sub">약속이 아니라, 오늘 로그인하면 전부 있는 기능입니다</p>
          </Reveal>
          <Reveal stagger className="lp2-bento">
            {[
              {
                group: "파이낸스", color: "#818CF8",
                icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>,
                items: ["경영 흐름 콕핏 — 과거 실적 + 90일 현금 예측", "은행·카드 실계좌 자동 동기화", "거래 매칭 확정 시 분개전표 자동 기장", "거래처 원장 (미수·미지급 채권/채무)", "세금계산서 · 현금영수증 관리", "손익계산서 · 비용 분석"],
              },
              {
                group: "워크스페이스", color: "#C084FC",
                icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>,
                items: ["프로젝트 파이프라인 — 견적→계약 원클릭", "태스크 · 간트 · 성과 체크인", "전자계약 — 양식 오버레이 · 직인 · 일괄 발송", "전자결재 — 커스텀 양식 빌더 · 다단계 결재선", "일정 / 할 일 · 게시판", "팀 메신저 (채널 · DM · 플로팅)"],
              },
              {
                group: "인사관리", color: "#34D399",
                icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>,
                items: ["구성원 관리 · 근로계약 전자서명", "근태 — 출퇴근 · 연차 · 휴가 신청", "연장근무 신청 · 자동 퇴근 처리", "급여명세서 자동 생성 · 이메일 발송", "경비 청구 — 영수증 OCR 자동 인식", "탭별 접근 권한 (RBAC)"],
              },
              {
                group: "편의 · 연동", color: "#FBBF24",
                icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path strokeLinecap="round" d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>,
                items: ["커스텀 대시보드 위젯 + 아침 브리핑", "카카오 알림톡 · 이메일 · 브라우저 푸시 알림", "사업자번호 가입 · 팀 합류 승인", "파트너 포털 · 외부 견적 승인 링크", "거래처·거래내역 엑셀 업로드", "글로벌 검색 (⌘K) · 다크 모드"],
              },
            ].map((g) => (
              <div key={g.group} className="lp2-bento-card">
                <div className="lp2-bento-icon" style={{ background: `${g.color}18`, color: g.color }}>{g.icon}</div>
                <h3 className="text-lg font-extrabold mb-3" style={{ color: "var(--lp-text)" }}>{g.group}</h3>
                <ul>
                  {g.items.map((it) => (
                    <li key={it} className="lp2-bento-item">
                      <span className="lp2-bento-check" style={{ background: `${g.color}20`, color: g.color }}>✓</span>
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── COMPETITOR COMPARISON + 계산기 ── */}
      <section className="lp2-section" id="compare">
        <div className="lp2-container">
          <Reveal className="lp2-section-head">
            <h2 className="lp2-h2">이 서비스들, <span style={{ color: "var(--lp-rose)" }}>전부 쓰고 계시죠?</span></h2>
            <p className="lp2-sub">10인 기준 매달 <span className="font-bold" style={{ color: "var(--lp-rose)" }}>51만원+</span>를 7개 서비스에 분산 결제하는 대신 —</p>
          </Reveal>
          <Reveal stagger className="lp2-comp-grid">
            {COMPETITORS.map((c) => (
              <div key={c.name} className="lp2-comp-card">
                <div className="lp2-comp-logo" style={{ background: `${c.color}20`, color: c.color }}>
                  <span className="[clip-path:inset(0_50%_0_0)]">{c.letter}</span>
                  <div className="lp2-comp-slash"><div className="w-[140%] h-[1.5px] bg-red-400/60 -rotate-45" /></div>
                </div>
                <div className="text-xs font-bold" style={{ color: "var(--lp-text)" }}>{c.name}</div>
                <div className="text-[10px]" style={{ color: "var(--lp-text-3)" }}>{c.cat}</div>
                <div className="text-[10px] font-medium mt-1" style={{ color: "var(--lp-rose)" }}>₩{c.price}</div>
              </div>
            ))}
          </Reveal>
          <Reveal>
            <div className="lp2-calc">
              <div className="lp2-calc-head">
                <div>
                  <h3 className="text-xl font-bold mb-1" style={{ color: "var(--lp-text)" }}>비용 비교 계산기</h3>
                  <p className="text-sm" style={{ color: "var(--lp-text-2)" }}>경쟁사는 인원마다 늘지만, 오너뷰는 월 55,000원 정액</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-3xl font-extrabold" style={{ color: "var(--lp-text)" }}>{teamSize}<span className="text-lg" style={{ color: "var(--lp-text-3)" }}>명</span></span>
                  <input type="range" min={3} max={100} value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))} className="w-44 lp2-range" />
                </div>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="lp2-calc-cell lp2-calc-cell-red">
                  <div className="text-xs mb-1" style={{ color: "var(--lp-rose)" }}>개별 구독 합계</div>
                  <div className="text-3xl font-extrabold" style={{ color: "var(--lp-rose)" }}>{Math.round(competitorTotal / 10000).toLocaleString()}<span className="text-base font-normal">만원/월</span></div>
                </div>
                <div className="lp2-calc-cell lp2-calc-cell-blue">
                  <div className="text-xs mb-1" style={{ color: "var(--lp-indigo)" }}>OwnerView {reflectPlan} <span style={{ color: "var(--lp-emerald)" }}>(정액)</span></div>
                  <div className="text-3xl font-extrabold" style={{ color: "var(--lp-indigo)" }}>{reflectTotal === null ? "별도 협의" : reflectTotal.toLocaleString()}<span className="text-base font-normal">{reflectTotal === null ? "" : "원/월"}</span></div>
                </div>
                <div className="lp2-calc-cell lp2-calc-cell-green">
                  <div className="text-xs mb-1" style={{ color: "var(--lp-emerald)" }}>매월 절감액</div>
                  <div className="text-3xl font-extrabold" style={{ color: "var(--lp-emerald)" }}>{Math.round(savings / 10000).toLocaleString()}<span className="text-base font-normal">만원 ({savingsPercent}%)</span></div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── HOW IT WORKS — 도입 장벽 제거 ── */}
      <section className="lp2-section" style={{ background: "var(--lp-bg-soft)" }}>
        <div className="lp2-container">
          <Reveal className="lp2-section-head">
            <h2 className="lp2-h2">&quot;도입이 어렵지 않나요?&quot;</h2>
            <p className="lp2-sub">아닙니다. <span className="font-bold" style={{ color: "var(--lp-indigo)" }}>거래처 목록·거래내역은 엑셀만 올리면 바로 등록</span>됩니다.</p>
            <p className="text-sm max-w-2xl mx-auto mt-4" style={{ color: "var(--lp-text-3)" }}>
              지금 쓰고 있는 거래처 목록, 은행·카드 거래내역 — 엑셀이든 CSV든 그냥 드래그해서 올리세요.
              항목을 자동으로 인식해 등록합니다. 나머지 데이터는 대시보드에서 직접 등록하며 시작하시면 됩니다.
            </p>
          </Reveal>
          <Reveal stagger className="lp2-steps-grid">
            {[
              { step: "01", title: "간편 가입", desc: "카카오/구글 3초, 사업자번호로 회사 개설", icon: "👤", color: "#818CF8" },
              { step: "02", title: "기존 파일 업로드", desc: "거래처·거래내역 엑셀/CSV 드래그&드롭", icon: "📤", color: "#C084FC" },
              { step: "03", title: "자동 등록", desc: "거래처·거래내역 자동 인식·등록", icon: "✅", color: "#34D399" },
              { step: "04", title: "바로 경영 시작", desc: "대시보드에서 전체 현황 파악", icon: "🚀", color: "#FBBF24" },
            ].map((s, i) => (
              <div key={s.step} className="lp2-step-card">
                {i < 3 && <div className="lp2-step-connector" />}
                <div className="lp2-step-icon">{s.icon}</div>
                <div className="inline-block px-2.5 py-1 rounded-lg text-[10px] font-black mb-2" style={{ background: `${s.color}18`, color: s.color }}>STEP {s.step}</div>
                <h4 className="font-bold text-lg mb-1" style={{ color: "var(--lp-text)" }}>{s.title}</h4>
                <p className="text-sm" style={{ color: "var(--lp-text-2)" }}>{s.desc}</p>
              </div>
            ))}
          </Reveal>
          <Reveal className="mt-10 text-center">
            <div className="inline-flex items-center gap-3 px-6 py-3 rounded-2xl" style={{ background: "color-mix(in srgb, var(--lp-emerald) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--lp-emerald) 25%, transparent)" }}>
              <span className="text-sm font-semibold" style={{ color: "var(--lp-emerald)" }}>도입 비용</span>
              <span className="text-2xl font-extrabold" style={{ color: "var(--lp-emerald)" }}>0원</span>
              <span className="text-xs" style={{ color: "var(--lp-text-3)" }}>카드 등록 없이 무료로 시작</span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="lp2-section" id="pricing">
        <div className="lp2-container">
          <Reveal className="lp2-section-head">
            <div className="lp2-eyebrow">14일 무료체험 · 카드 등록 없이 시작</div>
            <h2 className="lp2-h2">심플한 4단계 요금제</h2>
            <p className="lp2-sub">14일 무료로 전 기능을 써보고, 필요할 때 정액 요금제로 전환하세요</p>
          </Reveal>
          <Reveal stagger className="lp2-plans">
            {PLANS.map((plan) => (
              <div key={plan.name} className={`lp2-plan ${plan.hl ? "lp2-plan-best" : ""}`}>
                {plan.hl && <div className="lp2-plan-best-badge">BEST</div>}
                <h4 className="text-lg font-bold mb-0.5" style={{ color: "var(--lp-text)" }}>{plan.name}</h4>
                <p className="text-xs mb-4" style={{ color: "var(--lp-text-3)" }}>{plan.desc}</p>
                <div className="mb-0.5">
                  <span className="text-3xl font-extrabold" style={{ color: "var(--lp-text)" }}>{plan.betaPrice}</span>
                  <span className="text-sm ml-0.5" style={{ color: "var(--lp-text-3)" }}>{plan.unit}</span>
                </div>
                {plan.period && <div className="text-xs mb-5" style={{ color: "var(--lp-text-3)" }}>{plan.period}</div>}
                <ul className="space-y-2.5 mb-6">
                  {plan.features.map((f, i) => (
                    <li key={i} className="lp2-plan-feature">
                      <svg className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--lp-emerald)" }} fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href={plan.betaPrice === "별도 협의" ? "#partner" : "/auth"} className={`lp2-plan-cta ${plan.hl ? "lp2-plan-cta-primary" : "lp2-plan-cta-ghost"}`}>
                  {plan.betaPrice === "별도 협의" ? "가격 문의하기" : "무료로 시작하기"}
                </Link>
              </div>
            ))}
          </Reveal>
          {/* 프로 vs 울트라 — 실제 차등 항목만 (코드로 집행되는 항목) */}
          <Reveal className="lp2-diff-head">
            <h3 className="lp2-diff-title">프로에서 울트라로 — 딱 5가지가 달라집니다</h3>
            <p className="lp2-diff-sub">나머지 기능은 완전히 동일합니다. 국세청 발행량이 많거나 매일 AI 브리핑이 필요할 때만 울트라를 선택하세요.</p>
          </Reveal>
          <Reveal className="lp2-diff-table-wrap">
            <table className="lp2-diff-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>프로 · 55,000원</th>
                  <th className="lp2-diff-ultra-col">울트라 · 88,000원</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>전자계약 발송 (서명 요청)</td><td>월 20건</td><td className="lp2-diff-ultra-cell">무제한</td></tr>
                <tr><td>세금계산서 국세청 발행</td><td>월 10건</td><td className="lp2-diff-ultra-cell">무제한</td></tr>
                <tr><td>현금영수증 국세청 발행 <span style={{fontSize:"11px",color:"var(--lp-text-3)"}}>(베타)</span></td><td>월 10건</td><td className="lp2-diff-ultra-cell">무제한</td></tr>
                <tr><td>AI 브리핑 (매일 우선순위 액션 플랜)</td><td>—</td><td className="lp2-diff-ultra-cell">제공</td></tr>
                <tr><td>신기능 얼리 액세스 · 우선 지원</td><td>—</td><td className="lp2-diff-ultra-cell">제공</td></tr>
              </tbody>
            </table>
          </Reveal>
        </div>
      </section>

      {/* ── PARTNERSHIP INQUIRY ── */}
      <section className="lp2-section" id="partner" style={{ background: "var(--lp-bg-soft)" }}>
        <div className="lp2-narrow">
          <Reveal className="lp2-section-head">
            <h2 className="lp2-h2">제휴 &amp; 도입 문의</h2>
            <p className="lp2-sub">Enterprise 도입, API 연동, 리셀러 제휴를 상담해 드립니다</p>
          </Reveal>
          {partnerSent ? (
            <div className="lp2-form-success">
              <div className="text-4xl mb-3">✅</div>
              <h3 className="text-xl font-bold mb-2" style={{ color: "var(--lp-emerald)" }}>문의가 접수되었습니다</h3>
              <p className="text-sm" style={{ color: "var(--lp-text-2)" }}>영업일 기준 1일 이내에 회신드리겠습니다.</p>
            </div>
          ) : (
            <Reveal>
              <div className="lp2-form-card">
                <div className="grid sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="lp2-field-label">회사명 *</label>
                    <input type="text" value={partnerForm.company} onChange={(e) => setPartnerForm({ ...partnerForm, company: e.target.value })} placeholder="(주)회사명" className="lp2-input" />
                  </div>
                  <div>
                    <label className="lp2-field-label">담당자명 *</label>
                    <input type="text" value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} placeholder="홍길동" className="lp2-input" />
                  </div>
                  <div>
                    <label className="lp2-field-label">이메일 *</label>
                    <input type="email" value={partnerForm.email} onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })} placeholder="email@company.com" className="lp2-input" />
                  </div>
                  <div>
                    <label className="lp2-field-label">연락처</label>
                    <input type="tel" value={partnerForm.phone} onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })} placeholder="010-0000-0000" className="lp2-input" />
                  </div>
                </div>
                <div className="mb-5">
                  <label className="lp2-field-label">문의 내용 *</label>
                  <textarea value={partnerForm.message} onChange={(e) => setPartnerForm({ ...partnerForm, message: e.target.value })} placeholder="도입 규모, 필요 기능, 연동 요구사항 등을 알려주세요" rows={4} className="lp2-input resize-none" />
                </div>
                <button
                  onClick={handlePartnerSubmit}
                  disabled={partnerSending || !partnerForm.company || !partnerForm.name || !partnerForm.email || !partnerForm.message}
                  className="lp2-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {partnerSending ? "접수 중..." : "문의 보내기"}
                </button>
                <p className="text-[11px] mt-3 text-center" style={{ color: "var(--lp-text-3)" }}>제출된 정보는 상담 목적으로만 사용되며, 개인정보처리방침에 따라 관리됩니다.</p>
              </div>
            </Reveal>
          )}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="lp2-section" id="faq">
        <div className="lp2-narrow">
          <Reveal className="lp2-section-head">
            <h2 className="lp2-h2">자주 묻는 질문</h2>
          </Reveal>
          <Reveal stagger>
            {FAQS.map((faq, i) => (
              <div key={i} className={`lp2-faq-item ${openFaq === i ? "lp2-faq-open" : ""}`}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="lp2-faq-btn">
                  <span className="lp2-faq-q">{faq.q}</span>
                  <svg className={`lp2-faq-chevron ${openFaq === i ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </button>
                <div className="lp2-faq-panel">
                  <div className="lp2-faq-panel-inner">
                    <div className="lp2-faq-a">{faq.a}</div>
                  </div>
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="lp2-section pt-0">
        <div className="lp2-container">
          <Reveal>
            <div className="lp2-final">
              <div className="lp2-final-orb-a" />
              <div className="lp2-final-orb-b" />
              <div className="relative z-10">
                <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-4" style={{ color: "var(--lp-text)" }}>
                  회사 현황, 한눈에 보고 싶다면<br /><span className="lp2-grad-text">OwnerView를 시작하세요</span>
                </h2>
                <p className="text-base md:text-lg mb-9" style={{ color: "var(--lp-text-2)" }}>거래처 목록·거래내역은 엑셀만 올리면 바로 등록. 카드 등록 없이 무료로 시작.</p>
                <Link href="/auth" className="lp2-btn-primary text-base !px-10 !py-4">무료로 시작하기</Link>
                <p className="text-sm mt-6" style={{ color: "var(--lp-text-3)" }}>
                  이미 계정이 있으신가요? <Link href="/auth" className="font-semibold hover:underline" style={{ color: "var(--lp-indigo)" }}>로그인</Link>
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp2-footer">
        <div className="lp2-container">
          <div className="lp2-footer-top">
            <div className="flex items-center gap-2.5">
              <OwnerViewLogo size={28} />
              <span className="font-bold tracking-tight" style={{ color: "var(--lp-text)" }}><RollingBrandText /></span>
              <span className="text-xs ml-2" style={{ color: "var(--lp-text-3)" }}>Company Operating System</span>
            </div>
            <div className="lp2-footer-links">
              <a href="#features">기능</a>
              <a href="#pricing">가격</a>
              <a href="#partner">제휴문의</a>
              <a href="#faq">FAQ</a>
            </div>
          </div>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="lp2-footer-info">
              <div>(주)모티브이노베이션 | 대표: 채희웅</div>
              <div>사업자등록번호: 155-88-02209 | 통신판매업신고번호: 제 2023-서울강남-04603호</div>
              <div>경기 화성시 동탄구 동탄첨단산업1로 27 IX타워 A동 2514호, 2515호</div>
            </div>
            <div className="lp2-footer-links">
              <Link href="/terms">이용약관</Link>
              <Link href="/privacy" className="font-semibold" style={{ color: "var(--lp-text-2)" }}>개인정보처리방침</Link>
              <Link href="/refund">환불규정</Link>
              <a href="mailto:creative@mo-tive.com">creative@mo-tive.com</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
