# Decisions, assumptions and open items

Status at handoff: plugin v1.0.0 feature-complete for the agreed scope; all automated checks pass (`tests/run-all.sh`). Not yet run on a real WordPress site, with a real signer app, or against the live Music Index API.

## Product decisions (stated by the owner)
- Publisher feeds only (`podcast:medium` publisher). Not albums or tracks.
- Two modes. Anonymous: create, paste-XML import, edit, export, no login. Hosted: Nostr remote-signer (NIP-46) login, feeds hosted on phafe.com.
- Import is by **pasted XML only** for whole feeds. No URL import. Importing into hosting is not an option.
- The `podcast:txt purpose="npub"` value in a feed does not need to match the login key (a convention for this generator only).
- Hosted accounts live in their own table keyed by npub, not WordPress users.
- No cross-feed approval flow: a label etc. sends the exact text (snippet) to whoever controls the other feed.
- No non-Nostr login fallback.
- Roles follow Podcast Index namespace PR #793 (`rel` is a space-separated role set; both sides must list the same set to be confirmed; if one side omits `rel` the link is kept). Extra tokens `studio` and `engineer` are added in settings.
- Example reference feeds (live on phafe.com, read-only for us): `Phafe.xml` (publisher), `mezzaforte.xml` (artist publisher), the album feed `some_songs.xml` (GUID 07adf84f-c1fa-47a7-a121-0fb544e859bd). Updating those feeds is out of scope.

## Release behaviour (latest requests)
- Payments are **optional**. No recipients = no `podcast:value` block (and no platform recipient). With recipients, splits must total 100 (minus the platform share on hosted feeds).
- Each release card has two states. Empty: Music Index search, paste box (https address or XML), Read feed. Populated (valid GUID + https feed URL): details shown read-only, only the role chips are editable. To change a release, remove it and add again.
- Pasting an https address makes the **server** fetch it (`MSPF_Lookup::fetch_feed`, `wp_safe_remote_get`). Search calls `https://api.musicindex.org/v1` (`/search`, `/feeds/{guid}`) server-side, cached 1 day per album, rate limited (20 per 5 min per visitor).

## Security model (summary)
HttpOnly SameSite=Strict session cookie `mspf_session`; CSRF header `X-MSPF-CSRF`; NIP-98 events (kind 27235, tags u/method/nonce, payload hash when there is a body, within 60 s, nonce single use). Fresh signature in `X-MSPF-Auth` is demanded (HTTP 428) for payment-recipient changes and deletes. Feeds are written atomically under uploads with a realpath check; deleted feeds become tombstones so slugs/GUIDs can't be reused. Hosting needs PHP GMP and HTTPS.

## Assumptions to verify (not confirmed)
1. `podcast:value method="lnaddress"` is the default (copied from the owner's feeds). The Podcasting 2.0 spec example may use `keysend`. Check against the current spec.
2. Platform recipient default is Podcastindex.org / `podcastindex@getalby.com` / 1%. Owner must review in Settings > Publisher Feeds. A change only affects feeds saved afterwards.
3. Music Index detail fields assumed from the `v4v-musiclink-pro` code: search hits have `entity_type`, `entity_id`, `feed_guid`; `/feeds/{guid}` has `title`, `release_artist`, `image_url`. `feed_url` / `url` / `medium` are **guesses**; if absent, the UI asks the user to paste the feed address. Check against the real API.
4. The NIP-46 client key is kept in `sessionStorage` so signing works after a reload (XSS would expose it).
5. Cloudflare may cache hosted XML; a purge may be needed after publishing.

## Open items
- **Naming:** the plugin is still `msp-publisher-feeds` (prefix `mspf`, shortcode `[msp_feed_generator]`, tables `mspf_*`). The owner wants the project called "Publisher Feed Generator". Undecided whether to rename the plugin itself (display name, shortcode, prefix, tables). Nothing is live yet so renaming is cheap now; ask before doing it.
- GitHub: Claude's sessions could not write to this repo (the GitHub App was not accepted by the session). The owner created issues manually.
- Not yet done: run on a real WordPress; test with real signers (nsec.app, Amber) via bunker:// and QR; test the live Music Index API; browser look-over of the UI (CSS never viewed in a real browser).
- Ideas not requested: a "change feed" action on filled-in releases; showing hosted-feed moderation status to the owner.

## Out of scope (do not add without asking)
URL import of whole feeds; importing into hosting; cross-feed approval flows; non-Nostr login; album or track feeds.
