"use client";
import { logRead } from "@/lib/log-read";

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  PRESET_VIEWS, ROLE_PRESETS, getDefaultWidgets, makeRolePresetConfigs,
  type WidgetConfig, type WidgetId, type RolePreset,
} from "@/lib/widget-registry";
import { supabase } from "@/lib/supabase";

// ── Types ──
interface BoardContextValue {
  activeViewId: string;
  widgets: WidgetConfig[];
  editing: boolean;
  isCustom: boolean;
  rolePreset: RolePreset | null;
  setActiveView: (viewId: string) => void;
  isWidgetVisible: (widgetId: WidgetId) => boolean;
  toggleEditing: () => void;
  toggleWidget: (widgetId: WidgetId) => void;
  setRolePreset: (preset: RolePreset) => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

const STORAGE_KEY = "leanos-board-config";

interface StoredConfig {
  activeViewId: string;
  customWidgets?: Record<string, boolean>;
  rolePreset?: RolePreset;
}

// ── Supabase persistence helpers ──
// DB 에 저장될 모양의 서명 — 보이는 위젯 집합과 역할 프리셋만 본다.
//   편집 모드 진입은 지금 보이는 위젯을 custom 으로 옮겨 적을 뿐 보이는 것이 같으니 저장할 게 없다.
function prefsSignature(visibleIds: string[], rolePreset: RolePreset | null | undefined): string {
  return JSON.stringify([[...visibleIds].sort(), rolePreset || "ceo"]);
}

// 보기 id·custom 설정 → 보이는 위젯 id (Provider 의 resolveWidgets 와 같은 규칙)
function visibleIdsOf(viewId: string, custom: Record<string, boolean> | null | undefined): string[] {
  const list = viewId === "custom" && custom
    ? getDefaultWidgets().map(w => ({ ...w, visible: custom[w.id] ?? w.visible }))
    : (PRESET_VIEWS.find(v => v.id === viewId)?.widgets || getDefaultWidgets());
  return list.filter(w => w.visible).map(w => w.id);
}

async function loadPrefsFromDB(): Promise<StoredConfig | null> {
  try {
    // getSession(로컬) — 랜딩마다 getUser 인증 서버 왕복 제거. RLS 가 서버에서 권한 강제.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;

    const data = logRead('components/board-context:data', await (supabase)
      .from("user_preferences")
      .select("role_preset, dashboard_widgets")
      .eq("user_id", user.id)
      .maybeSingle());

    if (!data) return null;

    const widgets = data.dashboard_widgets as Record<string, { visible: boolean; order: number }> | null;
    const customWidgets: Record<string, boolean> = {};
    let hasCustom = false;

    if (widgets) {
      Object.entries(widgets).forEach(([id, cfg]) => {
        customWidgets[id] = cfg.visible;
        hasCustom = true;
      });
    }

    return {
      activeViewId: hasCustom ? "custom" : "default",
      customWidgets: hasCustom ? customWidgets : undefined,
      rolePreset: (data.role_preset || undefined) as RolePreset | undefined,
    };
  } catch {
    return null;
  }
}

async function savePrefsToDB(config: StoredConfig): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return false;

    // Get company_id
    // auth uid 는 auth_id 컬럼과 비교 (id 와 다른 계정 존재 → 위젯 설정 저장 조용히 실패했음)
    const userData = logRead('components/board-context:userData', await (supabase)
      .from("users")
      .select("company_id")
      .eq("auth_id", user.id)
      .maybeSingle());

    if (!userData?.company_id) return false;

    // Build dashboard_widgets JSONB from customWidgets
    const dashboardWidgets: Record<string, { visible: boolean; order: number }> = {};
    if (config.customWidgets) {
      Object.entries(config.customWidgets).forEach(([id, visible], idx) => {
        dashboardWidgets[id] = { visible, order: idx };
      });
    }

