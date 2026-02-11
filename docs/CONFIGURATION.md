# Configuration

## Environment Variables

All environment variables for the Event Handler (set in `event_handler/.env`):

| Variable | Description | Required |
|----------|-------------|----------|
| `API_KEY` | Authentication key for all endpoints (except `/telegram/webhook` and `/github/webhook` which use their own secrets) | Yes |
| `GH_TOKEN` | GitHub PAT for creating branches/files | Yes |
| `GH_OWNER` | GitHub repository owner | Yes |
| `GH_REPO` | GitHub repository name | Yes |
| `PORT` | Server port (default: 3000) | No |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather | For Telegram |
| `TELEGRAM_CHAT_ID` | Restricts bot to this chat only | For security |
| `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook validation | No |
| `GH_WEBHOOK_SECRET` | Secret for GitHub Actions webhook auth | For notifications |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude chat functionality | For chat (one of three) |
| `OPENROUTER_API_KEY` | OpenRouter API key for alternative LLM routing | For chat (one of three) |
| `NVIDIA_API_KEY` | NVIDIA NIM API key (get at https://build.nvidia.com) | For chat (one of three) |
| `OPENAI_API_KEY` | OpenAI key for voice transcription | For voice |
| `EVENT_HANDLER_MODEL` | Model for chat (default: claude-sonnet-4). Use Anthropic models, OpenRouter model IDs, or NVIDIA model IDs like `moonshotai/kimi-k2.5` | No |

---

## GitHub Secrets

Set automatically by the setup wizard:

| Secret | Description | Required |
|--------|-------------|----------|
| `SECRETS` | Base64-encoded JSON with protected credentials | Yes |
| `LLM_SECRETS` | Base64-encoded JSON with LLM-accessible credentials | No |
| `GH_WEBHOOK_SECRET` | Random secret for webhook authentication | Yes |

---

## GitHub Repository Variables

Configure in **Settings → Secrets and variables → Actions → Variables**:

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `GH_WEBHOOK_URL` | Event handler URL (e.g., your Tailscale Funnel URL) | Yes | — |
| `AUTO_MERGE` | Set to `false` to disable auto-merge of job PRs | No | Enabled |
| `ALLOWED_PATHS` | Comma-separated path prefixes for auto-merge | No | `/logs` |
| `IMAGE_URL` | Docker image path (e.g., `ghcr.io/myorg/mybot`) | No | `stephengpope/thepopebot:latest` |
| `MODEL` | Anthropic model ID for the Pi agent (e.g., `claude-sonnet-4-5-20250929`) | No | Pi default |

---

## Tailscale Setup

When using the GitHub Actions event handler workflow, Tailscale Funnel provides a stable HTTPS URL for webhooks:

1. **Create a Tailscale account** at https://tailscale.com
2. **Enable Funnel** in your tailnet settings at https://login.tailscale.com/admin/settings/general
3. **Create an OAuth client** at https://login.tailscale.com/admin/settings/oauth
   - Add the `devices:write` scope
   - Note the Client ID and Client Secret
4. **Set GitHub secrets**:
   - `TS_OAUTH_CLIENT_ID` - Your OAuth client ID
   - `TS_OAUTH_SECRET` - Your OAuth client secret
   - `GH_PAT` - GitHub PAT with `repo` and `workflow` scopes
   - `EVENT_HANDLER_ENV` - Base64-encoded .env file contents (see `event_handler/.env.example`)

The event handler workflow automatically updates `GH_WEBHOOK_URL` and runs continuously (auto-restarts every ~6 hours due to GitHub Actions job time limits).

---

## Manual Telegram Setup (Local Development)

If you're running the event handler locally for development, you can use Tailscale Serve or ngrok:

**With Tailscale Serve:**
```bash
# Terminal 1: Start the event handler
cd event_handler && npm start

# Terminal 2: Expose via Tailscale Serve
tailscale serve https / http://localhost:3000

# Get your Tailscale URL
tailscale status | grep "MagicDNS"
```

**With ngrok (for quick testing):**
```bash
# Terminal 1: Start the event handler
cd event_handler && npm start

# Terminal 2: Expose via ngrok
ngrok http 3000
```

Then run the Telegram setup script:
```bash
npm run setup-telegram
```

This will verify your server is running, update the GitHub webhook URL, re-register the Telegram webhook, and optionally capture your chat ID for security.

---

## Manual Telegram Setup (Production)

If you're deploying to a platform where you can't run the setup script (Vercel, Cloudflare Workers, etc.), configure Telegram manually:

1. **Set environment variables** in your platform's dashboard (see `event_handler/.env.example` for reference):
   - `TELEGRAM_BOT_TOKEN` - Your bot token from @BotFather
   - `TELEGRAM_WEBHOOK_SECRET` - Generate with `openssl rand -hex 32`
   - `TELEGRAM_VERIFICATION` - A verification code like `verify-abc12345`

2. **Deploy and register the webhook:**
   ```bash
   curl -X POST https://your-app.example.com/telegram/register \
     -H "Content-Type: application/json" \
     -H "x-api-key: YOUR_API_KEY" \
     -d '{"bot_token": "YOUR_BOT_TOKEN", "webhook_url": "https://your-app.example.com/telegram/webhook"}'
   ```
   This registers your webhook with the secret from your env.

3. **Get your chat ID:**
   - Message your bot with your `TELEGRAM_VERIFICATION` code (e.g., `verify-abc12345`)
   - The bot will reply with your chat ID

4. **Set `TELEGRAM_CHAT_ID`:**
   - Add the chat ID to your environment variables
   - Redeploy

Now your bot only responds to your authorized chat.

---

## Manual Telegram Setup (Production)

If you're deploying to a platform where you can't run the setup script (Vercel, Cloudflare Workers, etc.), configure Telegram manually:

1. **Set environment variables** in your platform's dashboard (see `event_handler/.env.example` for reference):
   - `TELEGRAM_BOT_TOKEN` - Your bot token from @BotFather
   - `TELEGRAM_WEBHOOK_SECRET` - Generate with `openssl rand -hex 32`
   - `TELEGRAM_VERIFICATION` - A verification code like `verify-abc12345`

2. **Deploy and register the webhook:**
   ```bash
   curl -X POST https://your-app.vercel.app/telegram/register \
     -H "Content-Type: application/json" \
     -H "x-api-key: YOUR_API_KEY" \
     -d '{"bot_token": "YOUR_BOT_TOKEN", "webhook_url": "https://your-app.vercel.app/telegram/webhook"}'
   ```
   This registers your webhook with the secret from your env.

3. **Get your chat ID:**
   - Message your bot with your `TELEGRAM_VERIFICATION` code (e.g., `verify-abc12345`)
   - The bot will reply with your chat ID

4. **Set `TELEGRAM_CHAT_ID`:**
   - Add the chat ID to your environment variables
   - Redeploy

Now your bot only responds to your authorized chat.
