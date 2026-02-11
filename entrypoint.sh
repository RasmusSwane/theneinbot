#!/bin/bash
set -e

# Extract job ID from branch name (job/uuid -> uuid), fallback to random UUID
if [[ "$BRANCH" == job/* ]]; then
    JOB_ID="${BRANCH#job/}"
else
    JOB_ID=$(cat /proc/sys/kernel/random/uuid)
fi
echo "Job ID: ${JOB_ID}"

# Start Chrome (using Puppeteer's chromium from pi-skills browser-tools)
CHROME_BIN=$(find /root/.cache/puppeteer -name "chrome" -type f | head -1)
$CHROME_BIN --headless --no-sandbox --disable-gpu --remote-debugging-port=9222 2>/dev/null &
CHROME_PID=$!
sleep 2

# Export SECRETS (base64 JSON) as flat env vars (GH_TOKEN, ANTHROPIC_API_KEY, etc.)
# These are filtered from LLM's bash subprocess by env-sanitizer extension
if [ -n "$SECRETS" ]; then
    SECRETS_JSON=$(echo "$SECRETS" | base64 -d)
    eval $(echo "$SECRETS_JSON" | jq -r 'to_entries | .[] | "export \(.key)=\"\(.value)\""')
    export SECRETS="$SECRETS_JSON"  # Keep decoded for extension to parse
else
    echo "WARNING: SECRETS env var is empty!"
fi

# Debug: check if GH_TOKEN is set
if [ -z "$GH_TOKEN" ]; then
    echo "ERROR: GH_TOKEN is empty after decoding SECRETS"
    exit 1
else
    echo "GH_TOKEN is set (length: ${#GH_TOKEN})"
fi

# Export LLM_SECRETS (base64 JSON) as flat env vars
# These are NOT filtered - LLM can access these (browser logins, skill API keys, etc.)
if [ -n "$LLM_SECRETS" ]; then
    LLM_SECRETS_JSON=$(echo "$LLM_SECRETS" | base64 -d)
    eval $(echo "$LLM_SECRETS_JSON" | jq -r 'to_entries | .[] | "export \(.key)=\"\(.value)\""')
fi

# Git setup - use GH_TOKEN directly for authentication
git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "https://github.com/"
GH_USER_JSON=$(gh api user -q '{name: .name, login: .login, email: .email, id: .id}')
GH_USER_NAME=$(echo "$GH_USER_JSON" | jq -r '.name // .login')
GH_USER_EMAIL=$(echo "$GH_USER_JSON" | jq -r '.email // "\(.id)+\(.login)@users.noreply.github.com"')
git config --global user.name "$GH_USER_NAME"
git config --global user.email "$GH_USER_EMAIL"

# Clone branch
if [ -n "$REPO_URL" ]; then
    echo "Cloning: $REPO_URL branch: $BRANCH"
    git clone --single-branch --branch "$BRANCH" --depth 1 "$REPO_URL" /job
else
    echo "No REPO_URL provided"
fi

cd /job

# Create temp directory for agent use (gitignored via tmp/)
mkdir -p /job/tmp

# Symlink pi-skills into .pi/skills/ so Pi discovers them
ln -sf /pi-skills/brave-search /job/.pi/skills/brave-search

# Setup logs
LOG_DIR="/job/logs/${JOB_ID}"
mkdir -p "${LOG_DIR}"

# 1. Build system prompt from operating_system MD files
SYSTEM_FILES=("SOUL.md" "AGENT.md")
> /job/.pi/SYSTEM.md
for i in "${!SYSTEM_FILES[@]}"; do
    cat "/job/operating_system/${SYSTEM_FILES[$i]}" >> /job/.pi/SYSTEM.md
    if [ "$i" -lt $((${#SYSTEM_FILES[@]} - 1)) ]; then
        echo -e "\n\n" >> /job/.pi/SYSTEM.md
    fi
done

PROMPT="

# Your Job

$(cat /job/logs/${JOB_ID}/job.md)"

MODEL_FLAGS=""
if [ -n "$MODEL" ]; then
    if [ -n "$NVIDIA_API_KEY" ]; then
        # NVIDIA NIM is OpenAI-compatible, use openrouter provider with NVIDIA credentials
        # Note: This assumes pi CLI supports custom base URLs via OPENROUTER_BASE_URL
        export OPENROUTER_API_KEY="$NVIDIA_API_KEY"
        export OPENROUTER_BASE_URL="https://integrate.api.nvidia.com/v1"
        MODEL_FLAGS="--provider openrouter --model $MODEL"
    elif [ -n "$OPENROUTER_API_KEY" ]; then
        MODEL_FLAGS="--provider openrouter --model $MODEL"
    else
        MODEL_FLAGS="--provider anthropic --model $MODEL"
    fi
fi

pi $MODEL_FLAGS -p "$PROMPT" --session-dir "${LOG_DIR}"

# 2. Commit changes + logs
git add -A
git add -f "${LOG_DIR}"
git commit -m "thepopebot: job ${JOB_ID}" || true
git push origin

# 3. Merge (pi has memory of job via session)
#if [ -n "$REPO_URL" ] && [ -f "/job/MERGE_JOB.md" ]; then
#    echo "MERGED"
#    pi -p "$(cat /job/MERGE_JOB.md)" --session-dir "${LOG_DIR}" --continue
#fi

# 5. Create PR (auto-merge handled by GitHub Actions workflow)
gh pr create --title "thepopebot: job ${JOB_ID}" --body "Automated job" --base main || true

# Cleanup
kill $CHROME_PID 2>/dev/null || true
echo "Done. Job ID: ${JOB_ID}"
