import { moment } from "obsidian";
import type { StudyCheckin, StudyCourse } from "./types";

// Used only to migrate check-ins from the original personal version.
export const LEGACY_STUDY_COURSES: StudyCourse[] = [
  ...createCourses("资料", 4), ...createCourses("言语", 6),
  ...createCourses("判断", 8), ...createCourses("申论", 7), ...createCourses("数量", 5),
];

export function normalizeStudyCourses(value: unknown): StudyCourse[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" ||
      typeof item.module !== "string" || typeof item.label !== "string" ||
      !item.id.trim() || !item.module.trim() || !item.label.trim() || seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ id: item.id, module: item.module.trim(), label: item.label.trim(), index: seen.size }];
  });
}

export function parseStudyCourses(text: string, previous: StudyCourse[]): StudyCourse[] {
  const courses: StudyCourse[] = [];
  const seen = new Set<string>();
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    const separator = line.indexOf("|");
    const module = line.slice(0, separator).trim();
    const label = line.slice(separator + 1).trim();
    if (separator < 1 || !module || !label) throw new Error(`第 ${index + 1} 行请使用“分组 | 课程名称”。`);
    const identity = JSON.stringify([module, label]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const existing = previous.find((course) => course.module === module && course.label === label);
    courses.push({ id: existing?.id ?? identity, module, label, index: courses.length + 1 });
  }
  return courses;
}

export function normalizeStudyCheckins(value: unknown): StudyCheckin[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: StudyCheckin[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<StudyCheckin>;
    if (typeof candidate.courseId !== "string" || !candidate.courseId.trim() ||
      typeof candidate.date !== "string" || !moment(candidate.date, "YYYY-MM-DD", true).isValid()) continue;
    const key = JSON.stringify([candidate.date, candidate.courseId]);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
courseId: candidate.courseId, date: candidate.date,
      checkedAt: typeof candidate.checkedAt === "number" && Number.isFinite(candidate.checkedAt) ? candidate.checkedAt : Date.now()
});
  }
  return normalized.sort((a, b) => a.date.localeCompare(b.date) || a.courseId.localeCompare(b.courseId));
}

export function getStudyCourse(courseId: string, courses: StudyCourse[]): StudyCourse | undefined {
  return courses.find((course) => course.id === courseId);
}

export function getStudyCheckinsForDate(checkins: StudyCheckin[], date: string): StudyCheckin[] {
  return checkins.filter((checkin) => checkin.date === date);
}

export function getStudyCheckinCountByDate(checkins: StudyCheckin[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const checkin of checkins) counts.set(checkin.date, (counts.get(checkin.date) ?? 0) + 1);
  return counts;
}

function createCourses(module: string, count: number): StudyCourse[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${module}-${index + 1}`, module, label: `${module}${index + 1}`, index: index + 1,
  }));
}
