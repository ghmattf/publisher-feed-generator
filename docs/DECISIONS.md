# Decisions, assumptions and open items

Status: plugin v0.2.0 feature-complete for the agreed scope; all automated checks pass (`tests/run-all.sh`). Not yet run on a real WordPress site, with a real signer app, or against the live Music Index API.

## Product decisions (stated by the owner)
- Versioning: the plugin is at **0.2.0** (decided 2026-11-12; replaces an earlier 1.0.0 string that was never tagged or released). Major version changes (including moving to 1.0.0) need the owner's explicit approval. Features and fixes before that are minor/patch bumps (0.3.0, 0.2.1).
- Publisher feeds only (`podcast:medium` publisher). Not albums or tracks.
- Two modes. Anonymous: create, paste-XML import, edit, export, no login. Hosted: Nostr login (browser extension via NIP-07, or remote signer via NIP-46), feeds hosted on phafe.com.
- Import is by **pasted XML only** for whole feeds. No URL import. Importing into hosting is not an option.
- The `podcast:txt purpose="npub"` value in a feed does not need to match the login key (a convention for this generator only).
- Sign-in options (decided 2026-11-12): browser extension (NIP-07, `window.nostr`, for example Alby or nos2x), pasted `bunker://` link, QR code (NIP-46). The extension tab is first and preselected when `window.nostr` is detected, otherwise last (with a "Check again" button). Still Nostr only. `window.nostr` is looked up on every call, never cached, and only a flag (no key) is kept in `sessionStorage`. The server is unchanged: login and fresh signatures are the same NIP-98 events whichever signer produced them.
- Hosted accounts live in their own table keyed by npub, not WordPress users.
- No cross-feed approval flow: a label etc. sends the exact text (snippet) to whoever controls the other feed.
- No non-Nostr login fallback.
- Roles follow Podcast Index namespace PR #793 (`rel` is a space-separated role set; both sides must list the same set to be confirmed; if one side omits `rel` the link is kept). Extra tokens `studio` and `engineer` are added in settings.
- `podcast:value method="lnaddress"` is the default payment method (confirmed by the owner, 2026-11-11).
- Project and plugin name is **Publisher Feed Generator** (decided 2026-11-11). Naming scheme: plugin folder/slug and text domain `publisher-feed-generator`, main file `publisher-feed-generator.php`, main class `Publisher_Feed_Generator`, shortcode `[publisher_feed_generator]`, code prefix `pfg` / `PFG_` (classes, constants, options, DB tables `pfg_*`, REST namespace `pfg/v1`, cookie `pfg_session`, headers `X-PFG-*`, JS globals `PFG*`, CSS `.pfg-*`). Nothing was live, so there is no migration from the old `mspf_*` names.
- Website and Image URL accept `http://` as well as `https://` (decided 2026-11-12; Nostr profiles often use http). Every other URL (feed URLs, support link, release feed/image URLs) stays https-only.
- New hosted feed: after Nostr sign-in the form is prefilled from the user's Nostr profile (kind 0): name -> Name / title and Author, about -> Description, website -> Website, picture -> Image URL, lud16 -> one `lnaddress` payment recipient (split 100 minus the platform share), signed-in npub -> Your npub. Only empty fields are filled, only for new hosted feeds, never anonymous mode. `lud06` (LNURL) is ignored. The profile is read by the browser from relays (no server fetch, no signing).
- "Get your npub" button under the npub field: fills from the signed-in account, otherwise asks a signer app for its public key (bunker link or QR), without creating a hosted session, and forgets the signer afterwards.
- "Save and publish" does **not** send a podping. The plugin has no podping code. Not added (it would be a new feature: needs a Podping account/token and a decision on when to ping).
- Example reference feeds (live on phafe.com, read-only for us): `Phafe.xml` (publisher), `mezzaforte.xml` (artist publisher), the album feed `some_songs.xml` (GUID 07adf84f-c1fa-47a7-a121-0fb544e859bd). Updating those feeds is out of scope.

## Release behaviour (latest requests)
- Payments are **optional**. No recipients = no `podcast:value` block (and no platform recipient). With recipients, splits must total 100 (minus the platform share on hosted feeds).
- Each release card has two states. Empty: Music Index search, paste box (https address or XML), Read feed. Populated (valid GUID + https feed URL): details shown read-only, only the role chips are editable. To change a release, remove it and add again.
- Pasting an https address makes the **server** fetch it (`PFG_Lookup::fetch_feed`, `wp_safe_remote_get`). Search calls `https://api.musicindex.org/v1` (`/search`, `/feeds/{guid}`) server-side, cached 1 day per album, rate limited (20 per 5 min per visitor).

## Security model (summary)
HttpOnly SameSite=Strict session cookie `pfg_session`; CSRF header `X-PFG-CSRF`; NIP-98 events (kind 27235, tags u/method/nonce, payload hash when there is a body, within 60 s, nonce single use). Fresh signature in `X-PFG-Auth` is demanded (HTTP 428) for payment-recipient changes and deletes. Feeds are written atomically under uploads with a realpath check; deleted feeds become tombstones so slugs/GUIDs can't be reused. Hosting needs PHP GMP and HTTPS.

## Assumptions to verify (not confirmed)
1. Platform recipient default is Podcastindex.org / `podcastindex@getalby.com` / 1%. Owner must review in Settings > Publisher Feeds. A change only affects feeds saved afterwards.
2. Music Index detail fields assumed from the `v4v-musiclink-pro` code: search hits have `entity_type`, `entity_id`, `feed_guid`; `/feeds/{guid}` has `title`, `release_artist`, `image_url`. `feed_url` / `url` / `medium` are **guesses**; if absent, the UI asks the user to paste the feed address. Check against the real API.
3. The NIP-46 client key is kept in `sessionStorage` so signing works after a reload (XSS would expose it).
4. Cloudflare may cache hosted XML; a purge may be needed after publishing.
5. The extension sign-in is tested only against a fake `window.nostr` that signs with a real key. Real Alby, nos2x and others are untested: check how each handles `signEvent` for kind 27235, per-site permission prompts, and late injection of `window.nostr`.
6. Profile lookup relays are `wss://purplepag.es`, `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.primal.net` plus the relays in Settings. Not tested against live relays (only a fake pool); a profile that lives only on other relays will show "No Nostr profile was found". Not configurable in Settings yet.

## Open items
- GitHub: Claude's sessions could not write to this repo (the GitHub App was not accepted by the session). The owner created issues manually.
- Not yet done: run on a real WordPress; test with real signers (nsec.app, Amber) via bunker:// and QR; test the live Music Index API; browser look-over of the UI (CSS never viewed in a real browser).
- Ideas not requested: a "change feed" action on filled-in releases; showing hosted-feed moderation status to the owner.

## Out of scope (do not add without asking)
URL import of whole feeds; importing into hosting; cross-feed approval flows; non-Nostr login; album or track feeds.
