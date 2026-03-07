import { type EnvFile, type Change } from './types'

export function mergeEnvFiles(template: EnvFile, injected: EnvFile, local: EnvFile | null, changes: Change[]): EnvFile {
  const result: EnvFile = {
    vars: new Map(),
    order: [],
    trailingContent: template.trailingContent,
  }

  const changeMap = new Map(changes.map((c) => [c.key, c]))

  for (const key of template.order) {
    const templateVar = template.vars.get(key)!
    const injectedVar = injected.vars.get(key)
    const change = changeMap.get(key)
    const localVar = local?.vars.get(key)

    let value: string
    const comment = templateVar.comment

    switch (change?.type) {
      case 'local_modified':
        value = localVar?.value ?? injectedVar?.value ?? templateVar.value
        break
      default:
        value = injectedVar?.value ?? templateVar.value
        break
    }

    result.vars.set(key, { key, value, comment, isCustom: false })
    result.order.push(key)
  }

  for (const change of changes) {
    if (change.type === 'custom' && local) {
      const localVar = local.vars.get(change.key)
      if (localVar) {
        result.vars.set(change.key, { ...localVar, isCustom: true })
        result.order.push(change.key)
      }
    }
  }

  return result
}
