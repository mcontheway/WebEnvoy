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

echo "$*" >> "${MOCK_GH_CALLS_LOG:?missing MOCK_GH_CALLS_LOG}"

pop_pr_view_response() {
  local line
  line="$(sed -n '1p' "${MOCK_GH_PR_VIEW_SEQUENCE_FILE:?missing MOCK_GH_PR_VIEW_SEQUENCE_FILE}")"
  tail -n +2 "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}" > "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}.next"
  mv "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}.next" "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}"
  printf '%s\n' "${line}"
}

if [[ "${1:-}" == "pr" && "${2:-}" == "checks" ]]; then
  cat "${MOCK_GH_CHECKS_JSON:?missing MOCK_GH_CHECKS_JSON}"
  exit 0
fi

if [[ "${1:-}" == "pr" && "${2:-}" == "view" ]]; then
  if [[ -n "${MOCK_GH_PR_VIEW_SEQUENCE_FILE:-}" && -s "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}" ]]; then
    pop_pr_view_response
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

assert_file_contains() {
  local file="$1"
  local expected="$2"
  if ! grep -Fq -- "${expected}" "${file}"; then
    echo "expected '${expected}' in ${file}" >&2
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

  MOCK_GH_REVIEWS_REQUIRE_PAGINATE=0
  unset MOCK_GH_REVIEWS_FIRST_PAGE_JSON || true
  unset MOCK_GH_PR_VIEW_SEQUENCE_FILE || true
  export MOCK_GH_REVIEWS_REQUIRE_PAGINATE
}

run_all_checks_pass_with_payload() {
  local payload="$1"
  setup_case_dir "checks"

  MOCK_GH_CHECKS_JSON="${TMP_DIR}/mock-gh-checks.json"
  export MOCK_GH_CHECKS_JSON
  printf '%s\n' "${payload}" > "${MOCK_GH_CHECKS_JSON}"

  all_required_checks_pass 123 >/dev/null 2>&1
}

setup_merge_if_safe_fixture() {
  local case_name="$1"
  local pr_author="$2"
  local reviewer="$3"
  local review_state="$4"
  local review_commit="$5"
  local require_paginate="${6:-0}"

  setup_case_dir "${case_name}"

  HEAD_SHA="head-sha-123"
  export HEAD_SHA

  RESULT_FILE="${TMP_DIR}/review.json"
  printf '%s\n' '{"verdict":"APPROVE","safe_to_merge":true}' > "${RESULT_FILE}"
  export RESULT_FILE

  MOCK_GH_USER_LOGIN="${reviewer}"
  export MOCK_GH_USER_LOGIN

  PR_AUTHOR="${pr_author}"
  export PR_AUTHOR

  MOCK_GH_PR_VIEW_JSON="${TEST_TMP_DIR}/${case_name}/mock/pr-view.json"
  printf '%s\n' '{"baseRefName":"main","headRefOid":"head-sha-123","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","isDraft":false}' > "${MOCK_GH_PR_VIEW_JSON}"
  export MOCK_GH_PR_VIEW_JSON

  MOCK_GH_CHECKS_JSON="${TEST_TMP_DIR}/${case_name}/mock/checks.json"
  printf '%s\n' '[{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]' > "${MOCK_GH_CHECKS_JSON}"
  export MOCK_GH_CHECKS_JSON

  MOCK_GH_REVIEWS_JSON="${TEST_TMP_DIR}/${case_name}/mock/reviews.json"
  printf '[[{"user":{"login":"%s"},"commit_id":"%s","state":"%s"}]]\n' "${reviewer}" "${review_commit}" "${review_state}" > "${MOCK_GH_REVIEWS_JSON}"
  export MOCK_GH_REVIEWS_JSON

  if [[ "${require_paginate}" == "1" ]]; then
    MOCK_GH_REVIEWS_REQUIRE_PAGINATE=1
    export MOCK_GH_REVIEWS_REQUIRE_PAGINATE

    MOCK_GH_REVIEWS_FIRST_PAGE_JSON="${TEST_TMP_DIR}/${case_name}/mock/reviews-page-1.json"
    printf '%s\n' '[[{"user":{"login":"other-reviewer"},"commit_id":"older-sha","state":"APPROVED"}]]' > "${MOCK_GH_REVIEWS_FIRST_PAGE_JSON}"
    export MOCK_GH_REVIEWS_FIRST_PAGE_JSON
  fi
}

