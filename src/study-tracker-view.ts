import { getWeekOffset, getWeekdayLabels } from "./preferences";
import { ItemView, WorkspaceLeaf, moment } from "obsidian";
import { VIEW_TYPE_STUDY_TRACKER } from "./constants";
import { getStudyCheckinCountByDate, getStudyCheckinsForDate, getStudyCourse, normalizeStudyCheckins } from "./study";
import type { StudyCheckin, StudyTrackerMode } from "./types";
import type DashboardPlugin from "./main";

export class StudyTrackerView extends ItemView {
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
    return "学习打卡";
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
    if (!this.plugin.settings.studyEnabled) {
      panel.createEl("p", { text: "学习打卡已关闭，可在首页设置中开启。" });
      return;
    }
    const courseIds = new Set(this.plugin.getStudyCourses().map((course) => course.id));
    const checkins = normalizeStudyCheckins(this.plugin.settings.studyCheckins).filter((item) => courseIds.has(item.courseId));
    if (!courseIds.size) {
      panel.createEl("p", { text: "请先在首页设置中添加学习课程。" });
      return;
    }
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
      text: `${new Set(checkins.map((item) => item.courseId)).size}/${this.plugin.getStudyCourses().length} 节已学 · ${checkins.length} 次打卡 · ${checkinCountByDate.size} 天有记录`,
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
    const weekCount = Math.ceil((getWeekOffset(firstDay.day(), this.plugin.settings.weekStartsOn) + this.cursor.daysInMonth()) / 7);
    calendar.setAttr(
      "style",
      `grid-template-rows: 22px repeat(${weekCount}, minmax(88px, auto));`,
    );
    for (let index = 0;index < getWeekOffset(firstDay.day(), this.plugin.settings.weekStartsOn);index += 1) {
      calendar.createDiv({ cls: "dashboard-study-calendar__empty" });
    }

    for (let day = 1;day <= this.cursor.daysInMonth();day += 1) {
      const date = this.cursor.clone().date(day).format("YYYY-MM-DD");
      this.renderDayCell(calendar, date, String(day), checkinCountByDate.get(date) ?? 0);
    }
  }

  private renderYear(root: HTMLElement, checkinCountByDate: Map<string, number>) {
    const yearGrid = root.createDiv({ cls: "dashboard-study-year" });
    for (let month = 0;month < 12;month += 1) {
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
      for (let index = 0;index < getWeekOffset(monthMoment.day(), this.plugin.settings.weekStartsOn);index += 1) {
        calendar.createDiv({ cls: "dashboard-study-calendar__empty" });
      }
      for (let day = 1;day <= monthMoment.daysInMonth();day += 1) {
        const date = monthMoment.clone().date(day).format("YYYY-MM-DD");
        this.renderDayCell(calendar, date, String(day), checkinCountByDate.get(date) ?? 0, true);
      }
    }
  }

  private renderWeekdays(root: HTMLElement, compact = false) {
    for (const dayName of getWeekdayLabels(this.plugin.settings.weekStartsOn)) {
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
          .map((checkin) => getStudyCourse(checkin.courseId, this.plugin.getStudyCourses())?.label)
          .filter((label): label is string => Boolean(label));
        cell.createDiv({
          cls: "dashboard-study-calendar__labels",
          text: labels.slice(0, 3).join(" · ") + (labels.length > 3 ? " …" : ""),
        });
      }
      cell.setAttr("title", `${date} · ${count} 节：${getStudyCheckinsForDate(this.plugin.settings.studyCheckins, date).map((checkin) => getStudyCourse(checkin.courseId, this.plugin.getStudyCourses())?.label).filter(Boolean).join("、")}`);
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
      text: `${selectedCheckins.length}/${this.plugin.getStudyCourses().length}`,
    });

    const courseGrid = selected.createDiv({ cls: "dashboard-study-courses" });
    for (const module of Array.from(new Set(this.plugin.getStudyCourses().map((course) => course.module)))) {
      const moduleCourses = this.plugin.getStudyCourses().filter((course) => course.module === module);
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
