"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { RollingBrandText } from "@/components/brand-logo";
import { supabase } from "@/lib/supabase";

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
const COMPETITORS = [
  { name: "플*스", full: "Flex", cat: "HR/급여", price: "24,000", letter: "F", color: "#6366F1" },
  { name: "먼*이", full: "Monday", cat: "프로젝트", price: "16,000", letter: "M", color: "#FF3D57" },
  { name: "모두*인", full: "Modusign", cat: "전자계약", price: "55,000", letter: "M", color: "#1A73E8" },
  { name: "리*버", full: "Remember", cat: "CRM", price: "4,900", letter: "R", color: "#00BFA5" },
  { name: "채*톡", full: "Channel", cat: "채팅", price: "120,000", letter: "C", color: "#FFCA28" },
  { name: "시*티", full: "Shiftee", cat: "근태", price: "4,000", letter: "S", color: "#9C27B0" },
  { name: "자*스", full: "Jobis", cat: "세무", price: "33,000", letter: "J", color: "#FF6D00" },
];

const PLANS = [
  { name: "Free", regularPrice: null, betaPrice: "0", unit: "원", period: "영구 무료", desc: "1~3인 1인대표", perSeat: null, hl: false, discount: null, features: ["직원 3명까지", "프로젝트 3개", "전자서명 월 3건", "생존 대시보드", "AI 분석 월 5회", "팀 채팅"] },
  { name: "Starter", regularPrice: "89,000", betaPrice: "29,000", unit: "원/월", period: "+5,900원/인", desc: "10인 이하", perSeat: 5900, hl: false, discount: "경쟁사 대비 약 89% 절감", features: ["직원/프로젝트 무제한", "4개 엔진 전체", "서명 월 50건", "AI 분석 월 100회", "파트너 10개 초대", "거래처 DB 무제한", "이메일 지원"] },
  { name: "Business", regularPrice: "290,000", betaPrice: "49,000", unit: "원/월", period: "+9,900원/인", desc: "50인 이하", perSeat: 9900, hl: true, discount: "경쟁사 대비 약 80% 절감", features: ["Starter 전체 +", "AI 무제한", "급여 자동정산", "서명 무제한", "자동화 무제한", "파트너 무제한", "세무 리포트", "생존 시뮬레이터", "우선 지원"] },
  { name: "Enterprise", regularPrice: null, betaPrice: "별도 협의", unit: "", period: "", desc: "50인+", perSeat: null, hl: false, discount: null, features: ["Business 전체 +", "SSO / SAML", "감사 로그 무제한", "API 접근", "전담 CSM", "맞춤 개발", "SLA 보장", "온프레미스 옵션"] },
];

const FAQS = [
  { q: "기존 엑셀/관리파일을 가져올 수 있나요?", a: "네. 온보딩 시 기존 엑셀 파일을 업로드하면 AI가 자동으로 파싱하여 70~80%를 자동 세팅합니다." },
  { q: "각 기능이 전문 솔루션 수준인가요?", a: "OwnerView의 각 기능은 해당 분야 전문 솔루션과 동등한 품질을 제공합니다. 차이점은 모든 기능이 유기적으로 연결된다는 것입니다." },
  { q: "무료→유료 전환 시 데이터 유지되나요?", a: "물론입니다. 모든 데이터는 100% 유지되며 추가 설정 없이 즉시 확장 기능을 사용할 수 있습니다." },
  { q: "파트너사도 함께 사용할 수 있나요?", a: "네. 링크 하나로 초대 가능하며 별도 요금 없이 프로젝트 확인, 서류 검토, 채팅에 참여할 수 있습니다." },
  { q: "보안은 안전한가요?", a: "AES-256 암호화, 역할기반 접근제어(RBAC), 감사로그, SOC2 인증 인프라(Supabase)를 사용합니다." },
  { q: "도입 비용이나 세팅비가 있나요?", a: "없습니다. 가입 즉시 사용 가능하며, Enterprise 플랜의 경우 무료 온보딩 지원을 제공합니다." },
];

