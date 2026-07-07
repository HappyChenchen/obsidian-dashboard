# Dashboard Home

Dashboard Home is a personal Obsidian homepage plugin inspired by Notion dashboards and database views. It keeps your data in Markdown files while giving you one place for daily notes, open tasks, a task-linked calendar, focus sessions, projects, saved articles, and reading notes.

## Current MVP

- Custom dashboard view with ribbon icon and command.
- Overview summary for unfinished tasks, overdue work, projects, and reading.
- Workbench layout: calendar, today's note with recent inspirations, TodoList, database, and projects.
- Main workbench panels can be dragged to reorder; common sizes can be changed from the panel menu or by dragging the bottom-right handle.
- Today's note card shows section status instead of raw Markdown.
- Recent inspirations are collected from daily `想法/思考` sections.
- Quick task capture into today's daily note.
- Todo card shows all unfinished tasks across the vault.
- Markdown task scan across the vault.
- Mini calendar highlights dates; selecting a date shows that day's `今日todo` and vault tasks due on that date.
- Local Pomodoro timer with completion logs written to the daily note.
- Database view combines article and book notes from configured folders, `type`, or tags.
- Project summaries from a configured folder or `type: project` notes.
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

For local Obsidian testing, install the built plugin into the default vault:

```sh
npm run install:local
```

Set `OBSIDIAN_VAULT` to install into another vault:

```sh
OBSIDIAN_VAULT="/path/to/vault" npm run install:local
```

Manual install still only requires `main.js`, `manifest.json`, and `styles.css` in:

```text
<vault>/.obsidian/plugins/dashboard-home/
```