test_merge_if_safe_without_post_review_respects_comment_contract() {
  setup_merge_if_safe_fixture \
    "merge-without-post-review-comment-contract" \
    "review-bot" \
    "review-bot" \
    "COMMENTED" \
    "head-sha-123" \
    "0"

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_MERGE_LOG}" "--match-head-commit head-sha-123"
}

test_merge_if_safe_finds_head_review_across_paginated_reviews() {
  setup_merge_if_safe_fixture \
    "merge-paginated-reviews" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "1"

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_CALLS_LOG}" "repos/:owner/:repo/pulls/274/reviews"
  assert_file_contains "${MOCK_GH_CALLS_LOG}" "--paginate"
}

test_post_review_fails_when_head_changes_after_review_snapshot() {
  setup_merge_if_safe_fixture \
    "post-review-head-drift" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  MOCK_GH_PR_VIEW_SEQUENCE_FILE="${TEST_TMP_DIR}/post-review-head-drift/mock/pr-view-seq.jsonl"
  printf '%s\n' '{"headRefOid":"head-sha-999"}' > "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}"
  export MOCK_GH_PR_VIEW_SEQUENCE_FILE

  assert_fail post_review 274
  assert_file_empty "${MOCK_GH_REVIEW_LOG}"
}

test_merge_if_safe_fails_when_head_changes_after_review_snapshot() {
  setup_merge_if_safe_fixture \
    "merge-head-drift" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  MOCK_GH_PR_VIEW_SEQUENCE_FILE="${TEST_TMP_DIR}/merge-head-drift/mock/pr-view-seq.jsonl"
  printf '%s\n' '{"baseRefName":"main","headRefOid":"head-sha-999","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","isDraft":false}' > "${MOCK_GH_PR_VIEW_SEQUENCE_FILE}"
  export MOCK_GH_PR_VIEW_SEQUENCE_FILE

  assert_fail merge_if_safe 274 0
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_merge_if_safe_treats_behind_as_retryable_wait_state() {
  setup_merge_if_safe_fixture \
    "merge-state-behind" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  printf '%s\n' '{"baseRefName":"main","headRefOid":"head-sha-123","mergeable":"MERGEABLE","mergeStateStatus":"BEHIND","isDraft":false}' > "${MOCK_GH_PR_VIEW_JSON}"

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "mergeStateStatus=BEHIND"
  assert_file_contains "${err_file}" "可重跑/等待后重试"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_merge_if_safe_treats_unknown_as_retryable_wait_state() {
  setup_merge_if_safe_fixture \
    "merge-state-unknown" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  printf '%s\n' '{"baseRefName":"main","headRefOid":"head-sha-123","mergeable":"MERGEABLE","mergeStateStatus":"UNKNOWN","isDraft":false}' > "${MOCK_GH_PR_VIEW_JSON}"

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "mergeStateStatus=UNKNOWN"
  assert_file_contains "${err_file}" "可重跑/等待后重试"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

main() {
  setup_mock_gh
  load_guardian_without_main

  assert_pass run_all_checks_pass_with_payload '[{"name":"review-completed","bucket":"pass","state":"SUCCESS","link":"https://example.test/review"},{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]'
  assert_fail run_all_checks_pass_with_payload '[{"name":"review-completed","bucket":"fail","state":"FAILURE","link":"https://example.test/review"},{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]'
  assert_fail run_all_checks_pass_with_payload '[{"name":"review-completed","bucket":"pass","state":"SUCCESS","link":"https://example.test/review"},{"name":"Run Tests","bucket":"fail","state":"FAILURE","link":"https://example.test/tests"}]'

  test_merge_if_safe_without_post_review_respects_comment_contract
  test_merge_if_safe_finds_head_review_across_paginated_reviews
  test_post_review_fails_when_head_changes_after_review_snapshot
  test_merge_if_safe_fails_when_head_changes_after_review_snapshot
  test_merge_if_safe_treats_behind_as_retryable_wait_state
  test_merge_if_safe_treats_unknown_as_retryable_wait_state

  echo "pr-guardian merge-guard semantics test passed."
}

main "$@"
