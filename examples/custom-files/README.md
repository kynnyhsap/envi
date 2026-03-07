# Custom Template & Output Files

By default, Envi looks for `.env.example` and writes `.env`. This example shows the supported custom filename flags.

## Structure

```
custom-files/
└── .env.tpl          # Custom template name (not .env.example)
```

## Vault Setup

```bash
op vault create example

op item create \
  --vault example \
  --category login \
  --title "api-service" \
  'API_KEY[password]=sk_live_abc123' \
  'DATABASE_URL[password]=postgres://user:pass@localhost:5432/mydb'
```

## Usage

### Custom template name

```bash
# Use .env.tpl as the template instead of .env.example
envi sync --template .env.tpl
```

### Custom output name

```bash
# Write to .env.local instead of .env
envi sync --template .env.tpl --output .env.local
```

### Both custom

```bash
# Read from .env.tpl, write to .env.development
envi sync --template .env.tpl --output .env.development
```

### With other commands

```bash
# Diff against custom files
envi diff --template .env.tpl --output .env.local

# Validate custom template
envi validate --template .env.tpl

# Run with custom template
envi run --template .env.tpl -- node server.js
```

### Via config file

This folder also includes a working `envi.json`:

```bash
envi sync --config envi.json
```

## When to Use Custom Files

- **`.env.tpl`** — If your project already uses `.env.example` for non-envi purposes (e.g., manual copy-paste examples without secret references)
- **`.env.local`** — Frameworks like Next.js and Vite load `.env.local` automatically with higher priority than `.env`
- **`.env.development`** — When you want environment-specific output files
