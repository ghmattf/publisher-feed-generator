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
67. is "Your name" nessecary when creating an in-browser key? if not, remove the option. (Owner, 2026-11-24.)
68. change "Create account" button text to "Create a new account", center the button horizontally, and update text "You can simply "Create account" to get up" to "You can simply "Create a new account" to get up". (Owner, 2026-11-24.)
69. remove text "Create Podcasting 2.0 feeds for labels, studios, engineers, artists..." (Owner, 2026-11-24.)
70. change text "Create an account in one click, or sign in with a Nostr signer app or browser extension." to "For Labels, Studios, Engineers, Songwriters, Session Musicians, etc." (Owner, 2026-11-24.)
71. Your name / Business name: change text "Your label, studio or business name." to "Name of performer, engineer, studio, etc..." and add placeholder text in the field "Name/business being credited...". (Owner, 2026-11-24.)
72. Description field placeholder text: "Short bio". (Owner, 2026-11-24.)
73. Language drop-down box should be below the text "The main language of your feed.". hide the drop-down box and have the currently selected language there in bold text with a "Change" button next to it - clicking "Change" will hide the button and the currently selected language text and un-hide the drop-down box. (Owner, 2026-11-24.)
74. change text "Feed maintainer (your name)" to "Contact/Owner name". (Owner, 2026-11-24.)
75. change text "Feed contact email (your email)" to "Contact/Owner email". (Owner, 2026-11-24.)
76. move "Receiving payments" section below "Releases" section. (Owner, 2026-11-24.)
77. After logging in, if there no feeds currently assigned to the account it should go straight into the creating a new feed - skip the extra step of clicking "New feed". (Owner, 2026-11-24.)
