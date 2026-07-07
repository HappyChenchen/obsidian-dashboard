import type { TFile } from "obsidian";

export type DashboardPanelId = "calendar" | "daily" | "todo" | "database" | "projects";
export type DashboardPanelSize = "compact" | "normal" | "wide" | "tall" | "large";

export interface DashboardSettings {
  dailyFolder: string;
  dailyDateFormat: string;
  projectFolder: string;
  articleFolder: string;
  bookFolder: string;
  defaultTaskSection: string;
  pomodoroMinutes: number;
  openOnStartup: boolean;
  panelOrder: DashboardPanelId[];
  panelSizes: Record<DashboardPanelId, DashboardPanelSize>;
}

export interface DashboardTask {
  text: string;
  done: boolean;
  due?: string;
  file: TFile;
  line: number;
  tags: string[];
}

export interface DailySection {
  heading: string;
  preview: string;
  lines: string[];
}

export interface ProjectSummary {
  title: string;
  file: TFile;
  status: string;
  progress: number;
  updated: number;
}

export interface LibraryItem {
  title: string;
  file: TFile;
  kind: "article" | "book";
  status: string;
  updated: number;
}

export interface RecentThought {
  date: string;
  text: string;
  file: TFile;
  updated: number;
}

export interface DashboardData {
  today: string;
  todayFile?: TFile;
  dailySections: DailySection[];
  tasks: DashboardTask[];
  allTasks: DashboardTask[];
  calendarCounts: Map<string, number>;
  projects: ProjectSummary[];
  articles: LibraryItem[];
  books: LibraryItem[];
  recentThoughts: RecentThought[];
}
