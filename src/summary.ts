import type {
  DashboardSummary,
  DashboardTask,
  LibraryItem,
  ProjectSummary,
} from "./types";

export function buildDashboardSummary(
  openTasks: DashboardTask[],
  projects: ProjectSummary[],
  libraryItems: LibraryItem[],
  today: string,
): DashboardSummary {
  const overdueTasks = openTasks.filter((task) => task.due && task.due < today).length;
  const todayTasks = openTasks.filter((task) => task.due === today).length;
  const upcomingTasks = openTasks.filter((task) => task.due && task.due > today).length;
  const undatedTasks = openTasks.filter((task) => !task.due).length;
  const activeProjects = projects.filter(
    (project) => !["done", "archived", "completed"].includes(project.status.toLowerCase()),
  ).length;
  const readingItems = libraryItems.filter(
    (item) => !["done", "archived", "finished"].includes(item.status.toLowerCase()),
  ).length;

  return {
    openTasks: openTasks.length,
    overdueTasks,
    todayTasks,
    upcomingTasks,
    undatedTasks,
    activeProjects,
    readingItems,
    recommendation: buildRecommendation({
      openTasks: openTasks.length,
      overdueTasks,
      todayTasks,
      upcomingTasks,
      undatedTasks,
      activeProjects,
      readingItems,
    }),
  };
}

function buildRecommendation(summary: Omit<DashboardSummary, "recommendation">): string {
  if (summary.overdueTasks > 0) {
    return `先处理 ${summary.overdueTasks} 个逾期待办。`;
  }

  if (summary.todayTasks > 0) {
    return `今天有 ${summary.todayTasks} 个带日期待办。`;
  }

  if (summary.openTasks > 8) {
    return `未完成待办偏多，适合先收敛到 3 件。`;
  }

  if (summary.undatedTasks > 0) {
    return `可以给关键待办补上日期。`;
  }

  if (summary.activeProjects > 0) {
    return `挑一个项目推进一点点。`;
  }

  if (summary.readingItems > 0) {
    return `今天适合补一条读书笔记。`;
  }

  return "今天很清爽，可以写一点想法。";
}

