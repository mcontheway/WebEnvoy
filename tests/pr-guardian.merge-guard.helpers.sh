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
  review_state="COMMENTED"
  body_file=""
  body=""
  pr_number="${3:-}"
  shift 3

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --approve)
        review_state="APPROVED"
        ;;
      --request-changes)
        review_state="CHANGES_REQUESTED"
        ;;
      --comment)
        review_state="COMMENTED"
        ;;
      --body-file)
        shift
        body_file="${1:-}"
        ;;
      --body)
        shift
        body="${1:-}"
        ;;
    esac
    shift || true
  done

  if [[ -n "${body_file}" ]]; then
    body="$(cat "${body_file}")"
  fi

  if [[ -n "${MOCK_GH_POSTED_REVIEWS_JSON:-}" ]]; then
    next_review_id="$(cat "${MOCK_GH_NEXT_REVIEW_ID_FILE:?missing MOCK_GH_NEXT_REVIEW_ID_FILE}")"
    printf '%s\n' "$((next_review_id + 1))" > "${MOCK_GH_NEXT_REVIEW_ID_FILE}"

    tmp_reviews_file="${MOCK_GH_POSTED_REVIEWS_JSON}.tmp"
    jq \
      --argjson review_id "${next_review_id}" \
      --arg reviewer "${MOCK_GH_USER_LOGIN:?missing MOCK_GH_USER_LOGIN}" \
      --arg commit_id "${HEAD_SHA:-}" \
      --arg review_state "${review_state}" \
      --arg submitted_at "${MOCK_GH_REVIEW_SUBMITTED_AT:-2026-04-07T10:10:00Z}" \
      --arg body "${body}" \
      '
        .[0] += [
          {
            id: $review_id,
            user: { login: $reviewer },
            commit_id: $commit_id,
            state: $review_state,
            submitted_at: $submitted_at,
            body: $body
          }
        ]
      ' "${MOCK_GH_POSTED_REVIEWS_JSON}" > "${tmp_reviews_file}"
    mv "${tmp_reviews_file}" "${MOCK_GH_POSTED_REVIEWS_JSON}"
  fi
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

