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

const VIEW_TYPE_DASHBOARD = "dashboard-home-view";
const DAILY_TEMPLATE_SECTIONS = [
  "今日todo",
  "今日关联笔记",
  "想法/思考",
  "读书笔记",
];

interface DashboardSettings {
  dailyFolder: string;
  dailyDateFormat: string;
  projectFolder: string;
  articleFolder: string;
  bookFolder: string;
  defaultTaskSection: string;
  pomodoroMinutes: number;
  openOnStartup: boolean;
}

interface DashboardTask {
  text: string;
  done: boolean;
  due?: string;
  file: TFile;
  line: number;
  tags: string[];
}

interface DailySection {
  heading: string;
  preview: string;
  lines: string[];
}

interface ProjectSummary {
  title: string;
  file: TFile;
  status: string;
  progress: number;
  updated: number;
}

interface LibraryItem {
  title: string;
  file: TFile;
  kind: "article" | "book";
  status: string;
  updated: number;
}

interface DashboardData {
  today: string;
  todayFile?: TFile;
  dailySections: DailySection[];
  tasks: DashboardTask[];
  allTasks: DashboardTask[];
  calendarCounts: Map<string, number>;
  projects: ProjectSummary[];
  articles: LibraryItem[];
  books: LibraryItem[];
}

const DEFAULT_SETTINGS: DashboardSettings = {
  dailyFolder: "Daily",
  dailyDateFormat: "YYYY-MM-DD",
  projectFolder: "Projects",
  articleFolder: "Articles",
  bookFolder: "Books",
  defaultTaskSection: "今日todo",
  pomodoroMinutes: 25,
  openOnStartup: false,
};

export default class DashboardPlugin extends Plugin {
  settings: DashboardSettings = DEFAULT_SETTINGS;
  private refreshTimer?: number;

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_DASHBOARD,
      (leaf) => new DashboardView(leaf, this),
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
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshDashboardViews();
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

  refreshDashboardViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
      const view = leaf.view;
      if (view instanceof DashboardView) {
        view.render();
      }
    }
  }

  queueRefresh() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refreshDashboardViews(), 400);
  }

  async collectData(): Promise<DashboardData> {
    const today = moment().format(this.settings.dailyDateFormat);
    const todayFile = this.getDailyFile(today);
    const dailySections = todayFile
      ? extractDailySections(await this.app.vault.cachedRead(todayFile))
      : [];

    const files = this.app.vault.getMarkdownFiles();
    const tasks: DashboardTask[] = [];
    const dailyTodosByDate = new Map<string, DashboardTask[]>();
    const projects: ProjectSummary[] = [];
    const articles: LibraryItem[] = [];
    const books: LibraryItem[] = [];

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter ?? {};

      tasks.push(...extractTasks(content, file));

      const dailyDate = this.getDateFromDailyFile(file);
      if (dailyDate) {
        const dailyTodos = extractTasksFromHeading(
          content,
          file,
          this.settings.defaultTaskSection,
        ).filter((task) => !task.done);
        dailyTodosByDate.set(dailyDate, dailyTodos);
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

    const allOpenTasks = tasks
      .filter((task) => !task.done)
      .sort(compareTasksForDashboard);

    const todayIso = moment(today, this.settings.dailyDateFormat, true).format("YYYY-MM-DD");
    const todayTasks = getTasksForDate(
      todayIso,
      dailyTodosByDate.get(todayIso) ?? [],
      allOpenTasks,
    ).slice(0, 18);

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
      tasks: todayTasks,
      allTasks: allOpenTasks,
      calendarCounts,
      projects: projects.sort((a, b) => b.updated - a.updated).slice(0, 10),
      articles: articles.sort((a, b) => b.updated - a.updated).slice(0, 8),
      books: books.sort((a, b) => b.updated - a.updated).slice(0, 8),
    };
  }

  getDailyFile(date: string): TFile | undefined {
    const folder = renderDailyFolder(
      this.settings.dailyFolder,
      date,
      this.settings.dailyDateFormat,
    );
    const path = folder ? `${folder}/${date}.md` : `${date}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : undefined;
  }

  getDateFromDailyFile(file: TFile): string | undefined {
    const firstStaticSegment = getFirstStaticDailyFolderSegment(this.settings.dailyFolder);
    if (firstStaticSegment && !file.path.startsWith(`${firstStaticSegment}/`)) {
      return undefined;
    }

    const parsed = moment(file.basename, this.settings.dailyDateFormat, true);
    return parsed.isValid() ? parsed.format("YYYY-MM-DD") : undefined;
  }

  async getDailyTodoTasks(date: string): Promise<DashboardTask[]> {
    const file = this.getDailyFile(date);
    if (!file) {
      return [];
    }

    const content = await this.app.vault.cachedRead(file);
    return extractTasksFromHeading(content, file, this.settings.defaultTaskSection);
  }

  async getTodosForDate(date: string, allTasks: DashboardTask[]): Promise<DashboardTask[]> {
    const dailyTodos = await this.getDailyTodoTasks(
      moment(date).format(this.settings.dailyDateFormat),
    );
    return getTasksForDate(date, dailyTodos, allTasks);
  }

  async ensureDailyNote(date = moment().format(this.settings.dailyDateFormat)): Promise<TFile> {
    const existing = this.getDailyFile(date);
    if (existing) {
      return existing;
    }

    const folder = renderDailyFolder(
      this.settings.dailyFolder,
      date,
      this.settings.dailyDateFormat,
    );
    if (folder) {
      await ensureFolder(this.app, folder);
    }

    const path = folder ? `${folder}/${date}.md` : `${date}.md`;
    const content = [
      "---",
      "type: daily",
      `date: ${date}`,
      "---",
      "",
      `# ${date}`,
      "",
      ...DAILY_TEMPLATE_SECTIONS.flatMap((heading) => [`## ${heading}`, ""]),
    ].join("\n");

    return this.app.vault.create(path, content);
  }

  async appendTaskToToday(text: string) {
    const cleanText = text.trim();
    if (!cleanText) {
      return;
    }

    const file = await this.ensureDailyNote();
    const content = await this.app.vault.cachedRead(file);
    const nextContent = appendLineUnderHeading(
      content,
      this.settings.defaultTaskSection,
      `- [ ] ${cleanText}`,
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

    lines[task.line] = line.replace(
      /^(\s*-\s+\[)( |x|X|-)(\]\s+)/,
      `$1${task.done ? " " : "x"}$3`,
    );
    await this.app.vault.modify(task.file, lines.join("\n"));
  }

  async openFile(file: TFile) {
    await this.app.workspace.getLeaf(false).openFile(file);
  }
}

