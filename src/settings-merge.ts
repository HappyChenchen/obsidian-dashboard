import type { DashboardSettings, MonthlyPlanItem } from "./types";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function merge(base: unknown, local: unknown, remote: unknown, path: string): unknown {
  if (same(local, remote) || same(base, remote)) return local;
  if (same(base, local)) return remote;
  if (object(base) && object(local) && object(remote)) {
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      const value = merge(base[key], local[key], remote[key], `${path}/${key}`);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  throw new Error(`同步冲突：${path}。本机与同步版本均已保留，请在数据管理中选择版本。`);
}

/** Treat a day's text and completion as one record, so their compatibility mirrors cannot diverge. */
export function mergeSettings(base: DashboardSettings, local: DashboardSettings, remote: DashboardSettings): DashboardSettings {
  type PlanRecord = {text: string; done: boolean; category?: string; items?: MonthlyPlanItem[]};
  const pack = (settings: DashboardSettings) => {
    const {monthlyPlan, monthlyPlanDone, monthlyPlanCategory, monthlyPlanItems, studyCheckins, ...rest} = settings;
    const plans: Record<string, PlanRecord> = {};
    for (const date of Object.keys(monthlyPlan)) plans[date] = {text: monthlyPlan[date], done: Boolean(monthlyPlanDone[date]), category: monthlyPlanCategory[date], items: monthlyPlanItems[date]};
    return {...rest, plans, checkins: Object.fromEntries(studyCheckins.map((item) => [item.date + ":" + item.courseId, item]))};
  };
  // Each plan is deliberately atomic; different dates can still merge.
  const b = pack(base), l = pack(local), r = pack(remote);
  const plans: Record<string, PlanRecord> = {};
  for (const date of new Set([...Object.keys(b.plans), ...Object.keys(l.plans), ...Object.keys(r.plans)])) {
    const bv = b.plans[date], lv = l.plans[date], rv = r.plans[date];
    if (!same(lv, rv) && !same(bv, lv) && !same(bv, rv)) throw new Error(`同步冲突：${date} 的计划。本机与同步版本均已保留，请在数据管理中选择版本。`);
    const value = same(bv, lv) ? rv : lv;
    if (value !== undefined) plans[date] = value;
  }
  const combined = merge({...b, plans: {}}, {...l, plans: {}}, {...r, plans: {}}, "设置") as ReturnType<typeof pack>;
  const {checkins, plans: _, ...rest} = combined;
  const result = {...rest, studyCheckins: Object.values(checkins), monthlyPlan: {}, monthlyPlanDone: {}, monthlyPlanCategory: {}, monthlyPlanItems: {}} as DashboardSettings;
  for (const [date, plan] of Object.entries(plans)) {
    result.monthlyPlan[date] = plan.text;
    if (plan.done) result.monthlyPlanDone[date] = true;
    if (plan.category !== undefined) result.monthlyPlanCategory[date] = plan.category;
    if (plan.items !== undefined) result.monthlyPlanItems[date] = plan.items;
  }
  return result;
}
