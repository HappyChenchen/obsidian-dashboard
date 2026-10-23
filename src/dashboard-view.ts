import { CalendarPanel } from "./calendar-panel";
import { MonthlyPlanPanel } from "./monthly-plan-panel";
import { ItemView, Notice, WorkspaceLeaf, moment, setIcon } from "obsidian";
import { VIEW_TYPE_DASHBOARD } from "./constants";
import { getSectionText } from "./notes";
import { getTaskKey, stripTaskMetadata, groupDashboardTasks, getTaskDateGroup } from "./tasks";
import { getStudyCheckinCountByDate, getStudyCheckinsForDate } from "./study";
import type { DashboardCategoryFilter, DashboardData, DashboardPanelId, DashboardPanelSize, DashboardTabId, DashboardTask } from "./types";
import { getTagFilters, matchesTaskTags } from "./categories";
import { normalizePanelOrder, normalizePanelSizes } from "./configuration";
import { truncateText } from "./utils";
import { createCard, getSizeFromDrag, applyPanelSizeClass, renderTaskTitle } from "./view-utils";
import type DashboardPlugin from "./main";
import { StudyTrackerView } from "./study-tracker-view";

export class DashboardView extends ItemView {
  private plugin: DashboardPlugin;
  private renderVersion = 0;
  private closed = false;
  private renderedDay = moment().format("YYYY-MM-DD");
  private quickTaskDraft = "";
  private quickTaskCategory?: string;
  private submittingTask = false;
  private activeTab: DashboardTabId = "home";
  private monthlyPlan: MonthlyPlanPanel;
  private calendar: CalendarPanel;
  private todoCategory: DashboardCategoryFilter = "all";
  private completedTasksExpanded = false;
  private studyTrackerRenderer?: StudyTrackerView;
  private draggedPanelId?: DashboardPanelId;
  private resizingPanel?: {
    card: HTMLElement;
    panelId: DashboardPanelId;
    startX: number;
    startY: number;
    size: DashboardPanelSize;
  };

  constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.monthlyPlan = new MonthlyPlanPanel(plugin, () => this.render(), (date) => {
      this.calendar.dispose();
      this.calendar.month = date.slice(0, 7);
      this.calendar.selectedDate = date;
    });
    this.calendar = new CalendarPanel(plugin, this, () => {
      this.monthlyPlan.month = this.calendar.month;
      this.monthlyPlan.selectedDate = this.calendar.selectedDate;
      return this.render();
    }, (date) => this.openMonthlyPlan(date));
  }

  private async openMonthlyPlan(date: string) {
    this.calendar.dispose();
    this.calendar.month = this.monthlyPlan.month = date.slice(0, 7);
    this.calendar.selectedDate = this.monthlyPlan.selectedDate = date;
    this.activeTab = "monthly";
    await this.render();
    const input = this.monthlyPlan.editDate(date);
    input?.scrollIntoView({ block: "nearest" });
  }

  getViewType() {
    return VIEW_TYPE_DASHBOARD;
  }

  getDisplayText() {
    return this.plugin.manifest.name;
  }

  getIcon() {
    return "layout-dashboard";
  }

  async onOpen() {
    this.closed = false;
    await this.render();
  }

  async onClose() {
    this.closed = true;
    this.renderVersion += 1;
    this.calendar.dispose();
    await this.monthlyPlan.dispose();
  }

  getPanelSize(panelId: DashboardPanelId): DashboardPanelSize {
    return normalizePanelSizes(this.plugin.settings.panelSizes)[panelId];
  }

  async render() {
    if (this.closed || (this.activeTab === "monthly" && this.monthlyPlan.isComposing)) return;
    const version = ++this.renderVersion;
    const root = this.containerEl.children[1] as HTMLElement;
    if (this.activeTab === "study" && !this.plugin.settings.studyEnabled) this.activeTab = "home";
    try {
      const data = this.activeTab === "home" ? await this.plugin.collectData() : undefined;
      if (version !== this.renderVersion || this.closed) return;
      const previousInput = root.querySelector<HTMLInputElement>(".dashboard-home__quick-task input");
      const restoreFocus = previousInput && root.ownerDocument.activeElement === previousInput;
      const selection = previousInput?.selectionStart ?? null;
      const active = root.ownerDocument.activeElement as HTMLTextAreaElement | null;
      const planDate = active?.getAttribute?.("data-plan-date");
      const planSelection = planDate ? [active?.selectionStart ?? 0, active?.selectionEnd ?? 0] : undefined;
      const today = moment().format("YYYY-MM-DD");
      if (this.renderedDay !== today) {
        if (this.calendar.selectedDate === this.renderedDay && this.calendar.month === this.renderedDay.slice(0, 7)) {
          this.calendar.selectedDate = today;
          this.calendar.month = today.slice(0, 7);
          if (this.monthlyPlan.selectedDate === this.renderedDay) {
            this.monthlyPlan.selectedDate = today;
            this.monthlyPlan.month = today.slice(0, 7);
          }
        }
        this.renderedDay = today;
      }
      root.empty();
      root.addClass("dashboard-home");
      this.renderHeader(root, { today: data?.today ?? moment().format("YYYY-MM-DD") });
      this.renderTabs(root);
      const content = root.createDiv({ cls: "dashboard-home__tab-content" });
      if (this.activeTab === "study") {
        this.studyTrackerRenderer ??= StudyTrackerView.createEmbedded(this.plugin);
        await this.studyTrackerRenderer.renderTo(content);
        return;
      }
      if (this.activeTab === "monthly") {
        this.renderMonthlyPlan(content);
        if (planDate) {
          const input = this.monthlyPlan.editDate(planDate);
          if (planSelection) input?.setSelectionRange(planSelection[0], planSelection[1]);
          this.monthlyPlan.updateTagSuggestions(planDate);
        }
        return;
      }
      if (!data) return;
      if (!this.plugin.settings.dailySetupComplete) {
        const setup = content.createDiv({cls: "daily-setup-banner"});
        setup.createEl("p", {text: "先连接已有日记，或确认新日记的保存位置。"});
        setup.createEl("button", {text: "设置日记位置"}).addEventListener("click", () => this.plugin.showDailySetup());
      }
      if (this.plugin.syncConflict) content.createEl("p", {text: "有同步冲突待处理。请到设置 → Daily → 数据管理选择版本。", attr: {role: "alert"}});
      this.renderQuickTask(content);
      if (restoreFocus) {
        const input = content.querySelector<HTMLInputElement>(".dashboard-home__quick-task input");
        input?.focus();
        if (selection !== null) input?.setSelectionRange(selection, selection);
      }
      const grid = content.createDiv({ cls: "dashboard-home__grid" });
      for (const panelId of normalizePanelOrder(this.plugin.settings.panelOrder).filter(
        (panelId) => panelId !== "study" && this.plugin.isPanelVisible(panelId),
      )) {
        if (version !== this.renderVersion || this.closed) return;
        await this.renderPanel(grid, data, panelId);
      }
    } catch (error) {
      if (version !== this.renderVersion || this.closed) return;
      new Notice(error instanceof Error ? error.message : "首页加载失败，请重试。");
      if (!root.children.length) {
        root.createEl("p", { text: "首页加载失败。" });
        root.createEl("button", { text: "重试" }).addEventListener("click", () => void this.render());
      }
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
  }

  private renderHeader(root: HTMLElement, data: Pick<DashboardData, "today">) {
    const header = root.createDiv({ cls: "dashboard-home__header" });
    const titleBlock = header.createDiv();
    titleBlock.createEl("p", {
      cls: "dashboard-home__eyebrow",
      text: moment(data.today, "YYYY-MM-DD", true).format("YYYY-MM-DD dddd"),
    });
    const titles: Record<DashboardTabId, string> = {
      home: this.plugin.settings.homeTitle,
      monthly: "月度计划",
      study: "学习打卡",
    };
    titleBlock.createEl("h1", { text: titles[this.activeTab] });

    const actions = header.createDiv({ cls: "dashboard-home__actions" });
    const openDaily = actions.createEl("button", { text: "打开今日笔记" });
    openDaily.addEventListener("click", async () => {
      const file = await this.plugin.ensureDailyNote();
      await this.plugin.openFile(file);
    });

    const refresh = actions.createEl("button", { text: "刷新" });
    refresh.addEventListener("click", () => this.plugin.refreshFromVault());
  }

  private renderTabs(root: HTMLElement) {
    const tabs = root.createDiv({ cls: "dashboard-home__tabs" });
    const tabItems: Array<{ id: DashboardTabId; label: string; }> = [
      { id: "home", label: "首页" },
      { id: "monthly", label: "月度计划" },
      ...(this.plugin.settings.studyEnabled ? [{ id: "study" as const, label: "学习打卡" }] : []),
    ];

    for (const tab of tabItems) {
      const button = tabs.createEl("button", {
        cls: tab.id === this.activeTab ? "is-active" : "",
        text: tab.label,
      });
      button.addEventListener("click", async () => {
        if (this.activeTab === "monthly") await this.monthlyPlan.flush();
        this.calendar.dispose();
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
    input.value = this.quickTaskDraft;
    input.addEventListener("input", () => { this.quickTaskDraft = input.value; });
    if (this.quickTaskCategory && !this.plugin.settings.taskCategories.includes(this.quickTaskCategory)) this.quickTaskCategory = undefined;
    const category = panel.createEl("select", { cls: "dashboard-home__quick-category", attr: { "aria-label": "新增待办标签" } });
    category.createEl("option", { text: "不添加标签", attr: { value: "" } });
    for (const name of this.plugin.settings.taskCategories) category.createEl("option", { text: name, attr: { value: name } });
    category.value = this.quickTaskCategory ?? this.plugin.settings.defaultTaskCategory;
    category.addEventListener("change", () => { this.quickTaskCategory = category.value; });
    const button = panel.createEl("button", { text: "添加" });
    button.disabled = this.submittingTask;
    const submit = async () => {
      if (this.submittingTask || !this.quickTaskDraft.trim()) return;
      this.submittingTask = true;
      button.disabled = true;
      const submitted = this.quickTaskDraft;
      try {
        await this.plugin.appendTaskToToday(submitted, category.value);
        if (this.quickTaskDraft === submitted) this.quickTaskDraft = "";
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "添加失败，请重试。");
      } finally {
        this.submittingTask = false;
        await this.render();
      }
    };
    button.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        submit();
      }
    });
  }

  private renderDaily(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "今日笔记", "is-daily", "daily", this, (actions) => {
      const button = actions.createEl("button", {
        text: data.todayFile ? "打开" : "创建",
      });
      button.addEventListener("click", async () => {
        const file = await this.plugin.ensureDailyNote();
        await this.plugin.openFile(file);
      });
    });

    if (!data.todayFile) {
      card.createEl("p", { cls: "dashboard-home__muted", text: "今天还没有笔记。" });
    } else {
      card.createEl("p", { cls: "dashboard-home__file-meta", text: data.today, attr: { title: data.todayFile.path } });
      const required = this.plugin.getDailyTemplateSections();
      if (required.some((heading) => !data.dailySections.some((section) => section.heading === heading))) {
        card.createEl("button", { cls: "dashboard-home__template-button", text: "补全今日模板" })
          .addEventListener("click", async () => {
            await this.plugin.completeDailyTemplate(data.todayFile!);
            await this.render();
          });
      }
      const taskHeading = this.plugin.settings.defaultTaskSection;
      const sections = data.dailySections.filter((section) => getSectionText(section));
      const taskSection = sections.find((section) => section.heading === taskHeading);
      const selected = this.plugin.settings.dailyPreviewSections;
      const previews = selected.length
        ? selected.flatMap((heading) => sections.filter((section) => section.heading === heading))
        : [...(taskSection ? [taskSection] : []), ...sections.filter((section) => section !== taskSection).slice(0, 2)];
      if (!previews.length) card.createEl("p", { cls: "dashboard-home__muted", text: "写下今天的待办或想法，这里会显示内容摘要。" });
      for (const section of previews) {
        const item = card.createDiv({ cls: "dashboard-home__daily-snippet" });
        item.createEl("strong", { text: section.heading === taskHeading ? "今日待办" : section.heading });
        item.createEl("p", { text: truncateText(getSectionText(section).replace(/^\s*[-*+]\s+\[([ xX-])\]\s+/gm, (_, state: string) => state.toLowerCase() === "x" ? "✓ " : "☐ "), 160) });
      }
    }
    this.renderRecentThoughts(card, data, true);
  }

  private renderRecentThoughts(root: HTMLElement, data: DashboardData, embedded = false) {
    const limit = this.plugin.settings.recentThoughtCount;
    if (limit === 0) return;
    const container = embedded
      ? root.createDiv({ cls: "dashboard-home__embedded-thoughts" })
      : createCard(root, "近期笔记", "is-thoughts");

    if (embedded) {
      container.createEl("h3", { text: "近期笔记" });
    }

    if (!data.recentThoughts.some((thought) => thought.date !== data.today)) {
      container.createEl("p", { cls: "dashboard-home__muted", text: "还没有想法。" });
      return;
    }

    for (const thought of data.recentThoughts.filter((thought) => thought.date !== data.today).slice(0, limit)) {
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
    const categoryOptions = getTagFilters([...data.tasks, ...data.completedTasks]);
    if (!categoryOptions.some((option) => option.id === this.todoCategory)) this.todoCategory = "all";
    const card = createCard(root, "待办事项", "is-todo", "todo", this, (actions) => {
      const filters = actions.createDiv({ cls: "dashboard-home__category-filter" });
      const select = filters.createEl("select", {
        cls: "dashboard-home__category-select",
        attr: { "aria-label": "待办标签" },
      });
      for (const category of categoryOptions) {
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

    const tasks = data.tasks.filter((task) => matchesTaskTags(task, this.todoCategory));

    if (tasks.length === 0) {
      card.createEl("p", {
        cls: "dashboard-home__muted",
        text: this.todoCategory === "all" ? "没有未完成 todo。" : "当前标签暂无未完成待办。",
      });
    }

    this.renderTaskGroups(card, tasks, data.today);
    const mode = this.plugin.settings.completedTaskDisplay;
    const completed = data.completedTasks.filter((task) => matchesTaskTags(task, this.todoCategory));
    if (mode !== "hide" && completed.length) {
      const done = card.createEl(mode === "collapsed" ? "details" : "div", { cls: "dashboard-home__completed-tasks" });
      if (mode === "collapsed") {
        (done as HTMLDetailsElement).open = this.completedTasksExpanded;
        done.addEventListener("toggle", () => { this.completedTasksExpanded = (done as HTMLDetailsElement).open; });
      }
      done.createEl(mode === "collapsed" ? "summary" : "h3", { text: `已完成 · ${completed.length}` });
      this.renderTaskGroups(done, completed, data.today);
    }
  }

  private renderTaskGroups(root: HTMLElement, tasks: DashboardTask[], today: string) {
    for (const group of groupDashboardTasks(tasks, today)) {
      const section = root.createDiv({ cls: `dashboard-home__task-group is-${group.id}` });
      section.createEl("h3", { text: `${group.label} · ${group.tasks.length}` });
      for (const task of group.tasks) {
        const taskKey = getTaskKey(task);
        const row = section.createDiv({ cls: `dashboard-home__task${task.done ? " is-done" : ""}` });
        row.setAttr("draggable", String(!task.done));
        row.setAttr("data-task-key", taskKey);
        if (!task.done) {
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
            const dragged = tasks.find((item) => getTaskKey(item) === draggedTaskKey);
            if (!dragged || getTaskDateGroup(dragged, today) !== group.id) {
              new Notice("请在同一日期分组内调整顺序。");
              return;
            }
            await this.plugin.moveTaskOrder(draggedTaskKey, taskKey);
          });
          row.addEventListener("dragend", () => {
            row.removeClass("is-dragging");
            root.querySelectorAll(".is-drop-target").forEach((element) => {
              element.removeClass("is-drop-target");
            });
          });
        }
        if (!task.done && group.tasks.length > 1) {
          const controls = row.createDiv({ cls: "daily-order-buttons" });
          const index = group.tasks.indexOf(task);
          for (const [label, offset] of [["上移", -1], ["下移", 1]] as const) {
            const button = controls.createEl("button", {text: offset < 0 ? "↑" : "↓", attr: {"aria-label": label + "：" + task.text}});
            button.disabled = !group.tasks[index + offset];
            button.addEventListener("click", async () => {
              try {
                if (offset < 0) await this.plugin.moveTaskOrder(taskKey, getTaskKey(group.tasks[index - 1]));
                else await this.plugin.moveTaskOrder(getTaskKey(group.tasks[index + 1]), taskKey);
                await this.render();
              } catch { new Notice("排序保存失败，请重试。"); }
            });
          }
        }
        const checkbox = row.createEl("input", {
          attr: { type: "checkbox", "aria-label": `${task.done ? "标记未完成" : "标记完成"}：${stripTaskMetadata(task.text)}` },
        });
        checkbox.checked = task.done;
        checkbox.addEventListener("change", async () => {
          await this.plugin.toggleTask(task);
          await this.render();
        });

        const body = row.createDiv({ cls: "dashboard-home__task-body" });
        renderTaskTitle(body, task.text, task.category, { onOpen: () => {
          if (task.source === "monthly-plan") {
            void this.openMonthlyPlan(task.monthlyPlanDate);
            return;
          }

          void this.plugin.openFile(task.file);
        } });
        if (task.invalidDate) body.createEl("small", { cls: "dashboard-home__date-warning", text: `日期无效：${task.invalidDate}，请在原笔记中修改。` });
        const date = task.due ?? task.dailyDate;
        if (date) body.createEl("small", { cls: "dashboard-home__task-date", text: date });
      }
    }

  }

  private renderStudy(root: HTMLElement, data: DashboardData) {
    const card = createCard(root, "学习打卡", "is-study", "study", this, (actions) => {
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
      text: `${totalCompleted}/${this.plugin.getStudyCourses().length} 节`,
    });
    summary.createDiv({
      cls: "dashboard-home__study-days",
      text: `${countByDate.size} 天有记录`,
    });

    const bar = card.createDiv({ cls: "dashboard-home__progress" });
    bar.createDiv({
      cls: "dashboard-home__progress-fill",
      attr: { style: `width: ${Math.round((totalCompleted / this.plugin.getStudyCourses().length) * 100)}%` },
    });

    const today = card.createDiv({ cls: "dashboard-home__study-today" });
    today.createEl("strong", { text: `${data.today} · 今日课程` });
    const todayLabels = new Set(todayCheckins.map((checkin) => checkin.courseId));
    for (const course of this.plugin.getStudyCourses()) {
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

  private renderMonthlyPlan(root: HTMLElement) { this.monthlyPlan.render(root); }

  private async renderCalendar(root: HTMLElement, data: DashboardData) { await this.calendar.render(root, data); }

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
