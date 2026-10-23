import { moment } from "obsidian";
import { getSectionText } from "./notes";
import { getTaskCategory, parseTaskDate } from "./tasks";
import type { DailySection, DashboardTask } from "./types";

export function categorizeTasks(tasks: DashboardTask[], categories: string[]): DashboardTask[] {
  return tasks.map((task) => ({
    ...task,
    category:
      getTaskCategory(task.tags, categories),
  }));
}

export function getDailyText(sections: DailySection[], headings: string[]): string {
  return getSectionText(
    sections.find((section) => headings.includes(section.heading)),
  );
}

export function getRecentInspirationPreview(
  sections: DailySection[],
  headings = ["今日灵感", "灵感", "想法/思考"],
): Array<{ label: string; text: string; }> {
  const previews: Array<{ label: string; text: string; }> = [];
  let remaining = 150;

  for (const section of sections) {
    const text = getSectionText(section).replace(/\s+/g, " ").trim();
    if (!text || remaining <= 0) {
      continue;
    }

    const heading = section.heading.trim();
    if (!headings.includes(heading)) {
      continue;
    }

    const snippet = truncateText(text, remaining);
    previews.push({ label: "想法", text: snippet });
    remaining -= snippet.length + 2;
  }

  return previews;
}

export function getDailyValue(
  frontmatter: Record<string, unknown>,
  sections: DailySection[],
  frontmatterKeys: string[],
  headings: string[],
): string {
  for (const key of frontmatterKeys) {
    const value = frontmatter[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) {
        return text;
      }
    }
  }

  return getDailyText(sections, headings);
}

export function getSafeMonth(month: string): moment.Moment {
  const parsed = moment(month, "YYYY-MM", true);
  return parsed.isValid() ? parsed : moment();
}

export function parseDashboardDate(
  date: string,
  dailyDateFormat: string,
): moment.Moment | undefined {
  for (const format of Array.from(new Set(["YYYY-MM-DD", dailyDateFormat]))) {
    const parsed = moment(date, format, true);
    if (parsed.isValid()) {
      return parsed;
    }
  }

  return undefined;
}

export function buildQuickTaskLine(text: string): string | undefined {
  const cleanText = text.trim().replace(/\s+/g, " ");
  if (!cleanText) {
    return undefined;
  }

  const parsed = parseTaskDate(cleanText);
  if (parsed.invalidDate) throw new Error(`日期无效：${parsed.invalidDate}，请检查月份和天数。`);
  if (/(?:due|scheduled|start|date)::|[📅⏳🛫]/iu.test(cleanText)) return `- [ ] ${cleanText}`;

  const dateMatch =
    /(^|[^\d])(\d{4})(\d{2})(\d{2})(?=[^\d]|$)/.exec(cleanText) ??
    /(^|[^\d])(\d{4})[-/.\s]+(\d{1,2})[-/.\s]+(\d{1,2})(?=[^\d]|$)/.exec(
      cleanText,
    );
  if (!dateMatch) {
    return `- [ ] ${cleanText}`;
  }

  const [, prefix, year, month, day] = dateMatch;
  const dueDate = moment(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
    "YYYY-MM-DD",
    true,
  );
  const dateStart = dateMatch.index + prefix.length;
  const dateEnd = dateMatch.index + dateMatch[0].length;
  const taskText = `${cleanText.slice(0, dateStart)} ${cleanText.slice(dateEnd)}`
    .replace(/\s+/g, " ")
    .trim();

  if (!dueDate.isValid() || !taskText) {
    return `- [ ] ${cleanText}`;
  }

  return `- [ ] ${taskText} 📅 ${dueDate.format("YYYY-MM-DD")}`;
}

export function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}
