#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GUARDIAN_SCRIPT="${REPO_ROOT}/scripts/pr-guardian.sh"
TEST_REPO_ROOT="${REPO_ROOT}"

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
  REPO_ROOT="${TEST_REPO_ROOT}"
  SCHEMA_FILE="${REPO_ROOT}/scripts/pr-review-result.schema.json"
  CODE_REVIEW_FILE="${REPO_ROOT}/code_review.md"
  SPEC_REVIEW_FILE="${REPO_ROOT}/spec_review.md"
  REVIEW_ADDENDUM_FILE="${REPO_ROOT}/docs/dev/review/guardian-review-addendum.md"
  SPEC_REVIEW_SUMMARY_FILE="${REPO_ROOT}/docs/dev/review/guardian-spec-review-summary.md"
}

setup_mock_gh() {
  local mock_bin="${TEST_TMP_DIR}/bin"
  mkdir -p "${mock_bin}"

  cat > "${mock_bin}/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "$*" >> "${MOCK_GH_CALLS_LOG:?missing MOCK_GH_CALLS_LOG}"

pop_sequence_response_line() {
  local sequence_file="$1"
  local line
  line="$(sed -n '1p' "${sequence_file}")"
  tail -n +2 "${sequence_file}" > "${sequence_file}.next"
  mv "${sequence_file}.next" "${sequence_file}"
  printf '%s\n' "${line}"
}

if [[ "${1:-}" == "pr" && "${2:-}" == "checks" ]]; then
  checks_payload_file="${MOCK_GH_CHECKS_JSON:?missing MOCK_GH_CHECKS_JSON}"
  checks_exit_code="${MOCK_GH_CHECKS_EXIT_CODE:-0}"
  checks_stderr="${MOCK_GH_CHECKS_STDERR:-}"

  if [[ " $* " == *" --required "* ]]; then
    checks_payload_file="${MOCK_GH_REQUIRED_CHECKS_JSON:-${checks_payload_file}}"
    checks_exit_code="${MOCK_GH_REQUIRED_CHECKS_EXIT_CODE:-${checks_exit_code}}"
    checks_stderr="${MOCK_GH_REQUIRED_CHECKS_STDERR:-${checks_stderr}}"
  fi

  if [[ "${checks_exit_code}" != "0" ]]; then
    if [[ -n "${checks_stderr:-}" ]]; then
      printf '%s\n' "${checks_stderr}" >&2
    fi
    exit "${checks_exit_code}"
  fi

  cat "${checks_payload_file}"
  exit 0
fi

if [[ "${1:-}" == "pr" && "${2:-}" == "view" ]]; then
  if [[ -n "${MOCK_GH_PR_VIEW_SEQUENCE_FILE:-}" && -s "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}" ]]; then
    pop_sequence_response_line "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}"
  else
    cat "${MOCK_GH_PR_VIEW_JSON:?missing MOCK_GH_PR_VIEW_JSON}"
  fi
  exit 0
fi

if [[ "${1:-}" == "pr" && "${2:-}" == "review" ]]; then
  echo "$*" >> "${MOCK_GH_REVIEW_LOG:?missing MOCK_GH_REVIEW_LOG}"
  exit 0
fi

if [[ "${1:-}" == "pr" && "${2:-}" == "merge" ]]; then
  echo "$*" >> "${MOCK_GH_MERGE_LOG:?missing MOCK_GH_MERGE_LOG}"
  exit 0
fi

if [[ "${1:-}" == "issue" && "${2:-}" == "view" ]]; then
  issue_exit_code="${MOCK_GH_ISSUE_VIEW_EXIT_CODE:-0}"
  issue_stderr="${MOCK_GH_ISSUE_VIEW_STDERR:-}"
  if [[ "${issue_exit_code}" != "0" ]]; then
    if [[ -n "${issue_stderr:-}" ]]; then
      printf '%s\n' "${issue_stderr}" >&2
    fi
    exit "${issue_exit_code}"
  fi
  if [[ -n "${MOCK_GH_ISSUE_VIEW_SEQUENCE_FILE:-}" && -s "${MOCK_GH_ISSUE_VIEW_SEQUENCE_FILE}" ]]; then
    pop_sequence_response_line "${MOCK_GH_ISSUE_VIEW_SEQUENCE_FILE}"
    exit 0
  fi
  cat "${MOCK_GH_ISSUE_VIEW_JSON:?missing MOCK_GH_ISSUE_VIEW_JSON}"
  exit 0
fi

if [[ "${1:-}" == "api" ]]; then
  endpoint=""
  has_paginate=0
  for arg in "$@"; do
    if [[ "${arg}" == "--paginate" ]]; then
      has_paginate=1
    fi
    if [[ "${arg}" == "user" || "${arg}" == repos/:owner/:repo/pulls/*/reviews ]]; then
      endpoint="${arg}"
    fi
  done

  if [[ "${endpoint}" == "user" ]]; then
    if [[ " $* " == *" --jq "* ]]; then
      printf '%s\n' "${MOCK_GH_USER_LOGIN:?missing MOCK_GH_USER_LOGIN}"
    else
      printf '{"login":"%s"}\n' "${MOCK_GH_USER_LOGIN:?missing MOCK_GH_USER_LOGIN}"
    fi
    exit 0
  fi

  if [[ "${endpoint}" == repos/:owner/:repo/pulls/*/reviews ]]; then
    if [[ -n "${MOCK_GH_REVIEWS_SEQUENCE_FILE:-}" && -s "${MOCK_GH_REVIEWS_SEQUENCE_FILE}" ]]; then
      pop_sequence_response_line "${MOCK_GH_REVIEWS_SEQUENCE_FILE}"
      exit 0
    fi

    if [[ "${MOCK_GH_REVIEWS_REQUIRE_PAGINATE:-0}" == "1" && "${has_paginate}" != "1" ]]; then
      cat "${MOCK_GH_REVIEWS_FIRST_PAGE_JSON:?missing MOCK_GH_REVIEWS_FIRST_PAGE_JSON}"
    else
      cat "${MOCK_GH_REVIEWS_JSON:?missing MOCK_GH_REVIEWS_JSON}"
    fi
    exit 0
  fi

fi

echo "unexpected gh call: $*" >&2
exit 64
EOF

  chmod +x "${mock_bin}/gh"
  export PATH="${mock_bin}:${PATH}"
}

