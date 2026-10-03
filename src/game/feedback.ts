/** Celebrate a crossed boundary once, even when several judgments arrive together. */
export function comboMilestone(previous: number, current: number) {
  return current > previous && Math.floor(current / 5) > Math.floor(previous / 5)
    ? Math.floor(current / 5) * 5 : 0
}