    const { error } = await (supabase)
      .from("user_preferences")
      .upsert({
        user_id: user.id,
        company_id: userData.company_id,
        role_preset: config.rolePreset || "ceo",
        dashboard_widgets: Object.keys(dashboardWidgets).length > 0 ? dashboardWidgets : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,company_id" });
    return !error;
  } catch {
    // Silent fail — localStorage is fallback
    return false;
  }
}

// ── Provider ──
export function BoardProvider({ children }: { children: ReactNode }) {
  const [activeViewId, setActiveViewId] = useState("default");
  const [customWidgets, setCustomWidgets] = useState<Record<string, boolean> | null>(null);
  const [editing, setEditing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [dbReadAt, setDbReadAt] = useState(0);
  const [rolePreset, setRolePresetState] = useState<RolePreset | null>(null);
  //   DB 에 있는(또는 방금 저장한) 설정의 서명. null = DB 를 아직 못 읽음 → 저장하지 않는다.
  //   예전엔 열기만 해도 기본값(role_preset "ceo")이 저장됐고, DB 값이 도착하면 한 번 더, 편집 모드 진입에 또 한 번 저장됐다.
  const dbSig = useRef<string | null>(null);
  const viewRef = useRef(activeViewId);
  useEffect(() => { viewRef.current = activeViewId; }, [activeViewId]);

  // 1) Instant hydration from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: StoredConfig = JSON.parse(stored);
        if (parsed.activeViewId) setActiveViewId(parsed.activeViewId);
        if (parsed.customWidgets && parsed.activeViewId === "custom") {
          setCustomWidgets(parsed.customWidgets);
        }
        if (parsed.rolePreset) setRolePresetState(parsed.rolePreset);
      }
    } catch {}
    setHydrated(true);
  }, []);

  // 2) Then load from Supabase (overwrites localStorage if newer)
  useEffect(() => {
    if (!hydrated) return;
    loadPrefsFromDB().then(dbConfig => {
      // DB 에 위젯 설정이 없으면(행 없음·프리셋 보기) 지금 보고 있는 프리셋 보기와 같은 것으로 본다 —
      //   DB 는 프리셋 보기를 구분해 담지 못하므로(위젯 칸 null), 다시 써 봐야 같은 값이다.
      const localView = viewRef.current !== "custom" ? viewRef.current : "default";
      dbSig.current = prefsSignature(
        dbConfig?.customWidgets ? visibleIdsOf("custom", dbConfig.customWidgets) : visibleIdsOf(localView, null),
        dbConfig?.rolePreset);
      if (!dbConfig) { setDbReadAt(Date.now()); return; }
      if (dbConfig.rolePreset) setRolePresetState(dbConfig.rolePreset);
      if (dbConfig.customWidgets) {
        setCustomWidgets(dbConfig.customWidgets);
        setActiveViewId("custom");
      }
      setDbReadAt(Date.now());
    });
  }, [hydrated]);

  // Persist to localStorage + Supabase (debounced)
  useEffect(() => {
    if (!hydrated) return;
    const config: StoredConfig = { activeViewId, rolePreset: rolePreset || undefined };
    if (activeViewId === "custom" && customWidgets) {
      config.customWidgets = customWidgets;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {}

    // Debounced DB save — DB 를 읽은 뒤, 보이는 위젯·프리셋이 DB 와 달라졌을 때만
    if (dbSig.current === null) return;
    const sig = prefsSignature(visibleIdsOf(activeViewId, customWidgets), rolePreset);
    if (sig === dbSig.current) return;
    const timer = setTimeout(() => {
      savePrefsToDB(config).then(ok => { if (ok) dbSig.current = sig; });
    }, 1500);
    return () => clearTimeout(timer);
  }, [activeViewId, customWidgets, rolePreset, hydrated, dbReadAt]);

  const isCustom = activeViewId === "custom";

  // Resolve widgets: custom overrides or preset
  const resolveWidgets = useCallback((): WidgetConfig[] => {
    if (isCustom && customWidgets) {
      return getDefaultWidgets().map(w => ({
        ...w,
        visible: customWidgets[w.id] ?? w.visible,
      }));
    }
    return PRESET_VIEWS.find(v => v.id === activeViewId)?.widgets || getDefaultWidgets();
  }, [activeViewId, isCustom, customWidgets]);

  const widgets = resolveWidgets();

  // Switch to a preset view (exits editing, clears custom)
  const setActiveView = useCallback((viewId: string) => {
    setActiveViewId(viewId);
    if (viewId !== "custom") {
      setCustomWidgets(null);
    }
    setEditing(false);
  }, []);

  const isWidgetVisible = useCallback((widgetId: WidgetId): boolean => {
    const w = widgets.find(c => c.id === widgetId);
    return w?.visible ?? false;
  }, [widgets]);

  const toggleEditing = useCallback(() => {
    setEditing(prev => {
      if (!prev) {
        // Entering edit mode: snapshot current widgets into customWidgets
        const snapshot: Record<string, boolean> = {};
        widgets.forEach(w => { snapshot[w.id] = w.visible; });
        setCustomWidgets(snapshot);
        setActiveViewId("custom");
      }
      return !prev;
    });
  }, [widgets]);

  const toggleWidget = useCallback((widgetId: WidgetId) => {
    setCustomWidgets(prev => {
      if (!prev) return prev;
      return { ...prev, [widgetId]: !prev[widgetId] };
    });
  }, []);

  // Set role preset → apply its default widgets as custom config
  const setRolePreset = useCallback((preset: RolePreset) => {
    setRolePresetState(preset);
    const configs = makeRolePresetConfigs(preset);
    const snapshot: Record<string, boolean> = {};
    configs.forEach(w => { snapshot[w.id] = w.visible; });
    setCustomWidgets(snapshot);
    setActiveViewId("custom");
    setEditing(false);
  }, []);

  return (
    <BoardContext.Provider value={{
      activeViewId, widgets, editing, isCustom, rolePreset,
      setActiveView, isWidgetVisible, toggleEditing, toggleWidget, setRolePreset,
    }}>
      {children}
    </BoardContext.Provider>
  );
}

// ── Hook ──
export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) {
    throw new Error("useBoard must be used within a BoardProvider");
  }
  return ctx;
}
