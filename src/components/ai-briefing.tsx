"use client";

import { useState, useEffect, useRef } from "react";
import type { CashPulseResult } from "@/lib/cash-pulse";
import type { FounderDashboardData } from "@/lib/engines";
import { buildInitialMessage, buildAnswer } from "@/lib/ai-briefing-answers";

// ── Types ──

interface ChatMessage {
  id: string;
  role: "ai" | "user";
  text: string;
  isTyping?: boolean;
}

export interface AiBriefingProps {
  cashPulse: CashPulseResult | null;
  dashboard: FounderDashboardData | null;
  hasData: boolean;
  companyName: string;
  dealCount?: number | null;
}

interface QuickAction {
  label: string;
  key: string;
}

// ── Constants ──

const QUICK_ACTIONS: QuickAction[] = [
  { label: "이번 달 현금흐름은?", key: "cashflow" },
  { label: "미수금 현황 알려줘", key: "ar" },
  { label: "이번 분기 부가세 예측", key: "vat" },
  { label: "위험 프로젝트 알려줘", key: "risks" },
  { label: "런웨이 분석", key: "runway" },
  { label: "매출 목표 달성률", key: "revenue" },
];

const TYPING_SPEED_MS = 18;
const AI_GRADIENT = "linear-gradient(135deg, #6366f1, #8b5cf6)";
const AI_BG_LIGHT = "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.12))";
const AI_BG_SUBTLE = "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))";

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── AI Avatar ──

function AiAvatar({ size = 6 }: { size?: number }) {
  const px = size * 4;
  const fontSize = size <= 6 ? "9px" : "11px";
  return (
    <span
      className={`flex-shrink-0 flex items-center justify-center rounded-full font-bold text-white`}
      style={{ width: px, height: px, fontSize, background: AI_GRADIENT }}
    >
      AI
    </span>
  );
}

// ── Component ──

export function AiBriefing(props: AiBriefingProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasInitialized = useRef(false);

  const dataProps = {
    cashPulse: props.cashPulse,
    dashboard: props.dashboard,
    hasData: props.hasData,
    companyName: props.companyName,
  };

  useEffect(() => {
    if (isOpen && !hasInitialized.current) {
      hasInitialized.current = true;
      addAiMessage(buildInitialMessage(dataProps));
    }
  }, [isOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function addAiMessage(fullText: string) {
    const id = generateId();
    setIsAnimating(true);
    setMessages((prev) => [...prev, { id, role: "ai", text: "", isTyping: true }]);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      if (i >= fullText.length) {
        clearInterval(interval);
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: fullText, isTyping: false } : m)));
        setIsAnimating(false);
        return;
      }
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: fullText.slice(0, i) } : m)));
    }, TYPING_SPEED_MS);
  }

  function handleQuickAction(action: QuickAction) {
    if (isAnimating) return;
    setMessages((prev) => [...prev, { id: generateId(), role: "user", text: action.label }]);
    setTimeout(() => addAiMessage(buildAnswer(action.key, dataProps)), 300);
  }

  // ── Collapsed state: toggle button ──
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
        style={{ background: AI_BG_LIGHT, color: "var(--primary)", border: "1px solid rgba(99,102,241,0.2)" }}
      >
        <AiAvatar size={6} />
        AI 브리핑
      </button>
    );
  }

  // ── Expanded chat panel ──
  return (
    <section className="mb-6 rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(99,102,241,0.2)", background: "var(--bg-card)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5" style={{ background: AI_BG_SUBTLE, borderBottom: "1px solid rgba(99,102,241,0.12)" }}>
        <div className="flex items-center gap-2.5">
          <AiAvatar size={7} />
          <span className="text-sm font-bold" style={{ color: "var(--text)" }}>AI 경영 브리핑</span>
        </div>
        <button onClick={() => setIsOpen(false)} className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-surface)] transition" aria-label="닫기">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="px-5 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: 380, minHeight: 200 }}>
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-2`}>
            {msg.role === "ai" && <span className="mt-1"><AiAvatar /></span>}
            <div
              className="max-w-[85%] rounded-xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap"
              style={msg.role === "ai"
                ? { background: "var(--bg-surface)", color: "var(--text)", border: "1px solid var(--border)" }
                : { background: AI_GRADIENT, color: "#fff" }}
            >
              {msg.text}
              {msg.isTyping && <span className="inline-block w-1.5 h-4 ml-0.5 bg-[var(--primary)] rounded-sm animate-pulse" />}
            </div>
          </div>
        ))}
      </div>

      {/* Quick action chips */}
      <div className="px-5 py-3.5 flex flex-wrap gap-2" style={{ borderTop: "1px solid var(--border)" }}>
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.key}
            onClick={() => handleQuickAction(a)}
            disabled={isAnimating}
            className="px-3 py-1.5 rounded-full text-[12px] font-medium transition-all disabled:opacity-40"
            style={{ background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </section>
  );
}
