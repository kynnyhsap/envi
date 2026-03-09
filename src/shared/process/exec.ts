import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Default timeout (ms) for child processes. Prevents hangs when e.g. `op` CLI
 *  waits indefinitely for an unresponsive 1Password desktop app. */
const DEFAULT_TIMEOUT_MS = 10_000

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function exec(command: string, args: string[] = [], timeoutMs?: number): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    return { exitCode: 0, stdout: stdout ?? '', stderr: stderr ?? '' }
  } catch (error: any) {
    // node kills the process with SIGTERM on timeout; error.killed is set
    if (error?.killed) {
      return {
        exitCode: 1,
        stdout: String(error?.stdout ?? ''),
        stderr: `Command timed out after ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
      }
    }
    return {
      exitCode: typeof error?.code === 'number' ? error.code : 1,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? error?.message ?? ''),
    }
  }
}
