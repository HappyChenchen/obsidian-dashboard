import { DEFAULT_TASK_CATEGORIES, findTaskCategory, getTaskTags } from "./categories";
import { getMarkdownLines } from "./markdown";
import { moment } from "obsidian";
import type { TFile } from "obsidian";
import type { CalendarDayTasks, DashboardCategory, DashboardTask } from "./types";

export function getTaskCategory(tags: string[], categories: string[] = DEFAULT_TASK_CATEGORIES): DashboardCategory | undefined {
  return findTaskCategory(tags, categories);
}

export function extractTasks(content: string, file: TFile): DashboardTask[] {
  return getMarkdownLines(content).flatMap((line, index) => {
    const task = parseTaskLine(line, index, content, file, false);
    return task ? [task] : [];
  });
}

export function extractTasksFromHeading(content: string, file: TFile, heading: string): DashboardTask[] {
  return tasksUnderHeading(content, file, heading, false);
}

export function extractLooseTasksFromHeading(content: string, file: TFile, heading: string): DashboardTask[] {
  return tasksUnderHeading(content, file, heading, true);
}

function tasksUnderHeading(content: string, file: TFile, heading: string, loose: boolean): DashboardTask[] {
  const lines = getMarkdownLines(content);
  const headingIndex = lines.findIndex((line) => /^##\s+(.+?)\s*$/.exec(line)?.[1].toLowerCase() === heading.toLowerCase());
  if (headingIndex === -1) return [];
  const tasks: DashboardTask[] = [];
  for (let index = headingIndex + 1;index < lines.length;index += 1) {
    if (/^#{1,2}\s+/.test(lines[index])) break;
    const task = parseTaskLine(lines[index], index, content, file, loose);
    if (task) tasks.push(task);
  }
  return tasks;
}

function parseTaskLine(line: string, index: number, content: string, file: TFile, loose: boolean): DashboardTask | undefined {
  const checkbox = /^\s*[-*+]\s+\[( |x|X|-)\]\s+(.+)$/.exec(line);
  if (!checkbox && (!loose || !line.trim() || /^\s*(#{1,6}\s|<!--|---\s*$)/.test(line))) return undefined;
  const text = checkbox ? checkbox[2].trim() : line.trim().replace(/^[-*+]\s+/, "").trim();
  if (!text) return undefined;
  return {
    text,
    done: checkbox ? checkbox[1].toLowerCase() === "x" : false,
    ...parseTaskDate(text),
    file,
    line: index,
    sourceContent: content,
    tags: getTaskTags(text),
  };
}

export function groupCalendarTasks(
  tasks: DashboardTask[],
  dailyDatesByPath: Map<string, string>,
): Map<string, CalendarDayTasks> {
  const days = new Map<string, CalendarDayTasks>();
  for (const task of dedupeTasksByLocation(tasks)) {
    if (task.invalidDate) continue;
    const date = task.source === "monthly-plan"
      ? task.monthlyPlanDate
      : task.due ?? dailyDatesByPath.get(task.file.path);
    if (!date || !moment(date, "YYYY-MM-DD", true).isValid()) continue;
    const day = days.get(date) ?? { tasks: [], pending: 0, completed: 0 };
    day.tasks.push(task);
    if (task.done) day.completed += 1;
    else day.pending += 1;
    days.set(date, day);
  }
  for (const day of days.values()) {
    day.tasks.sort((a, b) => Number(a.done) - Number(b.done) || compareTasksForDashboard(a, b));
  }
  return days;
}

export function dedupeTasksByLocation(tasks: DashboardTask[]): DashboardTask[] {
  return Array.from(new Map(tasks.map((task) => [getTaskLocation(task), task])).values());
}

export function getTaskKey(task: DashboardTask): string {
  if (task.source === "monthly-plan") {
    return `monthly-plan:${task.monthlyPlanDate}${task.monthlyPlanItemId ? ":" + task.monthlyPlanItemId : ""}`;
  }

  return `${task.file.path}:${task.line}:${task.text}`;
}

export function applyTaskOrder(
  tasks: DashboardTask[],
  taskOrder: string[],
): DashboardTask[] {
  const order = new Map(taskOrder.map((key, index) => [key, index]));

  return tasks.slice().sort((a, b) => {
    const aIndex = order.get(getTaskKey(a));
    const bIndex = order.get(getTaskKey(b));

    if (aIndex !== undefined && bIndex !== undefined) {
      return aIndex - bIndex;
    }
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return compareTasksForDashboard(a, b);
  });
}

export function stripTaskMetadata(text: string): string {
  if (parseTaskDate(text).invalidDate) return text;
  return text
    .replace(/(?:due|scheduled|start|date)::\s*\d{4}-\d{2}-\d{2}/gi, "")
    .replace(/[📅⏳🛫]\s*\d{4}-\d{2}-\d{2}/gu, "")
    .replace(/\b\d{4}\d{2}\d{2}\b/g, "")
    .replace(/\b\d{4}[-/.\s]+\d{1,2}[-/.\s]+\d{1,2}\b/g, "")
    .trim();
}

export function compareTasksForDashboard(
  a: DashboardTask,
  b: DashboardTask,
): number {
  if (a.due && b.due) {
    return a.due.localeCompare(b.due);
  }
  if (a.due) {
    return -1;
  }
  if (b.due) {
    return 1;
  }
  return (b.file?.stat.mtime ?? 0) - (a.file?.stat.mtime ?? 0);
}

export function parseTaskDate(text: string): { due?: string; invalidDate?: string; } {
  const explicit =
    /(?:due|scheduled|start|date)::\s*(\d{4}-\d{2}-\d{2})/i.exec(text) ??
    /[📅⏳🛫]\s*(\d{4}-\d{2}-\d{2})/u.exec(text) ??
    /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  const compact = /\b(\d{4})(\d{2})(\d{2})\b/.exec(text);
  const loose = /\b(\d{4})[-/.\s]+(\d{1,2})[-/.\s]+(\d{1,2})\b/.exec(text);
  const parts = compact ?? loose;
  const raw = explicit?.[1] ?? parts?.[0];
  if (!raw) return {};
  const normalized = explicit?.[1] ?? `${parts![1]}-${parts![2].padStart(2, "0")}-${parts![3].padStart(2, "0")}`;
  return moment(normalized, "YYYY-MM-DD", true).isValid() ? { due: normalized } : { invalidDate: raw };
}

export type TaskDateGroup = "overdue" | "today" | "future" | "undated" | "invalid";
export function getTaskDateGroup(task: DashboardTask, today: string): TaskDateGroup {
  if (task.invalidDate) return "invalid";
  const date = task.due ?? task.dailyDate;
  if (!date) return "undated";
  return date < today ? "overdue" : date === today ? "today" : "future";
}

export function groupDashboardTasks(tasks: DashboardTask[], today: string) {
  const labels: Record<TaskDateGroup, string> = { overdue: "逾期", today: "今天", future: "以后", undated: "未设日期", invalid: "日期待修正" };
  return (Object.keys(labels) as TaskDateGroup[]).map((id) => ({
    id, label: labels[id], tasks: tasks.filter((task) => getTaskDateGroup(task, today) === id),
  })).filter((group) => group.tasks.length);
}

function getTaskLocation(task: DashboardTask): string {
  if (task.source === "monthly-plan") {
    return `monthly-plan:${task.monthlyPlanDate}${task.monthlyPlanItemId ? ":" + task.monthlyPlanItemId : ""}`;
  }

  return `${task.file.path}:${task.line}`;
}
