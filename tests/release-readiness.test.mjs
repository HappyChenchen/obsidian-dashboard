import test from 'node:test';
import assert from 'node:assert/strict';
import {lib, fixture, elements, TFile} from './helpers.mjs';
const clone = (value) => JSON.parse(JSON.stringify(value));
const date = '2026-10-23';

test('free tags filter by every tag, without adding default labels or URL fragments', async () => {
  const {plugin} = fixture('- [ ] Trip #出行 #生活\n- [ ] Other');
  const data = await plugin.collectData();
  assert.equal(lib.matchesTaskTags(data.tasks[0], 'category:出行'), true);
  assert.equal(lib.matchesTaskTags(data.tasks[0], 'category:生活'), true);
  assert.equal(lib.matchesTaskTags(data.tasks[0], 'uncategorized'), false);
  assert.equal(lib.getTagFilters(data.tasks).map(x=>x.label).join(','), '全部,出行,生活,无标签');
  assert.equal(lib.withTaskCategory('Trip #出行', '生活', ['生活']), 'Trip #出行');
  assert.equal(lib.getTaskTags('https://example.com/#section #旅行 #123').join(','), '#旅行');
});

test('multiple plans retain individual completion and identity through reordering and insertion', async () => {
  const {plugin} = fixture('');
  await plugin.saveMonthlyPlan(date, 'Groceries #生活\nReading #学习');
  let tasks = plugin.getMonthlyPlanTasks(date);
  await plugin.toggleTask(tasks[1]);
  await plugin.saveMonthlyPlan(date, 'Reading #学习\nNew #出行\nGroceries #生活');
  const next = plugin.getMonthlyPlanTasks(date);
  assert.equal(next.length, 3);
  assert.equal(next[0].monthlyPlanItemId, tasks[1].monthlyPlanItemId);
  assert.equal(next[0].done, true);
  assert.equal(next[1].done, false);
  const day = (await plugin.collectData()).calendarTasks.get(date);
  assert.equal(day.pending, 2); assert.equal(day.completed, 1);
  const summary = (await plugin.collectDailyMonthSummaries('2026-10'))[22];
  assert.equal(summary.todos.length, 3);
  await plugin.saveMonthlyPlan(date, 'Replacement');
  await assert.rejects(plugin.toggleMonthlyPlanTask(date, tasks[0].monthlyPlanItemId), /已变更/);
  assert.equal(plugin.getMonthlyPlanTasks(date)[0].done, false);
});

test('duplicate lines remain separate and legacy multiline completion migrates losslessly', () => {
  const settings = lib.decodeSettings({monthlyPlan: {[date]: 'Read\nWalk'}, monthlyPlanDone: {[date]: true}, monthlyPlanCategory: {[date]: '生活'}, taskOrder: ['note-before', `monthly-plan:${date}`, 'note-after']});
  assert.equal(settings.monthlyPlanItems[date].length, 2);
  assert.equal(settings.monthlyPlanItems[date].every(item => item.done), true);
  assert.equal(settings.dailySetupComplete, true);
  assert.equal(settings.taskOrder.length, 4);
  assert.equal(settings.taskOrder[0], 'note-before');
  assert.equal(settings.taskOrder[3], 'note-after');
  lib.replacePlan(settings, date, 'Same\nSame');
  assert.notEqual(settings.monthlyPlanItems[date][0].id, settings.monthlyPlanItems[date][1].id);
  const imported = lib.readBackup(lib.backupDocument(settings));
  assert.deepEqual(clone(imported), clone(settings));
});

async function synced() {
  const {plugin} = fixture('');
  let disk = clone(plugin.settings);
  const backups = [];
  plugin.loadData = async () => clone(disk);
  plugin.saveData = async value => {disk = clone(value);};
  plugin.writeBackup = async (reason, settings = plugin.snapshotWithDrafts()) => {backups.push({reason, settings: clone(settings)}); return 'backup';};
  await plugin.loadSettings();
  return {plugin, backups, read:()=>disk, external:(change)=>{const next=clone(disk); change(next);disk=next;}};
}

test('sync merges independent dates and preferences before writing, including external refresh', async () => {
  const {plugin, read, external} = await synced();
  external(s => {lib.replacePlan(s, '2026-10-24', 'Remote'); s.homeTitle = 'Remote title';});
  await plugin.saveMonthlyPlan(date, 'Local');
  assert.equal(read().monthlyPlan['2026-10-24'], 'Remote');
  assert.equal(read().monthlyPlan[date], 'Local');
  assert.equal(plugin.settings.homeTitle, 'Remote title');
  external(s => {s.homeTitle = 'Changed again';});
  await plugin.onExternalSettingsChange();
  assert.equal(plugin.settings.homeTitle, 'Changed again');
});

test('same-day sync conflict preserves both versions and does not overwrite disk', async () => {
  const {plugin, read, external, backups} = await synced();
  await plugin.saveMonthlyPlan(date, 'Original');
  external(s => lib.replacePlan(s, date, 'Remote edit'));
  await assert.rejects(plugin.saveMonthlyPlan(date, 'Local edit'), /同步冲突/);
  assert.equal(read().monthlyPlan[date], 'Remote edit');
  assert.equal(plugin.settings.monthlyPlan[date], 'Original');
  assert.equal(plugin.syncConflict, true);
  assert.equal(backups.find(b => b.reason === 'conflict-local').settings.monthlyPlan[date], 'Local edit');
  assert.equal(backups.find(b => b.reason === 'conflict-remote').settings.monthlyPlan[date], 'Remote edit');
});

