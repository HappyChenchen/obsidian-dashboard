import { decodeSettings } from "./settings-codec";
import type { DashboardSettings } from "./types";
import { validateDailyLocation } from "./daily-setup";
import { moment } from "obsidian";
import { isCategoryName } from "./categories";

export function backupDocument(settings: DashboardSettings) {
  return JSON.stringify({format: "daily-backup", version: 1, createdAt: new Date().toISOString(), settings}, null, 2);
}

export function readBackup(text: string): DashboardSettings {
  if (text.length > 20 * 1024 * 1024) throw new Error("备份超过 20 MB，请检查文件。");
  const data = JSON.parse(text);
  if (data?.format !== "daily-backup" || data.version !== 1 || !data.settings || Array.isArray(data.settings)) throw new Error("请选择 Daily 导出的备份文件（版本 1）。");
  const settings = data.settings;
  const record = (v: unknown) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  if (!record(settings.monthlyPlan) || !record(settings.monthlyPlanDone) || !record(settings.monthlyPlanCategory) ||
    !Array.isArray(settings.studyCheckins) || !Array.isArray(settings.taskOrder) || typeof settings.dailyFolder !== "string" || typeof settings.dailyDateFormat !== "string") throw new Error("备份内容不完整，未恢复任何数据。");
  const normalized = decodeSettings(settings);
  validateDailyLocation(normalized.dailyFolder, normalized.dailyDateFormat);
  if (Object.entries(settings.monthlyPlanDone).some(([date, done]) => !moment(date, "YYYY-MM-DD", true).isValid() || typeof done !== "boolean") ||
    Object.entries(settings.monthlyPlanCategory).some(([date, category]) => !moment(date, "YYYY-MM-DD", true).isValid() || !isCategoryName(category)) ||
    (settings.studyCourses && (!Array.isArray(settings.studyCourses) || normalized.studyCourses.length !== settings.studyCourses.length))) throw new Error("备份含无效完成状态、标签或课程，未恢复任何数据。");
  if (Object.keys(normalized.monthlyPlan).length !== Object.keys(settings.monthlyPlan).length ||
    normalized.studyCheckins.length !== settings.studyCheckins.length) throw new Error("备份含无效日期或记录，未恢复任何数据。");
  if (settings.monthlyPlanItems && Object.entries(settings.monthlyPlanItems).some(([date, items]) =>
    JSON.stringify(normalized.monthlyPlanItems[date]) !== JSON.stringify(items))) throw new Error("备份中的计划事项与正文不一致，未恢复任何数据。");
  return normalized;
}
