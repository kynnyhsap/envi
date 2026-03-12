import { $ } from 'bun'
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { dirname, join } from 'path'

import { BACKUP_FOLDER_NAME } from '../app/config'

const CLI_PATH = join(import.meta.dir, '..', 'cli.ts')
const TEST_DIR = join(import.meta.dir, '.test-workspace')
const BACKUP_DIR = join(TEST_DIR, BACKUP_FOLDER_NAME)

async function runCli(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCliWithEnv({}, ...args)
}

async function runCliWithEnv(
  env: Record<string, string | undefined>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const mergedEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...process.env, ...env })) {
    if (typeof value === 'string') {
      mergedEnv[key] = value
    }
  }

  const proc = Bun.spawn(['bun', CLI_PATH, ...args], {
    cwd: TEST_DIR,
    env: mergedEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  return { stdout, stderr, exitCode }
}

async function runCliWithTimeout(
  timeoutMs: number,
  env: Record<string, string | undefined>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return await Promise.race([
    runCliWithEnv(env, ...args),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`CLI command timed out after ${timeoutMs}ms: ${args.join(' ')}`)), timeoutMs)
    }),
  ])
}

async function runCliJson(...args: string[]) {
  const result = await runCli(...args)
  return {
    ...result,
    json: result.stdout ? JSON.parse(result.stdout) : null,
  }
}

async function setupTestWorkspace() {
  await $`rm -rf ${TEST_DIR}`.quiet().nothrow()
  await $`mkdir -p ${TEST_DIR}/test-app`.quiet()
}

async function cleanupTestWorkspace() {
  await $`rm -rf ${TEST_DIR}`.quiet().nothrow()
}

function createSnapshotId(): string {
  return new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')
}

async function createBackupSnapshot(args: {
  snapshotDirName?: string
  id?: string
  createdAt?: string
  files: Record<string, string>
}) {
  const snapshotDirName = args.snapshotDirName ?? 'latest'
  const id = args.id ?? (snapshotDirName === 'latest' ? createSnapshotId() : snapshotDirName)
  const createdAt = args.createdAt ?? new Date().toISOString()
  const snapshotDir = join(BACKUP_DIR, snapshotDirName)

  await $`mkdir -p ${snapshotDir}`.quiet()
  for (const [relativePath, content] of Object.entries(args.files)) {
    const filePath = join(snapshotDir, relativePath)
    await $`mkdir -p ${dirname(filePath)}`.quiet()
    await Bun.write(filePath, content)
  }

  await Bun.write(
    join(snapshotDir, '.envi-backup.json'),
    JSON.stringify(
      {
        id,
        createdAt,
      },
      null,
      2,
    ) + '\n',
  )
}

