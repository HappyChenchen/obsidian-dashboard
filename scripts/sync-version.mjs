import { readFile, writeFile } from "node:fs/promises";

const load = async (name) => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));
const [pkg, manifest, versions] = await Promise.all(["package.json", "manifest.json", "versions.json"].map(load));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error("Obsidian releases require an x.y.z version.");
manifest.version = pkg.version;
versions[pkg.version] = manifest.minAppVersion;
await Promise.all([
  ["manifest.json", manifest], ["versions.json", versions],
].map(([name, value]) => writeFile(new URL(`../${name}`, import.meta.url), JSON.stringify(value, null, 2) + "\n")));
