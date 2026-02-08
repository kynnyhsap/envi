import type { Issue } from '../types'
import type { ExecutionContext } from '../types'

export async function checkProviderReady(ctx: ExecutionContext): Promise<{ ok: boolean; issues: Issue[] }> {
  const issues: Issue[] = []

  const availability = await ctx.provider.checkAvailability()
  if (!availability.available) {
    issues.push({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'No authentication method available for provider',
    })
    return { ok: false, issues }
  }

  const auth = await ctx.provider.verifyAuth()
  if (!auth.success) {
    issues.push({
      code: 'AUTH_FAILED',
      message: auth.error ? `Authentication failed: ${auth.error}` : 'Authentication failed',
    })
    return { ok: false, issues }
  }

  return { ok: true, issues }
}
