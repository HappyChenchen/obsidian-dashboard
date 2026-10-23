import type { TFile } from "obsidian";

export type DashboardPanelId =
  | "calendar"
  | "daily"
  | "todo"
  | "study"
  | "database";
export type DashboardCategory = string;
export type DashboardCategoryFilter = `category:${string}` | "all" | "uncategorized";
export type DashboardPanelSize = "compact" | "normal" | "wide" | "tall" | "large";
export type StudyTrackerMode = "month" | "year";
export type DashboardTabId = "home" | "study" | "monthly";

export interface DashboardSettings {
  dailySetupComplete: boolean;
  dailyFolderLiteral: boolean;
  homeTitle: string;
  recentThoughtCount: number;
  dailyFolder: string;
  dailyDateFormat: string;
  articleFolder: string;
  bookFolder: string;
  defaultTaskSection: string;
  thoughtSection: string;
  dailyPreviewSections: string[];
  taskSource: "all" | "daily" | "folders";
  taskFolders: string[];
  taskExcludedFolders: string[];
  completedTaskDisplay: "hide" | "collapsed" | "show";
  weekStartsOn: 0 | 1;
  taskCategories: string[];
  defaultTaskCategory: string;
  openOnStartup: boolean;
  panelOrder: DashboardPanelId[];
  taskOrder: string[];
  panelSizes: Record<DashboardPanelId, DashboardPanelSize>;
  visiblePanels: Record<DashboardPanelId, boolean>;
  studyEnabled: boolean;
  studyCourses: StudyCourse[];
  studyCheckins: StudyCheckin[];
  monthlyPlan: Record<string, string>;
  monthlyPlanDone: Record<string, boolean>;
  monthlyPlanCategory: Record<string, DashboardCategory>;
  monthlyPlanItems: Record<string, MonthlyPlanItem[]>;
}

export interface MonthlyPlanItem { id: string; text: string; done: boolean; }

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

interface TaskContent {
  text: string;
  done: boolean;
  due?: string;
  dailyDate?: string;
  invalidDate?: string;
  line: number;
  sourceContent?: string;
  tags: string[];
  category?: DashboardCategory;
}

export type DashboardTask = TaskContent & (
  | { source?: "note"; file: TFile; monthlyPlanDate?: never; }
  | { source: "monthly-plan"; monthlyPlanDate: string; monthlyPlanItemId?: string; file?: never; }
);

export interface CalendarDayTasks {
  tasks: DashboardTask[];
  pending: number;
  completed: number;
}

export interface DailySection {
  heading: string;
  preview: string;
  lines: string[];
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
  previewSections: Array<{ label: string; text: string; }>;
  file: TFile;
  updated: number;
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
  monthlyPlan: string;
  monthlyPlanDone: boolean;
  monthlyPlanCategory?: DashboardCategory;
}

export type MonthlyDiaryFilter = "all" | "todo" | "inspiration" | "notes";

export interface DashboardData {
  today: string;
  todayFile?: TFile;
  dailySections: DailySection[];
  tasks: DashboardTask[];
  dailyDates: Set<string>;
  completedTasks: DashboardTask[];
  calendarTasks: Map<string, CalendarDayTasks>;
  articles: LibraryItem[];
  books: LibraryItem[];
  recentThoughts: RecentThought[];
  studyCheckins: StudyCheckin[];
}
