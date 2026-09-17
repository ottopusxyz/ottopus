/**
 * Join class names, dropping falsy ones. Deliberately not clsx or tailwind-merge:
 * components here take a className that appends, and nothing yet needs conflict
 * resolution between Tailwind classes.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
