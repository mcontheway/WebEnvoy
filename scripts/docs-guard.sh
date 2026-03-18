#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

die() {
  echo "错误: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少依赖命令: $1"
}

normalize_ref() {
  local base_file="$1"
  local raw_ref="$2"
  local base_dir

  raw_ref="${raw_ref%%#*}"
  raw_ref="${raw_ref%/}"

  [[ -n "${raw_ref}" ]] || return 0
  [[ "${raw_ref}" =~ ^https?:// ]] && return 0
  [[ "${raw_ref}" =~ ^mailto: ]] && return 0

  base_dir="$(cd "$(dirname "${base_file}")" && pwd)"

  if [[ "${raw_ref}" == ./* || "${raw_ref}" == ../* ]]; then
    printf '%s/%s\n' "${base_dir}" "${raw_ref}"
  elif [[ "${raw_ref}" == /* ]]; then
    printf '%s\n' "${raw_ref}"
  else
    printf '%s/%s\n' "${REPO_ROOT}" "${raw_ref}"
  fi
}

ensure_in_repo() {
  local resolved="$1"

  case "${resolved}" in
    "${REPO_ROOT}"|"${REPO_ROOT}"/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_cmd bash
require_cmd jq
require_cmd perl

echo "[docs-guard] 校验 shell 语法"
while IFS= read -r file; do
  bash -n "${file}"
done < <(find "${REPO_ROOT}/scripts" -maxdepth 1 -type f -name '*.sh' | sort)

echo "[docs-guard] 校验审查输出 Schema"
jq empty "${REPO_ROOT}/.codex/pr-review-result.schema.json" >/dev/null

echo "[docs-guard] 校验文档链接和路径引用"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/webenvoy-docs-guard.XXXXXX")"
trap 'rm -rf "${TMP_DIR}"' EXIT

DOC_LIST="${TMP_DIR}/docs.txt"
REFS="${TMP_DIR}/refs.tsv"
> "${REFS}"

git -C "${REPO_ROOT}" ls-files '*.md' ':!:docs/archive/**' \
  | sed "s#^#${REPO_ROOT}/#" \
  | sort > "${DOC_LIST}"

while IFS= read -r file; do
  perl -ne 'while (/\[[^\]]+\]\(([^)]+)\)/g) { print "$ARGV\t$1\n"; }' "${file}" >> "${REFS}"
  perl -ne 'while (/(?<![A-Za-z0-9._\/-])((?:docs\/[A-Za-z0-9._\/-]+(?:\.md|\/)|scripts\/[A-Za-z0-9._\/-]+\.sh|\.github\/workflows\/[A-Za-z0-9._\/-]+\.ya?ml|\.codex\/[A-Za-z0-9._\/-]+\.(?:json|md)|vision\.md|AGENTS\.md|code_review\.md))(?![A-Za-z0-9._\/-])/g) { print "$ARGV\t$1\n"; }' "${file}" >> "${REFS}"
done < "${DOC_LIST}"

if ! sort -u "${REFS}" | while IFS=$'\t' read -r file ref; do
  [[ -n "${ref}" ]] || continue
  [[ "${ref}" == *'*'* ]] && continue
  [[ "${ref}" == *'XXXX'* ]] && continue
  resolved="$(normalize_ref "${file}" "${ref}")"
  if [[ -n "${resolved}" ]] && ! ensure_in_repo "${resolved}"; then
    echo "[docs-guard] 越界引用: ${ref} (from ${file})" >&2
    exit 1
  fi
  if [[ -n "${resolved}" && ! -e "${resolved}" ]]; then
    echo "[docs-guard] 缺失引用: ${ref} (from ${file})" >&2
    exit 1
  fi
done; then
  die "存在失效文档引用"
fi

echo "[docs-guard] 完成"
