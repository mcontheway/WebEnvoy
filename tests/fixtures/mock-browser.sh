#!/usr/bin/env bash

set -euo pipefail

if [[ -n "${WEBENVOY_BROWSER_MOCK_LOG:-}" ]]; then
  printf '{"pid":%d,"args":"%s"}\n' "$$" "$*" >> "${WEBENVOY_BROWSER_MOCK_LOG}"
fi

ttl="${WEBENVOY_BROWSER_MOCK_TTL:-2}"
trap 'exit 0' TERM INT
sleep "${ttl}" &
wait $!
