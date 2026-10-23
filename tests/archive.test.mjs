import test from 'node:test';
import assert from 'node:assert/strict';
import {lib, fixture, elements} from './helpers.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
function archiveFixture() {
  const f = fixture('- [x] Keep completed note task\n- [ ] Keep open note task');
  Object.assign(f.plugin.settings, {
    dailyFolder: 'Journal/YYYY',
    studyEnabled: true,
    studyCourses: [{id: 'reading', module: 'Reading', label: 'Chapter 1', index: 1}],
    monthlyPlan: {'2026-10-12': 'Read'},
    monthlyPlanDone: {'2026-10-12': true},
    monthlyPlanCategory: {'2026-10-12': '学习'},
    studyCheckins: [{courseId: 'reading', date: '2026-10-11', checkedAt: 1}],
    taskOrder: ['note-order'],
  });
  return f;
}

test('clearing archive persists only cleared records, preserves notes and settings, and refreshes every view', async () => {
  const f = archiveFixture();
  const originalNote = f.get();
  const expected = {...clone(f.plugin.settings), monthlyPlan: {}, monthlyPlanDone: {}, monthlyPlanCategory: {}, studyCheckins: [], taskOrder: []};
  let saved;
  const refreshed = [];
  f.plugin.saveData = async (data) => {saved = clone(data);};
  for (const name of ['refreshDashboardViews', 'refreshMonthlyDiaryViews', 'refreshStudyTrackerViews']) {
    f.plugin[name] = () => refreshed.push(name);
  }
  await f.plugin.clearArchive();
  assert.deepEqual(saved, expected);
  assert.deepEqual(clone(f.plugin.settings), expected);
  assert.equal(f.get(), originalNote);
  assert.equal(refreshed.length, 3);
  const data = await f.plugin.collectData();
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].text, 'Keep open note task');
});

test('failed archive persistence restores records and permits retry', async () => {
  const f = archiveFixture();
  const original = clone(f.plugin.settings);
  f.plugin.saveData = async () => {throw new Error('disk unavailable');};
  await assert.rejects(f.plugin.clearArchive(), /disk unavailable/);
  assert.deepEqual(clone(f.plugin.settings), original);
  f.plugin.saveData = async () => {};
  await f.plugin.clearArchive();
  assert.equal(Object.keys(f.plugin.settings.monthlyPlan).length, 0);
});

test('clearing waits for an in-flight save so the older snapshot cannot restore the archive', async () => {
  const f = archiveFixture();
  let release;
  const firstWrite = new Promise((resolve) => {release = resolve;});
  const writes = [];
  f.plugin.saveData = async (data) => {
    if (!writes.length) await firstWrite;
    writes.push(clone(data));
  };
  const saving = f.plugin.saveMonthlyPlanText('2026-10-12', 'Old draft');
  const clearing = f.plugin.clearArchive();
  await assert.rejects(f.plugin.clearArchive(), /正在清除/);
  release();
  await Promise.all([saving, clearing]);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].monthlyPlan['2026-10-12'], 'Old draft');
  assert.deepEqual(writes[1].monthlyPlan, {});
});

test('stale monthly editor callbacks cannot restore cleared records; fresh edits still save', async () => {
  const f = archiveFixture();
  const view = new lib.DashboardView({}, f.plugin);
  view.activeTab = 'monthly';
  view.monthlyPlan.month = '2026-10';
  await view.render();
  const oldInput = elements(view.containerEl).find((element) => element.tag === 'textarea');
  oldInput.value = 'Stale draft #工作';
  await f.plugin.clearArchive();
  oldInput.handlers.blur();
  oldInput.handlers.input();
  assert.deepEqual(clone(f.plugin.settings.monthlyPlan), {});
  assert.deepEqual(clone(f.plugin.settings.monthlyPlanCategory), {});
  await f.plugin.saveMonthlyPlanText('2026-10-12', 'Fresh plan');
  assert.equal(f.plugin.settings.monthlyPlan['2026-10-12'], 'Fresh plan');
});

test('archive dialog requires confirmation, cancellation is harmless, and failed confirmation stays open', async () => {
  const f = archiveFixture();
  const original = clone(f.plugin.settings);
  let saves = 0;
  f.plugin.saveData = async () => {saves += 1;};
  const modal = new lib.ClearArchiveModal(f.plugin.app, f.plugin);
  modal.open();
  assert.equal(saves, 0);
  elements(modal.contentEl).find((element) => element.text === '取消').handlers.click();
  assert.equal(modal.opened, false);
  assert.deepEqual(clone(f.plugin.settings), original);
  modal.open();
  f.plugin.saveData = async () => {throw new Error('disk unavailable');};
  await elements(modal.contentEl).find((element) => element.text === '确认清除存档').handlers.click();
  assert.equal(modal.opened, true);
  assert.deepEqual(clone(f.plugin.settings), original);
  assert.match(elements(modal.contentEl).find((element) => element.attrs.role === 'alert').text, /未完成清除/);
  f.plugin.saveData = async () => {saves += 1;};
  await elements(modal.contentEl).find((element) => element.text === '重试清除').handlers.click();
  assert.equal(modal.opened, false);
  assert.equal(saves, 1);
});
