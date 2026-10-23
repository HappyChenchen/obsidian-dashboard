import type { TFile } from "obsidian";
import { extractDailySections } from "./notes";
import { extractLooseTasksFromHeading, extractTasks } from "./tasks";
import type { DailySection, DashboardTask } from "./types";

export interface IndexedNote {
  tasks: DashboardTask[];
  headingTasks: DashboardTask[];
  sections: DailySection[];
}

/** Shared by dashboard and diary views; metadata is deliberately read live. */
export class NoteIndex {
  private entries = new Map<string, { stamp: string; result: Promise<IndexedNote>; }>();
  private revisions = new Map<string, number>();
  private epoch = 0;
  constructor(private read: (file: TFile) => Promise<string>) { }

  clear() { this.epoch += 1; this.entries.clear(); this.revisions.clear(); }

  invalidate(path: string) {
    for (const key of this.entries.keys()) {
      if (key === path || key.startsWith(path + "/")) {
        this.entries.delete(key);
        this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
      }
    }
  }

  async get(file: TFile, heading: string): Promise<IndexedNote> {
    const path = file.path;
    const epoch = this.epoch;
    const revision = this.revisions.get(path) ?? 0;
    const stamp = `${file.stat.mtime}:${file.stat.size}:${heading}`;
    const cached = this.entries.get(path);
    if (cached?.stamp === stamp) return cached.result;
    const entry = { stamp, result: Promise.resolve({} as IndexedNote) };
    // Defer the read until the entry has been registered, including for synchronous failures.
    entry.result = Promise.resolve().then(async () => {
      try {
        const content = await this.read(file);
        if (this.epoch !== epoch || (this.revisions.get(path) ?? 0) !== revision || file.path !== path ||
          `${file.stat.mtime}:${file.stat.size}:${heading}` !== stamp) return this.get(file, heading);
        return {
          tasks: extractTasks(content, file),
          headingTasks: extractLooseTasksFromHeading(content, file, heading),
          sections: extractDailySections(content),
        };
      } catch (error) {
        if (this.entries.get(path) === entry) this.entries.delete(path);
        throw error;
      }
    });
    this.entries.set(path, entry);
    return entry.result;
  }

  async readAll(files: TFile[], heading: string): Promise<IndexedNote[]> {
    const paths = new Set(files.map((file) => file.path));
    for (const path of this.entries.keys()) if (!paths.has(path)) this.entries.delete(path);
    const results: IndexedNote[] = new Array(files.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
      while (cursor < files.length) {
        const index = cursor++;
        results[index] = await this.get(files[index], heading);
      }
    }));
    return results;
  }
}
