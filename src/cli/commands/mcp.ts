import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { VERSION } from '../../app/config'
import { createEnviEngine } from '../../sdk'
import type {
  BackupOperationOptions,
  CreateEngineOptions,
  RestoreOperationOptions,
  SyncOperationOptions,
  ValidateOperationOptions,
} from '../../sdk/types'

/** Strip keys whose value is `undefined` so exact-optional-property types are satisfied. */
function strip<T>(obj: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

function makeEngine(args: {
  only?: string | undefined
  environment?: string | undefined
}): ReturnType<typeof createEnviEngine> {
  const opts: CreateEngineOptions = {}

  const overrides: Record<string, unknown> = {}
  if (args.only) overrides['paths'] = args.only.split(',').map((p) => p.trim())
  if (args.environment) overrides['environment'] = args.environment

  if (Object.keys(overrides).length > 0) {
    opts.options = overrides as NonNullable<CreateEngineOptions['options']>
  }

  return createEnviEngine(opts)
}

function text(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function error(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export async function mcpCommand(): Promise<void> {
  const server = new McpServer({
    name: 'envi',
    version: VERSION,
  })

  server.registerTool(
    'status',
    {
      title: 'Environment Status',
      description: 'Show .env sync status, provider auth, and backup info',
      inputSchema: z.object({
        only: z.string().optional().describe('Comma-separated paths to scope (e.g. "apps/api,apps/web")'),
        environment: z.string().optional().describe('Environment name (default: "local")'),
      }),
    },
    async (args) => {
      const engine = makeEngine(args)
      const result = await engine.status()
      return text(result)
    },
  )

  server.registerTool(
    'diff',
    {
      title: 'Environment Diff',
      description: 'Show differences between local .env files and resolved secrets from provider',
      inputSchema: z.object({
        only: z.string().optional().describe('Comma-separated paths to scope'),
        environment: z.string().optional().describe('Environment name (default: "local")'),
      }),
    },
    async (args) => {
      const engine = makeEngine(args)
      const result = await engine.diff()
      return text(result)
    },
  )

  server.registerTool(
    'sync',
    {
      title: 'Sync Environment',
      description: 'Sync .env files from templates by resolving secrets from provider. Creates a backup by default.',
      inputSchema: z.object({
        only: z.string().optional().describe('Comma-separated paths to scope'),
        environment: z.string().optional().describe('Environment name (default: "local")'),
        dryRun: z.boolean().optional().describe('Preview changes without writing files'),
        noBackup: z.boolean().optional().describe('Skip creating a backup before syncing'),
      }),
    },
    async (args) => {
      const engine = makeEngine(args)
      const result = await engine.sync(strip<SyncOperationOptions>({ dryRun: args.dryRun, noBackup: args.noBackup }))
      return text(result)
    },
  )

  server.registerTool(
    'validate',
    {
      title: 'Validate References',
      description:
        'Validate all secret references in .env.example templates. Use remote=true to verify they exist in the provider.',
      inputSchema: z.object({
        only: z.string().optional().describe('Comma-separated paths to scope'),
        environment: z.string().optional().describe('Environment name (default: "local")'),
        remote: z.boolean().optional().describe('Also check references exist in the provider'),
      }),
    },
    async (args) => {
      const engine = makeEngine(args)
      const result = await engine.validate(strip<ValidateOperationOptions>({ remote: args.remote }))
      return text(result)
    },
  )

  server.registerTool(
    'resolve',
    {
      title: 'Resolve Secrets',
      description: 'Resolve one or more op:// secret references and return their values',
      inputSchema: z.object({
        references: z.array(z.string()).describe('Secret references to resolve (e.g. ["op://vault/item/field"])'),
        environment: z.string().optional().describe('Environment name (default: "local")'),
      }),
    },
    async (args) => {
      if (args.references.length === 0) {
        return error('No references provided')
      }
      const engine = makeEngine(args)
      const refs = args.references
      const result = await engine.resolveSecret({
        reference: refs[0]!,
        ...(refs.length > 1 ? { references: refs } : {}),
      })
      return text(result)
    },
  )

  server.registerTool(
    'backup',
    {
      title: 'Backup Environment Files',
      description: 'Create a timestamped backup of current environment files',
      inputSchema: z.object({
        only: z.string().optional().describe('Comma-separated paths to scope'),
        dryRun: z.boolean().optional().describe('Preview backup without creating it'),
        list: z.boolean().optional().describe('List existing backup snapshots instead of creating one'),
      }),
    },
    async (args) => {
      const engine = makeEngine(args)
      const result = await engine.backup(strip<BackupOperationOptions>({ dryRun: args.dryRun, list: args.list }))
      return text(result)
    },
  )

  server.registerTool(
    'restore',
    {
      title: 'Restore Environment Files',
      description: 'Restore environment files from a backup snapshot. Defaults to latest.',
      inputSchema: z.object({
        only: z.string().optional().describe('Comma-separated paths to scope'),
        snapshot: z.string().optional().describe('Snapshot ID to restore (defaults to "latest")'),
        dryRun: z.boolean().optional().describe('Preview restore without writing files'),
        list: z.boolean().optional().describe('List available snapshots instead of restoring'),
      }),
    },
    async (args) => {
      const engine = makeEngine(args)
      const result = await engine.restore(
        strip<RestoreOperationOptions>({ snapshot: args.snapshot, dryRun: args.dryRun, list: args.list }),
      )
      return text(result)
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
