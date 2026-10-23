import { moment } from "obsidian";

/** One midnight timer plus focus checks, so waking from sleep also catches up. */
export class DayRollover {
  private day = moment().format("YYYY-MM-DD");
  private timer?: number;
  private stopped = false;
  constructor(private changed: () => void) { }

  check = () => {
    if (this.stopped) return;
    const today = moment().format("YYYY-MM-DD");
    if (today !== this.day) {
      this.day = today;
      this.changed();
    }
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.check, moment().add(1, "day").startOf("day").diff(moment()) + 50);
  };

  dispose() {
    this.stopped = true;
    window.clearTimeout(this.timer);
  }
}
