import path from 'node:path'

const ROOT_ENV_LOCAL = path.join(import.meta.dir, '..', '..', '.env.local')

let loaded = false

export async function loadRootEnvLocal(): Promise<void> {
  if (loaded) return
  loaded = true

  const file = Bun.file(ROOT_ENV_LOCAL)
  if (!(await file.exists())) return

  const text = await file.text()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eqIndex = rawLine.indexOf('=')
    if (eqIndex <= 0) continue

    const key = rawLine.slice(0, eqIndex).trim()
    if (!key || process.env[key] !== undefined) continue

    let value = rawLine.slice(eqIndex + 1)
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}
