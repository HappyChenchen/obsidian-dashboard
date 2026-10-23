import test from 'node:test';
import assert from 'node:assert/strict';
import { lib, fixture, TFile, elements, moment, Element } from './helpers.mjs';

const copy = (value) => JSON.parse(JSON.stringify(value));
function notesFixture(notes) {
  const f = fixture('');
  const files = Object.keys(notes).map((path) => new TFile(path));
  f.plugin.app.vault.getMarkdownFiles = () => files;
  f.plugin.app.vault.cachedRead = async (file) => notes[file.path];
  f.plugin.app.vault.getAbstractFileByPath = (path) => files.find((file) => file.path === path);
  return { ...f, files };
}
const taskTexts = (data) => data.tasks.map((task) => task.text).sort().join(',');

test('old settings keep existing defaults; malformed new preferences fall back safely', async () => {
  const { plugin } = fixture('');
  plugin.loadData = async () => ({ defaultTaskSection: 'Tasks' });
  await plugin.loadSettings();
  assert.equal(plugin.settings.homeTitle, '今天');
  assert.equal(plugin.settings.defaultTaskSection, 'Tasks');
  assert.equal(plugin.settings.taskSource, 'all');
  assert.equal(plugin.settings.completedTaskDisplay, 'hide');
  assert.equal(plugin.settings.weekStartsOn, 0);
  plugin.loadData = async () => ({homeTitle: null, weekStartsOn: 7, recentThoughtCount: -1, taskFolders: [null, '../outside', 'Notes'], dailyPreviewSections: 'bad'});
  await plugin.loadSettings();
  assert.equal(plugin.settings.homeTitle, '今天');
  assert.equal(plugin.settings.weekStartsOn, 0);
  assert.equal(plugin.settings.recentThoughtCount, 3);
  assert.equal(plugin.settings.taskFolders.join(','), 'Notes');
  assert.equal(plugin.settings.dailyPreviewSections.length, 0);
});

test('source scopes apply to cached tasks and calendar without changing notes or hiding monthly plans', async () => {
  const notes = {
    'Daily/2026/10/2026-10-14.md': '## 今日todo\nDaily loose\n- [x] Daily done',
    'Notes/Work/task.md': '- [ ] Work 📅 2026-10-14',
    'Notes/Work/Sub/task.md': '- [ ] Child 📅 2026-10-14',
    'Notes/Workshop/task.md': '- [ ] Sibling 📅 2026-10-14',
    'Notes/Work/Archive/task.md': '- [ ] Archive 📅 2026-10-14',
  };
  const original = JSON.stringify(notes);
  const { plugin } = notesFixture(notes);
  plugin.settings.monthlyPlan = {'2026-10-14': 'Plan'};
  assert.equal((await plugin.collectData()).tasks.length, 6);
  await plugin.savePreferences({taskSource: 'folders', taskFolders: ['Notes/Work'], taskExcludedFolders: ['Notes/Work/Archive']});
  let data = await plugin.collectData();
  assert.equal(taskTexts(data), 'Child 📅 2026-10-14,Plan,Work 📅 2026-10-14');
  assert.equal(data.calendarTasks.get('2026-10-14').pending, 3);
  assert.equal(data.calendarTasks.get('2026-10-14').completed, 0);
  await plugin.savePreferences({taskSource: 'daily'});
  data = await plugin.collectData();
  assert.equal(taskTexts(data), 'Daily loose,Plan');
  assert.equal(data.calendarTasks.get('2026-10-14').completed, 1);
  await plugin.savePreferences({taskExcludedFolders: ['Daily']});
  data = await plugin.collectData();
  assert.equal(taskTexts(data), 'Plan');
  assert.equal((await plugin.collectDailyMonthSummaries('2026-10'))[13].todos.length, 1);
  assert.equal(JSON.stringify(notes), original);
});

test('folder input accepts relative subfolders, rejects traversal and never matches sibling prefixes', () => {
  assert.equal(lib.parseTaskFolders(' Notes/Work/\nNotes\\Work\n\nArchive ').join(','), 'Notes/Work,Archive');
  for (const invalid of ['../Notes', '/Users/example', 'Notes/../Other', 'C:\\Notes', 'Notes/*', './Notes']) {
    assert.throws(() => lib.parseTaskFolders(invalid), /相对/);
  }
});

