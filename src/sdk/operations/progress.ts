import { mapWithConcurrency } from '../../shared/concurrency'
import type { ProgressEvent, ProgressReporter } from '../types'
import type { EnviCommand } from '../types'

export async function emitProgress(progress: ProgressReporter | undefined, event: ProgressEvent): Promise<void> {
  if (!progress) return

  try {
    await progress(event)
  } catch {
    // Progress updates should never fail the main operation.
  }
}

export async function runStage<T>(args: {
  progress: ProgressReporter | undefined
  command: EnviCommand
  stage: string
  message: string
  run: () => Promise<T>
}): Promise<T> {
  await emitProgress(args.progress, {
    command: args.command,
    stage: args.stage,
    message: args.message,
  })

  return await args.run()
}

export async function mapWithProgress<TInput, TOutput>(args: {
  items: TInput[]
  concurrency: number
  map: (item: TInput, index: number) => Promise<TOutput>
  progress: ProgressReporter | undefined
  command: EnviCommand
  stage: string
  message: string | ((item: TInput, index: number) => string)
  path?: (item: TInput, index: number) => string | undefined
}): Promise<TOutput[]> {
  let completed = 0
  const indexed = args.items.map((item, index) => ({ item, index }))

  return await mapWithConcurrency(indexed, args.concurrency, async ({ item, index }) => {
    const result = await args.map(item, index)
    completed += 1

    const message = typeof args.message === 'string' ? args.message : args.message(item, index)
    const path = args.path ? args.path(item, index) : undefined

    const event: ProgressEvent = {
      command: args.command,
      stage: args.stage,
      message,
      completed,
      total: args.items.length,
    }
    if (path) {
      event.path = path
    }

    await emitProgress(args.progress, event)

    return result
  })
}
