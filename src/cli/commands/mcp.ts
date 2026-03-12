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

interface ScopedArgs {
  only?: string | undefined
  vars?: Record<string, string> | undefined
}

function splitOnlyPaths(only?: string): string[] | undefined {
  if (!only) return undefined
  const paths = only
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
  return paths.length > 0 ? paths : undefined
}

function makeEngine(args: ScopedArgs): ReturnType<typeof createEnviEngine> {
  const opts: CreateEngineOptions = {}

  const paths = splitOnlyPaths(args.only)
  if (paths || args.vars) {
    opts.options = {
      ...(paths ? { paths } : {}),
      ...(args.vars ? { vars: args.vars } : {}),
    }
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
        vars: z.record(z.string(), z.string()).optional().describe('Dynamic reference vars'),
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
        vars: z.record(z.string(), z.string()).optional().describe('Dynamic reference vars'),
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
        vars: z.record(z.string(), z.string()).optional().describe('Dynamic reference vars'),
        dryRun: z.boolean().optional().describe('Preview changes without writing files'),
        noBackup: z.boolean().optional().describe('Skip creating a backup before syncing'),
      }),
    },
    async (args) => {
      const engine = makeEngine(args)
      const result = await engine.sync({
        ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
        ...(args.noBackup !== undefined ? { noBackup: args.noBackup } : {}),
      } satisfies SyncOperationOptions)
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
        vars: z.record(z.string(), z.string()).optional().describe('Dynamic reference vars'),
        remote: z.boolean().optional().describe('Also check references exist in the provider'),
      }),
    },
    async (args) => {
      const engine = makeEngine(args)
      const result = await engine.validate({
        ...(args.remote !== undefined ? { remote: args.remote } : {}),
      } satisfies ValidateOperationOptions)
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
        vars: z.record(z.string(), z.string()).optional().describe('Dynamic reference vars'),
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
      const result = await engine.backup({
        ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
        ...(args.list !== undefined ? { list: args.list } : {}),
      } satisfies BackupOperationOptions)
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
      const result = await engine.restore({
        ...(args.snapshot !== undefined ? { snapshot: args.snapshot } : {}),
        ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
        ...(args.list !== undefined ? { list: args.list } : {}),
      } satisfies RestoreOperationOptions)
      return text(result)
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
