import { access, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const vaultPath = process.argv[2] || process.env.OBSIDIAN_VAULT;

try {
  if (!vaultPath) {
    throw new Error('Specify a vault: npm run install:local -- "/path/to/vault"');
  }
  const configDir = resolve(vaultPath, ".obsidian");
  if (!(await stat(configDir)).isDirectory()) {
    throw new Error("The target must be an existing Obsidian vault with a .obsidian directory.");
  }
  const manifest = JSON.parse(await readFile(resolve(projectRoot, "manifest.json"), "utf8"));
  if (!/^[a-z0-9-]+$/.test(manifest.id)) throw new Error("Invalid plugin ID.");
  const files = ["main.js", "manifest.json", "styles.css"];
  await Promise.all(files.map((file) => access(resolve(projectRoot, file))));
  const pluginDir = resolve(configDir, "plugins", manifest.id);
  await mkdir(pluginDir, { recursive: true });
  for (const file of files) {
    await copyFile(resolve(projectRoot, file), resolve(pluginDir, file));
  }
  console.log(`Installed ${manifest.name || manifest.id} to ${pluginDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
