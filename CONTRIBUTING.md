# 参与贡献

欢迎提交问题、文档改进和小范围修复。提交较大的交互或数据格式变化前，请先通过 [Issue](https://github.com/HappyChenchen/obsidian-dashboard/issues) 说明使用场景。

## 开发环境

- Node.js 22+，推荐 24（见 `.nvmrc`）。
- Obsidian 1.8.0+，使用独立测试笔记库。
- `npm ci` 安装锁定版本的依赖。
- `npm run dev` 监听构建；`npm run check` 执行检查。
- `npm run install:local -- "/path/to/test-vault"` 安装到指定测试库。

源码仓库为 `HappyChenchen/obsidian-dashboard`，插件显示名为 Daily。开始开发：

```sh
git clone https://github.com/HappyChenchen/obsidian-dashboard.git
cd obsidian-dashboard
npm ci
npm run check
```

`package.json` 中的 `private: true` 用于避免误发 npm，不影响 MIT 开源。插件通过 Obsidian 安装文件分发。

## 改动原则

- 保持本地运行；新增网络服务、遥测或账号功能需要先讨论。
- 笔记内容属于用户。修改 Markdown 使用 `vault.process()`，并核对目标任务，不能仅依赖旧行号。
- UI 文案使用 Obsidian 的安全 DOM 方法写入，避免把笔记正文拼成 HTML。
- 设置或打卡数据结构变化需要考虑旧数据迁移和失败恢复。
- PR 应聚焦一个问题，说明触发条件、修改后的行为和验证结果。
- 修复影响数据或异步状态的问题时增加行为回归测试；简单文案和样式调整不必堆砌测试。

## 反馈问题

请说明 Obsidian 版本、插件版本、操作系统、复现步骤和实际结果。提供最小化的虚构 Markdown 示例即可，不要上传完整笔记库、真实 `data.json` 或个人日志。

## 项目结构

- `src/main.ts`：插件注册、数据聚合和写入入口。
- `src/dashboard-view.ts`、`calendar-panel.ts`、`monthly-plan-panel.ts`：首页、日历和月度编辑。
- `src/monthly-diary-view.ts`、`study-tracker-view.ts`、`settings-tab.ts`：日记、学习与设置视图。
- `src/note-index.ts`、`settings-store.ts`、`day-rollover.ts`：解析缓存、串行持久化与跨日刷新。
- `src/tasks.ts`、`src/task-editing.ts`、`src/markdown.ts`：任务解析与安全写回。
- `src/notes.ts`：笔记和目录辅助逻辑。
- `src/study.ts`：课程配置、迁移与打卡。
- `tests/`：基于 Node 内置测试框架和模拟 Obsidian API 的回归测试。
- `examples/vault/`：完全虚构的示例笔记。
- `scripts/`：安装、检查版本、同步版本、打包。

发布由维护者按 [发布清单](docs/RELEASE.md) 完成。远端 CI 不能代替真实 Obsidian 中的交互验证。
