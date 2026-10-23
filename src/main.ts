import { DailySetupModal, dailyPath, validateDailyLocation } from "./daily-setup";
import { decodeSettings } from "./settings-codec";
import { backupDocument } from "./backup";
import { planText, planItems, replacePlan } from "./monthly-items";
import { parseTaskCategories, withTaskCategory, getTaskTags, findTaskCategory } from "./categories";
import { NoteIndex } from "./note-index";
import { DayRollover } from "./day-rollover";
import type { MonthlyPlanDraft } from "./monthly-plan-panel";
import { SettingsStore } from "./settings-store";
import { updateTaskCompletion } from "./task-editing";
import { Notice, Plugin, TFile, TAbstractFile, moment } from "obsidian";
import { DEFAULT_SETTINGS, VIEW_TYPE_DASHBOARD, VIEW_TYPE_MONTHLY_DIARY, VIEW_TYPE_STUDY_TRACKER } from "./constants";
import { PREFERENCE_KEYS, normalizePreferences, includesTaskFile, getThoughtHeadings, type Preferences } from "./preferences";
import { appendLineUnderHeading, buildLibraryItem, ensureFolder, extractDailySections, isLibraryFile } from "./notes";
import { compareTasksForDashboard, dedupeTasksByLocation, applyTaskOrder, groupCalendarTasks, getTaskKey } from "./tasks";
import { getStudyCheckinsForDate, getStudyCourse, normalizeStudyCheckins } from "./study";
import type { DashboardCategory, DashboardData, DailyMonthSummary, DashboardPanelId, DashboardPanelSize, DashboardSettings, DashboardTask, LibraryItem, RecentThought, StudyCheckin, StudyCourse, StudyTrackerMode } from "./types";
import { normalizePanelOrder, normalizePanelSizes, normalizePanelVisibility } from "./configuration";
import { categorizeTasks, getDailyText, getRecentInspirationPreview, getDailyValue, getSafeMonth, parseDashboardDate, buildQuickTaskLine } from "./utils";
import { DashboardView } from "./dashboard-view";
import { MonthlyDiaryView } from "./monthly-diary-view";
import { StudyTrackerView } from "./study-tracker-view";
import { DashboardSettingTab } from "./settings-tab";

export default class DashboardPlugin extends Plugin {
  settings: DashboardSettings = DEFAULT_SETTINGS;
  private refreshTimer?: number;
  private dailyNotePromises = new Map<string, Promise<TFile>>();
  private settingsStore = new SettingsStore(() => this.settings, (snapshot) => this.writeSettings(snapshot));
  private clearingArchive = false;
  private noteIndex = new NoteIndex((file) => this.app.vault.cachedRead(file));
  archiveRevision = 0;
  monthlyPlanDrafts = new Map<string, MonthlyPlanDraft>();
  syncConflict = false;
  private setupPromise?: Promise<boolean>;
  showDailySetup(): Promise<boolean> {
    if (this.setupPromise) return this.setupPromise;
    this.setupPromise = new Promise<boolean>((resolve) => new DailySetupModal(this, resolve).open())
      .finally(() => { this.setupPromise = undefined; });
    return this.setupPromise;
  }

  async configureDaily(folder: string, format: string, literal: boolean) {
    validateDailyLocation(folder, format);
    await this.settingsStore.update(["dailyFolder", "dailyDateFormat", "dailyFolderLiteral", "dailySetupComplete"], (draft) => {
      draft.dailyFolder = folder; draft.dailyDateFormat = format; draft.dailyFolderLiteral = literal; draft.dailySetupComplete = true;
    });
    this.noteIndex.clear(); this.refreshAllViews();
  }

  private backupDay = "";
  private backupSequence = 0;

  private backupFolder() { return `${this.app.vault.configDir}/plugins/dashboard-home/backups`; }

