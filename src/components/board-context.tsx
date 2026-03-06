"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { PRESET_VIEWS, getDefaultWidgets, type WidgetConfig, type WidgetId } from "@/lib/widget-registry";

// ── Types ──
interface BoardContextValue {
  activeViewId: string;
  widgets: WidgetConfig[];
  editing: boolean;
  isCustom: boolean;
  setActiveView: (viewId: string) => void;
  isWidgetVisible: (widgetId: WidgetId) => boolean;
  toggleEditing: () => void;
  toggleWidget: (widgetId: WidgetId) => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

const STORAGE_KEY = "leanos-board-config";

interface StoredConfig {
  activeViewId: string;
  customWidgets?: Record<string, boolean>; // widgetId → visible
}

// ── Provider ──
export function BoardProvider({ children }: { children: ReactNode }) {
  const [activeViewId, setActiveViewId] = useState("default");
  const [customWidgets, setCustomWidgets] = useState<Record<string, boolean> | null>(null);
  const [editing, setEditing] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Read from localStorage after hydration
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: StoredConfig = JSON.parse(stored);
        if (parsed.activeViewId) {
          setActiveViewId(parsed.activeViewId);
        }
        if (parsed.customWidgets && parsed.activeViewId === "custom") {
          setCustomWidgets(parsed.customWidgets);
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  // Persist to localStorage
  useEffect(() => {
    if (!hydrated) return;
    try {
      const config: StoredConfig = { activeViewId };
      if (activeViewId === "custom" && customWidgets) {
        config.customWidgets = customWidgets;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {}
  }, [activeViewId, customWidgets, hydrated]);

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

  return (
    <BoardContext.Provider value={{
      activeViewId, widgets, editing, isCustom,
      setActiveView, isWidgetVisible, toggleEditing, toggleWidget,
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
