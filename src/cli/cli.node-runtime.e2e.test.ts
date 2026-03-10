import { $ } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { createCliBuildConfig } from '../../build'

const TMP_DIR = join(import.meta.dir, '.node-runtime-workspace')
const DIST_DIR = join(TMP_DIR, 'dist')
const WORK_DIR = join(TMP_DIR, 'workspace')
const CLI_ENTRY = join(DIST_DIR, 'cli.js')

async function runNodeCli(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['node', CLI_ENTRY, ...args], {
    cwd: WORK_DIR,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  return { stdout, stderr, exitCode }
}

describe('CLI node runtime fallback e2e', () => {
  beforeAll(async () => {
    await $`rm -rf ${TMP_DIR}`.quiet().nothrow()
    await $`mkdir -p ${DIST_DIR} ${WORK_DIR}`.quiet()

    const result = await Bun.build(
      createCliBuildConfig({
        entrypoints: [join(import.meta.dir, '..', 'cli.ts')],
        outdir: DIST_DIR,
      }),
    )

    if (!result.success) {
      const logs = result.logs.map((log) => log.message).join('\n')
      throw new Error(`Failed to build CLI for node fallback e2e test:\n${logs}`)
    }
  })

  afterAll(async () => {
    await $`rm -rf ${TMP_DIR}`.quiet().nothrow()
  })

  it('falls back to the node runtime when executed by node', async () => {
    const { stdout, stderr, exitCode } = await runNodeCli('backup')
    const output = `${stdout}\n${stderr}`

    expect(exitCode).toBe(0)
    expect(output).not.toContain('Bun runtime not available')
    expect(output).toContain('No environment files found to backup')
  })
})
