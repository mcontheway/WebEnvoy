#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GUARDIAN_SCRIPT="${REPO_ROOT}/scripts/pr-guardian.sh"

usage() {
  cat <<'EOF'
用法:
  scripts/merge-pr.sh <pr-number> [--delete-branch]

说明:
  统一合并入口。默认会执行 guardian review 并回写 review 结果，
  只有在 guardian APPROVE、safe_to_merge=true 且 GitHub checks 全绿时才会 squash merge。
EOF
}

die() {
  echo "错误: $*" >&2
  exit 1
}

main() {
  local pr_number="${1:-}"
  local delete_branch_flag=0

  if [[ "${pr_number}" == "-h" || "${pr_number}" == "--help" ]]; then
    usage
    exit 0
  fi

  [[ -n "${pr_number}" ]] || {
    usage
    exit 1
  }

  shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --delete-branch)
        delete_branch_flag=1
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

  [[ -x "${GUARDIAN_SCRIPT}" ]] || die "缺少可执行脚本: ${GUARDIAN_SCRIPT}"

  if [[ "${delete_branch_flag}" == "1" ]]; then
    bash "${GUARDIAN_SCRIPT}" merge-if-safe "${pr_number}" --post-review --delete-branch
  else
    bash "${GUARDIAN_SCRIPT}" merge-if-safe "${pr_number}" --post-review
  fi
}

main "$@"
