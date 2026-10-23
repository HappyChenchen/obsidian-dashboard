import { getTaskTags, isCategoryName } from "./categories";

export interface TagSuggestionState {
  context?: string;
  selected?: string;
  dismissed?: string;
}

function tagContext(input: HTMLTextAreaElement) {
  const cursor = input.selectionStart;
  if (cursor !== input.selectionEnd) return;
  const before = input.value.slice(0, cursor);
  const match = /#([\p{Letter}\p{Number}/_-]*)$/u.exec(before);
  if (!match || before[match.index - 1] === "#" || /(?:https?:\/\/|www\.)\S*$/i.test(before)) return;
  const remainder = /^[\p{Letter}\p{Number}/_-]*/u.exec(input.value.slice(cursor))![0];
  return { start: match.index, end: cursor + remainder.length, query: match[1] };
}

let nextSuggestionId = 0;

/** A local tag picker. Focus stays in the editor so selecting a tag cannot trigger a premature save. */
export class TagSuggestions {
  private list: HTMLElement;
  private matches: string[] = [];
  private contextKey = "";
  private id = `daily-tag-suggestions-${++nextSuggestionId}`;

  constructor(
    private input: HTMLTextAreaElement,
    private parent: HTMLElement,
    private date: string,
    private candidates: () => string[],
    private changed: () => void,
    private state: TagSuggestionState,
  ) {
    this.list = parent.createDiv({ cls: "dashboard-monthly-plan__tag-suggestions", attr: { id: this.id, role: "listbox", "aria-label": "标签候选" } });
    input.setAttr("aria-autocomplete", "list");
    input.setAttr("aria-controls", this.id);
    this.close();
  }

  close() {
    this.list.hidden = true;
    this.input.setAttr("aria-expanded", "false");
    this.input.setAttr("aria-activedescendant", "");
  }

  update() {
    const context = tagContext(this.input);
    if (this.input.hidden || !context) { this.close(); return; }
    this.contextKey = `${this.date}:${this.input.selectionStart}:${this.input.value}`;
    if (this.state.dismissed === this.contextKey) { this.close(); return; }
    if (this.state.context !== this.contextKey) this.state.selected = undefined;
    this.state.context = this.contextKey;
    const lineStart = this.input.value.lastIndexOf("\n", context.start - 1) + 1;
    const nextLine = this.input.value.indexOf("\n", context.end);
    const elsewhere = this.input.value.slice(lineStart, context.start) + this.input.value.slice(context.end, nextLine < 0 ? undefined : nextLine);
    const used = new Set(getTaskTags(elsewhere).map((tag) => tag.slice(1).toLowerCase()));
    const names = new Map<string, string>();
    for (const name of this.candidates()) {
      const key = name.toLowerCase();
      if (isCategoryName(name) && !names.has(key) && !used.has(key) && key.startsWith(context.query.toLowerCase())) names.set(key, name);
    }
    this.matches = [...names.values()].slice(0, 20);
    if (!this.matches.length) { this.close(); return; }
    if (!this.state.selected || !this.matches.includes(this.state.selected)) this.state.selected = this.matches[0];
    this.list.hidden = false;
    this.input.setAttr("aria-expanded", "true");
    this.renderOptions();
    this.position();
  }

  private position() {
    const input = this.input.getBoundingClientRect();
    const parent = this.parent.getBoundingClientRect();
    const height = this.input.ownerDocument.defaultView!.innerHeight;
    const below = Math.max(0, height - input.bottom - 12);
    const above = Math.max(0, input.top - 12);
    const openAbove = below < Math.min(180, this.list.scrollHeight) && above > below;
    this.list.style.top = openAbove ? "auto" : `${input.bottom - parent.top + 4}px`;
    this.list.style.bottom = openAbove ? `${parent.bottom - input.top + 4}px` : "auto";
    this.list.style.maxHeight = `${Math.min(180, openAbove ? above : below)}px`;
  }

  private renderOptions() {
    this.list.empty();
    this.matches.forEach((tag, index) => {
      const selected = tag === this.state.selected;
      const id = `${this.id}-${index}`;
      const option = this.list.createDiv({
        cls: `dashboard-monthly-plan__tag-option${selected ? " is-active" : ""}`,
        text: `#${tag}`,
        attr: { id, role: "option", "aria-selected": String(selected) },
      });
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => this.choose(tag));
      if (selected) this.input.setAttr("aria-activedescendant", id);
    });
  }

  keydown(event: KeyboardEvent) {
    if (event.isComposing || this.list.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      this.state.dismissed = this.contextKey;
      this.close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation();
      const index = this.matches.indexOf(this.state.selected ?? "");
      this.state.selected = this.matches[(index + (event.key === "ArrowDown" ? 1 : -1) + this.matches.length) % this.matches.length];
      this.renderOptions();
      this.list.children[this.matches.indexOf(this.state.selected)]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); event.stopPropagation();
      this.choose(this.state.selected!);
    }
  }

  private choose(tag: string) {
    const context = tagContext(this.input);
    if (!context) { this.close(); return; }
    const prefix = this.input.value.slice(0, context.start);
    const suffix = this.input.value.slice(context.end);
    const separator = prefix && !/\s$/.test(prefix) ? " " : "";
    const insert = `${separator}#${tag}${/^\s/.test(suffix) ? "" : " "}`;
    this.input.value = prefix + insert + suffix;
    const cursor = prefix.length + insert.length + (/^\s/.test(suffix) ? 1 : 0);
    this.input.setSelectionRange(cursor, cursor);
    this.close();
    this.changed();
  }
}
