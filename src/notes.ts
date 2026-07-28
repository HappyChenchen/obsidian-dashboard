import { App, TFile, moment } from "obsidian";
import type { DailySection, LibraryItem, ProjectSummary } from "./types";
import { extractTasks } from "./tasks";

export function extractDailySections(content: string): DailySection[] {
  const lines = content.split("\n");
  const sections: DailySection[] = [];
  let current: { heading: string; lines: string[] } | undefined;

  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      if (current) {
        sections.push(toDailySection(current));
      }
      current = { heading: heading[1].trim(), lines: [] };
      continue;
    }

    if (current && !/^---$/.test(line)) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push(toDailySection(current));
  }

  return sections;
}

export function getSectionText(section: DailySection | undefined): string {
  if (!section) {
    return "";
  }

  return section.lines
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !/^<!--.*-->$/.test(line))
    .join("\n");
}

export function isProjectFile(
  file: TFile,
  frontmatter: Record<string, unknown>,
  folder: string,
): boolean {
  if (isReadmeFile(file)) {
    return false;
  }

  const type = String(frontmatter.type ?? "").toLowerCase();
  return isInFolder(file, folder) || type === "project";
}

export function buildProjectSummary(
  file: TFile,
  content: string,
  frontmatter: Record<string, unknown>,
): ProjectSummary {
  const tasks = extractTasks(content, file);
  const total = tasks.length;
  const done = tasks.filter((task) => task.done).length;

  return {
    title: String(frontmatter.title ?? file.basename),
    file,
    status: String(frontmatter.status ?? "active"),
    progress: total === 0 ? 0 : Math.round((done / total) * 100),
    updated: file.stat.mtime,
  };
}

export function isLibraryFile(
  file: TFile,
  frontmatter: Record<string, unknown>,
  folder: string,
  kind: "article" | "book",
): boolean {
  if (isReadmeFile(file)) {
    return false;
  }

  const type = String(frontmatter.type ?? "").toLowerCase();
  const tags = normalizeTags(frontmatter.tags);
  return isInFolder(file, folder) || type === kind || tags.includes(kind);
}

export function buildLibraryItem(
  file: TFile,
  frontmatter: Record<string, unknown>,
  kind: "article" | "book",
): LibraryItem {
  return {
    title: String(frontmatter.title ?? file.basename),
    file,
    kind,
    status: String(frontmatter.status ?? (kind === "book" ? "reading" : "saved")),
    updated: file.stat.mtime,
    progress: getReadingProgress(frontmatter),
  };
}

export function normalizeFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "");
}

export function getFirstStaticDailyFolderSegment(
  folderTemplate: string,
): string | undefined {
  return normalizeFolder(folderTemplate)
    .split("/")
    .find((segment) => segment && !isDateFolderSegment(segment));
}

export function renderDailyFolder(
  folderTemplate: string,
  date: string,
  dateFormat: string,
): string {
  const normalized = normalizeFolder(folderTemplate);
  if (!normalized) {
    return "";
  }

  const parsed = moment(date, dateFormat, true);
  const dailyMoment = parsed.isValid() ? parsed : moment(date);

  return normalized
    .split("/")
    .map((segment) =>
      isDateFolderSegment(segment) ? dailyMoment.format(segment) : segment,
    )
    .join("/");
}

export async function ensureFolder(app: App, folder: string) {
  const parts = normalizeFolder(folder).split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

export function appendLineUnderHeading(
  content: string,
  heading: string,
  lineToAppend: string,
): string {
  const lines = content.split("\n");
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));

  if (headingIndex === -1) {
    const suffix = content.endsWith("\n") ? "" : "\n";
    return `${content}${suffix}\n## ${heading}\n${lineToAppend}\n`;
  }

  let insertIndex = headingIndex + 1;
  while (insertIndex < lines.length && !/^##\s+/.test(lines[insertIndex])) {
    insertIndex += 1;
  }

  lines.splice(insertIndex, 0, lineToAppend);
  return lines.join("\n");
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(
    2,
    "0",
  )}`;
}

function toDailySection(section: { heading: string; lines: string[] }): DailySection {
  const preview = section.lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");

  return {
    heading: section.heading,
    preview,
    lines: section.lines,
  };
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).replace(/^#/, "").toLowerCase());
  }

  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((tag) => tag.replace(/^#/, "").toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function isInFolder(file: TFile, folder: string): boolean {
  const normalized = normalizeFolder(folder);
  return Boolean(normalized) && file.path.startsWith(`${normalized}/`);
}

function isReadmeFile(file: TFile): boolean {
  return file.basename.toLowerCase() === "readme";
}

function getReadingProgress(frontmatter: Record<string, unknown>): number {
  const directProgress = Number(
    frontmatter.progress ?? frontmatter.reading_progress,
  );
  if (Number.isFinite(directProgress)) {
    return Math.min(100, Math.max(0, Math.round(directProgress)));
  }

  const currentPage = Number(frontmatter.current_page);
  const totalPages = Number(frontmatter.total_pages);
  if (Number.isFinite(currentPage) && Number.isFinite(totalPages) && totalPages > 0) {
    return Math.min(100, Math.max(0, Math.round((currentPage / totalPages) * 100)));
  }

  return 0;
}

function isDateFolderSegment(segment: string): boolean {
  return /^(Y{2,4}|M{1,2}|D{1,2}|[-_.\s])+$/.test(segment);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
