import type { DashboardSettings } from "./types";
import { mergeSettings } from "./settings-merge";

/** Serialize disk writes. Record updates become visible only after a successful write. */
export class SettingsStore {
  private queue: Promise<void> = Promise.resolve();
  private baseline?: DashboardSettings;
  private latestRemote?: DashboardSettings;
  private disk?: () => Promise<DashboardSettings>;
  private conflict?: (local: DashboardSettings, remote: DashboardSettings) => Promise<void>;

  enableSync(readDisk: () => Promise<DashboardSettings>, conflict: (local: DashboardSettings, remote: DashboardSettings) => Promise<void>) {
    this.baseline = this.snapshot();
    this.disk = readDisk;
    this.conflict = conflict;
  }

  async refresh() {
    return this.enqueue(async () => {
      const merged = await this.mergeDisk(this.snapshot());
      Object.assign(this.read(), merged);
      if (this.latestRemote) this.baseline = this.latestRemote;
    });
  }

  async replace(settings: DashboardSettings) {
    return this.enqueue(async () => {
      await this.write(settings);
      Object.assign(this.read(), settings);
      this.baseline = JSON.parse(JSON.stringify(settings));
    });
  }

  private async mergeDisk(local: DashboardSettings) {
    if (!this.disk || !this.baseline) return local;
    const remote = await this.disk();
    try {
      const result = mergeSettings(this.baseline, local, remote);
      this.latestRemote = remote;
      return result;
    } catch (error) {
      await this.conflict?.(local, remote);
      throw error;
    }
  }

  private async commit(draft: DashboardSettings) {
    const merged = await this.mergeDisk(draft);
    await this.write(merged);
    Object.assign(this.read(), merged);
    if (this.disk) this.baseline = JSON.parse(JSON.stringify(merged));
  }

  constructor(
    private read: () => DashboardSettings,
    private write: (settings: DashboardSettings) => Promise<void>,
  ) { }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => { });
    return result;
  }

  save(): Promise<void> {
    return this.enqueue(() => this.commit(this.snapshot()));
  }

  update<K extends keyof DashboardSettings>(
    keys: readonly K[],
    change: (draft: DashboardSettings) => void,
  ): Promise<void> {
    return this.enqueue(async () => {
      const draft = this.snapshot();
      change(draft);
      await this.commit(draft);
    });
  }

  private snapshot(): DashboardSettings {
    return JSON.parse(JSON.stringify(this.read())) as DashboardSettings;
  }
}