test('failed saves preserve all preferences; concurrent updates to separate groups both survive', async () => {
  const { plugin } = fixture('');
  const original = copy(plugin.settings);
  plugin.saveData = async () => { throw new Error('disk full'); };
  await assert.rejects(plugin.savePreferences({homeTitle: 'My day', completedTaskDisplay: 'show'}), /disk full/);
  assert.deepEqual(copy(plugin.settings), original);
  plugin.saveData = async () => {};
  await Promise.all([plugin.savePreferences({homeTitle: 'My day'}), plugin.savePreferences({weekStartsOn: 1})]);
  assert.equal(plugin.settings.homeTitle, 'My day');
  assert.equal(plugin.settings.weekStartsOn, 1);
  await assert.rejects(plugin.savePreferences({taskSource: 'folders', taskFolders: []}), /至少/);
  assert.equal(plugin.settings.taskSource, 'all');
  await assert.rejects(plugin.savePreferences({defaultTaskSection: 'Same', thoughtSection: 'Same'}), /不同/);
});

test('custom headings update parsing, new templates, recent thoughts and monthly summaries without rewriting old content', async () => {
  const original = '## Tasks\nLoose task\n## Ideas\nCustom idea\n## 想法/思考\nLegacy idea';
  const f = fixture(original, 'Daily/2026/10/2026-10-14.md');
  await f.plugin.collectData();
  await f.plugin.savePreferences({defaultTaskSection: 'Tasks', thoughtSection: 'Ideas'});
  const data = await f.plugin.collectData();
  assert.equal(data.tasks[0].text, 'Loose task');
  assert.equal(data.recentThoughts[0].previewSections.map((section) => section.text).join(','), 'Custom idea,Legacy idea');
  f.plugin.app.vault.getAbstractFileByPath = (path) => path === f.file.path ? f.file : null;
  const summaries = await f.plugin.collectDailyMonthSummaries('2026-10');
  assert.equal(summaries[13].inspiration, 'Custom idea');
  assert.equal(f.get(), original);
  f.plugin.settings.dailyFolder = '';
  let created;
  f.plugin.app.vault.create = async (_path, content) => {created = content; return f.file;};
  await f.plugin.ensureDailyNote('2026-10-15');
  assert.match(created, /## Tasks/); assert.match(created, /## Ideas/);
  assert.doesNotMatch(created, /## 今日todo|## 想法\/思考/);
});

test('home honors title, chosen preview headings and recent record limits including zero', async () => {
  const previousNow = moment.now;
  moment.now = () => +new Date('2026-10-14T12:00:00');
  try {
    const notes = {'Daily/2026/10/2026-10-14.md': '## 今日todo\n- [ ] Today\n## Ideas\nShown idea\n## Private\nHidden section'};
    for (let day = 1; day <= 10; day++) notes['Daily/2026/10/2026-10-' + String(day).padStart(2, '0') + '.md'] = '## Ideas\nRecent idea';
    const { plugin } = notesFixture(notes);
    plugin.settings.visiblePanels = {calendar: false, daily: true, todo: false, study: false, database: false};
    await plugin.savePreferences({homeTitle: 'My day', thoughtSection: 'Ideas', dailyPreviewSections: ['Ideas'], recentThoughtCount: 5});
    const view = new lib.DashboardView({}, plugin);
    await view.render();
    let all = elements(view.containerEl);
    assert.ok(all.some((el) => el.tag === 'h1' && el.text === 'My day'));
    assert.ok(all.some((el) => el.text === 'Shown idea'));
    assert.equal(all.some((el) => el.text === 'Hidden section'), false);
    assert.equal(all.filter((el) => el.cls === 'dashboard-home__thought-item').length, 5);
    await plugin.savePreferences({recentThoughtCount: 0});
    await view.render();
    assert.equal(elements(view.containerEl).some((el) => el.text === '近期笔记'), false);
  } finally { moment.now = previousNow; }
});

test('completed task display supports hide, collapse, show, category filtering and undo', async () => {
  const f = fixture('- [ ] Open #工作\n- [x] Done #工作\n- [x] Other #生活');
  f.plugin.settings.visiblePanels = {calendar: false, daily: false, todo: true, study: false, database: false};
  const view = new lib.DashboardView({}, f.plugin);
  await view.render();
  assert.equal(elements(view.containerEl).filter((el) => el.attrs.type === 'checkbox').length, 1);
  await f.plugin.savePreferences({completedTaskDisplay: 'collapsed'});
  view.todoCategory = 'category:工作';
  await view.render();
  const details = elements(view.containerEl).find((el) => el.tag === 'details');
  assert.equal(details.open, false);
  assert.ok(elements(details).some((el) => el.text === '已完成 · 1'));
  details.open = true; details.handlers.toggle();
  await view.render();
  assert.equal(elements(view.containerEl).find((el) => el.tag === 'details').open, true);
  const done = elements(view.containerEl).find((el) => el.attrs.type === 'checkbox' && el.checked);
  await done.handlers.change();
  assert.match(f.get(), /- \[ \] Done/);
  await f.plugin.savePreferences({completedTaskDisplay: 'show'});
  view.todoCategory = 'all'; await view.render();
  assert.equal(elements(view.containerEl).some((el) => el.tag === 'details'), false);
  assert.ok(elements(view.containerEl).some((el) => el.text === '已完成 · 1'));
  assert.equal(elements(view.containerEl).find((el) => el.cls === 'dashboard-home__task is-done').attrs.draggable, 'false');
});

test('Monday start aligns every calendar including a month starting Sunday and the study year grid', async () => {
  const { plugin } = fixture('');
  await plugin.savePreferences({weekStartsOn: 1});
  const view = new lib.DashboardView({}, plugin);
  view.calendar.month = '2026-11';
  await view.render();
  let all = elements(view.containerEl);
  assert.equal(all.find((el) => el.cls === 'dashboard-home__calendar-weekday').text, 'M');
  assert.match(all.find((el) => el.cls.split(' ').includes('dashboard-home__calendar-day')).attrs['aria-label'], /^2026-11-01/);
  assert.equal(all.filter((el) => el.cls === 'dashboard-home__calendar-empty').length, 6);
  view.activeTab = 'monthly'; view.monthlyPlan.month = '2026-11';
  await view.render(); all = elements(view.containerEl);
  assert.equal(all.find((el) => el.cls === 'dashboard-monthly-plan__weekday').text, '一');
  assert.equal(all.filter((el) => el.cls === 'dashboard-monthly-plan__empty').length, 6);
  const diary = new lib.MonthlyDiaryView({}, plugin); diary.month = '2026-11';
  await diary.render(); all = elements(diary.containerEl);
  assert.equal(all.find((el) => el.cls === 'dashboard-monthly-panel__weekday').text, '一');
  assert.equal(all.filter((el) => el.cls === 'dashboard-monthly-panel__empty').length, 6);
  plugin.settings.studyEnabled = true;
  plugin.settings.studyCourses = [{id: 'read', module: 'Reading', label: 'Chapter', index: 1}];
  const study = lib.StudyTrackerView.createEmbedded(plugin);
  study.cursor = moment('2026-11-01');
  const root = new Element();
  await study.renderTo(root);
  assert.equal(elements(root).filter((el) => el.cls === 'dashboard-study-calendar__empty').length, 6);
  study.mode = 'year'; await study.renderTo(root);
  const november = elements(root).filter((el) => el.cls === 'dashboard-study-year__month')[10];
  assert.equal(elements(november).filter((el) => el.cls === 'dashboard-study-calendar__empty').length, 6);
  await plugin.savePreferences({weekStartsOn: 0});
  view.activeTab = 'home'; await view.render();
  assert.match(elements(view.containerEl).find((el) => el.cls.split(' ').includes('dashboard-home__calendar-day')).attrs['aria-label'], /^2026-11-01/);
});

test('capture outside configured sources writes to the diary and explains why it is hidden', async () => {
  const f = fixture('## 今日todo\n', 'Daily/2026/10/2026-10-14.md');
  f.plugin.ensureDailyNote = async () => f.file;
  await f.plugin.savePreferences({taskSource: 'folders', taskFolders: ['Work']});
  await f.plugin.appendTaskToToday('Captured');
  assert.match(f.get(), /- \[ \] Captured/);
  assert.equal((await f.plugin.collectData()).tasks.length, 0);
  assert.match(f.notices.at(-1), /当前待办来源未包含/);
});
