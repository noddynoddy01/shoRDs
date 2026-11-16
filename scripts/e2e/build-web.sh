#!/usr/bin/env bash
# Builds the web app for the E2E harness with FAKE Firebase identifiers and the local harness backend. Output: $1 (default /tmp/shords-web-e2e)
set -euo pipefail
OUT="${1:-/tmp/shords-web-e2e}"
export EXPO_PUBLIC_API_URL="http://127.0.0.1:8787"
export EXPO_PUBLIC_FIREBASE_API_KEY="e2e-fake-api-key"
export EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN="e2e.invalid"
export EXPO_PUBLIC_FIREBASE_PROJECT_ID="shords-test-project"
export EXPO_PUBLIC_FIREBASE_APP_ID="1:0:web:e2e"
export EXPO_PUBLIC_CONTACT_EMAIL="hello@example.test"
rm -rf "$OUT"
npx expo export -p web --clear --output-dir "$OUT"
