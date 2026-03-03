# Plan: Infrastructure as Code for DigitalOcean Deployment

**Date:** 2026-03-03
**Status:** Draft

---

## Overview

The platform is currently running locally only — no cloud deployment exists yet. This plan introduces Pulumi (TypeScript) to define a DigitalOcean Droplet, firewall, and project as code, so the first deployment is reproducible, version-controlled, and reviewable rather than a collection of manual steps. Application secrets use the simple approach: `.env` locally, GitHub Actions Secrets for CI/CD, and a manually-created `.env` file on the Droplet.

---

## Tool Choice: Pulumi (TypeScript)

**Recommendation: Pulumi over OpenTofu/Terraform.**

This project is TypeScript through and through (Bun, Hono, Zod, Drizzle). Pulumi lets you write infrastructure in the same language:
- Full TypeScript type safety and IDE autocomplete for every DigitalOcean resource
- Testable with the same test runner (`bun test` or Jest-compatible)
- No HCL DSL to learn — infrastructure is just TypeScript code with familiar loops, conditionals, functions
- Pulumi Cloud free tier handles state management (no S3 bucket, no manual backend config)
- DigitalOcean provider is actively maintained (`@pulumi/digitalocean` v4.59.0, Feb 2026)

**Why not OpenTofu/Terraform?**
Both use HCL — a bespoke DSL that's a second language to maintain. For a TypeScript-native solo/small team, HCL is cognitive overhead with no benefit. The user has already noted Terraform wasn't enjoyable. OpenTofu fixes the licence issue but not the DX issue.

**Why not Pulumi Cloud for the app itself?**
Pulumi is only used for infrastructure provisioning — the DigitalOcean Droplet, firewall rules, and project grouping. Application deployment (Docker pull + restart) stays in the existing `deploy.yml` GitHub Actions workflow.

### Trade-offs

- **Pulumi Cloud dependency**: State lives in Pulumi Cloud (free tier). If Pulumi Cloud is unavailable, you can't run `pulumi up`. Mitigated by the fact that infra changes are infrequent. Alternative: self-hosted backend (S3-compatible object storage) but that's overkill here.
- **Not managing secrets**: The `.env` file on the Droplet contains all runtime secrets and is populated manually. IaC creates the directory but cannot safely manage secret file content. This is intentional — it keeps secrets out of version control and IaC state.
- **GHCR authentication on Droplet**: The existing `deploy.yml` runs `docker pull ghcr.io/...` on the Droplet without a login step. If the GHCR package is private, this will fail. The deploy workflow may need a `docker login ghcr.io` step added (using a PAT stored as a secret). This is out of scope for this plan but noted.
- **Docker pre-installation**: We bootstrap Docker via a cloud-init `user_data` script. The Droplet takes ~2 minutes to fully boot and install Docker after Pulumi creates it. The first `pulumi up` output includes the IP address; deployment can proceed once SSH is available.

---

## Approach

Create an `infra/` directory at the project root containing a Pulumi TypeScript project. It provisions:

1. **DigitalOcean Project** — groups all resources for the competition under one named project in the DO console
2. **DigitalOcean Droplet** — Ubuntu 24.04 LTS, `s-1vcpu-1gb` ($6/mo), bootstrapped with Docker via cloud-init `user_data`
3. **DigitalOcean Firewall** — allows inbound SSH (22) and app traffic (3000), full outbound

The infra project uses `Pulumi.prod.yaml` for stack configuration. Sensitive config values (DO token, SSH key fingerprint) are stored encrypted in Pulumi Cloud — not in `.env` or plain config files.

A `infra-preview.yml` GitHub Actions workflow runs `pulumi preview` on any PR that touches `infra/`, so infra diffs are reviewed before applying. Apply (`pulumi up`) is always manual — never auto-triggered.

The existing `deploy.yml` is not changed. After `pulumi up` provisions a new Droplet, the operator updates `DROPLET_HOST` in GitHub Secrets with the new IP.

---

## Changes Required

### `infra/Pulumi.yaml`

Pulumi project manifest. Defines the project name, runtime (Node.js — Pulumi runs TypeScript via Node, not Bun), and entry point.

```yaml
name: llm-betting-infra
runtime:
  name: nodejs
  options:
    typescript: true
description: Infrastructure for the LLM Betting Competition platform
```

### `infra/package.json`

Node.js package manifest for the Pulumi project. Uses npm (not Bun) because Pulumi CLI invokes npm to install dependencies and executes via Node.js — not a Bun workload.

```json
{
  "name": "llm-betting-infra",
  "version": "0.1.0",
  "devDependencies": {
    "@types/node": "^22"
  },
  "dependencies": {
    "@pulumi/pulumi": "^3",
    "@pulumi/digitalocean": "^4"
  }
}
```

