import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readJson = async (name) => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));
const [pkg, manifest, versions, lock] = await Promise.all(
  ["package.json", "manifest.json", "versions.json", "package-lock.json"].map(readJson),
);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.match(manifest.id, /^[a-z0-9-]+$/);
assert.ok(!manifest.id.includes("obsidian"));
assert.equal(pkg.version, manifest.version, "package.json and manifest.json versions must match");
assert.equal(lock.version, pkg.version, "Lockfile version must match package.json");
assert.equal(lock.name, pkg.name, "Lockfile name must match package.json");
assert.equal(lock.packages[""].name, pkg.name);
assert.equal(lock.packages[""].version, pkg.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.equal(typeof manifest.isDesktopOnly, "boolean");
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(process.env.GITHUB_REF_NAME, manifest.version, "Release tag must match manifest.version exactly (no v prefix)");
}
console.log(`Metadata valid: ${manifest.id} ${manifest.version}`);