class DashboardView extends ItemView {
  private plugin: DashboardPlugin;
  private selectedCalendarDate = moment().format("YYYY-MM-DD");
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

    this.renderDaily(grid, data);
    this.renderTasks(grid, data);
    await this.renderCalendar(grid, data);
    this.renderProjects(grid, data);
    this.renderLibrary(grid, "Articles", data.articles);
    this.renderLibrary(grid, "Books", data.books);
  }

  private renderHeader(root: HTMLElement, data: DashboardData) {
    const header = root.createDiv({ cls: "dashboard-home__header" });
    const titleBlock = header.createDiv();
    titleBlock.createEl("p", {
      cls: "dashboard-home__eyebrow",
      text: moment().format("dddd, MMMM D"),
    });
    titleBlock.createEl("h1", { text: "my life" });

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
        placeholder: "记录今日 todo，例如：整理项目计划 2026-07-03",
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
    const card = createCard(root, data.today);

    if (!data.todayFile) {
      card.createEl("p", {
        cls: "dashboard-home__muted",
        text: "No daily note yet.",
      });
      const button = card.createEl("button", { text: "Create daily note" });
      button.addEventListener("click", async () => {
        const file = await this.plugin.ensureDailyNote(data.today);
        await this.plugin.openFile(file);
      });
      return;
    }

    const path = card.createEl("button", {
      cls: "dashboard-home__file-link",
      text: data.todayFile.path,
    });
    path.addEventListener("click", () => this.plugin.openFile(data.todayFile as TFile));

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

    const thoughtSection = sectionsByHeading.get("想法/思考");
    const item = card.createDiv({ cls: "dashboard-home__section-preview" });
    item.createEl("h3", { text: "想法/思考" });
    item.createEl("p", {
      cls: "dashboard-home__thought-content",
      text: getSectionText(thoughtSection) || "暂无内容",
    });
  }

  private renderTasks(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "今日todo");

    if (data.tasks.length === 0) {
      card.createEl("p", {
        cls: "dashboard-home__muted",
        text: "今天暂无 todo。",
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
        text: `${task.due ?? "No date"} · ${task.file.basename}`,
      });
      meta.addEventListener("click", () => this.plugin.openFile(task.file));
    }
  }

  private async renderCalendar(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "Calendar");
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
      const count = data.calendarCounts.get(iso) ?? 0;
      if (count > 0) {
        cell.createEl("small", { text: String(count) });
      }
      cell.addEventListener("click", async () => {
        this.selectedCalendarDate = iso;
        await this.render();
      });
    }

    const todoPanel = card.createDiv({ cls: "dashboard-home__calendar-todos" });
    todoPanel.createEl("h3", { text: `${this.selectedCalendarDate} · 今日todo` });

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
      body.createEl("small", { text: task.file.basename }).addEventListener("click", () => {
        this.plugin.openFile(task.file);
      });
    }
  }

  private renderProjects(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "Projects");

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

  private renderLibrary(root: HTMLElement, title: string, items: LibraryItem[]) {
    const card = createCard(root, title);

    if (items.length === 0) {
      card.createEl("p", {
        cls: "dashboard-home__muted",
        text: `No ${title.toLowerCase()} found.`,
      });
      return;
    }

    for (const item of items) {
      const row = card.createDiv({ cls: "dashboard-home__library-item" });
      row.createEl("button", { text: item.title }).addEventListener("click", () => {
        this.plugin.openFile(item.file);
      });
      row.createEl("small", { text: item.status });
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

function createCard(root: HTMLElement, title: string): HTMLElement {
  const card = root.createDiv({ cls: "dashboard-home__card" });
  card.createEl("h2", { text: title });
  return card;
}

function extractDailySections(content: string): DailySection[] {
  const lines = content.split("\n");
  const sections: DailySection[] = [];
  let current: { heading: string; lines: string[] } | undefined;

  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      if (current) {
        sections.push(toDailySection(current));
      }
      current = { heading: heading[1].trim(), lines: [] };
      continue;
    }

    if (current && !/^---$/.test(line)) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push(toDailySection(current));
  }

  return sections;
}

