=== MSP Publisher Feeds ===
Contributors: phafe
Tags: podcasting 2.0, rss, publisher feed, nostr, music
Requires at least: 5.8
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

A page where labels, studios, engineers, hosts and artists build Podcasting 2.0 publisher feeds (podcast:medium "publisher"). Export the XML to host yourself, or sign in with a Nostr remote signer and have it hosted on your site.

== Description ==

Add the shortcode `[msp_feed_generator]` to any page.

Anonymous mode (no login, nothing stored on your server):
* Create a publisher feed from scratch, or paste the XML of an existing publisher feed to edit it.
* Add releases with roles (label, studio, engineer, host, artist, ...). Paste a release feed's XML to fill in its details and check that it links back to the publisher. The page shows the exact text the release owner must add to their own feed.
* Payments are optional. With no payment recipients the feed simply has no payment block.
* Search Music Index (api.musicindex.org) for a release, or paste a release feed's https address (or its XML), and the details are filled in for you. Lookups run on your server, need no account and are rate limited.
* Download or copy the XML. Drafts are kept in the visitor's browser only.

Hosted mode (optional):
* Sign in with a Nostr remote signer (NIP-46: bunker:// link or QR code). Your private key never reaches the server.
* Feeds are written to wp-content/uploads/rssfeed/publishers/{name}/{name}.xml and can be edited later.
* Changing payment recipients or deleting a feed asks the signer for a fresh signature (NIP-98).
* Hosted accounts are stored in their own table, keyed by public key. They are not WordPress users.
* Deleted feeds keep their name and GUID reserved so they cannot be taken over.

Only publisher feeds are created. Albums and tracks are not.

== Installation ==

1. Upload the plugin folder to wp-content/plugins and activate it.
2. Add `[msp_feed_generator]` to a page.
3. Review Settings > Publisher Feeds. Check the platform payment recipient (default: Podcastindex.org, 1%) before going live.

Requirements for hosted mode: HTTPS, and the PHP GMP extension (used to verify Nostr signatures). Without GMP the page still works in anonymous mode.

If you use Cloudflare, purge the cache for a feed URL after publishing if apps show an old copy, or add a cache rule for /wp-content/uploads/rssfeed/*.

== Notes ==

* Music Index search fills in the release's GUID, title, image and medium. If the API does not return the release's feed address, the page asks you to paste it.

* Platform recipients are appended to hosted feeds and take their split first; users' own recipients must total 100 minus the platform share. Changing the platform split only affects feeds saved afterwards. Optionally apply it to exports too.
* Roles follow the podcast-namespace "rel" proposal (podcast-namespace PR 793): a link is confirmed when both feeds point at each other with the same roles. "studio" and "engineer" are extra tokens added in settings.
* The generated value block uses method="lnaddress" by default (changeable per feed). Check this against the current Podcasting 2.0 spec for your use.
* The signer connection details are kept in the visitor's sessionStorage so signing keeps working after a page reload. They are cleared on sign out or when the tab closes.
* Uninstalling removes data only if "Delete accounts, feeds and settings" is ticked. Published XML files are never deleted.
