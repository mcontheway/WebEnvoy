#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

die() {
  echo "错误: $*" >&2
  exit 1
}

list_changed_files() {
  local base_branch="$1"
  local committed=""

  git -C "${REPO_ROOT}" fetch origin "${base_branch}" >/dev/null 2>&1 || true
  if git -C "${REPO_ROOT}" rev-parse --verify "origin/${base_branch}" >/dev/null 2>&1; then
    committed="$(git -C "${REPO_ROOT}" diff --name-only "origin/${base_branch}...HEAD" 2>/dev/null || true)"
  fi

  # Purity gates should evaluate the actual PR payload only.
  printf '%s\n' "${committed}" | sed '/^$/d' | sort -u
}

print_violation() {
  local title="$1"
  local guidance="$2"
  local files="$3"

  {
    echo "错误: ${title}"
    echo "建议: ${guidance}"
    echo "冲突文件:"
    while IFS= read -r file; do
      [[ -n "${file}" ]] || continue
      echo "  - ${file}"
    done <<< "${files}"
  } >&2
}

list_matches() {
  local pattern="$1"
  local files="$2"

  grep -E "${pattern}" <<< "${files}" || true
}

main() {
  local branch="$1"
  local base_branch="$2"
  local files
  local conflicts=""
  local allowed_docs_pattern='^(AGENTS\.md$|code_review\.md$|spec_review\.md$|vision\.md$|\.github/PULL_REQUEST_TEMPLATE\.md$|docs/.*\.md$)'
  local docs_forbidden_pattern='^(\.github/workflows/|\.githooks/|scripts/|src/|tests/|dist/|extension/|bin/|package(-lock)?\.json$|tsconfig.*\.json$|pnpm-lock\.yaml$|yarn\.lock$|bun\.lockb$|[^/]+\.(ts|tsx|js|jsx|mjs|cjs|json|sql|sh)$)'
  local governance_pattern='^(vision\.md$|AGENTS\.md$|docs/dev/AGENTS\.md$|code_review\.md$|spec_review\.md$|docs/dev/architecture/|docs/dev/specs/|\.github/PULL_REQUEST_TEMPLATE\.md$)'
  local allowed_specs_todo_pattern='^docs/dev/specs/.+/TODO\.md$'
  local retrospective_pattern='^docs/dev/retrospectives/'

  [[ -n "${branch}" ]] || die "缺少分支名参数"
  [[ -n "${base_branch}" ]] || die "缺少 base 分支参数"

  if [[ "${branch}" == "main" ]]; then
    die "当前分支是 main，请切到独立分支后再创建 PR。"
  fi

  files="$(list_changed_files "${base_branch}")"
  [[ -n "${files}" ]] || return 0

  case "${branch}" in
    docs/*)
      conflicts="$(
        {
          list_matches '^(\.github/workflows/|\.githooks/|scripts/)' "${files}"
          grep -Ev "${allowed_docs_pattern}" <<< "${files}" | grep -E "${docs_forbidden_pattern}" || true
        } | sed '/^$/d' | sort -u
      )"
      if [[ -n "${conflicts}" ]]; then
        print_violation \
          "docs/ 分支只允许承载文档、治理基线或 retrospective 变更，当前混入了脚本或实现类文件。" \
          "把脚本/实现改动拆到独立 fix/ 或 feat/ 分支和 PR；当前 docs/ 分支只保留 markdown、治理基线文档和 PR 模板类文件。" \
          "${conflicts}"
        exit 1
      fi
      ;;
    fix/*)
      conflicts="$(
        {
          list_matches "${retrospective_pattern}" "${files}"
          list_matches "${governance_pattern}" "${files}" | grep -Ev "${allowed_specs_todo_pattern}" || true
        } | sed '/^$/d' | sort -u
      )"
      if [[ -n "${conflicts}" ]]; then
        print_violation \
          "fix/ 分支不允许混入 retrospective 或治理基线变更。" \
          "把治理/复盘文档拆到独立 docs/ 分支和 PR；fix/ 分支只保留缺陷或工具修复。" \
          "${conflicts}"
        exit 1
      fi
      ;;
    feat/*)
      conflicts="$(
        {
          list_matches "${retrospective_pattern}" "${files}"
          list_matches "${governance_pattern}" "${files}" | grep -Ev "${allowed_specs_todo_pattern}" || true
        } | sed '/^$/d' | sort -u
      )"
      if [[ -n "${conflicts}" ]]; then
        print_violation \
          "feat/ 分支不应混入 retrospective 或治理基线变更。" \
          "把治理/复盘类改动拆到独立 docs/ 分支和 PR；feature 分支只保留实现及其直接配套验证。" \
          "${conflicts}"
        exit 1
      fi
      ;;
  esac
}

main "${1:-}" "${2:-main}"
