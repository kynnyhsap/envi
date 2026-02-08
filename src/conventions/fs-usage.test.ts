import { describe, expect, it } from 'bun:test'

const BANNED: Array<{ name: string; pattern: RegExp; hint: string }> = [
  {
    name: 'readFileSync',
    pattern: /\breadFileSync\s*\(/,
    hint: 'Use async file IO or streams; avoid reading full files just to slice.',
  },
  {
    name: 'existsSync',
    pattern: /\bexistsSync\s*\(/,
    hint: 'Avoid TOCTOU; prefer try/catch around stat/read.',
  },
  {
    name: 'statSync',
    pattern: /\bstatSync\s*\(/,
    hint: 'Use async stat or try/catch in adapters; avoid sync syscalls.',
  },
  {
    name: 'readdirSync',
    pattern: /\breaddirSync\s*\(/,
    hint: 'Use async readdir or higher-level APIs.',
  },
  {
    name: 'unlinkSync',
    pattern: /\bunlinkSync\s*\(/,
    hint: 'Prefer rm(path, { recursive: true, force: true }) for deletions.',
  },
]

describe('conventions: fs usage', () => {
  it('avoids common sync node:fs anti-patterns', async () => {
    const violations: Array<{ file: string; name: string; hint: string }> = []

    const glob = new Bun.Glob('src/**/*.ts')
    for await (const entry of glob.scan({ cwd: '.', dot: true })) {
      if (entry.includes('/.test-workspace/')) continue
      const filePath = String(entry)
      const content = await Bun.file(filePath).text()

      for (const banned of BANNED) {
        if (banned.pattern.test(content)) {
          violations.push({ file: filePath, name: banned.name, hint: banned.hint })
        }
      }
    }

    expect(violations).toEqual([])
  })
})
