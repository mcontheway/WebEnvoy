#!/usr/bin/env bash

set -euo pipefail

user_data_dir=""
for arg in "$@"; do
  case "$arg" in
    --user-data-dir=*)
      user_data_dir="${arg#--user-data-dir=}"
      ;;
  esac
done

if [[ -n "$user_data_dir" ]]; then
  mkdir -p "$user_data_dir/Default"
  printf '{}' > "$user_data_dir/Local State"
  printf '{}' > "$user_data_dir/Default/Preferences"
fi

if [[ -n "${WEBENVOY_BROWSER_MOCK_LOG:-}" ]]; then
  printf '{"pid":%d,"args":"%s"}\n' "$$" "$*" >> "${WEBENVOY_BROWSER_MOCK_LOG}"
fi

ttl="${WEBENVOY_BROWSER_MOCK_TTL:-2}"
trap 'exit 0' TERM INT
sleep "${ttl}" &
wait $!