function toDailySection(section: { heading: string; lines: string[] }): DailySection {
  const preview = section.lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");

  return {
    heading: section.heading,
    preview,
    lines: section.lines,
  };
}

function getSectionText(section: DailySection | undefined): string {
  if (!section) {
    return "";
  }

  return section.lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function extractTasks(content: string, file: TFile): DashboardTask[] {
  return content
    .split("\n")
    .map((line, index): DashboardTask | undefined => {
      const match = /^(\s*)-\s+\[( |x|X|-)\]\s+(.+)$/.exec(line);
      if (!match) {
        return undefined;
      }

      const text = match[3].trim();
      return {
        text,
        done: match[2].toLowerCase() === "x",
        due: extractDate(text),
        file,
        line: index,
        tags: Array.from(text.matchAll(/#[\p{Letter}\p{Number}/_-]+/gu)).map(
          (tag) => tag[0],
        ),
      };
    })
    .filter((task): task is DashboardTask => Boolean(task));
}

function extractTasksFromHeading(
  content: string,
  file: TFile,
  heading: string,
): DashboardTask[] {
  const lines = content.split("\n");
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));
  if (headingIndex === -1) {
    return [];
  }

  const tasks: DashboardTask[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }

    const match = /^(\s*)-\s+\[( |x|X|-)\]\s+(.+)$/.exec(lines[index]);
    if (!match) {
      continue;
    }

    const text = match[3].trim();
    tasks.push({
      text,
      done: match[2].toLowerCase() === "x",
      due: extractDate(text),
      file,
      line: index,
      tags: Array.from(text.matchAll(/#[\p{Letter}\p{Number}/_-]+/gu)).map(
        (tag) => tag[0],
      ),
    });
  }

  return tasks;
}

function getTasksForDate(
  date: string,
  dailyTodos: DashboardTask[],
  allOpenTasks: DashboardTask[],
): DashboardTask[] {
  const tasksByLocation = new Map<string, DashboardTask>();

  for (const task of dailyTodos) {
    if (!task.done) {
      tasksByLocation.set(getTaskLocation(task), task);
    }
  }

  for (const task of allOpenTasks) {
    if (!task.done && task.due === date) {
      tasksByLocation.set(getTaskLocation(task), task);
    }
  }

  return Array.from(tasksByLocation.values()).sort(compareTasksForDashboard);
}

function getTaskLocation(task: DashboardTask): string {
  return `${task.file.path}:${task.line}`;
}

