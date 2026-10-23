import test from 'node:test';
import assert from 'node:assert/strict';
import {lib, fixture, elements, moment, clock} from './helpers.mjs';

function freeze(value) { const previous = moment.now; moment.now = () => +new Date(value); return () => {moment.now = previous;}; }
test('date parser validates explicit, compact and loose dates including leap years', () => {
  for (const value of ['📅 2026-02-31', 'due:: 2026-13-01', '20260229', '2026/4/31', '2026 00 10']) {
    const parsed = lib.parseTaskDate(value);
    assert.ok(parsed.invalidDate, value); assert.equal(parsed.due, undefined);
  }
  assert.equal(lib.parseTaskDate('📅 2024-02-29').due, '2024-02-29');
  assert.equal(lib.parseTaskDate('20260228').due, '2026-02-28');
  assert.equal(lib.parseTaskDate('2026/4/30').due, '2026-04-30');
});

test('invalid captures leave the note unchanged; existing invalid tasks remain visible outside the calendar', async () => {
  const f = fixture('## 今日todo\n- [ ] Broken 📅 2026-02-31', 'Daily/2026/10/2026-10-12.md');
  let created = false;
  f.plugin.ensureDailyNote = async () => {created = true; return f.file;};
  await assert.rejects(f.plugin.appendTaskToToday('Fix 📅 2026-02-31'), /日期无效/);
  assert.equal(created, false);
  assert.equal(f.get(), '## 今日todo\n- [ ] Broken 📅 2026-02-31');
  const data = await f.plugin.collectData();
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].invalidDate, '2026-02-31');
  assert.equal(data.calendarTasks.size, 0);
  const view = new lib.DashboardView({}, f.plugin);
  await view.render();
  assert.ok(elements(view.containerEl).some((el) => el.text.includes('日期无效：2026-02-31')));
});

test('date groups respect explicit dates over Daily dates and keep manual order inside a group', () => {
  const tasks = [
    {text: 'Second', due: '2026-10-12'}, {text: 'First', due: '2026-10-12'},
    {text: 'Later', due: '2026-10-15', dailyDate: '2026-10-10'},
    {text: 'Past', dailyDate: '2026-10-11'}, {text: 'Someday'},
    {text: 'Broken', invalidDate: '2026-02-31', dailyDate: '2026-10-12'},
  ];
  const groups = lib.groupDashboardTasks(tasks, '2026-10-12');
  assert.equal(groups.map((g) => g.label).join(','), '逾期,今天,以后,未设日期,日期待修正');
  assert.equal(groups[1].tasks.map((task) => task.text).join(','), 'Second,First');
});

test('today actions use click-time dates, and calendar follows today only when previously on today', async () => {
  const restore = freeze('2026-10-31T23:59:00');
  try {
    const {plugin, file} = fixture('');
    let openedDate;
    plugin.ensureDailyNote = async (date = moment().format('YYYY-MM-DD')) => {openedDate = date; return file;};
    plugin.openFile = async () => {};
    const view = new lib.DashboardView({}, plugin);
    await view.render();
    const open = elements(view.containerEl).find((el) => el.text === '打开今日笔记');
    moment.now = () => +new Date('2026-11-01T00:01:00');
    await open.handlers.click();
    assert.equal(openedDate, '2026-11-01');
    await view.render();
    assert.equal(view.calendar.selectedDate, '2026-11-01');
    assert.equal(view.calendar.month, '2026-11');
    view.calendar.selectedDate = '2026-10-15'; view.calendar.month = '2026-10';
    moment.now = () => +new Date('2026-11-02T00:01:00');
    await view.render();
    assert.equal(view.calendar.selectedDate, '2026-10-15');
  } finally {restore();}
});

test('midnight timer and wake checks refresh once per date change, with cleanup', () => {
  const restore = freeze('2026-10-31T23:59:59');
  let refreshes = 0;
  const watcher = new lib.DayRollover(() => refreshes++);
  try {
    watcher.check();
    const timer = clock.timers.get(watcher.timer);
    assert.ok(timer.delay >= 1000 && timer.delay <= 1100);
    moment.now = () => +new Date('2026-11-01T00:00:01');
    timer.fn(); watcher.check();
    assert.equal(refreshes, 1);
    moment.now = () => +new Date('2026-11-03T09:00:00');
    watcher.check(); assert.equal(refreshes, 2);
    watcher.dispose();
    assert.equal(clock.timers.has(watcher.timer), false);
    moment.now = () => +new Date('2026-11-04T09:00:00');
    watcher.check(); assert.equal(refreshes, 2);
  } finally {watcher.dispose(); restore();}
});

test('new templates follow the configured task heading without requiring related notes', async () => {
  const {plugin, file} = fixture('');
  plugin.settings.dailyFolder = ''; plugin.settings.defaultTaskSection = 'Tasks';
  let content;
  plugin.app.vault.create = async (_path, text) => {content = text; return file;};
  await plugin.ensureDailyNote('2026-10-12');
  assert.match(content, /## Tasks/);
  assert.doesNotMatch(content, /今日关联笔记|今日todo/);
});

test('daily card shows content previews and recent notes even when today has no file', async () => {
  const restore = freeze('2026-10-12T12:00:00');
  try {
    const f = fixture('## 今日todo\n- [ ] Read\n## 想法/思考\nActual insight', 'Daily/2026/10/2026-10-12.md');
    f.plugin.app.vault.getAbstractFileByPath = (path) => path === f.file.path ? f.file : undefined;
    const view = new lib.DashboardView({}, f.plugin);
    await view.render();
    let allText = elements(view.containerEl).map((el) => el.text).join(' ');
    assert.match(allText, /Actual insight/); assert.doesNotMatch(allText, /待补充|补全今日模板/);
    moment.now = () => +new Date('2026-10-13T12:00:00');
    await view.render();
    allText = elements(view.containerEl).map((el) => el.text).join(' ');
    assert.match(allText, /今天还没有笔记/); assert.match(allText, /Actual insight/);
  } finally {restore();}
});