### `infra/tsconfig.json`

TypeScript config for the Pulumi program. Strict mode, targeting Node.js.

```json
{
  "compilerOptions": {
    "strict": true,
    "outDir": "bin",
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "sourceMap": true,
    "experimentalDecorators": true,
    "skipLibCheck": true
  },
  "include": ["*.ts"]
}
```

### `infra/index.ts`

The Pulumi program. All infrastructure is defined here.

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as digitalocean from "@pulumi/digitalocean";

const config = new pulumi.Config();

// Config values — set via `pulumi config set` or Pulumi.prod.yaml
const region = config.get("region") ?? "lon1";
const dropletSize = config.get("dropletSize") ?? "s-1vcpu-1gb";
// Fingerprint of an SSH key already registered in DigitalOcean
// Set with: pulumi config set --secret sshKeyFingerprint <fingerprint>
const sshKeyFingerprint = config.requireSecret("sshKeyFingerprint");

// Cloud-init script: installs Docker and creates app directory
const userData = `#!/bin/bash
set -euo pipefail
apt-get update -y
apt-get install -y docker.io
systemctl enable docker
systemctl start docker
mkdir -p /opt/llm-betting
echo "Bootstrap complete" > /opt/llm-betting/bootstrap.log
`;

// Droplet
const droplet = new digitalocean.Droplet("llm-betting", {
  name: "llm-betting",
  region,
  size: dropletSize,
  image: "ubuntu-24-04-x64",
  sshKeys: [sshKeyFingerprint],
  userData,
});

// Firewall
const firewall = new digitalocean.Firewall("llm-betting", {
  name: "llm-betting-firewall",
  inboundRules: [
    { protocol: "tcp", portRange: "22", sourceAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "tcp", portRange: "3000", sourceAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "icmp", sourceAddresses: ["0.0.0.0/0", "::/0"] },
  ],
  outboundRules: [
    { protocol: "tcp", portRange: "1-65535", destinationAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "udp", portRange: "1-65535", destinationAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "icmp", destinationAddresses: ["0.0.0.0/0", "::/0"] },
  ],
  dropletIds: [droplet.id],
});

// DigitalOcean Project — groups resources in the DO console
const project = new digitalocean.Project("llm-betting", {
  name: "llm-betting-competition",
  description: "LLM Betting Competition platform",
  purpose: "Web Application",
  environment: "Production",
  resources: [droplet.dropletUrn],
});

// Outputs — printed after `pulumi up`, used to configure deploy workflow
export const dropletIp = droplet.ipv4Address;
export const dropletId = droplet.id;
export const dropletUrn = droplet.dropletUrn;
```

### `infra/.gitignore`

```
node_modules/
bin/
.pulumi/
```

### `infra/Pulumi.prod.yaml`

Stack config for the `prod` stack. Committed to the repo. Secrets are encrypted by Pulumi Cloud — only the ciphertext appears here.

```yaml
config:
  llm-betting-infra:region: lon1
  llm-betting-infra:dropletSize: s-1vcpu-1gb
  llm-betting-infra:sshKeyFingerprint:
    secure: <encrypted-by-pulumi>
  digitalocean:token:
    secure: <encrypted-by-pulumi>
```

> **Note:** Pulumi.prod.yaml is committed. The `secure:` values are ciphertext that only Pulumi Cloud can decrypt. Never commit the plaintext token.

### `.github/workflows/infra-preview.yml`

New workflow: runs `pulumi preview` on PRs that touch `infra/`. Adds the diff as a PR comment, making infra changes reviewable. Does not apply — apply is always manual.

```yaml
name: Infra Preview

on:
  pull_request:
    paths:
      - 'infra/**'

