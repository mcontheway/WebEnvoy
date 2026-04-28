#!/usr/bin/env bash

set -euo pipefail

TEST_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${TEST_SCRIPT_DIR}/.." && pwd)"
OPEN_PR_SCRIPT="${REPO_ROOT}/scripts/open-pr.sh"

TEST_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/open-pr.test.XXXXXX")"
cleanup_test_tmp() {
  rm -rf "${TEST_TMP_DIR}"
}
trap cleanup_test_tmp EXIT

assert_pass() {
  if ! "$@"; then
    echo "expected command to pass: $*" >&2
    exit 1
  fi
}

assert_fail() {
  if "$@"; then
    echo "expected command to fail: $*" >&2
    exit 1
  fi
}

assert_file_contains() {
  local file="$1"
  local expected="$2"
  if ! grep -Fq -- "${expected}" "${file}"; then
    echo "expected '${expected}' in ${file}" >&2
    exit 1
  fi
}

setup_case_dir() {
  local case_name="$1"
  local case_dir="${TEST_TMP_DIR}/${case_name}"
  local mock_bin="${case_dir}/bin"

  mkdir -p "${case_dir}" "${mock_bin}"
  MOCK_GH_CALLS_LOG="${case_dir}/gh.calls.log"
  MOCK_PR_PAYLOAD_FILE="${case_dir}/pr-payload.json"
  MOCK_REMOTE_BRANCH_EXISTS="${MOCK_REMOTE_BRANCH_EXISTS:-1}"
  MOCK_LOCAL_HEAD_SHA="${MOCK_LOCAL_HEAD_SHA:-local-head-sha}"
  MOCK_REMOTE_HEAD_SHA="${MOCK_REMOTE_HEAD_SHA:-local-head-sha}"
  MOCK_REMOTE_URL="${MOCK_REMOTE_URL:-git@github.com:MC-and-his-Agents/WebEnvoy.git}"
  GITHUB_REPOSITORY="MC-and-his-Agents/WebEnvoy"
  : > "${MOCK_GH_CALLS_LOG}"
  export MOCK_GH_CALLS_LOG MOCK_PR_PAYLOAD_FILE MOCK_REMOTE_BRANCH_EXISTS MOCK_LOCAL_HEAD_SHA MOCK_REMOTE_HEAD_SHA MOCK_REMOTE_URL GITHUB_REPOSITORY

  cat > "${mock_bin}/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-C" ]]; then
  shift 2
fi

case "${1:-}" in
  rev-parse)
    if [[ "${2:-}" == "--abbrev-ref" ]]; then
      printf '%s\n' "fix/574-rest-first-github-automation"
      exit 0
    fi
    if [[ "${2:-}" == "HEAD" ]]; then
      printf '%s\n' "${MOCK_LOCAL_HEAD_SHA}"
      exit 0
    fi
    ;;
  log)
    printf '%s\n' "fix: REST-first GitHub automation"
    exit 0
    ;;
  fetch)
    exit 0
    ;;
  diff)
    printf '%s\n' "scripts/open-pr.sh"
    exit 0
    ;;
  ls-remote)
    if [[ "${MOCK_REMOTE_BRANCH_EXISTS:-1}" == "1" ]]; then
      printf '%s\trefs/heads/fix/574-rest-first-github-automation\n' "${MOCK_REMOTE_HEAD_SHA}"
      exit 0
    fi
    exit 2
    ;;
  remote)
    printf '%s\n' "${MOCK_REMOTE_URL}"
    exit 0
    ;;
esac

echo "unexpected git call: $*" >&2
exit 64
EOF

  cat > "${mock_bin}/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "$*" >> "${MOCK_GH_CALLS_LOG:?missing MOCK_GH_CALLS_LOG}"

