#!/usr/bin/env bash
# bash tests/test-init-e2e.sh
#
# End-to-end tests: drive scripts/init.sh with predefined stdin answers and
# assert the produced .env matches expectations. Covers each of the three
# deployment modes (full / backend / frontend), the AI-skip and AI-pick paths,
# and the .env-already-exists branch.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INIT_SH="$SCRIPT_DIR/../scripts/init.sh"

# .env.example 内容内联：向导只检查文件是否存在、不读内容（自己写整个 .env）。
ENV_EXAMPLE_FIXTURE='DATABASE_URL=""'

PASS=0
FAIL=0
FAILED=()

setup_sandbox() {
  local sandbox
  sandbox=$(mktemp -d)
  mkdir -p "$sandbox/scripts"
  cp "$INIT_SH" "$sandbox/scripts/init.sh"
  printf '%s\n' "$ENV_EXAMPLE_FIXTURE" > "$sandbox/.env.example"
  chmod +x "$sandbox/scripts/init.sh"
  echo "$sandbox"
}

assert_grep() {
  local file="$1" pattern="$2" msg="${3:-pattern not found in file}"
  if ! grep -E -- "$pattern" "$file" >/dev/null; then
    echo "    FAIL: $msg"
    echo "      pattern: $pattern"
    echo "      file:    $file"
    return 1
  fi
}

assert_no_grep() {
  local file="$1" pattern="$2" msg="${3:-pattern unexpectedly found}"
  if grep -E -- "$pattern" "$file" >/dev/null; then
    echo "    FAIL: $msg"
    echo "      pattern: $pattern"
    return 1
  fi
}

run_test() {
  local name="$1"
  if "$name"; then
    echo "  ✓ $name"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name"
    FAIL=$((FAIL+1))
    FAILED+=("$name")
  fi
}

# ---------- Tests ------------------------------------------------------------

test_full_mode_with_skip_ai() {
  local sandbox
  sandbox=$(setup_sandbox)

  # Inputs: 1=full, [enter site URL default], [enter user default], [enter password],
  # s=skip AI, y=confirm
  printf '1\n\n\n\ns\ny\n' | NO_COLOR=1 bash "$sandbox/scripts/init.sh" >/dev/null 2>&1

  local env="$sandbox/.env"
  [ -f "$env" ] || { echo "    FAIL: .env not created"; return 1; }
  assert_grep "$env" '^APP_MODE="full"$' || return 1
  assert_grep "$env" '^AUTH_SECRET="[a-f0-9]{64}"$' || return 1
  assert_grep "$env" '^ENCRYPTION_KEY="[a-f0-9]{64}"$' || return 1
  assert_grep "$env" '^ADMIN_USERNAME="admin"$' || return 1
  assert_grep "$env" '^ADMIN_PASSWORD="[A-Za-z0-9]{16}"$' || return 1
  assert_grep "$env" '^NEXT_PUBLIC_SITE_URL="http://[0-9.]+:3000"$' || return 1
  assert_no_grep "$env" '^INIT_AI_PROVIDER=' "AI block must not appear when user skipped" || return 1

  rm -rf "$sandbox"
}

test_backend_mode_with_deepseek() {
  local sandbox
  sandbox=$(setup_sandbox)

  # 2=backend, default URL, default user, default pwd, 3=DeepSeek, sk-test-key, y
  printf '2\n\n\n\n3\nsk-test-key\ny\n' | NO_COLOR=1 bash "$sandbox/scripts/init.sh" >/dev/null 2>&1

  local env="$sandbox/.env"
  assert_grep "$env" '^APP_MODE="backend"$' || return 1
  assert_grep "$env" '^SYNC_TOKEN="[a-f0-9]{64}"$' || return 1
  assert_grep "$env" '^INIT_AI_PROVIDER="deepseek"$' || return 1
  assert_grep "$env" '^INIT_AI_NAME="DeepSeek Chat"$' || return 1
  assert_grep "$env" '^INIT_AI_BASE_URL="https://api.deepseek.com/v1"$' || return 1
  assert_grep "$env" '^INIT_AI_MODEL="deepseek-chat"$' || return 1
  assert_grep "$env" '^INIT_AI_API_KEY="sk-test-key"$' || return 1

  rm -rf "$sandbox"
}

