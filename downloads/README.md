# Daily 安装包

[下载 Daily 0.1.0](https://github.com/HappyChenchen/obsidian-dashboard/raw/refs/heads/main/downloads/daily-0.1.0.zip) · [安装指南](../docs/INSTALL.md) · [校验文件](SHA256SUMS.txt)

[下载示例库与模板](https://github.com/HappyChenchen/obsidian-dashboard/raw/refs/heads/main/downloads/daily-examples-0.1.0.zip) · [示例库说明](../examples/README.md) · [模板说明](../templates/README.md)

解压 `daily-0.1.0.zip`，将 `dashboard-home` 文件夹放入笔记库的 `.obsidian/plugins/`，再到 Obsidian 的第三方插件设置中启用 Daily。安装无需 Node.js。

插件 ZIP 只包含 `main.js`、`manifest.json` 和 `styles.css`。示例 ZIP 只包含虚构 Markdown 笔记、模板和使用说明，解压后可作为独立 Obsidian 笔记库打开，需要另外安装插件。两个包都不含账号、个人设置或存档。升级时保留原有 `data.json` 和 `backups/`。

维护者在源码根目录运行 `npm run package`，会同时更新 `dist/` 构建产物与此目录的安装包、SHA-256 校验文件。提交源码时一起提交对应安装包；版本变更后更新文档中的下载链接。