if [[ "${1:-}" == "api" ]]; then
  endpoint=""
  method="GET"
  input_file=""
  next_is_method=0
  next_is_input=0
  for arg in "$@"; do
    if [[ "${arg}" == "--method" ]]; then
      next_is_method=1
      continue
    fi
    if [[ "${next_is_method}" == "1" ]]; then
      method="${arg}"
      next_is_method=0
      continue
    fi
    if [[ "${arg}" == "--input" ]]; then
      next_is_input=1
      continue
    fi
    if [[ "${next_is_input}" == "1" ]]; then
      input_file="${arg}"
      next_is_input=0
      continue
    fi
    if [[ "${arg}" == "user" || "${arg}" == repos/* ]]; then
      endpoint="${arg}"
    fi
  done

  if [[ "${endpoint}" == "user" ]]; then
    printf '%s\n' "tester"
    exit 0
  fi

  if [[ "${endpoint}" == "repos/MC-and-his-Agents/WebEnvoy/pulls" && "${method}" == "POST" ]]; then
    cp "${input_file}" "${MOCK_PR_PAYLOAD_FILE:?missing MOCK_PR_PAYLOAD_FILE}"
    printf '%s\n' '{"html_url":"https://github.com/MC-and-his-Agents/WebEnvoy/pull/574"}'
    exit 0
  fi
fi

echo "unexpected gh call: $*" >&2
exit 64
EOF

  cat > "${case_dir}/purity.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF

  chmod +x "${mock_bin}/git" "${mock_bin}/gh" "${case_dir}/purity.sh"
  PATH="${mock_bin}:${PATH}"
  export PATH
}

load_open_pr_without_main() {
  local bootstrap_file="${TEST_TMP_DIR}/open-pr-lib.sh"
  awk '
    $0 == "main \"$@\"" { exit }
    { print }
  ' "${OPEN_PR_SCRIPT}" > "${bootstrap_file}"
  # shellcheck source=/dev/null
  source "${bootstrap_file}"
  REPO_ROOT="$(cd "${TEST_SCRIPT_DIR}/.." && pwd)"
  DEFAULT_TEMPLATE="${REPO_ROOT}/.github/PULL_REQUEST_TEMPLATE.md"
}

test_open_pr_uses_rest_create_payload() {
  setup_case_dir "rest-create"
  load_open_pr_without_main
  PURITY_GUARD="${TEST_TMP_DIR}/rest-create/purity.sh"
  export PURITY_GUARD

  local output_file="${TEST_TMP_DIR}/rest-create/out.txt"
  assert_pass main --issue 574 --closing fixes > "${output_file}"

  assert_file_contains "${output_file}" "https://github.com/MC-and-his-Agents/WebEnvoy/pull/574"
  assert_file_contains "${MOCK_GH_CALLS_LOG}" "repos/MC-and-his-Agents/WebEnvoy/pulls"
  [[ "$(jq -r '.head' "${MOCK_PR_PAYLOAD_FILE}")" == "fix/574-rest-first-github-automation" ]]
  [[ "$(jq -r '.base' "${MOCK_PR_PAYLOAD_FILE}")" == "main" ]]
  [[ "$(jq -r '.draft' "${MOCK_PR_PAYLOAD_FILE}")" == "false" ]]
}

test_open_pr_fails_when_remote_branch_missing() {
  MOCK_REMOTE_BRANCH_EXISTS=0
  export MOCK_REMOTE_BRANCH_EXISTS
  setup_case_dir "missing-remote-branch"
  load_open_pr_without_main
  PURITY_GUARD="${TEST_TMP_DIR}/missing-remote-branch/purity.sh"
  export PURITY_GUARD

  if ( ensure_remote_branch_exists "fix/574-rest-first-github-automation" ) >/dev/null 2>&1; then
    echo "expected missing remote branch to fail" >&2
    exit 1
  fi
}

test_open_pr_fails_when_remote_branch_is_not_current_head() {
  MOCK_REMOTE_BRANCH_EXISTS=1
  MOCK_LOCAL_HEAD_SHA="local-head-sha"
  MOCK_REMOTE_HEAD_SHA="stale-remote-sha"
  export MOCK_REMOTE_BRANCH_EXISTS MOCK_LOCAL_HEAD_SHA MOCK_REMOTE_HEAD_SHA
  setup_case_dir "stale-remote-branch"
  load_open_pr_without_main
  PURITY_GUARD="${TEST_TMP_DIR}/stale-remote-branch/purity.sh"
  export PURITY_GUARD

  if ( ensure_remote_branch_exists "fix/574-rest-first-github-automation" ) >/dev/null 2>&1; then
    echo "expected stale remote branch to fail" >&2
    exit 1
  fi
}

test_repository_slug_parses_origin_without_env_override() {
  MOCK_REMOTE_URL="https://github.com/MC-and-his-Agents/WebEnvoy.git"
  export MOCK_REMOTE_URL
  setup_case_dir "repository-slug-origin"
  load_open_pr_without_main
  unset GITHUB_REPOSITORY || true

  local actual
  actual="$(repository_slug)"
  if [[ "${actual}" != "MC-and-his-Agents/WebEnvoy" ]]; then
    echo "expected repository_slug to parse HTTPS origin, got '${actual}'" >&2
    exit 1
  fi
}

main() {
  test_open_pr_uses_rest_create_payload
  test_open_pr_fails_when_remote_branch_missing
  test_open_pr_fails_when_remote_branch_is_not_current_head
  test_repository_slug_parses_origin_without_env_override
  echo "open-pr REST test passed."
}

main "$@"
