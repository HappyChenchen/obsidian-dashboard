import { App, Modal, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import { DEFAULT_SETTINGS } from "./constants";
import { parseTaskCategories } from "./categories";
import { parseStudyCourses } from "./study";
import { parseSectionNames, parseTaskFolders } from "./preferences";
import type { DashboardSettings } from "./types";
import type DashboardPlugin from "./main";
import { BackupManagerModal } from "./backup-modal";

export class ClearArchiveModal extends Modal {
  constructor(app: App, private plugin: DashboardPlugin) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "清除存档" });
    contentEl.createEl("p", { text: "将清空当前笔记库中 Daily 保存的以下记录：" });
    const settings = this.plugin.settings;
    const list = contentEl.createEl("ul");
    list.createEl("li", { text: `月度计划：${Object.keys(settings.monthlyPlan).length} 天，以及对应的分类和完成状态` });
    list.createEl("li", { text: `学习打卡：${settings.studyCheckins.length} 条` });
    list.createEl("li", { text: `待办排序：${settings.taskOrder.length} 条` });
    contentEl.createEl("p", { text: "笔记、附件、笔记中的待办、课程配置和首页设置都会保留。笔记里的待办仍会显示在日历和列表中。" });
    contentEl.createEl("p", { text: "清除前会自动备份，可通过“备份与恢复”找回。请确认这些记录已不再需要。" });
    const errorText = contentEl.createEl("p", { attr: { role: "alert" } });
    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { cls: "mod-warning", text: "确认清除存档" });
    confirm.addEventListener("click", async () => {
      if (confirm.disabled) return;
      confirm.disabled = true;
      cancel.disabled = true;
      confirm.setText("正在清除…");
      errorText.setText("");
      try {
        await this.plugin.clearArchive();
        new Notice("存档已清除，笔记和设置已保留。");
        this.close();
      } catch {
        errorText.setText("存档保存失败，未完成清除。请检查笔记库是否可写后重试。");
        confirm.disabled = false;
        cancel.disabled = false;
        confirm.setText("重试清除");
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class DashboardSettingTab extends PluginSettingTab {
  plugin: DashboardPlugin;
  private activeSection = "home";
  private navigation!: HTMLElement;
  private sections = new Map<string, { tab: HTMLButtonElement; panel: HTMLElement; }>();

  constructor(app: App, plugin: DashboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("daily-settings");
    this.sections.clear();
    const header = containerEl.createDiv({ cls: "daily-settings__header" });
    const mark = header.createDiv({ cls: "daily-settings__mark", attr: { "aria-hidden": "true" } });
    setIcon(mark, "sun");
    const intro = header.createDiv({ cls: "daily-settings__intro" });
    const title = intro.createDiv({ cls: "daily-settings__title" });
    title.createEl("h2", { text: "Daily" });
    title.createEl("span", { text: "设置", cls: "daily-settings__label" });
    intro.createEl("p", { text: "让首页、日记与待办，贴合你的习惯。" });
    this.navigation = containerEl.createDiv({ cls: "daily-settings__nav", attr: { role: "tablist", "aria-label": "设置分类" } });
    const content = containerEl.createDiv({ cls: "daily-settings__content" });
    const settings = this.plugin.settings;
    const home = this.createGroup(content, "home", "首页", "调整首页的显示内容，开启你需要的功能。", "house");
    let homeTitle = settings.homeTitle;
    let recentThoughtCount = settings.recentThoughtCount;
    new Setting(home).setName("首页标题").setDesc("留空使用“今天”。")
      .addText((text) => text.setValue(homeTitle).setPlaceholder("今天").onChange((value) => { homeTitle = value; }));
    new Setting(home).setName("最近记录数量").setDesc("显示近期日记中的想法摘要。")
      .addDropdown((select) => select.addOptions({ "0": "关闭", "3": "3 条", "5": "5 条", "10": "10 条" })
        .setValue(String(recentThoughtCount)).onChange((value) => { recentThoughtCount = Number(value); }));
    this.saveButton(home, "保存首页显示", () => this.plugin.savePreferences({ homeTitle, recentThoughtCount }));
    this.subheading(home, "打开与显示");
    new Setting(home).setName("启动时打开首页").setDesc("打开笔记库时，自动进入 Daily。")
      .addToggle((toggle) => toggle.setValue(settings.openOnStartup).onChange(async (value) => {
        try { await this.plugin.saveSetting("openOnStartup", value); }
        catch { toggle.setValue(this.plugin.settings.openOnStartup); new Notice("保存失败，请重试。"); }
      }));
    const library = home.createDiv();
    new Setting(library).setName("显示资料库面板").setDesc("显示文章和书籍。开启后可配置目录。")
      .addToggle((toggle) => toggle.setValue(this.plugin.isPanelVisible("database")).onChange(async (value) => {
        try {
          await this.plugin.setPanelVisibility("database", value);
          libraryFields.style.display = value ? "" : "none";
        } catch { toggle.setValue(this.plugin.isPanelVisible("database")); new Notice("保存失败，请重试。"); }
      }));
    const libraryFields = library.createDiv({ cls: "daily-settings__nested" });
    libraryFields.style.display = this.plugin.isPanelVisible("database") ? "" : "none";
    this.savedText(libraryFields, "文章文件夹", "笔记库内的文章目录。", "articleFolder", "Library/Articles");
    this.savedText(libraryFields, "书籍文件夹", "笔记库内的读书笔记目录。", "bookFolder", "Library/Books");
    new Setting(home).setName("启用学习打卡").setDesc("开启后可配置课程。")
      .addToggle((toggle) => toggle.setValue(settings.studyEnabled).onChange(async (value) => {
        try {
          await this.plugin.saveSetting("studyEnabled", value);
          courses.style.display = value ? "" : "none";
        } catch { toggle.setValue(this.plugin.settings.studyEnabled); new Notice("保存失败，请重试。"); }
      }));
    const courses = home.createDiv({ cls: "daily-settings__nested" });
    courses.style.display = settings.studyEnabled ? "" : "none";
    let courseDraft = settings.studyCourses.map((course) => course.module + " | " + course.label).join("\n");
    new Setting(courses).setName("学习课程").setDesc("每行一项：分组 | 课程名称。改名或移除后，历史打卡仍保留。")
      .addTextArea((text) => text.setPlaceholder("阅读 | 示例书第 1 章\n语言 | 口语练习").setValue(courseDraft)
        .onChange((value) => { courseDraft = value; }));
    this.saveButton(courses, "保存课程", () => this.plugin.saveSetting("studyCourses", parseStudyCourses(courseDraft, this.plugin.settings.studyCourses)));

    const daily = this.createGroup(content, "daily", "日记", "接入已有的日记目录，选择需要展示的内容。", "notebook-pen");
    this.subheading(daily, "文件位置");
    new Setting(daily).setName("日记位置").setDesc(`${settings.dailyFolder || "笔记库根目录"} · ${settings.dailyDateFormat}`)
      .addButton((button) => button.setButtonText("连接或调整日记").onClick(async () => { await this.plugin.showDailySetup(); this.display(); }));
    this.subheading(daily, "章节与摘要");
    let taskHeading = settings.defaultTaskSection;
    let thoughtHeading = settings.thoughtSection;
    let previewHeadings = settings.dailyPreviewSections.join("\n");
    new Setting(daily).setName("待办章节名称").setDesc("新增待办写入此二级标题；修改名称不会改写已有笔记。")
      .addText((text) => text.setValue(taskHeading).setPlaceholder("今日todo").onChange((value) => { taskHeading = value; }));
    new Setting(daily).setName("想法章节名称").setDesc("用于新日记模板、最近记录和月度日记；旧的想法/思考、灵感、今日灵感仍会识别。")
      .addText((text) => text.setValue(thoughtHeading).setPlaceholder("想法/思考").onChange((value) => { thoughtHeading = value; }));
    new Setting(daily).setName("首页展示的日记章节").setDesc("每行一个二级标题，按填写顺序展示。留空时自动展示待办及另外两个有内容的章节。")
      .addTextArea((text) => text.setValue(previewHeadings).setPlaceholder("今日todo\n想法/思考")
        .onChange((value) => { previewHeadings = value; }));
    this.saveButton(daily, "保存日记章节", () => this.plugin.savePreferences({
      defaultTaskSection: taskHeading, thoughtSection: thoughtHeading, dailyPreviewSections: parseSectionNames(previewHeadings),
    }));

    const todo = this.createGroup(content, "todo", "待办", "设置收集范围、完成状态和常用标签。", "list-todo");
    let taskSource = settings.taskSource;
    let folders = settings.taskFolders.join("\n");
    let excluded = settings.taskExcludedFolders.join("\n");
    let completed = settings.completedTaskDisplay;
    new Setting(todo).setName("待办来源").setDesc("影响待办列表、日历和月度日记中的笔记待办；月度计划始终保留。")
      .addDropdown((select) => select.addOptions({ all: "全部笔记", daily: "仅日记", folders: "指定文件夹" })
        .setValue(taskSource).onChange((value) => {
          taskSource = value as DashboardSettings["taskSource"];
          folderFields.style.display = taskSource === "folders" ? "" : "none";
        }));
    const folderFields = todo.createDiv({ cls: "daily-settings__nested" });
    folderFields.style.display = taskSource === "folders" ? "" : "none";
    new Setting(folderFields).setName("来源文件夹").setDesc("每行一个库内相对路径，包含子文件夹，不支持通配符。")
      .addTextArea((text) => text.setValue(folders).setPlaceholder("Daily\nNotes/Work").onChange((value) => { folders = value; }));
    new Setting(todo).setName("排除文件夹").setDesc("每行一个库内相对路径，包含子文件夹；排除规则优先。只隐藏待办，不修改笔记。")
      .addTextArea((text) => text.setValue(excluded).setPlaceholder("Templates\nArchive").onChange((value) => { excluded = value; }));
    new Setting(todo).setName("已完成待办").setDesc("控制首页待办列表；日历仍显示完整状态，并支持取消完成。")
      .addDropdown((select) => select.addOptions({ hide: "隐藏", collapsed: "折叠", show: "全部显示" })
        .setValue(completed).onChange((value) => { completed = value as DashboardSettings["completedTaskDisplay"]; }));
    this.saveButton(todo, "保存待办设置", () => this.plugin.savePreferences({
      taskSource, taskFolders: parseTaskFolders(folders), taskExcludedFolders: parseTaskFolders(excluded), completedTaskDisplay: completed,
    }));
    this.renderTaskCategories(todo);

    const calendar = this.createGroup(content, "calendar", "日历", "所有日历使用同一种星期顺序。", "calendar-days");
    new Setting(calendar).setName("每周起始日").setDesc("首页、月度计划、月度日记和学习打卡共用此设置。选择后立即保存。")
      .addDropdown((select) => select.addOptions({ "0": "周日", "1": "周一" }).setValue(String(settings.weekStartsOn))
        .onChange(async (value) => {
          try { await this.plugin.savePreferences({ weekStartsOn: Number(value) as 0 | 1 }); }
          catch { select.setValue(String(this.plugin.settings.weekStartsOn)); new Notice("保存失败，请重试。"); }
        }));

    const legend = calendar.createDiv({ cls: "daily-settings__legend" });
    this.subheading(legend, "日历标记");
    for (const [state, symbol, label] of [["tasks", "14", "有待办"], ["pending", "●", "仍有未完成"], ["completed", "✓", "全部完成"]]) {
      const item = legend.createDiv({ cls: "daily-settings__legend-item" });
      item.createEl("span", { cls: "daily-settings__day is-" + state, text: symbol, attr: { "aria-hidden": "true" } });
      item.createEl("span", { text: label });
    }
    const data = this.createGroup(content, "data", "数据管理", "管理此笔记库中由 Daily 保存的记录。", "database");
    const dataNote = data.createDiv({ cls: "daily-settings__note" });
    const noteIcon = dataNote.createEl("span", { attr: { "aria-hidden": "true" } });
    setIcon(noteIcon, "hard-drive");
    dataNote.createEl("p", { text: "笔记保存在你的 Markdown 文件中。插件记录与设置保存在当前笔记库内，备份时请一并保留。" });
    new Setting(data).setName("备份、恢复与同步").setDesc("导出插件记录、恢复历史副本，或处理同步冲突。")
      .addButton((button) => button.setButtonText("备份与恢复").onClick(() => new BackupManagerModal(this.plugin, () => this.display()).open()));
    const danger = data.createDiv({ cls: "daily-settings__danger" });
    new Setting(danger).setName("清除存档").setDesc("清空月度计划、完成状态、学习打卡和待办排序，保留笔记、课程配置及首页设置。")
      .addButton((button) => button.setButtonText("清除存档").setWarning().onClick(() => {
        new ClearArchiveModal(this.app, this.plugin).open();
      }));
    this.activateSection(this.sections.has(this.activeSection) ? this.activeSection : "home");
  }

  private createGroup(container: HTMLElement, id: string, title: string, description: string, icon: string): HTMLElement {
    const tab = this.navigation.createEl("button", {
      cls: "daily-settings__tab",
      attr: { type: "button", role: "tab", id: "daily-settings-tab-" + id, "aria-controls": "daily-settings-panel-" + id },
    });
    const glyph = tab.createEl("span", { attr: { "aria-hidden": "true" } });
    setIcon(glyph, icon);
    tab.createEl("span", { text: title });
    const panel = container.createDiv({
      cls: "daily-settings__panel",
      attr: { role: "tabpanel", id: "daily-settings-panel-" + id, "aria-labelledby": "daily-settings-tab-" + id, tabindex: "0" },
    });
    panel.hidden = true;
    const heading = panel.createDiv({ cls: "daily-settings__section-heading" });
    heading.createEl("h3", { text: title });
    heading.createEl("p", { text: description });
    this.sections.set(id, { tab, panel });
    tab.addEventListener("click", () => this.activateSection(id));
    tab.addEventListener("keydown", (event) => {
      const ids = [...this.sections.keys()];
      const index = ids.indexOf(id);
      let next: number;
      if (event.key === "ArrowRight") next = (index + 1) % ids.length;
      else if (event.key === "ArrowLeft") next = (index + ids.length - 1) % ids.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = ids.length - 1;
      else return;
      event.preventDefault();
      this.activateSection(ids[next]);
      this.sections.get(ids[next])!.tab.focus();
    });
    return panel;
  }

  private activateSection(id: string) {
    this.activeSection = id;
    for (const [key, { tab, panel }] of this.sections) {
      const selected = key === id;
      tab.setAttr("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
    }
  }

  private subheading(container: HTMLElement, title: string) {
    container.createEl("h4", { cls: "daily-settings__subheading", text: title });
  }

  private saveButton(container: HTMLElement, label: string, save: () => Promise<void>) {
    const actions = container.createDiv({ cls: "daily-settings__actions" });
    const feedback = actions.createEl("p", { cls: "daily-settings-feedback", attr: { role: "status", "aria-live": "polite" } });
    const button = actions.createEl("button", { cls: "mod-cta", text: label, attr: { type: "button" } });
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      feedback.setText("正在保存…");
      feedback.setAttr("data-state", "saving");
      try { await save(); feedback.setText("已保存"); feedback.setAttr("data-state", "saved"); }
      catch (error) {
        feedback.setText(error instanceof Error ? error.message : "保存失败，请重试。");
        feedback.setAttr("data-state", "error");
      } finally { button.disabled = false; }
    });
  }

  private savedText<K extends "dailyFolder" | "dailyDateFormat" | "articleFolder" | "bookFolder">(
    container: HTMLElement, name: string, description: string, key: K, placeholder: string,
  ) {
    let draft = this.plugin.settings[key];
    const setting = new Setting(container).setName(name).setDesc(description);
    setting.settingEl.addClass("daily-settings__inline-save");
    setting.addText((text) => text.setValue(draft).setPlaceholder(placeholder).onChange((value) => { draft = value; }));
    const feedback = container.createEl("p", { cls: "daily-settings-feedback daily-settings-feedback--inline", attr: { role: "status", "aria-live": "polite" } });
    setting.addButton((button) => button.setButtonText("保存").setTooltip("保存" + name).onClick(async () => {
      button.setDisabled(true);
      feedback.setText("正在保存…");
      feedback.setAttr("data-state", "saving");
      try {
        await this.plugin.saveSetting(key,
          (key === "dailyDateFormat" ? draft.trim() || DEFAULT_SETTINGS.dailyDateFormat : draft.trim()) as DashboardSettings[K]);
        feedback.setText("已保存");
        feedback.setAttr("data-state", "saved");
      } catch (error) {
        feedback.setText(error instanceof Error ? error.message : "保存失败，请重试。");
        feedback.setAttr("data-state", "error");
      } finally { button.setDisabled(false); }
    }));
  }

  private renderTaskCategories(container: HTMLElement) {
    const section = container.createDiv({ cls: "dashboard-category-settings" });
    this.subheading(section, "待办标签");
    section.createEl("p", { text: "每行一个常用标签，仅用于输入推荐。筛选会自动收集实际使用的全部标签；移除推荐不会删除已有标签。" });
    const grid = section.createDiv({ cls: "daily-settings__categories" });
    const input = grid.createEl("textarea", { attr: { rows: "5", "aria-label": "待办标签列表", placeholder: "生活\n工作\n学习\n其他" } });
    input.value = this.plugin.settings.taskCategories.join("\n");
    const defaultRow = grid.createDiv({ cls: "dashboard-category-settings__default" });
    defaultRow.createEl("span", { text: "新增待办的默认标签" });
    const select = defaultRow.createEl("select", { attr: { "aria-label": "默认待办标签" } });
    const updateOptions = (preferred = select.value) => {
      try {
        const categories = parseTaskCategories(input.value);
        select.empty();
        select.createEl("option", { text: "不指定标签", attr: { value: "" } });
        for (const name of categories) select.createEl("option", { text: name, attr: { value: name } });
        select.value = categories.includes(preferred) ? preferred : "";
      } catch { /* Keep the last valid choices while a name is being edited. */ }
    };
    updateOptions(this.plugin.settings.defaultTaskCategory);
    input.addEventListener("input", () => updateOptions());
    const actions = section.createDiv({ cls: "daily-settings__actions" });
    const feedback = actions.createEl("p", { cls: "dashboard-category-settings__feedback", attr: { role: "status", "aria-live": "polite" } });
    const save = actions.createEl("button", { cls: "mod-cta", text: "保存标签" });
    save.addEventListener("click", async () => {
      if (save.disabled) return;
      save.disabled = true;
      feedback.setText("正在保存…");
      feedback.setAttr("data-state", "saving");
      try {
        await this.plugin.saveTaskCategories(input.value, select.value);
        input.value = this.plugin.settings.taskCategories.join("\n");
        updateOptions(this.plugin.settings.defaultTaskCategory);
        feedback.setText("标签已保存");
        feedback.setAttr("data-state", "saved");
      } catch (error) {
        feedback.setText(error instanceof Error ? error.message : "标签保存失败，请重试。");
        feedback.setAttr("data-state", "error");
      } finally {
        save.disabled = false;
      }
    });
  }
}