test('a failed merged write can retry without undoing remote changes', async () => {
  const {plugin, external, read} = await synced();
  external(s => {s.homeTitle = 'Remote';});
  const write = plugin.saveData;
  plugin.saveData = async () => {throw new Error('disk full');};
  await assert.rejects(plugin.saveMonthlyPlan(date, 'Local'), /disk full/);
  plugin.saveData = write;
  await plugin.saveMonthlyPlan(date, 'Local');
  assert.equal(read().homeTitle, 'Remote');
});

test('external changes cannot overwrite an unsaved monthly draft on blur', async () => {
  const {plugin, external, read} = await synced();
  await plugin.saveMonthlyPlan(date, 'Original');
  const view = new lib.DashboardView({}, plugin);
  view.activeTab = 'monthly'; view.monthlyPlan.month = '2026-10'; await view.render();
  const input = view.monthlyPlan.editDate(date);
  input.value = 'Unsaved'; input.handlers.input();
  external(s => lib.replacePlan(s, date, 'Remote'));
  await plugin.onExternalSettingsChange();
  await input.handlers.blur();
  assert.equal(read().monthlyPlan[date], 'Remote');
  assert.equal(plugin.monthlyPlanDrafts.get(date).text, 'Unsaved');
  assert.equal(plugin.monthlyPlanDrafts.get(date).status, 'error');
  await plugin.restoreBackup(plugin.snapshotWithDrafts());
  assert.equal(read().monthlyPlan[date], 'Unsaved');
  assert.equal(plugin.monthlyPlanDrafts.size, 0);
});

test('backup validation rejects unrelated, future and malformed data; recovery leaves Markdown alone', async () => {
  assert.throws(() => lib.readBackup('{}'), /Daily/);
  assert.throws(() => lib.readBackup('{"format":"daily-backup","version":99}'), /Daily/);
  const f = fixture('- [ ] Original note');
  await f.plugin.saveMonthlyPlan(date, 'Original');
  const backup = f.plugin.snapshotWithDrafts();
  await f.plugin.saveMonthlyPlan(date, 'Changed');
  await f.plugin.restoreBackup(backup);
  assert.equal(f.plugin.settings.monthlyPlan[date], 'Original');
  assert.equal(f.get(), '- [ ] Original note');
  const broken = JSON.parse(lib.backupDocument(backup)); broken.settings.monthlyPlan[date] = 123;
  assert.throws(() => lib.readBackup(JSON.stringify(broken)), /无效/);
  const previous = clone(f.plugin.settings);
  f.plugin.writeBackup = async () => {throw new Error('backup failed');};
  await assert.rejects(f.plugin.clearArchive(), /backup failed/);
  assert.deepEqual(clone(f.plugin.settings), previous);
});

test('diary setup handles literal core folders, nested date names and prevents premature creation', async () => {
  const {plugin} = fixture('');
  await plugin.configureDaily('Journal', 'YYYY/MM/YYYY-MM-DD', true);
  assert.equal(lib.dailyPath(plugin.settings, date), 'Journal/2026/10/2026-10-23.md');
  assert.equal(plugin.getDateFromDailyFile(new TFile('Journal/2026/10/2026-10-23.md')), date);
  assert.equal(plugin.getDateFromDailyFile(new TFile('Other/2026/10/2026-10-23.md')), undefined);
  assert.throws(()=>lib.validateDailyLocation('../outside','YYYY-MM-DD'), /相对/);
  assert.throws(()=>lib.validateDailyLocation('Journal','YYYY-MM'), /年月日/);
  assert.equal(lib.decodeSettings(null).dailySetupComplete, false);
  plugin.settings.dailySetupComplete = false;
  plugin.showDailySetup = async () => false;
  let created = false; plugin.app.vault.create = async () => {created=true;};
  await assert.rejects(plugin.ensureDailyNote(date), /确认日记/);
  assert.equal(created, false);
});

test('button ordering works without drag and preserves task text', async () => {
  const f = fixture('- [ ] A\n- [ ] B');
  const view = new lib.DashboardView({}, f.plugin); await view.render();
  const down = elements(view.containerEl).find(el => el.attrs['aria-label'] === '下移：A');
  await down.handlers.click();
  assert.equal((await f.plugin.collectData()).tasks.map(t=>t.text).join(','), 'B,A');
  assert.equal(f.get(), '- [ ] A\n- [ ] B');
});

test('consecutive completion writes and self-refresh never create a false sync conflict', async () => {
  const {plugin, read, external} = await synced();
  await plugin.saveMonthlyPlan(date, 'First\nSecond');
  for (const task of plugin.getMonthlyPlanTasks(date)) await plugin.toggleMonthlyPlanTask(date, task.monthlyPlanItemId);
  assert.equal(read().monthlyPlanDone[date], true);
  await plugin.onExternalSettingsChange();
  for (const task of plugin.getMonthlyPlanTasks(date)) await plugin.toggleMonthlyPlanTask(date, task.monthlyPlanItemId);
  assert.equal(plugin.getMonthlyPlanTasks(date).some(t=>t.done), false);
  external(s=>{s.monthlyPlanDone[date]=false;});
  await plugin.toggleMonthlyPlanTask(date, plugin.getMonthlyPlanTasks(date)[0].monthlyPlanItemId);
  assert.equal(plugin.syncConflict, false);
});
