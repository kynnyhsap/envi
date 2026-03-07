import type { Issue } from '../types'
import type { ExecutionContext } from '../types'

export interface ProviderReadiness {
  availability: Awaited<ReturnType<ExecutionContext['provider']['checkAvailability']>>
  auth: Awaited<ReturnType<ExecutionContext['provider']['verifyAuth']>>
  authInfo: ReturnType<ExecutionContext['provider']['getAuthInfo']>
  hints: ReturnType<ExecutionContext['provider']['getAuthFailureHints']>
  issues: Issue[]
}

export async function getProviderReadiness(ctx: ExecutionContext): Promise<ProviderReadiness> {
  const issues: Issue[] = []

  const availability = await ctx.provider.checkAvailability()
  if (!availability.available) {
    issues.push({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'No authentication method available for provider',
    })
    return {
      availability,
      auth: { success: false, error: 'Provider unavailable' },
      authInfo: ctx.provider.getAuthInfo(),
      hints: ctx.provider.getAuthFailureHints(),
      issues,
    }
  }

  const auth = await ctx.provider.verifyAuth()
  if (!auth.success) {
    issues.push({
      code: 'AUTH_FAILED',
      message: auth.error ? `Authentication failed: ${auth.error}` : 'Authentication failed',
    })
  }

  return {
    availability,
    auth,
    authInfo: ctx.provider.getAuthInfo(),
    hints: auth.success ? { lines: [] } : ctx.provider.getAuthFailureHints(),
    issues,
  }
}

export async function checkProviderReady(ctx: ExecutionContext): Promise<{ ok: boolean; issues: Issue[] }> {
  const readiness = await getProviderReadiness(ctx)
  return {
    ok: readiness.availability.available && readiness.auth.success,
    issues: readiness.issues,
  }
}
