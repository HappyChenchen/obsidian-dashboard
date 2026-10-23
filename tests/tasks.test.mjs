import test from 'node:test';
import assert from 'node:assert/strict';
import {lib, fixture} from './helpers.mjs';

test('keeps equal task titles with different dates and source locations', () => {
  const f = fixture('- [ ] 周报 📅 2026-10-12\n- [ ] 周报 📅 2026-10-19');
  const tasks = lib.extractTasks(f.get(), f.file);
  const unique = lib.dedupeTasksByLocation([...tasks, tasks[0]]);
  assert.equal(unique.length, 2);
  assert.equal(unique[1].due, '2026-10-19');
});

test('ignores frontmatter, comment blocks, and both types of fenced code', () => {
  const content = '---\n- [ ] metadata\n---\n```md\n- [ ] example\n```\n~~~\n- [ ] example2\n~~~\n<!--\n- [ ] hidden\n-->\n- [ ] real';
  const f = fixture(content);
  const tasks = lib.extractTasks(content, f.file);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, 'real');
  assert.equal(tasks[0].line, 12);
});

test('heading task extraction keeps source lines but ignores code and lower-level headings', () => {
  const f = fixture('## 今日todo\n```\n- [ ] example\n```\n### Detail\n- plain task\n# Next section\n- [ ] unrelated');
  const tasks = lib.extractLooseTasksFromHeading(f.get(), f.file, '今日todo');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, 'plain task');
  assert.equal(tasks[0].line, 5);
});

test('relocates an unambiguous task after text is inserted above it', () => {
  const f = fixture('- [ ] A\n- [ ] B');
  const task = lib.extractTasks(f.get(), f.file)[1];
  assert.equal(lib.updateTaskCompletion('- [ ] New\n' + f.get(), task), '- [ ] New\n- [ ] A\n- [x] B');
});

test('refuses stale edits when the intended task was edited or became ambiguous', () => {
  const f = fixture('- [ ] A\n- [ ] B');
  const task = lib.extractTasks(f.get(), f.file)[1];
  assert.throws(() => lib.updateTaskCompletion('- [ ] A\nImportant note', task));
  assert.throws(() => lib.updateTaskCompletion(f.get() + '\n- [ ] B', task));
  assert.throws(() => lib.updateTaskCompletion('```\n' + f.get() + '\n```', task));
});

test('retains both changes when two checkboxes are checked concurrently', async () => {
  const f = fixture('- [ ] A\n- [ ] B');
  await Promise.all(lib.extractTasks(f.get(), f.file).map((task) => f.plugin.toggleTask(task)));
  assert.equal(f.get(), '- [x] A\n- [x] B');
});

test('retains both concurrent captures in the same daily note', async () => {
  const f = fixture('## 今日todo\n');
  f.plugin.ensureDailyNote = async () => f.file;
  await Promise.all(['First', 'Second'].map((text) => f.plugin.appendTaskToToday(text)));
  assert.match(f.get(), /- \[ \] First/);
  assert.match(f.get(), /- \[ \] Second/);
});

test('preserves CRLF when completing a loose daily task', () => {
  const f = fixture('## 今日todo\r\n- Reminder\r\n');
  const task = lib.extractLooseTasksFromHeading(f.get(), f.file, '今日todo')[0];
  assert.equal(lib.updateTaskCompletion(f.get(), task), '## 今日todo\r\n- [x] Reminder\r\n');
});

test('category filters can see tasks beyond the first 30', async () => {
  const f = fixture(Array.from({length: 31}, (_, i) => `- [ ] 事项${i} ${i < 30 ? '#工作' : '#学习'}`).join('\n'));
  const data = await f.plugin.collectData();
  assert.equal(data.tasks.length, 31);
  assert.equal(data.tasks.filter((task) => task.category === '学习').length, 1);
});

test('dragging C before B produces A C B from an initially unsorted saved order', async () => {
  const f = fixture('- [ ] A\n- [ ] B\n- [ ] C');
  const tasks = lib.extractTasks(f.get(), f.file);
  await f.plugin.moveTaskOrder(lib.getTaskKey(tasks[2]), lib.getTaskKey(tasks[1]));
  assert.equal(lib.applyTaskOrder(tasks, f.plugin.settings.taskOrder).map((task) => task.text).join(','), 'A,C,B');
});

test('inserting under a heading ignores heading examples inside code fences', () => {
  const source = '```md\n## 今日todo\n```\n## 今日todo\n- [ ] Old\n```md\n## Example\n```\n## Next';
  const result = lib.appendLineUnderHeading(source, '今日todo', '- [ ] New');
  assert.equal(result, '```md\n## 今日todo\n```\n## 今日todo\n- [ ] Old\n```md\n## Example\n```\n- [ ] New\n## Next');
});

test('concurrent first-time Daily creation shares a single creation operation', async () => {
  const f = fixture('');
  f.plugin.settings.dailyFolder = '';
  let created = 0;
  f.plugin.app.vault.create = async () => {created += 1; await Promise.resolve(); return f.file;};
  const [first, second] = await Promise.all([
    f.plugin.ensureDailyNote('2026-10-11'), f.plugin.ensureDailyNote('2026-10-11'),
  ]);
  assert.equal(created, 1);
  assert.equal(first, second);
});
