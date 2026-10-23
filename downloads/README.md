# Daily 安装包

[下载 Daily 0.1.0](https://github.com/HappyChenchen/obsidian-dashboard/raw/refs/heads/main/downloads/daily-0.1.0.zip) · [安装指南](../docs/INSTALL.md) · [校验文件](SHA256SUMS.txt)

解压 `daily-0.1.0.zip`，将 `dashboard-home` 文件夹放入笔记库的 `.obsidian/plugins/`，再到 Obsidian 的第三方插件设置中启用 Daily。安装无需 Node.js。

ZIP 只包含 `main.js`、`manifest.json` 和 `styles.css`，不含笔记、账号、个人设置或存档。升级时保留原有 `data.json` 和 `backups/`。

维护者在源码根目录运行 `npm run package`，会同时更新 `dist/` 构建产物与此目录的安装包、SHA-256 校验文件。提交源码时一起提交对应安装包；版本变更后更新文档中的下载链接。
