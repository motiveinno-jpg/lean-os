"use client";

// 메뉴 가이드 드로어 열림 상태 공유 컨텍스트.
//   헤더의 '?' 버튼(MenuGuideButton)과 셸의 본문/헤더 밀기, 우측 드로어(MenuGuideDrawer)가 같은 상태를 본다.
//   side-effect 0 (localStorage 저장 안 함 — 세션 중 임시 열림 상태).

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface GuideContextValue {
  open: boolean;
  openGuide: () => void;
  closeGuide: () => void;
  toggleGuide: () => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function GuideProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openGuide = useCallback(() => setOpen(true), []);
  const closeGuide = useCallback(() => setOpen(false), []);
  const toggleGuide = useCallback(() => setOpen((v) => !v), []);
  return (
    <GuideContext.Provider value={{ open, openGuide, closeGuide, toggleGuide }}>
      {children}
    </GuideContext.Provider>
  );
}

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error("useGuide must be used within a GuideProvider");
  return ctx;
}