describe('CLI e2e tests', () => {
  beforeEach(async () => {
    await setupTestWorkspace()
  })

  afterEach(async () => {
    await cleanupTestWorkspace()
  })

  describe('--help', () => {
    it('should show help with -h flag', async () => {
      const { stdout, exitCode } = await runCli('-h')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('envi')
      expect(stdout).toContain('Manage .env files')
      expect(stdout).toContain('COMMANDS')
      expect(stdout).toContain('status')
      expect(stdout).toContain('sync')
      expect(stdout).toContain('resolve')
      expect(stdout).toContain('backup')
      expect(stdout).toContain('restore')
    })

    it('should show help with --help flag', async () => {
      const { stdout, exitCode } = await runCli('--help')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('envi')
    })

    it('should show help command output', async () => {
      const { stdout, exitCode } = await runCli('help')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('COMMANDS')
      expect(stdout).toContain('status')
    })

    it('should show subcommand help via help command', async () => {
      const { stdout, exitCode } = await runCli('help', 'status')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Show .env status and auth')
      expect(stdout).toContain('envi status [options]')
    })

    it('should return root help as json', async () => {
      const { json, exitCode } = await runCliJson('help', '--json')

      expect(exitCode).toBe(0)
      expect(json.name).toBe('envi')
      expect(json.version).toBeDefined()
      expect(json.commands.some((command: { name: string }) => command.name === 'status')).toBe(true)
    })

    it('should return subcommand help as json', async () => {
      const { json, exitCode } = await runCliJson('help', 'resolve', '--json')

      expect(exitCode).toBe(0)
      expect(json.command.name).toBe('resolve')
      expect(json.command.description).toContain('Resolve one or more')
      expect(json.options.some((option: { flags: string }) => option.flags === '--json')).toBe(true)
    })

    it('should show help when no command provided', async () => {
      const { stdout, exitCode } = await runCli()

      expect(exitCode).toBe(0)
      expect(stdout).toContain('USAGE')
      expect(stdout).toContain('COMMANDS')
    })

    it('should show subcommand-specific help', async () => {
      const { stdout, exitCode } = await runCli('sync', '--help')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('envi')
      expect(stdout).toContain('sync')
      expect(stdout).toContain('--dry-run')
      expect(stdout).toContain('--no-backup')
    })

    it('should show resolve subcommand-specific help', async () => {
      const { stdout, exitCode } = await runCli('resolve', '--help')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('resolve')
      expect(stdout).toContain('op://')
    })

    it('should render colored subcommand help when color is enabled', async () => {
      const { stdout, exitCode } = await runCliWithEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, 'status', '--help')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('\u001b[')
      expect(stdout).toContain('OPTIONS')
    })

    it('should disable help colors with --no-color', async () => {
      const { stdout, exitCode } = await runCliWithEnv(
        { FORCE_COLOR: '1', NO_COLOR: undefined },
        '--no-color',
        'status',
        '--help',
      )

      expect(exitCode).toBe(0)
      expect(stdout).not.toContain('\u001b[')
      expect(stdout).toContain('--no-color')
    })

    it('should disable help colors with NO_COLOR', async () => {
      const { stdout, exitCode } = await runCliWithEnv({ FORCE_COLOR: '1', NO_COLOR: '1' }, 'status', '--help')

      expect(exitCode).toBe(0)
      expect(stdout).not.toContain('\u001b[')
    })
  })

  describe('resolve command', () => {
    it('should reject references that do not start with op://', async () => {
      const { stdout, stderr, exitCode } = await runCli('resolve', 'not-a-secret')

      expect(exitCode).toBe(1)
      const output = stdout + stderr
      expect(output).toContain('Invalid reference')
      expect(output).toContain('op://')
    })

    it('should reject malformed references before remote auth', async () => {
      const { stdout, stderr, exitCode } = await runCli('resolve', 'op://vault/item')

      expect(exitCode).toBe(1)
      const output = stdout + stderr
      expect(output).toContain('Invalid reference')
      expect(output).toContain('vault/item/field')
    })

    it('should reject multiple malformed references and report each issue', async () => {
      const { stdout, stderr, exitCode } = await runCli('resolve', 'not-a-secret', 'op://vault/item')

      expect(exitCode).toBe(1)
      const output = stdout + stderr
      expect(output).toContain('must start with op://')
      expect(output).toContain('vault/item/field')
    })
  })

  describe('validate command', () => {
    it('should treat unresolved placeholders as valid in local mode', async () => {
      await Bun.write(
        join(TEST_DIR, 'test-app/.env.example'),
        'API_KEY=op://envi-example/api-service-${PROFILE}/API_KEY\n',
      )

      const { json, exitCode } = await runCliJson('validate', '--json', '--only', 'test-app')

      expect(exitCode).toBe(0)
      expect(json.ok).toBe(true)
      expect(json.data.summary.invalid).toBe(0)
      expect(json.data.summary.valid).toBe(1)
    })
  })

  describe('--version', () => {
    it('should show version with -v flag', async () => {
      const { stdout, exitCode } = await runCli('-v')

      expect(exitCode).toBe(0)
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('should show version with --version flag', async () => {
      const { stdout, exitCode } = await runCli('--version')

      expect(exitCode).toBe(0)
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    })
  })

  describe('backup command', () => {
    it('should warn when no .env files to backup', async () => {
      const { stdout, exitCode } = await runCli('backup')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('No environment files found to backup')
    })

    it('should backup existing .env files into latest snapshot', async () => {
      // Create a test .env file
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'TEST_VAR=test_value\n')

      const { stdout, exitCode } = await runCli('backup')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Backed up')
      expect(stdout).toContain('test-app/.env')

      // Verify backup was created in latest/ and metadata exists
      const glob = new Bun.Glob('**/test-app/.env')
      const files: string[] = []
      for await (const entry of glob.scan({ cwd: BACKUP_DIR, dot: true })) {
        files.push(entry)
      }
      expect(files.length).toBe(1)
      expect(files[0]).toBe('latest/test-app/.env')
      expect(await Bun.file(join(BACKUP_DIR, 'latest/.envi-backup.json')).exists()).toBe(true)
    })

    it('should list files in dry-run mode without creating backup', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'TEST_VAR=test_value\n')

      const { stdout, exitCode } = await runCli('backup', '-d')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('dry-run mode')
      expect(stdout).toContain('test-app/.env')
      expect(stdout).toContain('no backups created')

      // Verify no backup was created
      const backupDirExists = await Bun.file(BACKUP_DIR).exists()
      expect(backupDirExists).toBe(false)
    })

    it('should backup multiple .env files', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'VAR1=value1\n')
      await $`mkdir -p ${TEST_DIR}/another-app`.quiet()
      await Bun.write(join(TEST_DIR, 'another-app/.env'), 'VAR2=value2\n')

      const { stdout, exitCode } = await runCli('backup')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('2')
      expect(stdout).toContain('Backed up')
    })

    it('should backup configured output files from config', async () => {
      await Bun.write(
        join(TEST_DIR, 'envi.json'),
        JSON.stringify(
          {
            outputFile: '.env.local',
          },
          null,
          2,
        ) + '\n',
      )
      await Bun.write(join(TEST_DIR, 'test-app/.env.local'), 'TEST_VAR=test_value\n')

      const { stdout, exitCode } = await runCli('backup')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('test-app/.env.local')
      expect(await Bun.file(join(BACKUP_DIR, 'latest/test-app/.env.local')).exists()).toBe(true)
    })

    it('should backup only scoped paths when --only is used', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'TEST_VAR=test_value\n')
      await $`mkdir -p ${TEST_DIR}/another-app`.quiet()
      await Bun.write(join(TEST_DIR, 'another-app/.env'), 'OTHER_VAR=other_value\n')

      const { stdout, exitCode } = await runCli('--only', 'test-app', 'backup')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('test-app/.env')
      expect(stdout).not.toContain('another-app/.env')
      expect(await Bun.file(join(BACKUP_DIR, 'latest/test-app/.env')).exists()).toBe(true)
      expect(await Bun.file(join(BACKUP_DIR, 'latest/another-app/.env')).exists()).toBe(false)
    })

    it('should backup arbitrary configured output filenames', async () => {
      await Bun.write(
        join(TEST_DIR, 'envi.json'),
        JSON.stringify(
          {
            outputFile: 'secrets.local',
          },
          null,
          2,
        ) + '\n',
      )
      await Bun.write(join(TEST_DIR, 'test-app/secrets.local'), 'TEST_VAR=test_value\n')

      const { exitCode } = await runCli('backup')

      expect(exitCode).toBe(0)
      expect(await Bun.file(join(BACKUP_DIR, 'latest/test-app/secrets.local')).exists()).toBe(true)
    })

    it('should return machine output in json mode', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'TEST_VAR=test_value\n')

      const { json, exitCode } = await runCliJson('--json', 'backup')

      expect(exitCode).toBe(0)
      expect(json.command).toBe('backup')
      expect(json.ok).toBe(true)
      expect(json.data.backedUp).toBe(1)
      expect(json.data.files).toContain('test-app/.env')
    })

    it('should archive the previous latest snapshot on repeated backups', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'TEST_VAR=test_value\n')

      const first = await runCliJson('--json', 'backup')
      expect(first.exitCode).toBe(0)

      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'TEST_VAR=updated\n')
      const second = await runCliJson('--json', 'backup')

      expect(second.exitCode).toBe(0)
      expect(await Bun.file(join(BACKUP_DIR, 'latest/test-app/.env')).exists()).toBe(true)
      const dirs = await Array.fromAsync(new Bun.Glob('*').scan({ cwd: BACKUP_DIR, onlyFiles: false }))
      expect(dirs.some((entry) => entry !== 'latest')).toBe(true)
    })
  })

  describe('restore command', () => {
    it('should fail when no backup directory exists', async () => {
      const { stdout, exitCode } = await runCli('restore')

      expect(exitCode).toBe(1)
      expect(stdout).toContain('No backups found')
    })

    it('should fail when backup directory has no snapshots', async () => {
      await $`mkdir -p ${BACKUP_DIR}`.quiet()

      const { stdout, exitCode } = await runCli('restore')

      expect(exitCode).toBe(1)
      expect(stdout).toContain('No backups found')
    })

    it('should list backups with --list flag', async () => {
      const snapshotId = createSnapshotId()
      await createBackupSnapshot({
        files: { 'test-app/.env': 'BACKUP_VAR=backup_value\n' },
      })
      await createBackupSnapshot({
        snapshotDirName: snapshotId,
        id: snapshotId,
        files: { 'test-app/.env': 'OLDER_VAR=older\n' },
      })

      const { stdout, exitCode } = await runCli('restore', '--list')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Available Backups')
      expect(stdout).toContain('latest')
      expect(stdout).toContain(snapshotId)
    })

    it('should restore latest backup by default', async () => {
      await createBackupSnapshot({
        files: { 'test-app/.env': 'RESTORED_VAR=restored_value\n' },
      })

      // Ensure target directory exists
      await $`mkdir -p ${TEST_DIR}/test-app`.quiet()

      const { stdout, exitCode } = await runCli('restore')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Restored')

      // Verify file was restored
      const restoredContent = await Bun.file(join(TEST_DIR, 'test-app/.env')).text()
      expect(restoredContent).toBe('RESTORED_VAR=restored_value\n')
    })

    it('should preview restore in dry-run mode', async () => {
      await createBackupSnapshot({
        files: { 'test-app/.env': 'DRY_VAR=dry_value\n' },
      })

      const { stdout, exitCode } = await runCli('restore', '-d')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('dry-run mode')
      expect(stdout).toContain('Would restore')
      expect(stdout).toContain('no files restored')

      // Verify file was NOT restored
      const fileExists = await Bun.file(join(TEST_DIR, 'test-app/.env')).exists()
      expect(fileExists).toBe(false)
    })

    it('should restore even identical files', async () => {
      const content = 'SAME_VAR=same_value\n'

      // Create backup and current file with same content
      await createBackupSnapshot({
        files: { 'test-app/.env': content },
      })
      await $`mkdir -p ${TEST_DIR}/test-app`.quiet()
      await Bun.write(join(TEST_DIR, 'test-app/.env'), content)

      const { stdout, exitCode } = await runCli('restore')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Restored')
    })

    it('should list backups in json mode', async () => {
      await createBackupSnapshot({
        files: { 'test-app/.env': 'BACKUP_VAR=backup_value\n' },
      })

      const { json, exitCode } = await runCliJson('--json', 'restore', '--list')

      expect(exitCode).toBe(0)
      expect(json.command).toBe('restore.list')
      expect(json.ok).toBe(true)
      expect(json.data.snapshots[0].id).toBe('latest')
    })

    it('should fail with structured json when no backups exist', async () => {
      const { json, exitCode } = await runCliJson('--json', 'restore')

      expect(exitCode).toBe(1)
      expect(json.command).toBe('restore')
      expect(json.ok).toBe(false)
      expect(json.issues[0].code).toBe('NO_BACKUPS')
    })

    it('should restore a specific archived snapshot by id', async () => {
      const archivedId = createSnapshotId()
      await createBackupSnapshot({
        files: { 'test-app/.env': 'LATEST_VAR=latest\n' },
      })
      await createBackupSnapshot({
        snapshotDirName: archivedId,
        id: archivedId,
        files: { 'test-app/.env': 'ARCHIVED_VAR=archived\n' },
      })

      await $`mkdir -p ${TEST_DIR}/test-app`.quiet()
      const { exitCode } = await runCli('restore', '--snapshot', archivedId)

      expect(exitCode).toBe(0)
      expect(await Bun.file(join(TEST_DIR, 'test-app/.env')).text()).toBe('ARCHIVED_VAR=archived\n')
    })

    it('should restore only scoped paths when --only is used', async () => {
      await createBackupSnapshot({
        files: {
          'test-app/.env': 'API_VAR=api\n',
          'another-app/.env': 'WEB_VAR=web\n',
        },
      })

      await $`mkdir -p ${TEST_DIR}/test-app ${TEST_DIR}/another-app`.quiet()
      const { exitCode } = await runCli('--only', 'test-app', 'restore')

      expect(exitCode).toBe(0)
      expect(await Bun.file(join(TEST_DIR, 'test-app/.env')).text()).toBe('API_VAR=api\n')
      expect(await Bun.file(join(TEST_DIR, 'another-app/.env')).exists()).toBe(false)
    })

    it('should fail when the requested snapshot id does not exist', async () => {
      await createBackupSnapshot({
        files: { 'test-app/.env': 'LATEST_VAR=latest\n' },
      })

      const { stdout, exitCode } = await runCli('restore', '--snapshot', 'missing-snapshot')

      expect(exitCode).toBe(1)
      expect(stdout).toContain('Snapshot not found: missing-snapshot')
    })

    it('should list and restore snapshots even with invalid metadata', async () => {
      await createBackupSnapshot({
        files: { 'test-app/secrets.local': 'TOKEN=restored\n' },
      })
      await Bun.write(join(BACKUP_DIR, 'latest/.envi-backup.json'), '{not-valid-json\n')
      await Bun.write(
        join(TEST_DIR, 'envi.json'),
        JSON.stringify(
          {
            outputFile: 'secrets.local',
          },
          null,
          2,
        ) + '\n',
      )
      await $`mkdir -p ${TEST_DIR}/test-app`.quiet()

      const listed = await runCli('restore', '--list')
      expect(listed.exitCode).toBe(0)
      expect(listed.stdout).toContain('latest')
      expect(listed.stdout).toContain('test-app/secrets.local')

      const restored = await runCli('restore')
      expect(restored.exitCode).toBe(0)
      expect(await Bun.file(join(TEST_DIR, 'test-app/secrets.local')).text()).toBe('TOKEN=restored\n')
    })
  })

  describe('command options', () => {
    it('should accept --dry-run after command', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'VAR=value\n')

      const { stdout, exitCode } = await runCli('backup', '--dry-run')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('dry-run mode')
    })

    it('should accept -d shorthand after command', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'VAR=value\n')

      const { stdout, exitCode } = await runCli('backup', '-d')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('dry-run mode')
    })

    it('should accept --quiet option', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'VAR=value\n')

      const { stdout, exitCode } = await runCli('--quiet', 'backup')

      expect(exitCode).toBe(0)
      // In quiet mode, should have minimal output
      expect(stdout.length).toBeLessThan(100)
    })

    it('should use config file values and allow cli overrides', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'VAR=value\n')
      await Bun.write(
        join(TEST_DIR, 'envi.json'),
        JSON.stringify(
          {
            backupDir: 'configured-backups',
          },
          null,
          2,
        ) + '\n',
      )

      const configured = await runCli('--config', 'envi.json', 'backup')
      expect(configured.exitCode).toBe(0)
      const configuredBackups = new Bun.Glob('**/.env')
      let configuredCount = 0
      for await (const _entry of configuredBackups.scan({ cwd: join(TEST_DIR, 'configured-backups'), dot: true })) {
        configuredCount++
      }
      expect(configuredCount).toBe(1)

      await $`rm -rf ${TEST_DIR}/configured-backups ${TEST_DIR}/cli-backups`.quiet().nothrow()

      const overridden = await runCli('--config', 'envi.json', '--backup-dir', 'cli-backups', 'backup')
      expect(overridden.exitCode).toBe(0)
      let cliCount = 0
      for await (const _entry of configuredBackups.scan({ cwd: join(TEST_DIR, 'cli-backups'), dot: true })) {
        cliCount++
      }
      expect(cliCount).toBe(1)
      expect(await Bun.file(join(TEST_DIR, 'configured-backups')).exists()).toBe(false)
    })
  })

  describe('--var flag', () => {
    it('should show --var option in help', async () => {
      const { stdout, exitCode } = await runCli('-h')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('--var')
    })

    it('should accept repeatable vars', async () => {
      const { stderr, exitCode } = await runCli('--var', 'PROFILE=prod', '--var', 'REGION=eu', 'backup')

      expect(exitCode).toBe(0)
      expect(stderr).not.toContain('Invalid --var')
    })

    it('should not inject default vars when --var is not provided', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'VAR=value\n')

      const { json, exitCode } = await runCliJson('--json', 'backup')

      expect(exitCode).toBe(0)
      expect(json.meta.vars).toEqual({})
    })
  })

  describe('edge cases', () => {
    it('should not hang on status when sdk auth fails', async () => {
      const { stdout, stderr, exitCode } = await runCliWithTimeout(
        3000,
        { OP_SERVICE_ACCOUNT_TOKEN: 'invalid', OP_ACCOUNT_NAME: '' },
        'status',
        '--provider-opt',
        'backend=sdk',
      )

      expect(exitCode).toBe(0)
      const output = stdout + stderr
      expect(output).toContain('Environment Status')
      expect(output).not.toContain('Vars:')
      expect(output).toContain('Authentication failed')
    })

    it('should report provider auth/availability errors for validate --remote', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env.example'), 'API_KEY=op://example-vault/example-item/API_KEY\n')

      const { stdout, stderr, exitCode } = await runCli(
        'validate',
        '--remote',
        '--provider-opt',
        'backend=cli',
        '--provider-opt',
        'cliBinary=op-does-not-exist',
      )

      expect(exitCode).toBe(1)
      expect(stdout + stderr).toContain('Authentication failed')
      expect(stdout + stderr).not.toContain('No templates found')
    })

    it('should fail for examples setup with a missing token, not broken imports', async () => {
      const proc = Bun.spawn(['bun', 'run', 'examples/setup.ts'], {
        cwd: join(TEST_DIR, '..', '..', '..'),
        env: {
          ...process.env,
          ENVI_1PASSWORD_EXAMPLES_TOKEN: '',
          ENVI_1PASSWORD_E2E_SERVICE_ACCOUNT_TOKEN: '',
          ENVI_1PASSWORD_BENCH_TOKEN: '',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const exitCode = await proc.exited
      const stderr = await new Response(proc.stderr).text()

      expect(exitCode).toBe(1)
      expect(stderr).toContain('Missing example 1Password token in .env.local')
      expect(stderr).not.toContain('Cannot find module')
    })

    it('should handle unknown command gracefully', async () => {
      const { stderr, exitCode } = await runCli('unknown-command')

      expect(exitCode).toBe(1)
      expect(stderr).toContain('unknown command')
    })

    it('should ignore node_modules when finding .env files', async () => {
      await $`mkdir -p ${TEST_DIR}/node_modules/some-package`.quiet()
      await Bun.write(join(TEST_DIR, 'node_modules/some-package/.env'), 'SHOULD_IGNORE=true\n')
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'SHOULD_INCLUDE=true\n')

      const { stdout, exitCode } = await runCli('backup')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('test-app/.env')
      expect(stdout).not.toContain('node_modules')
    })

    it('should handle .env files with special characters', async () => {
      const content = `PASSWORD=p@ss!w0rd#$%^&*()
URL=https://example.com?foo=bar&baz=qux
QUOTED="value with spaces"
`
      await Bun.write(join(TEST_DIR, 'test-app/.env'), content)

      // Backup
      const backupResult = await runCli('backup')
      expect(backupResult.exitCode).toBe(0)

      // Delete original
      await $`rm ${TEST_DIR}/test-app/.env`.quiet()

      // Restore
      const restoreResult = await runCli('restore')
      expect(restoreResult.exitCode).toBe(0)

      // Verify content preserved
      const restored = await Bun.file(join(TEST_DIR, 'test-app/.env')).text()
      expect(restored).toBe(content)
    })

    it('should fail on invalid provider opt format', async () => {
      const { stdout, stderr, exitCode } = await runCli('--provider-opt', 'backend', 'backup')

      expect(exitCode).toBe(1)
      expect(stdout + stderr).toContain('Invalid --provider-opt format')
    })
  })
})
