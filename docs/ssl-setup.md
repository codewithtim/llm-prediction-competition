# SSL Setup Guide (Cloudflare Origin Certificate)

This project uses a **Cloudflare Origin Certificate** for HTTPS. This means Cloudflare handles the public SSL certificate that users see, and the Origin Certificate secures the connection between Cloudflare and the DigitalOcean droplet.

Origin Certificates last **15 years** and require no renewal or ACME challenges.

## Step 1: Create the Origin Certificate

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your domain (e.g. `opnly.bet`)
3. Go to **SSL/TLS** > **Origin Server**
4. Click **Create Certificate**
5. Leave the defaults:
   - Private key type: **RSA (2048)**
   - Hostnames: your domain and wildcard (e.g. `opnly.bet`, `*.opnly.bet`)
   - Certificate validity: **15 years**
6. Click **Create**
7. You'll see two text blocks:
   - **Origin Certificate** — starts with `-----BEGIN CERTIFICATE-----`
   - **Private Key** — starts with `-----BEGIN PRIVATE KEY-----`
8. **Copy both immediately** — the private key is only shown once

## Step 2: Set Cloudflare SSL Mode

1. In Cloudflare Dashboard, go to **SSL/TLS** > **Overview**
2. Set the mode to **Full (Strict)**

This tells Cloudflare to connect to your origin over HTTPS and verify the Origin Certificate.

## Step 3: Ensure DNS is Proxied

1. Go to **DNS** > **Records**
2. Your A record pointing to the droplet IP should have the **orange cloud** (Proxied) enabled
3. This means traffic flows: User → Cloudflare (public SSL) → Your server (Origin Certificate)

## Step 4: Add GitHub Secrets

In your GitHub repository:

1. Go to **Settings** > **Secrets and variables** > **Actions**
2. Add these secrets (if not already present):

| Secret | Value |
|--------|-------|
| `DOMAIN` | Your domain, e.g. `opnly.bet` |
| `ORIGIN_CERT` | The full Origin Certificate text (including `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----` lines) |
| `ORIGIN_KEY` | The full Private Key text (including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines) |

## Step 5: Deploy

Run the deploy workflow from GitHub Actions:

1. Go to **Actions** > **Deploy** > **Run workflow**
2. Type `deploy` to confirm
3. The workflow will write the cert files to the droplet and start Caddy with them

## How It Works

The deploy script:
1. Writes the cert and key to `/opt/llm-betting/certs/` on the droplet
2. Creates a Caddyfile that uses these certs for TLS (no automatic ACME)
3. Runs a Caddy container that terminates HTTPS on ports 80/443
4. Caddy reverse-proxies to the app container on port 3000 over the internal Docker network

```
User → Cloudflare (public SSL) → Caddy (Origin Cert, port 443) → App (port 3000)
```

## Troubleshooting

**Error 525 (SSL handshake failed)**
- Check that Cloudflare SSL mode is set to **Full (Strict)**
- Verify the Origin Certificate was created for the correct domain
- Check Caddy logs: `docker logs caddy`

**Error 521 (Web server is down)**
- The Caddy container may not be running: `docker ps`
- Check if port 443 is open: `ufw status` (should allow 443)

**Certificate expired**
- Origin Certificates last 15 years, so this is unlikely
- If needed, repeat Steps 1-4 to generate a new one
