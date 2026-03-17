#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GUARDIAN_SCRIPT="${REPO_ROOT}/scripts/pr-guardian.sh"
CODEX_ROOT="${CODEX_HOME:-${HOME}/.codex}"
STATE_DIR="${CODEX_ROOT}/state"
DEFAULT_STATE_FILE="${STATE_DIR}/webenvoy-pr-review.json"

usage() {
  cat <<'EOF'
用法:
  scripts/pr-review-poller.sh [--dry-run] [--state-file <path>] [--no-post-review] [--base-branch <name>]

说明:
  检查当前仓库开放 PR 的最新 head SHA。
  默认只检查目标分支为 main 的 PR。
  只有当某个 PR 自上次审查后出现新提交时，才触发一次 review。
  如果没有开放 PR、目标分支不存在，或所有匹配 PR 都没有新提交，则直接结束。
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

ensure_state_file() {
  local state_file="$1"
  local state_dir

  state_dir="$(dirname "${state_file}")"
  mkdir -p "${state_dir}"

  if [[ ! -f "${state_file}" ]]; then
    printf '{\n  "prs": {}\n}\n' > "${state_file}"
  fi
}

load_open_prs() {
  gh pr list --state open --json number,title,headRefOid,author,isDraft,url,baseRefName
}

branch_exists() {
  local branch_name="$1"

  git ls-remote --exit-code --heads origin "${branch_name}" >/dev/null 2>&1
}

update_state() {
  local state_file="$1"
  local pr_number="$2"
  local head_sha="$3"
  local repo_slug="$4"
  local reviewed_at
  local tmp_file

  reviewed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/webenvoy-pr-state.XXXXXX")"

  jq \
    --arg repo "${repo_slug}" \
    --arg pr "${pr_number}" \
    --arg sha "${head_sha}" \
    --arg reviewed_at "${reviewed_at}" \
    '
      .repo = $repo
      | .prs[$pr] = {
          head_sha: $sha,
          reviewed_at: $reviewed_at
        }
    ' "${state_file}" > "${tmp_file}"

  mv "${tmp_file}" "${state_file}"
}

review_pr() {
  local pr_number="$1"
  local post_review="$2"

  if [[ "${post_review}" == "1" ]]; then
    "${GUARDIAN_SCRIPT}" review "${pr_number}" --post-review
  else
    "${GUARDIAN_SCRIPT}" review "${pr_number}"
  fi
}

main() {
  local dry_run=0
  local post_review=1
  local state_file="${DEFAULT_STATE_FILE}"
  local base_branch="${WEBENVOY_PR_BASE_BRANCH:-main}"
  local repo_slug
  local prs_json
  local pr_count
  local reviewed_count=0
  local skipped_count=0

  require_cmd gh
  require_cmd git
  require_cmd jq
  require_cmd date
  [[ -x "${GUARDIAN_SCRIPT}" ]] || die "缺少可执行审查脚本: ${GUARDIAN_SCRIPT}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        dry_run=1
        ;;
      --no-post-review)
        post_review=0
        ;;
      --state-file)
        shift
        [[ $# -gt 0 ]] || die "--state-file 需要一个路径参数"
        state_file="$1"
        ;;
      --base-branch)
        shift
        [[ $# -gt 0 ]] || die "--base-branch 需要一个分支名"
        base_branch="$1"
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "未知参数: $1"
        ;;
    esac
    shift
  done

  check_gh_auth
  ensure_state_file "${state_file}"

  repo_slug="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"

  if ! branch_exists "${base_branch}"; then
    echo "目标分支 ${base_branch} 尚不存在，跳过本次自动 review。"
    exit 0
  fi

  prs_json="$(load_open_prs)"
  pr_count="$(jq 'length' <<< "${prs_json}")"

  if [[ "${pr_count}" -eq 0 ]]; then
    echo "当前没有开放 PR，本次自动化结束。"
    exit 0
  fi

  while IFS= read -r pr_row; do
    local pr_number
    local pr_title
    local head_sha
    local is_draft
    local pr_base_ref
    local previous_sha

    pr_number="$(jq -r '.number' <<< "${pr_row}")"
    pr_title="$(jq -r '.title' <<< "${pr_row}")"
    head_sha="$(jq -r '.headRefOid' <<< "${pr_row}")"
    is_draft="$(jq -r '.isDraft' <<< "${pr_row}")"
    pr_base_ref="$(jq -r '.baseRefName' <<< "${pr_row}")"
    previous_sha="$(jq -r --arg pr "${pr_number}" '.prs[$pr].head_sha // ""' "${state_file}")"

    if [[ "${pr_base_ref}" != "${base_branch}" ]]; then
      echo "跳过目标分支不是 ${base_branch} 的 PR #${pr_number}: ${pr_title} (base=${pr_base_ref})"
      skipped_count=$((skipped_count + 1))
      continue
    fi

    if [[ "${is_draft}" == "true" ]]; then
      echo "跳过 Draft PR #${pr_number}: ${pr_title}"
      skipped_count=$((skipped_count + 1))
      continue
    fi

    if [[ -n "${previous_sha}" && "${previous_sha}" == "${head_sha}" ]]; then
      echo "跳过未更新 PR #${pr_number}: ${pr_title}"
      skipped_count=$((skipped_count + 1))
      continue
    fi

    if [[ "${dry_run}" == "1" ]]; then
      echo "Dry run: 将审查 PR #${pr_number}: ${pr_title}"
      reviewed_count=$((reviewed_count + 1))
      continue
    fi

    echo "开始审查 PR #${pr_number}: ${pr_title}"
    review_pr "${pr_number}" "${post_review}"
    update_state "${state_file}" "${pr_number}" "${head_sha}" "${repo_slug}"
    reviewed_count=$((reviewed_count + 1))
  done < <(jq -c '.[]' <<< "${prs_json}")

  if [[ "${reviewed_count}" -eq 0 ]]; then
    echo "没有发现需要重新审查的 PR，本次自动化结束。"
  else
    echo "本次自动化完成：新审查 ${reviewed_count} 个 PR，跳过 ${skipped_count} 个 PR。"
  fi
}

main "$@"
