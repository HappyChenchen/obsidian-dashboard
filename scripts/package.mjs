import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { zipFiles } from "./zip.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
if (!/^[a-z0-9-]+$/.test(manifest.id)) throw new Error("Invalid plugin ID.");
const target = new URL(`dist/${manifest.id}/`, root);
await mkdir(target, { recursive: true });
for (const name of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(new URL(name, root), new URL(name, target));
}
const entries = await Promise.all(["main.js", "manifest.json", "styles.css"].map(async (name) => [`${manifest.id}/${name}`, await readFile(new URL(name, target))]));
const archiveName = `daily-${manifest.version}.zip`;
const archive = zipFiles(entries);
// Package only Markdown from the maintained example and template directories.
// Never copy vault configuration, plugin data, hidden folders or symlinks.
async function markdownEntries(folder, prefix) {
  const files = [];
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), folder);
    if (entry.isDirectory()) files.push(...await markdownEntries(path, `${prefix}${entry.name}/`));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push([`${prefix}${entry.name}`, await readFile(path)]);
  }
  return files;
}
const exampleName = `daily-examples-${manifest.version}.zip`;
const exampleArchive = zipFiles([
  ...await markdownEntries(new URL("examples/vault/", root), "Daily-example-vault/"),
  ...await markdownEntries(new URL("templates/", root), "Daily-example-vault/Templates/"),
]);
const archives = [[archiveName, archive], [exampleName, exampleArchive]];
await writeFile(new URL(`dist/${archiveName}`, root), archive);
await writeFile(new URL(`dist/${exampleName}`, root), exampleArchive);
await writeFile(new URL("dist/SHA256SUMS.txt", root), [...entries, ...archives].map(([name, data]) => `${createHash("sha256").update(data).digest("hex")}  ${name}`).join("\n") + "\n");
await copyFile(new URL("docs/INSTALL.md", root), new URL("dist/INSTALL.md", root));
const downloads = new URL("downloads/", root);
await mkdir(downloads, { recursive: true });
await writeFile(new URL(archiveName, downloads), archive);
await writeFile(new URL(exampleName, downloads), exampleArchive);
await writeFile(new URL("SHA256SUMS.txt", downloads), archives.map(([name, data]) => `${createHash("sha256").update(data).digest("hex")}  ${name}`).join("\n") + "\n");
console.log(`Plugin assets prepared in dist/${manifest.id}/`);
console.log(`Installable archive: dist/${archiveName}`);
console.log(`Repository download: downloads/${archiveName}`);
console.log(`Example vault and templates: downloads/${exampleName}`);
