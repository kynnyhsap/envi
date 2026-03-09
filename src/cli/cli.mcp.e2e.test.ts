import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const CLI_PATH = path.join(import.meta.dir, '..', 'cli.ts')
const WORKSPACE_PREFIX = path.join(os.tmpdir(), 'envi-mcp-e2e-')

let workDir: string
let proc: ReturnType<typeof Bun.spawn>
let writer: import('bun').FileSink
let reader: ReadableStreamDefaultReader<Uint8Array>
let readBuffer: string

beforeEach(async () => {
  workDir = await mkdtemp(WORKSPACE_PREFIX)
  readBuffer = ''

  proc = Bun.spawn(['bun', 'run', CLI_PATH, 'mcp'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: workDir,
    env: {
      ...process.env,
      NO_COLOR: '1',
    } as Record<string, string>,
  })

  writer = proc.stdin as import('bun').FileSink
  reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()

  // Initialize the MCP session
  send({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'envi-test', version: '1.0.0' },
    },
  })
  await readLine()
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
})

afterEach(async () => {
  proc.kill()
  await rm(workDir, { recursive: true, force: true })
})

function send(msg: unknown): void {
  writer.write(JSON.stringify(msg) + '\n')
  writer.flush()
}

async function readLine(): Promise<string> {
  while (true) {
    if (readBuffer.includes('\n')) {
      const [line, ...rest] = readBuffer.split('\n')
      readBuffer = rest.join('\n')
      return line!
    }
    const { value, done } = await reader.read()
    if (done) return readBuffer
    readBuffer += new TextDecoder().decode(value)
  }
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<{ result: any }> {
  const id = Date.now()
  send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
  const line = await readLine()
  return JSON.parse(line)
}

async function listTools(): Promise<string[]> {
  send({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list' })
  const line = await readLine()
  const parsed = JSON.parse(line)
  return parsed.result.tools.map((t: { name: string }) => t.name)
}

function parseContent(response: { result: any }): any {
  return JSON.parse(response.result.content[0].text)
}

describe('MCP server e2e', () => {
  it('should list all registered tools', async () => {
    const tools = await listTools()

    expect(tools).toContain('status')
    expect(tools).toContain('diff')
    expect(tools).toContain('sync')
    expect(tools).toContain('validate')
    expect(tools).toContain('resolve')
    expect(tools).toContain('backup')
    expect(tools).toContain('restore')
    expect(tools).toHaveLength(7)
  })

  it('should backup and restore environment files', async () => {
    await mkdir(path.join(workDir, 'app'), { recursive: true })
    await Bun.write(path.join(workDir, 'app/.env'), 'SECRET=original\n')

    const backup = parseContent(await callTool('backup'))
    expect(backup.ok).toBe(true)
    expect(backup.data.backedUp).toBe(1)
    expect(backup.data.files).toContain('app/.env')

    await Bun.write(path.join(workDir, 'app/.env'), 'SECRET=corrupted\n')

    const restore = parseContent(await callTool('restore'))
    expect(restore.ok).toBe(true)
    expect(restore.data.restored).toBe(1)

    const content = await Bun.file(path.join(workDir, 'app/.env')).text()
    expect(content).toBe('SECRET=original\n')
  })

  it('should list backup snapshots', async () => {
    await mkdir(path.join(workDir, 'app'), { recursive: true })
    await Bun.write(path.join(workDir, 'app/.env'), 'VAR=value\n')

    await callTool('backup')
    const listed = parseContent(await callTool('backup', { list: true }))

    expect(listed.ok).toBe(true)
    expect(listed.data.snapshots.length).toBeGreaterThan(0)
    expect(listed.data.snapshots[0].files.length).toBe(1)
  })

  it('should support dry-run for backup', async () => {
    await mkdir(path.join(workDir, 'app'), { recursive: true })
    await Bun.write(path.join(workDir, 'app/.env'), 'VAR=value\n')

    const dryRun = parseContent(await callTool('backup', { dryRun: true }))
    expect(dryRun.ok).toBe(true)
    expect(dryRun.data.found).toBe(1)

    const backupDir = path.join(workDir, '.env-backup')
    expect(await Bun.file(backupDir).exists()).toBe(false)
  })

  it('should report restore failure when no backups exist', async () => {
    const restore = parseContent(await callTool('restore'))
    expect(restore.ok).toBe(false)
    expect(restore.issues.some((i: { code: string }) => i.code === 'NO_BACKUPS')).toBe(true)
  })

  it('should restore a specific snapshot by id', async () => {
    await mkdir(path.join(workDir, 'app'), { recursive: true })

    await Bun.write(path.join(workDir, 'app/.env'), 'VERSION=first\n')
    await callTool('backup')

    await Bun.write(path.join(workDir, 'app/.env'), 'VERSION=second\n')
    await callTool('backup')

    const listed = parseContent(await callTool('restore', { list: true }))
    const archived = listed.data.snapshots.find((s: { isLatest: boolean }) => !s.isLatest)

    if (archived) {
      await Bun.write(path.join(workDir, 'app/.env'), 'VERSION=corrupted\n')
      const restore = parseContent(await callTool('restore', { snapshot: archived.id }))
      expect(restore.ok).toBe(true)

      const content = await Bun.file(path.join(workDir, 'app/.env')).text()
      expect(content).toBe('VERSION=first\n')
    }
  })

  it('should scope backup with only parameter', async () => {
    await mkdir(path.join(workDir, 'app'), { recursive: true })
    await mkdir(path.join(workDir, 'web'), { recursive: true })
    await Bun.write(path.join(workDir, 'app/.env'), 'APP=1\n')
    await Bun.write(path.join(workDir, 'web/.env'), 'WEB=1\n')

    const backup = parseContent(await callTool('backup', { only: 'app' }))
    expect(backup.ok).toBe(true)
    expect(backup.data.files).toContain('app/.env')
    expect(backup.data.files).not.toContain('web/.env')
  })

  // NOTE: status unconditionally calls provider.checkAvailability() + verifyAuth(),
  // which can hang when 1Password desktop app is running (biometric prompt).
  // Status-via-MCP is tested in cli.1password.live.e2e.ts with real credentials instead.

  it('should validate template references locally', async () => {
    await mkdir(path.join(workDir, 'app'), { recursive: true })
    await Bun.write(path.join(workDir, 'app/.env.example'), 'SECRET=op://vault/item/field\nPORT=3000\n')

    const validate = parseContent(await callTool('validate'))
    expect(validate.command).toBe('validate')
    expect(validate.ok).toBe(true)
    expect(validate.data.summary.templates).toBe(1)
  })

  it('should return error for resolve with no references', async () => {
    const result = await callTool('resolve', { references: [] })
    expect(result.result.isError).toBe(true)
    expect(result.result.content[0].text).toContain('No references provided')
  })
})
