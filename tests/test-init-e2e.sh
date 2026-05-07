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

# 默认在所有 e2e 用例里关掉自动启动；想测启动逻辑的用例显式 unset。
export SHIBEI_AUTO_START=n

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

test_falls_back_to_tty_when_stdin_closed() {
  # 模拟 `curl ... | bash` 的场景：stdin 是已关闭的管道（EOF），但用户的
  # 真实终端可读。这种情况下向导必须从 /dev/tty 读取答案，否则 read 全
  # 失败、所有提示走默认值——也就是用户报告的"我都没选脚本就跑完了"。
  local sandbox tty_fifo
  sandbox=$(setup_sandbox)
  tty_fifo=$(mktemp -u)
  mkfifo "$tty_fifo"

  # 在后台往 fifo 写预设答案（写完就关闭，模拟用户键入完毕）。
  # 注意：写端必须在读端开启之前或同时打开，否则会阻塞。这里用后台进程
  # 解决，主进程随后启动向导，二者通过 fifo 同步。
  ( printf '2\n\n\n\n3\nsk-tty-test\ny\n' > "$tty_fifo" ) &
  local writer_pid=$!

  # stdin 重定向到 /dev/null（模拟 curl 管道关闭）；SHIBEI_TTY_DEV 注入
  # fifo 充当 /dev/tty。
  SHIBEI_TTY_DEV="$tty_fifo" NO_COLOR=1 \
    bash "$sandbox/scripts/init.sh" </dev/null >/dev/null 2>&1

  wait "$writer_pid" 2>/dev/null || true
  rm -f "$tty_fifo"

  # 如果回退路径生效，会写出 backend 模式 + DeepSeek 模型；否则 stdin 全
  # EOF 会走 full + 跳过 AI（默认值），断言会失败。
  assert_grep "$sandbox/.env" '^APP_MODE="backend"$' "tty fallback should pick backend mode" || {
    rm -rf "$sandbox"; return 1; }
  assert_grep "$sandbox/.env" '^INIT_AI_PROVIDER="deepseek"$' "tty fallback should pick DeepSeek" || {
    rm -rf "$sandbox"; return 1; }
  assert_grep "$sandbox/.env" '^INIT_AI_API_KEY="sk-tty-test"$' "tty fallback should capture API key" || {
    rm -rf "$sandbox"; return 1; }

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

test_auto_start_invokes_docker_compose_with_correct_args() {
  # 用 stub docker 拦截调用，验证向导对每种模式拼出的 compose 参数都对。
  # 同时确认 SHIBEI_AUTO_START=y 时不需要交互——这是 curl|bash 流程的关键。
  local sandbox stub_dir
  sandbox=$(setup_sandbox)
  stub_dir=$(mktemp -d)
  cat > "$stub_dir/docker" <<STUB
#!/usr/bin/env bash
echo "PWD=\$PWD" >> "\$DOCKER_LOG"
echo "ARGS=\$*" >> "\$DOCKER_LOG"
exit 0
STUB
  chmod +x "$stub_dir/docker"

  local log="$sandbox/docker.log"
  PATH="$stub_dir:$PATH" DOCKER_LOG="$log" SHIBEI_AUTO_START=y \
    NO_COLOR=1 bash -c "printf '2\n\n\n\n3\nsk-x\ny\n' | bash '$sandbox/scripts/init.sh'" >/dev/null 2>&1

  if [ ! -f "$log" ]; then
    echo "    FAIL: docker stub never invoked (auto-start did not fire)"
    rm -rf "$sandbox" "$stub_dir"; return 1
  fi
  grep -F "PWD=$sandbox" "$log" >/dev/null || {
    echo "    FAIL: docker invoked from wrong dir (expected $sandbox)"; cat "$log"
    rm -rf "$sandbox" "$stub_dir"; return 1; }
  grep -F "ARGS=compose -f docker-compose.backend.yml up -d" "$log" >/dev/null || {
    echo "    FAIL: wrong compose args"; cat "$log"
    rm -rf "$sandbox" "$stub_dir"; return 1; }

  rm -rf "$sandbox" "$stub_dir"
}

test_auto_start_skipped_when_user_declines() {
  # SHIBEI_AUTO_START=n 时绝对不应触碰 docker。stub 是个"被调就 panic"的陷阱。
  local sandbox stub_dir
  sandbox=$(setup_sandbox)
  stub_dir=$(mktemp -d)
  cat > "$stub_dir/docker" <<'STUB'
#!/usr/bin/env bash
touch "$DOCKER_PANIC"
exit 1
STUB
  chmod +x "$stub_dir/docker"

  local panic="$sandbox/docker.panic"
  PATH="$stub_dir:$PATH" DOCKER_PANIC="$panic" SHIBEI_AUTO_START=n \
    NO_COLOR=1 bash -c "printf '1\n\n\n\ns\ny\n' | bash '$sandbox/scripts/init.sh'" >/dev/null 2>&1

  if [ -f "$panic" ]; then
    echo "    FAIL: docker invoked even though SHIBEI_AUTO_START=n"
    rm -rf "$sandbox" "$stub_dir"; return 1
  fi
  assert_grep "$sandbox/.env" '^APP_MODE="full"$' || { rm -rf "$sandbox" "$stub_dir"; return 1; }

  rm -rf "$sandbox" "$stub_dir"
}

test_auto_start_recovers_when_docker_missing() {
  # docker 不在 PATH 时，向导必须 warn 但不 crash，.env 仍要写好。
  local sandbox empty_path
  sandbox=$(setup_sandbox)
  empty_path=$(mktemp -d)
  PATH="$empty_path:/usr/bin:/bin" SHIBEI_AUTO_START=y \
    NO_COLOR=1 bash -c "printf '1\n\n\n\ns\ny\n' | bash '$sandbox/scripts/init.sh'" >/dev/null 2>&1
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "    FAIL: 缺 docker 时向导以非零退出 (rc=$rc)"
    rm -rf "$sandbox" "$empty_path"; return 1
  fi
  assert_grep "$sandbox/.env" '^APP_MODE="full"$' || { rm -rf "$sandbox" "$empty_path"; return 1; }
  rm -rf "$sandbox" "$empty_path"
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
