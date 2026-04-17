"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
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
async function loadPrefsFromDB(): Promise<StoredConfig | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await (supabase as any)
      .from("user_preferences")
      .select("role_preset, dashboard_widgets")
      .eq("user_id", user.id)
      .single();

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
      rolePreset: data.role_preset || undefined,
    };
  } catch {
    return null;
  }
}

async function savePrefsToDB(config: StoredConfig): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get company_id
    const { data: userData } = await (supabase as any)
      .from("users")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (!userData?.company_id) return;

    // Build dashboard_widgets JSONB from customWidgets
    const dashboardWidgets: Record<string, { visible: boolean; order: number }> = {};
    if (config.customWidgets) {
      Object.entries(config.customWidgets).forEach(([id, visible], idx) => {
        dashboardWidgets[id] = { visible, order: idx };
      });
    }

    await (supabase as any)
      .from("user_preferences")
      .upsert({
        user_id: user.id,
        company_id: userData.company_id,
        role_preset: config.rolePreset || "ceo",
        dashboard_widgets: Object.keys(dashboardWidgets).length > 0 ? dashboardWidgets : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,company_id" });
  } catch {
    // Silent fail — localStorage is fallback
  }
}

// ── Provider ──
export function BoardProvider({ children }: { children: ReactNode }) {
  const [activeViewId, setActiveViewId] = useState("default");
  const [customWidgets, setCustomWidgets] = useState<Record<string, boolean> | null>(null);
  const [editing, setEditing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [rolePreset, setRolePresetState] = useState<RolePreset | null>(null);

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
      if (!dbConfig) return;
      if (dbConfig.rolePreset) setRolePresetState(dbConfig.rolePreset);
      if (dbConfig.customWidgets) {
        setCustomWidgets(dbConfig.customWidgets);
        setActiveViewId("custom");
      }
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

    // Debounced DB save
    const timer = setTimeout(() => {
      savePrefsToDB(config);
    }, 1500);
    return () => clearTimeout(timer);
  }, [activeViewId, customWidgets, rolePreset, hydrated]);

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
