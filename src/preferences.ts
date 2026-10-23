import { DEFAULT_SETTINGS } from "./constants";
import type { DashboardSettings } from "./types";

export const PREFERENCE_KEYS = [
  "homeTitle", "recentThoughtCount", "defaultTaskSection", "thoughtSection", "dailyPreviewSections",
  "taskSource", "taskFolders", "taskExcludedFolders", "completedTaskDisplay", "weekStartsOn",
] as const;
export type Preferences = Pick<DashboardSettings, typeof PREFERENCE_KEYS[number]>;

export function parseSectionNames(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim().replace(/^#{1,6}\s+/, "")).filter(Boolean))];
}

export function parseTaskFolders(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((folder) => {
    if (/^[\\/]|^[A-Za-z]:|[*?]/.test(folder) || folder.split(/[\\/]/).some((part) => part === ".." || part === ".")) {
      throw new Error("请填写笔记库内的相对文件夹路径，不使用 .. 或通配符。");
    }
    return folder.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/$/, "");
  }))];
}

export function normalizePreferences(value: Partial<DashboardSettings>): Preferences {
  const heading = (input: unknown, fallback: string) => typeof input === "string" ? parseSectionNames(input)[0] || fallback : fallback;
  const folders = (input: unknown) => {
    if (!Array.isArray(input)) return [];
    return input.flatMap((entry) => {
      try { return typeof entry === "string" ? parseTaskFolders(entry) : []; } catch { return []; }
    });
  };
  return {
    homeTitle: typeof value.homeTitle === "string" ? value.homeTitle.trim().replace(/\s+/g, " ") || DEFAULT_SETTINGS.homeTitle : DEFAULT_SETTINGS.homeTitle,
    recentThoughtCount: [0, 3, 5, 10].includes(value.recentThoughtCount as number) ? value.recentThoughtCount! : 3,
    defaultTaskSection: heading(value.defaultTaskSection, DEFAULT_SETTINGS.defaultTaskSection),
    thoughtSection: heading(value.thoughtSection, DEFAULT_SETTINGS.thoughtSection),
    dailyPreviewSections: Array.isArray(value.dailyPreviewSections) ? parseSectionNames(value.dailyPreviewSections.filter((entry) => typeof entry === "string").join("\n")) : [],
    taskSource: value.taskSource === "daily" || value.taskSource === "folders" ? value.taskSource : "all",
    taskFolders: folders(value.taskFolders),
    taskExcludedFolders: folders(value.taskExcludedFolders),
    completedTaskDisplay: value.completedTaskDisplay === "collapsed" || value.completedTaskDisplay === "show" ? value.completedTaskDisplay : "hide",
    weekStartsOn: value.weekStartsOn === 1 ? 1 : 0,
  };
}

export function includesTaskFile(path: string, isDaily: boolean, settings: DashboardSettings): boolean {
  const inFolder = (folder: string) => path.startsWith(folder + "/");
  if (settings.taskExcludedFolders.some(inFolder)) return false;
  if (settings.taskSource === "daily") return isDaily;
  if (settings.taskSource === "folders") return settings.taskFolders.some(inFolder);
  return true;
}

export function getThoughtHeadings(settings: DashboardSettings): string[] {
  return [...new Set([settings.thoughtSection, "今日灵感", "灵感", "想法/思考"])];
}

export function getWeekOffset(day: number, weekStartsOn: 0 | 1): number {
  return (day - weekStartsOn + 7) % 7;
}

export function getWeekdayLabels(weekStartsOn: 0 | 1, labels = ["日", "一", "二", "三", "四", "五", "六"]): string[] {
  return [...labels.slice(weekStartsOn), ...labels.slice(0, weekStartsOn)];
}