test_frontend_mode_with_sync_params() {
  local sandbox
  sandbox=$(setup_sandbox)

  # 3=frontend, custom URL, default user, default pwd, custom backend URL, default sync mode, default interval, y
  printf '3\nhttps://shibei.example.com\n\n\nhttps://api.example.com\n\n\ny\n' \
    | NO_COLOR=1 bash "$sandbox/scripts/init.sh" >/dev/null 2>&1

  local env="$sandbox/.env"
  assert_grep "$env" '^APP_MODE="frontend"$' || return 1
  assert_grep "$env" '^NEXT_PUBLIC_SITE_URL="https://shibei.example.com"$' || return 1
  assert_grep "$env" '^BACKEND_API_URL="https://api.example.com"$' || return 1
  assert_grep "$env" '^SYNC_MODE="auto"$' || return 1
  assert_grep "$env" '^SYNC_INTERVAL_MINUTES="15"$' || return 1
  # frontend mode does NOT prompt for AI model — that block must be absent.
  assert_no_grep "$env" '^INIT_AI_PROVIDER=' "frontend mode must not write AI block" || return 1

  rm -rf "$sandbox"
}

test_each_ai_provider_choice() {
  # Verify all 7 numbered presets land the right (provider, name, baseUrl, model)
  # tuple. We pipe the choice number followed by sk-x for the API key and y to confirm.
  local cases=(
    "1|canopywave|CanopyWave Kimi|https://inference.canopywave.io/v1|moonshotai/kimi-k2.6"
    "2|openai|OpenAI GPT-4o mini|https://api.openai.com/v1|gpt-4o-mini"
    "3|deepseek|DeepSeek Chat|https://api.deepseek.com/v1|deepseek-chat"
    "4|moonshot|Moonshot 32k|https://api.moonshot.cn/v1|moonshot-v1-32k"
    "5|qwen|通义千问 Plus|https://dashscope.aliyuncs.com/compatible-mode/v1|qwen-plus"
    "6|siliconflow|SiliconFlow DSv3|https://api.siliconflow.cn/v1|deepseek-ai/DeepSeek-V3"
    "7|openrouter|OpenRouter|https://openrouter.ai/api/v1|openai/gpt-4o-mini"
  )
  local row choice provider name base model
  for row in "${cases[@]}"; do
    IFS='|' read -r choice provider name base model <<<"$row"
    local sandbox
    sandbox=$(setup_sandbox)
    printf '1\n\n\n\n%s\nsk-x\ny\n' "$choice" \
      | NO_COLOR=1 bash "$sandbox/scripts/init.sh" >/dev/null 2>&1
    local env="$sandbox/.env"
    # Use fixed-string grep (-F) so URLs with `/` etc. don't need escaping.
    grep -F -- "INIT_AI_PROVIDER=\"$provider\"" "$env" >/dev/null || {
      echo "    FAIL: choice=$choice expected provider=$provider"; rm -rf "$sandbox"; return 1; }
    grep -F -- "INIT_AI_NAME=\"$name\"" "$env" >/dev/null || {
      echo "    FAIL: choice=$choice expected name=$name"; rm -rf "$sandbox"; return 1; }
    grep -F -- "INIT_AI_BASE_URL=\"$base\"" "$env" >/dev/null || {
      echo "    FAIL: choice=$choice expected baseUrl=$base"; rm -rf "$sandbox"; return 1; }
    grep -F -- "INIT_AI_MODEL=\"$model\"" "$env" >/dev/null || {
      echo "    FAIL: choice=$choice expected model=$model"; rm -rf "$sandbox"; return 1; }
    rm -rf "$sandbox"
  done
}