jobs:
  preview:
    runs-on: ubuntu-latest
    name: Pulumi Preview
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install Pulumi CLI
        uses: pulumi/actions@v6

      - name: Install dependencies
        working-directory: infra
        run: npm ci

      - name: Pulumi Preview
        uses: pulumi/actions@v6
        with:
          command: preview
          stack-name: prod
          work-dir: infra
          comment-on-pr: true
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
```

---

## Data & Migration

Not applicable — no application database changes. The Turso database is a managed service; no IaC is needed for it. There is no existing Droplet to migrate — `pulumi up` creates everything from scratch.

---

## Post-Provisioning Steps (manual, not automated)

After `pulumi up` succeeds:

1. **Copy the output IP**: `pulumi stack output dropletIp`
2. **Update GitHub Secret `DROPLET_HOST`** with the new IP
3. **SSH to the Droplet** and create `/opt/llm-betting/.env` with all required secrets (see research.md "Authentication & Secrets" section)
4. **(If GHCR package is private)** Add `docker login ghcr.io -u <github-user> -p <PAT>` to the Droplet's bootstrap or to `deploy.yml`'s SSH script

These steps are one-time setup. Subsequent deployments use the existing `deploy.yml` workflow unchanged.

---

## Test Plan

Pulumi infra code is verified via preview and apply. No unit tests are written for this plan — the feedback loop is `pulumi preview` (dry-run diff) before every apply.

**Manual verification checklist after `pulumi up`:**
- `pulumi stack output dropletIp` returns a valid IP
- `ssh root@<ip>` connects successfully
- `docker info` on the Droplet shows Docker running
- `/opt/llm-betting/` directory exists
- Firewall visible in DigitalOcean console with correct rules
- Droplet appears under the "llm-betting-competition" DO project

---

## Secrets Strategy

**Local development:** `.env` file, gitignored. No change from current workflow.

**CI/CD (GitHub Actions):** GitHub Actions Secrets. The following secrets must be set in the repo (Settings → Secrets → Actions):

| Secret | Used by | Description |
|--------|---------|-------------|
| `DROPLET_HOST` | `deploy.yml` | Droplet IP (set after `pulumi up`) |
| `DROPLET_USER` | `deploy.yml` | SSH user (e.g. `root`) |
| `DROPLET_SSH_KEY` | `deploy.yml` | Private key for SSH access |
| `PULUMI_ACCESS_TOKEN` | `infra-preview.yml` | Pulumi Cloud token for preview |

**Production (Droplet):** A single `/opt/llm-betting/.env` file created manually via SSH after `pulumi up`. This file is never committed and never touched by IaC. Its shape mirrors the local `.env`.

A `.env.example` file is added to the repo root documenting every required variable with placeholder values — the authoritative reference for what the `.env` must contain.

### `.env.example` (new file, committed)

```bash
# OpenRouter
OPENROUTER_API_KEY=

# API-Sports
API_SPORTS_KEY=

# Turso
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

# Wallet encryption
WALLET_ENCRYPTION_KEY=

# Polymarket (optional — for direct interaction)
POLYGON_PRIVATE_KEY=

# App
NODE_ENV=production
PORT=3000
```

---

## Task Breakdown

- [ ] Register a Pulumi Cloud account at pulumi.com (free tier) and run `pulumi login` locally
- [ ] Ensure your SSH public key is registered in DigitalOcean (Settings → Security → SSH Keys) and note its fingerprint
- [x] Create `infra/Pulumi.yaml` with project name, runtime node, and typescript option
- [x] Create `infra/package.json` with `@pulumi/pulumi` and `@pulumi/digitalocean` dependencies
- [x] Create `infra/tsconfig.json` with strict mode and commonjs module target
- [x] Create `infra/index.ts` — Droplet, Firewall, Project resources and exports as specified above
- [x] Create `infra/.gitignore` excluding node_modules, bin, .pulumi
- [x] Run `npm install` inside `infra/` to generate `package-lock.json`
- [ ] Run `pulumi stack init prod` to create the prod stack
- [ ] Run `pulumi config set digitalocean:token <DO_API_TOKEN> --secret` to set the encrypted DO token
- [ ] Run `pulumi config set --secret llm-betting-infra:sshKeyFingerprint <fingerprint>` to set the encrypted SSH fingerprint
- [ ] Confirm `infra/Pulumi.prod.yaml` is created with `secure:` ciphertext values (not plaintext)
- [ ] Run `pulumi preview` and verify the plan shows: 1 Droplet, 1 Firewall, 1 Project
- [ ] Run `pulumi up` and confirm all three resources are created
- [ ] Copy `pulumi stack output dropletIp` and update `DROPLET_HOST` in GitHub repository secrets
- [ ] SSH to the Droplet and verify Docker is running (`docker info`) and `/opt/llm-betting/` exists
- [ ] Create `/opt/llm-betting/.env` on the Droplet using `.env.example` as the template, filling in real values
- [ ] Add `DROPLET_USER`, `DROPLET_SSH_KEY`, and `PULUMI_ACCESS_TOKEN` to GitHub repository secrets
- [ ] Trigger `deploy.yml` manually and confirm the container pulls and starts successfully
- [ ] Verify the app is reachable at `http://<droplet-ip>:3000`
- [x] Create `.env.example` at the repo root documenting all required variables
- [x] Create `.github/workflows/infra-preview.yml` as specified above
- [ ] Open a test PR modifying `infra/index.ts` (e.g. a comment) and confirm the preview workflow runs and posts a diff comment