assert_pass() {
  if ! ( "$@" ); then
    echo "expected command to pass: $*" >&2
    exit 1
  fi
}

assert_fail() {
  if ( "$@" ); then
    echo "expected command to fail: $*" >&2
    exit 1
  fi
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "expected '${expected}', got '${actual}'" >&2
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

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq -- "${unexpected}" "${file}"; then
    echo "did not expect '${unexpected}' in ${file}" >&2
    exit 1
  fi
}

assert_file_empty() {
  local file="$1"
  if [[ -s "${file}" ]]; then
    echo "expected ${file} to be empty" >&2
    exit 1
  fi
}

setup_case_dir() {
  local case_name="$1"
  local case_dir="${TEST_TMP_DIR}/${case_name}"
  mkdir -p "${case_dir}"
  mkdir -p "${case_dir}/mock"
  setup_mock_gh
  setup_mock_codex

  TMP_DIR="${case_dir}/tmp"
  mkdir -p "${TMP_DIR}"
  export TMP_DIR

  MOCK_GH_CALLS_LOG="${case_dir}/gh.calls.log"
  MOCK_GH_MERGE_LOG="${case_dir}/gh.merge.log"
  MOCK_GH_REVIEW_LOG="${case_dir}/gh.review.log"
  : > "${MOCK_GH_CALLS_LOG}"
  : > "${MOCK_GH_MERGE_LOG}"
  : > "${MOCK_GH_REVIEW_LOG}"
  export MOCK_GH_CALLS_LOG
  export MOCK_GH_MERGE_LOG
  export MOCK_GH_REVIEW_LOG

  MOCK_CODEX_CALLS_LOG="${case_dir}/codex.calls.log"
  MOCK_CODEX_PROMPT_CAPTURE="${case_dir}/codex.prompt.log"
  : > "${MOCK_CODEX_CALLS_LOG}"
  : > "${MOCK_CODEX_PROMPT_CAPTURE}"
  export MOCK_CODEX_CALLS_LOG
  export MOCK_CODEX_PROMPT_CAPTURE
  unset CHANGED_FILES_FILE || true
  unset BASELINE_SNAPSHOT_ROOT || true

  MOCK_GH_REVIEWS_REQUIRE_PAGINATE=0
  unset MOCK_GH_REVIEWS_FIRST_PAGE_JSON || true
  unset MOCK_GH_PR_VIEW_SEQUENCE_FILE || true
  unset MOCK_GH_REVIEWS_SEQUENCE_FILE || true
  unset MOCK_GH_REQUIRED_CHECKS_JSON || true
  unset MOCK_GH_REQUIRED_CHECKS_EXIT_CODE || true
  unset MOCK_GH_REQUIRED_CHECKS_STDERR || true
  unset MOCK_GH_ISSUE_VIEW_EXIT_CODE || true
  unset MOCK_GH_ISSUE_VIEW_STDERR || true
  unset MOCK_CODEX_REVIEW_BASE_PROMPT_UNSUPPORTED || true
  unset MOCK_CODEX_FORCE_FAIL || true
  unset MOCK_CODEX_OUTPUT_SEQUENCE_FILE || true
  unset MOCK_CODEX_PROMPT_CAPTURE_DIR || true
  unset MOCK_CODEX_FAIL_CALL || true
  unset REUSED_REVIEWER_LOGIN || true
  unset WEBENVOY_GUARDIAN_TRUSTED_REVIEWERS || true
  export MOCK_GH_REVIEWS_REQUIRE_PAGINATE
}

