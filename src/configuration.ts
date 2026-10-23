import { isCategoryName } from "./categories";
import { moment } from "obsidian";
import { DEFAULT_PANEL_ORDER, DEFAULT_PANEL_SIZES, DEFAULT_VISIBLE_PANELS } from "./constants";
import type { DashboardCategory, DashboardPanelId, DashboardPanelSize } from "./types";

export function normalizePanelOrder(panelOrder: unknown): DashboardPanelId[] {
  const validPanelIds = new Set<DashboardPanelId>(DEFAULT_PANEL_ORDER);
  const normalized = Array.isArray(panelOrder)
    ? panelOrder.filter((panelId): panelId is DashboardPanelId =>
      validPanelIds.has(panelId as DashboardPanelId),
    )
    : [];

  for (const panelId of DEFAULT_PANEL_ORDER) {
    if (!normalized.includes(panelId)) {
      const insertBefore = DEFAULT_PANEL_ORDER.slice(
        DEFAULT_PANEL_ORDER.indexOf(panelId) + 1,
      ).find((nextPanelId) => normalized.includes(nextPanelId));
      const insertIndex = insertBefore ? normalized.indexOf(insertBefore) : -1;
      if (insertIndex === -1) {
        normalized.push(panelId);
      } else {
        normalized.splice(insertIndex, 0, panelId);
      }
    }
  }

  return normalized;
}

export function normalizeTaskOrder(taskOrder: unknown): string[] {
  if (!Array.isArray(taskOrder)) {
    return [];
  }

  return taskOrder.filter(
    (key): key is string => typeof key === "string" && key.length > 0,
  );
}

export function normalizePanelSizes(
  panelSizes: unknown,
): Record<DashboardPanelId, DashboardPanelSize> {
  const validSizes = new Set<DashboardPanelSize>([
    "compact",
    "normal",
    "wide",
    "tall",
    "large",
  ]);
  const source =
    panelSizes && typeof panelSizes === "object"
      ? (panelSizes as Partial<Record<DashboardPanelId, DashboardPanelSize>>)
      : {};
  const normalized = { ...DEFAULT_PANEL_SIZES };

  for (const panelId of DEFAULT_PANEL_ORDER) {
    const size = source[panelId];
    if (size && validSizes.has(size)) {
      normalized[panelId] = size;
    }
  }

  return normalized;
}

export function normalizePanelVisibility(
  visiblePanels: unknown,
): Record<DashboardPanelId, boolean> {
  const source =
    visiblePanels && typeof visiblePanels === "object"
      ? (visiblePanels as Partial<Record<DashboardPanelId, boolean>>)
      : {};
  const normalized = { ...DEFAULT_VISIBLE_PANELS };

  for (const panelId of DEFAULT_PANEL_ORDER) {
    if (typeof source[panelId] === "boolean") {
      normalized[panelId] = source[panelId] as boolean;
    }
  }

  return normalized;
}

export function normalizeMonthlyPlan(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [date, text] of Object.entries(value)) {
    if (moment(date, "YYYY-MM-DD", true).isValid() && typeof text === "string" && text.trim()) {
      normalized[date] = text;
    }
  }
  return normalized;
}

export function normalizeMonthlyPlanDone(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Record<string, boolean> = {};
  for (const [date, done] of Object.entries(value)) {
    if (moment(date, "YYYY-MM-DD", true).isValid() && typeof done === "boolean") {
      normalized[date] = done;
    }
  }
  return normalized;
}

export function normalizeMonthlyPlanCategory(
  value: unknown,
): Record<string, DashboardCategory> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Record<string, DashboardCategory> = {};
  for (const [date, category] of Object.entries(value)) {
    if (
      moment(date, "YYYY-MM-DD", true).isValid() &&
      isCategoryName(category)
    ) {
      normalized[date] = category as DashboardCategory;
    }
  }
  return normalized;
}
