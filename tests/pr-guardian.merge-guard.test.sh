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

pop_sequence_response_line() {
  local sequence_file="$1"
  local line
  line="$(sed -n '1p' "${sequence_file}")"
  tail -n +2 "${sequence_file}" > "${sequence_file}.next"
  mv "${sequence_file}.next" "${sequence_file}"
  printf '%s\n' "${line}"
}

if [[ "${1:-}" == "pr" && "${2:-}" == "checks" ]]; then
  if [[ "${MOCK_GH_CHECKS_EXIT_CODE:-0}" != "0" ]]; then
    if [[ -n "${MOCK_GH_CHECKS_STDERR:-}" ]]; then
      printf '%s\n' "${MOCK_GH_CHECKS_STDERR}" >&2
    fi
    exit "${MOCK_GH_CHECKS_EXIT_CODE}"
  fi

  cat "${MOCK_GH_CHECKS_JSON:?missing MOCK_GH_CHECKS_JSON}"
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
  unset MOCK_GH_REVIEWS_SEQUENCE_FILE || true
  export MOCK_GH_REVIEWS_REQUIRE_PAGINATE
}

run_all_checks_pass_with_payload() {
  local payload="$1"
  setup_case_dir "checks"

  MOCK_GH_CHECKS_EXIT_CODE=0
  unset MOCK_GH_CHECKS_STDERR || true
  export MOCK_GH_CHECKS_EXIT_CODE

  MOCK_GH_CHECKS_JSON="${TMP_DIR}/mock-gh-checks.json"
  export MOCK_GH_CHECKS_JSON
  printf '%s\n' "${payload}" > "${MOCK_GH_CHECKS_JSON}"

  all_required_checks_pass 123 >/dev/null 2>&1
}

