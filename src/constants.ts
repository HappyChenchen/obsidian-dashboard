import type { DashboardSettings } from "./types";

export const VIEW_TYPE_DASHBOARD = "dashboard-home-view";

export const DAILY_TEMPLATE_SECTIONS = [
  "今日todo",
  "今日关联笔记",
  "想法/思考",
  "读书笔记",
];

export const DEFAULT_SETTINGS: DashboardSettings = {
  dailyFolder: "Daily",
  dailyDateFormat: "YYYY-MM-DD",
  projectFolder: "Projects",
  articleFolder: "Articles",
  bookFolder: "Books",
  defaultTaskSection: "今日todo",
  pomodoroMinutes: 25,
  openOnStartup: false,
};

