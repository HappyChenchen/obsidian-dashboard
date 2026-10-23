import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-install-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'scripts'));
  await copyFile(new URL('../scripts/install-local.mjs', import.meta.url), join(root, 'scripts/install-local.mjs'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({id: 'dashboard-home'}));
  await writeFile(join(root, 'main.js'), '// synthetic test build');
  await writeFile(join(root, 'styles.css'), '/* synthetic test styles */');
  return root;
}

test('installer requires an explicit vault and never chooses a personal default', async (t) => {
  const root = await setup(t);
  const env = {...process.env}; delete env.OBSIDIAN_VAULT;
  const result = spawnSync(process.execPath, [join(root, 'scripts/install-local.mjs')], {env, encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Specify a vault/);
  assert.equal((await readdir(root)).includes('.obsidian'), false);
});

test('installer works outside project cwd and preserves existing plugin data', async (t) => {
  const root = await setup(t);
  const vault = join(root, 'Test Vault');
  const pluginDir = join(vault, '.obsidian/plugins/dashboard-home');
  await mkdir(pluginDir, {recursive: true});
  await writeFile(join(pluginDir, 'data.json'), '{"monthlyPlan":{"2026-10-11":"keep"}}');
  const result = spawnSync(process.execPath, [join(root, 'scripts/install-local.mjs'), vault], {cwd: tmpdir(), encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(pluginDir, 'main.js'), 'utf8'), '// synthetic test build');
  assert.match(await readFile(join(pluginDir, 'data.json'), 'utf8'), /keep/);
});

test('installer rejects a directory that has not been opened as a vault', async (t) => {
  const root = await setup(t);
  const destination = join(root, 'ordinary-folder');
  await mkdir(destination);
  const result = spawnSync(process.execPath, [join(root, 'scripts/install-local.mjs'), destination], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.equal((await readdir(destination)).length, 0);
});
