import type { DashboardSettings, MonthlyPlanItem } from "./types";
import { getTaskTags } from "./categories";

export function planText(settings: DashboardSettings, date: string): string {
  const text = settings.monthlyPlan[date] ?? "";
  const category = settings.monthlyPlanCategory[date];
  return text && category && !getTaskTags(text).length
    ? text.split(/\r?\n/).map((line) => line.trim() ? line + " #" + category : line).join("\n") : text;
}

/** Legacy multiline plans inherit their original completion state on every line. */
export function planItems(settings: DashboardSettings, date: string): MonthlyPlanItem[] {
  const text = planText(settings, date);
  const existing = settings.monthlyPlanItems?.[date];
  if (existing && existing.map((item) => item.text).join("\n") === text) return existing;
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((text, index) => ({
    id: `legacy-${date}-${index}`, text, done: Boolean(settings.monthlyPlanDone[date]),
  }));
}

export function replacePlan(settings: DashboardSettings, date: string, text: string) {
  const remaining = [...planItems(settings, date)];
  const items = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((text) => {
    const index = remaining.findIndex((item) => item.text === text);
    if (index >= 0) return remaining.splice(index, 1)[0];
    return { id: `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, text, done: false };
  });
  settings.monthlyPlanItems[date] = items;
  if (items.length) {
    settings.monthlyPlan[date] = items.map((item) => item.text).join("\n");
    if (items.every((item) => item.done)) settings.monthlyPlanDone[date] = true;
    else delete settings.monthlyPlanDone[date];
  } else {
    delete settings.monthlyPlan[date];
    delete settings.monthlyPlanDone[date];
    delete settings.monthlyPlanItems[date];
  }
  delete settings.monthlyPlanCategory[date];
}

export function normalizePlanItems(settings: DashboardSettings) {
  const source = settings.monthlyPlanItems;
  settings.monthlyPlanItems = {};
  for (const date of Object.keys(settings.monthlyPlan)) {
    const items = source?.[date];
    if (Array.isArray(items) && items.every((item) => item && typeof item.id === "string" && item.id &&
      typeof item.text === "string" && item.text.trim() && typeof item.done === "boolean") &&
      new Set(items.map((item) => item.id)).size === items.length) settings.monthlyPlanItems[date] = items;
    const migrated = planItems(settings, date);
    settings.monthlyPlanItems[date] = migrated;
    // Keep the old fields as a readable compatibility mirror.
    if (migrated.length) settings.monthlyPlan[date] = migrated.map((item) => item.text).join("\n");
    if (migrated.length && migrated.every((item) => item.done)) settings.monthlyPlanDone[date] = true;
    else delete settings.monthlyPlanDone[date];
  }
  settings.taskOrder = settings.taskOrder.flatMap((key) => {
    const date = /^monthly-plan:(\d{4}-\d{2}-\d{2})$/.exec(key)?.[1];
    return date && settings.monthlyPlanItems[date]?.length
      ? settings.monthlyPlanItems[date].map((item) => `monthly-plan:${date}:${item.id}`) : [key];
  });
}
