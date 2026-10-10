#!/usr/bin/env bash
# Vercel runs this before every build ("Ignored Build Step").
# Exit 0 = skip this build. Exit 1 = go ahead and build.
#
# The rule: only the `main` branch may deploy to Production (your family's
# live app and its real Convex backend). Every other branch gets a Preview.

if [ "$VERCEL_ENV" = "production" ] && [ "$VERCEL_GIT_COMMIT_REF" != "main" ]; then
  echo "Skipping: production deploys only come from main (this is '$VERCEL_GIT_COMMIT_REF')."
  echo "In Vercel, set Settings > Environments > Production > Branch Tracking to 'main'."
  exit 0
fi

echo "Building $VERCEL_ENV from '$VERCEL_GIT_COMMIT_REF'."
exit 1
