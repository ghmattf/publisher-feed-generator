# Publisher Feed Generator: agent handoff

Read this first, then `docs/DECISIONS.md`. Together they are the full context a new agent needs.

## What this is
A WordPress plugin for phafe.com. One page (shortcode) where labels, studios, engineers, hosts and artists build **Podcasting 2.0 publisher feeds** (`podcast:medium` = `publisher`).
- **Anonymous mode:** create from scratch or paste existing publisher-feed XML, edit, download/copy. No login, nothing stored on the server.
- **Hosted mode:** sign in with a Nostr browser extension (NIP-07) or remote signer (NIP-46); the feed is hosted at `wp-content/uploads/rssfeed/publishers/{slug}/{slug}.xml` and can be edited later.
- Publisher feeds only. Not albums or tracks.

## Layout
- `plugin/` the WordPress plugin (this folder is what gets zipped and installed). Main file `publisher-feed-generator.php`.
  - `includes/` PHP: `settings`, `installer` (tables), `nostr` (bech32 + BIP-340 via GMP + NIP-98), `feed` (validate/normalize), `xml` (build), `storage` (files + DB), `auth` (nonces, sessions, CSRF, rate limit), `lookup` (server-side feed fetch + Music Index search), `rest` (routes, `pfg/v1`), `shortcode`, `admin`.
  - `assets/js/` `pfg-core.js` (pure logic, mirrors PHP), `pfg-hosting.js` (signer + REST client), `pfg-editor.js` (form), `pfg-app.js` (shell), `nostr-bundle.js` (**generated**, see `build/`).
- `tests/` all checks; run `tests/run-all.sh` (needs php with gmp + pdo_sqlite, node 18+, and `npm install` in `build/`).
- `build/` how `nostr-bundle.js` is produced (esbuild + nostr-tools).
- `docs/DECISIONS.md` decisions, assumptions, open items.

## Rules that must not be broken
1. **PHP and JS must produce byte-identical XML** and the same validation messages. Change `class-pfg-feed.php`/`class-pfg-xml.php` and `pfg-core.js` together; `tests/run-all.sh` has a parity check.
2. The server **never holds private keys**. Login and sensitive actions are NIP-98 signed events with a server-issued single-use nonce.
3. Payment-recipient changes and feed deletion need a **fresh signature** (HTTP 428 flow). Normal edits use the session.
4. Hosted output is stricter than anonymous output: unknown attributes and preserved extra XML are dropped; only anonymous exports round-trip unknown content.
5. "Support the developers" recipients (Phafe.com, musicindex.org, Podcastindex.org by default) are set in Settings. Creators may change only each one's split (0 to 99, 0 = leave out), in both modes. Names, addresses and types stay under the site's control: the server ignores any other address. Changing a support split needs a fresh NIP-98 signature (HTTP 428) like any payment change.
6. Anything fetched from a user-supplied URL goes through `wp_safe_remote_get` (https only, size/redirect limits). Never use plain `wp_remote_get` for user URLs.
7. Wrap `localStorage`/`sessionStorage` use in try/catch.
8. Do not add features listed as out of scope in `docs/DECISIONS.md` without asking the owner.
9. **Never bump the major version number (for example to 1.0.0) without the owner's explicit approval.** Current version is 0.2.0; use minor/patch bumps. Keep `Version:` and `PFG_VERSION` in `plugin/publisher-feed-generator.php` and `Stable tag` in `plugin/readme.txt` in step.

## Verify before you say it works
Run `tests/run-all.sh`. It runs the real PHP classes against SQLite with real Nostr signatures, and the JS in jsdom. It does **not** run a real WordPress, a real signer app, or the live Music Index API; say so when reporting.

## Working style the owner wants
- Break larger work into small chunks and finish one per request.
- Create issues/changes only where asked. The repo `ghmattf/v4v-musiclink-pro` is a **read-only reference** for how the Music Index API is used. Never write to it.
- Flag assumptions plainly instead of burying them.
