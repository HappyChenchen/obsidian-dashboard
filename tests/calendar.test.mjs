import test from 'node:test';
import assert from 'node:assert/strict';
import {lib, fixture, TFile, elements, clock} from './helpers.mjs';

const dailyPath = 'Daily/2026/10/2026-10-11.md';
const counts = (data, date) => {
  const day = data.calendarTasks.get(date);
  return day ? [day.pending, day.completed] : [0, 0];
};

test('calendar counts both states once, assigns explicit dates first, and includes all Daily checkboxes', async () => {
  const f = fixture([
    '## 今日todo',
    '- [ ] Read',
    '- [x] Walk',
    '- [ ] Due tomorrow 📅 2026-10-12',
    '- Loose reminder',
    '## Meeting',
    '- [x] Send summary',
  ].join('\n'), dailyPath);
  const other = new TFile('Notes/work.md');
  f.plugin.app.vault.getMarkdownFiles = () => [f.file, other];
  f.plugin.app.vault.cachedRead = async (file) => file === f.file ? f.get() : [
    '- [ ] Due tomorrow 📅 2026-10-12',
    '- [x] Already done 📅 2026-10-12',
    '- [x] All done 📅 2026-10-13',
    '- [ ] Undated',
    '- [ ] Previous month 📅 2026-09-30',
    '- [x] Next month 📅 2026-11-01',
  ].join('\n');
  const data = await f.plugin.collectData();
  assert.deepEqual(counts(data, '2026-10-11'), [2, 2]);
  assert.deepEqual(counts(data, '2026-10-12'), [2, 1]);
  assert.deepEqual(counts(data, '2026-10-13'), [0, 1]);
  assert.deepEqual(counts(data, '2026-10-14'), [0, 0]);
  assert.deepEqual(counts(data, '2026-09-30'), [1, 0]);
  assert.deepEqual(counts(data, '2026-11-01'), [0, 1]);
  assert.ok(data.tasks.some((task) => task.text === 'Undated'));
  assert.ok(data.tasks.every((task) => !task.done));
  assert.equal([...data.calendarTasks.values()].flatMap((day) => day.tasks).some((task) => task.text === 'Undated'), false);
});

test('calendar includes monthly plans in an empty vault and keeps their completion state', async () => {
  const f = fixture('');
  f.plugin.app.vault.getMarkdownFiles = () => [];
  f.plugin.settings.monthlyPlan = {'2026-10-12': 'Plan', '2026-10-13': 'Done plan'};
  f.plugin.settings.monthlyPlanDone = {'2026-10-13': true};
  let data = await f.plugin.collectData();
  assert.deepEqual(counts(data, '2026-10-12'), [1, 0]);
  assert.deepEqual(counts(data, '2026-10-13'), [0, 1]);
  await f.plugin.toggleTask(data.calendarTasks.get('2026-10-12').tasks[0]);
  data = await f.plugin.collectData();
  assert.deepEqual(counts(data, '2026-10-12'), [0, 1]);
  assert.equal(data.tasks.length, 0);
});

function calendarView(f) {
  f.plugin.settings.visiblePanels = Object.fromEntries(
    Object.keys(f.plugin.settings.visiblePanels).map((key) => [key, key === 'calendar']),
  );
  const view = new lib.DashboardView({}, f.plugin);
  view.calendar.month = '2026-10';
  view.calendar.selectedDate = '2026-10-11';
  return {view, root: view.containerEl.children[1]};
}

const dateCell = (root, date) => elements(root).find((element) =>
  element.cls.split(' ').includes('dashboard-home__calendar-day') && element.attrs['aria-label'].startsWith(date),
);
const markers = (cell) => elements(cell).find((element) => element.cls === 'dashboard-home__calendar-markers').children.map((element) => element.text);
const hasTasks = (cell) => cell.cls.split(' ').includes('has-tasks');
const calendarCheckbox = (root) => elements(root).find((element) => element.attrs.type === 'checkbox');

test('calendar shows only the current month with aligned weekdays and no extra week', async () => {
  const {view, root} = calendarView(fixture(''));
  for (const [month, days, offset] of [['2026-02', 28, 0], ['2028-02', 29, 2], ['2026-04', 30, 3], ['2026-10', 31, 4], ['2026-08', 31, 6]]) {
    view.calendar.month = month;
    await view.render();
    const grid = elements(root).find((element) => element.cls === 'dashboard-home__calendar');
    const cells = grid.children.filter((element) => element.attrs.role === 'button');
    assert.equal(cells.length, days);
    assert.ok(cells.every((cell) => cell.attrs['aria-label'].startsWith(month + '-')));
    assert.ok(cells[0].attrs['aria-label'].startsWith(month + '-01'));
    assert.ok(cells.at(-1).attrs['aria-label'].startsWith(month + '-' + days));
    assert.equal(grid.children.length, 7 + offset + days);
    assert.ok(grid.children.slice(7, 7 + offset).every((cell) => cell.attrs['aria-hidden'] === 'true' && !cell.attrs.tabindex));
  }
});

