import { getWeekOffset, getWeekdayLabels } from "./preferences";
import { Notice, moment } from "obsidian";
import type DashboardPlugin from "./main";
import { getSafeMonth } from "./utils";
import { renderTaskTitle } from "./view-utils";
import { getTaskTags } from "./categories";
import { TagSuggestions, type TagSuggestionState } from "./tag-suggestions";

export interface MonthlyPlanDraft {
  text: string;
  baseText?: string;
  version: number;
  revision: number;
  status: "pending" | "saving" | "error";
  saving?: Promise<void>;
}

export class MonthlyPlanPanel {
  isComposing = false;
  private timers = new Map<string, number>();
  private statusElements = new Map<string, HTMLElement>();
  private dayElements = new Map<string, { cell: HTMLElement; marker: HTMLElement }>();
  private editors = new Map<string, { input: HTMLTextAreaElement; preview: HTMLElement; suggestions: TagSuggestions }>();
  private editingDate?: string;
  private tagSuggestionState: TagSuggestionState = {};

  async dispose() {
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
    await this.flush();
    this.statusElements.clear();
    this.dayElements.clear();
    this.editors.clear();
  }

  async flush() {
    await Promise.all([...this.plugin.monthlyPlanDrafts.keys()].map((date) => this.saveDraft(date)));
  }

  private showStatus(date: string, saved = false) {
    const day = this.dayElements.get(date);
    if (day) {
      const tasks = this.plugin.getMonthlyPlanTasks(date);
      const hasPlan = tasks.length > 0;
      const done = hasPlan && tasks.every((task) => task.done);
      if (hasPlan) day.cell.addClass("has-plan"); else day.cell.removeClass("has-plan");
      day.marker.setText(hasPlan ? done ? "✓" : "●" : "");
      day.marker.setAttr("class", `dashboard-monthly-plan__marker ${done ? "is-completed" : "is-pending"}`);
      day.marker.setAttr("aria-label", hasPlan ? done ? "计划已完成" : "计划未完成" : "暂无计划");
    }
    const element = this.statusElements.get(date);
    if (!element) return;
    element.empty();
    const draft = this.plugin.monthlyPlanDrafts.get(date);
    element.createEl("span", { text: draft?.status === "error" ? "保存失败" : draft ? "保存中…" : saved ? "已保存" : "" });
    if (draft?.status === "error") {
      element.createEl("button", { text: "重试", attr: { "aria-label": date + " 重新保存" } })
        .addEventListener("click", () => this.saveDraft(date));
    }
  }

  private editDraft(date: string, text: string, revision: number) {
    if (revision !== this.plugin.archiveRevision) return;
    const draft = this.plugin.monthlyPlanDrafts.get(date);
    if (draft) {
      draft.text = text; draft.version += 1; draft.status = "pending";
    } else {
      this.plugin.monthlyPlanDrafts.set(date, { text, baseText: this.plugin.settings.monthlyPlan[date] ?? "", revision, version: 1, status: "pending" });
    }
    window.clearTimeout(this.timers.get(date));
    this.timers.set(date, window.setTimeout(() => { void this.saveDraft(date); }, 350));
    this.showStatus(date);
  }

  private async saveDraft(date: string): Promise<void> {
    window.clearTimeout(this.timers.get(date));
    this.timers.delete(date);
    const draft = this.plugin.monthlyPlanDrafts.get(date);
    if (!draft || draft.revision !== this.plugin.archiveRevision) return;
    if (draft.saving) {
      await draft.saving;
      if (this.plugin.monthlyPlanDrafts.get(date) === draft && draft.status !== "error") await this.saveDraft(date);
      return;
    }
    const version = draft.version;
    draft.status = "saving";
    this.showStatus(date);
    draft.saving = (async () => {
      try {
        await this.plugin.saveMonthlyPlan(date, draft.text, draft.revision, draft.baseText);
        draft.baseText = this.plugin.settings.monthlyPlan[date] ?? "";
        if (draft.version === version && this.plugin.monthlyPlanDrafts.get(date) === draft) {
          this.plugin.monthlyPlanDrafts.delete(date);
        }
      } catch {
        if (draft.version === version) {
          draft.status = "error";
          new Notice(date + " 计划保存失败，输入已保留，可点击重试。");
        }
      } finally {
        draft.saving = undefined;
        this.showStatus(date, true);
        const editor = this.editors.get(date);
        if (editor?.input.hidden) this.renderPreview(editor.preview, editor.input.value, date);
      }
    })();
    await draft.saving;
    // A newer edit arrived while the disk write was in flight.
    if (draft.version !== version && this.plugin.monthlyPlanDrafts.get(date) === draft) await this.saveDraft(date);
  }

