#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_TEMPLATE="${REPO_ROOT}/.github/PULL_REQUEST_TEMPLATE.md"
PURITY_GUARD="${REPO_ROOT}/scripts/check-pr-purity.sh"

usage() {
  cat <<'EOF'
用法:
  scripts/open-pr.sh [--issue <number>] [--title <title>] [--base <branch>] [--draft] [--closing <fixes|refs|none>]

说明:
  基于当前分支自动生成 PR 标题和描述，并通过 GitHub REST 创建 PR。
  默认 base 分支为 main，默认标题取最近一次提交信息。
  默认关闭语义为 `fixes`；如当前 PR 不应关闭 issue，请显式传 `--closing refs` 或 `--closing none`。
  创建 PR 前会执行分支纯度门禁（分支前缀与变更文件类别一致性）。
EOF
}

die() {
  echo "错误: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少依赖命令: $1"
}

current_branch() {
  git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD
}

ensure_not_main_branch() {
  local branch="$1"
  [[ "${branch}" != "main" ]] || die "当前分支是 main，请切到独立分支后再创建 PR。"
}

check_gh_auth() {
  if ! gh api user --jq '.login' >/dev/null 2>&1; then
    die "GitHub CLI 未登录或凭证失效，请先执行 gh auth login"
  fi
}

