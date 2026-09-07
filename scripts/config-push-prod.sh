#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Push supabase/config.toml to PRODUCTION, then repair the two fields that
# `config push` gets wrong there (plan-hosted-early-access.md D5, Phase 2
# task 8).
#
# WHY THIS EXISTS — verified on 2026-09-07, not assumed: the
# `[remotes.production]` block in config.toml is INERT for this org. Supabase
# documents `[remotes.*]` as a branching feature, and `sl-fake-bets` is an
# independent project rather than a persistent branch of `sl-fake-bets-dev`,
# so `supabase config push --project-ref <prod-ref>` silently ignores the
# override and pushes the BASE config: prod ends up with
# `site_url = http://localhost:3000` and the DEV Google client. That was
# observed on the wire, then corrected with the PATCH below. A bare
# `config push` at prod is therefore never the right command — this script is.
#
# Everything the two projects legitimately share (the redirect allow-list,
# confirm-email off, minimum password length, email provider on) comes from
# the base config.toml and is identical on both by construction.
# =============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for f in .env.ops supabase/.env; do
  if [[ ! -f "$f" ]]; then
    echo "config-push-prod: $f not found — nothing to push with. Aborting." >&2
    exit 1
  fi
done

set -a
# shellcheck disable=SC1091
source .env.ops
# shellcheck disable=SC1091
source supabase/.env
set +a

for v in SUPABASE_ACCESS_TOKEN SUPABASE_PROD_PROJECT_REF NEXT_PUBLIC_SITE_URL \
         SUPABASE_AUTH_EXTERNAL_GOOGLE_PROD_CLIENT_ID SUPABASE_AUTH_EXTERNAL_GOOGLE_PROD_SECRET; do
  if [[ -z "${!v:-}" ]]; then
    echo "config-push-prod: $v is not set (.env.ops / supabase/.env). Aborting." >&2
    exit 1
  fi
done

# Same guard as db-push-prod.sh, for the same reason (D3): if the repo is
# linked to prod, every other bare command has quietly started pointing there.
LINKED_REF_FILE="supabase/.temp/project-ref"
if [[ -f "$LINKED_REF_FILE" && "$(cat "$LINKED_REF_FILE")" == "$SUPABASE_PROD_PROJECT_REF" ]]; then
  echo "config-push-prod: the repo is currently LINKED TO PROD. Re-link to dev first. Aborting." >&2
  exit 1
fi

echo "=================================================================="
echo " Target (PRODUCTION): $SUPABASE_PROD_PROJECT_REF"
echo " site_url will be set to: $NEXT_PUBLIC_SITE_URL"
echo "=================================================================="
echo

supabase config push --project-ref "$SUPABASE_PROD_PROJECT_REF"

echo
echo "Repairing prod-only auth fields (site_url + production Google client) ..."
BODY="$(SITE_URL="$NEXT_PUBLIC_SITE_URL" \
        CID="$SUPABASE_AUTH_EXTERNAL_GOOGLE_PROD_CLIENT_ID" \
        CSECRET="$SUPABASE_AUTH_EXTERNAL_GOOGLE_PROD_SECRET" \
        python3 -c 'import json,os; print(json.dumps({
  "site_url": os.environ["SITE_URL"],
  "external_google_enabled": True,
  "external_google_client_id": os.environ["CID"],
  "external_google_secret": os.environ["CSECRET"],
  "external_google_skip_nonce_check": False,
}))')"

curl -sS -X PATCH "https://api.supabase.com/v1/projects/$SUPABASE_PROD_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); [print(f"  {k} = {d.get(k)!r}") for k in ["site_url","uri_allow_list","mailer_autoconfirm","external_email_enabled","password_min_length","external_google_enabled","external_google_client_id","external_google_skip_nonce_check"]]'
