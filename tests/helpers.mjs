import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
export class TFile {
  constructor(path = 'Notes/tasks.md') {
    this.path = path;
    this.basename = path.split('/').pop().replace(/\.md$/, '');
    this.stat = {mtime: 1, size: 0};
  }
}
export class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag; this.children = []; this.value = ''; this.text = options.text ?? '';
    this.cls = options.cls ?? ''; this.handlers = {}; this.ownerDocument = {activeElement: null, defaultView: {innerHeight: 800}};
    this.style = {}; this.scrollHeight = 180;
    this.attrs = {...options.attr};
  }
  createEl(tag, options = {}) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl('div', options); }
  empty() { this.children = []; }
  appendChild(child) { if (!this.children.includes(child)) this.children.push(child); return child; }
  focus() {}
  scrollIntoView() {}
  getBoundingClientRect() { return {top: 100, bottom: 200}; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  addClass(name) { this.cls = [...new Set([...this.cls.split(" ").filter(Boolean), name])].join(" "); }
  removeClass(name) { this.cls = this.cls.split(" ").filter((value) => value !== name).join(" "); }
  setAttr(name, value) { this.attrs[name] = value; if (name === "class") this.cls = value; } setText(text) { this.text = text; }
  addEventListener(event, callback) { this.handlers[event] = callback; }
  querySelector() { return null; }
}
export const elements = (element) => [element, ...element.children.flatMap(elements)];
const source = 'export * from "./settings-merge"; export * from "./settings-codec"; export * from "./backup"; export * from "./daily-setup"; export * from "./monthly-items"; export { SettingsStore } from "./settings-store"; export { default } from "./main"; export { DashboardView } from "./dashboard-view"; export { ClearArchiveModal, DashboardSettingTab } from "./settings-tab"; export * from "./tasks"; export * from "./notes"; export * from "./study"; export * from "./task-editing"; export { DEFAULT_SETTINGS } from "./constants"; export * from "./preferences"; export { StudyTrackerView } from "./study-tracker-view"; export { NoteIndex } from "./note-index"; export { DayRollover } from "./day-rollover"; export * from "./categories"; export { AddMonthlyTodoModal, MonthlyDiaryView } from "./monthly-diary-view";';
const {outputFiles} = buildSync({stdin: {contents: source, resolveDir: root + 'src', loader: 'ts'}, bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false});
class ItemView { constructor() {this.containerEl = new Element(); this.containerEl.children = [new Element(), new Element()];} }
const notices = [];
const obsidian = {
  Plugin: class {async saveData() {}}, ItemView, TFile,
  Modal: class {
    contentEl = new Element();
    open() { this.opened = true; this.onOpen?.(); }
    close() { this.opened = false; this.onClose?.(); }
  }, PluginSettingTab: class {}, Notice: class {constructor(message) {notices.push(message);}},
  moment: require('moment'),
  setIcon() {},
};
export const clock = {nextId: 0, timers: new Map(), setTimeout(fn, delay) {const id = ++this.nextId; this.timers.set(id, {fn, delay}); return id;}, clearTimeout(id) {this.timers.delete(id);}};
export const moment = obsidian.moment;
const context = {module: {exports: {}}, require: (name) => name === 'obsidian' ? obsidian : require(name),
  window: {setTimeout: clock.setTimeout.bind(clock), clearTimeout: clock.clearTimeout.bind(clock)}, console};
runInNewContext(outputFiles[0].text, context);
export const lib = context.module.exports;
export function fixture(initial, path) {
  let content = initial;
  let queue = Promise.resolve();
  const file = new TFile(path);
  const plugin = new lib.default();
  plugin.settings = JSON.parse(JSON.stringify(lib.DEFAULT_SETTINGS));
  plugin.settings.dailySetupComplete = true;
  plugin.app = {
    vault: {
      cachedRead: async () => content,
      process: (_file, transform) => {
        const result = queue.then(() => {content = transform(content); file.stat.mtime += 1; return content;});
        queue = result.catch(() => {});
        return result;
      },
      getMarkdownFiles: () => [file], getAbstractFileByPath: () => null,
    },
    metadataCache: {getFileCache: () => ({})}, workspace: {getLeavesOfType: () => []},
  };
  return {plugin, file, get: () => content, set: (value) => {content = value; file.stat.mtime += 1;}, notices};
}