setup_fake_repo_root() {
  local fake_repo_root="${TMP_DIR}/repo"

  mkdir -p "${fake_repo_root}/docs/dev/review"
  mkdir -p "${fake_repo_root}/docs/dev/architecture/system-design"
  mkdir -p "${fake_repo_root}/docs/dev/specs"
  mkdir -p "${fake_repo_root}/scripts"

  cp "${TEST_REPO_ROOT}/vision.md" "${fake_repo_root}/vision.md"
  cp "${TEST_REPO_ROOT}/AGENTS.md" "${fake_repo_root}/AGENTS.md"
  cp "${TEST_REPO_ROOT}/docs/dev/AGENTS.md" "${fake_repo_root}/docs/dev/AGENTS.md"
  cp "${TEST_REPO_ROOT}/docs/dev/roadmap.md" "${fake_repo_root}/docs/dev/roadmap.md"
  cp "${TEST_REPO_ROOT}/docs/dev/architecture/system-design.md" "${fake_repo_root}/docs/dev/architecture/system-design.md"
  cp "${TEST_REPO_ROOT}/docs/dev/review/guardian-review-addendum.md" "${fake_repo_root}/docs/dev/review/guardian-review-addendum.md"
  cp "${TEST_REPO_ROOT}/docs/dev/review/guardian-spec-review-summary.md" "${fake_repo_root}/docs/dev/review/guardian-spec-review-summary.md"
  cp "${TEST_REPO_ROOT}/code_review.md" "${fake_repo_root}/code_review.md"
  cp "${TEST_REPO_ROOT}/spec_review.md" "${fake_repo_root}/spec_review.md"
  cp "${TEST_REPO_ROOT}/scripts/pr-review-result.schema.json" "${fake_repo_root}/scripts/pr-review-result.schema.json"

  REPO_ROOT="${fake_repo_root}"
  unset WORKTREE_DIR || true
  unset BASELINE_SNAPSHOT_ROOT || true
  SCHEMA_FILE="${REPO_ROOT}/scripts/pr-review-result.schema.json"
  CODE_REVIEW_FILE="${REPO_ROOT}/code_review.md"
  SPEC_REVIEW_FILE="${REPO_ROOT}/spec_review.md"
  REVIEW_ADDENDUM_FILE="${REPO_ROOT}/docs/dev/review/guardian-review-addendum.md"
  SPEC_REVIEW_SUMMARY_FILE="${REPO_ROOT}/docs/dev/review/guardian-spec-review-summary.md"
  export REPO_ROOT SCHEMA_FILE CODE_REVIEW_FILE SPEC_REVIEW_FILE REVIEW_ADDENDUM_FILE SPEC_REVIEW_SUMMARY_FILE
}

restore_test_repo_root() {
  REPO_ROOT="${TEST_REPO_ROOT}"
  unset WORKTREE_DIR || true
  unset BASELINE_SNAPSHOT_ROOT || true
  SCHEMA_FILE="${REPO_ROOT}/scripts/pr-review-result.schema.json"
  CODE_REVIEW_FILE="${REPO_ROOT}/code_review.md"
  SPEC_REVIEW_FILE="${REPO_ROOT}/spec_review.md"
  REVIEW_ADDENDUM_FILE="${REPO_ROOT}/docs/dev/review/guardian-review-addendum.md"
  SPEC_REVIEW_SUMMARY_FILE="${REPO_ROOT}/docs/dev/review/guardian-spec-review-summary.md"
  export REPO_ROOT SCHEMA_FILE CODE_REVIEW_FILE SPEC_REVIEW_FILE REVIEW_ADDENDUM_FILE SPEC_REVIEW_SUMMARY_FILE
}