function extractDate(text: string): string | undefined {
  const explicit =
    /(?:due|scheduled|start|date)::\s*(\d{4}-\d{2}-\d{2})/i.exec(text) ??
    /[📅⏳🛫]\s*(\d{4}-\d{2}-\d{2})/u.exec(text) ??
    /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);

  return explicit?.[1];
}

function stripTaskMetadata(text: string): string {
  return text
    .replace(/(?:due|scheduled|start|date)::\s*\d{4}-\d{2}-\d{2}/gi, "")
    .replace(/[📅⏳🛫]\s*\d{4}-\d{2}-\d{2}/gu, "")
    .trim();
}

function compareTasksForDashboard(a: DashboardTask, b: DashboardTask): number {
  if (a.due && b.due) {
    return a.due.localeCompare(b.due);
  }
  if (a.due) {
    return -1;
  }
  if (b.due) {
    return 1;
  }
  return b.file.stat.mtime - a.file.stat.mtime;
}

function isProjectFile(
  file: TFile,
  frontmatter: Record<string, unknown>,
  folder: string,
): boolean {
  const type = String(frontmatter.type ?? "").toLowerCase();
  return isInFolder(file, folder) || type === "project";
}

function buildProjectSummary(
  file: TFile,
  content: string,
  frontmatter: Record<string, unknown>,
): ProjectSummary {
  const tasks = extractTasks(content, file);
  const total = tasks.length;
  const done = tasks.filter((task) => task.done).length;

  return {
    title: String(frontmatter.title ?? file.basename),
    file,
    status: String(frontmatter.status ?? "active"),
    progress: total === 0 ? 0 : Math.round((done / total) * 100),
    updated: file.stat.mtime,
  };
}

function isLibraryFile(
  file: TFile,
  frontmatter: Record<string, unknown>,
  folder: string,
  kind: "article" | "book",
): boolean {
  const type = String(frontmatter.type ?? "").toLowerCase();
  const tags = normalizeTags(frontmatter.tags);
  return isInFolder(file, folder) || type === kind || tags.includes(kind);
}

function buildLibraryItem(
  file: TFile,
  frontmatter: Record<string, unknown>,
  kind: "article" | "book",
): LibraryItem {
  return {
    title: String(frontmatter.title ?? file.basename),
    file,
    kind,
    status: String(frontmatter.status ?? (kind === "book" ? "reading" : "saved")),
    updated: file.stat.mtime,
  };
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).replace(/^#/, "").toLowerCase());
  }

  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((tag) => tag.replace(/^#/, "").toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function isInFolder(file: TFile, folder: string): boolean {
  const normalized = normalizeFolder(folder);
  return Boolean(normalized) && file.path.startsWith(`${normalized}/`);
}

function normalizeFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "");
}

function getFirstStaticDailyFolderSegment(folderTemplate: string): string | undefined {
  return normalizeFolder(folderTemplate)
    .split("/")
    .find((segment) => segment && !isDateFolderSegment(segment));
}

function renderDailyFolder(
  folderTemplate: string,
  date: string,
  dateFormat: string,
): string {
  const normalized = normalizeFolder(folderTemplate);
  if (!normalized) {
    return "";
  }

  const parsed = moment(date, dateFormat, true);
  const dailyMoment = parsed.isValid() ? parsed : moment(date);

  return normalized
    .split("/")
    .map((segment) =>
      isDateFolderSegment(segment) ? dailyMoment.format(segment) : segment,
    )
    .join("/");
}

function isDateFolderSegment(segment: string): boolean {
  return /^(Y{2,4}|M{1,2}|D{1,2}|[-_.\s])+$/.test(segment);
}

async function ensureFolder(app: App, folder: string) {
  const parts = normalizeFolder(folder).split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

function appendLineUnderHeading(
  content: string,
  heading: string,
  lineToAppend: string,
): string {
  const lines = content.split("\n");
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));

  if (headingIndex === -1) {
    const suffix = content.endsWith("\n") ? "" : "\n";
    return `${content}${suffix}\n## ${heading}\n${lineToAppend}\n`;
  }

  let insertIndex = headingIndex + 1;
  while (insertIndex < lines.length && !/^##\s+/.test(lines[insertIndex])) {
    insertIndex += 1;
  }

  lines.splice(insertIndex, 0, lineToAppend);
  return lines.join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(
    2,
    "0",
  )}`;
}
