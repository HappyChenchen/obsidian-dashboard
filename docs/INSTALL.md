# Daily 本地试用版安装

需要 Obsidian 1.8.0 或以上。安装已有构建文件无需 Node.js。

**[下载 Daily 0.1.0 安装包](https://github.com/HappyChenchen/obsidian-dashboard/raw/refs/heads/main/downloads/daily-0.1.0.zip)**。安装包也保存在源码仓库的 `downloads/daily-0.1.0.zip`，无需自行编译。不要把 GitHub 的源码 ZIP 当成插件安装包。

1. 解压 `daily-0.1.0.zip`，得到 `dashboard-home` 文件夹。
2. 关闭目标笔记库窗口，将这个文件夹放进笔记库的 `.obsidian/plugins/`。
3. 重新打开 Obsidian，在「设置 → 第三方插件」启用 **Daily**。
4. 点击左侧房子图标。首次使用时点击「设置日记位置」，可读取核心日记配置，预览已有日记后确认。

正确目录结构：

```text
笔记库/.obsidian/plugins/dashboard-home/
  main.js
  manifest.json
  styles.css
```

不要再嵌套一层 `dashboard-home`。macOS 可按 Command + Shift + . 显示隐藏目录；Windows 在文件资源管理器中开启显示隐藏项目。

升级前，在 Daily 的「数据管理 → 备份与恢复」导出备份。关闭插件，仅替换三个安装文件，保留 `data.json` 和 `backups/`。旧月度计划会按行迁移为独立事项，原完成状态保留。

月度计划每行一项，输入 `#` 选择标签；点击事项旁的复选框分别完成。首页按实际标签筛选。窄分栏按日期列表展示月度计划；待办旁的 ↑ / ↓ 按钮可以排序。

自动备份保存在插件目录的 `backups/` 中；导出文件在笔记库的 `Daily Backups/`。插件备份不包含 Markdown 笔记和附件，请另行备份整个笔记库。

这是仓库附带的试用构建，尚无正式 Release，也未上架社区目录。移动设备、Windows/Linux 应用内交互仍待实机验证。
