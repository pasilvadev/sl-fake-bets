#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# The ONLY script that may ever push to prod (plan-hosted-early-access.md D3).
#
# Every bare `supabase db push` / `db reset` / `config push` / `migration list`
# in this repo lands on DEV, because the CLI is linked to dev's ref, forever
# (`supabase/.temp/project-ref` — see supabase/README.md's first screen). This
# script is the one deliberate exception, and every check below exists because
# of one fact from §2.3: the CLI's own `db reset` confirmation prompt does not
# NAME the project it is about to erase, so nothing here may rely on a person
# reading a prompt correctly under time pressure. Confirmation is a typed
# word, checked in bash, not a bare `[y/N]` the CLI itself renders.
#
# No script, alias or doc may ever put a prod ref or a prod connection string
# next to `db reset` or `--include-seed` (D3) — this file does not contain
# either token, on purpose, and never should.
# =============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env.ops ]]; then
  echo "db-push-prod: .env.ops not found at the repo root — nothing to push with. Aborting." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.ops
set +a

if [[ -z "${SUPABASE_PROD_PROJECT_REF:-}" ]]; then
  echo "db-push-prod: SUPABASE_PROD_PROJECT_REF is not set in .env.ops. Aborting." >&2
  exit 1
fi

if [[ -z "${SUPABASE_PROD_DB_PASSWORD:-}" ]]; then
  echo "db-push-prod: SUPABASE_PROD_DB_PASSWORD is not set in .env.ops. Aborting." >&2
  exit 1
fi

# Belt-and-braces against the one mistake that would defeat this whole script:
# someone typing `supabase link --project-ref <prod-ref>`. D3 says the repo is
# linked to dev forever — if the linked ref is ever the prod ref, every OTHER
# bare command in this repo (db push --linked, db reset --linked) has quietly
# started pointing at prod too, which is a strictly worse problem than this
# one push. Refuse and say so, rather than proceed as if it were fine.
LINKED_REF_FILE="supabase/.temp/project-ref"
if [[ -f "$LINKED_REF_FILE" ]]; then
  LINKED_REF="$(cat "$LINKED_REF_FILE")"
  if [[ "$LINKED_REF" == "$SUPABASE_PROD_PROJECT_REF" ]]; then
    echo "db-push-prod: the repo is currently LINKED TO PROD ($LINKED_REF)." >&2
    echo "That must never happen (D3: the CLI stays linked to dev). Re-link to dev" >&2
    echo "(supabase link --project-ref \"\$SUPABASE_DEV_PROJECT_REF\" -p ...) before doing anything else. Aborting." >&2
    exit 1
  fi
fi

echo "=================================================================="
echo " Target (PRODUCTION): $SUPABASE_PROD_PROJECT_REF"
echo "=================================================================="
echo
echo "Pending migrations (dry run — nothing is applied yet):"
echo
supabase db push --project-ref "$SUPABASE_PROD_PROJECT_REF" -p "$SUPABASE_PROD_DB_PASSWORD" --dry-run
echo

read -r -p "Type 'prod' to push the migrations listed above to $SUPABASE_PROD_PROJECT_REF: " CONFIRM
if [[ "$CONFIRM" != "prod" ]]; then
  echo "db-push-prod: confirmation did not match 'prod'. Aborting — nothing was pushed." >&2
  exit 1
fi

echo
echo "Pushing to $SUPABASE_PROD_PROJECT_REF ..."
supabase db push --project-ref "$SUPABASE_PROD_PROJECT_REF" -p "$SUPABASE_PROD_DB_PASSWORD"
