#!/usr/bin/env bash

set -euo pipefail

user_data_dir=""
is_version_probe="0"
for arg in "$@"; do
  case "$arg" in
    --version)
      is_version_probe="1"
      ;;
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

if [[ "$is_version_probe" == "1" ]]; then
  version="${WEBENVOY_BROWSER_MOCK_VERSION:-Chromium 146.0.0.0}"
  printf '%s\n' "$version"
  exit 0
fi

ttl="${WEBENVOY_BROWSER_MOCK_TTL:-2}"
trap 'exit 0' TERM INT
sleep "${ttl}" &
wait $!