  async writeBackup(reason: string, settings = this.snapshotWithDrafts()): Promise<string> {
    const adapter = this.app.vault.adapter;
    if (!adapter) return ""; // Test hosts without a filesystem.
    const folder = this.backupFolder();
    if (!await adapter.exists(folder)) await adapter.mkdir(folder);
    const path = `${folder}/${new Date().toISOString().replace(/[:.]/g, "-")}-${++this.backupSequence}-${reason}.json`;
    await adapter.write(path, backupDocument(settings));
    return path;
  }

  async listBackups(): Promise<string[]> {
    const folder = this.backupFolder();
    if (!await this.app.vault.adapter.exists(folder)) return [];
    return (await this.app.vault.adapter.list(folder)).files.filter((path) => path.endsWith(".json")).sort().reverse();
  }

  snapshotWithDrafts(): DashboardSettings {
    const settings = JSON.parse(JSON.stringify(this.settings)) as DashboardSettings;
    for (const [date, draft] of this.monthlyPlanDrafts) replacePlan(settings, date, draft.text);
    return settings;
  }

  private async writeSettings(settings: DashboardSettings) {
    const day = moment().format("YYYY-MM-DD");
    if (this.app.vault.adapter && this.backupDay !== day) {
      const previous = await this.loadData();
      if (previous) await this.writeBackup("automatic", decodeSettings(previous));
      this.backupDay = day;
    }
    await this.saveData(settings);
  }

  async restoreBackup(settings: DashboardSettings) {
    await this.writeBackup("before-restore");
    if (this.app.vault.adapter) await this.writeBackup("disk-before-restore", decodeSettings(await this.loadData()));
    this.archiveRevision += 1;
    try {
      await this.settingsStore.replace(settings);
      this.monthlyPlanDrafts.clear();
      this.syncConflict = false;
    } finally {
      for (const draft of this.monthlyPlanDrafts.values()) draft.revision = this.archiveRevision;
      this.noteIndex.clear();
      this.refreshAllViews();
    }
  }

  async onExternalSettingsChange() {
    const before = {...this.settings.monthlyPlan};
    try {
      await this.settingsStore.refresh();
      this.syncConflict = false;
      for (const [date, draft] of this.monthlyPlanDrafts) {
        if (before[date] !== this.settings.monthlyPlan[date]) {
          draft.status = "error";
          this.syncConflict = true;
          await this.writeBackup("draft-conflict");
          new Notice(`${date} 的同步计划已变化。草稿已保留，请在数据管理中选择版本。`);
        }
      }
      this.noteIndex.clear();
      this.refreshAllViews();
    } catch (error) { new Notice(error instanceof Error ? error.message : "同步版本读取失败，未覆盖本机数据。"); }
  }

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

