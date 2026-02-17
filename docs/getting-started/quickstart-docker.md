---
title: "Quick Start (Docker)"
description: "Run a Special Agent Gateway in Docker with WebChat in under 10 minutes"
---

# Quick Start (Docker)

Get a running Gateway with WebChat using Docker Compose. This is the recommended deployment method for production environments.

## Prerequisites

- Docker Desktop (or Docker Engine) + Docker Compose v2
- An API key for your model provider (OpenAI, Anthropic, or any compatible endpoint), or a running Ollama instance

## Setup

### Option A: Automated setup script

From the repository root:

```bash
./docker-setup.sh
```

This script:
1. Builds the Gateway Docker image
2. Runs the onboarding wizard (provider setup, gateway auth, channels)
3. Generates a gateway token and writes it to `.env`
4. Starts the Gateway via Docker Compose

### Option B: Manual setup

```bash
# Build the image
docker build -t special-agent:local -f Dockerfile .

# Run onboarding
docker compose run --rm special-agent-cli onboard

# Start the gateway
docker compose up -d special-agent-gateway
```

## Access the WebChat UI

Open `http://127.0.0.1:18789/` in your browser.

If the Gateway has token auth enabled (recommended), paste the token into the Control UI under Settings. To retrieve the dashboard URL and token:

```bash
docker compose run --rm special-agent-cli dashboard --no-open
```

## Configure a model provider

During onboarding, the wizard offers two options:

**Custom Provider** — any OpenAI-compatible or Anthropic-compatible endpoint:
```bash
# When prompted, select "Custom Provider" and enter:
# - API type: openai-compatible or anthropic-compatible
# - Base URL: https://your-api-gateway.example.com/v1
# - API key: your-api-key
```

**Ollama** — local model inference:
```bash
# When prompted, select "Ollama"
# Ensure Ollama is accessible from the Docker network
# Default: http://host.docker.internal:11434
```

## Verify the Gateway

```bash
# Check health
docker compose exec special-agent-gateway \
  node dist/index.js health --token "$SPECIAL_AGENT_GATEWAY_TOKEN"

# Check status via CLI
docker compose run --rm special-agent-cli status
```

## Send a test message

```bash
docker compose run --rm special-agent-cli agent \
  --message "Hello, what can you help me with?"
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `SPECIAL_AGENT_GATEWAY_TOKEN` | Auth token for Gateway access |
| `SPECIAL_AGENT_DOCKER_APT_PACKAGES` | Extra apt packages to bake into the image |
| `SPECIAL_AGENT_EXTRA_MOUNTS` | Comma-separated Docker bind mounts |
| `SPECIAL_AGENT_HOME_VOLUME` | Named volume for `/home/node` persistence |

## Permissions

The image runs as `node` (uid 1000). If you see `EACCES` errors on bind mounts:

```bash
sudo chown -R 1000:1000 ~/.special-agent
```

## Next steps

- [Docker Deployment](/deployment/docker) — production hardening, volumes, sandbox setup
- [Configuration](/deployment/configuration) — JSON5 config file reference
- [Microsoft Teams](/channels/microsoft-teams) — connect the bundled Teams channel
- [Security Overview](/security/overview) — authentication, sandboxing, tool policies
