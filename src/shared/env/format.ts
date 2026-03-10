import pc from 'picocolors'

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function truncateValue(value: string, maxLen = 40): string {
  if (value.length <= maxLen) return value
  const half = Math.floor((maxLen - 3) / 2)
  return value.substring(0, half) + '...' + value.substring(value.length - half)
}

export function redactSecret(value: string): string {
  if (value.length <= 6) return '***'
  return value.substring(0, 3) + '...' + value.substring(value.length - 3)
}

export function formatBackupTimestamp(ts: string, now: Date = new Date()): string {
  if (ts.includes('T') && ts.endsWith('Z')) {
    const normalized = ts.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
    const parsed = new Date(normalized)
    if (!Number.isNaN(parsed.getTime())) {
      const formatted = normalized.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
      return `${formatted} ${pc.dim(`(${formatRelativeTime(parsed, now)})`)}`
    }
  }

  const [date, time] = ts.split('_')
  if (!time) return ts

  const [h, m, s] = time.split('-')
  const formatted = `${date} ${h}:${m}:${s}`

  // Parse timestamp to Date
  const [year, month, day] = (date ?? '').split('-').map(Number)
  const [hour, min, sec] = [h, m, s].map(Number)

  if (!year || !month || !day) return formatted

  const backupDate = new Date(year, month - 1, day, hour ?? 0, min ?? 0, sec ?? 0)

  return `${formatted} ${pc.dim(`(${formatRelativeTime(backupDate, now)})`)}`
}

function formatRelativeTime(target: Date, now: Date): string {
  const diffSeconds = Math.round((target.getTime() - now.getTime()) / 1000)
  const absSeconds = Math.abs(diffSeconds)

  if (absSeconds < 60) return RELATIVE_TIME_FORMAT.format(diffSeconds, 'second')

  const diffMinutes = Math.round(diffSeconds / 60)
  const absMinutes = Math.abs(diffMinutes)
  if (absMinutes < 60) return RELATIVE_TIME_FORMAT.format(diffMinutes, 'minute')

  const diffHours = Math.round(diffMinutes / 60)
  const absHours = Math.abs(diffHours)
  if (absHours < 24) return RELATIVE_TIME_FORMAT.format(diffHours, 'hour')

  const diffDays = Math.round(diffHours / 24)
  const absDays = Math.abs(diffDays)
  if (absDays < 7) return RELATIVE_TIME_FORMAT.format(diffDays, 'day')
  if (absDays < 30) return RELATIVE_TIME_FORMAT.format(Math.round(diffDays / 7), 'week')
  if (absDays < 365) return RELATIVE_TIME_FORMAT.format(Math.round(diffDays / 30), 'month')
  return RELATIVE_TIME_FORMAT.format(Math.round(diffDays / 365), 'year')
}