  month = moment().format("YYYY-MM");
  selectedDate = moment().format("YYYY-MM-DD");
  constructor(private plugin: DashboardPlugin, private onChange: () => Promise<void>, private onSelectDate: (date: string) => void) { }

  private selectDate(date: string) {
    this.selectedDate = date;
    this.month = date.slice(0, 7);
    for (const [day, { cell }] of this.dayElements) {
      if (day === date) cell.addClass("is-selected"); else cell.removeClass("is-selected");
    }
    this.onSelectDate(date);
  }

  editDate(date: string): HTMLTextAreaElement | undefined {
    const editor = this.editors.get(date);
    if (!editor) return;
    this.editingDate = date;
    this.selectDate(date);
    editor.preview.hidden = true;
    editor.input.hidden = false;
    editor.input.focus();
    return editor.input;
  }

  private renderPreview(preview: HTMLElement, text: string, date: string) {
    preview.empty();
    if (text.trim()) {
      const tasks = this.plugin.getMonthlyPlanTasks(date);
      text.split(/\r?\n/).filter((line) => line.trim()).forEach((line, index) => {
        const row = preview.createDiv({ cls: "daily-plan-item" });
        const task = tasks[index];
        const checkbox = row.createEl("input", {attr: {type: "checkbox", "aria-label": `${date} 完成：${line}`}});
        checkbox.checked = Boolean(task?.done);
        checkbox.disabled = Boolean(this.plugin.monthlyPlanDrafts.get(date)) || task?.text !== line.trim();
        checkbox.addEventListener("click", (event) => event.stopPropagation());
        checkbox.addEventListener("change", async () => {
          checkbox.disabled = true;
          if (task) await this.plugin.toggleTask(task);
          await this.onChange();
        });
        const body = row.createDiv();
        if (task?.done) row.addClass("is-done");
        renderTaskTitle(body, line, undefined, { stripDates: false, onOpen: () => this.editDate(date) });
      });
    } else {
      preview.createEl("span", { cls: "dashboard-monthly-plan__placeholder", text: "写计划… #标签" });
    }
  }

  updateTagSuggestions(date: string) {
    if (!this.isComposing) this.editors.get(date)?.suggestions.update();
  }

  private getTagCandidates(editingDate: string): string[] {
    const plans = { ...this.plugin.settings.monthlyPlan };
    for (const [date, draft] of this.plugin.monthlyPlanDrafts) plans[date] = draft.text;
    delete plans[editingDate];
    return [
      ...this.plugin.settings.taskCategories,
      ...Object.values(this.plugin.settings.monthlyPlanCategory),
      ...Object.values(plans).flatMap((text) => getTaskTags(text).map((tag) => tag.slice(1))),
    ];
  }

