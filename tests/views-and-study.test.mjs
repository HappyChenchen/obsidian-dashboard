import test from 'node:test';
import assert from 'node:assert/strict';
import {lib, fixture, elements} from './helpers.mjs';

function viewFixture() {
  const f = fixture('');
  f.plugin.settings.visiblePanels = Object.fromEntries(Object.keys(f.plugin.settings.visiblePanels).map((key) => [key, false]));
  const view = new lib.DashboardView({}, f.plugin);
  return {...f, view, root: view.containerEl.children[1]};
}

test('automatic refresh preserves the quick task draft', async () => {
  const {view, root} = viewFixture();
  await view.render();
  const input = elements(root).find((element) => element.tag === 'input');
  input.value = 'Unsubmitted task';
  input.handlers.input();
  await view.render();
  assert.equal(elements(root).find((element) => element.tag === 'input').value, 'Unsubmitted task');
});

test('an older asynchronous refresh cannot replace a newer result', async () => {
  const {view, plugin} = viewFixture();
  const pending = [];
  plugin.collectData = () => new Promise((resolve) => pending.push(resolve));
  let shown;
  view.renderHeader = (_root, data) => {shown = data.today;};
  const oldRender = view.render();
  const newRender = view.render();
  pending[1]({today: 'new'}); await newRender;
  pending[0]({today: 'old'}); await oldRender;
  assert.equal(shown, 'new');
});

test('closing the view invalidates pending renders', async () => {
  const {view, plugin, root} = viewFixture();
  let finish;
  plugin.collectData = () => new Promise((resolve) => {finish = resolve;});
  const rendering = view.render();
  await view.onClose();
  finish({today: '2026-10-11'}); await rendering;
  assert.equal(root.children.length, 0);
});

test('monthly planning does not scan the vault on every render', async () => {
  const {view, plugin} = viewFixture();
  view.activeTab = 'monthly';
  view.renderMonthlyPlan = () => {};
  let reads = 0;
  plugin.collectData = () => {reads += 1; throw new Error('Unexpected vault scan');};
  await view.render();
  assert.equal(reads, 0);
  assert.equal(plugin.settings.studyEnabled, false);
});

test('course reordering keeps check-in identities and malformed input is rejected', () => {
  const original = lib.parseStudyCourses('Reading | Chapter 1\nLanguage | Lesson 1', []);
  const reordered = lib.parseStudyCourses('Language | Lesson 1\nReading | Chapter 1', original);
  assert.equal(reordered[1].id, original[0].id);
  assert.throws(() => lib.parseStudyCourses('Missing separator', original));
});

test('removing a course preserves stored check-in history', () => {
  const checkins = lib.normalizeStudyCheckins([{courseId: 'removed-course', date: '2026-10-11', checkedAt: 1}]);
  assert.equal(checkins.length, 1);
});

test('migrates personal-version courses only when historical check-ins exist', async () => {
  const {plugin} = fixture('');
  plugin.loadData = async () => ({studyCheckins: [{courseId: '资料-1', date: '2026-10-11', checkedAt: 1}]});
  await plugin.loadSettings();
  assert.equal(plugin.settings.studyCheckins.length, 1);
  assert.ok(plugin.getStudyCourses().some((course) => course.id === '资料-1'));
  plugin.loadData = async () => null;
  await plugin.loadSettings();
  assert.equal(plugin.getStudyCourses().length, 0);
});

test('retired project settings do not disrupt saved data or tasks in existing notes', async () => {
  const original = '---\ntype: project\n---\n- [ ] Prepare demo #工作';
  const f = fixture(original, 'Projects/demo.md');
  const saved = {
    ...JSON.parse(JSON.stringify(lib.DEFAULT_SETTINGS)),
    dailyFolder: 'Journal/YYYY',
    projectFolder: 'Projects',
    panelOrder: ['projects', 'todo', 'daily', 'calendar', 'database', 'study'],
    panelSizes: {...lib.DEFAULT_SETTINGS.panelSizes, projects: 'large', todo: 'wide'},
    visiblePanels: {...lib.DEFAULT_SETTINGS.visiblePanels, projects: true, database: true},
    monthlyPlan: {'2026-10-12': 'Review notes'},
    monthlyPlanDone: {'2026-10-12': true},
    monthlyPlanCategory: {'2026-10-12': '工作'},
    studyEnabled: true,
    studyCourses: [{id: 'reading-1', module: 'Reading', label: 'Chapter 1', index: 1}],
    studyCheckins: [{courseId: 'reading-1', date: '2026-10-11', checkedAt: 1}],
    taskOrder: ['saved-task-order'],
  };
  const expected = JSON.parse(JSON.stringify(saved));
  expected.monthlyPlan['2026-10-12'] = 'Review notes #工作';
  expected.monthlyPlanItems = {'2026-10-12': [{id: 'legacy-2026-10-12-0', text: 'Review notes #工作', done: true}]};
  delete expected.projectFolder;
  expected.panelOrder = expected.panelOrder.filter((id) => id !== 'projects');
  delete expected.panelSizes.projects;
  delete expected.visiblePanels.projects;
  f.plugin.loadData = async () => saved;
  let persisted;
  f.plugin.saveData = async (data) => {persisted = JSON.parse(JSON.stringify(data));};
  await f.plugin.loadSettings();
  await f.plugin.saveSettings();
  assert.deepEqual(persisted, expected);
  assert.equal(f.get(), original);

  f.plugin.app.metadataCache.getFileCache = () => ({frontmatter: {type: 'project'}});
  const data = await f.plugin.collectData();
  const task = data.tasks.find((task) => task.text === 'Prepare demo #工作');
  assert.ok(task);
  await f.plugin.toggleTask(task);
  assert.equal(f.get(), original.replace('- [ ]', '- [x]'));
});
