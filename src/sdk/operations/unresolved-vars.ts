import type { Issue } from '../types'

export interface UnresolvedVariableSummary {
  unresolved: Issue[]
  missingVars: string[]
  affectedKeys: string[]
}

export function summarizeUnresolvedVariableIssues(issues: Issue[]): UnresolvedVariableSummary {
  const unresolved = issues.filter((issue) => issue.code === 'UNRESOLVED_VARIABLE')
  const missingVars = new Set<string>()
  const affectedKeys = new Set<string>()

  for (const issue of unresolved) {
    if (issue.key) affectedKeys.add(issue.key)
    if (!issue.reference) continue

    for (const match of issue.reference.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)) {
      const name = match[1]
      if (name) missingVars.add(name)
    }
  }

  return {
    unresolved,
    missingVars: [...missingVars].sort(),
    affectedKeys: [...affectedKeys].sort(),
  }
}

export function formatUnresolvedVariableGuidance(args: {
  issues: Issue[]
  includeAffectedKeys?: boolean
}): string | undefined {
  const summary = summarizeUnresolvedVariableIssues(args.issues)
  if (summary.unresolved.length === 0) return undefined

  const lines: string[] = []
  if (summary.missingVars.length > 0) {
    lines.push(`Missing dynamic vars: ${summary.missingVars.join(', ')}`)
    lines.push('Pass required vars:')
    lines.push(`  ${summary.missingVars.map((name) => `--var ${name}=<value>`).join(' ')}`)
    lines.push('Or set "vars" in envi.json')
  } else {
    lines.push('Template contains unresolved dynamic vars')
    lines.push('Pass required --var NAME=value flags or set "vars" in envi.json')
  }

  if (args.includeAffectedKeys !== false && summary.affectedKeys.length > 0) {
    lines.push(`Affected keys: ${summary.affectedKeys.join(', ')}`)
  }

  return lines.join('\n')
}

export function collapseUnresolvedVariableIssues(issues: Issue[]): Issue[] {
  const summary = summarizeUnresolvedVariableIssues(issues)
  if (summary.unresolved.length === 0) return issues

  const guidance = formatUnresolvedVariableGuidance({ issues, includeAffectedKeys: true })
  if (!guidance) return issues

  const unresolvedPaths = new Set(
    summary.unresolved.map((issue) => issue.path).filter((path): path is string => !!path),
  )
  const [singlePath] = unresolvedPaths

  return [
    {
      code: 'UNRESOLVED_VARIABLES',
      message: guidance,
      ...(unresolvedPaths.size === 1 && singlePath ? { path: singlePath } : {}),
    },
    ...issues.filter((issue) => issue.code !== 'UNRESOLVED_VARIABLE'),
  ]
}
