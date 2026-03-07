import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function exec(command: string, args: string[] = []): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { encoding: 'utf8' })
    return { exitCode: 0, stdout: stdout ?? '', stderr: stderr ?? '' }
  } catch (error: any) {
    return {
      exitCode: typeof error?.code === 'number' ? error.code : 1,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? error?.message ?? ''),
    }
  }
}
