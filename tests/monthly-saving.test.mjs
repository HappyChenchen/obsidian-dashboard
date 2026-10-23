import test from 'node:test';
import assert from 'node:assert/strict';
import {lib, fixture, elements} from './helpers.mjs';
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function editor(plugin) {
  const view = new lib.DashboardView({}, plugin);
  view.activeTab = 'monthly'; view.monthlyPlan.month = '2026-10';
  await view.render();
  return view;
}
const inputFor = (view) => elements(view.containerEl).find((el) => el.attrs['data-plan-date'] === '2026-10-12');
const text = (view) => elements(view.containerEl).map((el) => el.text).join(' ');

test('failed monthly save preserves saved records and draft through redraw, close and retry', async () => {
  const {plugin} = fixture('');
  plugin.settings.monthlyPlan['2026-10-12'] = 'Saved';
  plugin.settings.monthlyPlanDone['2026-10-12'] = true;
  plugin.saveData = async () => {throw new Error('disk full');};
  const view = await editor(plugin);
  const input = inputFor(view);
  input.value = 'Draft'; input.handlers.input();
  await input.handlers.blur();
  assert.equal(plugin.settings.monthlyPlan['2026-10-12'], 'Saved');
  assert.equal(plugin.settings.monthlyPlanDone['2026-10-12'], true);
  assert.match(text(view), /保存失败/);
  await view.render();
  assert.equal(inputFor(view).value, 'Draft');
  await view.onClose();
  const reopened = await editor(plugin);
  assert.equal(inputFor(reopened).value, 'Draft');
  plugin.saveData = async () => {};
  await elements(reopened.containerEl).find((el) => el.text === '重试').handlers.click();
  assert.equal(plugin.settings.monthlyPlan['2026-10-12'], 'Draft');
  assert.equal(plugin.settings.monthlyPlanDone['2026-10-12'], undefined);
  assert.match(text(reopened), /已保存/);
});

test('typing inline tags during an in-flight save retains the newest draft', async () => {
  const {plugin} = fixture('');
  let release;
  const blocked = new Promise((resolve) => {release = resolve;});
  const writes = [];
  plugin.saveData = async (value) => {writes.push(JSON.parse(JSON.stringify(value))); if (writes.length === 1) await blocked;};
  const view = await editor(plugin);
  const input = inputFor(view);
  input.value = 'First'; input.handlers.input();
  const saving = input.handlers.blur();
  await tick();
  input.value = 'Newest #学习'; input.handlers.input();
  await view.render();
  assert.equal(inputFor(view).value, 'Newest #学习');
  release(); await saving;
  assert.equal(plugin.settings.monthlyPlan['2026-10-12'], 'Newest #学习');
  assert.equal((await plugin.collectData()).tasks[0].category, '学习');
  assert.equal(plugin.settings.monthlyPlanCategory['2026-10-12'], undefined);
  assert.equal(writes.length, 2);
});

test('failed task completion and study writes preserve the original saved state', async () => {
  const {plugin, notices} = fixture('');
  plugin.settings.monthlyPlan['2026-10-12'] = 'Read';
  plugin.settings.studyCourses = [{id: 'read', module: 'Reading', label: 'Read', index: 1}];
  plugin.saveData = async () => {throw new Error('disk unavailable');};
  await plugin.toggleTask({source: 'monthly-plan', monthlyPlanDate: '2026-10-12'});
  await plugin.toggleStudyCheckin('read', '2026-10-12');
  assert.equal(plugin.settings.monthlyPlanDone['2026-10-12'], undefined);
  assert.equal(plugin.settings.studyCheckins.length, 0);
  assert.ok(notices.some((notice) => notice.includes('保存失败')));
});

test('clearing archive while a draft save is in flight cannot resurrect the draft', async () => {
  const {plugin} = fixture('');
  let release;
  const blocked = new Promise((resolve) => {release = resolve;});
  let writes = 0;
  plugin.saveData = async () => {if (++writes === 1) await blocked;};
  const view = await editor(plugin);
  const input = inputFor(view);
  input.value = 'Old'; input.handlers.input();
  const saving = input.handlers.blur(); await tick();
  const clearing = plugin.clearArchive();
  input.value = 'Stale'; input.handlers.input();
  release(); await Promise.all([saving, clearing]);
  await view.render();
  assert.equal(inputFor(view).value, '');
  assert.equal(plugin.monthlyPlanDrafts.size, 0);
  assert.equal(Object.keys(plugin.settings.monthlyPlan).length, 0);
});

test('background refresh does not replace a monthly editor during IME composition', async () => {
  const {plugin} = fixture('');
  const view = await editor(plugin);
  const input = inputFor(view);
  input.handlers.compositionstart();
  input.value = '正在输入'; input.handlers.input();
  await view.render();
  assert.equal(inputFor(view), input);
  input.handlers.compositionend();
  await view.render();
  assert.equal(inputFor(view).value, '正在输入');
});

