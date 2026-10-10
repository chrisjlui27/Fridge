#!/usr/bin/env bash
# Vercel's build command (set in vercel.json).
#
# Production (main): deploy the Convex backend, then build the app against it.
# Previews: same, if Preview has a *test* backend key (dev:/preview:).
# Otherwise the preview builds the app without a backend, so the check stays
# green and the preview page explains what's missing. A preview never uses
# the production key (Convex refuses that anyway).
set -euo pipefail

key="${CONVEX_DEPLOY_KEY:-}"
kind="${key%%:*}"

if [ "${VERCEL_ENV:-}" = "production" ] || { [ -n "$key" ] && [ "$kind" != "prod" ]; }; then
  exec npx convex deploy --cmd "npm run build"
fi

echo "Preview without a test backend key: building the app only (see docs/updating.md)."
VITE_PREVIEW_NO_BACKEND=1 npm run build
