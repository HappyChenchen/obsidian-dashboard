import { moment, setIcon } from "obsidian";
import type DashboardPlugin from "./main";
import type { DashboardView } from "./dashboard-view";
import type { DashboardData } from "./types";
import { createCard, renderTaskTitle } from "./view-utils";
import { getSafeMonth } from "./utils";
import { stripTaskMetadata } from "./tasks";
import { getWeekOffset, getWeekdayLabels } from "./preferences";

export class CalendarPanel {
  month = moment().format("YYYY-MM");
  selectedDate = moment().format("YYYY-MM-DD");
  private clickTimer?: number;
  constructor(private plugin: DashboardPlugin, private owner: DashboardView, private onChange: () => Promise<void>, private openMonthlyPlan: (date: string) => void) { }
  dispose() { window.clearTimeout(this.clickTimer); }
  async render(root: HTMLElement, data: DashboardData) {
    const month = getSafeMonth(this.month);
    const card = createCard(root, "日历", "is-calendar", "calendar", this.owner, (actions) => {
      const navigation = actions.createDiv({
        cls: "dashboard-home__calendar-navigation",
      });
      const previous = navigation.createEl("button", {
        cls: "dashboard-home__calendar-nav-button",
        attr: {
          "aria-label": "上月",
          title: "上月",
        },
      });
      setIcon(previous, "chevron-left");
      previous.addEventListener("click", (event) => {
        event.stopPropagation();
        window.clearTimeout(this.clickTimer);
        this.month = month.clone().subtract(1, "month").format("YYYY-MM");
        this.selectedDate = getSafeMonth(this.month)
          .startOf("month")
          .format("YYYY-MM-DD");
        void this.onChange();
      });

      navigation.createEl("span", {
        cls: "dashboard-home__calendar-month",
        text: month.format("YYYY年M月"),
      });

      const next = navigation.createEl("button", {
        cls: "dashboard-home__calendar-nav-button",
        attr: {
          "aria-label": "下月",
          title: "下月",
        },
      });
      setIcon(next, "chevron-right");
      next.addEventListener("click", (event) => {
        event.stopPropagation();
        window.clearTimeout(this.clickTimer);
        this.month = month.clone().add(1, "month").format("YYYY-MM");
        this.selectedDate = getSafeMonth(this.month)
          .startOf("month")
          .format("YYYY-MM-DD");
        void this.onChange();
      });

      const current = actions.createEl("button", {
        cls: "dashboard-home__calendar-current",
        text: "本月",
      });
      current.addEventListener("click", (event) => {
        event.stopPropagation();
        window.clearTimeout(this.clickTimer);
        this.month = moment().format("YYYY-MM");
        this.selectedDate = moment().format("YYYY-MM-DD");
        void this.onChange();
      });

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
    const firstDay = month.clone().startOf("month");
    const offset = getWeekOffset(firstDay.day(), this.plugin.settings.weekStartsOn);
    const today = moment().format("YYYY-MM-DD");

    const calendar = card.createDiv({ cls: "dashboard-home__calendar" });
    for (const dayName of getWeekdayLabels(this.plugin.settings.weekStartsOn, ["S", "M", "T", "W", "T", "F", "S"])) {
      calendar.createDiv({ cls: "dashboard-home__calendar-weekday", text: dayName });
    }

    for (let index = 0;index < offset;index += 1) {
      calendar.createDiv({ cls: "dashboard-home__calendar-empty", attr: { "aria-hidden": "true" } });
    }

    for (let index = 0;index < month.daysInMonth();index += 1) {
      const day = firstDay.clone().add(index, "days");
      const iso = day.format("YYYY-MM-DD");
      const dayTasks = data.calendarTasks.get(iso);
      const status = dayTasks
        ? `${dayTasks.pending} 项未完成，${dayTasks.completed} 项已完成`
        : "暂无待办";
      const cell = calendar.createDiv({
        cls: [
          "dashboard-home__calendar-day",
          iso === today ? "is-today" : "",
          iso === this.selectedDate ? "is-selected" : "",
          data.dailyDates.has(iso) ? "has-daily" : "",
          dayTasks ? "has-tasks" : "",
        ].join(" "),
        attr: {
          role: "button",
          tabindex: "0",
          "aria-label": `${iso}，${status}`,
          "aria-pressed": String(iso === this.selectedDate),
        },
      });
      cell.createEl("span", { text: day.format("D") });
      const markers = cell.createDiv({
        cls: "dashboard-home__calendar-markers",
        attr: { "aria-hidden": "true" },
      });
      if (dayTasks?.pending) {
        markers.createEl("span", { cls: "is-pending", text: "●" });
      } else if (dayTasks?.completed) {
        markers.createEl("span", { cls: "is-completed", text: "✓" });
      }
      cell.setAttr(
        "title",
        `${iso}：${status}\n单击查看待办，双击${data.dailyDates.has(iso) ? "打开" : "创建"}当日笔记`,
      );
      cell.addEventListener("click", () => {
        window.clearTimeout(this.clickTimer);
        this.clickTimer = window.setTimeout(async () => {
          this.selectedDate = iso;
          await this.onChange();
        }, 220);
      });
      cell.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        window.clearTimeout(this.clickTimer);
        this.selectedDate = iso;
        void this.onChange();
      });
      cell.addEventListener("dblclick", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.clearTimeout(this.clickTimer);
        const file = await this.plugin.ensureDailyNote(iso);
        await this.plugin.openFile(file);
      });
    }

    const legend = card.createDiv({ cls: "dashboard-home__calendar-legend" });
    const pendingLegend = legend.createEl("span");
    pendingLegend.createEl("span", { cls: "is-pending", text: "●", attr: { "aria-hidden": "true" } });
    pendingLegend.createEl("span", { text: "未完成" });
    const completedLegend = legend.createEl("span");
    completedLegend.createEl("span", { cls: "is-completed", text: "✓", attr: { "aria-hidden": "true" } });
    completedLegend.createEl("span", { text: "全部完成" });

    const todoPanel = card.createDiv({ cls: "dashboard-home__calendar-todos" });
    todoPanel.createEl("h3", { text: `${this.selectedDate} · 待办` });

    const selectedTasks = data.calendarTasks.get(this.selectedDate);
    const dateTodos = selectedTasks?.tasks ?? [];
    if (dateTodos.length === 0) {
      todoPanel.createEl("p", { cls: "dashboard-home__muted", text: "当天暂无待办" });
      return;
    }
    todoPanel.createEl("p", {
      cls: "dashboard-home__calendar-summary",
      text: `未完成 ${selectedTasks!.pending} · 已完成 ${selectedTasks!.completed}`,
    });

    for (const task of dateTodos) {
      const row = todoPanel.createDiv({ cls: `dashboard-home__calendar-todo${task.done ? " is-done" : ""}` });
      const checkbox = row.createEl("input", {
        attr: { type: "checkbox", "aria-label": `${task.done ? "标记未完成" : "标记完成"}：${stripTaskMetadata(task.text)}` },
      });
      checkbox.checked = task.done;
      checkbox.addEventListener("change", async () => {
        await this.plugin.toggleTask(task);
        await this.onChange();
      });
      const body = row.createDiv({ cls: "dashboard-home__calendar-todo-body" });
      renderTaskTitle(body, task.text, task.category, { onOpen: () => {
        if (task.source === "monthly-plan") {
          this.openMonthlyPlan(task.monthlyPlanDate);
        } else {
          void this.plugin.openFile(task.file);
        }
      } });
    }
  }
}