const FEATURES = [
  {
    tab: "결제 승인",
    sim: "payment",
    replaces: "플*스 + 시*티",
    title: "요청 → 대표 원클릭 승인 → 자동 이체",
    desc: "경비, 급여, 고정비 — 모든 결제가 하나의 큐에서 관리됩니다. 다단계 승인 정책, 금액별 자동승인, 배치 일괄 처리까지.",
  },
  {
    tab: "딜 파이프라인",
    sim: "pipeline",
    replaces: "먼*이",
    title: "견적 → 계약 → 세금계산서 → 입금 자동 추적",
    desc: "프로젝트의 전체 라이프사이클이 자동으로 연결됩니다. 칸반/테이블 멀티뷰, 마일스톤, 매출 스케줄, 휴면 딜 자동 감지.",
  },
  {
    tab: "전자계약",
    sim: "contract",
    replaces: "모두*인",
    title: "문서 작성 → 서명 요청 → 완료까지 원스톱",
    desc: "딜 승인 시 계약서가 자동 생성되고 서명 요청이 발송됩니다. Draft→Review→Approved→Locked 라이프사이클, 리비전 관리.",
  },
  {
    tab: "HR & 급여",
    sim: "payroll",
    replaces: "플*스",
    title: "4대보험/원천세 자동 계산 → 일괄 이체",
    desc: "국민연금 4.5%/건보 3.545%*/고용 0.9%/소득세 간이세액표 자동 적용. 급여명세서 생성→대표 승인→전 직원 일괄 이체.",
  },
  {
    tab: "팀 & 파트너 채팅",
    sim: "chat",
    replaces: "채*톡",
    title: "딜별 채널 + 파트너 실시간 소통 + 액션카드",
    desc: "채팅 안에서 견적서 확인, 서명 요청, 승인까지. 딜/팀/DM 채널, 멘션, 리액션. 외부 파트너도 초대 한 번으로 합류.",
  },
  {
    tab: "고객 DB",
    sim: "crm",
    replaces: "리*버",
    title: "한번이라도 견적 나간 업체, 자동으로 고객 DB",
    desc: "거래처별 딜 이력, 계약서, 매출, 커뮤니케이션 기록 자동 축적. 휴면 고객 AI 감지, 리마인더 자동 발송. 리멤버 수준의 CRM.",
  },
  {
    tab: "서류 자동관리",
    sim: "document",
    replaces: "자*스 + 드라이브",
    title: "생성 → 분류 → 서명 → 백업까지 완전 자동",
    desc: "견적서/계약서/세금계산서/급여명세서/결과보고서 — 자동 분류, 리비전 관리, 버전 추적. 결과물 자동 백업, 서류 자동 저장.",
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
    <span className="inline-block relative overflow-hidden align-bottom" style={{ width: "2em", height: "1.15em" }}>
      <span
        className="absolute left-0 transition-all duration-300"
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
    desc: "7개 은행 잔고, 카드 내역, 매출, 미수금 — 모두 자동 수집. \"직원 1명 더 뽑으면?\" 같은 시나리오 시뮬레이션까지. 현금이 바닥나기 전에, AI가 먼저 경고합니다.",
    replaces: "CFO 1명",
    replacesCost: "연 6,000만원",
    color: "#3B82F6",
    metrics: [
      { label: "현금 잔고", value: "₩8.2억", sub: "+12%" },
      { label: "생존 개월", value: "4.6개월", sub: "+0.8" },
      { label: "리스크 감지", value: "3건", sub: "실시간" },
    ],
    apis: ["오픈뱅킹 API", "홈택스 API", "DART 공시", "Claude AI"],
    steps: [
      { step: "자동 수집", detail: "통장·카드 거래내역 오픈뱅킹 자동 연동" },
      { step: "AI 분류", detail: "수입/지출 자동 분류 + 고정비 패턴 감지" },
      { step: "선제 알림", detail: "현금 소진 시점 예측 + 위험 신호 대표 알림" },
    ],
    features: [
      { icon: "📊", name: "6-Pack 생존지표", desc: "현금·매출·고정비·미수금·생존기간·마진율" },
      { icon: "🔮", name: "시나리오 시뮬레이터", desc: "\"직원 1명 추가하면?\" 즉시 계산" },
      { icon: "⚠️", name: "미수금 자동 경고", desc: "30일 초과 미수금 즉시 알림" },
      { icon: "📈", name: "월별 재무 리포트", desc: "대표용 자동 생성 + 이메일 발송" },
    ],
  },
  {
    num: "02",
    name: "원클릭 파이프라인",
    eng: "Auto Pipeline",
    icon: "⚡",
    tagline: "견적서 하나 보내면 — 계약·서명·세금계산서·입금확인까지 전자동",
    headline: "대표는 승인 버튼만. 나머지는 엔진이 알아서.",
    desc: "딜이 성사되면? 견적서→계약서 자동생성→서명 요청 발송→세금계산서 자동발행→입금 3-Way 매칭. 수작업 12단계가 원클릭 1단계로.",
    replaces: "영업관리자 + 경리",
    replacesCost: "연 8,000만원",
    color: "#8B5CF6",
    metrics: [
      { label: "진행 딜", value: "12건", sub: "활성" },
      { label: "자동화율", value: "94%", sub: "수동→자동" },
      { label: "평균 수금", value: "D+7", sub: "-12일 단축" },
    ],
    apis: ["전자서명 엔진", "홈택스 API", "이메일/알림 API", "Claude AI"],
    steps: [
      { step: "견적→계약", detail: "견적 승인 즉시 계약서 자동 생성 + 서명 요청" },
      { step: "서명→발행", detail: "서명 완료 시 세금계산서 자동 발행 + 매출 등록" },
      { step: "입금→매칭", detail: "입금 확인 → 3-Way 자동 매칭 + 딜 상태 갱신" },
    ],
    features: [
      { icon: "📋", name: "칸반 파이프라인", desc: "드래그앤드롭 딜 관리 + 테이블 뷰" },
      { icon: "💬", name: "딜별 전용 채팅", desc: "채팅 안에서 승인·서명·확인까지" },
      { icon: "😴", name: "휴면 딜 AI 감지", desc: "2주 미움직임 → 자동 리마인더" },
      { icon: "💰", name: "매출 스케줄 추적", desc: "선금/잔금 자동 분리 + 입금 추적" },
    ],
  },
  {
    num: "03",
    name: "AI 인사/총무팀",
    eng: "AI Back Office",
    icon: "🤖",
    tagline: "급여·4대보험·경비·근태·서류 — 사람 대신 AI가 24시간",
    headline: "매월 25일, 대표는 '승인' 한 번. 나머지는 전부 자동.",
    desc: "국민연금 4.5%, 건보 3.545%, 고용 0.9%, 소득세 간이세액표 — 전부 자동 산출. 급여명세서 생성, 일괄이체, 명세서 발송까지. 경비 영수증도 AI가 자동 분류·정산.",
    replaces: "회계 + 인사 담당자",
    replacesCost: "연 4,500만원",
    color: "#10B981",
    metrics: [
      { label: "급여 처리", value: "자동", sub: "매월 25일" },
      { label: "4대보험", value: "자동계산", sub: "2026 요율" },
      { label: "경비 처리", value: "12건/월", sub: "AI 분류" },
    ],
    apis: ["4대보험공단 요율", "국세청 간이세액표", "오픈뱅킹 이체", "n8n 자동화"],
    steps: [
      { step: "직원 등록", detail: "4대보험·원천세 요율 자동 매칭" },
      { step: "배치 생성", detail: "매월 20일 전 직원 급여 자동 산출 → 대표 알림" },
      { step: "일괄 이체", detail: "대표 승인 → 전 직원 이체 + 명세서 자동 발송" },
    ],
    features: [
      { icon: "⏰", name: "자동 근태관리", desc: "출퇴근 기록·연차·휴가 자동 처리" },
      { icon: "🧾", name: "경비 AI 정산", desc: "영수증 → 자동 분류 → 승인 → 정산" },
      { icon: "📝", name: "근로계약서 자동", desc: "입사 시 계약서 자동생성 + 전자서명" },
      { icon: "📂", name: "서류 자동관리", desc: "생성·분류·저장·백업·버전관리 올인원" },
    ],
  },
  {
    num: "04",
    name: "거래처 자산화",
    eng: "Client Asset Engine",
    icon: "🏢",
    tagline: "한번이라도 거래한 업체 — 자동으로 회사의 가장 큰 자산이 됩니다",
    headline: "담당자가 퇴사해도, 고객 관계는 회사에 남습니다.",
    desc: "견적 1건만 보내도 거래처 자동 등록. 거래 이력, 계약서, 채팅, 매출 — 모든 상호작용이 자산으로 축적. 휴면 고객은 AI가 감지하고 리마인더를 자동 발송.",
    replaces: "CRM + 명함관리 구독",
    replacesCost: "연 200만원+",
    color: "#F59E0B",
    metrics: [
      { label: "거래처", value: "47개", sub: "자동 등록" },
      { label: "이력 추적", value: "360°", sub: "전체 뷰" },
      { label: "휴면 감지", value: "AI", sub: "자동 알림" },
    ],
    apis: ["공공데이터 포털", "DART 기업정보", "이메일 파싱", "Claude AI"],
    steps: [
      { step: "자동 등록", detail: "견적·계약·채팅 발생 → 거래처 자동 등록 + 이력 축적" },
      { step: "AI 분석", detail: "거래 패턴 분석 → 휴면·위험 거래처 자동 감지" },
      { step: "관계 유지", detail: "리마인더 자동 발송 + 파트너 포털로 관계 강화" },
    ],
    features: [
      { icon: "🔄", name: "360° 뷰", desc: "딜·계약·매출·커뮤니케이션 통합 뷰" },
      { icon: "🔗", name: "파트너 포털", desc: "링크 하나로 초대, 서류 확인·채팅 참여" },
      { icon: "🏢", name: "사업자 자동조회", desc: "사업자등록번호로 기업정보 자동 입력" },
      { icon: "🎯", name: "관계 스코어링", desc: "AI가 거래 건강도 자동 분석·점수화" },
    ],
  },
];

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
    <div className="bg-[#0F172A] rounded-2xl p-5 text-white overflow-hidden relative" style={{ minHeight: 280 }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-blue-400">PAYMENT QUEUE</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">{items.filter(i => i.status === "완료").length}/3 처리됨</span>
      </div>
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={i} className="bg-white/5 backdrop-blur rounded-xl p-3 flex items-center gap-3 transition-all duration-700" style={{ opacity: 1, transform: step > i * 4 ? "translateX(0)" : "translateX(20px)" }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0" style={{ background: `${statusColor[item.status]}20`, color: statusColor[item.status] }}>
              {item.status === "완료" ? "✓" : item.status === "승인" ? "→" : item.status === "대기" ? "!" : "•"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{item.name}</div>
              <div className="text-[10px] text-slate-400">{item.cat}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-bold">{item.amount}</div>
              <div className="text-[10px] font-medium" style={{ color: statusColor[item.status] }}>{item.status}</div>
            </div>
          </div>
        ))}
      </div>
      {/* Progress bar */}
      <div className="mt-4 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full transition-all duration-1000" style={{ width: `${Math.min(100, (step / 18) * 100)}%` }} />
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
    <div className="bg-[#0F172A] rounded-2xl p-5 text-white overflow-hidden" style={{ minHeight: 280 }}>
      <div className="flex items-center justify-between mb-5">
        <span className="text-xs font-bold text-blue-400">DEAL PIPELINE</span>
        <span className="text-[10px] text-slate-400">그**이 식품 납품</span>
      </div>
      {/* Pipeline stages */}
      <div className="flex items-center gap-1 mb-5">
        {stages.map((s, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
            <div className={`w-full h-2 rounded-full transition-all duration-700 ${i <= activeStage ? "bg-blue-500" : "bg-white/10"}`} />
            <span className={`text-[10px] font-medium transition-colors duration-500 ${i <= activeStage ? "text-blue-300" : "text-slate-500"}`}>{s}</span>
          </div>
        ))}
      </div>
      {/* Current action card */}
      <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
            <span className="text-[10px]">{activeStage === 0 ? "📋" : activeStage === 1 ? "✍️" : activeStage === 2 ? "🧾" : "💰"}</span>
          </div>
          <span className="text-xs font-bold">{stages[activeStage]} {activeStage < 3 ? "자동 생성" : "확인"}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span>금액: ₩35,000,000</span>
          <span className="text-emerald-400">자동 처리 중...</span>
        </div>
        <div className="mt-3 flex gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-blue-400 rounded-full transition-all duration-1000" style={{ width: step % 4 >= n ? "100%" : "0%" }} />
            </div>
          ))}
        </div>
      </div>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        {[
          { label: "진행 딜", value: "12건" },
          { label: "이번 달 매출", value: "₩4.2억" },
          { label: "평균 마진", value: "32%" },
        ].map((s) => (
          <div key={s.label} className="text-center py-2 bg-white/5 rounded-lg">
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
    <div className="bg-[#0F172A] rounded-2xl p-5 text-white overflow-hidden" style={{ minHeight: 280 }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-blue-400">E-CONTRACT</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">{phases[phase]}</span>
      </div>
      {/* Document preview */}
      <div className="bg-white/5 rounded-xl p-4 mb-3 border border-white/10 relative overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">{phaseIcon[phase]}</span>
          <div>
            <div className="text-xs font-bold">용역 계약서 v2.1</div>
            <div className="text-[10px] text-slate-400">(주)그**이 × (주)모**브</div>
          </div>
        </div>
        {/* Document lines */}
        {[80, 65, 90, 70, 55].map((w, i) => (
          <div key={i} className="h-1.5 rounded-full bg-white/10 mb-1.5" style={{ width: `${w}%` }}>
            <div className="h-full bg-blue-400/30 rounded-full transition-all duration-700" style={{ width: phase >= 1 ? "100%" : "0%" }} />
          </div>
        ))}
        {/* Signature area */}
        {phase >= 2 && (
          <div className="mt-3 flex gap-3">
            <div className="flex-1 border border-dashed border-emerald-400/40 rounded-lg p-2 text-center">
              <div className="text-[10px] text-slate-400 mb-1">갑</div>
              <div className={`text-xs font-bold transition-all duration-500 ${phase >= 3 ? "text-emerald-400" : "text-slate-500"}`}>
                {phase >= 3 ? "채희웅 ✓" : "서명 대기"}
              </div>
            </div>
            <div className="flex-1 border border-dashed border-blue-400/40 rounded-lg p-2 text-center">
              <div className="text-[10px] text-slate-400 mb-1">을</div>
              <div className={`text-xs font-bold transition-all duration-500 ${phase >= 3 ? "text-blue-400" : "text-slate-500"}`}>
                {phase >= 3 ? "김대표 ✓" : "서명 대기"}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Phase indicator */}
      <div className="flex gap-1">
        {phases.map((p, i) => (
          <div key={i} className={`flex-1 py-1.5 rounded-lg text-center text-[10px] font-medium transition-all duration-500 ${i <= phase ? "bg-blue-500/20 text-blue-300" : "bg-white/5 text-slate-500"}`}>
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
    <div className="bg-[#0F172A] rounded-2xl p-5 text-white overflow-hidden" style={{ minHeight: 280 }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-blue-400">PAYROLL</span>
        <span className="text-[10px] text-slate-400">2026년 3월</span>
      </div>
      <div className="space-y-2">
        {employees.map((emp, i) => (
          <div key={i} className="bg-white/5 rounded-xl p-3 flex items-center gap-3 transition-all duration-700" style={{ opacity: step > i ? 1 : 0.3 }}>
            <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold">{emp.name[0]}</div>
            <div className="flex-1">
              <div className="text-xs font-semibold">{emp.name}</div>
              <div className="text-[10px] text-slate-400">기본급 ₩{(emp.base / 10000).toLocaleString()}만</div>
            </div>
            <div className="text-right">
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
        <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
          {["국민연금 4.5%", "건보 3.545%*", "고용 0.9%", "소득세"].map((d) => (
            <div key={d} className="py-1.5 bg-rose-500/10 rounded-lg text-[9px] text-rose-300">{d}</div>
          ))}
        </div>
      )}
      {showApprove && (
        <div className="mt-3 py-2.5 bg-emerald-500/20 rounded-xl text-center text-xs font-bold text-emerald-300 animate-pulse">
          대표 승인 완료 → 일괄 이체 진행 중
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
    <div className="bg-[#0F172A] rounded-2xl p-5 text-white overflow-hidden" style={{ minHeight: 280 }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-blue-400">AI ENGINE</span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-[10px] text-emerald-400">실시간 분석 중</span>
        </div>
      </div>
      <div className="space-y-2">
        {alerts.map((a, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 bg-white/5 rounded-xl p-3 transition-all duration-700"
            style={{ opacity: a.show ? 1 : 0, transform: a.show ? "translateY(0)" : "translateY(10px)" }}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-bold" style={{ background: `${a.color}20`, color: a.color }}>
              {a.type[0]}
            </div>
            <div className="flex-1 min-w-0">
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
    { from: "시스템", role: "AI", msg: "🧾 세금계산서 자동 발행 + 입금 스케줄 등록", time: "14:30", show: step >= 11, isAction: true },
  ];

  return (
    <div className="bg-[#0F172A] rounded-2xl p-5 text-white overflow-hidden" style={{ minHeight: 280 }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-blue-400">TEAM CHAT</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">실시간</span>
      </div>
      <div className="space-y-2 overflow-hidden" style={{ maxHeight: 220 }}>
        {msgs.map((m, i) => (
          <div key={i} className={`flex gap-2 transition-all duration-500 ${m.show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${m.isAction ? "bg-blue-500/20 text-blue-400" : m.isPartner ? "bg-purple-500/20 text-purple-400" : "bg-white/10 text-slate-400"}`}>
              {m.isAction ? "AI" : m.from[0]}
            </div>
            <div className={`flex-1 rounded-xl p-2 text-[11px] ${m.isAction ? "bg-blue-500/10 border border-blue-500/20 text-blue-300" : "bg-white/5 text-slate-300"}`}>
              <div className="flex items-center gap-1.5 mb-0.5">
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
    <div className="bg-[#0F172A] rounded-2xl p-5 text-white overflow-hidden" style={{ minHeight: 280 }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-blue-400">CLIENT DB</span>
        <span className="text-[10px] text-slate-400">{clients.filter(c => c.show).length}개 거래처</span>
      </div>
      <div className="space-y-2">
        {clients.map((c, i) => (
          <div key={i} className={`bg-white/5 rounded-xl p-2.5 flex items-center gap-2.5 transition-all duration-500 ${c.show ? "opacity-100" : "opacity-0"}`}>
            <div className="w-8 h-8 rounded-lg bg-blue-500/30 flex items-center justify-center text-[10px] font-bold shrink-0">{c.name[3]}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold truncate">{c.name}</div>
              <div className="text-[9px] text-slate-400">{c.deals}건 거래 · {c.last}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] font-bold">{c.total}</div>
              <div className={`text-[9px] font-medium ${c.status === "활성" ? "text-emerald-400" : c.status === "주의" ? "text-amber-400" : "text-red-400"}`}>{c.status}</div>
            </div>
          </div>
        ))}
      </div>
      {showInsight && (
        <div className="mt-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl p-2.5 text-[10px] text-purple-300 transition-all duration-700">
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
    <div className="bg-[#0F172A] rounded-2xl p-5 text-white overflow-hidden" style={{ minHeight: 280 }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-blue-400">DOCUMENT HUB</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">자동관리</span>
      </div>
      <div className="space-y-2">
        {docs.map((d, i) => (
          <div key={i} className="bg-white/5 rounded-xl p-2.5 flex items-center gap-2.5 transition-all duration-700">
            <span className="text-sm">{d.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold truncate">{d.name}</div>
              <div className="text-[9px] text-slate-400">{d.type}</div>
            </div>
            <span className="text-[9px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${statusColors[d.status]}20`, color: statusColors[d.status] }}>{d.status}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
        {[{ l: "자동분류", v: "47건" }, { l: "자동백업", v: "128건" }, { l: "버전관리", v: "v2.1" }].map(s => (
          <div key={s.l} className="py-1.5 bg-white/5 rounded-lg">
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
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
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
          className="absolute text-2xl opacity-[0.15]"
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
      <svg className="absolute inset-0 w-full h-full opacity-[0.06]" xmlns="http://www.w3.org/2000/svg">
        <path d="M100,100 Q400,50 700,200 T1200,150" fill="none" stroke="white" strokeWidth="1" />
        <path d="M200,400 Q500,300 800,450 T1300,350" fill="none" stroke="white" strokeWidth="1" />
        <path d="M0,250 Q300,200 600,350 T1100,250" fill="none" stroke="white" strokeWidth="0.5" />
      </svg>
      {/* Gradient orbs */}
      <div className="absolute w-[500px] h-[500px] rounded-full opacity-10 blur-[120px] bg-blue-600" style={{ top: "-10%", right: "-10%" }} />
      <div className="absolute w-[400px] h-[400px] rounded-full opacity-10 blur-[100px] bg-blue-800" style={{ bottom: "-5%", left: "-5%" }} />
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

  async function handlePartnerSubmit() {
    if (!partnerForm.company || !partnerForm.name || !partnerForm.email || !partnerForm.message) return;
    setPartnerSending(true);
    try {
      await (supabase as any).from("partnership_inquiries").insert({
        company_name: partnerForm.company,
        contact_name: partnerForm.name,
        email: partnerForm.email,
        phone: partnerForm.phone || null,
        message: partnerForm.message,
      });
      setPartnerSent(true);
    } catch {
      alert("문의 접수에 실패했습니다. 잠시 후 다시 시도해주세요.");
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

  const competitorTotal = teamSize * (24000 + 16000 + 4900 + 4000) + 55000 + 120000 + 33000;
  const reflectTotal = teamSize <= 3 ? 0 : teamSize <= 10 ? 29000 + teamSize * 5900 : teamSize <= 50 ? 49000 + teamSize * 9900 : null;
  const savings = competitorTotal - (reflectTotal ?? (49000 + 50 * 9900));
  const savingsPercent = Math.round((savings / competitorTotal) * 100);
  const reflectPlan = teamSize <= 3 ? "Free" : teamSize <= 10 ? "Starter" : teamSize <= 50 ? "Business" : "Enterprise";

  const heroRef = useInView();
  const featRef = useInView();
  const compRef = useInView();
  const priceRef = useInView();
  const partnerRef = useInView();

  const SimComponent = SIM_MAP[FEATURES[activeFeat].sim];

  return (
    <div className="min-h-screen bg-white text-gray-900" style={{ fontFamily: "'Inter', 'Pretendard Variable', Pretendard, -apple-system, system-ui, sans-serif" }}>
      <style>{`
        @keyframes float-y { from { transform: translateY(0px) rotate(0deg); } to { transform: translateY(-30px) rotate(5deg); } }
        @keyframes slide-up { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes count-flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .animate-up { animation: slide-up 0.8s ease-out forwards; }
        .animate-scale { animation: fade-in-scale 0.6s ease-out forwards; }
      `}</style>

      {/* ── NAV ── */}
      <nav className="fixed top-0 w-full bg-[#0A0E1A]/80 backdrop-blur-xl border-b border-white/5 z-50">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="flex items-center gap-2.5 cursor-pointer">
            <OwnerViewLogo size={32} />
            <span className="text-lg font-bold text-white tracking-tight"><RollingBrandText /></span>
          </a>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#features" className="hover:text-white transition">주요기능</a>
            <a href="#engines" className="hover:text-white transition">엔진</a>
            <a href="#compare" className="hover:text-white transition">비교</a>
            <a href="#pricing" className="hover:text-white transition">가격</a>
            <a href="#partner" className="hover:text-white transition">제휴문의</a>
            <a href="#faq" className="hover:text-white transition">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/auth" className="text-sm text-slate-300 hover:text-white transition hidden sm:block">로그인</Link>
            <Link href="/auth" className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition shadow-lg shadow-blue-600/20">무료로 시작하기</Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-32 pb-28 md:pt-44 md:pb-36 px-6 bg-[#0A0E1A] overflow-hidden" ref={heroRef.ref}>
        {/* Subtle geometric background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute w-[600px] h-[600px] rounded-full opacity-[0.07] blur-[150px] bg-blue-600" style={{ top: "-15%", right: "-10%" }} />
          <div className="absolute w-[400px] h-[400px] rounded-full opacity-[0.05] blur-[120px] bg-indigo-500" style={{ bottom: "-5%", left: "-5%" }} />
          {/* Subtle dot grid pattern */}
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        </div>
        <div className="max-w-4xl mx-auto text-center relative z-10">
          {/* OwnerView Logo — large */}
          <div className={`mb-10 ${heroRef.inView ? "animate-scale" : "opacity-0"}`}>
            <OwnerViewLogo size={72} className="mx-auto" />
          </div>

          <h1 className={`text-4xl md:text-6xl lg:text-[4.25rem] font-extrabold leading-[1.15] mb-6 text-white tracking-tight ${heroRef.inView ? "animate-up" : "opacity-0"}`}>
            회사의 <RollingText /> 현황
            <br />
            자동으로 한눈에!
          </h1>
          <p className={`text-base md:text-lg text-slate-300 mb-3 max-w-2xl mx-auto font-medium ${heroRef.inView ? "animate-up" : "opacity-0"}`} style={{ animationDelay: "0.15s" }}>
            현금, 프로젝트, 세무, 급여, 결재 — 회사 운영의 모든 것을 하나로
          </p>
          <p className={`text-lg md:text-xl text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed ${heroRef.inView ? "animate-up" : "opacity-0"}`} style={{ animationDelay: "0.2s" }}>
            중소기업 대표를 위한 올인원 운영 플랫폼
          </p>
          <div className={`flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 ${heroRef.inView ? "animate-up" : "opacity-0"}`} style={{ animationDelay: "0.4s" }}>
            <Link href="/auth" className="w-full sm:w-auto px-10 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-lg font-bold transition shadow-xl shadow-blue-600/30 hover:shadow-blue-500/40 active:scale-[0.98]">
              무료로 시작하기
            </Link>
            <a href="#features" className="w-full sm:w-auto px-10 py-4 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-2xl text-lg font-semibold transition backdrop-blur">
              기능 둘러보기
            </a>
          </div>
          {/* Trust badges */}
          <div className={`flex flex-wrap items-center justify-center gap-6 text-sm text-slate-500 ${heroRef.inView ? "animate-up" : "opacity-0"}`} style={{ animationDelay: "0.5s" }}>
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> 카드 등록 없이 무료</span>
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> 3분 만에 세팅 완료</span>
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> 24시간 자동 운영</span>
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> 실수 0건</span>
          </div>

          {/* Hero mini dashboard mockup */}
          <div className={`mt-16 max-w-3xl mx-auto ${heroRef.inView ? "animate-up" : "opacity-0"}`} style={{ animationDelay: "0.6s" }}>
            <div className="bg-[#1E293B]/80 backdrop-blur-xl rounded-2xl border border-white/10 p-4 shadow-2xl">
              <div className="flex items-center gap-2 mb-3 px-2">
                <div className="w-3 h-3 rounded-full bg-red-400/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
                <div className="w-3 h-3 rounded-full bg-green-400/80" />
                <span className="text-[10px] text-slate-500 ml-2">OwnerView Dashboard — CEO View</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {[
                  { label: "현금", value: "₩8.2억", color: "#3B82F6", change: "+12%" },
                  { label: "매출", value: "₩4.5억", color: "#10B981", change: "+23%" },
                  { label: "고정비", value: "₩1.8억", color: "#F59E0B", change: "-5%" },
                  { label: "생존", value: "4.6개월", color: "#8B5CF6", change: "+0.8" },
                ].map((c) => (
                  <div key={c.label} className="bg-white/5 rounded-xl p-3 text-center">
                    <div className="text-[10px] text-slate-500">{c.label}</div>
                    <div className="text-sm font-bold text-white">{c.value}</div>
                    <div className="text-[10px] font-medium" style={{ color: c.color }}>{c.change}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { label: "승인 대기", count: "3건", color: "#F59E0B" },
                  { label: "진행 딜", count: "12건", color: "#3B82F6" },
                  { label: "AI 알림", count: "5건", color: "#EF4444" },
                ].map((w) => (
                  <div key={w.label} className="bg-white/5 rounded-lg p-2 flex items-center gap-2">
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
      <section className="py-20 px-6 bg-[#0F1629]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
              대표님, 이거 다 <span className="text-amber-400">혼자</span> 하고 계시죠?
            </h2>
            <p className="text-slate-400 text-lg">회계사 부르고, 세무사 연락하고, 엑셀 정리하고, 계약서 찾고...</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
            {[
              { keyword: "급여 자동화", pain: "급여일마다 엑셀 뒤지며 4대보험 수동 계산", solve: "AI가 4대보험/원천세 자동 계산 → 대표 승인 한 번이면 전 직원 일괄 이체", icon: "💰" },
              { keyword: "계약 파이프라인", pain: "견적서 보냈는데 계약서는 또 따로 만들어야 함", solve: "견적 승인 → 계약서 자동 생성 → 서명 → 세금계산서까지 전자동 파이프라인", icon: "📋" },
              { keyword: "입금 자동 매칭", pain: "거래처가 입금했는지 통장 앱 왔다갔다 확인", solve: "세금계산서↔계약↔입금 3-Way 매칭. 빠진 건 AI가 자동 알림", icon: "🏦" },
              { keyword: "근태·경비 자동", pain: "직원 연차 몇 일 남았는지, 경비 정산 밀린 건 있는지", solve: "근태/휴가/경비 전부 자동 계산. 대표는 승인 버튼만 누르면 끝", icon: "📊" },
              { keyword: "서류 3초 검색", pain: "계약서 어디 저장했더라? 작년 견적서 찾느라 30분", solve: "모든 서류 자동 분류·저장·백업. 검색 한 번이면 3초 만에 찾기", icon: "📁" },
              { keyword: "업무 히스토리 보존", pain: "파트너사와 카톡으로 업무하다 중요한 내용 유실", solve: "딜별 전용 채팅 채널 + 견적·서명·승인 액션카드. 비즈니스 히스토리 영구 보존", icon: "💬" },
            ].map((item) => (
              <div key={item.pain} className="bg-white/[0.03] backdrop-blur border border-white/5 rounded-2xl p-6 hover:border-white/10 transition group">
                <div className="flex items-start gap-4">
                  <span className="text-3xl mt-0.5">{item.icon}</span>
                  <div>
                    <span className="inline-block text-base md:text-lg font-extrabold text-blue-400 bg-blue-400/10 px-3 py-1 rounded-lg mb-3">{item.keyword}</span>
                    <div className="text-sm md:text-base text-red-400/80 line-through mb-2 leading-relaxed">{item.pain}</div>
                    <div className="text-sm md:text-base text-emerald-300 font-medium leading-relaxed">→ {item.solve}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-center">
            <div className="inline-block bg-blue-600/15 border border-blue-500/20 rounded-2xl px-8 py-5">
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
      <section className="py-24 px-6 bg-[#0A0E1A]" id="engines">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-20">
            <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold mb-6 border border-purple-500/30 bg-purple-500/10 text-purple-300">
              다른 SaaS와 근본이 다릅니다
            </div>
            <h2 className="text-4xl md:text-6xl font-extrabold text-white mb-6 leading-tight">
              기능이 아닙니다.<br /><span className="text-blue-400">4개의 엔진</span>입니다.
            </h2>
            <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
              공공 API + AI + 한국 특화 로직을 조합해<br className="hidden md:block" />
              경쟁사가 쉽게 따라올 수 없는 자동화 엔진을 만들었습니다
            </p>
          </div>

          <div className="space-y-8">
            {ENGINES.map((engine, idx) => {
              const coverage = engine.num === "01" ? 87 : engine.num === "02" ? 94 : engine.num === "03" ? 91 : 82;
              return (
              <div key={engine.num} className="group relative">
                {/* Engine card */}
                <div className="bg-white/[0.03] backdrop-blur border border-white/[0.06] rounded-3xl overflow-hidden hover:border-white/15 transition-all duration-500">
                  {/* Accent bar */}
                  <div className="h-1" style={{ background: engine.color }} />

                  <div className="p-6 md:p-10">
                    {/* Header — Icon + Name + Badge */}
                    <div className="flex items-center gap-4 mb-5">
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0" style={{ background: `${engine.color}15` }}>
                        {engine.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="text-2xl md:text-3xl font-extrabold text-white">{engine.name}</h3>
                          <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-md tracking-wider" style={{ background: `${engine.color}18`, color: engine.color }}>
                            ENGINE {engine.num}
                          </span>
                        </div>
                        <span className="text-xs text-slate-600">{engine.eng}</span>
                      </div>
                      {/* Cost badge — desktop */}
                      <div className="hidden md:flex flex-col items-end">
                        <div className="text-xs text-slate-500 line-through">{engine.replaces} {engine.replacesCost}</div>
                        <div className="text-sm font-bold" style={{ color: engine.color }}>이 엔진 하나로 대체</div>
                      </div>
                    </div>

                    {/* Tagline — big and bold */}
                    <div className="rounded-2xl p-4 md:p-5 mb-6" style={{ background: `${engine.color}08`, borderLeft: `4px solid ${engine.color}` }}>
                      <p className="text-base md:text-xl font-extrabold text-white leading-snug mb-1">{engine.tagline}</p>
                      <p className="text-sm text-slate-400">{engine.headline}</p>
                    </div>

                    {/* Description */}
                    <p className="text-sm md:text-base text-slate-300 leading-relaxed mb-8">{engine.desc}</p>

                    {/* 2-column: Steps + Features / Metrics */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Left: 3 Steps as flow */}
                      <div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">작동 방식 — 3단계</div>
                        <div className="space-y-3 mb-6">
                          {engine.steps.map((s, i) => (
                            <div key={i} className="flex items-start gap-3 bg-white/[0.04] rounded-xl p-3.5 border border-white/[0.06]">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black shrink-0 mt-0.5" style={{ background: engine.color, color: "white" }}>
                                {i + 1}
                              </div>
                              <div>
                                <div className="text-sm font-bold text-white mb-0.5">{s.step}</div>
                                <div className="text-xs text-slate-400 leading-relaxed">{s.detail}</div>
                              </div>
                              {i < 2 && <div className="hidden" />}
                            </div>
                          ))}
                        </div>

                        {/* API tags */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-slate-600 font-bold uppercase">연동 API:</span>
                          {engine.apis.map((api) => (
                            <span key={api} className="text-[10px] px-2.5 py-1 rounded-full font-semibold border" style={{ borderColor: `${engine.color}25`, color: engine.color, background: `${engine.color}08` }}>{api}</span>
                          ))}
                        </div>
                      </div>

                      {/* Right: Features + Metrics */}
                      <div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">핵심 기능</div>
                        <div className="grid grid-cols-2 gap-2.5 mb-6">
                          {engine.features.map((f) => (
                            <div key={f.name} className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3.5 hover:border-white/10 transition">
                              <div className="text-lg mb-1.5">{f.icon}</div>
                              <div className="text-xs font-bold text-white mb-0.5">{f.name}</div>
                              <div className="text-[10px] text-slate-500 leading-snug">{f.desc}</div>
                            </div>
                          ))}
                        </div>

                        {/* Metrics row */}
                        <div className="grid grid-cols-3 gap-2">
                          {engine.metrics.map((m) => (
                            <div key={m.label} className="bg-white/[0.05] rounded-xl p-3 text-center border border-white/[0.06]">
                              <div className="text-[10px] text-slate-500">{m.label}</div>
                              <div className="text-base font-extrabold text-white">{m.value}</div>
                              <div className="text-[10px] font-semibold" style={{ color: engine.color }}>{m.sub}</div>
                            </div>
                          ))}
                        </div>

                        {/* Coverage bar */}
                        <div className="mt-3 bg-white/[0.04] rounded-xl p-3 border border-white/[0.06]">
                          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-2">
                            <span>자동화 커버리지</span>
                            <span className="text-xs font-extrabold" style={{ color: engine.color }}>{coverage}%</span>
                          </div>
                          <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${coverage}%`, background: engine.color }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Mobile cost badge */}
                    <div className="md:hidden mt-6 flex items-center justify-between bg-white/[0.04] rounded-xl p-4 border border-white/[0.06]">
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
            <div className="inline-flex flex-col sm:flex-row items-center gap-6 sm:gap-10 px-10 py-8 bg-blue-600/10 border border-white/10 rounded-3xl backdrop-blur">
              <div className="text-center sm:text-left">
                <div className="text-sm text-slate-500 mb-2">4개 엔진 총 절감 인건비</div>
                <div className="text-4xl md:text-5xl font-extrabold text-white">연 <span className="text-blue-400">1.87억원</span></div>
              </div>
              <div className="w-px h-12 bg-white/10 hidden sm:block" />
              <div className="text-center sm:text-left">
                <div className="text-sm text-slate-500 mb-2">OwnerView 베타 특가</div>
                <div className="text-2xl font-bold text-white">월 <span className="text-blue-400">2.9만원</span>+인당 5,900원</div>
                <div className="text-sm text-emerald-400 font-semibold mt-1">= 인건비의 0.5% 수준</div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* ── COMPETITOR COMPARISON (witty half-logos) ── */}
      <section className="py-20 px-6 bg-[#111827]" id="compare" ref={compRef.ref}>
        <div className="max-w-5xl mx-auto">
          <div className={`text-center mb-14 ${compRef.inView ? "animate-up" : "opacity-0"}`}>
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
              이 서비스들, <span className="text-red-400">전부 쓰고 계시죠?</span>
            </h2>
            <p className="text-slate-400 text-lg">10인 기준 매달 <span className="text-red-400 font-bold">80만원+</span>를 7개 서비스에 분산 결제하는 대신 —</p>
          </div>

          {/* Competitor half-logo cards */}
          <div className={`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-12 ${compRef.inView ? "animate-up" : "opacity-0"}`} style={{ animationDelay: "0.2s" }}>
            {COMPETITORS.map((c) => (
              <div key={c.name} className="group relative bg-white/5 rounded-2xl p-4 text-center border border-white/5 hover:border-white/20 transition overflow-hidden">
                {/* Half-clipped letter logo */}
                <div className="relative w-10 h-10 mx-auto mb-2">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black overflow-hidden" style={{ background: `${c.color}20`, color: c.color }}>
                    <span style={{ clipPath: "inset(0 50% 0 0)" }}>{c.letter}</span>
                  </div>
                  {/* Slash through */}
                  <div className="absolute inset-0 flex items-center justify-center">
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
          <div className="flex flex-col items-center mb-10">
            <div className="text-slate-500 text-sm mb-3">전부 합치면</div>
            <svg className="w-6 h-6 text-blue-400 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
          </div>

          {/* Cost Calculator */}
          <div className={`bg-[#1A2332] rounded-3xl border border-white/10 p-8 shadow-2xl ${compRef.inView ? "animate-up" : "opacity-0"}`} style={{ animationDelay: "0.4s" }}>
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
              <div>
                <h3 className="text-xl font-bold text-white mb-1">비용 비교 계산기</h3>
                <p className="text-sm text-slate-400">옆 슬라이더를 움직여보세요 — 인원별 실시간 가격 비교</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-3xl font-extrabold text-white">{teamSize}<span className="text-lg text-slate-400">명</span></span>
                <input type="range" min={3} max={100} value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))} className="w-40 accent-blue-500" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center">
                <div className="text-xs text-red-400 mb-1">개별 구독 합계</div>
                <div className="text-3xl font-extrabold text-red-400">{Math.round(competitorTotal / 10000).toLocaleString()}<span className="text-base font-normal">만원/월</span></div>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6 text-center">
                <div className="text-xs text-blue-400 mb-1">OwnerView {reflectPlan} <span className="text-amber-400">(베타 특가)</span></div>
                <div className="text-3xl font-extrabold text-blue-400">{reflectTotal === null ? "별도 협의" : reflectTotal === 0 ? "0" : reflectTotal.toLocaleString()}<span className="text-base font-normal">{reflectTotal === null ? "" : reflectTotal === 0 ? "원 (무료)" : "원/월"}</span></div>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 text-center">
                <div className="text-xs text-emerald-400 mb-1">매월 절감액</div>
                <div className="text-3xl font-extrabold text-emerald-400">{Math.round(savings / 10000).toLocaleString()}<span className="text-base font-normal">만원 ({savingsPercent}%)</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES + LIVE SIMULATION ── */}
      <section className="py-20 px-6 bg-[#111827]" id="features" ref={featRef.ref}>
        <div className="max-w-5xl mx-auto">
          <div className={`text-center mb-12 ${featRef.inView ? "animate-up" : "opacity-0"}`}>
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
              실시간 <span className="text-blue-400">라이브 데모</span>
            </h2>
            <p className="text-slate-400 text-lg">각 기능이 실제로 어떻게 동작하는지 확인하세요</p>
          </div>

          {/* Feature tabs */}
          <div className={`flex flex-wrap gap-2 justify-center mb-10 ${featRef.inView ? "animate-up" : "opacity-0"}`} style={{ animationDelay: "0.2s" }}>
            {FEATURES.map((f, i) => (
              <button
                key={i}
                onClick={() => setActiveFeat(i)}
                className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Info */}
            <div className="bg-[#1A2332] rounded-2xl border border-white/10 p-8 flex flex-col justify-center">
              <div className="text-xs text-blue-400 font-medium mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                {FEATURES[activeFeat].replaces} 대체
              </div>
              <h3 className="text-xl md:text-2xl font-bold text-white mb-3">{FEATURES[activeFeat].title}</h3>
              <p className="text-sm text-slate-400 mb-6 leading-relaxed">{FEATURES[activeFeat].desc}</p>
              <div className="flex gap-3">
                <Link href="/auth" className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition">무료로 체험</Link>
              </div>
            </div>
            {/* Right: Live Simulation */}
            <div>
              <SimComponent />
              <div className="text-center mt-2">
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
      <section className="py-20 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-6">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">&quot;도입이 어렵지 않나요?&quot;</h2>
            <p className="text-gray-500 text-lg">아닙니다. <span className="text-blue-600 font-bold">기존 엑셀만 올리면 70~80% 즉시 완성</span>됩니다.</p>
          </div>
          <div className="text-center mb-14">
            <p className="text-sm text-gray-400 max-w-2xl mx-auto">
              지금 쓰고 있는 직원 명단, 거래처 목록, 매출 장부 — 엑셀이든 CSV든 그냥 드래그해서 올리세요.
              AI가 컬럼을 자동 인식하고, 직원/거래처/프로젝트/거래내역을 자동으로 세팅합니다.
              나머지 20~30%만 확인하면 바로 시작.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { step: "01", title: "가입 3초", desc: "이메일 하나, 카드 등록 없이", icon: "👤", color: "#3B82F6" },
              { step: "02", title: "기존 파일 업로드", desc: "엑셀/CSV 드래그&드롭", icon: "📤", color: "#8B5CF6" },
              { step: "03", title: "AI가 70~80% 세팅", desc: "직원/거래처/거래 자동 인식", icon: "🤖", color: "#10B981" },
              { step: "04", title: "바로 경영 시작", desc: "대시보드에서 전체 현황 파악", icon: "🚀", color: "#F59E0B" },
            ].map((s, i) => (
              <div key={s.step} className="relative group">
                {i < 3 && <div className="hidden md:block absolute top-10 -right-3 w-6 h-[2px] bg-gray-200 z-10" />}
                <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all text-center">
                  <div className="text-3xl mb-3">{s.icon}</div>
                  <div className="text-[10px] font-bold mb-2 px-2 py-0.5 rounded-full inline-block" style={{ background: `${s.color}15`, color: s.color }}>STEP {s.step}</div>
                  <h4 className="font-bold text-lg mb-1">{s.title}</h4>
                  <p className="text-sm text-gray-500">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          {/* Social proof */}
          <div className="mt-10 text-center">
            <div className="inline-flex items-center gap-4 px-6 py-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
              <span className="text-emerald-600 text-sm font-semibold">평균 도입 시간</span>
              <span className="text-2xl font-extrabold text-emerald-700">3분</span>
              <span className="text-xs text-emerald-500">가입부터 대시보드 확인까지</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="py-20 px-6 bg-gray-50" id="pricing" ref={priceRef.ref}>
        <div className="max-w-5xl mx-auto">
          <div className={`text-center mb-6 ${priceRef.inView ? "animate-up" : "opacity-0"}`}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold mb-4 bg-amber-100 text-amber-700 border border-amber-200">
              BETA OPEN — 3개월 한정 얼리어답터 특가
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">정상가보다 최대 83% 할인</h2>
            <p className="text-gray-500 text-lg">지금 시작하면 베타 기간 동안 파격 할인 + 보상 프로그램 참여</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-6 transition-all duration-300 ${
                  plan.hl
                    ? "bg-blue-600 text-white shadow-2xl shadow-blue-600/30 scale-[1.03] relative ring-2 ring-blue-400/50"
                    : "bg-white border border-gray-200 hover:border-gray-300 hover:shadow-md"
                }`}
              >
                {plan.hl && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-yellow-400 text-amber-900 text-xs font-bold rounded-full shadow-lg">BEST</div>}
                {plan.discount && <div className={`text-[10px] font-bold px-2 py-0.5 rounded-md inline-block mb-2 ${plan.hl ? "bg-emerald-400/20 text-emerald-200" : "bg-emerald-50 text-emerald-600"}`}>{plan.discount}</div>}
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
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <svg className={`w-4 h-4 shrink-0 mt-0.5 ${plan.hl ? "text-blue-200" : "text-emerald-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      <span className={plan.hl ? "text-blue-50" : "text-gray-600"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href={plan.betaPrice === "별도 협의" ? "#partner" : "/auth"} className={`block text-center py-3 rounded-xl font-semibold text-sm transition ${plan.hl ? "bg-white text-blue-600 hover:bg-blue-50 shadow-md" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
                  {plan.betaPrice === "별도 협의" ? "문의하기" : "베타 특가로 시작"}
                </Link>
              </div>
            ))}
          </div>

          {/* Beta 보상 프로그램 */}
          <div className={`bg-white rounded-3xl border border-gray-200 p-8 shadow-sm ${priceRef.inView ? "animate-up" : "opacity-0"}`} style={{ animationDelay: "0.3s" }}>
            <div className="text-center mb-8">
              <h3 className="text-2xl font-extrabold mb-2">베타 사용자 보상 프로그램</h3>
              <p className="text-gray-500 text-sm">할인 가격으로 사용하면서, 피드백으로 더 큰 보상을 받으세요</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 피드백 랭킹 보상 */}
              <div className="bg-purple-50 border border-purple-100 rounded-2xl p-6 text-center">
                <div className="text-3xl mb-3">&#x1F3C6;</div>
                <h4 className="font-bold text-purple-900 mb-2">피드백 챔피언</h4>
                <p className="text-xs text-purple-600 mb-4">기능개선/추가 요청을 가장 많이 한 기업 TOP 3</p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
                    <span className="font-bold text-amber-500">1등</span>
                    <span className="font-semibold text-gray-700">3년 무료 사용</span>
                  </div>
                  <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
                    <span className="font-bold text-gray-400">2등</span>
                    <span className="font-semibold text-gray-700">2년 무료 사용</span>
                  </div>
                  <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
                    <span className="font-bold text-amber-700">3등</span>
                    <span className="font-semibold text-gray-700">1년 무료 사용</span>
                  </div>
                </div>
                <p className="text-[10px] text-purple-400 mt-3">실시간 랭킹 집계 — 어드민에서 확인 가능</p>
              </div>
              {/* 추천인 보상 */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 text-center">
                <div className="text-3xl mb-3">&#x1F91D;</div>
                <h4 className="font-bold text-blue-900 mb-2">추천 보상</h4>
                <p className="text-xs text-blue-600 mb-4">친구 회사를 추천하면 건당 서비스 크레딧 지급</p>
                <div className="bg-white rounded-xl p-4 mb-3">
                  <div className="text-2xl font-extrabold text-blue-600 mb-1">1건당 1만원</div>
                  <div className="text-xs text-gray-500">서비스 이용료 크레딧으로 지급</div>
                </div>
                <div className="text-sm text-gray-600">
                  <span className="font-bold">10건</span> = 10만원 크레딧<br/>
                  <span className="font-bold">100건</span> = 100만원 크레딧
                </div>
                <p className="text-[10px] text-blue-400 mt-3">추천 랭킹 TOP도 별도 보상</p>
              </div>
              {/* 피드백 시스템 */}
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 text-center">
                <div className="text-3xl mb-3">&#x1F4AC;</div>
                <h4 className="font-bold text-emerald-900 mb-2">피드백 시스템</h4>
                <p className="text-xs text-emerald-600 mb-4">사용 중 불편한 점을 바로 전달, 다른 사용자에게는 블라인드</p>
                <div className="space-y-2 text-left">
                  {["기능 개선 요청", "새 기능 추가 제안", "버그 리포트", "UX 개선 의견"].map((item) => (
                    <div key={item} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 text-sm">
                      <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      <span className="text-gray-700">{item}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-emerald-400 mt-3">제출 건수가 랭킹에 반영됩니다</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Revenue simulation removed — now in separate IR report HTML */}

      {/* ── PARTNERSHIP INQUIRY ── */}
      <section className="py-20 px-6 bg-white" id="partner" ref={partnerRef.ref}>
        <div className="max-w-3xl mx-auto">
          <div className={`text-center mb-12 ${partnerRef.inView ? "animate-up" : "opacity-0"}`}>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">제휴 & 도입 문의</h2>
            <p className="text-gray-500 text-lg">Enterprise 도입, API 연동, 리셀러 제휴를 상담해 드립니다</p>
          </div>
          {partnerSent ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center">
              <div className="text-4xl mb-4">✅</div>
              <h3 className="text-xl font-bold text-emerald-700 mb-2">문의가 접수되었습니다</h3>
              <p className="text-sm text-emerald-600">영업일 기준 1일 이내에 회신드리겠습니다.</p>
            </div>
          ) : (
            <div className={`bg-white rounded-2xl border border-gray-200 p-8 shadow-sm ${partnerRef.inView ? "animate-up" : "opacity-0"}`} style={{ animationDelay: "0.2s" }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">회사명 *</label>
                  <input type="text" value={partnerForm.company} onChange={(e) => setPartnerForm({ ...partnerForm, company: e.target.value })} placeholder="(주)회사명" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">담당자명 *</label>
                  <input type="text" value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} placeholder="홍길동" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">이메일 *</label>
                  <input type="email" value={partnerForm.email} onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })} placeholder="email@company.com" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">연락처</label>
                  <input type="tel" value={partnerForm.phone} onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })} placeholder="010-0000-0000" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10" />
                </div>
              </div>
              <div className="mb-6">
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">문의 내용 *</label>
                <textarea value={partnerForm.message} onChange={(e) => setPartnerForm({ ...partnerForm, message: e.target.value })} placeholder="도입 규모, 필요 기능, 연동 요구사항 등을 알려주세요" rows={4} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 resize-none" />
              </div>
              <button
                onClick={handlePartnerSubmit}
                disabled={partnerSending || !partnerForm.company || !partnerForm.name || !partnerForm.email || !partnerForm.message}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition shadow-sm active:scale-[0.98]"
              >
                {partnerSending ? "접수 중..." : "문의 보내기"}
              </button>
              <p className="text-[11px] text-gray-400 mt-3 text-center">제출된 정보는 상담 목적으로만 사용되며, 개인정보처리방침에 따라 관리됩니다.</p>
            </div>
          )}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 px-6 bg-gray-50" id="faq">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">자주 묻는 질문</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:border-gray-300 transition">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full flex items-center justify-between px-6 py-5 text-left">
                  <span className="font-semibold text-sm pr-4">{faq.q}</span>
                  <svg className={`w-5 h-5 text-gray-400 shrink-0 transition-transform duration-300 ${openFaq === i ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className={`overflow-hidden transition-all duration-300 ${openFaq === i ? "max-h-40 pb-5" : "max-h-0"}`}>
                  <div className="px-6 text-sm text-gray-500 leading-relaxed">{faq.a}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="py-24 px-6 bg-[#0A0E1A] relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute w-[600px] h-[600px] rounded-full blur-[150px] bg-blue-600/20" style={{ top: "-20%", left: "20%" }} />
          <div className="absolute w-[400px] h-[400px] rounded-full blur-[120px] bg-blue-800/15" style={{ bottom: "-10%", right: "10%" }} />
        </div>
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4 tracking-tight">
            회사 현황, 한눈에 보고 싶다면<br /><span className="text-blue-400">OwnerView를 시작하세요.</span>
          </h2>
          <p className="text-slate-400 text-lg mb-8">기존 엑셀만 올리면 70% 즉시 완성. 카드 등록 없이 무료로 시작.</p>
          <Link href="/auth" className="inline-flex px-10 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-lg font-bold transition shadow-xl shadow-blue-600/30 active:scale-[0.98]">
            무료로 시작하기
          </Link>
          <p className="text-slate-500 text-sm mt-6">
            이미 계정이 있으신가요? <Link href="/auth" className="text-blue-400 hover:underline">로그인</Link>
          </p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-12 px-6 bg-[#060810] text-slate-500">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
            <div className="flex items-center gap-2.5">
              <OwnerViewLogo size={28} />
              <span className="text-white font-bold tracking-tight"><RollingBrandText /></span>
              <span className="text-xs text-slate-600 ml-2">Company Operating System</span>
            </div>
            <div className="flex gap-6 text-sm">
              <a href="#features" className="hover:text-white transition">기능</a>
              <a href="#pricing" className="hover:text-white transition">가격</a>
              <a href="#partner" className="hover:text-white transition">제휴문의</a>
              <a href="#faq" className="hover:text-white transition">FAQ</a>
            </div>
          </div>
          <div className="border-t border-white/5 pt-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
            <div className="text-center md:text-left space-y-0.5">
              <div>(주)모티브이노베이션 | 대표: 채희웅</div>
              <div>사업자등록번호: 155-88-02209 | 통신판매업신고번호: 제 2023-서울강남-04603호</div>
              <div>서울특별시 강남구 논현로98길 28, 3층 307호</div>
            </div>
            <div className="flex flex-col items-center md:items-end gap-2">
              <div className="flex gap-4">
                <Link href="/terms" className="hover:text-white transition">이용약관</Link>
                <Link href="/privacy" className="hover:text-white transition font-semibold">개인정보처리방침</Link>
                <a href="mailto:creative@mo-tive.com" className="hover:text-white transition">creative@mo-tive.com</a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
