# Security review: Publisher Feed Generator 0.9.2

Date: 2026-11-27. Requested by the owner. Read-only code review; no code was changed and nothing was run against a live site. Severity is the reviewer's judgment. Each finding has a TODO item (numbers in brackets); none is implemented yet.

## Scope

Read in full: `class-pfg-auth.php`, `class-pfg-nostr.php`, `class-pfg-rest.php`, `class-pfg-lookup.php`, `class-pfg-storage.php`, `class-pfg-xml.php`, `class-pfg-admin.php`, `class-pfg-installer.php`, `class-pfg-settings.php` (sanitiser), `class-pfg-shortcode.php`, the main plugin file, `uninstall.php`, and the DOM/storage code paths of `pfg-app.js`, `pfg-hosting.js`, `pfg-editor.js` and `pfg-core.js` (searched for `innerHTML`, `eval`, storage, navigation, and attribute handling).

Read in part: `class-pfg-feed.php` (URL, control-character and `attrs` validation only).

Not reviewed: the bundled `nostr-bundle.js` (third-party, minified), the web-server configuration, other plugins and the theme. Not tested dynamically.

## Summary

No critical or remotely exploitable flaw was found. The main risks are around the browser-key model: a stolen browser key can be turned into a payment-capable account (67), and the key sits in plaintext in `localStorage` (68).

## Findings

### Medium
- **67. Browser-key payment lock bypass via `/me/upgrade`.** The account `kind` comes from the client's `browserKey` flag at first login. The holder of the browser key plus any signer key of their own can upgrade the account to `signer` and then change payments. Fix: a cool-down after an upgrade before payment changes, with a notice (email or admin-visible); or send the first payment change after an upgrade through the `require_approval` queue.
- **68. Browser private key in plaintext `localStorage`** (`pfg-hosting.js`, `LOCAL_KEY`). Any XSS on the site origin (including from a theme or other plugin) can read it. Fix: optional passphrase / WebCrypto-wrapped storage; strict Content-Security-Policy on the generator page.

### Low to Medium
- **69. REST CORS.** WordPress reflects `Origin` with credentials on REST routes. `SameSite=Strict` mostly protects the cookie, but a same-site sibling subdomain could read `GET /me`, which returns the CSRF token. Fix: restrict CORS on `pfg/v1` to the site origin.
- **70. `/lookup/feed` is a general content relay.** Any https URL, up to 2 MB, returned raw even if not XML (20 requests per 5 minutes). `wp_safe_remote_get` blocks private addresses, but DNS rebinding leaves a small window. Fix: require an XML-looking body and an XML/text content type.
- **71. Signature check before nonce check on `/auth/login`.** The pure-PHP GMP Schnorr verification is CPU heavy on an unauthenticated endpoint (10 requests per 10 minutes per IP). Fix: check the nonce exists and is unexpired first; consume it only after the signature verifies.

### Low
- **72.** Cookie `Secure` depends on `is_ssl()` (false behind some proxies); no `__Host-` prefix.
- **73.** `trust_cf_ip` allows forged client IPs unless the origin accepts only Cloudflare traffic; behind any other proxy all users share one IP and one rate-limit bucket.
- **74.** Transient-based rate limiter is not atomic and creates one option row per IP.
- **75.** Check-then-insert race on the max-feeds-per-account count. Slug and GUID already have unique DB keys, so duplicates are rejected.
- **76.** Leftover `.pfg` temp files if a feed write fails part-way.
- **77.** The suspended-feeds folder relies on `.htaccess` (ignored by nginx); the HMAC-derived names are the real protection.
- **78.** Search amplification: up to 9 outbound Music Index calls per search; `details_for_guid` 404s are not cached.

## Confirmed good

- Nonces are hashed, single-use and consumed with an atomic `DELETE`. Session tokens are stored hashed. CSRF is checked with `hash_equals` on every non-GET request; JSON content type is enforced.
- NIP-98 validation covers kind, 60-second window, URL, method, payload hash and nonce; signatures are BIP-340 verified. Fresh signatures are required for payment changes, deletes, moves and upgrades.
- Slug regex plus `realpath` checks prevent path traversal; writes use a temp file and rename. `newFeedUrl` can only be set through the Move route.
- SQL is prepared throughout; the schema has unique keys on account pubkey, session token, slug and GUID. XML is parsed with `LIBXML_NONET`.
- Admin handlers check `manage_options` and a nonce, use `wp_safe_redirect`, have no `nopriv` actions, and escape all output (`esc_html`, `esc_attr`, `esc_url`).
- Feed XML: text and attribute escaping is correct; control characters are stripped on input; URL fields are validated with an `https` regex; hosted `allow_attrs` is `false` and attribute names are regex-checked anyway.
- Shortcode config JSON is emitted with the `JSON_HEX_*` flags, so it cannot close its script tag.
- Front-end JS builds DOM with `createElement` / `textContent`. The only `innerHTML` is the locally generated QR SVG. No `eval`, `document.write` or `javascript:` URLs. Server-supplied image and link URLs are https-checked on the server.
- Settings: relays, addresses, numbers and role words are strictly sanitised; uninstall removes data only when ticked.
