# 发布与验证

仓库：[HappyChenchen/obsidian-dashboard](https://github.com/HappyChenchen/obsidian-dashboard)。插件名 Daily，插件 ID 为 `dashboard-home`。

## 当前状态

`0.1.0` 为试用候选版本。已有本地代码、安装包和发布工作流，尚未发布 Release 或提交社区插件目录。工作流配置不代表已经通过远端 CI。

## 已完成验证（2026-10-23）

- `npm run package`：元数据检查、88 项回归测试、TypeScript 检查及构建。
- 标准 ZIP 读取器检查安装包，SHA-256 校验；安装脚本保留现有 `data.json`。
- macOS / Obsidian 1.14.5 的独立虚构库：安装启用、首次日记位置预览、核心日记配置读取、日期子目录、逐项完成、标签筛选、日历标记、重新加载保留、窄分栏、浅色/深色主题、备份导出和历史副本恢复。
- 实际修改外部配置后，首页可自动更新；连续勾选引发的误报冲突已修复并覆盖回归测试。
- 截图和示例仅使用虚构内容。

自动测试模拟 Obsidian API。Windows/Linux、iOS/Android、真实双设备同步、最低版本 1.8.0 和真实大型笔记库仍需实机验证。

## 每次发布前

- [ ] `npm ci` 和 `npm run package` 通过。
- [ ] 将 `npm run package` 同步生成的 `downloads/` 安装包和校验文件与源码一起提交，更新 README 和安装指南的版本下载链接。
- [ ] package、锁文件、manifest、versions 的版本一致。
- [ ] 在独立测试库检查创建日记、添加与完成任务、计划自动保存、重新加载和备份恢复。
- [ ] 检查旧数据迁移、保存失败、未保存草稿及同步冲突。
- [ ] 检查浅色/深色、窄分栏、键盘；移动端另外验证触屏。
- [ ] 更新 CHANGELOG、截图、已验证平台与已知限制。
- [ ] 安装包不含个人数据、调试输出或本机路径。
- [ ] 首次提交社区目录前检查插件 ID 可用性和安全报告入口。

## 版本和构建

使用普通 `x.y.z` 版本号。例如后续更新补丁版本：

```sh
npm version patch --no-git-tag-version
npm run package
```

`version` 脚本会同步 manifest 和版本映射。首个候选版本已经是 `0.1.0`，首次发布不需要为了运行上述示例而额外升版。提交版本文件、CHANGELOG 和源码后，才创建与 `manifest.version` **完全相同**的 Git 标签，不加 `v` 前缀。

## GitHub 工作流

- `ci.yml`：推送 main 和 Pull Request 时，在 Node.js 22/24 上检查和构建，上传 `dist/`。
- `release.yml`：版本标签推送后再次检查和构建，创建**草稿 Release**。
- 草稿附件包含 `main.js`、`manifest.json`、`styles.css`、安装 ZIP、SHA-256 校验和及安装说明。
- 维护者验证附件并审阅说明后，再手动发布；发布失败时先检查日志，不覆盖已公开的版本。

下载入口为 [Releases](https://github.com/HappyChenchen/obsidian-dashboard/releases)。发布首版后，更新 README 和安装指南中的当前状态说明。

## 社区目录

公开源码和发布安装包是两个步骤，社区目录上架还需要单独审核。准备真实 Release 后，按 [Obsidian 官方提交说明](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) 操作；不要在审核前宣称可以从插件市场安装。
