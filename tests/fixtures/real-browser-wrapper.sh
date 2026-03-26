#!/usr/bin/env bash
set -euo pipefail

REAL_CHROME_BIN="${WEBENVOY_REAL_CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
CDP_PORT="${WEBENVOY_TEST_CDP_PORT:-9222}"

if [[ ! -x "${REAL_CHROME_BIN}" ]]; then
  echo "WEBENVOY_REAL_CHROME_BIN is not executable: ${REAL_CHROME_BIN}" >&2
  exit 1
fi

has_debug_port=0
for arg in "$@"; do
  if [[ "${arg}" == --remote-debugging-port=* ]]; then
    has_debug_port=1
    break
  fi
done

if [[ "${has_debug_port}" -eq 1 ]]; then
  exec "${REAL_CHROME_BIN}" "$@"
fi

exec "${REAL_CHROME_BIN}" \
  "--remote-debugging-port=${CDP_PORT}" \
  "--remote-allow-origins=*" \
  "$@"
