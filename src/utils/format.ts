import pc from 'picocolors'
import { format as timeago } from 'timeago.js'

export function truncateValue(value: string, maxLen = 40): string {
  if (value.length <= maxLen) return value
  const half = Math.floor((maxLen - 3) / 2)
  return value.substring(0, half) + '...' + value.substring(value.length - half)
}

export function redactSecret(value: string): string {
  if (value.length <= 6) return '***'
  return value.substring(0, 3) + '...' + value.substring(value.length - 3)
}

export function formatBackupTimestamp(ts: string): string {
  const [date, time] = ts.split('_')
  if (!time) return ts

  const [h, m, s] = time.split('-')
  const formatted = `${date} ${h}:${m}:${s}`

  // Parse timestamp to Date
  const [year, month, day] = (date ?? '').split('-').map(Number)
  const [hour, min, sec] = [h, m, s].map(Number)

  if (!year || !month || !day) return formatted

  const backupDate = new Date(year, month - 1, day, hour ?? 0, min ?? 0, sec ?? 0)

  return `${formatted} ${pc.dim(`(${timeago(backupDate)})`)}`
}