test('inline plan tags stay consistent across home, month summaries, completion and deletion', async () => {
  const {plugin} = fixture('');
  const view = await editor(plugin);
  let input = inputFor(view);
  input.value = 'Read #学习'; input.handlers.input(); await input.handlers.blur();
  const marker = () => elements(view.containerEl).find((el) => el.cls.includes('dashboard-monthly-plan__day') && el.children.some((child) => child.attrs['data-plan-date'] === '2026-10-12'));
  assert.ok(marker().cls.includes('has-plan'));
  assert.ok(elements(marker()).some((el) => el.text === '●'));
  let data = await plugin.collectData();
  assert.equal(data.tasks[0].category, '学习');
  assert.equal(data.calendarTasks.get('2026-10-12').pending, 1);
  assert.equal((await plugin.collectDailyMonthSummaries('2026-10')).find((day) => day.date === '2026-10-12').monthlyPlanCategory, '学习');
  await plugin.toggleTask(data.tasks[0]); await view.render();
  assert.ok(elements(marker()).some((el) => el.text === '✓'));
  data = await plugin.collectData();
  assert.equal(data.calendarTasks.get('2026-10-12').completed, 1);
  input = inputFor(view); input.value = 'Walk #生活'; input.handlers.input(); await input.handlers.blur();
  data = await plugin.collectData();
  assert.equal(data.calendarTasks.get('2026-10-12').pending, 1);
  assert.equal(data.tasks[0].category, '生活');
  assert.ok(elements(marker()).some((el) => el.text === '●'));
  input.value = ''; input.handlers.input(); await input.handlers.blur();
  assert.equal((await plugin.collectData()).calendarTasks.has('2026-10-12'), false);
  assert.equal(marker().cls.includes('has-plan'), false);
  assert.equal(elements(marker()).some((el) => ['●', '✓'].includes(el.text)), false);
});

test('legacy category conversion preserves completion, and explicit tag removal stays removed', async () => {
  const {plugin} = fixture('');
  plugin.settings.monthlyPlan['2026-10-12'] = 'Read';
  plugin.settings.monthlyPlanCategory['2026-10-12'] = '学习';
  plugin.settings.monthlyPlanDone['2026-10-12'] = true;
  const view = await editor(plugin); const input = inputFor(view);
  assert.equal(input.value, 'Read #学习');
  input.handlers.input(); await input.handlers.blur();
  assert.equal(plugin.settings.monthlyPlanDone['2026-10-12'], true);
  assert.equal(plugin.settings.monthlyPlanCategory['2026-10-12'], undefined);
  input.value = 'Read'; input.handlers.input(); await input.handlers.blur();
  assert.equal((await plugin.collectData()).tasks[0].category, undefined);
  await plugin.saveTaskCategories('阅读', '');
  await plugin.saveMonthlyPlan('2026-10-12', 'Read #阅读');
  assert.equal((await plugin.collectData()).tasks[0].category, '阅读');
});

test('leaving the plan flushes newer edits even when a previous save is still running', async () => {
  const {plugin} = fixture('');
  let releaseFirst, releaseSecond;
  const first = new Promise((resolve) => {releaseFirst = resolve;});
  const second = new Promise((resolve) => {releaseSecond = resolve;});
  let writes = 0;
  plugin.saveData = async () => {if (++writes === 1) await first; else if (writes === 2) await second;};
  const view = await editor(plugin); const input = inputFor(view);
  input.value = 'First'; input.handlers.input();
  const saving = input.handlers.blur(); await tick();
  input.value = 'Latest #工作'; input.handlers.input();
  const home = elements(view.containerEl).find((el) => el.tag === 'button' && el.text === '首页');
  let switched = false;
  const switching = home.handlers.click().then(() => {switched = true;});
  releaseFirst(); await tick();
  assert.equal(switched, false);
  releaseSecond(); await Promise.all([saving, switching]);
  assert.equal(plugin.settings.monthlyPlan['2026-10-12'], 'Latest #工作');
  assert.equal(plugin.monthlyPlanDrafts.size, 0);
  assert.equal(view.activeTab, 'home');
});

test('monthly tags preview opens the original text for editing and retains a failed draft', async () => {
  const {plugin} = fixture('');
  plugin.settings.monthlyPlan['2026-10-12'] = 'Read on 2026-10-20 #学习 #reading';
  const view = await editor(plugin);
  const previewFor = () => elements(view.containerEl).find((el) => el.attrs['aria-label'] === '2026-10-12 编辑计划');
  let input = inputFor(view);
  assert.equal(input.hidden, true);
  let preview = previewFor();
  assert.equal(preview.hidden, false);
  assert.equal(elements(preview).find((el) => el.cls === 'dashboard-home__task-title').text, 'Read on 2026-10-20');
  assert.deepEqual(elements(preview).filter((el) => el.cls === 'dashboard-home__task-tag').map((el) => el.text), ['学习', 'reading']);
  preview.handlers.keydown({key: 'Enter', preventDefault() {}});
  assert.equal(input.hidden, false);
  assert.equal(preview.hidden, true);
  assert.equal(input.value, 'Read on 2026-10-20 #学习 #reading');
  assert.equal(view.calendar.selectedDate, '2026-10-12');
  input.value = 'Changed #生活'; input.handlers.input();
  await view.render();
  input = inputFor(view); preview = previewFor();
  assert.equal(input.hidden, false);
  assert.equal(input.value, 'Changed #生活');
  plugin.saveData = async () => {throw new Error('disk full');};
  await input.handlers.blur();
  assert.equal(input.hidden, true);
  assert.equal(preview.hidden, false);
  assert.ok(elements(preview).some((el) => el.cls === 'dashboard-home__task-tag' && el.text === '生活'));
  assert.equal(plugin.settings.monthlyPlan['2026-10-12'], 'Read on 2026-10-20 #学习 #reading');
  await view.render();
  previewFor().handlers.click();
  assert.equal(inputFor(view).value, 'Changed #生活');
  plugin.saveData = async () => {};
  inputFor(view).value = ''; inputFor(view).handlers.input(); await inputFor(view).handlers.blur();
  assert.equal(plugin.settings.monthlyPlan['2026-10-12'], undefined);
  assert.ok(elements(previewFor()).some((el) => el.cls === 'dashboard-monthly-plan__placeholder'));
  assert.equal(elements(previewFor()).some((el) => el.cls === 'dashboard-home__task-tag'), false);
});
