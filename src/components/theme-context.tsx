"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const THEME_KEY = "leanos-theme";

/** 저장해 둔 취향 — 없거나 이상한 값이면 밝은 화면 */
function savedTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

/*  ── 랜딩 계열은 언제나 밝게 (2026-08-14 사장님 지시로 이 PC 에서 처리) ──
 *
 *  랜딩·무료 도구 화면(landing.css, lp4-)은 **밝은 화면 하나로만** 그려져 있다 — 어두운 짝이 없다.
 *  그런데 달력·드롭다운처럼 **화면 위로 겹쳐 뜨는 부품은 body 로 나가** 랜딩 화면 바깥에 그려지고,
 *  거기서는 <html data-theme> 를 그대로 따른다. 그래서 앱에서 다크를 쓰던 사람이 무료 도구에 오면
 *  밝은 페이지 위에 **검은 달력**이 떴다 (2026-08-14 무료 도구 달력 교체 때 실측으로 확인).
 *
 *  고치는 자리를 부품(달력)이 아니라 **테마**로 잡은 이유: 달력만 고쳐 두면 다음에 랜딩에 올려 쓰는
 *  다른 겹침 부품에서 같은 일이 또 난다. "랜딩에서는 다크를 적용하지 않는다"가 진짜 규칙이다.
 *
 *  ★ 저장된 취향(localStorage)은 **건드리지 않는다.** 화면에 거는 표시만 잠시 밝게 바꾸므로,
 *    앱으로 돌아가면 다크 그대로다. 랜딩 화면이 여럿 겹칠 수 있어 개수로 센다(0 이 되면 되돌린다).
 */
let lightLocks = 0;

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", lightLocks > 0 ? "light" : t);
}

/**
 * 이 화면이 떠 있는 동안 밝게 고정 — **랜딩 상단바(LandingNav)가 부른다.**
 *   랜딩 계열 = 랜딩 상단바를 쓰는 화면이라, 거기 한 줄만 두면 새 랜딩 페이지가 늘어도 저절로 따라온다.
 *   ⚠️ 첫 진입 때는 이 훅(자식)이 ThemeProvider(부모)보다 **먼저** 돈다 — 그래서 부모도 잠금을
 *      보고 칠하도록 applyTheme 하나로 모아 뒀다. 여기서 attribute 를 직접 쓰면 부모가 덮어쓴다.
 */
export function useLandingLightTheme() {
  useEffect(() => {
    lightLocks += 1;
    applyTheme(savedTheme());
    return () => {
      lightLocks = Math.max(0, lightLocks - 1);
      applyTheme(savedTheme());
    };
  }, []);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = savedTheme();
    setTheme(saved);
    applyTheme(saved);
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div style={{ visibility: mounted ? 'visible' : 'hidden' }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
