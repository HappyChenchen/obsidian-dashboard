import { moment } from "obsidian";
import type { StudyCheckin, StudyCourse } from "./types";

export const STUDY_COURSES: StudyCourse[] = [
  ...createCourses("资料", 4),
  ...createCourses("言语", 6),
  ...createCourses("判断", 8),
  ...createCourses("申论", 7),
  ...createCourses("数量", 5),
];

export const STUDY_MODULES = ["资料", "言语", "判断", "申论", "数量"] as const;

export function normalizeStudyCheckins(value: unknown): StudyCheckin[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const validCourseIds = new Set(STUDY_COURSES.map((course) => course.id));
  const seen = new Set<string>();
  const normalized: StudyCheckin[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Partial<StudyCheckin>;
    if (
      typeof candidate.courseId !== "string" ||
      !validCourseIds.has(candidate.courseId) ||
      typeof candidate.date !== "string" ||
      !moment(candidate.date, "YYYY-MM-DD", true).isValid()
    ) {
      continue;
    }

    const key = `${candidate.date}:${candidate.courseId}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({
      courseId: candidate.courseId,
      date: candidate.date,
      checkedAt: typeof candidate.checkedAt === "number" ? candidate.checkedAt : Date.now(),
    });
  }

  return normalized.sort((a, b) =>
    a.date.localeCompare(b.date) || a.courseId.localeCompare(b.courseId),
  );
}

export function getStudyCourse(courseId: string): StudyCourse | undefined {
  return STUDY_COURSES.find((course) => course.id === courseId);
}

export function getStudyCheckinsForDate(
  checkins: StudyCheckin[],
  date: string,
): StudyCheckin[] {
  return checkins.filter((checkin) => checkin.date === date);
}

export function getStudyCheckinCountByDate(
  checkins: StudyCheckin[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const checkin of checkins) {
    counts.set(checkin.date, (counts.get(checkin.date) ?? 0) + 1);
  }
  return counts;
}

function createCourses(module: string, count: number): StudyCourse[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `${module}-${number}`,
      module,
      label: `${module}${number}`,
      index: number,
    };
  });
}
