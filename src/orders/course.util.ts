import { Course } from '@prisma/client';

/** Fire order: appetizers → drinks → mains → dessert → other. */
export const COURSE_FIRE_ORDER: Course[] = [
  Course.APPETIZER,
  Course.DRINK,
  Course.MAIN,
  Course.DESSERT,
  Course.OTHER,
];

export function nextCourseToFire(
  items: { course: Course; firedAt: Date | null }[],
): Course | null {
  for (const course of COURSE_FIRE_ORDER) {
    const hasUnfired = items.some(
      (item) => item.course === course && item.firedAt == null,
    );
    if (hasUnfired) return course;
  }
  return null;
}

export function firstCoursePresent(
  items: { course: Course }[],
): Course | null {
  for (const course of COURSE_FIRE_ORDER) {
    if (items.some((item) => item.course === course)) return course;
  }
  return null;
}
