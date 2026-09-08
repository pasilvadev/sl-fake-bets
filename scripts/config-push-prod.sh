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

# Bare `mktemp`, no `-t`: BSD mktemp treats the argument as a prefix, GNU
# mktemp demands an XXXXXX template and errors out on one without it.
RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

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

# The PATCH is checked, not assumed. Without this the failure mode is silent
# and bad: `config push` above has ALREADY overwritten prod's site_url with
# `http://localhost:3000` and the DEV Google client (that is the whole reason
# this script exists), so a rejected PATCH — expired access token, wrong ref,
# a 4xx on one field — leaves production auth pointing at a developer's laptop
# with an exit code of 0 and a table of `None`s that reads like output. Status
# code first, then the fields, and a non-2xx aborts loudly while the operator
# is still watching.
HTTP_STATUS="$(curl -sS -X PATCH "https://api.supabase.com/v1/projects/$SUPABASE_PROD_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -o "$RESPONSE_FILE" \
  -w '%{http_code}')"

if [[ "$HTTP_STATUS" != 2* ]]; then
  echo >&2
  echo "config-push-prod: the auth PATCH FAILED (HTTP $HTTP_STATUS)." >&2
  echo "PROD AUTH IS NOW WRONG: the config push above set site_url to the base" >&2
  echo "config's http://localhost:3000 and the DEV Google client. Fix the cause" >&2
  echo "and re-run this script before anyone tries to sign in on production." >&2
  echo "Response body:" >&2
  cat "$RESPONSE_FILE" >&2
  echo >&2
  exit 1
fi

python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); [print(f"  {k} = {d.get(k)!r}") for k in ["site_url","uri_allow_list","mailer_autoconfirm","external_email_enabled","password_min_length","external_google_enabled","external_google_client_id","external_google_skip_nonce_check"]]' "$RESPONSE_FILE"

# Belt-and-braces on the one field whose wrong value is silently survivable:
# a 2xx that somehow did not take `site_url` still breaks every OAuth return
# leg on prod, and the operator should not have to spot that in the table.
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get("site_url") == sys.argv[2] else 1)' \
  "$RESPONSE_FILE" "$NEXT_PUBLIC_SITE_URL" || {
  echo >&2
  echo "config-push-prod: the PATCH returned 2xx but site_url is NOT" >&2
  echo "$NEXT_PUBLIC_SITE_URL. Prod auth is wrong — investigate before sign-in." >&2
  exit 1
}
