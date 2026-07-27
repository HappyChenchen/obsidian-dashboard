import {
  App,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  moment,
  setIcon,
} from "obsidian";
import {
  DAILY_TEMPLATE_SECTIONS,
  DEFAULT_PANEL_ORDER,
  DEFAULT_PANEL_SIZES,
  DEFAULT_VISIBLE_PANELS,
  DEFAULT_SETTINGS,
  VIEW_TYPE_DASHBOARD,
  VIEW_TYPE_MONTHLY_DIARY,
  VIEW_TYPE_STUDY_TRACKER,
} from "./constants";
import {
  appendLineUnderHeading,
  buildLibraryItem,
  buildProjectSummary,
  ensureFolder,
  extractDailySections,
  formatDuration,
  getSectionText,
  isLibraryFile,
  isProjectFile,
  renderDailyFolder,
} from "./notes";
import {
  compareTasksForDashboard,
  dedupeTasksByText,
  extractLooseTasksFromHeading,
  extractTasks,
  applyTaskOrder,
  getTasksForDate,
  getTaskKey,
  getTaskCategory,
  inferTaskCategory,
  stripTaskMetadata,
} from "./tasks";
import {
  getStudyCheckinCountByDate,
  getStudyCheckinsForDate,
  getStudyCourse,
  normalizeStudyCheckins,
  STUDY_COURSES,
  STUDY_MODULES,
} from "./study";
import type {
  DashboardCategory,
  DashboardCategoryFilter,
  DashboardData,
  DailySection,
  DailyMonthSummary,
  DashboardPanelId,
  DashboardPanelSize,
  DashboardSettings,
  DashboardTask,
  DashboardTabId,
  LibraryItem,
  MonthlyDiaryFilter,
  ProjectSummary,
  RecentThought,
  StudyCheckin,
  StudyCourse,
  StudyTrackerMode,
} from "./types";

const MONTHLY_DIARY_FILTERS: Array<{ id: MonthlyDiaryFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "todo", label: "Todo" },
  { id: "inspiration", label: "灵感" },
  { id: "notes", label: "笔记" },
];

const DASHBOARD_CATEGORY_FILTERS: Array<{
  id: DashboardCategoryFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "生活", label: "生活" },
  { id: "工作", label: "工作" },
  { id: "公考", label: "公考" },
  { id: "学习", label: "学习" },
  { id: "其他", label: "其他" },
  { id: "uncategorized", label: "未分类" },
];
const DASHBOARD_CATEGORIES: DashboardCategory[] = ["生活", "工作", "公考", "学习", "其他"];