setup_mock_npm() {
  local mock_bin="${TEST_TMP_DIR}/bin"

  cat > "${mock_bin}/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "$*" >> "${MOCK_NPM_CALLS_LOG:?missing MOCK_NPM_CALLS_LOG}"

if [[ "${1:-}" == "ci" ]]; then
  has_ignore_scripts=0
  for arg in "$@"; do
    if [[ "${arg}" == "--ignore-scripts" ]]; then
      has_ignore_scripts=1
      break
    fi
  done
  if [[ "${has_ignore_scripts}" != "1" ]]; then
    echo "npm ci must include --ignore-scripts" >&2
    exit 65
  fi
  if [[ "${MOCK_NPM_FORCE_CI_FAIL:-0}" == "1" ]]; then
    echo "mock npm ci failure" >&2
    exit 66
  fi
  mkdir -p node_modules
  exit 0
fi

echo "unexpected npm call: $*" >&2
exit 64
EOF

  chmod +x "${mock_bin}/npm"
}

setup_mock_codex() {
  local mock_bin="${TEST_TMP_DIR}/bin"

  cat > "${mock_bin}/codex" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "$*" >> "${MOCK_CODEX_CALLS_LOG:?missing MOCK_CODEX_CALLS_LOG}"

if [[ "${1:-}" == "exec" ]]; then
  local_call_index="$(wc -l < "${MOCK_CODEX_CALLS_LOG}" | tr -d '[:space:]')"

  if [[ "${MOCK_CODEX_FORCE_FAIL:-0}" == "1" ]]; then
    echo "mock codex failure" >&2
    exit 70
  fi

  if [[ -n "${MOCK_CODEX_FAIL_CALL:-}" && "${MOCK_CODEX_FAIL_CALL}" == "${local_call_index}" ]]; then
    echo "mock codex failure on call ${local_call_index}" >&2
    exit 70
  fi

  if [[ "${MOCK_CODEX_REVIEW_BASE_PROMPT_UNSUPPORTED:-0}" == "1" && " $* " == *" review --base "* ]]; then
    echo "error: the argument '--base <BRANCH>' cannot be used with '[PROMPT]'" >&2
    exit 2
  fi

  prompt_file="${MOCK_CODEX_PROMPT_CAPTURE:-}"
  if [[ -n "${MOCK_CODEX_PROMPT_CAPTURE_DIR:-}" ]]; then
    mkdir -p "${MOCK_CODEX_PROMPT_CAPTURE_DIR}"
    prompt_file="${MOCK_CODEX_PROMPT_CAPTURE_DIR}/prompt.${local_call_index}.log"
  fi
  prompt_file="${prompt_file:?missing MOCK_CODEX_PROMPT_CAPTURE or MOCK_CODEX_PROMPT_CAPTURE_DIR}"
  output_file=""
  prompt_value=""
  saw_command=0
  shift

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -C|-c|-m|-o|--output-last-message|-p|--profile|-s|--color|--output-schema|--add-dir|--image|--local-provider)
        if [[ "$#" -lt 2 ]]; then
          echo "missing value for $1" >&2
          exit 64
        fi
        if [[ "$1" == "-o" || "$1" == "--output-last-message" ]]; then
          output_file="$2"
        fi
        shift 2
        ;;
      --full-auto|--dangerously-bypass-approvals-and-sandbox|--skip-git-repo-check|--ephemeral|--json|--oss)
        shift
        ;;
      review)
        saw_command=1
        shift
        ;;
      --base|--commit|--title|--enable|--disable)
        if [[ "$#" -lt 2 ]]; then
          echo "missing value for $1" >&2
          exit 64
        fi
        shift 2
        ;;
      --uncommitted)
        shift
        ;;
      *)
        if [[ -z "${prompt_value}" ]]; then
          prompt_value="$1"
        fi
        shift
        ;;
    esac
  done

  if [[ "${prompt_value}" == "-" ]]; then
    cat > "${prompt_file}"
  else
    printf '%s' "${prompt_value}" > "${prompt_file}"
  fi

  [[ -n "${output_file}" ]] || {
    echo "missing output file" >&2
    exit 64
  }

  result_file="${MOCK_CODEX_REVIEW_RESULT_JSON:-}"
  if [[ -n "${MOCK_CODEX_OUTPUT_SEQUENCE_FILE:-}" ]]; then
    result_file="$(sed -n "${local_call_index}p" "${MOCK_CODEX_OUTPUT_SEQUENCE_FILE}")"
  fi
  result_file="${result_file:?missing MOCK_CODEX_REVIEW_RESULT_JSON or MOCK_CODEX_OUTPUT_SEQUENCE_FILE}"

  cat "${result_file}" > "${output_file}"
  exit 0
fi

echo "unexpected codex call: $*" >&2
exit 64
EOF

  chmod +x "${mock_bin}/codex"
}
