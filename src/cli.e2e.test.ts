import { $ } from 'bun'
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'

import { BACKUP_FOLDER_NAME } from './config'

const CLI_PATH = join(import.meta.dir, 'cli.ts')
const TEST_DIR = join(import.meta.dir, '.test-workspace')
const BACKUP_DIR = join(TEST_DIR, BACKUP_FOLDER_NAME)

async function runCli(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await $`bun ${CLI_PATH} ${args}`.cwd(TEST_DIR).quiet()
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: 0,
    }
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? '',
      exitCode: error.exitCode ?? 1,
    }
  }
}

async function setupTestWorkspace() {
  await $`rm -rf ${TEST_DIR}`.quiet().nothrow()
  await $`mkdir -p ${TEST_DIR}/test-app`.quiet()
}

async function cleanupTestWorkspace() {
  await $`rm -rf ${TEST_DIR}`.quiet().nothrow()
}

// Helper to create a timestamped backup directory
function createTimestampDir(): string {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
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
      expect(stdout).toContain('backup')
      expect(stdout).toContain('restore')
    })

    it('should show help with --help flag', async () => {
      const { stdout, exitCode } = await runCli('--help')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('envi')
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
      expect(stdout).toContain('--force')
      expect(stdout).toContain('--dry-run')
      expect(stdout).toContain('--no-backup')
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

  // NOTE: status command tests are skipped because they call 1Password CLI
  // which can hang or trigger authentication prompts during automated testing.
  describe.skip('status command (requires 1Password)', () => {
    it('should run status command explicitly', async () => {
      const { stdout, exitCode } = await runCli('status')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Environment Status')
      expect(stdout).toContain('Configured Paths')
      expect(stdout).toContain('Summary')
    })

    it('should show no-template status for paths without .env.example', async () => {
      const { stdout, exitCode } = await runCli('status')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('no template')
    })
  })

  describe('backup command', () => {
    it('should warn when no .env files to backup', async () => {
      const { stdout, exitCode } = await runCli('backup', '-f')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('No .env files found to backup')
    })

    it('should backup existing .env files with --force (timestamped)', async () => {
      // Create a test .env file
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'TEST_VAR=test_value\n')

      const { stdout, exitCode } = await runCli('backup', '-f')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Backed up')
      expect(stdout).toContain('test-app/.env')

      // Verify backup was created in a timestamped directory
      const glob = new Bun.Glob('**/test-app/.env')
      const files: string[] = []
      for await (const entry of glob.scan({ cwd: BACKUP_DIR, dot: true })) {
        files.push(entry)
      }
      expect(files.length).toBe(1)
      // Should be in format: YYYY-MM-DD_HH-MM-SS/test-app/.env
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\/test-app\/\.env$/)
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

      const { stdout, exitCode } = await runCli('backup', '-f')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('2')
      expect(stdout).toContain('Backed up')
    })
  })

  describe('restore command', () => {
    it('should fail when no backup directory exists', async () => {
      const { stdout, exitCode } = await runCli('restore', '-f')

      expect(exitCode).toBe(1)
      expect(stdout).toContain('No backups found')
    })

    it('should fail when backup directory has no snapshots', async () => {
      await $`mkdir -p ${BACKUP_DIR}`.quiet()

      const { stdout, exitCode } = await runCli('restore', '-f')

      expect(exitCode).toBe(1)
      expect(stdout).toContain('No backups found')
    })

    it('should list backups with --list flag', async () => {
      // Create a timestamped backup
      const timestamp = createTimestampDir()
      await $`mkdir -p ${BACKUP_DIR}/${timestamp}/test-app`.quiet()
      await Bun.write(join(BACKUP_DIR, timestamp, 'test-app/.env'), 'BACKUP_VAR=backup_value\n')

      const { stdout, exitCode } = await runCli('restore', '--list')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Available Backups')
      expect(stdout).toContain(timestamp)
    })

    it('should restore backup with --force (uses most recent)', async () => {
      // Create a timestamped backup
      const timestamp = createTimestampDir()
      await $`mkdir -p ${BACKUP_DIR}/${timestamp}/test-app`.quiet()
      await Bun.write(join(BACKUP_DIR, timestamp, 'test-app/.env'), 'RESTORED_VAR=restored_value\n')

      // Ensure target directory exists
      await $`mkdir -p ${TEST_DIR}/test-app`.quiet()

      const { stdout, exitCode } = await runCli('restore', '-f')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Restored')

      // Verify file was restored
      const restoredContent = await Bun.file(join(TEST_DIR, 'test-app/.env')).text()
      expect(restoredContent).toBe('RESTORED_VAR=restored_value\n')
    })

    it('should preview restore in dry-run mode', async () => {
      const timestamp = createTimestampDir()
      await $`mkdir -p ${BACKUP_DIR}/${timestamp}/test-app`.quiet()
      await Bun.write(join(BACKUP_DIR, timestamp, 'test-app/.env'), 'DRY_VAR=dry_value\n')

      const { stdout, exitCode } = await runCli('restore', '-d')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('dry-run mode')
      expect(stdout).toContain('Would restore')
      expect(stdout).toContain('no files restored')

      // Verify file was NOT restored
      const fileExists = await Bun.file(join(TEST_DIR, 'test-app/.env')).exists()
      expect(fileExists).toBe(false)
    })

    it('should restore even identical files when using --force', async () => {
      const timestamp = createTimestampDir()
      const content = 'SAME_VAR=same_value\n'

      // Create backup and current file with same content
      await $`mkdir -p ${BACKUP_DIR}/${timestamp}/test-app`.quiet()
      await Bun.write(join(BACKUP_DIR, timestamp, 'test-app/.env'), content)
      await $`mkdir -p ${TEST_DIR}/test-app`.quiet()
      await Bun.write(join(TEST_DIR, 'test-app/.env'), content)

      // With --force, it restores even identical files
      const { stdout, exitCode } = await runCli('restore', '-f')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Restored')
    })
  })

  // NOTE: sync command tests are skipped because they require 1Password CLI
  // which triggers permission dialogs during automated testing.
  // The sync command is tested manually and via the prerequisite checks.
  describe.skip('sync command (requires 1Password)', () => {
    it('should show dry-run and force mode messages', async () => {
      const { stdout } = await runCli('sync', '-d', '-f')

      expect(stdout).toContain('dry-run mode')
      expect(stdout).toContain('force mode')
    })

    it('should show banner', async () => {
      const { stdout } = await runCli('sync', '-d', '-f')

      expect(stdout).toContain('Environment Sync')
    })

    it('should create backup by default before syncing', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'EXISTING=value\n')

      await runCli('sync', '-f')

      // Verify backup was created
      const glob = new Bun.Glob('**/test-app/.env')
      const files: string[] = []
      for await (const entry of glob.scan({ cwd: BACKUP_DIR, dot: true })) {
        files.push(entry)
      }
      expect(files.length).toBeGreaterThan(0)
    })

    it('should skip backup when --no-backup is used', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'EXISTING=value\n')

      await runCli('sync', '-f', '--no-backup')

      // Verify no backup was created
      const backupDirExists = await Bun.file(BACKUP_DIR).exists()
      expect(backupDirExists).toBe(false)
    })

    it('should skip backup in dry-run mode regardless of --no-backup', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'EXISTING=value\n')

      await runCli('sync', '-d', '-f')

      // dry-run already skips backup
      const backupDirExists = await Bun.file(BACKUP_DIR).exists()
      expect(backupDirExists).toBe(false)
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

      const { stdout, exitCode } = await runCli('--quiet', 'backup', '-f')

      expect(exitCode).toBe(0)
      // In quiet mode, should have minimal output
      expect(stdout.length).toBeLessThan(100)
    })
  })

  describe('--env flag', () => {
    it('should show --env option in help', async () => {
      const { stdout, exitCode } = await runCli('-h')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('--env')
    })

    it('should accept any environment name', async () => {
      for (const env of ['local', 'prod', 'my-custom-env', 'anything-goes']) {
        const { stderr } = await runCli('--env', env, 'backup', '-f')
        expect(stderr).not.toContain('Invalid environment')
      }
    })

    it('should default to "local" environment', async () => {
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'VAR=value\n')

      const { exitCode } = await runCli('backup', '-f')

      expect(exitCode).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('should handle unknown command gracefully', async () => {
      const { stderr, exitCode } = await runCli('unknown-command')

      expect(exitCode).toBe(1)
      expect(stderr).toContain('unknown command')
    })

    it('should ignore node_modules when finding .env files', async () => {
      await $`mkdir -p ${TEST_DIR}/node_modules/some-package`.quiet()
      await Bun.write(join(TEST_DIR, 'node_modules/some-package/.env'), 'SHOULD_IGNORE=true\n')
      await Bun.write(join(TEST_DIR, 'test-app/.env'), 'SHOULD_INCLUDE=true\n')

      const { stdout, exitCode } = await runCli('backup', '-f')

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
      const backupResult = await runCli('backup', '-f')
      expect(backupResult.exitCode).toBe(0)

      // Delete original
      await $`rm ${TEST_DIR}/test-app/.env`.quiet()

      // Restore
      const restoreResult = await runCli('restore', '-f')
      expect(restoreResult.exitCode).toBe(0)

      // Verify content preserved
      const restored = await Bun.file(join(TEST_DIR, 'test-app/.env')).text()
      expect(restored).toBe(content)
    })
  })
})
