import type { DashboardPanelId, DashboardPanelSize, DashboardSettings } from "./types";

export const VIEW_TYPE_DASHBOARD = "dashboard-home-view";
export const VIEW_TYPE_MONTHLY_DIARY = "dashboard-monthly-diary-view";
export const VIEW_TYPE_STUDY_TRACKER = "dashboard-study-tracker-view";

export const DAILY_TEMPLATE_SECTIONS = [
  "今日todo",
  "今日关联笔记",
  "想法/思考",
];

export const DAILY_TEMPLATE_HINTS: Record<string, string> = {
  今日todo: "<!-- 分类：在每条 Todo 末尾添加 #生活、#工作、#公考、#学习 或 #其他 -->",
};

export const DEFAULT_PANEL_ORDER: DashboardPanelId[] = [
  "calendar",
  "daily",
  "todo",
  "study",
  "database",
  "projects",
];

export const DEFAULT_PANEL_SIZES: Record<DashboardPanelId, DashboardPanelSize> = {
  calendar: "normal",
  daily: "tall",
  todo: "tall",
  study: "normal",
  database: "wide",
  projects: "normal",
};

export const DEFAULT_VISIBLE_PANELS: Record<DashboardPanelId, boolean> = {
  calendar: true,
  daily: true,
  todo: true,
  study: false,
  database: false,
  projects: false,
};

export const DEFAULT_SETTINGS: DashboardSettings = {
  dailyFolder: "Daily/YYYY/MM",
  dailyDateFormat: "YYYY-MM-DD",
  projectFolder: "Projects",
  articleFolder: "Library/Articles",
  bookFolder: "Library/Books",
  defaultTaskSection: "今日todo",
  pomodoroMinutes: 25,
  openOnStartup: false,
  panelOrder: DEFAULT_PANEL_ORDER,
  taskOrder: [],
  panelSizes: DEFAULT_PANEL_SIZES,
  visiblePanels: DEFAULT_VISIBLE_PANELS,
  studyCheckins: [],
  monthlyPlan: {},
  monthlyPlanDone: {},
  monthlyPlanCategory: {},
};
