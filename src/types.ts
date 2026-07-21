import type { TFile } from "obsidian";

export type DashboardPanelId =
  | "calendar"
  | "daily"
  | "todo"
  | "study"
  | "reading"
  | "database"
  | "projects";
export type DashboardPanelSize = "compact" | "normal" | "wide" | "tall" | "large";
export type StudyTrackerMode = "month" | "year";
export type DashboardTabId = "home" | "study" | "monthly";

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
  visiblePanels: Record<DashboardPanelId, boolean>;
  studyCheckins: StudyCheckin[];
  monthlyPlan: Record<string, string>;
}

export interface StudyCourse {
  id: string;
  module: string;
  label: string;
  index: number;
}

export interface StudyCheckin {
  courseId: string;
  date: string;
  checkedAt: number;
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
  progress: number;
}

export interface RecentThought {
  date: string;
  text: string;
  file: TFile;
  updated: number;
  tags: string[];
}

export interface DailyMonthSummary {
  date: string;
  file?: TFile;
  todos: DashboardTask[];
  inspiration: string;
  relatedNotes: string;
  readingNotes: string;
  mood: string;
  efficiency: string;
  review: string;
}

export type MonthlyDiaryFilter = "all" | "todo" | "inspiration" | "notes";

export interface DashboardData {
  today: string;
  todayFile?: TFile;
  dailySections: DailySection[];
  tasks: DashboardTask[];
  allTasks: DashboardTask[];
  dailyDates: Set<string>;
  calendarCounts: Map<string, number>;
  projects: ProjectSummary[];
  articles: LibraryItem[];
  books: LibraryItem[];
  recentThoughts: RecentThought[];
  studyCheckins: StudyCheckin[];
}
