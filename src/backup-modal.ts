import { Modal, Notice } from "obsidian";
import { backupDocument, readBackup } from "./backup";
import { decodeSettings } from "./settings-codec";
import type DashboardPlugin from "./main";
import type { DashboardSettings } from "./types";

export class RestoreBackupModal extends Modal {
  constructor(private plugin: DashboardPlugin, private settings: DashboardSettings, private label: string, private restored?: () => void) { super(plugin.app); }
  onOpen() {
    const root = this.contentEl;
    root.addClass("daily-dialog");
    root.createEl("h2", {text: this.label});
    root.createEl("p", {text: `包含 ${Object.keys(this.settings.monthlyPlan).length} 天计划、${Object.values(this.settings.monthlyPlanItems).flat().length} 条事项、${this.settings.studyCheckins.length} 条打卡。`});
    root.createEl("p", {text: "将替换插件记录和设置，笔记保持不变。替换前会备份本机内容与未保存草稿。"});
    const error = root.createEl("p", {attr: {role: "alert"}});
    const actions = root.createDiv({cls: "modal-button-container"});
    actions.createEl("button", {text: "取消"}).addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", {text: "确认使用此版本", cls: "mod-warning"});
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try { await this.plugin.restoreBackup(this.settings); new Notice("恢复完成，替换前的版本已备份。"); this.close(); this.restored?.(); }
      catch (e) { error.setText((e as Error).message); }
      finally { confirm.disabled = false; }
    });
  }
}

export class BackupManagerModal extends Modal {
  constructor(private plugin: DashboardPlugin, private finished?: () => void) { super(plugin.app); }
  onClose() { this.finished?.(); }
  private preview(settings: DashboardSettings, label: string) {
    new RestoreBackupModal(this.plugin, settings, label, () => void this.onOpen()).open();
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("daily-dialog");
    root.createEl("h2", {text: "备份与恢复"});
    root.createEl("p", {text: "每天首次修改前自动备份，清除和恢复前也会备份。导出包含设置、计划、打卡和未保存草稿，不包含 Markdown 笔记。"});
    const error = root.createEl("p", {attr: {role: "status"}});
    const exporting = root.createEl("button", {text: "导出备份到笔记库"});
    exporting.addEventListener("click", async () => {
      exporting.disabled = true;
      try {
        const folder = "Daily Backups";
        const adapter = this.plugin.app.vault.adapter;
        if (!await adapter.exists(folder)) await adapter.mkdir(folder);
        const path = `${folder}/Daily-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        await adapter.write(path, backupDocument(this.plugin.snapshotWithDrafts()));
        error.setText(`已导出：${path}。请把此文件复制到独立备份位置。`);
      } catch (e) { error.setText((e as Error).message); }
      finally { exporting.disabled = false; }
    });
    const label = root.createEl("label", {text: "从备份文件恢复", cls: "daily-dialog__field"});
    const file = label.createEl("input", {attr: {type: "file", accept: ".json,application/json", "aria-label": "选择 Daily 备份"}});
    file.addEventListener("change", async () => {
      try {
        if (file.files?.[0]) {
          if (file.files[0].size > 20 * 1024 * 1024) throw new Error("备份超过 20 MB，请检查文件。");
          this.preview(readBackup(await file.files[0].text()), "恢复所选备份");
        }
      } catch (e) { error.setText((e as Error).message); }
      finally { file.value = ""; }
    });
    if (this.plugin.syncConflict) {
      root.createEl("h3", {text: "处理同步冲突"});
      root.createEl("p", {text: "先导出或查看自动备份，再选择要继续使用的完整版本。"});
      root.createEl("button", {text: "保留本机内容和草稿"}).addEventListener("click", () => {
        this.preview(this.plugin.snapshotWithDrafts(), "使用本机版本");
      });
      root.createEl("button", {text: "使用同步版本"}).addEventListener("click", async () => {
        try { this.preview(decodeSettings(await this.plugin.loadData()), "使用同步版本"); }
        catch (e) { error.setText((e as Error).message); }
      });
    }
    root.createEl("h3", {text: "自动备份与历史副本"});
    const list = root.createDiv({cls: "daily-backup-list"});
    try {
      const paths = await this.plugin.listBackups();
      if (!paths.length) list.createEl("p", {text: "暂无备份。首次修改已有记录前会自动创建。"});
      for (const path of paths) {
        const name = path.split("/").pop()!;
        const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-\d+-(.+)\.json$/.exec(name);
        const labels: Record<string, string> = {automatic: "自动备份", "before-clear": "清除前", "before-restore": "恢复前的本机内容", "disk-before-restore": "恢复前的同步版本", "conflict-local": "冲突时的本机版本", "conflict-remote": "冲突时的同步版本", "draft-conflict": "冲突时的编辑草稿"};
        const label = parts ? `${new Date(`${parts[1]}T${parts[2]}:${parts[3]}:${parts[4]}.${parts[5]}Z`).toLocaleString()} · ${labels[parts[6]] ?? "历史备份"}` : name;
        list.createEl("button", {text: label}).addEventListener("click", async () => {
          try { this.preview(readBackup(await this.plugin.app.vault.adapter.read(path)), "恢复历史备份"); }
          catch (e) { error.setText((e as Error).message); }
        });
      }
    } catch (e) { error.setText((e as Error).message); }
  }
}