    this.addRibbonIcon("home", `打开 ${this.manifest.name}`, () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-dashboard-home",
      name: "Open home",
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
      checkCallback: (checking) => {
        if (!this.settings.studyEnabled) return false;
        if (!checking) void this.activateStudyTrackerView();
        return true;
      },
    });

    this.addCommand({
      id: "refresh-dashboard-home",
      name: "Refresh home",
      callback: () => this.refreshFromVault(),
    });

    this.addSettingTab(new DashboardSettingTab(this.app, this));

    const onFileChanged = (file: TAbstractFile) => {
      this.noteIndex.invalidate(file.path);
      this.queueRefresh();
    };
    this.registerEvent(this.app.vault.on("create", onFileChanged));
    this.registerEvent(this.app.vault.on("delete", onFileChanged));
    this.registerEvent(this.app.vault.on("modify", onFileChanged));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.noteIndex.invalidate(oldPath);
      this.noteIndex.invalidate(file.path);
      this.queueRefresh();
    }));
    const rollover = new DayRollover(() => this.refreshAllViews());
    this.registerDomEvent(window, "focus", rollover.check);
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") rollover.check();
    });
    this.register(() => rollover.dispose());
    rollover.check();
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.queueRefresh()),
    );

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openOnStartup) void this.activateView();
    });
  }

  onunload() {
    window.clearTimeout(this.refreshTimer);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MONTHLY_DIARY);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_STUDY_TRACKER);
  }

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = decodeSettings(saved);
    this.settingsStore.enableSync(async () => decodeSettings(await this.loadData()), async (local, remote) => {
      this.syncConflict = true;
      await this.writeBackup("conflict-local", local);
      await this.writeBackup("conflict-remote", remote);
    });
  }

  async savePreferences(value: Partial<Preferences>) {
    const keys = PREFERENCE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(value, key));
    await this.settingsStore.update(keys, (draft) => {
      const preferences = normalizePreferences({ ...draft, ...value });
      if (preferences.taskSource === "folders" && !preferences.taskFolders.length) {
        throw new Error("请至少填写一个待办来源文件夹。");
      }
      if (preferences.defaultTaskSection === preferences.thoughtSection) {
        throw new Error("待办章节和想法章节请使用不同名称。");
      }
      for (const key of keys) Object.assign(draft, { [key]: preferences[key] });
    });
    this.refreshAllViews();
  }

  async saveTaskCategories(text: string, defaultCategory: string) {
    const categories = parseTaskCategories(text);
    await this.settingsStore.update(["taskCategories", "defaultTaskCategory"], (draft) => {
      draft.taskCategories = categories;
      draft.defaultTaskCategory = categories.includes(defaultCategory) ? defaultCategory : "";
    });
    this.refreshDashboardViews();
    this.refreshMonthlyDiaryViews();
  }

  private getTaskSectionHint(heading: string): string {
    if (heading !== this.settings.defaultTaskSection || !this.settings.taskCategories.length) return "";
    return `<!-- 分类：在待办末尾添加 ${this.settings.taskCategories.map((category) => "#" + category).join("、")} -->`;
  }

  async saveSettings() {
    await this.persistSettings();
    this.refreshDashboardViews();
  }

  async saveSetting<K extends "dailyFolder" | "dailyDateFormat" | "articleFolder" | "bookFolder" | "openOnStartup" | "studyEnabled" | "studyCourses">(key: K, value: DashboardSettings[K]) {
    await this.settingsStore.update([key], (draft) => { draft[key] = value; });
    this.refreshAllViews();
  }

  private persistSettings() { return this.settingsStore.save(); }

  async clearArchive() {
    if (this.clearingArchive) throw new Error("正在清除存档，请稍候。");
    this.clearingArchive = true;
    this.archiveRevision += 1;
    try {
      await this.writeBackup("before-clear");
      await this.settingsStore.update(["monthlyPlan", "monthlyPlanDone", "monthlyPlanCategory", "monthlyPlanItems", "studyCheckins", "taskOrder"], (draft) => {
        draft.monthlyPlan = {};
        draft.monthlyPlanItems = {};
        draft.monthlyPlanDone = {};
        draft.monthlyPlanCategory = {};
        draft.studyCheckins = [];
        draft.taskOrder = [];
      });
      this.monthlyPlanDrafts.clear();
    } finally {
      this.clearingArchive = false;
      for (const draft of this.monthlyPlanDrafts.values()) draft.revision = this.archiveRevision;
      this.refreshDashboardViews();
      this.refreshMonthlyDiaryViews();
      this.refreshStudyTrackerViews();
    }
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
    await this.settingsStore.update(["panelOrder"], (draft) => { draft.panelOrder = order; });
    this.refreshDashboardViews();
  }

  async moveTaskOrder(draggedTaskKey: string, targetTaskKey: string) {
    const archiveRevision = this.archiveRevision;
    if (draggedTaskKey === targetTaskKey) {
      return;
    }

    const currentTasks = (await this.collectData()).tasks;
    if (this.clearingArchive || archiveRevision !== this.archiveRevision) return;
    const order = currentTasks.map(getTaskKey).filter((key) => key !== draggedTaskKey);
    if (!currentTasks.some((task) => getTaskKey(task) === draggedTaskKey) || !order.includes(targetTaskKey)) return;
    const targetIndex = order.indexOf(targetTaskKey);
    order.splice(targetIndex === -1 ? order.length : targetIndex, 0, draggedTaskKey);
    await this.settingsStore.update(["taskOrder"], (draft) => { draft.taskOrder = order; });
    this.refreshDashboardViews();
  }

  async resizePanel(panelId: DashboardPanelId, size: DashboardPanelSize) {
    await this.settingsStore.update(["panelSizes"], (draft) => {
      draft.panelSizes = { ...normalizePanelSizes(draft.panelSizes), [panelId]: size };
    });
    this.refreshDashboardViews();
  }

  isPanelVisible(panelId: DashboardPanelId): boolean {
    return normalizePanelVisibility(this.settings.visiblePanels)[panelId];
  }

  async setPanelVisibility(panelId: DashboardPanelId, visible: boolean) {
    await this.settingsStore.update(["visiblePanels"], (draft) => {
      draft.visiblePanels = { ...normalizePanelVisibility(draft.visiblePanels), [panelId]: visible };
    });
    this.refreshDashboardViews();
  }

  async activateView() {
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf("tab");

    await leaf.setViewState({
      type: VIEW_TYPE_DASHBOARD,
      active: true,
    });

    this.app.workspace.revealLeaf(leaf);
  }

  async activateMonthlyDiaryView(month = moment().format("YYYY-MM")) {
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MONTHLY_DIARY);
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf("tab");

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

  refreshFromVault() {
    this.noteIndex.clear();
    this.refreshAllViews();
  }

  private refreshAllViews() {
    this.refreshDashboardViews();
    this.refreshMonthlyDiaryViews();
    this.refreshStudyTrackerViews();
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
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf("tab");

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
    const files = this.app.vault.getMarkdownFiles();
    const indexed = await this.noteIndex.readAll(files, this.settings.defaultTaskSection);
    const dailySections = todayFile ? indexed[files.indexOf(todayFile)]?.sections ?? [] : [];
    const tasks: DashboardTask[] = [];
    const dailyDates = new Set<string>();
    const dailyDatesByPath = new Map<string, string>();
    const articles: LibraryItem[] = [];
    const books: LibraryItem[] = [];
    const recentThoughts: RecentThought[] = [];

    for (const [index, file] of files.entries()) {
      const note = indexed[index];
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter ?? {};

      const dailyDate = this.getDateFromDailyFile(file);
      const includeTasks = includesTaskFile(file.path, Boolean(dailyDate), this.settings);
      if (includeTasks) tasks.push(...categorizeTasks(note.tasks, this.settings.taskCategories));
      if (dailyDate) {
        dailyDates.add(dailyDate);
        dailyDatesByPath.set(file.path, dailyDate);
        const dailySectionsForFile = note.sections;
        const dailyTodos = categorizeTasks(note.headingTasks, this.settings.taskCategories);
        if (includeTasks) tasks.push(...dailyTodos);

        if (dailyDate <= today) {
          const previewSections = getRecentInspirationPreview(dailySectionsForFile, getThoughtHeadings(this.settings));
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

      if (isLibraryFile(file, frontmatter, this.settings.articleFolder, "article")) {
        articles.push(buildLibraryItem(file, frontmatter, "article"));
      }

      if (isLibraryFile(file, frontmatter, this.settings.bookFolder, "book")) {
        books.push(buildLibraryItem(file, frontmatter, "book"));
      }
    }

    for (const date of Object.keys(this.settings.monthlyPlan)) tasks.push(...this.getMonthlyPlanTasks(date));

    const allTasks = dedupeTasksByLocation(tasks).map((task) => ({
      ...task, dailyDate: task.file ? dailyDatesByPath.get(task.file.path) : undefined,
    }));
    const allOpenTasks = allTasks.filter((task) => !task.done)
      .sort(compareTasksForDashboard);
    const orderedTasks = applyTaskOrder(allOpenTasks, this.settings.taskOrder);

    const calendarTasks = groupCalendarTasks(allTasks, dailyDatesByPath);

    return {
      today,
      todayFile,
      dailySections,
      tasks: orderedTasks,
      completedTasks: allTasks.filter((task) => task.done).sort(compareTasksForDashboard),
      dailyDates,
      calendarTasks,
      articles: articles.sort((a, b) => b.updated - a.updated).slice(0, 8),
      books: books.sort((a, b) => b.updated - a.updated).slice(0, 8),
      recentThoughts: recentThoughts
        .sort((a, b) => b.date.localeCompare(a.date) || b.updated - a.updated),
      studyCheckins: this.settings.studyCheckins,
    };
  }

  getStudyCourses(): StudyCourse[] {
    return this.settings.studyCourses;
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
    if (this.clearingArchive || !getStudyCourse(courseId, this.settings.studyCourses) || !moment(date, "YYYY-MM-DD", true).isValid()) return;
    try {
      await this.settingsStore.update(["studyCheckins"], (draft) => {
        const index = draft.studyCheckins.findIndex((item) => item.courseId === courseId && item.date === date);
        if (index >= 0) draft.studyCheckins.splice(index, 1);
        else draft.studyCheckins.push({ courseId, date, checkedAt: Date.now() });
        draft.studyCheckins = normalizeStudyCheckins(draft.studyCheckins);
      });
    } catch {
      new Notice("打卡保存失败，已保留原状态，请重试。");
    } finally {
      this.refreshDashboardViews();
      this.refreshStudyTrackerViews();
    }
  }

  getMonthlyPlanText(date: string, settings = this.settings): string {
    return planText(settings, date);
  }

  getMonthlyPlanTasks(date: string): DashboardTask[] {
    return planItems(this.settings, date).map((item) => ({
      source: "monthly-plan", monthlyPlanDate: date, monthlyPlanItemId: item.id,
      text: item.text, done: item.done, due: date, line: -1, tags: getTaskTags(item.text),
      category: findTaskCategory(getTaskTags(item.text), this.settings.taskCategories),
    }));
  }

  private getMonthlyPlanCategory(date: string): DashboardCategory | undefined {
    const tags = getTaskTags(this.settings.monthlyPlan[date] ?? "");
    return tags.length ? findTaskCategory(tags, this.settings.taskCategories) : this.settings.monthlyPlanCategory[date];
  }

  async saveMonthlyPlanText(date: string, text: string, revision = this.archiveRevision) {
    if (this.clearingArchive || revision !== this.archiveRevision) return;
    if (!moment(date, "YYYY-MM-DD", true).isValid()) throw new Error("计划日期无效。");
    await this.saveMonthlyPlan(date, text, revision);
  }

  private updateMonthlyPlanText(draft: DashboardSettings, date: string, text: string) {
    replacePlan(draft, date, text);
  }

  async saveMonthlyPlan(date: string, text: string, revision = this.archiveRevision, baseText?: string) {
    if (this.clearingArchive || revision !== this.archiveRevision) throw new Error("存档正在变更，请稍后重试。");
    if (!moment(date, "YYYY-MM-DD", true).isValid()) throw new Error("计划日期无效。");
    await this.settingsStore.update(["monthlyPlan", "monthlyPlanDone", "monthlyPlanCategory", "monthlyPlanItems"], (draft) => {
      if (baseText !== undefined && (draft.monthlyPlan[date] ?? "") !== baseText) {
        this.syncConflict = true;
        throw new Error("计划已在其他位置变化，草稿已保留，请在数据管理中选择版本。");
      }
      this.updateMonthlyPlanText(draft, date, text);
      delete draft.monthlyPlanCategory[date];
    });
    this.refreshMonthlyDiaryViews();
    this.queueRefresh();
  }

  async toggleMonthlyPlanTask(date: string, itemId?: string) {
    if (this.clearingArchive || !this.settings.monthlyPlan[date]) return;
    await this.settingsStore.update(["monthlyPlanDone", "monthlyPlanItems"], (draft) => {
      const items = planItems(draft, date).map((item) => ({...item}));
      if (itemId) {
        const item = items.find((item) => item.id === itemId);
        if (!item) throw new Error("这条计划已变更，请刷新后重试。");
        item.done = !item.done;
      } else {
        const done = !items.every((item) => item.done);
        for (const item of items) item.done = done;
      }
      draft.monthlyPlanItems[date] = items;
      if (items.length > 0 && items.every((item) => item.done)) draft.monthlyPlanDone[date] = true;
      else delete draft.monthlyPlanDone[date];
    });
    this.refreshDashboardViews();
    this.refreshMonthlyDiaryViews();
  }

  getDailyFile(date: string): TFile | undefined {
    const parsedDate = parseDashboardDate(date, this.settings.dailyDateFormat);
    if (!parsedDate) {
      return undefined;
    }

    const path = dailyPath(this.settings, parsedDate.format("YYYY-MM-DD"));
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : undefined;
  }

  getDateFromDailyFile(file: TFile): string | undefined {
    const relative = this.settings.dailyFolderLiteral && this.settings.dailyFolder
      ? file.path.slice(this.settings.dailyFolder.length + 1) : this.settings.dailyFolderLiteral ? file.path : file.basename + ".md";
    const parsedDate = moment(relative.replace(/\.md$/, ""), this.settings.dailyDateFormat, true);
    if (!parsedDate.isValid() || dailyPath(this.settings, parsedDate.format("YYYY-MM-DD")) !== file.path) return undefined;

    return parsedDate.format("YYYY-MM-DD");
  }

  async collectDailyMonthSummaries(
    month = moment().format("YYYY-MM"),
  ): Promise<DailyMonthSummary[]> {
    const safeMonth = getSafeMonth(month);
    const summaries: DailyMonthSummary[] = [];

    for (let day = 1;day <= safeMonth.daysInMonth();day += 1) {
      const date = safeMonth.clone().date(day).format("YYYY-MM-DD");
      const file = this.getDailyFile(date);
      if (!file) {
        summaries.push({
          date,
          todos: this.getMonthlyPlanTasks(date),
          inspiration: "",
          relatedNotes: "",
          readingNotes: "",
          mood: "",
          efficiency: "",
          review: "",
          monthlyPlan: this.settings.monthlyPlan[date] ?? "",
          monthlyPlanDone: Boolean(this.settings.monthlyPlanDone[date]),
          monthlyPlanCategory: this.getMonthlyPlanCategory(date),
        });
        continue;
      }

      const note = await this.noteIndex.get(file, this.settings.defaultTaskSection);
      const sections = note.sections;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

      summaries.push({
        date,
        file,
        todos: [...this.getMonthlyPlanTasks(date), ...categorizeTasks(
          includesTaskFile(file.path, true, this.settings) ? note.headingTasks : [], this.settings.taskCategories,
        )],
        inspiration: getDailyText(sections, getThoughtHeadings(this.settings)),
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
        monthlyPlanCategory: this.getMonthlyPlanCategory(date),
      });
    }

    return summaries;
  }

  async ensureDailyNote(date = moment().format("YYYY-MM-DD")): Promise<TFile> {
    if (!this.settings.dailySetupComplete && !await this.showDailySetup()) throw new Error("请先确认日记位置，再创建笔记。");
    const key = parseDashboardDate(date, this.settings.dailyDateFormat)?.format("YYYY-MM-DD");
    if (!key) throw new Error(`Invalid daily note date: ${date}`);
    const pending = this.dailyNotePromises.get(key);
    if (pending) return pending;
    const creation = this.createDailyNote(key);
    this.dailyNotePromises.set(key, creation);
    try {
      return await creation;
    } finally {
      this.dailyNotePromises.delete(key);
    }
  }

  private async createDailyNote(date: string): Promise<TFile> {
    const parsedDate = parseDashboardDate(date, this.settings.dailyDateFormat);
    if (!parsedDate) {
      throw new Error(`Invalid daily note date: ${date}`);
    }

    const isoDate = parsedDate.format("YYYY-MM-DD");
    const existing = this.getDailyFile(isoDate);
    if (existing) {
      return existing;
    }

    const path = dailyPath(this.settings, isoDate);
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder) await ensureFolder(this.app, folder);
    const content = [
      "---",
      "type: daily",
      `date: ${isoDate}`,
      "---",
      "",
      `# ${isoDate}`,
      "",
      ...this.getDailyTemplateSections().flatMap((heading) => [
        `## ${heading}`,
        this.getTaskSectionHint(heading),
        "",
      ]),
    ].join("\n");

    return this.app.vault.create(path, content);
  }

  async appendTaskToToday(text: string, category = this.settings.defaultTaskCategory) {
    if (!text.trim()) return;
    const taskLine = buildQuickTaskLine(withTaskCategory(text, category, this.settings.taskCategories));
    if (!taskLine) {
      return;
    }

    const file = await this.ensureDailyNote();
    await this.app.vault.process(file, (content) => appendLineUnderHeading(
      content,
      this.settings.defaultTaskSection,
      taskLine,
    ));
    this.noteIndex.invalidate(file.path);
    this.queueRefresh();
    new Notice(includesTaskFile(file.path, true, this.settings)
      ? "已记录到今天的 Todo。"
      : "已写入今日日记；当前待办来源未包含该日记，可在设置中调整来源。");
  }

  async appendTaskToDate(
    date: string,
    text: string,
    category: DashboardCategory = this.settings.defaultTaskCategory,
  ) {
    if (!moment(date, "YYYY-MM-DD", true).isValid()) {
      return;
    }

    const cleanText = text.trim().replace(/\s+/g, " ");
    if (!cleanText) {
      return;
    }

    const taskLine = buildQuickTaskLine(withTaskCategory(cleanText, category, this.settings.taskCategories));
    if (!taskLine) return;
    const file = await this.ensureDailyNote(date);
    await this.app.vault.process(file, (content) => appendLineUnderHeading(
      content,
      this.settings.defaultTaskSection,
      taskLine,
    ));
    this.noteIndex.invalidate(file.path);
    this.queueRefresh();
    new Notice(includesTaskFile(file.path, true, this.settings)
      ? `${date} Todo 已添加。`
      : "已写入日记；当前待办来源未包含该日记，可在设置中调整来源。");
  }

  getDailyTemplateSections(): string[] {
    return [...new Set([this.settings.defaultTaskSection, this.settings.thoughtSection])];
  }

  async completeDailyTemplate(file: TFile) {
    let updated = false;
    await this.app.vault.process(file, (content) => {
      const headings = extractDailySections(content).map((section) => section.heading);
      const missing = this.getDailyTemplateSections().filter((heading) => !headings.includes(heading));
      if (!missing.length) return content;
      updated = true;
      const suffix = content.endsWith("\n") ? "" : "\n";
      return [content + suffix, ...missing.flatMap((heading) => [
        `## ${heading}`, this.getTaskSectionHint(heading), "",
      ])].join("\n");
    });
    this.noteIndex.invalidate(file.path);
    this.queueRefresh();
    new Notice(updated ? "今日模板已补全。" : "今日模板已经完整。");
  }

  async toggleTask(task: DashboardTask) {
    try {
      if (task.source === "monthly-plan") {
        await this.toggleMonthlyPlanTask(task.monthlyPlanDate, task.monthlyPlanItemId);
        return;
      }
      await this.app.vault.process(task.file, (content) => updateTaskCompletion(content, task));
      this.noteIndex.invalidate(task.file.path);
      this.queueRefresh();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "任务更新失败，请刷新后重试。");
      this.queueRefresh();
    }
  }

  async openFile(file: TFile) {
    await this.app.workspace.getLeaf("tab").openFile(file);
  }
}
