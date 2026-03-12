import type { ProgressEvent, ProgressReporter } from '../types'

export async function emitProgress(progress: ProgressReporter | undefined, event: ProgressEvent): Promise<void> {
  if (!progress) return

  try {
    await progress(event)
  } catch {
    // Progress updates should never fail the main operation.
  }
}