export default class DashboardPlugin extends Plugin {
  settings: DashboardSettings = DEFAULT_SETTINGS;
  private refreshTimer?: number;
  private layoutCleanupTimer?: number;

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_DASHBOARD,
      (leaf) => new DashboardView(leaf, this),
    );
    this.registerView(
      VIEW_TYPE_MONTHLY_DIARY,
      (leaf) => new MonthlyDiaryView(leaf, this),
    );
    this.registerView(
      VIEW_TYPE_STUDY_TRACKER,
      (leaf) => new StudyTrackerView(leaf, this),
    );

    this.addRibbonIcon("home", "打开 Dashboard", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-dashboard-home",
      name: "Open dashboard home",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "open-today-daily-note",
      name: "Open today's daily note",
      callback: async () => {
        const file = await this.ensureDailyNote();
        await this.openFile(file);
      },
    });

    this.addCommand({
      id: "open-monthly-diary",
      name: "Open monthly diary panel",
      callback: () => this.activateMonthlyDiaryView(),
    });

    this.addCommand({
      id: "open-study-tracker",
      name: "Open study tracker",
      callback: () => this.activateStudyTrackerView(),
    });

    this.addCommand({
      id: "refresh-dashboard-home",
      name: "Refresh dashboard home",
      callback: () => this.refreshDashboardViews(),
    });

    this.addSettingTab(new DashboardSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on("create", () => this.queueRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.queueRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.queueRefresh()));
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.queueRefresh()),
    );

    this.app.workspace.onLayoutReady(() => {
      const dashboardLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
      if (dashboardLeaf) {
        this.collapseOtherRootSplits(dashboardLeaf);
      }
      if (this.settings.openOnStartup) {
        void this.activateView();
      }

      // Obsidian may finish restoring a split just after layout-ready fires.
      // Re-check once after that restore so duplicate dashboard leaves cannot
      // leave the home view trapped in a shortened pane.
      this.layoutCleanupTimer = window.setTimeout(() => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
        if (leaf) this.collapseOtherRootSplits(leaf);
      }, 300);
    });
  }

  onunload() {
    window.clearTimeout(this.layoutCleanupTimer);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MONTHLY_DIARY);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_STUDY_TRACKER);
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    this.settings.panelOrder = normalizePanelOrder(this.settings.panelOrder);
    this.settings.taskOrder = normalizeTaskOrder(this.settings.taskOrder);
    this.settings.panelSizes = normalizePanelSizes(this.settings.panelSizes);
    this.settings.visiblePanels = normalizePanelVisibility(this.settings.visiblePanels);
    this.settings.studyCheckins = normalizeStudyCheckins(this.settings.studyCheckins);
    this.settings.monthlyPlan = normalizeMonthlyPlan(this.settings.monthlyPlan);
    this.settings.monthlyPlanDone = normalizeMonthlyPlanDone(this.settings.monthlyPlanDone);
    this.settings.monthlyPlanCategory = normalizeMonthlyPlanCategory(
      this.settings.monthlyPlanCategory,
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshDashboardViews();
  }

  async movePanel(draggedPanelId: DashboardPanelId, targetPanelId: DashboardPanelId) {
    if (draggedPanelId === targetPanelId) {
      return;
    }

    const order = normalizePanelOrder(this.settings.panelOrder).filter(
      (panelId) => panelId !== draggedPanelId,
    );
    const targetIndex = order.indexOf(targetPanelId);
    order.splice(targetIndex === -1 ? order.length : targetIndex, 0, draggedPanelId);
    this.settings.panelOrder = order;
    await this.saveSettings();
  }

  async moveTaskOrder(draggedTaskKey: string, targetTaskKey: string) {
    if (draggedTaskKey === targetTaskKey) {
      return;
    }

    const order = normalizeTaskOrder(this.settings.taskOrder).filter(
      (key) => key !== draggedTaskKey,
    );
    const targetIndex = order.indexOf(targetTaskKey);
    order.splice(targetIndex === -1 ? order.length : targetIndex, 0, draggedTaskKey);
    this.settings.taskOrder = order;
    await this.saveSettings();
  }

  async resizePanel(panelId: DashboardPanelId, size: DashboardPanelSize) {
    this.settings.panelSizes = {
      ...normalizePanelSizes(this.settings.panelSizes),
      [panelId]: size,
    };
    await this.saveSettings();
  }

  isPanelVisible(panelId: DashboardPanelId): boolean {
    return normalizePanelVisibility(this.settings.visiblePanels)[panelId];
  }

  async setPanelVisibility(panelId: DashboardPanelId, visible: boolean) {
    this.settings.visiblePanels = {
      ...normalizePanelVisibility(this.settings.visiblePanels),
      [panelId]: visible,
    };
    await this.saveSettings();
  }

  async activateView() {
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf(false);

    await leaf.setViewState({
      type: VIEW_TYPE_DASHBOARD,
      active: true,
    });

    this.collapseOtherRootSplits(leaf);
    this.app.workspace.revealLeaf(leaf);
  }

  collapseOtherRootSplits(keepLeaf: WorkspaceLeaf) {
    const rootLeaves: WorkspaceLeaf[] = [];
    this.app.workspace.iterateRootLeaves((leaf) => {
      rootLeaves.push(leaf);
    });

    const dashboardLeaves = new Set(
      this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD),
    );

    for (const leaf of rootLeaves) {
      if (leaf === keepLeaf) continue;

      const viewType = leaf.view?.getViewType?.();
      const isEmptyLeaf = viewType === "empty" || viewType === "empty-view";

      // Only remove duplicate dashboard leaves or empty placeholders. A real
      // note opened in another pane belongs to the user and must stay open.
      if (dashboardLeaves.has(leaf) || isEmptyLeaf) {
        leaf.detach();
      }
    }
  }

  async activateMonthlyDiaryView(month = moment().format("YYYY-MM")) {
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MONTHLY_DIARY);
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf(false);

    await leaf.setViewState({
      type: VIEW_TYPE_MONTHLY_DIARY,
      active: true,
    });

    if (leaf.view instanceof MonthlyDiaryView) {
      await leaf.view.setMonth(month);
    }

    this.app.workspace.revealLeaf(leaf);
  }

  refreshDashboardViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
      const view = leaf.view;
      if (view instanceof DashboardView) {
        view.render();
      }
    }
  }

  refreshMonthlyDiaryViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MONTHLY_DIARY)) {
      const view = leaf.view;
      if (view instanceof MonthlyDiaryView) {
        view.render();
      }
    }
  }

  refreshStudyTrackerViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STUDY_TRACKER)) {
      const view = leaf.view;
      if (view instanceof StudyTrackerView) {
        view.render();
      }
    }
  }

  queueRefresh() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshDashboardViews();
      this.refreshMonthlyDiaryViews();
      this.refreshStudyTrackerViews();
    }, 400);
  }

  async activateStudyTrackerView(
    date = moment().format("YYYY-MM-DD"),
    mode: StudyTrackerMode = "month",
  ) {
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STUDY_TRACKER);
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf(false);

    await leaf.setViewState({
      type: VIEW_TYPE_STUDY_TRACKER,
      active: true,
    });

    if (leaf.view instanceof StudyTrackerView) {
      await leaf.view.setDate(date, mode);
    }

    this.app.workspace.revealLeaf(leaf);
  }

  async collectData(): Promise<DashboardData> {
    const today = moment().format("YYYY-MM-DD");
    const todayFile = this.getDailyFile(today);
    const dailySections = todayFile
      ? extractDailySections(await this.app.vault.cachedRead(todayFile))
      : [];

    const files = this.app.vault.getMarkdownFiles();
    const tasks: DashboardTask[] = [];
    const dailyDates = new Set<string>();
    const dailyTodosByDate = new Map<string, DashboardTask[]>();
    const projects: ProjectSummary[] = [];
    const articles: LibraryItem[] = [];
    const books: LibraryItem[] = [];
    const recentThoughts: RecentThought[] = [];

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter ?? {};

      tasks.push(...categorizeTasks(extractTasks(content, file)));

      const dailyDate = this.getDateFromDailyFile(file);
      if (dailyDate) {
        dailyDates.add(dailyDate);
        const dailySectionsForFile = extractDailySections(content);
        const dailyTodos = categorizeTasks(extractLooseTasksFromHeading(
          content,
          file,
          this.settings.defaultTaskSection,
        )).filter((task) => !task.done);
        tasks.push(...dailyTodos);
        dailyTodosByDate.set(dailyDate, dailyTodos);

        if (dailyDate <= today) {
          const previewSections = getRecentInspirationPreview(dailySectionsForFile);
          if (previewSections.length > 0) {
            recentThoughts.push({
              date: dailyDate,
              previewSections,
              file,
              updated: file.stat.mtime,
            });
          }
        }
      }

      if (isProjectFile(file, frontmatter, this.settings.projectFolder)) {
        projects.push(buildProjectSummary(file, content, frontmatter));
      }

      if (isLibraryFile(file, frontmatter, this.settings.articleFolder, "article")) {
        articles.push(buildLibraryItem(file, frontmatter, "article"));
      }

      if (isLibraryFile(file, frontmatter, this.settings.bookFolder, "book")) {
        books.push(buildLibraryItem(file, frontmatter, "book"));
      }
    }

    for (const [date, text] of Object.entries(this.settings.monthlyPlan)) {
      const sourceFile = this.getDailyFile(date) ?? files[0];
      if (!sourceFile) {
        continue;
      }

      tasks.push({
        text,
        done: Boolean(this.settings.monthlyPlanDone[date]),
        due: date,
        file: sourceFile,
        line: -1,
        tags: [],
        category:
          this.settings.monthlyPlanCategory[date] ?? inferTaskCategory(text),
        source: "monthly-plan",
        monthlyPlanDate: date,
      });
    }

    const allOpenTasks = dedupeTasksByText(tasks.filter((task) => !task.done))
      .sort(compareTasksForDashboard);
    const orderedTasks = applyTaskOrder(allOpenTasks, this.settings.taskOrder);

    const calendarCounts = new Map<string, number>();
    const calendarDates = new Set<string>();
    for (const task of allOpenTasks) {
      if (task.due) {
        calendarDates.add(task.due);
      }
    }
    for (const date of dailyTodosByDate.keys()) {
      calendarDates.add(date);
    }
    for (const date of calendarDates) {
      const count = getTasksForDate(
        date,
        dailyTodosByDate.get(date) ?? [],
        allOpenTasks,
      ).length;
      if (count > 0) {
        calendarCounts.set(date, count);
      }
    }

    return {
      today,
      todayFile,
      dailySections,
      tasks: orderedTasks.slice(0, 30),
      allTasks: allOpenTasks,
      dailyDates,
      calendarCounts,
      projects: projects.sort((a, b) => b.updated - a.updated).slice(0, 10),
      articles: articles.sort((a, b) => b.updated - a.updated).slice(0, 8),
      books: books.sort((a, b) => b.updated - a.updated).slice(0, 8),
      recentThoughts: recentThoughts
        .sort((a, b) => b.date.localeCompare(a.date) || b.updated - a.updated),
      studyCheckins: this.settings.studyCheckins,
    };
  }

  getStudyCourses(): StudyCourse[] {
    return STUDY_COURSES;
  }

  getStudyCheckinsForDate(date: string): StudyCheckin[] {
    return getStudyCheckinsForDate(this.settings.studyCheckins, date);
  }

  isStudyCourseCheckedIn(courseId: string, date: string): boolean {
    return this.settings.studyCheckins.some(
      (checkin) => checkin.courseId === courseId && checkin.date === date,
    );
  }

  async toggleStudyCheckin(courseId: string, date: string) {
    if (!getStudyCourse(courseId) || !moment(date, "YYYY-MM-DD", true).isValid()) {
      return;
    }

    const existingIndex = this.settings.studyCheckins.findIndex(
      (checkin) => checkin.courseId === courseId && checkin.date === date,
    );
    if (existingIndex >= 0) {
      this.settings.studyCheckins.splice(existingIndex, 1);
    } else {
      this.settings.studyCheckins.push({
        courseId,
        date,
        checkedAt: Date.now(),
      });
    }

    this.settings.studyCheckins = normalizeStudyCheckins(this.settings.studyCheckins);
    await this.saveData(this.settings);
    this.refreshDashboardViews();
    this.refreshStudyTrackerViews();
  }

  async saveMonthlyPlanText(date: string, text: string) {
    if (!moment(date, "YYYY-MM-DD", true).isValid()) {
      return;
    }

    const value = text.trim();
    if (value) {
      if (this.settings.monthlyPlan[date] !== value) {
        delete this.settings.monthlyPlanDone[date];
      }
      this.settings.monthlyPlan[date] = value;
    } else {
      delete this.settings.monthlyPlan[date];
      delete this.settings.monthlyPlanDone[date];
      delete this.settings.monthlyPlanCategory[date];
    }
    await this.saveData(this.settings);
  }

  async saveMonthlyPlanCategory(date: string, category: DashboardCategory | "") {
    if (!moment(date, "YYYY-MM-DD", true).isValid()) {
      return;
    }

    if (category) {
      this.settings.monthlyPlanCategory[date] = category;
    } else {
      delete this.settings.monthlyPlanCategory[date];
    }
    await this.saveData(this.settings);
  }

  async toggleMonthlyPlanTask(date: string) {
    if (!this.settings.monthlyPlan[date]) {
      return;
    }

    this.settings.monthlyPlanDone[date] = !Boolean(
      this.settings.monthlyPlanDone[date],
    );
    await this.saveData(this.settings);
    this.refreshDashboardViews();
    this.refreshMonthlyDiaryViews();
  }

  getDailyFile(date: string): TFile | undefined {
    const parsedDate = parseDashboardDate(date, this.settings.dailyDateFormat);
    if (!parsedDate) {
      return undefined;
    }

    const fileDate = parsedDate.format(this.settings.dailyDateFormat);
    const folder = renderDailyFolder(
      this.settings.dailyFolder,
      fileDate,
      this.settings.dailyDateFormat,
    );
    const path = folder ? `${folder}/${fileDate}.md` : `${fileDate}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : undefined;
  }

  getDateFromDailyFile(file: TFile): string | undefined {
    const parsedDate = moment(file.basename, this.settings.dailyDateFormat, true);
    if (!parsedDate.isValid()) {
      return undefined;
    }

    const folder = renderDailyFolder(
      this.settings.dailyFolder,
      file.basename,
      this.settings.dailyDateFormat,
    );
    const expectedPath = folder
      ? `${folder}/${file.basename}.md`
      : `${file.basename}.md`;
    if (file.path !== expectedPath) {
      return undefined;
    }

    return parsedDate.format("YYYY-MM-DD");
  }

  async collectDailyMonthSummaries(
    month = moment().format("YYYY-MM"),
  ): Promise<DailyMonthSummary[]> {
    const safeMonth = getSafeMonth(month);
    const summaries: DailyMonthSummary[] = [];

    for (let day = 1; day <= safeMonth.daysInMonth(); day += 1) {
      const date = safeMonth.clone().date(day).format("YYYY-MM-DD");
      const file = this.getDailyFile(date);
      if (!file) {
        summaries.push({
          date,
          todos: [],
          inspiration: "",
          relatedNotes: "",
          readingNotes: "",
          mood: "",
          efficiency: "",
          review: "",
          monthlyPlan: this.settings.monthlyPlan[date] ?? "",
          monthlyPlanDone: Boolean(this.settings.monthlyPlanDone[date]),
          monthlyPlanCategory:
            this.settings.monthlyPlanCategory[date] ??
            inferTaskCategory(this.settings.monthlyPlan[date] ?? ""),
        });
        continue;
      }

      const content = await this.app.vault.cachedRead(file);
      const sections = extractDailySections(content);
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

      summaries.push({
        date,
        file,
        todos: categorizeTasks(
          extractLooseTasksFromHeading(content, file, this.settings.defaultTaskSection),
        ),
        inspiration: getDailyText(sections, ["今日灵感", "灵感", "想法/思考"]),
        relatedNotes: getDailyText(sections, ["今日关联笔记", "关联笔记"]),
        readingNotes: getDailyText(sections, ["读书笔记", "阅读笔记"]),
        mood: getDailyValue(frontmatter, sections, ["mood", "心情", "today_mood"], [
          "今日心情",
          "心情",
        ]),
        efficiency: getDailyValue(frontmatter, sections, [
          "efficiency",
          "效率",
          "productivity",
        ], ["今日效率", "效率"]),
        review: getDailyValue(frontmatter, sections, [
          "review",
          "self_review",
          "评价",
          "自我评价",
        ], ["自我评价", "今日评价", "复盘"]),
        monthlyPlan: this.settings.monthlyPlan[date] ?? "",
        monthlyPlanDone: Boolean(this.settings.monthlyPlanDone[date]),
        monthlyPlanCategory:
          this.settings.monthlyPlanCategory[date] ??
          inferTaskCategory(this.settings.monthlyPlan[date] ?? ""),
      });
    }

    return summaries;
  }

  async getDailyTodoTasks(date: string): Promise<DashboardTask[]> {
    const normalizedDate = parseDashboardDate(
      date,
      this.settings.dailyDateFormat,
    )?.format("YYYY-MM-DD");
    if (!normalizedDate) {
      return [];
    }

    const file = this.getDailyFile(normalizedDate);
    if (!file) {
      return [];
    }

    const content = await this.app.vault.cachedRead(file);
    return categorizeTasks(
      extractLooseTasksFromHeading(content, file, this.settings.defaultTaskSection),
    );
  }

  async getTodosForDate(date: string, allTasks: DashboardTask[]): Promise<DashboardTask[]> {
    const normalizedDate = parseDashboardDate(
      date,
      this.settings.dailyDateFormat,
    )?.format("YYYY-MM-DD");
    if (!normalizedDate) {
      return [];
    }

    const dailyTodos = await this.getDailyTodoTasks(normalizedDate);
    return getTasksForDate(normalizedDate, dailyTodos, allTasks);
  }

  async ensureDailyNote(date = moment().format("YYYY-MM-DD")): Promise<TFile> {
    const parsedDate = parseDashboardDate(date, this.settings.dailyDateFormat);
    if (!parsedDate) {
      throw new Error(`Invalid daily note date: ${date}`);
    }

    const isoDate = parsedDate.format("YYYY-MM-DD");
    const fileDate = parsedDate.format(this.settings.dailyDateFormat);
    const existing = this.getDailyFile(isoDate);
    if (existing) {
      return existing;
    }

    const folder = renderDailyFolder(
      this.settings.dailyFolder,
      fileDate,
      this.settings.dailyDateFormat,
    );
    if (folder) {
      await ensureFolder(this.app, folder);
    }

    const path = folder ? `${folder}/${fileDate}.md` : `${fileDate}.md`;
    const content = [
      "---",
      "type: daily",
      `date: ${isoDate}`,
      "---",
      "",
      `# ${isoDate}`,
      "",
      ...DAILY_TEMPLATE_SECTIONS.flatMap((heading) => [`## ${heading}`, ""]),
    ].join("\n");

    return this.app.vault.create(path, content);
  }

  async appendTaskToToday(text: string) {
    const taskLine = buildQuickTaskLine(text);
    if (!taskLine) {
      return;
    }

    const file = await this.ensureDailyNote();
    const content = await this.app.vault.cachedRead(file);
    const nextContent = appendLineUnderHeading(
      content,
      this.settings.defaultTaskSection,
      taskLine,
    );
    await this.app.vault.modify(file, nextContent);
    new Notice("已记录到今天的 Todo。");
  }

  async appendPomodoroLog(minutes: number) {
    const file = await this.ensureDailyNote();
    const now = moment().format("HH:mm");
    const content = await this.app.vault.cachedRead(file);
    const nextContent = appendLineUnderHeading(
      content,
      "Pomodoro",
      `- ${now} focused for ${minutes} minutes`,
    );
    await this.app.vault.modify(file, nextContent);
  }

  async completeDailyTemplate(file: TFile) {
    const content = await this.app.vault.cachedRead(file);
    const headings = extractDailySections(content).map((section) => section.heading);
    const missingHeadings = DAILY_TEMPLATE_SECTIONS.filter(
      (heading) => !headings.includes(heading),
    );

    if (missingHeadings.length === 0) {
      new Notice("今日模板已经完整。");
      return;
    }

    const suffix = content.endsWith("\n") ? "" : "\n";
    const nextContent = [
      `${content}${suffix}`,
      ...missingHeadings.flatMap((heading) => [`## ${heading}`, ""]),
    ].join("\n");

    await this.app.vault.modify(file, nextContent);
    new Notice("今日模板已补全。");
  }

  async toggleTask(task: DashboardTask) {
    if (task.source === "monthly-plan" && task.monthlyPlanDate) {
      await this.toggleMonthlyPlanTask(task.monthlyPlanDate);
      return;
    }

    const content = await this.app.vault.cachedRead(task.file);
    const lines = content.split("\n");
    const line = lines[task.line];
    if (!line) {
      return;
    }

    if (/^(\s*-\s+\[)( |x|X|-)(\]\s+)/.test(line)) {
      lines[task.line] = line.replace(
        /^(\s*-\s+\[)( |x|X|-)(\]\s+)/,
        `$1${task.done ? " " : "x"}$3`,
      );
    } else {
      const indent = /^(\s*)/.exec(line)?.[1] ?? "";
      const text = line.trim().replace(/^[-*]\s+/, "").trim();
      lines[task.line] = `${indent}- [x] ${text}`;
    }
    await this.app.vault.modify(task.file, lines.join("\n"));
  }

  async openFile(file: TFile) {
    await this.app.workspace.getLeaf(false).openFile(file);
  }
}

