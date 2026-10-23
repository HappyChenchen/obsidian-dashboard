import { getWeekOffset, getWeekdayLabels } from "./preferences";
import { App, ItemView, Modal, Notice, WorkspaceLeaf, moment, setIcon } from "obsidian";
import { VIEW_TYPE_MONTHLY_DIARY } from "./constants";
import { stripTaskMetadata } from "./tasks";
import type { DashboardCategoryFilter, DailyMonthSummary, DashboardTask, MonthlyDiaryFilter } from "./types";
import { MONTHLY_DIARY_FILTERS } from "./constants";
import { getTagFilters, matchesTaskTags } from "./categories";
import { getSafeMonth, truncateText } from "./utils";
import { renderMonthlyTextBlock, renderMonthlyTodoLine } from "./view-utils";
import type DashboardPlugin from "./main";

export class MonthlyDiaryView extends ItemView {
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


    const summaries = await this.plugin.collectDailyMonthSummaries(
      month.format("YYYY-MM"),
    );
    this.renderHeader(panel, month, summaries);
    const summaryByDate = new Map(summaries.map((summary) => [summary.date, summary]));
    this.renderGrid(panel, month, summaryByDate);
  }

  private renderHeader(root: HTMLElement, month: moment.Moment, summaries: DailyMonthSummary[]) {
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
    const categoryOptions = getTagFilters(summaries.flatMap((summary) => summary.todos));
    if (!categoryOptions.some((option) => option.id === this.category)) this.category = "all";
    for (const category of categoryOptions) {
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
    for (const dayName of getWeekdayLabels(this.plugin.settings.weekStartsOn)) {
      grid.createDiv({
        cls: "dashboard-monthly-panel__weekday",
        text: dayName,
      });
    }

    const firstDay = month.clone().startOf("month");
    for (let index = 0;index < getWeekOffset(firstDay.day(), this.plugin.settings.weekStartsOn);index += 1) {
      grid.createDiv({ cls: "dashboard-monthly-panel__empty" });
    }

    const today = moment().format("YYYY-MM-DD");
    for (let day = 1;day <= month.daysInMonth();day += 1) {
      const date = month.clone().date(day).format("YYYY-MM-DD");
      const summary = summaryByDate.get(date);
      const visibleTodos = summary ? this.getVisibleTodos(summary) : [];

      const hasContent = Boolean(
        summary?.file ||
        visibleTodos.length ||
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

      const addTodo = cell.createEl("button", {
        cls: "dashboard-monthly-panel__add-todo",
        attr: {
          "aria-label": `${date} 新增 Todo`,
          title: "新增 Todo",
        },
      });
      setIcon(addTodo, "plus");
      addTodo.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        new AddMonthlyTodoModal(this.plugin.app, this.plugin, date, async () => {
          await this.render();
        }).open();
      });
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
    if (!todos.length) return;
    const totalCount = todos.length;
    const openCount = todos.filter((task) => !task.done).length;
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


  }

  private getVisibleTodos(summary: DailyMonthSummary): DashboardTask[] {
    return summary.todos.filter((task) => matchesTaskTags(task, this.category));
  }


}

export class AddMonthlyTodoModal extends Modal {
  private plugin: DashboardPlugin;
  private date: string;
  private onSaved: () => Promise<void>;

  constructor(
    app: App,
    plugin: DashboardPlugin,
    date: string,
    onSaved: () => Promise<void>,
  ) {
    super(app);
    this.plugin = plugin;
    this.date = date;
    this.onSaved = onSaved;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("dashboard-add-todo-modal");
    contentEl.createEl("h2", { text: `${this.date} 新增 Todo` });

    const categoryField = contentEl.createDiv({
      cls: "dashboard-add-todo-modal__field",
    });
    categoryField.createEl("label", { text: "常用标签" });
    const category = contentEl.createEl("select", {
      cls: "dashboard-add-todo-modal__category",
      attr: { "aria-label": "待办标签" },
    });
    categoryField.appendChild(category);
    category.createEl("option", {
      text: "不添加标签",
      attr: { value: "" },
    });
    for (const item of this.plugin.settings.taskCategories) {
      category.createEl("option", {
        text: item,
        attr: { value: item },
      });
    }

    category.value = this.plugin.settings.defaultTaskCategory;

    const inputField = contentEl.createDiv({
      cls: "dashboard-add-todo-modal__field",
    });
    inputField.createEl("label", { text: "内容" });
    const input = contentEl.createEl("input", {
      cls: "dashboard-add-todo-modal__input",
      attr: {
        type: "text",
        placeholder: "填写 Todo 内容",
      },
    });
    inputField.appendChild(input);

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const submit = actions.createEl("button", {
      cls: "mod-cta",
      text: "添加",
    });
    submit.disabled = true;

    let saving = false;
    const updateState = () => { submit.disabled = saving || !input.value.trim(); };
    category.addEventListener("change", () => {
      updateState();
      if (category.value) {
        input.focus();
      }
    });
    input.addEventListener("input", updateState);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing && !submit.disabled) {
        event.preventDefault();
        void submitTodo();
      }
    });

    const submitTodo = async () => {
      if (saving || !input.value.trim()) return;
      saving = true;
      updateState();
      try {
        await this.plugin.appendTaskToDate(this.date, input.value, category.value);
        await this.onSaved();
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "添加失败，请重试。");
      } finally {
        saving = false;
        updateState();
      }
    };
    submit.addEventListener("click", submitTodo);
  }
}