test_existing_env_is_backed_up_when_overwriting() {
  local sandbox
  sandbox=$(setup_sandbox)
  printf 'OLD_CONTENT=1\n' > "$sandbox/.env"

  # y=overwrite, then default-everything full + skip AI
  printf 'y\n1\n\n\n\ns\ny\n' | NO_COLOR=1 bash "$sandbox/scripts/init.sh" >/dev/null 2>&1

  # New .env must have replaced the old one
  assert_grep "$sandbox/.env" '^APP_MODE="full"$' || return 1
  # Old contents must be in a backup file
  local backups
  backups=$(find "$sandbox" -maxdepth 1 -name '.env.bak.*' | wc -l)
  if [ "$backups" -lt 1 ]; then
    echo "    FAIL: expected .env.bak.* file, found $backups"
    return 1
  fi
  # Backup must contain the original content
  assert_grep "$(find "$sandbox" -maxdepth 1 -name '.env.bak.*' | head -1)" '^OLD_CONTENT=1$' || return 1

  rm -rf "$sandbox"
}

test_existing_env_is_preserved_on_decline() {
  local sandbox
  sandbox=$(setup_sandbox)
  printf 'KEEP_ME=true\n' > "$sandbox/.env"

  # n=do not overwrite — wizard should bail without writing
  printf 'n\n' | NO_COLOR=1 bash "$sandbox/scripts/init.sh" >/dev/null 2>&1

  # The original file is unchanged and no backup was created.
  assert_grep "$sandbox/.env" '^KEEP_ME=true$' || return 1
  local backups
  backups=$(find "$sandbox" -maxdepth 1 -name '.env.bak.*' | wc -l)
  if [ "$backups" -ne 0 ]; then
    echo "    FAIL: declining overwrite should not create a backup"
    return 1
  fi

  rm -rf "$sandbox"
}

test_explicit_password_is_used_verbatim() {
  local sandbox
  sandbox=$(setup_sandbox)
  printf '1\n\nadmin\nMyStr0ngP@ss!\ns\ny\n' | NO_COLOR=1 bash "$sandbox/scripts/init.sh" >/dev/null 2>&1
  # The user-supplied password must appear verbatim. We don't validate special
  # chars beyond what would break .env quoting (the script doesn't sanitize).
  grep -F -- 'ADMIN_PASSWORD="MyStr0ngP@ss!"' "$sandbox/.env" >/dev/null || {
    echo "    FAIL: explicit password not written"; cat "$sandbox/.env"; rm -rf "$sandbox"; return 1; }
  rm -rf "$sandbox"
}

test_unknown_mode_choice_falls_back_to_full() {
  local sandbox
  sandbox=$(setup_sandbox)
  # 9 is not a valid mode; script should warn and fall back to full.
  printf '9\n\n\n\ns\ny\n' | NO_COLOR=1 bash "$sandbox/scripts/init.sh" >/dev/null 2>&1
  assert_grep "$sandbox/.env" '^APP_MODE="full"$' || return 1
  rm -rf "$sandbox"
}

test_keys_differ_between_runs() {
  # Sanity: two independent runs must produce different AUTH_SECRET / ENCRYPTION_KEY.
  local s1 s2
  s1=$(setup_sandbox)
  s2=$(setup_sandbox)
  printf '1\n\n\n\ns\ny\n' | NO_COLOR=1 bash "$s1/scripts/init.sh" >/dev/null 2>&1
  printf '1\n\n\n\ns\ny\n' | NO_COLOR=1 bash "$s2/scripts/init.sh" >/dev/null 2>&1
  local k1 k2
  k1=$(grep '^AUTH_SECRET=' "$s1/.env")
  k2=$(grep '^AUTH_SECRET=' "$s2/.env")
  if [ "$k1" = "$k2" ]; then
    echo "    FAIL: AUTH_SECRET identical across runs"
    return 1
  fi
  rm -rf "$s1" "$s2"
}

# ---------- runner -----------------------------------------------------------
echo
echo "Running end-to-end tests for scripts/init.sh"
echo "=============================================="

for fn in $(compgen -A function | grep '^test_' | sort); do
  run_test "$fn"
done

echo
echo "Pass: $PASS   Fail: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "Failed: ${FAILED[*]}"
  exit 1
fi