class DashboardView extends ItemView {
  private plugin: DashboardPlugin;
  private dashboardLeaf: WorkspaceLeaf;
  private activeTab: DashboardTabId = "home";
  private monthlyPlanMonth = moment().format("YYYY-MM");
  private todoCategory: DashboardCategoryFilter = "all";
  private studyTrackerRenderer?: StudyTrackerView;
  private selectedCalendarDate = moment().format("YYYY-MM-DD");
  private draggedPanelId?: DashboardPanelId;
  private resizingPanel?: {
    card: HTMLElement;
    panelId: DashboardPanelId;
    startX: number;
    startY: number;
    size: DashboardPanelSize;
  };
  private pomodoroRemaining = 0;
  private pomodoroRunning = false;
  private pomodoroTimer?: number;
  private calendarClickTimer?: number;

  constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
    super(leaf);
    this.dashboardLeaf = leaf;
    this.plugin = plugin;
    this.pomodoroRemaining = plugin.settings.pomodoroMinutes * 60;
  }

  getViewType() {
    return VIEW_TYPE_DASHBOARD;
  }

  getDisplayText() {
    return "Dashboard Home";
  }

  getIcon() {
    return "layout-dashboard";
  }

  async onOpen() {
    await this.render();
  }

  async onClose() {
    window.clearInterval(this.pomodoroTimer);
    window.clearTimeout(this.calendarClickTimer);
  }

  getPanelSize(panelId: DashboardPanelId): DashboardPanelSize {
    return normalizePanelSizes(this.plugin.settings.panelSizes)[panelId];
  }

  async render() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("dashboard-home");
    root.createDiv({ cls: "dashboard-home__loading", text: "正在加载首页…" });

    const data = await this.plugin.collectData();
    root.empty();

    this.renderHeader(root, data);
    this.renderTabs(root);

    const content = root.createDiv({ cls: "dashboard-home__tab-content" });
    if (this.activeTab === "study") {
      if (!this.studyTrackerRenderer) {
        this.studyTrackerRenderer = StudyTrackerView.createEmbedded(this.plugin);
      }
      await this.studyTrackerRenderer.renderTo(content);
      return;
    }

    if (this.activeTab === "monthly") {
      this.renderMonthlyPlan(content);
      return;
    }

    const quickRow = content.createDiv({ cls: "dashboard-home__quick-row" });
    this.renderQuickTask(quickRow);
    this.renderPomodoro(quickRow);

    const grid = content.createDiv({ cls: "dashboard-home__grid" });

    for (const panelId of normalizePanelOrder(this.plugin.settings.panelOrder).filter(
      (panelId) => panelId !== "study" && this.plugin.isPanelVisible(panelId),
    )) {
      await this.renderPanel(grid, data, panelId);
    }
  }

  private async renderPanel(
    root: HTMLElement,
    data: DashboardData,
    panelId: DashboardPanelId,
  ) {
    if (panelId === "calendar") {
      await this.renderCalendar(root, data);
      return;
    }

    if (panelId === "daily") {
      this.renderDaily(root, data);
      return;
    }

    if (panelId === "todo") {
      this.renderTasks(root, data);
      return;
    }

    if (panelId === "study") {
      this.renderStudy(root, data);
      return;
    }

    if (panelId === "database") {
      this.renderDatabase(root, data);
      return;
    }

    this.renderProjects(root, data);
  }

  private renderHeader(root: HTMLElement, data: DashboardData) {
    const header = root.createDiv({ cls: "dashboard-home__header" });
    const titleBlock = header.createDiv();
    titleBlock.createEl("p", {
      cls: "dashboard-home__eyebrow",
      text: moment().format("YYYY-MM-DD dddd"),
    });
    titleBlock.createEl("h1", { text: "My notes" });

    const actions = header.createDiv({ cls: "dashboard-home__actions" });
    const openDaily = actions.createEl("button", { text: "打开今日笔记" });
    openDaily.addEventListener("click", async () => {
      const file = await this.plugin.ensureDailyNote(data.today);
      await this.plugin.openFile(file);
    });

    const refresh = actions.createEl("button", { text: "刷新" });
    refresh.addEventListener("click", () => this.render());
  }

  private renderTabs(root: HTMLElement) {
    const tabs = root.createDiv({ cls: "dashboard-home__tabs" });
    const tabItems: Array<{ id: DashboardTabId; label: string }> = [
      { id: "home", label: "首页" },
      { id: "monthly", label: "月度计划" },
      { id: "study", label: "公考计划" },
    ];

    for (const tab of tabItems) {
      const button = tabs.createEl("button", {
        cls: tab.id === this.activeTab ? "is-active" : "",
        text: tab.label,
      });
      button.addEventListener("click", () => {
        this.activeTab = tab.id;
        void this.render();
      });
    }
  }

  private renderQuickTask(root: HTMLElement) {
    const panel = root.createDiv({ cls: "dashboard-home__quick-task" });
    const input = panel.createEl("input", {
      attr: {
        type: "text",
        placeholder: "记录 Todo，例如：2026 07 31 办手续",
      },
    });
    const button = panel.createEl("button", { text: "添加" });
    const submit = async () => {
      await this.plugin.appendTaskToToday(input.value);
      input.value = "";
      await this.render();
    };
    button.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit();
      }
    });
  }

  private renderPomodoro(root: HTMLElement) {
    const panel = root.createDiv({ cls: "dashboard-home__pomodoro" });
    panel.createEl("span", { cls: "dashboard-home__pomodoro-label", text: "专注" });
    const timer = panel.createEl("strong", {
      text: formatDuration(this.pomodoroRemaining),
    });

    const start = panel.createEl("button", {
      text: this.pomodoroRunning ? "暂停" : "开始",
    });
    start.addEventListener("click", () => {
      if (this.pomodoroRunning) {
        this.pausePomodoro();
      } else {
        this.startPomodoro(timer, start);
      }
      start.setText(this.pomodoroRunning ? "暂停" : "开始");
    });

    const reset = panel.createEl("button", { text: "重置" });
    reset.addEventListener("click", () => {
      this.pausePomodoro();
      this.pomodoroRemaining = this.plugin.settings.pomodoroMinutes * 60;
      timer.setText(formatDuration(this.pomodoroRemaining));
      start.setText("开始");
    });
  }

  private startPomodoro(timer: HTMLElement, button: HTMLButtonElement) {
    this.pomodoroRunning = true;
    window.clearInterval(this.pomodoroTimer);
    this.pomodoroTimer = window.setInterval(async () => {
      this.pomodoroRemaining -= 1;
      timer.setText(formatDuration(this.pomodoroRemaining));

      if (this.pomodoroRemaining <= 0) {
        this.pausePomodoro();
        this.pomodoroRemaining = this.plugin.settings.pomodoroMinutes * 60;
        timer.setText(formatDuration(this.pomodoroRemaining));
        button.setText("开始");
        await this.plugin.appendPomodoroLog(this.plugin.settings.pomodoroMinutes);
        new Notice("番茄钟完成。");
      }
    }, 1000);
  }

  private pausePomodoro() {
    this.pomodoroRunning = false;
    window.clearInterval(this.pomodoroTimer);
  }

  private renderDaily(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "今日笔记", "is-daily", "daily", this, (actions) => {
      const button = actions.createEl("button", {
        text: data.todayFile ? "打开" : "创建",
      });
      button.addEventListener("click", async () => {
        const file = await this.plugin.ensureDailyNote(data.today);
        await this.plugin.openFile(file);
      });
    });

    const dateLabel = moment(data.today, "YYYY-MM-DD", true).format(
      "YYYY-MM-DD",
    );

    if (!data.todayFile) {
      card.createEl("p", {
        cls: "dashboard-home__muted",
        text: "今天还没有笔记。",
      });
      return;
    }

    card.createEl("p", {
      cls: "dashboard-home__file-meta",
      text: dateLabel,
      attr: { title: data.todayFile.path },
    });

    const sectionsByHeading = new Map(
      data.dailySections.map((section) => [section.heading, section]),
    );
    const missingHeadings = DAILY_TEMPLATE_SECTIONS.filter(
      (heading) => !sectionsByHeading.has(heading),
    );

    if (missingHeadings.length > 0) {
      const completeButton = card.createEl("button", {
        cls: "dashboard-home__template-button",
        text: "补全今日模板",
      });
      completeButton.addEventListener("click", async () => {
        if (!data.todayFile) {
          return;
        }
        await this.plugin.completeDailyTemplate(data.todayFile);
        await this.render();
      });
    }

    const statusGrid = card.createDiv({ cls: "dashboard-home__daily-status" });
    for (const heading of DAILY_TEMPLATE_SECTIONS) {
      const sectionText = getSectionText(sectionsByHeading.get(heading));
      const item = statusGrid.createDiv({
        cls: [
          "dashboard-home__daily-status-item",
          sectionText ? "has-content" : "is-empty",
        ].join(" "),
      });
      item.createEl("span", { text: heading });
      item.createEl("strong", { text: sectionText ? "已记录" : "待补充" });
    }

    this.renderRecentThoughts(card, data, true);
  }

  private renderRecentThoughts(root: HTMLElement, data: DashboardData, embedded = false) {
    const container = embedded
      ? root.createDiv({ cls: "dashboard-home__embedded-thoughts" })
      : createCard(root, "近期笔记", "is-thoughts");

    if (embedded) {
      container.createEl("h3", { text: "近期笔记" });
    }

    if (data.recentThoughts.length === 0) {
      container.createEl("p", { cls: "dashboard-home__muted", text: "还没有想法。" });
      return;
    }

    for (const thought of data.recentThoughts) {
      const item = container.createDiv({ cls: "dashboard-home__thought-item" });
      item.setAttr("role", "button");
      item.setAttr("tabindex", "0");
      const openNote = () => this.plugin.openFile(thought.file);
      item.addEventListener("click", openNote);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openNote();
        }
      });
      const heading = item.createDiv({ cls: "dashboard-home__thought-heading" });
      heading.createEl("span", {
        text: moment(thought.date).format("MM-DD"),
      });
      const preview = item.createDiv({ cls: "dashboard-home__thought-preview" });
      for (const section of thought.previewSections) {
        const row = preview.createDiv({
          cls: "dashboard-home__thought-preview-row",
        });
        const label = row.createEl("span", {
          cls: "dashboard-home__thought-preview-label",
        });
        setIcon(label, "lightbulb");
        label.createEl("span", { text: section.label });
        row.createEl("span", {
          cls: "dashboard-home__thought-preview-text",
          text: section.text,
        });
      }
    }
  }

  private renderTasks(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "TodoList", "is-todo", "todo", this, (actions) => {
      const filters = actions.createDiv({ cls: "dashboard-home__category-filter" });
      const select = filters.createEl("select", {
        cls: "dashboard-home__category-select",
        attr: { "aria-label": "Todo 分类" },
      });
      for (const category of DASHBOARD_CATEGORY_FILTERS) {
        select.createEl("option", {
          text: category.label,
          attr: { value: category.id },
        });
      }
      select.value = this.todoCategory;
      select.addEventListener("click", (event) => event.stopPropagation());
      select.addEventListener("change", () => {
        this.todoCategory = select.value as DashboardCategoryFilter;
        void this.render();
      });
    });

    const tasks = data.tasks.filter((task) => {
      if (this.todoCategory === "all") {
        return true;
      }
      if (this.todoCategory === "uncategorized") {
        return !task.category;
      }
      return task.category === this.todoCategory;
    });

    if (tasks.length === 0) {
      card.createEl("p", {
        cls: "dashboard-home__muted",
        text: this.todoCategory === "all" ? "没有未完成 todo。" : "当前分类暂无未完成 todo。",
      });
      return;
    }

    for (const task of tasks) {
      const taskKey = getTaskKey(task);
      const row = card.createDiv({ cls: "dashboard-home__task" });
      row.setAttr("draggable", "true");
      row.setAttr("data-task-key", taskKey);
      row.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", taskKey);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        row.addClass("is-dragging");
      });
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        row.addClass("is-drop-target");
      });
      row.addEventListener("dragleave", () => {
        row.removeClass("is-drop-target");
      });
      row.addEventListener("drop", async (event) => {
        event.preventDefault();
        row.removeClass("is-drop-target");
        const draggedTaskKey = event.dataTransfer?.getData("text/plain");
        if (!draggedTaskKey || draggedTaskKey === taskKey) return;
        await this.plugin.moveTaskOrder(draggedTaskKey, taskKey);
      });
      row.addEventListener("dragend", () => {
        row.removeClass("is-dragging");
        card.querySelectorAll(".is-drop-target").forEach((element) => {
          element.removeClass("is-drop-target");
        });
      });
      const checkbox = row.createEl("input", {
        attr: { type: "checkbox" },
      });
      checkbox.checked = task.done;
      checkbox.addEventListener("change", async () => {
        await this.plugin.toggleTask(task);
        await this.render();
      });

      const body = row.createDiv({ cls: "dashboard-home__task-body" });
      body.createEl("span", { text: stripTaskMetadata(task.text) });
      if (task.category) {
        body.createEl("small", {
          cls: "dashboard-home__task-category",
          text: task.category,
        });
      }
      const meta = body.createEl("small", {
        text: task.source === "monthly-plan"
          ? `${task.due ?? ""} · 月度计划`
          : task.due
            ? `${task.due} · ${task.file.basename}`
            : task.file.basename,
      });
      meta.addEventListener("click", () => {
        if (task.source === "monthly-plan" && task.monthlyPlanDate) {
          this.activeTab = "monthly";
          this.monthlyPlanMonth = task.monthlyPlanDate.slice(0, 7);
          void this.render();
          return;
        }

        void this.plugin.openFile(task.file);
      });
    }
  }

  private renderStudy(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "公考打卡", "is-study", "study", this, (actions) => {
      const open = actions.createEl("button", { text: "打开" });
      open.addEventListener("click", async () => {
        await this.plugin.activateStudyTrackerView(data.today);
      });
    });

    const countByDate = getStudyCheckinCountByDate(data.studyCheckins);
    const totalCompleted = data.studyCheckins.length;
    const todayCheckins = getStudyCheckinsForDate(data.studyCheckins, data.today);
    const summary = card.createDiv({ cls: "dashboard-home__study-summary" });
    summary.createDiv({
      cls: "dashboard-home__study-total",
      text: `${totalCompleted}/${STUDY_COURSES.length} 节`,
    });
    summary.createDiv({
      cls: "dashboard-home__study-days",
      text: `${countByDate.size} 天有记录`,
    });

    const bar = card.createDiv({ cls: "dashboard-home__progress" });
    bar.createDiv({
      cls: "dashboard-home__progress-fill",
      attr: { style: `width: ${Math.round((totalCompleted / STUDY_COURSES.length) * 100)}%` },
    });

    const today = card.createDiv({ cls: "dashboard-home__study-today" });
    today.createEl("strong", { text: `${data.today} · 今日课程` });
    const todayLabels = new Set(todayCheckins.map((checkin) => checkin.courseId));
    for (const course of STUDY_COURSES) {
      const row = today.createDiv({ cls: "dashboard-home__study-row" });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = todayLabels.has(course.id);
      checkbox.addEventListener("change", async () => {
        await this.plugin.toggleStudyCheckin(course.id, data.today);
        await this.render();
      });
      row.createEl("span", { text: course.label });
    }
  }

  private renderMonthlyPlan(root: HTMLElement) {
    const panel = root.createDiv({ cls: "dashboard-monthly-plan" });
    const month = getSafeMonth(this.monthlyPlanMonth);
    const header = panel.createDiv({ cls: "dashboard-monthly-plan__header" });
    const title = header.createDiv();
    title.createEl("p", {
      cls: "dashboard-monthly-plan__eyebrow",
      text: "MONTHLY PLAN",
    });
    title.createEl("h2", { text: month.format("YYYY 年 M 月") });
    title.createEl("p", {
      cls: "dashboard-monthly-plan__hint",
      text: "在日期格子里直接写下这个月的计划。内容会自动保存到插件数据。",
    });

    const navigation = header.createDiv({ cls: "dashboard-monthly-plan__nav" });
    const previous = navigation.createEl("button", { text: "上月" });
    previous.addEventListener("click", () => {
      this.monthlyPlanMonth = month.clone().subtract(1, "month").format("YYYY-MM");
      void this.render();
    });
    const current = navigation.createEl("button", { text: "本月" });
    current.addEventListener("click", () => {
      this.monthlyPlanMonth = moment().format("YYYY-MM");
      void this.render();
    });
    const next = navigation.createEl("button", { text: "下月" });
    next.addEventListener("click", () => {
      this.monthlyPlanMonth = month.clone().add(1, "month").format("YYYY-MM");
      void this.render();
    });

    const grid = panel.createDiv({ cls: "dashboard-monthly-plan__grid" });
    for (const dayName of ["日", "一", "二", "三", "四", "五", "六"]) {
      grid.createDiv({ cls: "dashboard-monthly-plan__weekday", text: dayName });
    }

    const firstDay = month.clone().startOf("month");
    const weekCount = Math.ceil((firstDay.day() + month.daysInMonth()) / 7);
    grid.setAttr(
      "style",
      `grid-template-rows: 24px repeat(${weekCount}, minmax(96px, auto));`,
    );
    for (let index = 0; index < firstDay.day(); index += 1) {
      grid.createDiv({ cls: "dashboard-monthly-plan__empty" });
    }

    const today = moment().format("YYYY-MM-DD");
    for (let day = 1; day <= month.daysInMonth(); day += 1) {
      const date = month.clone().date(day).format("YYYY-MM-DD");
      const cell = grid.createDiv({
        cls: [
          "dashboard-monthly-plan__day",
          date === today ? "is-today" : "",
          this.plugin.settings.monthlyPlan[date] ? "has-plan" : "",
        ].filter(Boolean).join(" "),
      });
      cell.createEl("strong", { text: String(day).padStart(2, "0") });
      const category = cell.createEl("select", {
        cls: "dashboard-monthly-plan__category",
        attr: { "aria-label": `${date} 分类` },
      });
      category.createEl("option", { text: "分类", attr: { value: "" } });
      for (const item of DASHBOARD_CATEGORIES) {
        category.createEl("option", { text: item, attr: { value: item } });
      }
      category.value =
        this.plugin.settings.monthlyPlanCategory[date] ??
        inferTaskCategory(this.plugin.settings.monthlyPlan[date] ?? "") ??
        "";
      category.addEventListener("change", () => {
        void this.plugin.saveMonthlyPlanCategory(
          date,
          category.value as DashboardCategory | "",
        );
      });
      const input = cell.createEl("textarea", {
        cls: "dashboard-monthly-plan__input",
        attr: { placeholder: "写计划…", rows: "3" },
      });
      input.value = this.plugin.settings.monthlyPlan[date] ?? "";
      let saveTimer: number | undefined;
      input.addEventListener("input", () => {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          void this.plugin.saveMonthlyPlanText(date, input.value);
        }, 350);
      });
      input.addEventListener("blur", () => {
        window.clearTimeout(saveTimer);
        void this.plugin.saveMonthlyPlanText(date, input.value);
      });
    }

  }

  private async renderCalendar(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "日历", "is-calendar", "calendar", this, (actions) => {
      const monthly = actions.createEl("button", {
        cls: "dashboard-home__link-button",
        text: "月度日记",
      });
      monthly.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this.plugin.activateMonthlyDiaryView();
      });
    });
    const month = moment();
    const firstDay = month.clone().startOf("month");
    const start = firstDay.clone().subtract(firstDay.day(), "days");
    const today = moment().format("YYYY-MM-DD");

    const calendar = card.createDiv({ cls: "dashboard-home__calendar" });
    for (const dayName of ["S", "M", "T", "W", "T", "F", "S"]) {
      calendar.createDiv({ cls: "dashboard-home__calendar-weekday", text: dayName });
    }

    for (let index = 0; index < 42; index += 1) {
      const day = start.clone().add(index, "days");
      const iso = day.format("YYYY-MM-DD");
      const cell = calendar.createDiv({
        cls: [
          "dashboard-home__calendar-day",
          day.month() === month.month() ? "" : "is-muted",
          iso === today ? "is-today" : "",
          iso === this.selectedCalendarDate ? "is-selected" : "",
          data.dailyDates.has(iso) ? "has-daily" : "",
        ].join(" "),
      });
      cell.createEl("span", { text: day.format("D") });
      cell.setAttr(
        "title",
        data.dailyDates.has(iso)
          ? `单击查看 Todo，双击打开 ${iso} Daily`
          : `单击查看 Todo，双击创建 ${iso} Daily`,
      );
      cell.addEventListener("click", () => {
        window.clearTimeout(this.calendarClickTimer);
        this.calendarClickTimer = window.setTimeout(async () => {
          this.selectedCalendarDate = iso;
          await this.render();
        }, 220);
      });
      cell.addEventListener("dblclick", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.clearTimeout(this.calendarClickTimer);
        const file = await this.plugin.ensureDailyNote(iso);
        await this.plugin.openFile(file);
      });
    }

    const todoPanel = card.createDiv({ cls: "dashboard-home__calendar-todos" });
    todoPanel.createEl("h3", { text: `${this.selectedCalendarDate} · Todo` });

    const dateTodos = await this.plugin.getTodosForDate(
      this.selectedCalendarDate,
      data.allTasks,
    );
    if (dateTodos.length === 0) {
      todoPanel.createEl("p", { cls: "dashboard-home__muted", text: "暂无 todo" });
      return;
    }

    for (const task of dateTodos) {
      const row = todoPanel.createDiv({ cls: "dashboard-home__calendar-todo" });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = task.done;
      checkbox.addEventListener("change", async () => {
        await this.plugin.toggleTask(task);
        await this.render();
      });
      const body = row.createDiv({ cls: "dashboard-home__calendar-todo-body" });
      body.createEl("span", { text: stripTaskMetadata(task.text) });
      const metaText = task.due ? task.due : `来源：${task.file.basename}`;
      body.createEl("small", { text: metaText }).addEventListener("click", () => {
        this.plugin.openFile(task.file);
      });
    }
  }

  private renderProjects(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "项目", "is-projects", "projects", this);

    if (data.projects.length === 0) {
      card.createEl("p", {
        cls: "dashboard-home__muted",
        text: "还没有项目笔记。",
      });
      return;
    }

    for (const project of data.projects) {
      const row = card.createDiv({ cls: "dashboard-home__project" });
      const heading = row.createDiv({ cls: "dashboard-home__project-heading" });
      heading.createEl("button", { text: project.title }).addEventListener("click", () => {
        this.plugin.openFile(project.file);
      });
      heading.createEl("span", { text: project.status });

      const bar = row.createDiv({ cls: "dashboard-home__progress" });
      bar.createDiv({
        cls: "dashboard-home__progress-fill",
        attr: { style: `width: ${project.progress}%` },
      });
    }
  }

  private renderDatabase(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "资料库", "is-database", "database", this);
    const items = [...data.articles, ...data.books]
      .sort((a, b) => b.updated - a.updated)
      .slice(0, 10);

    if (items.length === 0) {
      card.createEl("p", {
        cls: "dashboard-home__muted",
        text: "还没有文章或读书笔记。",
      });
      return;
    }

    const table = card.createDiv({ cls: "dashboard-home__database" });
    const header = table.createDiv({ cls: "dashboard-home__database-row is-header" });
    header.createEl("span", { text: "名称" });
    header.createEl("span", { text: "类型" });
    header.createEl("span", { text: "状态" });

    for (const item of items) {
      const row = table.createDiv({ cls: "dashboard-home__database-row" });
      row.createEl("button", { text: item.title }).addEventListener("click", () => {
        this.plugin.openFile(item.file);
      });
      row.createEl("span", { text: item.kind === "book" ? "书籍" : "文章" });
      row.createEl("small", { text: item.status });
    }
  }

  attachPanelDragHandlers(
    card: HTMLElement,
    panelId: DashboardPanelId,
    handle: HTMLElement,
  ) {
    card.setAttr("data-panel-id", panelId);
    handle.setAttr("draggable", "true");

    handle.addEventListener("dragstart", (event) => {
      this.draggedPanelId = panelId;
      card.addClass("is-dragging");
      event.dataTransfer?.setData("text/plain", panelId);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
    });

    handle.addEventListener("dragend", () => {
      this.draggedPanelId = undefined;
      card.removeClass("is-dragging");
      this.containerEl.findAll(".dashboard-home__card").forEach((element) => {
        element.removeClass("is-drop-target");
      });
    });

    card.addEventListener("dragover", (event) => {
      if (!this.draggedPanelId || this.draggedPanelId === panelId) {
        return;
      }
      event.preventDefault();
      card.addClass("is-drop-target");
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });

    card.addEventListener("dragleave", () => {
      card.removeClass("is-drop-target");
    });

    card.addEventListener("drop", async (event) => {
      event.preventDefault();
      card.removeClass("is-drop-target");
      const draggedPanelId = this.draggedPanelId;
      if (!draggedPanelId || draggedPanelId === panelId) {
        return;
      }
      await this.plugin.movePanel(draggedPanelId, panelId);
    });
  }

  attachPanelResizeHandlers(
    card: HTMLElement,
    panelId: DashboardPanelId,
    handle: HTMLElement,
  ) {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const size = normalizePanelSizes(this.plugin.settings.panelSizes)[panelId];
      this.resizingPanel = {
        card,
        panelId,
        startX: event.clientX,
        startY: event.clientY,
        size,
      };
      card.addClass("is-resizing");

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!this.resizingPanel) {
          return;
        }
        const nextSize = getSizeFromDrag(
          this.resizingPanel.size,
          moveEvent.clientX - this.resizingPanel.startX,
          moveEvent.clientY - this.resizingPanel.startY,
        );
        applyPanelSizeClass(card, nextSize);
      };

      const onPointerUp = async (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        card.removeClass("is-resizing");
        const resizingPanel = this.resizingPanel;
        this.resizingPanel = undefined;
        if (!resizingPanel) {
          return;
        }
        const nextSize = getSizeFromDrag(
          resizingPanel.size,
          upEvent.clientX - resizingPanel.startX,
          upEvent.clientY - resizingPanel.startY,
        );
        await this.plugin.resizePanel(resizingPanel.panelId, nextSize);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });
  }

}