run_all_checks_pass_without_required_checks_reported() {
  setup_case_dir "checks-no-required"

  MOCK_GH_CHECKS_JSON="${TMP_DIR}/mock-gh-checks.json"
  export MOCK_GH_CHECKS_JSON
  printf '%s\n' '[]' > "${MOCK_GH_CHECKS_JSON}"

  MOCK_GH_CHECKS_EXIT_CODE=1
  MOCK_GH_CHECKS_STDERR="no required checks reported"
  export MOCK_GH_CHECKS_EXIT_CODE
  export MOCK_GH_CHECKS_STDERR

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

test_merge_if_safe_rejects_review_from_old_head() {
  setup_merge_if_safe_fixture \
    "merge-review-old-head" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "older-head-sha" \
    "0"

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "期望状态: APPROVED"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_merge_if_safe_uses_latest_review_state_on_same_head() {
  setup_merge_if_safe_fixture \
    "merge-review-latest-state-same-head" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  printf '%s\n' '[[{"id":22,"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"APPROVED","submitted_at":"2026-03-26T10:00:00Z"},{"id":11,"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"CHANGES_REQUESTED","submitted_at":"2026-03-26T09:00:00Z"}]]' > "${MOCK_GH_REVIEWS_JSON}"

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_MERGE_LOG}" "--match-head-commit head-sha-123"
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

test_merge_if_safe_retries_until_review_state_is_visible() {
  setup_merge_if_safe_fixture \
    "merge-review-state-retry" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  MOCK_GH_REVIEWS_SEQUENCE_FILE="${TEST_TMP_DIR}/merge-review-state-retry/mock/reviews-seq.jsonl"
  {
    printf '%s\n' '[[{"user":{"login":"other-reviewer"},"commit_id":"head-sha-123","state":"APPROVED"}]]'
    printf '%s\n' '[[{"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"APPROVED"}]]'
  } > "${MOCK_GH_REVIEWS_SEQUENCE_FILE}"
  export MOCK_GH_REVIEWS_SEQUENCE_FILE

  PR_GUARDIAN_REVIEW_STATE_MAX_ATTEMPTS=2
  PR_GUARDIAN_REVIEW_STATE_RETRY_DELAY_SECONDS=0
  export PR_GUARDIAN_REVIEW_STATE_MAX_ATTEMPTS
  export PR_GUARDIAN_REVIEW_STATE_RETRY_DELAY_SECONDS

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_MERGE_LOG}" "--match-head-commit head-sha-123"

  local review_calls
  review_calls="$(grep -c "repos/:owner/:repo/pulls/274/reviews" "${MOCK_GH_CALLS_LOG}")"
  if [[ "${review_calls}" -lt 2 ]]; then
    echo "expected merge_if_safe to retry review-state check at least once" >&2
    exit 1
  fi
}

test_merge_if_safe_rejects_when_latest_review_state_regresses_on_same_head() {
  setup_merge_if_safe_fixture \
    "merge-review-state-regression-same-head" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  printf '%s\n' '[[{"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"APPROVED"},{"user":{"login":"review-bot"},"commit_id":"head-sha-123","state":"CHANGES_REQUESTED"}]]' > "${MOCK_GH_REVIEWS_JSON}"

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "期望状态: APPROVED"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

test_post_review_self_review_uses_review_event_and_merge_gate_uses_reviews_api() {
  setup_merge_if_safe_fixture \
    "post-review-self-review-event" \
    "review-bot" \
    "review-bot" \
    "COMMENTED" \
    "head-sha-123" \
    "0"

  REVIEW_MD_FILE="${TMP_DIR}/review.md"
  printf '%s\n' "self review body" > "${REVIEW_MD_FILE}"
  export REVIEW_MD_FILE

  RESULT_FILE="${TMP_DIR}/review.json"
  printf '%s\n' '{"verdict":"APPROVE","safe_to_merge":true,"findings":[]}' > "${RESULT_FILE}"
  export RESULT_FILE

  assert_pass post_review 274
  assert_file_contains "${MOCK_GH_REVIEW_LOG}" "pr review 274 --comment --body-file"
  assert_file_not_contains "${MOCK_GH_REVIEW_LOG}" "pr comment 274"

  assert_pass merge_if_safe 274 0
  assert_file_contains "${MOCK_GH_CALLS_LOG}" "repos/:owner/:repo/pulls/274/reviews"
  assert_file_not_contains "${MOCK_GH_CALLS_LOG}" "repos/:owner/:repo/issues/274/comments"
  assert_file_contains "${MOCK_GH_MERGE_LOG}" "--match-head-commit head-sha-123"
}

test_merge_if_safe_rejects_comment_marker_without_formal_review() {
  setup_merge_if_safe_fixture \
    "merge-review-comment-marker-only" \
    "pr-author" \
    "review-bot" \
    "APPROVED" \
    "head-sha-123" \
    "0"

  printf '%s\n' '[]' > "${MOCK_GH_REVIEWS_JSON}"
  printf '%s\n' '[{"name":"review-completed","bucket":"pass","state":"SUCCESS","link":"https://example.test/review"},{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]' > "${MOCK_GH_CHECKS_JSON}"

  local err_file="${TMP_DIR}/merge.err"
  assert_fail merge_if_safe 274 0 2>"${err_file}"
  assert_file_contains "${err_file}" "缺少 review-bot 的已完成 GitHub review"
  assert_file_empty "${MOCK_GH_MERGE_LOG}"
}

main() {
  setup_mock_gh
  load_guardian_without_main

  assert_pass run_all_checks_pass_with_payload '[{"name":"review-completed","bucket":"pass","state":"SUCCESS","link":"https://example.test/review"},{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]'
  assert_fail run_all_checks_pass_with_payload '[{"name":"review-completed","bucket":"fail","state":"FAILURE","link":"https://example.test/review"},{"name":"Run Tests","bucket":"pass","state":"SUCCESS","link":"https://example.test/tests"}]'
  assert_fail run_all_checks_pass_with_payload '[{"name":"review-completed","bucket":"pass","state":"SUCCESS","link":"https://example.test/review"},{"name":"Run Tests","bucket":"fail","state":"FAILURE","link":"https://example.test/tests"}]'
  assert_fail run_all_checks_pass_without_required_checks_reported

  test_merge_if_safe_without_post_review_respects_comment_contract
  test_post_review_self_review_uses_review_event_and_merge_gate_uses_reviews_api
  test_merge_if_safe_finds_head_review_across_paginated_reviews
  test_merge_if_safe_rejects_review_from_old_head
  test_merge_if_safe_uses_latest_review_state_on_same_head
  test_post_review_fails_when_head_changes_after_review_snapshot
  test_merge_if_safe_fails_when_head_changes_after_review_snapshot
  test_merge_if_safe_treats_behind_as_retryable_wait_state
  test_merge_if_safe_treats_unknown_as_retryable_wait_state
  test_merge_if_safe_retries_until_review_state_is_visible
  test_merge_if_safe_rejects_when_latest_review_state_regresses_on_same_head
  test_merge_if_safe_rejects_comment_marker_without_formal_review

  echo "pr-guardian merge-guard semantics test passed."
}

main "$@"
