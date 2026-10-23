import type { DashboardPanelId, DashboardPanelSize } from "./types";
import { truncateText } from "./utils";
import type { DashboardView } from "./dashboard-view";
import { isCategoryName } from "./categories";
import { stripTaskMetadata } from "./tasks";

export function renderTaskTitle(root: HTMLElement, text: string, category?: string, options: { stripDates?: boolean; onOpen?: () => void } = {}) {
  const tags = new Map<string, string>();
  const displayText = options.stripDates === false ? text : stripTaskMetadata(text);
  const title = displayText.replace(/(^|\s)#([\p{Letter}\p{Number}/_-]+)/gu, (match, space: string, tag: string) => {
    if (!isCategoryName(tag)) return match;
    tags.set(tag.toLowerCase(), tag);
    return space;
  }).trim();
  if (category && !tags.has(category.toLowerCase())) tags.set(category.toLowerCase(), category);
  const line = root.createDiv({ cls: "dashboard-home__task-title-line" });
  if (options.onOpen) {
    line.addClass("is-link");
    line.setAttr("role", "button");
    line.setAttr("tabindex", "0");
    line.addEventListener("click", options.onOpen);
    line.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      options.onOpen?.();
    });
  }
  if (title) line.createEl("span", { cls: "dashboard-home__task-title", text: title });
  for (const tag of tags.values()) {
    line.createEl("span", {
      cls: "dashboard-home__task-tag",
      text: tag,
      attr: { "aria-label": `标签：${tag}`, title: `#${tag}` },
    });
  }
}

export function createCard(
  root: HTMLElement,
  title: string,
  variant?: string,
  panelId?: DashboardPanelId,
  view?: DashboardView,
  renderActions?: (root: HTMLElement) => void,
): HTMLElement {
  const card = root.createDiv({
    cls: [
      "dashboard-home__card",
      variant ? `dashboard-home__card--${variant}` : "",
      panelId && view ? getPanelSizeClass(view.getPanelSize(panelId)) : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
  const header = card.createDiv({ cls: "dashboard-home__card-header" });
  const titleGroup = header.createDiv({ cls: "dashboard-home__card-title-group" });
  titleGroup.createEl("h2", { text: title });
  if (panelId && view) {
    view.attachPanelDragHandlers(card, panelId, header);
  }
  const actions = header.createDiv({ cls: "dashboard-home__card-header-actions" });
  if (renderActions) {
    renderActions(actions);
  }
  if (panelId && view) {
    const resizeHandle = card.createDiv({
      cls: "dashboard-home__resize-handle",
    });
    view.attachPanelResizeHandlers(card, panelId, resizeHandle);
  }
  return card;
}

export function getSizeFromDrag(
  currentSize: DashboardPanelSize,
  deltaX: number,
  deltaY: number,
): DashboardPanelSize {
  if (Math.abs(deltaX) < 48 && Math.abs(deltaY) < 48) {
    return currentSize;
  }

  if (deltaX > 80 && deltaY > 64) {
    return "large";
  }

  if (deltaX > 80) {
    return "wide";
  }

  if (deltaY > 64) {
    return "tall";
  }

  if (deltaX < -64 || deltaY < -64) {
    return "compact";
  }

  return "normal";
}

export function applyPanelSizeClass(card: HTMLElement, size: DashboardPanelSize) {
  for (const panelSize of ["compact", "normal", "wide", "tall", "large"]) {
    card.removeClass(`dashboard-home__card--size-${panelSize}`);
  }
  card.addClass(getPanelSizeClass(size));
}

export function getPanelSizeClass(size: DashboardPanelSize): string {
  return `dashboard-home__card--size-${size}`;
}

export function renderMonthlyTextBlock(
  root: HTMLElement,
  label: string,
  value: string,
  limit: number,
) {
  const text = value.trim();
  if (!text) {
    return;
  }

  const block = root.createDiv({ cls: "dashboard-monthly-panel__block" });
  block.createEl("span", {
    cls: "dashboard-monthly-panel__block-label",
    text: label,
  });
  block.createDiv({
    cls: "dashboard-monthly-panel__snippet",
    text: truncateText(text, limit),
  });
}

export function renderMonthlyTodoLine(
  root: HTMLElement,
  text: string,
  done: boolean,
  compact: boolean,
) {
  const line = root.createDiv({
    cls: [
      "dashboard-monthly-panel__line",
      done ? "is-done" : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
  line.createEl("span", { text: done ? "[x]" : "[ ]" });
  line.createEl("strong", {
    text: truncateText(text, compact ? 52 : 70),
  });
}
