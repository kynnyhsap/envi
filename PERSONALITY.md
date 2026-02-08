# Envi Personality

Envi is the secret management CLI that feels calm, sharp, and trustworthy.

It should feel like a beautifully made tool: simple and intuitive on the surface, carefully engineered underneath.

## Core Identity

- Name: **Envi**
- Category: developer CLI for syncing and running with secrets
- Promise: never copy secrets by hand again
- Character: concise, confident, helpful, and quietly opinionated

## Product North Star

Every Envi interaction should optimize for all of these at once:

1. Delightful and easy to use
2. Perfect defaults
3. Deep customization without complexity tax

If a change improves power but hurts intuition, we redesign it.
If a change improves simplicity but blocks advanced teams, we add an escape hatch.

## Personality Principles

### 1) Simple and intuitive first

- First-time users should succeed without reading docs end-to-end.
- Command names should match intent (`sync`, `diff`, `status`, `run`).
- Output should answer: what happened, why it happened, what to do next.
- Avoid jargon unless it is standard and expected by CLI users.

### 2) Beautiful outside, beautiful inside

- UX quality and code quality are equally important.
- Internal architecture should be clean, composable, and obvious to extend.
- No hidden magic that surprises users or maintainers.
- Reliability is part of aesthetics.

### 3) Perfect defaults

- Zero-config should work in common project layouts.
- Safe behavior by default (mask secrets, dry-run support, confirm risky writes).
- Smart auto-discovery before manual setup.
- Useful output by default, quiet output when requested.

### 4) Customizable by design

- Every opinionated default should have a clear override.
- Support different team conventions (paths, template names, output files, providers, environments).
- Keep advanced options discoverable but not noisy.
- Customization should feel additive, not like fighting the tool.

### 5) Trust through transparency

- Show exactly what will change before writing when possible.
- Use explicit summaries (`new`, `updated`, `custom`, `unchanged`).
- Preserve local customizations unless user chooses otherwise.
- Never be vague about auth, provider, or file operations.

## Voice and Tone

Use this voice across CLI output, docs, errors, and logs.

- Concise: short, high-signal messages.
- Confident: no hedging when facts are known.
- Helpful: always include a next action on failures.
- Human: clear language, no robotic verbosity.

### Writing rules

- Prefer plain language over clever language.
- Prefer specific instructions over generic advice.
- Prefer active voice: "Run `envi sync`" over "Sync should be run".
- Use consistent terms: template, provider, environment, backup, custom vars.
- Always call the product `envi` in commands and user-facing examples.

## UX Standards for Commands

For each command experience:

1. Start with context (environment, provider, target scope)
2. Validate prerequisites early
3. Show planned changes clearly
4. Confirm destructive or high-impact actions unless `--force`
5. End with a compact summary and next step

A user should never wonder:

- which provider was used
- which files were touched
- whether secrets were updated
- how to recover (backups/restore)

## Error Experience

Good Envi errors are:

- specific (`Vault not found`, not `Something went wrong`)
- actionable (exact command, flag, or env var to fix it)
- non-panicky (calm and direct)

When possible, include:

1. What failed
2. Most likely reason
3. Single best next action

## Defaults and Escape Hatches

This is a hard rule:

- Default path: fastest path to success for most users
- Escape hatch: explicit option for non-standard workflows

Examples in spirit:

- Auto-discover templates by default, allow `--only` for precision
- Protect writes by default, allow `--force` for automation
- Standard file names by default, allow `--template` and `--output`

## Engineering Style That Matches the Personality

- Keep modules small, named by intent, and easy to scan
- Prefer clear data flow over clever abstractions
- Maintain provider-agnostic architecture in core flows
- Preserve deterministic behavior and output ordering
- Treat tests as product behavior specs, not just regressions

## Decision Filter (Use Before Shipping)

Ship only if the change is:

- Intuitive for a new user
- Faster for a returning user
- Safer for secrets and files
- Extensible for future providers/features
- Consistent with Envi tone and terminology

If any answer is "no", iterate before shipping.

## One-line Standard

Envi should feel like this:

**A simple, intuitive CLI with beautiful internals, perfect defaults, and powerful customization when you need it.**
