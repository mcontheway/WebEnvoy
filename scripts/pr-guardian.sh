#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROMPT_FILE="${REPO_ROOT}/code_review.md"
SCHEMA_FILE="${REPO_ROOT}/scripts/pr-review-result.schema.json"

usage() {
  cat <<'EOF'
用法:
  scripts/pr-guardian.sh review <pr-number> [--post-review]
  scripts/pr-guardian.sh merge-if-safe <pr-number> [--post-review] [--delete-branch]

说明:
  review         本机执行 Codex 审查并打印结论
  merge-if-safe  自动回写 review（可兼容传 --post-review）；审查通过且必需检查通过时，执行 squash merge
EOF
}

die() {
  echo "错误: $*" >&2
  exit 1
}

warn() {
  echo "警告: $*" >&2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少依赖命令: $1"
}

check_gh_auth() {
  if ! gh auth status >/dev/null 2>&1; then
    die "GitHub CLI 未登录或凭证失效，请先执行: gh auth login"
  fi
}

cleanup() {
  if [[ -n "${WORKTREE_DIR:-}" ]] && [[ -d "${WORKTREE_DIR}" ]]; then
    git -C "${REPO_ROOT}" worktree remove --force "${WORKTREE_DIR}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${TMP_DIR:-}" ]] && [[ -d "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}"
  fi
}

build_markdown_review() {
  local result_file="$1"
  local review_file="$2"

  jq -r '
    def severity_label:
      if . == "critical" then "P0 / critical"
      elif . == "high" then "P1 / high"
      elif . == "medium" then "P2 / medium"
      else "P3 / low"
      end;
    def findings:
      if (.findings | length) == 0 then
        "- 未发现新的阻断性问题。"
      else
        (.findings | to_entries | map(
          ((.key + 1) | tostring) + ". **[" + (.value.severity | severity_label) + "] " + .value.title + "**\n" +
          "文件: `" + .value.code_location.absolute_file_path + "`" +
          (if (.value.code_location.line_range.start? != null and .value.code_location.line_range.end? != null)
            then " (L" + (.value.code_location.line_range.start|tostring) + "-" + (.value.code_location.line_range.end|tostring) + ")"
            else "" end) + "\n" +
          "说明: " + .value.details +
          (if .value.confidence_score? != null
            then "\n置信度: " + (.value.confidence_score|tostring)
            else "" end) +
          (if .value.priority? != null
            then "\n优先级: P" + (.value.priority|tostring)
            else "" end)
        ) | join("\n\n"))
      end;
    def actions:
      if (.required_actions | length) == 0 then
        "- 无。"
      else
        (.required_actions | map("- " + .) | join("\n"))
      end;
    "## PR Review 结论\n\n" +
    "**结论**: " + .verdict + "\n\n" +
    "**允许合并**: " + (if .safe_to_merge then "是" else "否" end) + "\n\n" +
    "**摘要**: " + .summary + "\n\n" +
    "### 需要关注的问题\n\n" + findings + "\n\n" +
    "### 合并前动作\n\n" + actions + "\n"
  ' "${result_file}" > "${review_file}"
}

prepare_pr_workspace() {
  local pr_number="$1"

  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/webenvoy-pr-guardian.XXXXXX")"
  META_FILE="${TMP_DIR}/pr.json"
  RESULT_FILE="${TMP_DIR}/review.json"
  REVIEW_MD_FILE="${TMP_DIR}/review.md"
  PROMPT_RUN_FILE="${TMP_DIR}/prompt.md"

  gh pr view "${pr_number}" --json \
    number,title,body,url,isDraft,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,author \
    > "${META_FILE}"

  BASE_REF="$(jq -r '.baseRefName' "${META_FILE}")"
  HEAD_SHA="$(jq -r '.headRefOid' "${META_FILE}")"
  PR_URL="$(jq -r '.url' "${META_FILE}")"
  PR_TITLE="$(jq -r '.title' "${META_FILE}")"
  PR_BODY="$(jq -r '.body // ""' "${META_FILE}")"
  PR_AUTHOR="$(jq -r '.author.login // ""' "${META_FILE}")"

  git -C "${REPO_ROOT}" fetch origin "${BASE_REF}" >/dev/null
  git -C "${REPO_ROOT}" fetch origin "pull/${pr_number}/head:refs/remotes/origin/pr/${pr_number}" >/dev/null

  WORKTREE_DIR="${TMP_DIR}/worktree"
  git -C "${REPO_ROOT}" worktree add --detach "${WORKTREE_DIR}" "origin/pr/${pr_number}" >/dev/null
  hydrate_worktree_dependencies
}

hydrate_worktree_dependencies() {
  local source_node_modules="${REPO_ROOT}/node_modules"
  local target_node_modules="${WORKTREE_DIR}/node_modules"

  if [[ -d "${target_node_modules}" && ! -L "${target_node_modules}" ]]; then
    return
  fi

  rm -rf "${target_node_modules}"

  if [[ -d "${source_node_modules}" ]]; then
    if ! ln -s "${source_node_modules}" "${target_node_modules}"; then
      warn "依赖回退到仓库 node_modules 软链接失败，继续无依赖审查。"
    fi
    return
  fi

  warn "未检测到可复用的仓库 node_modules，继续无依赖审查。"
}

normalize_review_path() {
  local raw_path="$1"

  if [[ "${raw_path}" == "${WORKTREE_DIR}"/* ]]; then
    printf '%s\n' "${raw_path#${WORKTREE_DIR}/}"
    return
  fi

  if [[ "${raw_path}" == "${REPO_ROOT}"/* ]]; then
    printf '%s\n' "${raw_path#${REPO_ROOT}/}"
    return
  fi

  printf '%s\n' "${raw_path}"
}

line_range_reviewable() {
  local path="$1"
  local line_start="$2"
  local line_end="$3"
  local diff_line
  local hunk_start
  local hunk_count
  local hunk_end

  while IFS= read -r diff_line; do
    [[ "${diff_line}" =~ ^@@\ -[0-9]+(,[0-9]+)?\ \+([0-9]+)(,([0-9]+))?\ @@ ]] || continue

    hunk_start="${BASH_REMATCH[2]}"
    hunk_count="${BASH_REMATCH[4]:-1}"
    [[ "${hunk_count}" != "0" ]] || continue

    hunk_end=$((hunk_start + hunk_count - 1))
    if (( line_start >= hunk_start && line_end <= hunk_end )); then
      return 0
    fi
  done < <(git -C "${WORKTREE_DIR}" diff --unified=0 "origin/${BASE_REF}" -- "${path}")

  return 1
}

run_codex_review() {
  local pr_number="$1"

  {
    awk '
      found { print }
      /^## Codex Review Prompt$/ { found=1; next }
    ' "${PROMPT_FILE}"
    echo
    echo "PR 元数据："
    echo "- PR: #${pr_number}"
    echo "- 标题: ${PR_TITLE}"
    echo "- 链接: ${PR_URL}"
    echo "- 基线分支: ${BASE_REF}"
    echo "- 头部提交: ${HEAD_SHA}"
    echo "- PR 描述:"
    echo "${PR_BODY}"
    echo
    echo "请在当前仓库工作树中完成审查，比较当前分支与 origin/${BASE_REF} 的差异。"
  } > "${PROMPT_RUN_FILE}"

  codex exec \
    -C "${WORKTREE_DIR}" \
    -s read-only \
    --output-schema "${SCHEMA_FILE}" \
    -o "${RESULT_FILE}" \
    - < "${PROMPT_RUN_FILE}" >/dev/null

  build_markdown_review "${RESULT_FILE}" "${REVIEW_MD_FILE}"
}

expected_review_state_for_verdict() {
  local verdict="$1"
  local reviewer="$2"

  if [[ -n "${PR_AUTHOR:-}" ]] && [[ "${PR_AUTHOR}" == "${reviewer}" ]]; then
    printf 'COMMENTED\n'
    return
  fi

  if [[ "${verdict}" == "APPROVE" ]]; then
    printf 'APPROVED\n'
  else
    printf 'CHANGES_REQUESTED\n'
  fi
}

submit_review_event() {
  local pr_number="$1"
  local verdict="$2"
  local reviewer="$3"

  if [[ -n "${PR_AUTHOR:-}" ]] && [[ "${PR_AUTHOR}" == "${reviewer}" ]]; then
    gh pr review "${pr_number}" --comment --body-file "${REVIEW_MD_FILE}" >/dev/null
    return
  fi

  if [[ "${verdict}" == "APPROVE" ]]; then
    gh pr review "${pr_number}" --approve --body-file "${REVIEW_MD_FILE}" >/dev/null
  else
    gh pr review "${pr_number}" --request-changes --body-file "${REVIEW_MD_FILE}" >/dev/null
  fi
}

head_has_expected_review_state() {
  local pr_number="$1"
  local head_sha="$2"
  local reviewer="$3"
  local expected_state="$4"
  local reviews_file="${TMP_DIR}/reviews.json"

  gh api --paginate --slurp "repos/:owner/:repo/pulls/${pr_number}/reviews" > "${reviews_file}"

  jq -e \
    --arg reviewer "${reviewer}" \
    --arg head_sha "${head_sha}" \
    --arg expected_state "${expected_state}" \
    '
      [
        .[][]
        | select((.user.login // "") == $reviewer)
        | select((.commit_id // "") == $head_sha)
        | select((.state // "") | IN("APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"))
      ]
      | if length == 0 then
          false
        else
          (
            to_entries
            | sort_by([(.value.submitted_at // ""), (.value.id // 0), .key])
            | last
            | (.value.state // "")
          ) == $expected_state
        end
    ' "${reviews_file}" >/dev/null 2>&1
}

wait_for_expected_review_state() {
  local pr_number="$1"
  local head_sha="$2"
  local reviewer="$3"
  local expected_state="$4"
  local max_attempts="${PR_GUARDIAN_REVIEW_STATE_MAX_ATTEMPTS:-3}"
  local retry_delay_seconds="${PR_GUARDIAN_REVIEW_STATE_RETRY_DELAY_SECONDS:-1}"
  local attempt=1

  while (( attempt <= max_attempts )); do
    if head_has_expected_review_state "${pr_number}" "${head_sha}" "${reviewer}" "${expected_state}"; then
      return 0
    fi

    if (( attempt < max_attempts )); then
      sleep "${retry_delay_seconds}"
    fi

    attempt=$((attempt + 1))
  done

  return 1
}

post_review() {
  local pr_number="$1"
  local verdict
  local current_user

  assert_pr_head_matches_snapshot "${pr_number}" "回写 review 前检测到 PR HEAD 已变化"

  verdict="$(jq -r '.verdict' "${RESULT_FILE}")"
  current_user="$(gh api user --jq '.login')"

  post_inline_comments "${pr_number}"
  submit_review_event "${pr_number}" "${verdict}" "${current_user}"
}

assert_pr_head_matches_snapshot() {
  local pr_number="$1"
  local reason="$2"
  local current_head_sha
  local head_meta_file="${TMP_DIR}/head-check.json"

  gh pr view "${pr_number}" --json headRefOid > "${head_meta_file}"
  current_head_sha="$(jq -r '.headRefOid' "${head_meta_file}")"

  if [[ "${current_head_sha}" != "${HEAD_SHA}" ]]; then
    die "${reason}：审查快照=${HEAD_SHA}，当前=${current_head_sha}。请重跑 guardian。"
  fi
}

post_inline_comments() {
  local pr_number="$1"
  local payload_file="${TMP_DIR}/inline-comments.jsonl"
  local inline_error_file="${TMP_DIR}/inline-comment.err"
  local count

  jq -c '
    .findings[]
    | select(.code_location.line_range.start? != null and .code_location.line_range.end? != null)
    | {
        body: (
          .title + "\n\n" +
          .details +
          (if .confidence_score? != null then "\n\n置信度: " + (.confidence_score | tostring) else "" end) +
          (if .priority? != null then "\n优先级: P" + (.priority | tostring) else "" end)
        ),
        path: .code_location.absolute_file_path,
        line_start: .code_location.line_range.start,
        line_end: .code_location.line_range.end
      }
  ' "${RESULT_FILE}" > "${payload_file}"

  count="$(wc -l < "${payload_file}" | tr -d '[:space:]')"
  [[ "${count}" != "0" ]] || return 0

  while IFS= read -r row; do
    [[ -n "${row}" ]] || continue

    local body
    local raw_path
    local path
    local line_start
    local line_end

    body="$(jq -r '.body' <<< "${row}")"
    raw_path="$(jq -r '.path' <<< "${row}")"
    path="$(normalize_review_path "${raw_path}")"
    line_start="$(jq -r '.line_start' <<< "${row}")"
    line_end="$(jq -r '.line_end' <<< "${row}")"

    if [[ -z "${path}" || "${path}" == "null" ]]; then
      continue
    fi

    if ! line_range_reviewable "${path}" "${line_start}" "${line_end}"; then
      echo "警告: 跳过无法锚定到 PR diff 的行级评论: ${path} (L${line_start}-L${line_end})" >&2
      continue
    fi

    if [[ "${line_start}" == "${line_end}" ]]; then
      if ! gh api \
        --method POST \
        -H "Accept: application/vnd.github+json" \
        "repos/:owner/:repo/pulls/${pr_number}/comments" \
        -f body="${body}" \
        -f commit_id="${HEAD_SHA}" \
        -f path="${path}" \
        -F line="${line_end}" \
        -f side="RIGHT" >/dev/null 2>"${inline_error_file}"; then
        echo "警告: 行级评论发布失败，已跳过: ${path} (L${line_start}-L${line_end})" >&2
        sed 's/^/  /' "${inline_error_file}" >&2
        continue
      fi
    else
      if ! gh api \
        --method POST \
        -H "Accept: application/vnd.github+json" \
        "repos/:owner/:repo/pulls/${pr_number}/comments" \
        -f body="${body}" \
        -f commit_id="${HEAD_SHA}" \
        -f path="${path}" \
        -F line="${line_end}" \
        -f side="RIGHT" \
        -F start_line="${line_start}" \
        -f start_side="RIGHT" >/dev/null 2>"${inline_error_file}"; then
        echo "警告: 行级评论发布失败，已跳过: ${path} (L${line_start}-L${line_end})" >&2
        sed 's/^/  /' "${inline_error_file}" >&2
        continue
      fi
    fi
  done < "${payload_file}"
}

print_summary() {
  echo
  cat "${REVIEW_MD_FILE}"
  echo
}

all_required_checks_pass() {
  local pr_number="$1"
  local checks_file="${TMP_DIR}/checks.required.json"
  local checks_error_file="${TMP_DIR}/checks.required.err"
  local all_checks_file="${TMP_DIR}/checks.all.json"
  local all_checks_error_file="${TMP_DIR}/checks.all.err"
  local using_required_checks="1"

  if ! gh pr checks "${pr_number}" --required --json name,bucket,state,link > "${checks_file}" 2>"${checks_error_file}"; then
    if grep -q "no required checks reported" "${checks_error_file}"; then
      if ! gh pr checks "${pr_number}" --json name,bucket,state,link > "${checks_file}" 2>"${checks_error_file}"; then
        sed 's/^/  /' "${checks_error_file}" >&2 || true
        return 1
      fi
      using_required_checks="0"
    elif [[ -s "${checks_file}" ]] && jq empty "${checks_file}" >/dev/null 2>&1; then
      :
    else
      sed 's/^/  /' "${checks_error_file}" >&2 || true
      return 1
    fi
  fi

  if [[ "$(jq 'length' "${checks_file}")" -eq 0 ]]; then
    if [[ "${using_required_checks}" == "1" ]]; then
      echo "GitHub required checks 列表为空，拒绝视为通过。" >&2
    else
      echo "GitHub 未配置 required checks，且当前 checks 列表为空，拒绝视为通过。" >&2
    fi
    return 1
  fi

  if ! jq -e 'all(.[]; .bucket == "pass")' "${checks_file}" >/dev/null 2>&1; then
    return 1
  fi

  if ! gh pr checks "${pr_number}" --json name,bucket,state,link > "${all_checks_file}" 2>"${all_checks_error_file}"; then
    sed 's/^/  /' "${all_checks_error_file}" >&2 || true
    return 1
  fi

  if [[ "$(jq 'length' "${all_checks_file}")" -eq 0 ]]; then
    echo "GitHub checks 列表为空，拒绝视为通过。" >&2
    return 1
  fi

  jq -e 'all(.[]; .bucket == "pass")' "${all_checks_file}" >/dev/null 2>&1
}

load_merge_gate_meta() {
  local pr_number="$1"
  local meta_file="$2"

  gh pr view "${pr_number}" --json baseRefName,headRefOid,mergeable,mergeStateStatus,isDraft > "${meta_file}"
}

wait_for_merge_gate_ready() {
  local pr_number="$1"
  local meta_file="$2"
  local max_attempts="${PR_GUARDIAN_MERGE_STATE_MAX_ATTEMPTS:-3}"
  local retry_delay_seconds="${PR_GUARDIAN_MERGE_STATE_RETRY_DELAY_SECONDS:-2}"
  local attempt=1
  local merge_state_status

  while (( attempt <= max_attempts )); do
    load_merge_gate_meta "${pr_number}" "${meta_file}"
    merge_state_status="$(jq -r '.mergeStateStatus' "${meta_file}")"

    case "${merge_state_status}" in
      CLEAN|HAS_HOOKS|UNSTABLE)
        return 0
        ;;
      BEHIND|UNKNOWN)
        if (( attempt < max_attempts )); then
          sleep "${retry_delay_seconds}"
        fi
        ;;
      *)
        return 0
        ;;
    esac

    attempt=$((attempt + 1))
  done

  return 1
}

merge_if_safe() {
  local pr_number="$1"
  local delete_branch="$2"
  local safe_to_merge
  local verdict
  local mergeable
  local merge_state_status
  local is_draft
  local current_user
  local expected_review_state
  local current_head_sha
  local current_base_ref
  local current_meta_file

  verdict="$(jq -r '.verdict' "${RESULT_FILE}")"
  safe_to_merge="$(jq -r '.safe_to_merge' "${RESULT_FILE}")"
  current_user="$(gh api user --jq '.login')"
  current_meta_file="${TMP_DIR}/merge-meta.json"

  wait_for_merge_gate_ready "${pr_number}" "${current_meta_file}" || true
  current_base_ref="$(jq -r '.baseRefName' "${current_meta_file}")"
  current_head_sha="$(jq -r '.headRefOid' "${current_meta_file}")"
  mergeable="$(jq -r '.mergeable' "${current_meta_file}")"
  merge_state_status="$(jq -r '.mergeStateStatus' "${current_meta_file}")"
  is_draft="$(jq -r '.isDraft' "${current_meta_file}")"
  expected_review_state="$(expected_review_state_for_verdict "${verdict}" "${current_user}")"

  if [[ "${current_head_sha}" != "${HEAD_SHA}" ]]; then
    die "合并前检测到 PR HEAD 已变化：审查快照=${HEAD_SHA}，当前=${current_head_sha}。请重跑 guardian。"
  fi

  [[ "${current_base_ref}" == "main" ]] || die "仅允许合并到 main，当前 base: ${current_base_ref}"
  [[ "${is_draft}" == "false" ]] || die "PR 仍是 Draft，拒绝合并。"
  [[ "${verdict}" == "APPROVE" ]] || die "Codex 审查未批准，拒绝合并。"
  [[ "${safe_to_merge}" == "true" ]] || die "审查结果认为当前 PR 不安全，拒绝合并。"
  [[ "${mergeable}" == "MERGEABLE" ]] || die "GitHub 判定当前 PR 不可合并，状态为: ${mergeable}"
  case "${merge_state_status}" in
    CLEAN|HAS_HOOKS|UNSTABLE)
      ;;
    BEHIND|UNKNOWN)
      die "GitHub mergeStateStatus=${merge_state_status}，当前属于暂不可合并状态（可重跑/等待后重试），请稍后重跑 guardian。"
      ;;
    *)
      die "GitHub mergeStateStatus 阻断合并，状态为: ${merge_state_status}"
      ;;
  esac

  if ! wait_for_expected_review_state "${pr_number}" "${HEAD_SHA}" "${current_user}" "${expected_review_state}"; then
    die "当前 HEAD (${HEAD_SHA}) 缺少 ${current_user} 的已完成 GitHub review（期望状态: ${expected_review_state}，已重试 ${PR_GUARDIAN_REVIEW_STATE_MAX_ATTEMPTS:-3} 次），拒绝合并。"
  fi

  if ! all_required_checks_pass "${pr_number}"; then
    die "GitHub required checks 未全部通过，拒绝合并。"
  fi

  if [[ "${delete_branch}" == "1" ]]; then
    gh pr merge "${pr_number}" --squash --delete-branch --match-head-commit "${HEAD_SHA}"
  else
    gh pr merge "${pr_number}" --squash --match-head-commit "${HEAD_SHA}"
  fi
}

main() {
  trap cleanup EXIT

  require_cmd git
  require_cmd gh
  require_cmd jq
  require_cmd codex
  [[ -f "${PROMPT_FILE}" ]] || die "缺少审查提示词文件: ${PROMPT_FILE}"
  [[ -f "${SCHEMA_FILE}" ]] || die "缺少 Schema 文件: ${SCHEMA_FILE}"

  local mode="${1:-}"
  local pr_number="${2:-}"
  local post_review_flag=0
  local should_post_review=0
  local delete_branch_flag=0

  [[ -n "${mode}" ]] || { usage; exit 1; }
  [[ -n "${pr_number}" ]] || { usage; exit 1; }

  shift 2
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --post-review)
        post_review_flag=1
        ;;
      --delete-branch)
        delete_branch_flag=1
        ;;
      *)
        die "未知参数: $1"
        ;;
    esac
    shift
  done

  case "${mode}" in
    review|merge-if-safe)
      ;;
    *)
      usage
      exit 1
      ;;
  esac

  check_gh_auth
  prepare_pr_workspace "${pr_number}"
  run_codex_review "${pr_number}"
  print_summary

  if [[ "${mode}" == "merge-if-safe" ]]; then
    should_post_review=1
  else
    should_post_review="${post_review_flag}"
  fi

  if [[ "${should_post_review}" == "1" ]]; then
    post_review "${pr_number}"
    echo "已回写 PR review。"
  fi

  if [[ "${mode}" == "merge-if-safe" ]]; then
    merge_if_safe "${pr_number}" "${delete_branch_flag}"
  fi
}

main "$@"
