# To do (owner requests, not yet done)

Added 2026-11-13. Wording is the owner's. Completed items are removed from this list (the history is in git and docs/DECISIONS.md).


## New (2026-11-13, evening)

## Testing still to do
14. Test other browser extensions for NIP-07 sign-in (for example nos2x).
16. A wider look over the UI in different browsers.


## New (2026-11-15)

38. "Want to self-host?" section on the start page: change the "Start" button to "New Feed" and add a new button "Existing Feed" that imports an existing feed from its URL only (no pasting XML). (Owner, 2026-11-16.)
40. Add an npub option to each person (podcast:person) in the editor. (Owner, 2026-11-16.)
41. Person role and group should be lookup lists based on the Podcasting 2.0 specification. (Owner, 2026-11-16.)
42. Improve the explanation of People for publisher feeds. (Owner, 2026-11-16.)
45. Improve the initial screen. (Owner, 2026-11-16.)
47. When creating or editing a feed, make the errors and warnings clickable so they take the user to the field that needs to be fixed. (Owner, 2026-11-16.)
53. Podping: send a Podping for any feed that is updated (published, saved or moved), not only moved feeds. (Owner, 2026-11-16.)
55. Change the reminder text for in-browser key sign-ins from "You are signed in with a key kept in this browser. Payments are not available, and this account is lost if you clear your browser data. For a lasting account that can set up payments, use a signer app or a browser extension" to "You are signed in with a key kept in this browser. For a permanent account use a signer app or a browser extension". (Owner, 2026-11-17.)
57. Check for music feeds that reference one of the feeds referenced by the currently logged-in account. (Owner, 2026-11-17.) Approach (checked against the Stophammer API.md, 2026-11-17; not yet tried against the live API): for each publisher feed of the account, call `GET https://api.musicindex.org/v1/feeds/{guid}?include=publisher` (server side, through PFG_Lookup, cached for a few minutes) and read its `publisher` rows. Show three lists: (a) music feeds that name the publisher feed but are not listed by it (`music_names_publisher` true, `publisher_lists_music` false), which are candidates to add as releases; (b) feeds the publisher lists that do not name it back (`music_names_publisher` false), where the release owner still needs the snippet; (c) confirmed both ways (`two_way_validated` true). Only works for feeds Music Index has crawled. Fallback: `GET /v1/publishers/{publisher}` searches by publisher name text.
58. Add a "Get credited!" button for each feed in the "My feeds" list. (Owner, 2026-11-17.)
59. Add a title attribute to the podcast:remoteItem in the code snippet "Text for the release owner to add to their feed" (the publisher feed already has it). (Owner, 2026-11-17.)
62. Improve the editor's Basics section, which now also holds what used to be the "Identity and links" section (npub, feed URL and GUID, people, support link). (Owner, 2026-11-18.)
63. Add the funding tag (podcast:funding) to the feed. (Owner, 2026-11-18.)
64. Reword the "Move feed" screen. (Owner, 2026-11-18.)
