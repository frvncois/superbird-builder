/** compact relative time, e.g. "just now", "5 minutes ago", "3 days ago" */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 45) return 'just now'

  const units: [limit: number, secs: number, name: string][] = [
    [60, 1, 'second'],
    [60, 60, 'minute'],
    [24, 3600, 'hour'],
    [7, 86400, 'day'],
    [4.35, 604800, 'week'],
    [12, 2629800, 'month'],
    [Infinity, 31557600, 'year'],
  ]

  for (const [limit, secs, name] of units) {
    const value = Math.floor(seconds / secs)
    if (value < limit) {
      return `${value} ${name}${value === 1 ? '' : 's'} ago`
    }
  }
  return 'just now'
}
