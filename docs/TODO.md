# To do (owner requests, not yet done)

Added 2026-11-13. Wording is the owner's. Completed items are removed from this list (the history is in git and docs/DECISIONS.md).


## New (2026-11-13, evening)

## Testing still to do
14. Test other browser extensions for NIP-07 sign-in (for example nos2x).
16. A wider look over the UI in different browsers.


## New (2026-11-15)

38. "Want to self-host?" section on the start page: change the "Start" button to "New Feed" and add a new button "Existing Feed" that imports an existing feed from its URL only (no pasting XML). (Owner, 2026-11-16.)
45. Improve the initial screen. (Owner, 2026-11-16.)
47. When creating or editing a feed, make the errors and warnings clickable so they take the user to the field that needs to be fixed. (Owner, 2026-11-16.)
53. Podping: send a Podping for any feed that is updated (published, saved or moved), not only moved feeds. (Owner, 2026-11-16.)
55. Change the reminder text for in-browser key sign-ins from "You are signed in with a key kept in this browser. Payments are not available, and this account is lost if you clear your browser data. For a lasting account that can set up payments, use a signer app or a browser extension" to "You are signed in with a key kept in this browser. For a permanent account use a signer app or a browser extension". (Owner, 2026-11-17.)
57. Check for music feeds that reference one of the feeds referenced by the currently logged-in account. (Owner, 2026-11-17.) Approach (checked against the Stophammer API.md, 2026-11-17; not yet tried against the live API): for each publisher feed of the account, call `GET https://api.musicindex.org/v1/feeds/{guid}?include=publisher` (server side, through PFG_Lookup, cached for a few minutes) and read its `publisher` rows. Show three lists: (a) music feeds that name the publisher feed but are not listed by it (`music_names_publisher` true, `publisher_lists_music` false), which are candidates to add as releases; (b) feeds the publisher lists that do not name it back (`music_names_publisher` false), where the release owner still needs the snippet; (c) confirmed both ways (`two_way_validated` true). Only works for feeds Music Index has crawled. Fallback: `GET /v1/publishers/{publisher}` searches by publisher name text.
62. Improve the editor's Basics section, which now also holds what used to be the "Identity and links" section (npub, feed URL and GUID, people, support link). (Owner, 2026-11-18.)
64. Reword the "Move feed" screen. (Owner, 2026-11-18.)
65. Simplify the process when using an invite link (?credit=<feed GUID>): a newly created account should go straight to a new feed (no extra button to click), and the invited release should be added automatically. (Owner, 2026-11-18.)


## New (2026-11-24)

66. 'For Artists' on front page. (Owner, 2026-11-24.)


## Security review (2026-11-27)

Findings from the owner-requested security review. Do not implement until the owner says so. Full write-up: docs/SECURITY-REVIEW.md. (Owner, 2026-11-27.)

67. Medium. Browser-key payment lock can be bypassed through /me/upgrade: whoever holds the browser key plus any signer key of their own can turn the account into a signer account and then change payments. Also the account kind comes from the client's browserKey flag at first login. Fix: cool-down after an upgrade before payment changes, plus a notice (email or admin-visible), or route the first payment change after an upgrade through the require_approval queue.
68. Medium. The browser private key is stored in plaintext in localStorage (pfg-hosting.js, LOCAL_KEY), so any XSS on the site origin can steal it. Fix: optional passphrase / WebCrypto-wrapped storage, and a strict Content-Security-Policy on the generator page.
69. Low-Medium. REST CORS: WordPress reflects the request Origin with credentials on REST routes; a same-site sibling subdomain could read GET /me, which returns the CSRF token. Fix: restrict CORS for the pfg/v1 routes to the site's own origin.
70. Low-Medium. /lookup/feed is a general content relay: it returns the raw body of any https URL (up to 2 MB) even when it is not XML, and wp_safe_remote_get leaves a small DNS-rebinding window. Fix: require an XML-looking body and an XML/text content type before returning anything.
71. Low-Medium. /auth/login runs the CPU-heavy pure-PHP Schnorr verification before the nonce check. Fix: check that the nonce exists and has not expired first, and consume it only after the signature verifies.
72. Low. Session cookie Secure flag depends on is_ssl(), which is false behind some proxies; no __Host- prefix. Fix: also honour X-Forwarded-Proto when trusted, and use the __Host- prefix when Secure.
73. Low. trust_cf_ip can allow forged client IPs unless the origin only accepts Cloudflare traffic; behind any other proxy all users share one IP and one rate-limit bucket. Fix: document it next to the setting, and warn in the settings screen.
74. Low. The transient-based rate limiter is not atomic (concurrent requests can slip past) and creates one option row per IP. Fix: atomic counter (custom table or object cache increment).
75. Low. Check-then-insert race on the max-feeds-per-account check (the slug and GUID already have unique database keys, so a duplicate slug is rejected). Fix: count and insert inside one transaction, or lock per account.
76. Low. Leftover .pfg temp files if a feed write fails part-way. Fix: remove the temp file on every failure path and sweep stale ones.
77. Low. The suspended-feeds folder relies on .htaccess (ignored by nginx); the HMAC-derived names are the real protection. Fix: say so in the docs and the admin screen, and offer an nginx snippet.
78. Low. Search amplification: one search can trigger up to 9 outbound Music Index calls, and details_for_guid 404s are not cached. Fix: cache misses briefly and lower the per-search detail lookups.
