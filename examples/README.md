# 示例笔记库与模板

**[下载示例库与模板 ZIP](https://github.com/HappyChenchen/obsidian-dashboard/raw/refs/heads/main/downloads/daily-examples-0.1.0.zip)**。不需要 Git 或 Node.js。

## 包含哪些内容

| 内容 | 位置 | 可以体验什么 |
| --- | --- | --- |
| 已完成的日记 | [2026-10-10](vault/Daily/2026/10/2026-10-10.md) | 绿色完成勾、已完成 Todo |
| 部分完成的日记 | [2026-10-11](vault/Daily/2026/10/2026-10-11.md) | 浅灰点、多标签、跨日到期任务 |
| 文章笔记 | [示例文章](vault/Library/Articles/示例文章.md) | 文章资料库与笔记链接 |
| 读书笔记 | [示例书](vault/Library/Books/示例书.md) | 阅读进度与读书记录 |
| 三种笔记模板 | [templates](../templates/README.md) | 日记、读书、文章的可复用结构 |

所有内容均为虚构示例，日期固定为 2026 年 10 月；没有个人数据、插件配置和预填的月度计划存档。

## 如何试用

1. 解压 ZIP，用 Obsidian 将 `Daily-example-vault` 打开为笔记库。
2. 另外下载插件安装包，按 [安装指南](../docs/INSTALL.md) 启用 Daily。
3. 在首次日记位置引导中使用 `Daily/YYYY/MM` 和 `YYYY-MM-DD`，开启目录日期展开，确认找到示例日记。
4. 将日历切换到 **2026 年 10 月**：10 日全部完成，11 日和 12 日还有未完成项。12 日的事项来自 11 日日记中的截止日期。
5. 打开库内的 [使用说明](vault/使用说明.md)，尝试任务联动、月度日记、月度计划、资料库和模板。

ZIP 已包含 `Templates/`。如果你从源码复制 `examples/vault/`，请同时把 `templates/` 复制成库内的 `Templates/`。日记模板使用方法及与 Daily 内置格式的区别见 [模板说明](../templates/README.md)。

示例日期与今天不同的时候，首页可能显示逾期任务，今日笔记为空，这是正常现象。建议使用独立测试库，不要把示例待办直接混进真实笔记库。

## 从源码重新生成

在源码根目录运行 `npm run package`，会生成 `dist/daily-examples-0.1.0.zip`，并同步到 `downloads/`，同时更新校验文件。示例包只收录维护中的 Markdown 文件，排除隐藏目录、链接和插件存档。
