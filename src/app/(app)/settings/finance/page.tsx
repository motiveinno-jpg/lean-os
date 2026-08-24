"use client";
//   회계·세무 — 사이드바 '회사 관리' 그룹의 한 줄 (2026-08-24 설정 IA 재편).
//   담는 것: 자금·통장 · 계정과목·분류 · 회계마감 · 세무 파트너
//   화면은 전부 SettingsShell 이 그린다. 여기서 그룹만 지정한다 — IA 원본은 lib/settings-nav.ts.
import { SettingsShell } from "../_components/SettingsShell";

export default function SettingsGroupPage() {
  return <SettingsShell group="finance" />;
}
