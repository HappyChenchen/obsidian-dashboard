import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const vaultPath = process.env.OBSIDIAN_VAULT ?? "/Users/chenyun/Notes/Run";
const pluginDir = resolve(vaultPath, ".obsidian/plugins/dashboard-home");

await mkdir(pluginDir, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(resolve(file), resolve(pluginDir, file));
}

console.log(`Installed Dashboard Home to ${pluginDir}`);

