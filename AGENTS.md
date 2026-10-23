# Daily

A local-first Obsidian dashboard written in TypeScript. The UI currently uses Chinese.
Repository: `HappyChenchen/obsidian-dashboard`. Product name: Daily. Plugin ID: `dashboard-home`.

- Keep changes focused. Do not add a framework or backend just to reorganize this plugin.
- Respect Markdown ownership. Use `vault.process()` for read-modify-write operations and validate task identity before writing.
- Store only synthetic fixtures in tests and examples. Never copy a user's vault, plugin data, credentials, or machine-specific paths into this repository.
- Keep plugin ID `dashboard-home` stable unless a migration is explicitly designed.
- `npm ci` installs dependencies; `npm run check` runs metadata checks, regression tests and the build.
- Use `npm run install:local -- "/path/to/test-vault"` only with an explicitly selected test vault.
- Runtime tests mock Obsidian; distinguish them from real desktop or mobile validation.
- Use English conventional commit prefixes and Chinese descriptions, for example `fix: 修复任务定位`.
