import type { Provider } from '../providers'

export function createFakeProvider(): Provider {
  return {
    id: 'fake',
    name: 'Fake Provider',
    scheme: 'op://',
    getAuthInfo() {
      return { type: 'test', identifier: 'fake' }
    },
    async checkAvailability() {
      return { available: true, statusLines: ['fake: ok'] }
    },
    async verifyAuth() {
      return { success: true }
    },
    getAuthFailureHints() {
      return { lines: [] }
    },
    async resolveSecret(reference: string) {
      return `resolved(${reference})`
    },
    async resolveSecrets(references: string[]) {
      const resolved = new Map<string, string>()
      const errors = new Map<string, string>()
      for (const ref of references) {
        resolved.set(ref, `resolved(${ref})`)
      }
      return { resolved, errors }
    },
    async listVaults() {
      return []
    },
  }
}
