import { DEFAULT_TASK_CATEGORIES } from "./categories";
import type { DashboardPanelId, DashboardPanelSize, DashboardSettings, MonthlyDiaryFilter } from "./types";

export const VIEW_TYPE_DASHBOARD = "dashboard-home-view";
export const VIEW_TYPE_MONTHLY_DIARY = "dashboard-monthly-diary-view";
export const VIEW_TYPE_STUDY_TRACKER = "dashboard-study-tracker-view";

export const DEFAULT_PANEL_ORDER: DashboardPanelId[] = [
  "calendar",
  "daily",
  "todo",
  "study",
  "database",
];

export const DEFAULT_PANEL_SIZES: Record<DashboardPanelId, DashboardPanelSize> = {
  calendar: "normal",
  daily: "tall",
  todo: "tall",
  study: "normal",
  database: "wide",
};

export const DEFAULT_VISIBLE_PANELS: Record<DashboardPanelId, boolean> = {
  calendar: true,
  daily: true,
  todo: true,
  study: false,
  database: false,
};

export const DEFAULT_SETTINGS: DashboardSettings = {
  dailySetupComplete: false,
  dailyFolderLiteral: false,
  homeTitle: "今天",
  recentThoughtCount: 3,
  dailyFolder: "Daily/YYYY/MM",
  dailyDateFormat: "YYYY-MM-DD",
  articleFolder: "Library/Articles",
  bookFolder: "Library/Books",
  defaultTaskSection: "今日todo",
  thoughtSection: "想法/思考",
  dailyPreviewSections: [],
  taskSource: "all",
  taskFolders: [],
  taskExcludedFolders: [],
  completedTaskDisplay: "hide",
  weekStartsOn: 0,
  taskCategories: DEFAULT_TASK_CATEGORIES,
  defaultTaskCategory: "",
  openOnStartup: false,
  panelOrder: DEFAULT_PANEL_ORDER,
  taskOrder: [],
  panelSizes: DEFAULT_PANEL_SIZES,
  visiblePanels: DEFAULT_VISIBLE_PANELS,
  studyEnabled: false,
  studyCourses: [],
  studyCheckins: [],
  monthlyPlan: {},
  monthlyPlanDone: {},
  monthlyPlanCategory: {},
  monthlyPlanItems: {},
};

export const MONTHLY_DIARY_FILTERS: Array<{ id: MonthlyDiaryFilter; label: string; }> = [
  { id: "all", label: "全部" },
  { id: "todo", label: "Todo" },
  { id: "inspiration", label: "灵感" },
  { id: "notes", label: "笔记" },
];
