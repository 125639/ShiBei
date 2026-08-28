#!/usr/bin/env bash
# bash tests/test-init.sh
#
# Unit tests for pure helpers in scripts/init.sh. We `source` the script with
# the BASH_SOURCE guard preventing the wizard from running, so only function
# definitions land in the test shell.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NO_COLOR=1 source "$SCRIPT_DIR/../scripts/init.sh"

# ---------- minimal test framework -------------------------------------------
PASS=0
FAIL=0
FAILED_NAMES=()

assert_eq() {
  local actual="$1" expected="$2" msg="${3:-values differ}"
  if [ "$actual" != "$expected" ]; then
    echo "    FAIL: $msg"
    echo "      expected: $expected"
    echo "      actual:   $actual"
    return 1
  fi
}

assert_match() {
  local value="$1" pattern="$2" msg="${3:-value does not match pattern}"
  if ! [[ "$value" =~ $pattern ]]; then
    echo "    FAIL: $msg"
    echo "      pattern: $pattern"
    echo "      value:   $value"
    return 1
  fi
}

assert_len() {
  local value="$1" expected_len="$2" msg="${3:-length mismatch}"
  if [ "${#value}" -ne "$expected_len" ]; then
    echo "    FAIL: $msg"
    echo "      expected length: $expected_len"
    echo "      actual length:   ${#value} (value: $value)"
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
    FAILED_NAMES+=("$name")
  fi
}

# ---------- rand_hex ---------------------------------------------------------
test_rand_hex_default_64_chars() {
  local out
  out=$(rand_hex 32)
  assert_len "$out" 64 "rand_hex 32 should produce 64 hex chars" || return 1
  assert_match "$out" '^[0-9a-f]+$' "rand_hex output must be lowercase hex" || return 1
}

test_rand_hex_8_bytes_16_chars() {
  local out
  out=$(rand_hex 8)
  assert_len "$out" 16 "rand_hex 8 should produce 16 chars" || return 1
}

test_rand_hex_uniqueness() {
  # Two consecutive calls must not collide. Probability of collision in 64
  # hex chars from /dev/urandom is effectively zero; if it ever does, run
  # the test again — that's a more useful diagnostic than a re-roll loop.
  local a b
  a=$(rand_hex 32)
  b=$(rand_hex 32)
  if [ "$a" = "$b" ]; then
    echo "    FAIL: rand_hex returned same value twice in a row"
    return 1
  fi
}

# ---------- rand_password ----------------------------------------------------
test_rand_password_length_16() {
  local out
  out=$(rand_password)
  assert_len "$out" 16 "rand_password should produce 16 chars" || return 1
}

test_rand_password_alphanumeric_only() {
  local out
  out=$(rand_password)
  assert_match "$out" '^[A-Za-z0-9]+$' "rand_password must only contain alphanumerics (no shell-special chars)" || return 1
}

test_rand_password_uniqueness() {
  local a b
  a=$(rand_password)
  b=$(rand_password)
  if [ "$a" = "$b" ]; then
    echo "    FAIL: rand_password returned same value twice"
    return 1
  fi
}

# ---------- escape_dq --------------------------------------------------------
test_escape_dq_passes_through_plain_string() {
  local out
  out=$(escape_dq "hello world")
  assert_eq "$out" "hello world" "plain string must be returned unchanged" || return 1
}

test_escape_dq_escapes_double_quotes() {
  local out
  out=$(escape_dq 'value with "quotes"')
  assert_eq "$out" 'value with \"quotes\"' "double quotes must be backslash-escaped" || return 1
}

test_escape_dq_handles_multiple_quotes() {
  local out
  out=$(escape_dq '"a"b"c"')
  assert_eq "$out" '\"a\"b\"c\"' "all double quotes must be escaped" || return 1
}

test_escape_dq_leaves_backslashes_alone() {
  # Single-quote literal: \n is two chars, NOT a newline. We don't escape
  # backslashes in this helper because the .env values we write don't include
  # them in practice (URLs, hex, alphanumerics).
  local out
  out=$(escape_dq 'path\to\thing')
  assert_eq "$out" 'path\to\thing' "backslashes must not be touched" || return 1
}

test_escape_dq_handles_empty_string() {
  local out
  out=$(escape_dq "")
  assert_eq "$out" "" "empty input must produce empty output" || return 1
}

# ---------- detect_ip --------------------------------------------------------
test_detect_ip_returns_nonempty() {
  local ip
  ip=$(detect_ip)
  if [ -z "$ip" ]; then
    echo "    FAIL: detect_ip returned empty string"
    return 1
  fi
}

test_detect_ip_returns_valid_ipv4_or_fallback() {
  # detect_ip falls back to 127.0.0.1 when no other tool is available.
  # We accept any dotted-quad with values 0-255 (loose, since we trust the
  # underlying `ip route` / `hostname -I` to produce valid output).
  local ip
  ip=$(detect_ip)
  assert_match "$ip" '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' \
    "detect_ip must return a dotted-quad IPv4 address" || return 1
}

# ---------- detect_os --------------------------------------------------------
test_detect_os_returns_known_value() {
  local os
  os=$(detect_os)
  case "$os" in
    macos|linux|unknown) ;;
    *) echo "    FAIL: detect_os returned unexpected value: $os"; return 1 ;;
  esac
}

# ---------- is_public_url ----------------------------------------------------
test_public_url_accepts_http_ip_with_port() {
  is_public_url "http://192.0.2.10:3000" || {
    echo "    FAIL: direct HTTP origin should be accepted"
    return 1
  }
}

test_public_url_accepts_external_https_origin() {
  is_public_url "https://blog.example.com" || {
    echo "    FAIL: reverse-proxied HTTPS origin should be accepted"
    return 1
  }
}

test_public_url_rejects_paths_credentials_and_invalid_ports() {
  local value
  for value in \
    "https://blog.example.com/path" \
    "https://user:pass@blog.example.com" \
    "https://blog.example.com:0" \
    "https://blog.example.com:65536"; do
    if is_public_url "$value"; then
      echo "    FAIL: invalid public URL accepted: $value"
      return 1
    fi
  done
}

# ---------- is_secure_backend_url -------------------------------------------
test_backend_url_accepts_https_and_private_http() {
  local value
  for value in \
    "https://api.example.com" \
    "http://127.0.0.1:3300" \
    "http://10.0.0.8:3000" \
    "http://100.64.1.2:3000" \
    "http://172.31.0.8:3000" \
    "http://192.168.1.8:3000" \
    "http://[fd7a:115c:a1e0::1]:3000" \
    "http://app:3000"; do
    is_secure_backend_url "$value" || {
      echo "    FAIL: safe backend URL rejected: $value"
      return 1
    }
  done
}

test_backend_url_rejects_plaintext_public_and_non_origin_values() {
  local value
  for value in \
    "http://backend.example.com:3000" \
    "http://8.8.8.8:3000" \
    "https://user:pass@api.example.com" \
    "https://api.example.com/base"; do
    if is_secure_backend_url "$value"; then
      echo "    FAIL: unsafe backend URL accepted: $value"
      return 1
    fi
  done
}

# ---------- runner -----------------------------------------------------------
echo
echo "Running bash unit tests for scripts/init.sh"
echo "============================================"

# Discover tests: every shell function whose name starts with `test_`.
for fn in $(compgen -A function | grep '^test_' | sort); do
  run_test "$fn"
done

echo
echo "Pass: $PASS   Fail: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "Failed: ${FAILED_NAMES[*]}"
  exit 1
fi
