import { isSecretReference } from '../../providers'
import type { Change } from '../../utils/types'

export function redactChanges(changes: Change[]): Change[] {
  return changes.map((change) => {
    const templateValue = change.templateValue
    if (!templateValue || !isSecretReference(templateValue)) return change

    return {
      ...change,
      ...(change.localValue !== undefined ? { localValue: '<redacted>' } : {}),
      ...(change.newValue !== undefined ? { newValue: '<redacted>' } : {}),
    }
  })
}
