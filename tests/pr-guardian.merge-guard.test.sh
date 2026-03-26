#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GUARDIAN_SCRIPT="${REPO_ROOT}/scripts/pr-guardian.sh"

TEST_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pr-guardian-merge-guard.test.XXXXXX")"
cleanup_test_tmp() {
  rm -rf "${TEST_TMP_DIR}"
}
trap cleanup_test_tmp EXIT

load_guardian_without_main() {
  local bootstrap_file="${TEST_TMP_DIR}/pr-guardian-lib.sh"
  awk '
    $0 == "main \"$@\"" { exit }
    { print }
  ' "${GUARDIAN_SCRIPT}" > "${bootstrap_file}"
  # shellcheck source=/dev/null
  source "${bootstrap_file}"
}

setup_mock_gh() {
  local mock_bin="${TEST_TMP_DIR}/bin"
  mkdir -p "${mock_bin}"

  cat > "${mock_bin}/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "pr" && "${2:-}" == "checks" ]]; then
  cat "${MOCK_GH_CHECKS_JSON:?missing MOCK_GH_CHECKS_JSON}"
  exit 0
fi

echo "unexpected gh call: $*" >&2
exit 64
EOF

  chmod +x "${mock_bin}/gh"
  export PATH="${mock_bin}:${PATH}"
}

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

run_all_checks_pass_with_payload() {
  local payload="$1"
  TMP_DIR="${TEST_TMP_DIR}/case-tmp"
  mkdir -p "${TMP_DIR}"

  MOCK_GH_CHECKS_JSON="${TMP_DIR}/mock-gh-checks.json"
  export MOCK_GH_CHECKS_JSON
  printf '%s\n' "${payload}" > "${MOCK_GH_CHECKS_JSON}"

  all_required_checks_pass 123 >/dev/null 2>&1
}

main() {
  setup_mock_gh
  load_guardian_without_main

  assert_pass run_all_checks_pass_with_payload '[{"name":"review-completed","bucket":"pass","state":"SUCCESS","link":"https://example.test/review"},{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]'
  assert_fail run_all_checks_pass_with_payload '[{"name":"review-completed","bucket":"fail","state":"FAILURE","link":"https://example.test/review"},{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]'
  assert_fail run_all_checks_pass_with_payload '[{"name":"review-completed","bucket":"pass","state":"SUCCESS","link":"https://example.test/review"},{"name":"Run Tests","bucket":"fail","state":"FAILURE","link":"https://example.test/tests"}]'

  echo "pr-guardian merge-guard semantics test passed."
}

main "$@"
