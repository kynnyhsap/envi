export function isSecretReference(value: string): boolean {
  return value.trim().startsWith('op://')
}
