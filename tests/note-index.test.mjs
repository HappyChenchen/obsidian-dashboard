import test from 'node:test';
import assert from 'node:assert/strict';
import {lib, fixture, TFile} from './helpers.mjs';

test('1000-note warm refresh reads nothing; modifications, rename, creation and deletion update the index', async () => {
  const {plugin} = fixture('');
  let files = Array.from({length: 1000}, (_, i) => new TFile(`Notes/${i}.md`));
  let reads = 0;
  const content = new Map();
  plugin.app.vault.getMarkdownFiles = () => files;
  plugin.app.vault.cachedRead = async (file) => {reads++; return content.get(file.path) ?? '- [ ] Original';};
  assert.equal((await plugin.collectData()).tasks.length, 1000);
  assert.equal(reads, 1000);
  await Promise.all([plugin.collectData(), plugin.collectData()]);
  assert.equal(reads, 1000);
  content.set(files[0].path, '- [x] Updated'); files[0].stat.mtime++;
  assert.equal((await plugin.collectData()).tasks.length, 999);
  assert.equal(reads, 1001);
  const renamed = files[1]; renamed.path = 'Notes/renamed.md';
  content.set(renamed.path, '- [ ] Renamed');
  assert.ok((await plugin.collectData()).tasks.some((task) => task.text === 'Renamed'));
  assert.equal(reads, 1002);
  files.push(new TFile('Notes/new.md'));
  assert.equal((await plugin.collectData()).tasks.length, 1000);
  assert.equal(reads, 1003);
  files = files.filter((file) => file !== renamed);
  assert.equal((await plugin.collectData()).tasks.length, 999);
  assert.equal(reads, 1003);
});

test('concurrent readers share work; invalidation during a read discards its stale result', async () => {
  const pending = [];
  const file = new TFile();
  const index = new lib.NoteIndex(() => new Promise((resolve) => pending.push(resolve)));
  const first = index.get(file, '今日todo');
  const second = index.get(file, '今日todo');
  await Promise.resolve();
  assert.equal(pending.length, 1);
  index.invalidate(file.path);
  const newer = index.get(file, '今日todo');
  await Promise.resolve();
  pending[1]('- [ ] New'); pending[0]('- [ ] Stale');
  for (const result of await Promise.all([first, second, newer])) assert.equal(result.tasks[0].text, 'New');
});

test('heading settings change during a read does not cause competing cache reads', async () => {
  const file = new TFile();
  let reads = 0;
  const index = new lib.NoteIndex(async () => {reads++; return '## A\nOne\n## B\nTwo';});
  const [a, b] = await Promise.all([index.get(file, 'A'), index.get(file, 'B')]);
  assert.equal(a.headingTasks[0].text, 'One');
  assert.equal(b.headingTasks[0].text, 'Two');
  assert.equal(reads, 2);
});

test('failed reads are retryable and manual refresh clears cached parses', async () => {
  const {plugin} = fixture('- [ ] Cached');
  let reads = 0;
  plugin.app.vault.cachedRead = async () => {if (++reads === 1) throw new Error('offline'); return '- [ ] Cached';};
  await assert.rejects(plugin.collectData(), /offline/);
  await plugin.collectData(); await plugin.collectData();
  assert.equal(reads, 2);
  plugin.refreshFromVault(); await plugin.collectData();
  assert.equal(reads, 3);
});