  render(root: HTMLElement) {
    const archiveRevision = this.plugin.archiveRevision;
    this.statusElements.clear();
    this.dayElements.clear();
    this.editors.clear();
    if (this.editingDate?.slice(0, 7) !== this.month) this.editingDate = undefined;
    const panel = root.createDiv({ cls: "dashboard-monthly-plan" });
    const month = getSafeMonth(this.month);
    const header = panel.createDiv({ cls: "dashboard-monthly-plan__header" });
    const title = header.createDiv();
    title.createEl("p", {
      cls: "dashboard-monthly-plan__eyebrow",
      text: "MONTHLY PLAN",
    });
    title.createEl("h2", { text: month.format("YYYY 年 M 月") });
    title.createEl("p", {
      cls: "dashboard-monthly-plan__hint",
      text: "每行一项计划，输入 # 选择标签。内容自动保存，可分别勾选完成。",
    });

    const navigation = header.createDiv({ cls: "dashboard-monthly-plan__nav" });
    const previous = navigation.createEl("button", { text: "上月" });
    previous.addEventListener("click", () => {
      this.selectDate(month.clone().subtract(1, "month").startOf("month").format("YYYY-MM-DD"));
      void this.onChange();
    });
    const current = navigation.createEl("button", { text: "本月" });
    current.addEventListener("click", () => {
      this.selectDate(moment().format("YYYY-MM-DD"));
      void this.onChange();
    });
    const next = navigation.createEl("button", { text: "下月" });
    next.addEventListener("click", () => {
      this.selectDate(month.clone().add(1, "month").startOf("month").format("YYYY-MM-DD"));
      void this.onChange();
    });

    const grid = panel.createDiv({ cls: "dashboard-monthly-plan__grid" });
    for (const dayName of getWeekdayLabels(this.plugin.settings.weekStartsOn)) {
      grid.createDiv({ cls: "dashboard-monthly-plan__weekday", text: dayName });
    }

    const firstDay = month.clone().startOf("month");
    const weekCount = Math.ceil((getWeekOffset(firstDay.day(), this.plugin.settings.weekStartsOn) + month.daysInMonth()) / 7);
    grid.setAttr(
      "style",
      `grid-template-rows: 24px repeat(${weekCount}, minmax(96px, auto));`,
    );
    for (let index = 0;index < getWeekOffset(firstDay.day(), this.plugin.settings.weekStartsOn);index += 1) {
      grid.createDiv({ cls: "dashboard-monthly-plan__empty" });
    }

    const today = moment().format("YYYY-MM-DD");
    for (let day = 1;day <= month.daysInMonth();day += 1) {
      const date = month.clone().date(day).format("YYYY-MM-DD");
      const cell = grid.createDiv({
        cls: [
          "dashboard-monthly-plan__day",
          date === today ? "is-today" : "",
          date === this.selectedDate ? "is-selected" : "",
          this.plugin.settings.monthlyPlan[date] ? "has-plan" : "",
        ].filter(Boolean).join(" "),
      });
      const heading = cell.createDiv({ cls: "dashboard-monthly-plan__day-header" });
      heading.createEl("strong", { text: String(day).padStart(2, "0") });
      heading.createEl("button", {text: "编辑", attr: {"aria-label": `${date} 编辑事项`}})
        .addEventListener("click", () => this.editDate(date));
      const marker = heading.createEl("span");
      this.dayElements.set(date, { cell, marker });
      const draft = this.plugin.monthlyPlanDrafts.get(date);
      const preview = cell.createDiv({
        cls: "dashboard-monthly-plan__preview",
        attr: { role: "group", tabindex: "0", "aria-label": `${date} 编辑计划` },
      });
      const input = cell.createEl("textarea", {
        cls: "dashboard-monthly-plan__input",
        attr: { placeholder: "写计划… #标签", rows: "3", "aria-label": `${date} 计划`, "data-plan-date": date },
      });
      input.value = draft?.text ?? this.plugin.getMonthlyPlanText(date);
      const suggestions = new TagSuggestions(input, cell, date, () => this.getTagCandidates(date),
        () => this.editDraft(date, input.value, archiveRevision), this.tagSuggestionState);
      this.editors.set(date, { input, preview, suggestions });
      this.renderPreview(preview, input.value, date);
      input.hidden = this.editingDate !== date;
      preview.hidden = !input.hidden;
      preview.addEventListener("click", () => this.editDate(date));
      preview.addEventListener("keydown", (event) => {
        if (event.target && event.target !== preview) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.editDate(date);
      });
      const edit = () => {
        this.editDraft(date, input.value, archiveRevision);
        if (!this.isComposing) suggestions.update();
      };
      input.addEventListener("input", edit);
      input.addEventListener("compositionstart", () => { this.isComposing = true; suggestions.close(); });
      input.addEventListener("compositionend", () => { this.isComposing = false; edit(); });
      input.addEventListener("focus", () => this.selectDate(date));
      input.addEventListener("click", () => this.updateTagSuggestions(date));
      input.addEventListener("keydown", (event) => { if (!this.isComposing) suggestions.keydown(event); });
      input.addEventListener("keyup", (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) this.updateTagSuggestions(date);
      });
      input.addEventListener("blur", () => {
        suggestions.close();
        if (this.editingDate === date) this.editingDate = undefined;
        this.renderPreview(preview, input.value, date);
        input.hidden = true;
        preview.hidden = false;
        return this.saveDraft(date);
      });
      const status = cell.createDiv({ cls: "dashboard-monthly-plan__save-status" });
      status.setAttr("role", "status");
      status.setAttr("aria-live", "polite");
      this.statusElements.set(date, status);
      this.showStatus(date, Boolean(this.plugin.settings.monthlyPlan[date]));
    }

  }
}
