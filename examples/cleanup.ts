import {
  EXAMPLE_VAULT_TITLE,
  LEGACY_EXAMPLE_VAULT_TITLES,
  createExampleClient,
  findVaultByTitle,
  loadExampleConfig,
} from './common'

const config = await loadExampleConfig()
const client = await createExampleClient(config.token)

for (const title of [EXAMPLE_VAULT_TITLE, ...LEGACY_EXAMPLE_VAULT_TITLES]) {
  const vault = await findVaultByTitle(client, title)
  if (!vault) {
    console.info(`Skip ${title} (not found)`)
    continue
  }

  await client.vaults.delete(vault.id)
  console.info(`Deleted ${title}`)
}