if [[ "${1:-}" == "repo" && "${2:-}" == "view" ]]; then
  if [[ " $* " == *" --json nameWithOwner "* ]]; then
    if [[ " $* " == *" --jq "* ]]; then
      printf '%s\n' "${MOCK_REPO_SLUG:-mcontheway/WebEnvoy}"
    else
      printf '{"nameWithOwner":"%s"}\n' "${MOCK_REPO_SLUG:-mcontheway/WebEnvoy}"
    fi
  elif [[ " $* " == *" --jq "* ]]; then
    printf '%s\n' "${MOCK_GH_REPO_OWNER_LOGIN:-mcontheway}"
  else
    printf '{"owner":{"login":"%s"}}\n' "${MOCK_GH_REPO_OWNER_LOGIN:-mcontheway}"
  fi
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
      jq -nc \
        --slurpfile base "${MOCK_GH_REVIEWS_JSON:?missing MOCK_GH_REVIEWS_JSON}" \
        --slurpfile posted "${MOCK_GH_POSTED_REVIEWS_JSON:?missing MOCK_GH_POSTED_REVIEWS_JSON}" \
        '
          ($base[0] // [[]]) as $base_pages
          | ($posted[0][0] // []) as $posted_reviews
          | if ($posted_reviews | length) == 0 then
              $base_pages
            elif ($base_pages | length) == 0 then
              [$posted_reviews]
            else
              [($base_pages[0] + $posted_reviews)] + ($base_pages[1:] // [])
            end
        '
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
  MOCK_GH_POSTED_REVIEWS_JSON="${case_dir}/mock/posted-reviews.json"
  MOCK_GH_NEXT_REVIEW_ID_FILE="${case_dir}/mock/next-review-id.txt"
  : > "${MOCK_GH_CALLS_LOG}"
  : > "${MOCK_GH_MERGE_LOG}"
  : > "${MOCK_GH_REVIEW_LOG}"
  printf '%s\n' '[[]]' > "${MOCK_GH_POSTED_REVIEWS_JSON}"
  printf '%s\n' '1000' > "${MOCK_GH_NEXT_REVIEW_ID_FILE}"
  export MOCK_GH_CALLS_LOG
  export MOCK_GH_MERGE_LOG
  export MOCK_GH_REVIEW_LOG
  export MOCK_GH_POSTED_REVIEWS_JSON
  export MOCK_GH_NEXT_REVIEW_ID_FILE

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
  unset PR_GUARDIAN_PROOF_VISIBILITY_MAX_ATTEMPTS || true
  unset PR_GUARDIAN_PROOF_VISIBILITY_RETRY_DELAY_SECONDS || true
  unset MOCK_CODEX_REVIEW_BASE_PROMPT_UNSUPPORTED || true
  unset MOCK_CODEX_FORCE_FAIL || true
  unset MOCK_CODEX_OUTPUT_SEQUENCE_FILE || true
  unset MOCK_CODEX_PROMPT_CAPTURE_DIR || true
  unset MOCK_CODEX_FAIL_CALL || true
  unset REUSED_REVIEWER_LOGIN || true
  WEBENVOY_GUARDIAN_TRUSTED_REVIEWERS="review-bot"
  export WEBENVOY_GUARDIAN_TRUSTED_REVIEWERS
  unset MOCK_GH_REPO_OWNER_LOGIN || true
  export MOCK_GH_REVIEWS_REQUIRE_PAGINATE
  CODEX_HOME="${case_dir}/codex-home"
  export CODEX_HOME
  mkdir -p "${CODEX_HOME}/state"
}

seed_local_guardian_proof() {
  local review_id="$1"
  local reviewer="$2"
  local review_state="$3"
  local submitted_at="$4"
  local proof_file
  local tmp_file

  proof_file="$(guardian_proof_store_file)"
  ensure_guardian_proof_store_file
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/guardian-proof-test.XXXXXX")"

  jq \
    --arg review_id "${review_id}" \
    --arg reviewer "${reviewer}" \
    --arg review_state "${review_state}" \
    --arg submitted_at "${submitted_at}" \
    --arg repo_slug "${MOCK_REPO_SLUG:-mcontheway/WebEnvoy}" \
    --arg pr_number "274" \
    --arg head_sha "${HEAD_SHA:-}" \
    --arg base_ref "${BASE_REF:-}" \
    --arg merge_base_sha "${MERGE_BASE_SHA:-}" \
    --arg review_profile "${REVIEW_PROFILE:-}" \
    --arg review_basis_digest "${REVIEW_BASIS_DIGEST:-}" \
    --arg guardian_runtime_sha256 "$(hash_running_guardian_script_sha256)" \
    --arg prompt_digest "${PROMPT_DIGEST:-}" \
    --arg review_body_sha256 "$(hash_normalized_review_body_sha256 "${REVIEW_MD_FILE}")" \
    --arg verdict "$(jq -r '.verdict' "${RESULT_FILE}")" \
    --argjson safe_to_merge "$(jq -r '.safe_to_merge' "${RESULT_FILE}")" \
    '
      .proofs //= {}
      | .proofs[$review_id] = {
          repo_slug: $repo_slug,
          pr_number: $pr_number,
          review_id: $review_id,
          reviewer_login: $reviewer,
          head_sha: $head_sha,
          base_ref: $base_ref,
          merge_base_sha: $merge_base_sha,
          review_profile: $review_profile,
          review_basis_digest: $review_basis_digest,
          guardian_runtime_sha256: $guardian_runtime_sha256,
          prompt_digest: $prompt_digest,
          review_body_sha256: $review_body_sha256,
          verdict: $verdict,
          safe_to_merge: $safe_to_merge,
          review_state: $review_state,
          submitted_at: $submitted_at,
          recorded_at: "2026-04-07T10:06:00Z"
        }
    ' "${proof_file}" > "${tmp_file}"

  mv "${tmp_file}" "${proof_file}"
}

override_local_guardian_proof_field() {
  local review_id="$1"
  local field="$2"
  local value="$3"
  local proof_file
  local tmp_file

  proof_file="$(guardian_proof_store_file)"
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/guardian-proof-override.XXXXXX")"

  jq \
    --arg review_id "${review_id}" \
    --arg field "${field}" \
    --arg value "${value}" \
    '
      .proofs[$review_id][$field] = $value
    ' "${proof_file}" > "${tmp_file}"

  mv "${tmp_file}" "${proof_file}"
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
