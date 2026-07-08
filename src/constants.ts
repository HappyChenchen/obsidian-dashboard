import type { DashboardPanelId, DashboardPanelSize, DashboardSettings } from "./types";

export const VIEW_TYPE_DASHBOARD = "dashboard-home-view";
export const VIEW_TYPE_MONTHLY_DIARY = "dashboard-monthly-diary-view";

export const DAILY_TEMPLATE_SECTIONS = [
  "今日todo",
  "今日关联笔记",
  "想法/思考",
  "读书笔记",
];

export const DEFAULT_PANEL_ORDER: DashboardPanelId[] = [
  "calendar",
  "daily",
  "todo",
  "database",
  "projects",
];

export const DEFAULT_PANEL_SIZES: Record<DashboardPanelId, DashboardPanelSize> = {
  calendar: "normal",
  daily: "tall",
  todo: "tall",
  database: "wide",
  projects: "normal",
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
  panelSizes: DEFAULT_PANEL_SIZES,
};
