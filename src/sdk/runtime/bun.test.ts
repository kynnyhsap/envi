import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createFakeProvider } from '../../testing/fake-provider'
import { createEnviEngine } from '../engine'
import { createBunRuntimeAdapter } from './bun'

describe('bun runtime adapter', () => {
  let tmpDir: string | null = null

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  it('listDirs returns [] for missing directories', async () => {
    const runtime = createBunRuntimeAdapter()
    const missingDir = path.join(os.tmpdir(), `envi-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await expect(runtime.listDirs(missingDir)).resolves.toEqual([])
  })

  it('status does not crash when backup dir is missing', async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'envi-status-'))

    const engine = createEnviEngine({
      runtime: createBunRuntimeAdapter(),
      provider: createFakeProvider(),
      options: {
        rootDir: tmpDir,
        provider: '1password',
        environment: 'local',
      },
    })

    const result = await engine.status()
    expect(result.data.backups.count).toBe(0)
  })
})