test('calendar markers and details update after completion, undo and removal', async () => {
  const f = fixture('## 今日todo\n- [ ] Read', dailyPath);
  const {view, root} = calendarView(f);
  await view.render();
  assert.equal(hasTasks(dateCell(root, '2026-10-11')), true);
  assert.deepEqual(markers(dateCell(root, '2026-10-11')), ['●']);
  assert.equal(hasTasks(dateCell(root, '2026-10-12')), false);
  assert.deepEqual(markers(dateCell(root, '2026-10-12')), []);
  await calendarCheckbox(root).handlers.change();
  assert.equal(f.get(), '## 今日todo\n- [x] Read');
  assert.deepEqual(markers(dateCell(root, '2026-10-11')), ['✓']);
  assert.equal(hasTasks(dateCell(root, '2026-10-11')), true);
  assert.match(dateCell(root, '2026-10-11').attrs['aria-label'], /0 项未完成，1 项已完成/);
  assert.equal(calendarCheckbox(root).checked, true);
  assert.ok(elements(root).some((element) => element.cls === 'dashboard-home__calendar-todo is-done'));
  await calendarCheckbox(root).handlers.change();
  assert.equal(f.get(), '## 今日todo\n- [ ] Read');
  assert.equal(hasTasks(dateCell(root, '2026-10-11')), true);
  assert.deepEqual(markers(dateCell(root, '2026-10-11')), ['●']);
  f.set('## 今日todo\n');
  await view.render();
  assert.deepEqual(markers(dateCell(root, '2026-10-11')), []);
  assert.equal(hasTasks(dateCell(root, '2026-10-11')), false);
  assert.match(dateCell(root, '2026-10-11').attrs['aria-label'], /暂无待办/);
});

test('mixed dates keep the task background and show a pending dot until all tasks are complete', async () => {
  const f = fixture('## 今日todo\n- [x] Done first\n- [ ] Pending second', dailyPath);
  const {view, root} = calendarView(f);
  await view.render();
  assert.equal(hasTasks(dateCell(root, '2026-10-11')), true);
  assert.deepEqual(markers(dateCell(root, '2026-10-11')), ['●']);
  const checkboxes = elements(root).filter((element) => element.attrs.type === 'checkbox');
  assert.deepEqual(checkboxes.map((checkbox) => checkbox.checked), [false, true]);
  assert.ok(elements(root).some((element) => element.text === '未完成 1 · 已完成 1'));
  await checkboxes[0].handlers.change();
  assert.equal(hasTasks(dateCell(root, '2026-10-11')), true);
  assert.deepEqual(markers(dateCell(root, '2026-10-11')), ['✓']);
});

test('calendar and monthly plan keep the same month and selected date when navigating', async () => {
  const {view, root} = calendarView(fixture(''));
  await view.render();
  await dateCell(root, '2026-10-12').handlers.keydown({key: 'Enter', preventDefault() {}});
  await view.render();
  assert.equal(view.monthlyPlan.month, '2026-10');
  assert.equal(view.monthlyPlan.selectedDate, '2026-10-12');
  await elements(root).find((el) => el.tag === 'button' && el.text === '月度计划').handlers.click();
  const input = elements(root).find((el) => el.attrs['data-plan-date'] === '2026-10-28');
  input.handlers.focus();
  assert.equal(view.calendar.selectedDate, '2026-10-28');
  elements(root).find((el) => el.text === '下月').handlers.click();
  assert.equal(view.calendar.month, '2026-11');
  assert.equal(view.calendar.selectedDate, '2026-11-01');
  await elements(root).find((el) => el.tag === 'button' && el.text === '首页').handlers.click();
  await view.render();
  assert.equal(dateCell(root, '2026-11-01').attrs['aria-pressed'], 'true');
  await view.openMonthlyPlan('2027-01-03');
  assert.equal(view.calendar.month, '2027-01');
  assert.equal(view.monthlyPlan.selectedDate, '2027-01-03');
  assert.equal(view.activeTab, 'monthly');
});

test('switching months cancels a delayed click from the old month', async () => {
  const {view, root} = calendarView(fixture(''));
  await view.render();
  dateCell(root, '2026-10-12').handlers.click();
  const pending = view.calendar.clickTimer;
  assert.equal(clock.timers.has(pending), true);
  elements(root).find((el) => el.attrs['aria-label'] === '下月').handlers.click({stopPropagation() {}});
  assert.equal(clock.timers.has(pending), false);
  assert.equal(view.calendar.month, '2026-11');
  assert.equal(view.calendar.selectedDate, '2026-11-01');
});
