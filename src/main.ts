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
} from "obsidian";
import {
  DAILY_TEMPLATE_SECTIONS,
  DEFAULT_PANEL_ORDER,
  DEFAULT_PANEL_SIZES,
  DEFAULT_SETTINGS,
  VIEW_TYPE_DASHBOARD,
  VIEW_TYPE_MONTHLY_DIARY,
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
  getTasksForDate,
  stripTaskMetadata,
} from "./tasks";
import type {
  DashboardData,
  DailySection,
  DailyMonthSummary,
  DashboardPanelId,
  DashboardPanelSize,
  DashboardSettings,
  DashboardTask,
  LibraryItem,
  MonthlyDiaryFilter,
  ProjectSummary,
  RecentThought,
} from "./types";

const MONTHLY_DIARY_FILTERS: Array<{ id: MonthlyDiaryFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "todo", label: "Todo" },
  { id: "inspiration", label: "灵感" },
  { id: "notes", label: "笔记" },
];

export default class DashboardPlugin extends Plugin {
  settings: DashboardSettings = DEFAULT_SETTINGS;
  private refreshTimer?: number;

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

    this.addRibbonIcon("layout-dashboard", "Open dashboard", () => {
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
      if (this.settings.openOnStartup) {
        this.activateView();
      }
    });
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MONTHLY_DIARY);
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    this.settings.panelOrder = normalizePanelOrder(this.settings.panelOrder);
    this.settings.panelSizes = normalizePanelSizes(this.settings.panelSizes);
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

  async resizePanel(panelId: DashboardPanelId, size: DashboardPanelSize) {
    this.settings.panelSizes = {
      ...normalizePanelSizes(this.settings.panelSizes),
      [panelId]: size,
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

    this.app.workspace.revealLeaf(leaf);
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

  queueRefresh() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshDashboardViews();
      this.refreshMonthlyDiaryViews();
    }, 400);
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

      tasks.push(...extractTasks(content, file));

      const dailyDate = this.getDateFromDailyFile(file);
      if (dailyDate) {
        dailyDates.add(dailyDate);
        const dailySectionsForFile = extractDailySections(content);
        const dailyTodos = extractLooseTasksFromHeading(
          content,
          file,
          this.settings.defaultTaskSection,
        ).filter((task) => !task.done);
        tasks.push(...dailyTodos);
        dailyTodosByDate.set(dailyDate, dailyTodos);

        const thoughtText = getSectionText(
          dailySectionsForFile.find((section) =>
            ["今日灵感", "灵感", "想法/思考"].includes(section.heading),
          ),
        );
        if (thoughtText) {
          recentThoughts.push({
            date: dailyDate,
            text: thoughtText,
            file,
            updated: file.stat.mtime,
          });
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

    const allOpenTasks = dedupeTasksByText(tasks.filter((task) => !task.done))
      .sort(compareTasksForDashboard);

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
      tasks: allOpenTasks.slice(0, 30),
      allTasks: allOpenTasks,
      dailyDates,
      calendarCounts,
      projects: projects.sort((a, b) => b.updated - a.updated).slice(0, 10),
      articles: articles.sort((a, b) => b.updated - a.updated).slice(0, 8),
      books: books.sort((a, b) => b.updated - a.updated).slice(0, 8),
      recentThoughts: recentThoughts
        .sort((a, b) => b.date.localeCompare(a.date) || b.updated - a.updated)
        .slice(0, 6),
    };
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
        });
        continue;
      }

      const content = await this.app.vault.cachedRead(file);
      const sections = extractDailySections(content);
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

      summaries.push({
        date,
        file,
        todos: extractLooseTasksFromHeading(content, file, this.settings.defaultTaskSection),
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
    return extractLooseTasksFromHeading(content, file, this.settings.defaultTaskSection);
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
    new Notice("Task added to today's daily note.");
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
      new Notice("Daily template is already complete.");
      return;
    }

    const suffix = content.endsWith("\n") ? "" : "\n";
    const nextContent = [
      `${content}${suffix}`,
      ...missingHeadings.flatMap((heading) => [`## ${heading}`, ""]),
    ].join("\n");

    await this.app.vault.modify(file, nextContent);
    new Notice("Daily template completed.");
  }

  async toggleTask(task: DashboardTask) {
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

  constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
    super(leaf);
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
  }

  getPanelSize(panelId: DashboardPanelId): DashboardPanelSize {
    return normalizePanelSizes(this.plugin.settings.panelSizes)[panelId];
  }

  async render() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("dashboard-home");
    root.createDiv({ cls: "dashboard-home__loading", text: "Loading dashboard..." });

    const data = await this.plugin.collectData();
    root.empty();

    this.renderHeader(root, data);

    const quickRow = root.createDiv({ cls: "dashboard-home__quick-row" });
    this.renderQuickTask(quickRow);
    this.renderPomodoro(quickRow);

    const grid = root.createDiv({ cls: "dashboard-home__grid" });

    for (const panelId of normalizePanelOrder(this.plugin.settings.panelOrder)) {
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
      text: moment().format("dddd, MMMM D"),
    });
    titleBlock.createEl("h1", { text: "My notes" });

    const actions = header.createDiv({ cls: "dashboard-home__actions" });
    const openDaily = actions.createEl("button", { text: "Open daily" });
    openDaily.addEventListener("click", async () => {
      const file = await this.plugin.ensureDailyNote(data.today);
      await this.plugin.openFile(file);
    });

    const refresh = actions.createEl("button", { text: "Refresh" });
    refresh.addEventListener("click", () => this.render());
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
    panel.createEl("span", { cls: "dashboard-home__pomodoro-label", text: "Focus" });
    const timer = panel.createEl("strong", {
      text: formatDuration(this.pomodoroRemaining),
    });

    const start = panel.createEl("button", {
      text: this.pomodoroRunning ? "Pause" : "Start",
    });
    start.addEventListener("click", () => {
      if (this.pomodoroRunning) {
        this.pausePomodoro();
      } else {
        this.startPomodoro(timer, start);
      }
      start.setText(this.pomodoroRunning ? "Pause" : "Start");
    });

    const reset = panel.createEl("button", { text: "Reset" });
    reset.addEventListener("click", () => {
      this.pausePomodoro();
      this.pomodoroRemaining = this.plugin.settings.pomodoroMinutes * 60;
      timer.setText(formatDuration(this.pomodoroRemaining));
      start.setText("Start");
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
        button.setText("Start");
        await this.plugin.appendPomodoroLog(this.plugin.settings.pomodoroMinutes);
        new Notice("Pomodoro complete.");
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

    const dateLabel = moment(data.today, this.plugin.settings.dailyDateFormat).format(
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
      text: `${dateLabel} · ${data.todayFile.path}`,
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
      : createCard(root, "近期灵感", "is-thoughts");

    if (embedded) {
      container.createEl("h3", { text: "近期灵感" });
    }

    if (data.recentThoughts.length === 0) {
      container.createEl("p", { cls: "dashboard-home__muted", text: "还没有想法/思考记录。" });
      return;
    }

    for (const thought of data.recentThoughts.slice(0, embedded ? 3 : 4)) {
      const item = container.createDiv({ cls: "dashboard-home__thought-item" });
      item.addEventListener("click", () => this.plugin.openFile(thought.file));
      const heading = item.createDiv({ cls: "dashboard-home__thought-heading" });
      heading.createEl("span", {
        text: moment(thought.date).format("MM-DD"),
      });
      item.createEl("p", { text: truncateText(thought.text, 150) });
    }
  }

  private renderTasks(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "TodoList", "is-todo", "todo", this);

    if (data.tasks.length === 0) {
      card.createEl("p", {
        cls: "dashboard-home__muted",
        text: "没有未完成 todo。",
      });
      return;
    }

    for (const task of data.tasks) {
      const row = card.createDiv({ cls: "dashboard-home__task" });
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
      const meta = body.createEl("small", {
        text: task.due ? `${task.due} · ${task.file.basename}` : task.file.basename,
      });
      meta.addEventListener("click", () => this.plugin.openFile(task.file));
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
    const start = month.clone().startOf("month").startOf("week");
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
        ].join(" "),
      });
      cell.createEl("span", { text: day.format("D") });
      cell.addEventListener("click", async () => {
        this.selectedCalendarDate = iso;
        await this.render();
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
        text: "No project notes found.",
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
    const card = createCard(root, "数据库", "is-database", "database", this);
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
      text: "Monthly diary",
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
      const hasContent = Boolean(
        summary?.file ||
          summary?.todos.length ||
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
    if (summary.todos.length === 0) {
      return;
    }

    const openTasks = summary.todos.filter((task) => !task.done);
    const block = root.createDiv({ cls: "dashboard-monthly-panel__block" });
    block.createEl("span", {
      cls: "dashboard-monthly-panel__block-label",
      text: compact ? `Todo ${openTasks.length}/${summary.todos.length}` : "Todo",
    });

    const visibleItems = summary.todos
      .map((task) => ({
        done: task.done,
        text: stripTaskMetadata(task.text),
      }))
      .slice(0, compact ? 1 : 3);

    for (const item of visibleItems) {
      renderMonthlyTodoLine(block, item.text, item.done, compact);
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

    containerEl.createEl("h2", { text: "Dashboard Home" });

    new Setting(containerEl)
      .setName("Daily folder")
      .setDesc("Folder used for daily notes. Date-only path segments like YYYY or MM are expanded from the note date.")
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
      .setName("Daily date format")
      .setDesc("Moment.js format used to name daily notes.")
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
      .setName("Project folder")
      .setDesc("Notes in this folder are shown as projects.")
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
      .setName("Article folder")
      .setDesc("Notes in this folder are shown as saved articles.")
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
      .setName("Book folder")
      .setDesc("Notes in this folder are shown as reading notes.")
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
      .setName("Default task section")
      .setDesc("Quick-captured tasks are appended under this heading in the daily note.")
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
      .setName("Pomodoro minutes")
      .setDesc("Length of one focus session.")
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
      .setName("Open on startup")
      .setDesc("Open the dashboard when Obsidian layout is ready.")
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

function getDailyText(sections: DailySection[], headings: string[]): string {
  return getSectionText(
    sections.find((section) => headings.includes(section.heading)),
  );
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
