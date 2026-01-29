import { type EnvFile, type Change } from './types'
import { isSecretReference } from './secrets'

/**
 * Compute changes between template, injected values, and local file.
 * @param envSwitched - If true, treat all secrets as needing update (env changed)
 */
export function computeChanges(
  template: EnvFile,
  injected: EnvFile,
  local: EnvFile | null,
  envSwitched = false,
): Change[] {
  const changes: Change[] = []

  for (const key of injected.order) {
    const injectedVar = injected.vars.get(key)!
    const templateVar = template.vars.get(key)
    const localVar = local?.vars.get(key)
    const isSecret = templateVar && isSecretReference(templateVar.value)

    if (!local || !localVar) {
      changes.push({
        type: 'new',
        key,
        templateValue: templateVar?.value,
        newValue: injectedVar.value,
      })
    } else if (localVar.value === injectedVar.value && !envSwitched) {
      // Values match and no env switch - unchanged
      changes.push({
        type: 'unchanged',
        key,
        templateValue: templateVar?.value,
        localValue: localVar.value,
      })
    } else if (isSecret) {
      // Secret value differs OR env switched - mark as updated
      changes.push({
        type: 'updated',
        key,
        templateValue: templateVar.value,
        localValue: localVar.value,
        newValue: injectedVar.value,
      })
    } else if (localVar.value === injectedVar.value) {
      // Non-secret, values match (even with env switch) - unchanged
      changes.push({
        type: 'unchanged',
        key,
        templateValue: templateVar?.value,
        localValue: localVar.value,
      })
    } else {
      changes.push({
        type: 'local_modified',
        key,
        templateValue: injectedVar.value,
        localValue: localVar.value,
      })
    }
  }

  if (local) {
    for (const key of local.order) {
      if (!injected.vars.has(key)) {
        changes.push({
          type: 'custom',
          key,
          localValue: local.vars.get(key)!.value,
        })
      }
    }
  }

  return changes
}
