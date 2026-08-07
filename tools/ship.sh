#!/usr/bin/env bash
#
# The only supported way to push.
#
# Twice now a push has gone out with a suite red, both times the same way: the
# gate ran in one shell invocation and the push ran in another, so nothing
# connected the two. A passing gate five minutes ago is not a passing gate.
#
# Here the push is physically unreachable unless every check above it exited 0
# in THIS process. `set -e` plus straight-line ordering is the whole mechanism -
# there is no flag to skip a step, because a skippable gate is not a gate.
#
#   ./tools/ship.sh "commit message"
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "usage: ./tools/ship.sh \"commit message\"" >&2
  exit 64
fi

# The floors come from the CI workflow, not from a copy kept here. Two
# hardcoded numbers drift, and the one that drifts down is always the local
# one - which would let a push pass a weaker gate than the one CI applies.
floor_for() {
  local suite="$1" n
  n=$(grep -oE "run-suite\.js ${suite} [0-9]+" .github/workflows/tests.yml | grep -oE '[0-9]+$' | head -1)
  if [ -z "$n" ]; then
    echo "could not read the ${suite} floor from .github/workflows/tests.yml" >&2
    exit 1
  fi
  echo "$n"
}

echo "== 1/11 no mutation marker or audit artifact =="
node tools/check-no-mutation-artifacts.js

# A guard nothing calls is indistinguishable from no guard, and the suite is
# green either way because it tests the function and not the path.
echo "== 2/11 every guard has a live caller =="
node tools/guard-wiring.js --strict

# A caller whose target is gone fails silently until someone clicks it.
echo "== 3/11 every frontend /api call has a route behind it =="
node tools/check-frontend-endpoints.js

# A write that cannot satisfy a live constraint is a guaranteed 500.
echo "== 4/11 every write can satisfy the live constraints, every input bounded =="
node tools/check-write-paths.js
node tools/check-query-bounds.js

echo "== 5/11 user-visible claims still match the code =="
node tools/check-landing-claims.js
node tools/check-plan-names.js
node tools/check-claim-tests.js
node tools/check-plain-language.js
node tools/check-mobile-claims.js
echo

echo "== 6/11 backend suite =="
node tools/run-suite.js backend "$(floor_for backend)"

echo "== 7/11 frontend suite =="
node tools/run-suite.js frontend "$(floor_for frontend)"

# And the endpoint tests have to be able to TELL. Each is re-run with its
# guard's call removed; one that stays green proves only that the route replies.
echo "== 8/11 endpoint guard tests go red when the guard is unwired =="
node tools/prove-endpoint-guards-red.js
node tools/check-mock-boundaries.js

# The gate ran ten stages of tests and a push that COULD NOT BUILD passed every
# one. Feature 4a's frontend never reached production: `next build` failed on an
# ESLint error, Railway kept serving the last good build, and nothing said so.
# Jest does not build. Only the build builds.
echo "== 9/11 the frontend actually builds =="
( cd frontend && npx next build >/tmp/hp-next-build.log 2>&1 ) || {
  echo "FRONTEND BUILD FAILED - this would deploy nothing and say nothing:"
  tail -25 /tmp/hp-next-build.log
  exit 1
}
echo "frontend builds"
echo

echo "== 10/11 commit =="
git add -A
# Nothing staged is not a failure - the gate still had to pass to get here.
if git diff --cached --quiet; then
  echo "nothing to commit"
else
  git commit -m "$1"
fi

# The tree must be clean at this point. A leftover mutation that the marker list
# does not know about would otherwise sit in the working tree while a green
# "shipped" scrolls past.
if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is dirty after commit - refusing to push" >&2
  git status --short >&2
  exit 1
fi

echo "== 11/11 push =="
git push

echo
echo "shipped: gate and push in one invocation"
