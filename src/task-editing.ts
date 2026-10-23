import { getMarkdownLines } from "./markdown";
import type { DashboardTask } from "./types";

/** Refuse ambiguous edits instead of guessing which note line the user meant. */
export function updateTaskCompletion(content: string, task: DashboardTask): string {
  const snapshot = task.sourceContent;
  if (snapshot === undefined) throw new Error("任务来源已变化，请刷新后重试。");
  const originalLine = snapshot.split("\n")[task.line];
  if (!originalLine) throw new Error("无法定位任务，请刷新后重试。");
  const lines = content.split("\n");
  const visible = getMarkdownLines(content);
  let index = task.line;
  if (snapshot !== content) {
    const originalMatches = snapshot.split("\n").filter((line) => line === originalLine);
    const matches = visible.flatMap((line, lineIndex) => line === originalLine ? [lineIndex] : []);
    if (originalMatches.length !== 1 || matches.length !== 1) {
      throw new Error("任务已被修改或存在同名条目，请刷新后重试。");
    }
    index = matches[0];
  }
  if (!visible[index]) throw new Error("任务已移入代码块或注释，请刷新后重试。");
  const checkbox = /^(\s*[-*+]\s+\[)( |x|X|-)(\]\s+)/;
  if (checkbox.test(lines[index])) {
    lines[index] = lines[index].replace(checkbox, `$1${task.done ? " " : "x"}$3`);
  } else {
    const indent = /^(\s*)/.exec(lines[index])?.[1] ?? "";
    const text = lines[index].trim().replace(/^[-*+]\s+/, "");
    const suffix = lines[index].endsWith("\r") ? "\r" : "";
    lines[index] = `${indent}- [x] ${text}${suffix}`;
  }
  return lines.join("\n");
}
