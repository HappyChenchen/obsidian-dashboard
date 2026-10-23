import test from 'node:test';
import assert from 'node:assert/strict';
import {lib, fixture, elements, Element} from './helpers.mjs';
const labels = (select) => select.children.map((option) => option.text);

test('new and old installs use general defaults without losing historical plan categories', async () => {
  const {plugin} = fixture('');
  plugin.loadData = async () => ({monthlyPlan: {'2026-10-12': 'Old plan'}, monthlyPlanCategory: {'2026-10-12': '公考'}});
  await plugin.loadSettings();
  assert.equal(plugin.settings.taskCategories.join(','), '生活,工作,学习,其他');
  assert.equal(plugin.settings.monthlyPlanCategory['2026-10-12'], '公考');
  assert.equal(plugin.settings.defaultTaskCategory, '');
  plugin.loadData = async () => ({taskCategories: [], defaultTaskCategory: '工作'});
  await plugin.loadSettings();
  assert.equal(plugin.settings.taskCategories.length, 0);
  assert.equal(plugin.settings.defaultTaskCategory, '');
});

test('category editing validates names, preserves order, deduplicates, and allows no categories', () => {
  assert.equal(lib.parseTaskCategories('阅读\n#生活/运动\nReading\nreading\n阅读').join(','), '阅读,生活/运动,Reading');
  assert.equal(lib.parseTaskCategories('\n').length, 0);
  for (const invalid of ['name with spaces', '123', '<tag>', 'a#b']) assert.throws(() => lib.parseTaskCategories(invalid), /分类/);
  const filters = lib.getCategoryFilters(['all', 'uncategorized']);
  assert.equal(new Set(filters.map((filter) => filter.id)).size, 4);
  assert.equal(lib.matchesCategoryFilter('all', 'category:all', ['all']), true);
});

test('custom categories reclassify cached notes without changing their text', async () => {
  const f = fixture('- [ ] Jog #运动\n- [ ] Read #Reading\n- [ ] Legacy #公考');
  const original = f.get();
  await f.plugin.collectData();
  await f.plugin.saveTaskCategories('运动\nreading', '运动');
  const data = await f.plugin.collectData();
  assert.equal(data.tasks.find((task) => task.text.includes('Jog')).category, '运动');
  assert.equal(data.tasks.find((task) => task.text.includes('Read')).category, 'reading');
  assert.equal(data.tasks.find((task) => task.text.includes('Legacy')).category, undefined);
  await f.plugin.saveTaskCategories('', '运动');
  assert.ok((await f.plugin.collectData()).tasks.every((task) => !task.category));
  assert.equal(f.plugin.settings.defaultTaskCategory, '');
  assert.equal(f.get(), original);
});

