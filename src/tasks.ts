import type { TFile } from "obsidian";
import type { DashboardCategory, DashboardTask } from "./types";

const TASK_CATEGORIES: DashboardCategory[] = ["生活", "工作", "公考", "学习", "其他"];

export function getTaskCategory(tags: string[]): DashboardCategory | undefined {
  return tags
    .map((tag) => tag.replace(/^#/, ""))
    .find((tag): tag is DashboardCategory =>
      TASK_CATEGORIES.includes(tag as DashboardCategory),
    );
}

export function extractTasks(content: string, file: TFile): DashboardTask[] {
  return content
    .split("\n")
    .map((line, index): DashboardTask | undefined => {
      const match = /^(\s*)-\s+\[( |x|X|-)\]\s+(.+)$/.exec(line);
      if (!match) {
        return undefined;
      }

      const text = match[3].trim();
      return {
        text,
        done: match[2].toLowerCase() === "x",
        due: extractDate(text),
        file,
        line: index,
        tags: Array.from(text.matchAll(/#[\p{Letter}\p{Number}/_-]+/gu)).map(
          (tag) => tag[0],
        ),
      };
    })
    .filter((task): task is DashboardTask => Boolean(task));
}

export function extractTasksFromHeading(
  content: string,
  file: TFile,
  heading: string,
): DashboardTask[] {
  const lines = content.split("\n");
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));
  if (headingIndex === -1) {
    return [];
  }

  const tasks: DashboardTask[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }

    const match = /^(\s*)-\s+\[( |x|X|-)\]\s+(.+)$/.exec(lines[index]);
    if (!match) {
      continue;
    }

    const text = match[3].trim();
    tasks.push({
      text,
      done: match[2].toLowerCase() === "x",
      due: extractDate(text),
      file,
      line: index,
      tags: Array.from(text.matchAll(/#[\p{Letter}\p{Number}/_-]+/gu)).map(
        (tag) => tag[0],
      ),
    });
  }

  return tasks;
}

export function extractLooseTasksFromHeading(
  content: string,
  file: TFile,
  heading: string,
): DashboardTask[] {
  const lines = content.split("\n");
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));
  if (headingIndex === -1) {
    return [];
  }

  const tasks: DashboardTask[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }

    const line = lines[index].trim();
    if (!line) {
      continue;
    }

    const checkbox = /^-\s+\[( |x|X|-)\]\s+(.+)$/.exec(line);
    const text = checkbox ? checkbox[2].trim() : line.replace(/^[-*]\s+/, "").trim();
    if (!text) {
      continue;
    }

    tasks.push({
      text,
      done: checkbox ? checkbox[1].toLowerCase() === "x" : false,
      due: extractDate(text),
      file,
      line: index,
      tags: Array.from(text.matchAll(/#[\p{Letter}\p{Number}/_-]+/gu)).map(
        (tag) => tag[0],
      ),
    });
  }

  return tasks;
}

export function getTasksForDate(
  date: string,
  dailyTodos: DashboardTask[],
  allOpenTasks: DashboardTask[],
): DashboardTask[] {
  const tasksByLocation = new Map<string, DashboardTask>();

  for (const task of dailyTodos) {
    if (!task.done && (!task.due || task.due === date)) {
      tasksByLocation.set(getTaskLocation(task), task);
    }
  }

  for (const task of allOpenTasks) {
    if (!task.done && task.due === date) {
      tasksByLocation.set(getTaskLocation(task), task);
    }
  }

  return Array.from(tasksByLocation.values()).sort(compareTasksForDashboard);
}

export function dedupeTasksByText(tasks: DashboardTask[]): DashboardTask[] {
  const tasksByText = new Map<string, DashboardTask>();

  for (const task of tasks) {
    const key = normalizeTaskText(task.text);
    const existing = tasksByText.get(key);
    if (!existing || getTaskPriority(task) < getTaskPriority(existing)) {
      tasksByText.set(key, task);
    }
  }

  return Array.from(tasksByText.values());
}

export function getTaskKey(task: DashboardTask): string {
  if (task.source === "monthly-plan" && task.monthlyPlanDate) {
    return `monthly-plan:${task.monthlyPlanDate}`;
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
  return b.file.stat.mtime - a.file.stat.mtime;
}

function extractDate(text: string): string | undefined {
  const explicit =
    /(?:due|scheduled|start|date)::\s*(\d{4}-\d{2}-\d{2})/i.exec(text) ??
    /[📅⏳🛫]\s*(\d{4}-\d{2}-\d{2})/u.exec(text) ??
    /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);

  if (explicit?.[1]) {
    return explicit[1];
  }

  const compact = /\b(\d{4})(\d{2})(\d{2})\b/.exec(text);
  if (compact) {
    return normalizeDateParts(compact[1], compact[2], compact[3]);
  }

  const loose = /\b(\d{4})[-/.\s]+(\d{1,2})[-/.\s]+(\d{1,2})\b/.exec(text);
  if (loose) {
    return normalizeDateParts(loose[1], loose[2], loose[3]);
  }

  return undefined;
}

function normalizeDateParts(
  year: string,
  month: string,
  day: string,
): string | undefined {
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12) {
    return undefined;
  }

  const daysInMonth = new Date(Number(year), monthNumber, 0).getDate();
  if (dayNumber < 1 || dayNumber > daysInMonth) {
    return undefined;
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function getTaskLocation(task: DashboardTask): string {
  if (task.source === "monthly-plan" && task.monthlyPlanDate) {
    return `monthly-plan:${task.monthlyPlanDate}`;
  }

  return `${task.file.path}:${task.line}`;
}

function normalizeTaskText(text: string): string {
  return stripTaskMetadata(text).replace(/\s+/g, " ").trim().toLowerCase();
}

function getTaskPriority(task: DashboardTask): number {
  if (task.source === "monthly-plan") {
    return 1;
  }

  if (task.file.path.includes("/daily/") && task.file.basename.length === 10) {
    return 0;
  }

  if (task.due) {
    return 1;
  }

  return 2;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
