import { Modal, TFile, moment } from "obsidian";
import type DashboardPlugin from "./main";
import type { DashboardSettings } from "./types";
import { renderDailyFolder } from "./notes";

export function dailyPath(settings: Pick<DashboardSettings, "dailyFolder" | "dailyDateFormat" | "dailyFolderLiteral">, date: string): string {
  const name = moment(date, "YYYY-MM-DD", true).format(settings.dailyDateFormat);
  const folder = settings.dailyFolderLiteral ? settings.dailyFolder : renderDailyFolder(settings.dailyFolder, name, settings.dailyDateFormat);
  return [folder, name + ".md"].filter(Boolean).join("/");
}

export function validateDailyLocation(folder: string, format: string) {
  if (!format.trim() || /(^[\\/]|\.\.|[:*?"<>|\\])/.test(folder) || folder.split("/").includes(".")) throw new Error("请使用库内相对文件夹路径，不含 .. 或特殊字符。");
  for (const date of ["2026-01-02", "2026-11-23"]) {
    const rendered = moment(date).format(format);
    if (/^[\/]|\.\.|[:*?"<>|\\]/.test(rendered) || moment(rendered, format, true).format("YYYY-MM-DD") !== date) throw new Error("日期格式必须包含完整年月日，并能生成有效文件名，例如 YYYY-MM-DD。");
  }
}

export class DailySetupModal extends Modal {
  private accepted = false;
  constructor(private plugin: DashboardPlugin, private finished: (accepted: boolean) => void) { super(plugin.app); }
  onOpen() {
    const root = this.contentEl;
    root.addClass("daily-dialog");
    root.createEl("h2", {text: "连接你的日记"});
    root.createEl("p", {text: "确认保存位置后再创建日记。已有笔记不会移动或改名。"});
    const folderLabel = root.createEl("label", {text: "日记文件夹", cls: "daily-dialog__field"});
    const folder = folderLabel.createEl("input", {attr: {type: "text", "aria-label": "日记文件夹"}});
    folder.value = this.plugin.settings.dailyFolder;
    const formatLabel = root.createEl("label", {text: "文件名日期格式", cls: "daily-dialog__field"});
    const format = formatLabel.createEl("input", {attr: {type: "text", "aria-label": "日记日期格式"}});
    format.value = this.plugin.settings.dailyDateFormat;
    const label = root.createEl("label", {cls: "daily-dialog__toggle"});
    const expand = label.createEl("input", {attr: {type: "checkbox"}});
    expand.checked = !this.plugin.settings.dailyFolderLiteral;
    label.createEl("span", {text: "文件夹名称中的 YYYY、MM 按日期展开"});
    const preview = root.createEl("p", {attr: {role: "status"}});
    const matches = root.createDiv();
    const error = root.createEl("p", {attr: {role: "alert"}});
    const refresh = () => {
      matches.empty(); error.setText("");
      try {
        validateDailyLocation(folder.value, format.value);
        const candidate = {dailyFolder: folder.value.trim().replace(/\/$/, ""), dailyDateFormat: format.value.trim(), dailyFolderLiteral: !expand.checked};
        const path = dailyPath(candidate, moment().format("YYYY-MM-DD"));
        preview.setText(`今天：${path}（${this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile ? "已有笔记，将打开" : "尚未创建"}）`);
        const files = this.plugin.app.vault.getMarkdownFiles().filter((file) => {
          const relative = candidate.dailyFolderLiteral && candidate.dailyFolder ? file.path.slice(candidate.dailyFolder.length + 1) : file.basename + ".md";
          const date = moment(relative.replace(/\.md$/, ""), candidate.dailyDateFormat, true);
          return date.isValid() && dailyPath(candidate, date.format("YYYY-MM-DD")) === file.path;
        });
        matches.createEl("p", {text: `找到 ${files.length} 篇已有日记`});
        files.slice(-3).forEach((file) => matches.createEl("p", {text: file.path}));
      } catch (e) { error.setText((e as Error).message); }
    };
    folder.addEventListener("input", refresh); format.addEventListener("input", refresh); expand.addEventListener("change", refresh);
    root.createEl("button", {text: "读取 Obsidian 日记设置"}).addEventListener("click", async () => {
      try {
        const raw = JSON.parse(await this.plugin.app.vault.adapter.read(`${this.plugin.app.vault.configDir}/daily-notes.json`));
        folder.value = typeof raw.folder === "string" ? raw.folder : "";
        format.value = typeof raw.format === "string" && raw.format ? raw.format : "YYYY-MM-DD";
        expand.checked = false;
        refresh();
      } catch { error.setText("未找到可读取的核心日记配置，请手动填写目录和日期格式。"); }
    });
    const actions = root.createDiv({cls: "modal-button-container"});
    actions.createEl("button", {text: "稍后"}).addEventListener("click", () => this.close());
    const save = actions.createEl("button", {text: "确认日记位置", cls: "mod-cta"});
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        validateDailyLocation(folder.value, format.value);
        await this.plugin.configureDaily(folder.value.trim().replace(/\/$/, ""), format.value.trim(), !expand.checked);
        this.accepted = true; this.close();
      } catch (e) { error.setText((e as Error).message); }
      finally { save.disabled = false; }
    });
    refresh();
  }
  onClose() { this.finished(this.accepted); this.contentEl.empty(); }
}
