import type { DashboardCategoryFilter } from "./types";

export const DEFAULT_TASK_CATEGORIES = ["生活", "工作", "学习", "其他"];

export function isCategoryName(value: unknown): value is string {
  return typeof value === "string" && /^[\p{Letter}\p{Number}/_-]+$/u.test(value) && /[\p{Letter}_/-]/u.test(value);
}

export function normalizeTaskCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_TASK_CATEGORIES];
  const seen = new Set<string>();
  return value.filter((item): item is string => {
    if (!isCategoryName(item) || seen.has(item.toLowerCase())) return false;
    seen.add(item.toLowerCase());
    return true;
  });
}

export function parseTaskCategories(text: string): string[] {
  const categories = text.split(/\r?\n/).map((line) => line.trim().replace(/^#/, "")).filter(Boolean);
  for (const category of categories) {
    if (!isCategoryName(category)) throw new Error(`分类“${category}”不能包含空格或特殊符号，也不能全为数字。可使用文字、字母、数字、下划线、短横线或斜杠。`);
  }
  return normalizeTaskCategories(categories);
}

export function getTaskTags(text: string): string[] {
  return Array.from(text.matchAll(/(?:^|\s)#([\p{Letter}\p{Number}/_-]+)/gu))
    .filter((tag) => isCategoryName(tag[1])).map((tag) => "#" + tag[1]);
}

export function getTagFilters(tasks: Array<{tags: string[]; category?: string}>) {
  const names = normalizeTaskCategories(tasks.flatMap((task) => task.tags.length ? task.tags.map((tag) => tag.slice(1)) : task.category ? [task.category] : []));
  return getCategoryFilters(names).map((filter) => ({...filter, label: filter.id === "uncategorized" ? "无标签" : filter.label}));
}

export function matchesTaskTags(task: {tags: string[]; category?: string}, filter: DashboardCategoryFilter): boolean {
  const tags = task.tags.length ? task.tags.map((tag) => tag.slice(1).toLowerCase()) : task.category ? [task.category.toLowerCase()] : [];
  if (filter === "all") return true;
  if (filter === "uncategorized") return !tags.length;
  return tags.includes(filter.slice("category:".length).toLowerCase());
}

export function findTaskCategory(tags: string[], categories: string[]): string | undefined {
  for (const tag of tags) {
    const match = categories.find((category) => category.toLowerCase() === tag.replace(/^#/, "").toLowerCase());
    if (match) return match;
  }
  return undefined;
}

export function withTaskCategory(text: string, category: string, categories: string[]): string {
  if (category && !categories.includes(category)) throw new Error("所选分类已停用，请重新选择。");
  // An explicit tag in the user's text takes precedence over the default selection.
  if (!category || getTaskTags(text).length) return text;
  return `${text} #${category}`;
}

export function getCategoryFilters(categories: string[]): Array<{ id: DashboardCategoryFilter; label: string }> {
  return [
    { id: "all", label: "全部" },
    ...categories.map((category) => ({ id: `category:${category}` as const, label: category })),
    { id: "uncategorized", label: "未分类" },
  ];
}

export function matchesCategoryFilter(category: string | undefined, filter: DashboardCategoryFilter, categories: string[]): boolean {
  if (filter === "all") return true;
  if (filter === "uncategorized") return !category || !categories.includes(category);
  return filter === `category:${category}`;
}