repository_slug() {
  local origin_url=""

  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    printf '%s\n' "${GITHUB_REPOSITORY}"
    return 0
  fi

  origin_url="$(git -C "${REPO_ROOT}" remote get-url origin 2>/dev/null || true)"
  if [[ "${origin_url}" =~ ^https://github\.com/([^/]+/[^/]+)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]%.git}"
    return 0
  fi
  if [[ "${origin_url}" =~ ^git@github\.com:([^/]+/[^/]+)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]%.git}"
    return 0
  fi
  if [[ "${origin_url}" =~ ^ssh://git@github\.com/([^/]+/[^/]+)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]%.git}"
    return 0
  fi

  die "无法从 origin remote 推导 GitHub repo slug，请设置 GITHUB_REPOSITORY=owner/repo 后重试。"
}

ensure_remote_branch_exists() {
  local branch="$1"
  local local_head
  local remote_head

  remote_head="$(git -C "${REPO_ROOT}" ls-remote --exit-code origin "refs/heads/${branch}" 2>/dev/null | awk 'NR == 1 { print $1 }')" \
    || die "origin/${branch} 不存在；请先 push 当前分支后再创建 PR。"
  [[ -n "${remote_head}" ]] || die "origin/${branch} 不存在；请先 push 当前分支后再创建 PR。"

  local_head="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
  [[ "${remote_head}" == "${local_head}" ]] \
    || die "origin/${branch} 尚未更新到当前 HEAD；请先 push 当前分支后再创建 PR。"
}

latest_commit_subject() {
  git -C "${REPO_ROOT}" log -1 --pretty=%s
}

list_changed_files() {
  local base_branch="$1"
  git -C "${REPO_ROOT}" fetch origin "${base_branch}" >/dev/null 2>&1 || true
  git -C "${REPO_ROOT}" diff --name-only "origin/${base_branch}...HEAD"
}

detect_risk_level() {
  local base_branch="$1"
  local files

  files="$(list_changed_files "${base_branch}")"

  if [[ -z "${files}" ]]; then
    echo "normal|未检测到相对 ${base_branch} 的变更文件，按普通改动处理。"
    return
  fi

  if grep -Eq '^(vision\.md|AGENTS\.md|code_review\.md|docs/dev/architecture/|docs/dev/specs/|\.github/workflows/|scripts/|\.githooks/)' <<< "${files}"; then
    echo "high|变更涉及正式契约、架构/流程基线或高风险目录。"
    return
  fi

  if grep -Evq '(^docs/archive/|\.md$)' <<< "${files}"; then
    echo "normal|变更包含非 Markdown 文件，按普通改动处理。"
    return
  fi

  echo "lightweight|仅检测到非契约性 Markdown 变更，可按轻量改动通道准备材料。"
}

build_changed_files_block() {
  local base_branch="$1"
  local files

  files="$(list_changed_files "${base_branch}")"
  if [[ -z "${files}" ]]; then
    printf '%s\n' '- 无'
    return
  fi

  while IFS= read -r file; do
    [[ -n "${file}" ]] || continue
    printf -- '- `%s`\n' "${file}"
  done <<< "${files}"
}

build_verification_block() {
  local risk_level="$1"

  if [[ "${risk_level}" == "lightweight" ]]; then
    cat <<'EOF'
- 已执行：`bash scripts/docs-guard.sh`
- 未执行：自动化行为测试（本次未涉及运行时行为变更）
EOF
    return
  fi

  cat <<'EOF'
- 已执行：
- 未执行：
EOF
}

build_body() {
  local template_file="$1"
  local issue_number="$2"
  local base_branch="$3"
  local risk_level="$4"
  local risk_reason="$5"
  local closing_mode="$6"
  local tmp_file="$7"
  local issue_line="无"
  local closing_line="无"

  if [[ -n "${issue_number}" ]]; then
    issue_line="#${issue_number}"
    case "${closing_mode}" in
      fixes)
        closing_line="Fixes #${issue_number}"
        ;;
      refs)
        closing_line="Refs #${issue_number}"
        ;;
      none)
        closing_line="无"
        ;;
    esac
  fi

  cp "${template_file}" "${tmp_file}"

  PR_ISSUE="${issue_line}" \
  PR_CLOSING="${closing_line}" \
  PR_RISK_LEVEL="${risk_level}" \
  PR_RISK_REASON="${risk_reason}" \
  PR_ROLLBACK="如需撤回，执行对应的 revert PR 或回退本 PR 引入的提交。" \
    perl -0pi -e '
      s/\{\{ISSUE\}\}/$ENV{"PR_ISSUE"}/g;
      s/\{\{CLOSING\}\}/$ENV{"PR_CLOSING"}/g;
      s/\{\{RISK_LEVEL\}\}/$ENV{"PR_RISK_LEVEL"}/g;
      s/\{\{RISK_REASON\}\}/$ENV{"PR_RISK_REASON"}/g;
      s/\{\{ROLLBACK\}\}/$ENV{"PR_ROLLBACK"}/g;
    ' "${tmp_file}"

  {
    printf '\n## 变更文件\n\n'
    build_changed_files_block "${base_branch}"
    printf '\n## 自动生成的验证建议\n\n'
    build_verification_block "${risk_level}"
  } >> "${tmp_file}"
}

main() {
  local issue_number=""
  local title=""
  local base_branch="main"
  local draft=0
  local closing_mode="fixes"
  local branch
  local risk_info
  local risk_level
  local risk_reason
  local tmp_body
  local payload_file
  local pr_response_file

  require_cmd git
  require_cmd gh
  require_cmd jq
  require_cmd perl

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --issue)
        shift
        [[ $# -gt 0 ]] || die "--issue 需要一个编号"
        issue_number="$1"
        ;;
      --title)
        shift
        [[ $# -gt 0 ]] || die "--title 需要一个标题"
        title="$1"
        ;;
      --base)
        shift
        [[ $# -gt 0 ]] || die "--base 需要一个分支名"
        base_branch="$1"
        ;;
      --draft)
        draft=1
        ;;
      --closing)
        shift
        [[ $# -gt 0 ]] || die "--closing 需要一个取值"
        closing_mode="$1"
        case "${closing_mode}" in
          fixes|refs|none)
            ;;
          *)
            die "--closing 仅支持 fixes|refs|none"
            ;;
        esac
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

  [[ -f "${DEFAULT_TEMPLATE}" ]] || die "缺少 PR 模板: ${DEFAULT_TEMPLATE}"
  [[ -x "${PURITY_GUARD}" ]] || die "缺少可执行门禁脚本: ${PURITY_GUARD}"
  check_gh_auth

  branch="$(current_branch)"
  ensure_not_main_branch "${branch}"
  ensure_remote_branch_exists "${branch}"
  "${PURITY_GUARD}" "${branch}" "${base_branch}"

  if [[ -z "${title}" ]]; then
    title="$(latest_commit_subject)"
  fi

  risk_info="$(detect_risk_level "${base_branch}")"
  risk_level="${risk_info%%|*}"
  risk_reason="${risk_info#*|}"

  tmp_body="$(mktemp "${TMPDIR:-/tmp}/webenvoy-pr-body.XXXXXX")"
  # Capture the resolved temp path now; EXIT runs after local variables go out of scope.
  trap "rm -f '${tmp_body}'" EXIT

  build_body "${DEFAULT_TEMPLATE}" "${issue_number}" "${base_branch}" "${risk_level}" "${risk_reason}" "${closing_mode}" "${tmp_body}"

  payload_file="$(mktemp "${TMPDIR:-/tmp}/webenvoy-pr-create-payload.XXXXXX")"
  pr_response_file="$(mktemp "${TMPDIR:-/tmp}/webenvoy-pr-create-response.XXXXXX")"
  trap "rm -f '${tmp_body}' '${payload_file}' '${pr_response_file}'" EXIT

  jq -n \
    --arg title "${title}" \
    --arg head "${branch}" \
    --arg base "${base_branch}" \
    --arg body "$(cat "${tmp_body}")" \
    --argjson draft "${draft}" \
    '{title: $title, head: $head, base: $base, body: $body, draft: ($draft == 1)}' > "${payload_file}"

  gh api \
    --method POST \
    -H "Accept: application/vnd.github+json" \
    "repos/$(repository_slug)/pulls" \
    --input "${payload_file}" > "${pr_response_file}"

  jq -r '.html_url // .url' "${pr_response_file}"
}

main "$@"