class MonthlyDiaryView extends ItemView {
  private plugin: DashboardPlugin;
  private month = moment().format("YYYY-MM");
  private filter: MonthlyDiaryFilter = "all";
  private category: DashboardCategoryFilter = "all";

  constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_MONTHLY_DIARY;
  }

  getDisplayText() {
    return "月度日记";
  }

  getIcon() {
    return "calendar-days";
  }

  async onOpen() {
    await this.render();
  }

  async setMonth(month: string) {
    this.month = getSafeMonth(month).format("YYYY-MM");
    await this.render();
  }

  async render() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.removeClass("dashboard-monthly-panel");
    root.addClass("dashboard-monthly-view");
    const panel = root.createDiv({ cls: "dashboard-monthly-panel" });

    const month = getSafeMonth(this.month);
    this.renderHeader(panel, month);

    const summaries = await this.plugin.collectDailyMonthSummaries(
      month.format("YYYY-MM"),
    );
    const summaryByDate = new Map(summaries.map((summary) => [summary.date, summary]));
    this.renderGrid(panel, month, summaryByDate);
  }

  private renderHeader(root: HTMLElement, month: moment.Moment) {
    const header = root.createDiv({ cls: "dashboard-monthly-panel__header" });
    const titleGroup = header.createDiv();
    titleGroup.createEl("p", {
      cls: "dashboard-monthly-panel__eyebrow",
      text: "月度日记",
    });
    titleGroup.createEl("h1", {
      text: month.format("YYYY 年 M 月"),
    });

    const actions = header.createDiv({ cls: "dashboard-monthly-panel__actions" });
    const filters = actions.createDiv({ cls: "dashboard-monthly-panel__filters" });
    for (const filter of MONTHLY_DIARY_FILTERS) {
      const button = filters.createEl("button", {
        cls: filter.id === this.filter ? "is-active" : "",
        text: filter.label,
      });
      button.addEventListener("click", async () => {
        this.filter = filter.id;
        await this.render();
      });
    }

    const categoryFilters = actions.createDiv({
      cls: "dashboard-monthly-panel__category-filters",
    });
    for (const category of DASHBOARD_CATEGORY_FILTERS) {
      const button = categoryFilters.createEl("button", {
        cls: category.id === this.category ? "is-active" : "",
        text: category.label,
      });
      button.addEventListener("click", async () => {
        this.category = category.id;
        await this.render();
      });
    }

    const navigation = actions.createDiv({ cls: "dashboard-monthly-panel__nav" });
    const previous = navigation.createEl("button", { text: "上月" });
    previous.addEventListener("click", () => {
      this.setMonth(month.clone().subtract(1, "month").format("YYYY-MM"));
    });

    const current = navigation.createEl("button", { text: "本月" });
    current.addEventListener("click", () => {
      this.setMonth(moment().format("YYYY-MM"));
    });

    const refresh = navigation.createEl("button", { text: "刷新" });
    refresh.addEventListener("click", () => this.render());

    const next = navigation.createEl("button", { text: "下月" });
    next.addEventListener("click", () => {
      this.setMonth(month.clone().add(1, "month").format("YYYY-MM"));
    });
  }

  private renderGrid(
    root: HTMLElement,
    month: moment.Moment,
    summaryByDate: Map<string, DailyMonthSummary>,
  ) {
    const grid = root.createDiv({ cls: "dashboard-monthly-panel__grid" });
    for (const dayName of ["日", "一", "二", "三", "四", "五", "六"]) {
      grid.createDiv({
        cls: "dashboard-monthly-panel__weekday",
        text: dayName,
      });
    }

    const firstDay = month.clone().startOf("month");
    for (let index = 0; index < firstDay.day(); index += 1) {
      grid.createDiv({ cls: "dashboard-monthly-panel__empty" });
    }

    const today = moment().format("YYYY-MM-DD");
    for (let day = 1; day <= month.daysInMonth(); day += 1) {
      const date = month.clone().date(day).format("YYYY-MM-DD");
      const summary = summaryByDate.get(date);
      const visibleTodos = summary ? this.getVisibleTodos(summary) : [];
      const visibleMonthlyPlan = Boolean(
        summary?.monthlyPlan && this.matchesCategory(summary.monthlyPlanCategory),
      );
      const hasContent = Boolean(
        summary?.file ||
          visibleTodos.length ||
          visibleMonthlyPlan ||
          summary?.inspiration ||
          summary?.relatedNotes ||
          summary?.readingNotes ||
          summary?.mood ||
          summary?.efficiency ||
          summary?.review,
      );
      const cell = grid.createDiv({
        cls: [
          "dashboard-monthly-panel__day",
          hasContent ? "has-content" : "",
          date === today ? "is-today" : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
      cell.addEventListener("click", async () => {
        const file = await this.plugin.ensureDailyNote(date);
        await this.plugin.openFile(file);
      });

      const cellHeader = cell.createDiv({ cls: "dashboard-monthly-panel__day-header" });
      cellHeader.createEl("strong", { text: String(day).padStart(2, "0") });
      if (summary?.mood) {
        cellHeader.createEl("span", { text: summary.mood });
      }

      this.renderDayContent(cell, summary);
    }
  }

  private renderDayContent(root: HTMLElement, summary: DailyMonthSummary | undefined) {
    if (!summary) {
      return;
    }

    if (this.filter === "todo") {
      this.renderTodoLines(root, summary, false);
      return;
    }

    if (this.filter === "inspiration") {
      renderMonthlyTextBlock(root, "灵感", summary.inspiration, 120);
      return;
    }

    if (this.filter === "notes") {
      renderMonthlyTextBlock(root, "关联", summary.relatedNotes, 90);
      renderMonthlyTextBlock(root, "读书", summary.readingNotes, 90);
      return;
    }

    this.renderTodoLines(root, summary, true);
    renderMonthlyTextBlock(root, "灵感", summary.inspiration, 76);
    renderMonthlyTextBlock(root, "笔记", [summary.relatedNotes, summary.readingNotes].filter(Boolean).join("\n"), 70);

    const meta = [summary.efficiency, summary.review].filter(Boolean).join(" · ");
    if (meta) {
      root.createDiv({
        cls: "dashboard-monthly-panel__meta",
        text: truncateText(meta, 64),
      });
    }
  }

  private renderTodoLines(
    root: HTMLElement,
    summary: DailyMonthSummary,
    compact: boolean,
  ) {
    const todos = this.getVisibleTodos(summary);
    const hasMonthlyPlan = Boolean(
      summary.monthlyPlan && this.matchesCategory(summary.monthlyPlanCategory),
    );
    if (todos.length === 0 && !hasMonthlyPlan) {
      return;
    }

    const openTasks = todos.filter((task) => !task.done);
    const totalCount = todos.length + (hasMonthlyPlan ? 1 : 0);
    const openCount = openTasks.length + (
      hasMonthlyPlan && !summary.monthlyPlanDone ? 1 : 0
    );
    const block = root.createDiv({ cls: "dashboard-monthly-panel__block" });
    block.createEl("span", {
      cls: "dashboard-monthly-panel__block-label",
      text: compact ? `Todo ${openCount}/${totalCount}` : "Todo",
    });

    const visibleItems = todos
      .map((task) => ({
        done: task.done,
        text: stripTaskMetadata(task.text),
      }))
      .slice(0, compact ? 1 : 3);

    for (const item of visibleItems) {
      renderMonthlyTodoLine(block, item.text, item.done, compact);
    }

    if (hasMonthlyPlan && (!compact || visibleItems.length === 0)) {
      renderMonthlyTodoLine(
        block,
        summary.monthlyPlan,
        summary.monthlyPlanDone,
        compact,
      );
    }
  }

  private getVisibleTodos(summary: DailyMonthSummary): DashboardTask[] {
    return summary.todos.filter((task) => this.matchesCategory(task.category));
  }

  private matchesCategory(category: DashboardCategory | undefined): boolean {
    if (this.category === "all") {
      return true;
    }
    if (this.category === "uncategorized") {
      return !category;
    }
    return category === this.category;
  }
}

class StudyTrackerView extends ItemView {
  private plugin: DashboardPlugin;
  private renderTarget?: HTMLElement;
  private mode: StudyTrackerMode = "month";
  private cursor = moment().startOf("month");
  private selectedDate = moment().format("YYYY-MM-DD");

  constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  static createEmbedded(plugin: DashboardPlugin): StudyTrackerView {
    // An embedded tracker is a renderer only. Constructing ItemView with the
    // dashboard leaf would register a second view container in Obsidian.
    const view = Object.create(this.prototype) as StudyTrackerView;
    view.plugin = plugin;
    view.mode = "month";
    view.cursor = moment().startOf("month");
    view.selectedDate = moment().format("YYYY-MM-DD");
    return view;
  }

  getViewType() {
    return VIEW_TYPE_STUDY_TRACKER;
  }

  getDisplayText() {
    return "公考学习打卡";
  }

  getIcon() {
    return "calendar-check-2";
  }

  async onOpen() {
    await this.render();
  }

  async setDate(date: string, mode: StudyTrackerMode = this.mode) {
    const parsed = moment(date, "YYYY-MM-DD", true);
    if (!parsed.isValid()) {
      return;
    }

    this.mode = mode;
    this.selectedDate = parsed.format("YYYY-MM-DD");
    this.cursor = mode === "year"
      ? parsed.clone().startOf("year")
      : parsed.clone().startOf("month");
    await this.render();
  }

  async render() {
    await this.renderTo(this.renderTarget ?? (this.containerEl.children[1] as HTMLElement));
  }

  async renderTo(root: HTMLElement) {
    this.renderTarget = root;
    root.empty();
    root.addClass("dashboard-study-view");
    const panel = root.createDiv({ cls: "dashboard-study-panel" });
    const checkins = normalizeStudyCheckins(this.plugin.settings.studyCheckins);
    const checkinCountByDate = getStudyCheckinCountByDate(checkins);

    this.renderHeader(panel, checkins, checkinCountByDate);
    if (this.mode === "year") {
      this.renderYear(panel, checkinCountByDate);
    } else {
      this.renderMonth(panel, checkinCountByDate);
    }
    this.renderSelectedDay(panel, checkins);
  }

  private renderHeader(
    root: HTMLElement,
    checkins: StudyCheckin[],
    checkinCountByDate: Map<string, number>,
  ) {
    const header = root.createDiv({ cls: "dashboard-study-panel__header" });
    const titleGroup = header.createDiv();
    titleGroup.createEl("p", {
      cls: "dashboard-study-panel__eyebrow",
      text: "STUDY TRACKER",
    });
    titleGroup.createEl("h1", {
      text: this.mode === "year"
        ? this.cursor.format("YYYY 年")
        : this.cursor.format("YYYY 年 M 月"),
    });
    titleGroup.createEl("p", {
      cls: "dashboard-study-panel__summary",
      text: `${checkins.length}/${STUDY_COURSES.length} 节 · ${checkinCountByDate.size} 天有记录`,
    });

    const actions = header.createDiv({ cls: "dashboard-study-panel__actions" });
    const modes = actions.createDiv({ cls: "dashboard-study-panel__modes" });
    for (const mode of ["month", "year"] as StudyTrackerMode[]) {
      const button = modes.createEl("button", {
        cls: mode === this.mode ? "is-active" : "",
        text: mode === "month" ? "月" : "年",
      });
      button.addEventListener("click", () => {
        this.mode = mode;
        this.cursor = mode === "year"
          ? moment(this.selectedDate).startOf("year")
          : moment(this.selectedDate).startOf("month");
        void this.render();
      });
    }

    const navigation = actions.createDiv({ cls: "dashboard-study-panel__nav" });
    const previous = navigation.createEl("button", {
      text: this.mode === "year" ? "上年" : "上月",
    });
    previous.addEventListener("click", () => {
      this.cursor = this.cursor.clone().subtract(1, this.mode);
      void this.render();
    });

    const current = navigation.createEl("button", { text: "今天" });
    current.addEventListener("click", () => {
      const today = moment();
      this.selectedDate = today.format("YYYY-MM-DD");
      this.cursor = this.mode === "year" ? today.clone().startOf("year") : today.clone().startOf("month");
      void this.render();
    });

    const next = navigation.createEl("button", {
      text: this.mode === "year" ? "下年" : "下月",
    });
    next.addEventListener("click", () => {
      this.cursor = this.cursor.clone().add(1, this.mode);
      void this.render();
    });
  }

  private renderMonth(root: HTMLElement, checkinCountByDate: Map<string, number>) {
    const calendar = root.createDiv({ cls: "dashboard-study-calendar" });
    this.renderWeekdays(calendar);

    const firstDay = this.cursor.clone().startOf("month");
    const weekCount = Math.ceil((firstDay.day() + this.cursor.daysInMonth()) / 7);
    calendar.setAttr(
      "style",
      `grid-template-rows: 22px repeat(${weekCount}, minmax(88px, auto));`,
    );
    for (let index = 0; index < firstDay.day(); index += 1) {
      calendar.createDiv({ cls: "dashboard-study-calendar__empty" });
    }

    for (let day = 1; day <= this.cursor.daysInMonth(); day += 1) {
      const date = this.cursor.clone().date(day).format("YYYY-MM-DD");
      this.renderDayCell(calendar, date, String(day), checkinCountByDate.get(date) ?? 0);
    }
  }

  private renderYear(root: HTMLElement, checkinCountByDate: Map<string, number>) {
    const yearGrid = root.createDiv({ cls: "dashboard-study-year" });
    for (let month = 0; month < 12; month += 1) {
      const monthMoment = this.cursor.clone().month(month).startOf("month");
      const monthPanel = yearGrid.createDiv({ cls: "dashboard-study-year__month" });
      const monthHeader = monthPanel.createDiv({ cls: "dashboard-study-year__month-header" });
      monthHeader.createEl("strong", { text: monthMoment.format("M 月") });
      const monthCount = Array.from(checkinCountByDate.entries())
        .filter(([date]) => date.startsWith(monthMoment.format("YYYY-MM")))
        .reduce((total, [, count]) => total + count, 0);
      monthHeader.createEl("span", { text: `${monthCount} 节` });

      const calendar = monthPanel.createDiv({ cls: "dashboard-study-calendar is-mini" });
      this.renderWeekdays(calendar, true);
      for (let index = 0; index < monthMoment.day(); index += 1) {
        calendar.createDiv({ cls: "dashboard-study-calendar__empty" });
      }
      for (let day = 1; day <= monthMoment.daysInMonth(); day += 1) {
        const date = monthMoment.clone().date(day).format("YYYY-MM-DD");
        this.renderDayCell(calendar, date, String(day), checkinCountByDate.get(date) ?? 0, true);
      }
    }
  }

  private renderWeekdays(root: HTMLElement, compact = false) {
    for (const dayName of ["日", "一", "二", "三", "四", "五", "六"]) {
      root.createDiv({
        cls: "dashboard-study-calendar__weekday",
        text: compact ? dayName.slice(0, 1) : dayName,
      });
    }
  }

  private renderDayCell(
    root: HTMLElement,
    date: string,
    label: string,
    count: number,
    compact = false,
  ) {
    const cell = root.createDiv({
      cls: [
        "dashboard-study-calendar__day",
        compact ? "is-mini" : "",
        count > 0 ? "has-checkins" : "",
        count > 2 ? "is-full" : "",
        date === this.selectedDate ? "is-selected" : "",
        date === moment().format("YYYY-MM-DD") ? "is-today" : "",
      ].filter(Boolean).join(" "),
    });
    cell.createEl("strong", { text: label });
    if (count > 0) {
      cell.createEl("span", { text: compact ? String(count) : `${count} 节` });
      if (!compact) {
        const labels = getStudyCheckinsForDate(this.plugin.settings.studyCheckins, date)
          .map((checkin) => getStudyCourse(checkin.courseId)?.label)
          .filter((label): label is string => Boolean(label));
        cell.createDiv({
          cls: "dashboard-study-calendar__labels",
          text: labels.slice(0, 3).join(" · ") + (labels.length > 3 ? " …" : ""),
        });
      }
      cell.setAttr("title", `${date} · ${count} 节：${getStudyCheckinsForDate(this.plugin.settings.studyCheckins, date).map((checkin) => getStudyCourse(checkin.courseId)?.label).filter(Boolean).join("、")}`);
    } else {
      cell.setAttr("title", `${date} · 未打卡`);
    }
    cell.addEventListener("click", () => {
      this.selectedDate = date;
      if (compact) {
        this.mode = "month";
        this.cursor = moment(date, "YYYY-MM-DD", true).startOf("month");
      }
      void this.render();
    });
  }

  private renderSelectedDay(root: HTMLElement, checkins: StudyCheckin[]) {
    const selected = root.createDiv({ cls: "dashboard-study-selected" });
    const selectedHeader = selected.createDiv({ cls: "dashboard-study-selected__header" });
    const selectedCheckins = getStudyCheckinsForDate(checkins, this.selectedDate);
    selectedHeader.createEl("h2", { text: `${this.selectedDate} · 课程打卡` });
    selectedHeader.createEl("span", {
      text: `${selectedCheckins.length}/${STUDY_COURSES.length}`,
    });

    const courseGrid = selected.createDiv({ cls: "dashboard-study-courses" });
    for (const module of STUDY_MODULES) {
      const moduleCourses = STUDY_COURSES.filter((course) => course.module === module);
      const group = courseGrid.createDiv({ cls: "dashboard-study-courses__group" });
      group.createEl("h3", { text: module });
      for (const course of moduleCourses) {
        const row = group.createDiv({ cls: "dashboard-study-course" });
        const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
        checkbox.checked = this.plugin.isStudyCourseCheckedIn(course.id, this.selectedDate);
        checkbox.addEventListener("change", async () => {
          await this.plugin.toggleStudyCheckin(course.id, this.selectedDate);
          await this.render();
        });
        row.createEl("span", { text: course.label });
      }
    }
  }
}

class DashboardSettingTab extends PluginSettingTab {
  plugin: DashboardPlugin;

  constructor(app: App, plugin: DashboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "首页设置" });

    new Setting(containerEl)
      .setName("Daily 文件夹")
      .setDesc("Daily 笔记所在的文件夹，YYYY、MM 等日期片段会根据笔记日期展开。")
      .addText((text) =>
        text
          .setPlaceholder("daily/MM")
          .setValue(this.plugin.settings.dailyFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyFolder = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Daily 日期格式")
      .setDesc("用于生成 Daily 文件名的日期格式。")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.plugin.settings.dailyDateFormat)
          .onChange(async (value) => {
            this.plugin.settings.dailyDateFormat = value || DEFAULT_SETTINGS.dailyDateFormat;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("项目文件夹")
      .setDesc("这个文件夹中的笔记会被识别为项目。")
      .addText((text) =>
        text
          .setPlaceholder("Projects")
          .setValue(this.plugin.settings.projectFolder)
          .onChange(async (value) => {
            this.plugin.settings.projectFolder = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("文章文件夹")
      .setDesc("这个文件夹中的笔记会被识别为收藏文章。")
      .addText((text) =>
        text
          .setPlaceholder("Articles")
          .setValue(this.plugin.settings.articleFolder)
          .onChange(async (value) => {
            this.plugin.settings.articleFolder = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("书籍文件夹")
      .setDesc("这个文件夹中的笔记会被识别为读书笔记。")
      .addText((text) =>
        text
          .setPlaceholder("Books")
          .setValue(this.plugin.settings.bookFolder)
          .onChange(async (value) => {
            this.plugin.settings.bookFolder = value;
          await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("显示资料库面板")
      .setDesc("在首页显示可选的资料库表格。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.isPanelVisible("database"))
          .onChange(async (value) => {
            await this.plugin.setPanelVisibility("database", value);
          }),
      );

    new Setting(containerEl)
      .setName("显示项目面板")
      .setDesc("在首页显示可选的项目面板。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.isPanelVisible("projects"))
          .onChange(async (value) => {
            await this.plugin.setPanelVisibility("projects", value);
          }),
      );

    new Setting(containerEl)
      .setName("默认 Todo 标题")
      .setDesc("快速记录的 Todo 会追加到 Daily 笔记的这个标题下。")
      .addText((text) =>
        text
          .setPlaceholder("今日todo")
          .setValue(this.plugin.settings.defaultTaskSection)
          .onChange(async (value) => {
            this.plugin.settings.defaultTaskSection =
              value || DEFAULT_SETTINGS.defaultTaskSection;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("番茄钟时长")
      .setDesc("一次专注的时长。")
      .addSlider((slider) =>
        slider
          .setLimits(5, 60, 5)
          .setValue(this.plugin.settings.pomodoroMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.pomodoroMinutes = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("启动时打开首页")
      .setDesc("Obsidian 布局准备完成后自动打开首页。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openOnStartup).onChange(async (value) => {
          this.plugin.settings.openOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );
  }

}

function createCard(
  root: HTMLElement,
  title: string,
  variant?: string,
  panelId?: DashboardPanelId,
  view?: DashboardView,
  renderActions?: (root: HTMLElement) => void,
): HTMLElement {
  const card = root.createDiv({
    cls: [
      "dashboard-home__card",
      variant ? `dashboard-home__card--${variant}` : "",
      panelId && view ? getPanelSizeClass(view.getPanelSize(panelId)) : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
  const header = card.createDiv({ cls: "dashboard-home__card-header" });
  const titleGroup = header.createDiv({ cls: "dashboard-home__card-title-group" });
  titleGroup.createEl("h2", { text: title });
  if (panelId && view) {
    view.attachPanelDragHandlers(card, panelId, header);
  }
  const actions = header.createDiv({ cls: "dashboard-home__card-header-actions" });
  if (renderActions) {
    renderActions(actions);
  }
  if (panelId && view) {
    const resizeHandle = card.createDiv({
      cls: "dashboard-home__resize-handle",
    });
    view.attachPanelResizeHandlers(card, panelId, resizeHandle);
  }
  return card;
}

function normalizePanelOrder(panelOrder: unknown): DashboardPanelId[] {
  const validPanelIds = new Set<DashboardPanelId>(DEFAULT_PANEL_ORDER);
  const normalized = Array.isArray(panelOrder)
    ? panelOrder.filter((panelId): panelId is DashboardPanelId =>
        validPanelIds.has(panelId as DashboardPanelId),
      )
    : [];

  for (const panelId of DEFAULT_PANEL_ORDER) {
    if (!normalized.includes(panelId)) {
      const insertBefore = DEFAULT_PANEL_ORDER.slice(
        DEFAULT_PANEL_ORDER.indexOf(panelId) + 1,
      ).find((nextPanelId) => normalized.includes(nextPanelId));
      const insertIndex = insertBefore ? normalized.indexOf(insertBefore) : -1;
      if (insertIndex === -1) {
        normalized.push(panelId);
      } else {
        normalized.splice(insertIndex, 0, panelId);
      }
    }
  }

  return normalized;
}

function normalizeTaskOrder(taskOrder: unknown): string[] {
  if (!Array.isArray(taskOrder)) {
    return [];
  }

  return taskOrder.filter(
    (key): key is string => typeof key === "string" && key.length > 0,
  );
}

function normalizePanelSizes(
  panelSizes: unknown,
): Record<DashboardPanelId, DashboardPanelSize> {
  const validSizes = new Set<DashboardPanelSize>([
    "compact",
    "normal",
    "wide",
    "tall",
    "large",
  ]);
  const source =
    panelSizes && typeof panelSizes === "object"
      ? (panelSizes as Partial<Record<DashboardPanelId, DashboardPanelSize>>)
      : {};
  const normalized = { ...DEFAULT_PANEL_SIZES };

  for (const panelId of DEFAULT_PANEL_ORDER) {
    const size = source[panelId];
    if (size && validSizes.has(size)) {
      normalized[panelId] = size;
    }
  }

  return normalized;
}

function normalizePanelVisibility(
  visiblePanels: unknown,
): Record<DashboardPanelId, boolean> {
  const source =
    visiblePanels && typeof visiblePanels === "object"
      ? (visiblePanels as Partial<Record<DashboardPanelId, boolean>>)
      : {};
  const normalized = { ...DEFAULT_VISIBLE_PANELS };

  for (const panelId of DEFAULT_PANEL_ORDER) {
    if (typeof source[panelId] === "boolean") {
      normalized[panelId] = source[panelId] as boolean;
    }
  }

  return normalized;
}

function normalizeMonthlyPlan(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [date, text] of Object.entries(value)) {
    if (moment(date, "YYYY-MM-DD", true).isValid() && typeof text === "string" && text.trim()) {
      normalized[date] = text;
    }
  }
  return normalized;
}

function normalizeMonthlyPlanDone(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Record<string, boolean> = {};
  for (const [date, done] of Object.entries(value)) {
    if (moment(date, "YYYY-MM-DD", true).isValid() && typeof done === "boolean") {
      normalized[date] = done;
    }
  }
  return normalized;
}

function normalizeMonthlyPlanCategory(
  value: unknown,
): Record<string, DashboardCategory> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const categories = new Set<DashboardCategory>(["生活", "工作", "公考", "学习", "其他"]);
  const normalized: Record<string, DashboardCategory> = {};
  for (const [date, category] of Object.entries(value)) {
    if (
      moment(date, "YYYY-MM-DD", true).isValid() &&
      typeof category === "string" &&
      categories.has(category as DashboardCategory)
    ) {
      normalized[date] = category as DashboardCategory;
    }
  }
  return normalized;
}

function getSizeFromDrag(
  currentSize: DashboardPanelSize,
  deltaX: number,
  deltaY: number,
): DashboardPanelSize {
  if (Math.abs(deltaX) < 48 && Math.abs(deltaY) < 48) {
    return currentSize;
  }

  if (deltaX > 80 && deltaY > 64) {
    return "large";
  }

  if (deltaX > 80) {
    return "wide";
  }

  if (deltaY > 64) {
    return "tall";
  }

  if (deltaX < -64 || deltaY < -64) {
    return "compact";
  }

  return "normal";
}

function applyPanelSizeClass(card: HTMLElement, size: DashboardPanelSize) {
  for (const panelSize of ["compact", "normal", "wide", "tall", "large"]) {
    card.removeClass(`dashboard-home__card--size-${panelSize}`);
  }
  card.addClass(getPanelSizeClass(size));
}

function getPanelSizeClass(size: DashboardPanelSize): string {
  return `dashboard-home__card--size-${size}`;
}

function categorizeTasks(tasks: DashboardTask[]): DashboardTask[] {
  return tasks.map((task) => ({
    ...task,
    category:
      getTaskCategory(task.tags) ?? inferTaskCategory(task.text, task.file.path),
  }));
}

function getDailyText(sections: DailySection[], headings: string[]): string {
  return getSectionText(
    sections.find((section) => headings.includes(section.heading)),
  );
}

function getRecentInspirationPreview(
  sections: DailySection[],
): Array<{ label: string; text: string }> {
  const previews: Array<{ label: string; text: string }> = [];
  let remaining = 150;

  for (const section of sections) {
    const text = getSectionText(section).replace(/\s+/g, " ").trim();
    if (!text || remaining <= 0) {
      continue;
    }

    const heading = section.heading.trim();
    if (!["今日灵感", "灵感", "想法/思考"].includes(heading)) {
      continue;
    }

    const snippet = truncateText(text, remaining);
    previews.push({ label: "想法", text: snippet });
    remaining -= snippet.length + 2;
  }

  return previews;
}

function getDailyValue(
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

function renderMonthlyTextBlock(
  root: HTMLElement,
  label: string,
  value: string,
  limit: number,
) {
  const text = value.trim();
  if (!text) {
    return;
  }

  const block = root.createDiv({ cls: "dashboard-monthly-panel__block" });
  block.createEl("span", {
    cls: "dashboard-monthly-panel__block-label",
    text: label,
  });
  block.createDiv({
    cls: "dashboard-monthly-panel__snippet",
    text: truncateText(text, limit),
  });
}

function renderMonthlyTodoLine(
  root: HTMLElement,
  text: string,
  done: boolean,
  compact: boolean,
) {
  const line = root.createDiv({
    cls: [
      "dashboard-monthly-panel__line",
      done ? "is-done" : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
  line.createEl("span", { text: done ? "[x]" : "[ ]" });
  line.createEl("strong", {
    text: truncateText(text, compact ? 52 : 70),
  });
}

function getSafeMonth(month: string): moment.Moment {
  const parsed = moment(month, "YYYY-MM", true);
  return parsed.isValid() ? parsed : moment();
}

function parseDashboardDate(
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

function buildQuickTaskLine(text: string): string | undefined {
  const cleanText = text.trim().replace(/\s+/g, " ");
  if (!cleanText) {
    return undefined;
  }

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

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}
