#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROMPT_FILE="${REPO_ROOT}/code_review.md"
SCHEMA_FILE="${REPO_ROOT}/.codex/pr-review-result.schema.json"

usage() {
  cat <<'EOF'
用法:
  scripts/pr-guardian.sh review <pr-number> [--post-review]
  scripts/pr-guardian.sh merge-if-safe <pr-number> [--post-review] [--delete-branch]

说明:
  review         本机执行 Codex 审查并打印结论
  merge-if-safe  审查通过且必需检查通过时，执行 squash merge
EOF
}

die() {
  echo "错误: $*" >&2
  exit 1
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
    if (( !(line_end < hunk_start || hunk_end < line_start) )); then
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

post_review() {
  local pr_number="$1"
  local verdict
  local current_user

  verdict="$(jq -r '.verdict' "${RESULT_FILE}")"
  current_user="$(gh api user --jq '.login')"

  post_inline_comments "${pr_number}"

  if [[ -n "${PR_AUTHOR:-}" ]] && [[ "${PR_AUTHOR}" == "${current_user}" ]]; then
    gh pr comment "${pr_number}" --body-file "${REVIEW_MD_FILE}" >/dev/null
    return
  fi

  if [[ "${verdict}" == "APPROVE" ]]; then
    gh pr review "${pr_number}" --approve --body-file "${REVIEW_MD_FILE}" >/dev/null
  else
    gh pr review "${pr_number}" --request-changes --body-file "${REVIEW_MD_FILE}" >/dev/null
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
  local checks_file="${TMP_DIR}/checks.json"

  gh pr checks "${pr_number}" --required --json name,bucket,state,link > "${checks_file}"

  if [[ "$(jq 'length' "${checks_file}")" -eq 0 ]]; then
    return 0
  fi

  jq -e 'all(.[]; .bucket == "pass")' "${checks_file}" >/dev/null 2>&1
}

merge_if_safe() {
  local pr_number="$1"
  local delete_branch="$2"
  local safe_to_merge
  local verdict
  local mergeable
  local is_draft

  verdict="$(jq -r '.verdict' "${RESULT_FILE}")"
  safe_to_merge="$(jq -r '.safe_to_merge' "${RESULT_FILE}")"
  mergeable="$(jq -r '.mergeable' "${META_FILE}")"
  is_draft="$(jq -r '.isDraft' "${META_FILE}")"

  [[ "${is_draft}" == "false" ]] || die "PR 仍是 Draft，拒绝合并。"
  [[ "${verdict}" == "APPROVE" ]] || die "Codex 审查未批准，拒绝合并。"
  [[ "${safe_to_merge}" == "true" ]] || die "审查结果认为当前 PR 不安全，拒绝合并。"
  [[ "${mergeable}" == "MERGEABLE" ]] || die "GitHub 判定当前 PR 不可合并，状态为: ${mergeable}"

  if ! all_required_checks_pass "${pr_number}"; then
    die "必需状态检查尚未全部通过，拒绝合并。"
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

  if [[ "${post_review_flag}" == "1" ]]; then
    post_review "${pr_number}"
    echo "已回写 PR review。"
  fi

  if [[ "${mode}" == "merge-if-safe" ]]; then
    merge_if_safe "${pr_number}" "${delete_branch_flag}"
  fi
}

main "$@"