test('capture applies the chosen/default category once, respects written tags and supports no category', async () => {
  const f = fixture('## 今日todo\n');
  f.plugin.ensureDailyNote = async () => f.file;
  await f.plugin.saveTaskCategories('运动\n阅读', '运动');
  await f.plugin.appendTaskToToday('Jog');
  await f.plugin.appendTaskToToday('Read #阅读');
  await f.plugin.appendTaskToToday('No category', '');
  await f.plugin.appendTaskToDate('2026-10-14', 'Monthly uncategorized', '');
  assert.match(f.get(), /- \[ \] Jog #运动/);
  assert.match(f.get(), /- \[ \] Read #阅读\n/);
  assert.match(f.get(), /- \[ \] No category\n/);
  assert.match(f.get(), /- \[ \] Monthly uncategorized(?:\n|$)/);
  await assert.rejects(f.plugin.appendTaskToToday('Stale selection', '工作'), /已停用/);
  assert.doesNotMatch(f.get(), /Stale selection/);
});

test('settings retain their draft on failed save and only publish successful category changes', async () => {
  const {plugin} = fixture('');
  const tab = new lib.DashboardSettingTab(plugin.app, plugin);
  const root = new Element();
  tab.renderTaskCategories(root);
  const input = elements(root).find((el) => el.tag === 'textarea');
  const select = elements(root).find((el) => el.tag === 'select');
  const save = elements(root).find((el) => el.text === '保存标签');
  input.value = '阅读\n运动'; input.handlers.input(); select.value = '运动';
  plugin.saveData = async () => {throw new Error('disk full');};
  await save.handlers.click();
  assert.equal(input.value, '阅读\n运动');
  assert.equal(plugin.settings.taskCategories.includes('运动'), false);
  assert.equal(plugin.settings.defaultTaskCategory, '');
  assert.ok(elements(root).some((el) => /disk full|标签保存失败/.test(el.text)));
  plugin.saveData = async () => {};
  await save.handlers.click();
  assert.equal(plugin.settings.taskCategories.join(','), '阅读,运动');
  assert.equal(plugin.settings.defaultTaskCategory, '运动');
});

test('home selectors use configured options; monthly plans use inline tags and preserve legacy categories', async () => {
  const {plugin} = fixture('- [ ] Jog #运动');
  await plugin.saveTaskCategories('运动\n阅读', '运动');
  const view = new lib.DashboardView({}, plugin);
  await view.render();
  const quick = elements(view.containerEl).find((el) => el.attrs['aria-label'] === '新增待办标签');
  assert.equal(labels(quick).join(','), '不添加标签,运动,阅读');
  assert.equal(quick.value, '运动');
  const filter = elements(view.containerEl).find((el) => el.attrs['aria-label'] === '待办标签');
  assert.equal(labels(filter).join(','), '全部,运动,无标签');
  filter.value = 'category:运动'; filter.handlers.change();
  await plugin.saveTaskCategories('阅读', '');
  await view.render();
  assert.equal(view.todoCategory, 'category:运动');
  plugin.settings.monthlyPlan['2026-10-12'] = 'Historical plan';
  plugin.settings.monthlyPlanCategory['2026-10-12'] = '公考';
  view.activeTab = 'monthly'; view.monthlyPlan.month = '2026-10';
  await view.render();
  assert.equal(elements(view.containerEl).some((el) => el.tag === 'select'), false);
  const input = elements(view.containerEl).find((el) => el.attrs['data-plan-date'] === '2026-10-12');
  assert.equal(input.value, 'Historical plan #公考');
  input.value = 'Edited historical plan #公考'; input.handlers.input(); await input.handlers.blur();
  assert.equal(plugin.settings.monthlyPlan['2026-10-12'], 'Edited historical plan #公考');
  assert.equal(plugin.settings.monthlyPlanCategory['2026-10-12'], undefined);
});

test('monthly diary allows adding an uncategorized task when categories are empty', async () => {
  const f = fixture('## 今日todo\n');
  f.plugin.ensureDailyNote = async () => f.file;
  await f.plugin.saveTaskCategories('', '');
  const modal = new lib.AddMonthlyTodoModal(f.plugin.app, f.plugin, '2026-10-14', async () => {});
  modal.open();
  const input = elements(modal.contentEl).find((el) => el.tag === 'input');
  input.value = 'Just write'; input.handlers.input();
  const submit = elements(modal.contentEl).find((el) => el.text === '添加');
  assert.equal(submit.disabled, false);
  await submit.handlers.click();
  assert.equal(modal.opened, false);
  assert.match(f.get(), /- \[ \] Just write(?:\n|$)/);
});

test('new daily template uses the configured categories instead of fixed suggestions', async () => {
  const {plugin, file} = fixture('');
  plugin.settings.dailyFolder = ''; plugin.settings.defaultTaskSection = 'Tasks';
  await plugin.saveTaskCategories('运动\n阅读', '');
  let content;
  plugin.app.vault.create = async (_path, text) => {content = text; return file;};
  await plugin.ensureDailyNote('2026-10-14');
  assert.match(content, /分类：.*#运动、#阅读/);
  assert.doesNotMatch(content, /#公考|#工作/);
});
