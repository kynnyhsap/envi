import { confirm } from '@inquirer/prompts'

export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  try {
    return await confirm({ message, default: defaultValue })
  } catch {
    return false
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
  return Promise.race([promise, timeout])
}
