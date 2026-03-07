import { EXAMPLE_VAULT_TITLE, createExampleClient, ensureExampleVault, loadExampleConfig } from './common'

const config = await loadExampleConfig()
const client = await createExampleClient(config.token)
const vault = await ensureExampleVault(client, config)

console.info(`Example vault ready: ${vault.title} (${vault.id})`)
if (vault.title === EXAMPLE_VAULT_TITLE) {
  console.info('All maintained examples now resolve from the shared envi-example vault.')
}
