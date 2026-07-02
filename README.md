# Dashboard Home

Dashboard Home is a personal Obsidian homepage plugin inspired by Notion dashboards and database views. It keeps your data in Markdown files while giving you one place for daily notes, open tasks, a task-linked calendar, focus sessions, projects, saved articles, and reading notes.

## Current MVP

- Custom dashboard view with ribbon icon and command.
- Daily note preview from second-level headings.
- Daily card shows only the `想法/思考` section.
- Quick task capture into today's daily note.
- Today's todo card merges today's daily `今日todo` and vault tasks due today.
- Markdown task scan across the vault.
- Mini calendar with daily todo counts; selecting a date shows that day's `今日todo` and vault tasks due on that date.
- Local Pomodoro timer with completion logs written to the daily note.
- Project summaries from a configured folder or `type: project` notes.
- Article and book lists from configured folders, `type`, or tags.
- Settings for folders, daily date format, task heading, Pomodoro length, and startup behavior.
- Daily folders can use date-only path segments such as `daily/MM` or `Journal/YYYY/MM`.

## Suggested note schema

Daily note:

```md
Path: daily/07/2026-07-02.md

---
type: daily
date: 2026-07-02
---

# 2026-07-02

## 今日todo

- [ ] Review project plan 📅 2026-07-03

## 今日关联笔记

## 想法/思考

## 读书笔记
```

Project note:

```md
---
type: project
status: active
---

# Dashboard Plugin

- [x] Create plugin scaffold
- [ ] Design database schema 📅 2026-07-03
```

Article note:

```md
---
type: article
status: saved
source: https://example.com
---
```

Book note:

```md
---
type: book
status: reading
author: Someone
---
```

## Development

```sh
npm install
npm run build
```

For local Obsidian testing, copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/dashboard-home/
```
