#!/usr/bin/env bash
# Runs every check. Needs: php (with gmp, pdo_sqlite), node 18+, and `npm install` in ../build first.
set -u
cd "$(dirname "$0")"
fail=0
step() { echo; echo "== $1"; shift; "$@" || fail=1; }
for f in ../plugin/*.php ../plugin/includes/*.php; do php -l "$f" >/dev/null || { echo "PHP syntax error: $f"; fail=1; }; done
for f in ../plugin/assets/js/pfg-*.js; do node --check "$f" || fail=1; done
step "Nostr crypto (BIP-340, NIP-98)" php test_nostr.php
step "JS builder vs PHP builder parity" bash -c "node run_js.cjs >/dev/null && php run_php.php >/dev/null && node compare.cjs"
step "Import/round-trip of pasted feeds + link checking" node test_import.cjs
step "Nostr profile mapping + relay lookup" node test_profile.cjs
step "Browser extension (NIP-07) sign-in" node test_extension.cjs
step "Editor helpers (feed name, roles, support splits)" node test_editor_features.cjs
step "App shell (jsdom)" node smoke_shell.cjs
step "Editor (jsdom)" node smoke_editor.cjs
step "REST/auth/storage integration (real PHP, sqlite, real signatures)" php integ.php
echo; [ $fail -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $fail
