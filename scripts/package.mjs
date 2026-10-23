import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
await writeFile(new URL(`dist/${archiveName}`, root), archive);
await writeFile(new URL("dist/SHA256SUMS.txt", root), [...entries, [archiveName, archive]].map(([name, data]) => `${createHash("sha256").update(data).digest("hex")}  ${name}`).join("\n") + "\n");
await copyFile(new URL("docs/INSTALL.md", root), new URL("dist/INSTALL.md", root));
const downloads = new URL("downloads/", root);
await mkdir(downloads, { recursive: true });
await writeFile(new URL(archiveName, downloads), archive);
await writeFile(new URL("SHA256SUMS.txt", downloads), `${createHash("sha256").update(archive).digest("hex")}  ${archiveName}\n`);
console.log(`Plugin assets prepared in dist/${manifest.id}/`);
console.log(`Installable archive: dist/${archiveName}`);
console.log(`Repository download: downloads/${archiveName}`);
