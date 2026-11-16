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
43. Do not go into the payment being disabled on the in-browser key login screen. (Owner, 2026-11-16.)
45. Improve the initial screen. (Owner, 2026-11-16.)
47. When creating or editing a feed, make the errors and warnings clickable so they take the user to the field that needs to be fixed. (Owner, 2026-11-16.)
50. "Your hosted feeds": replace the URL with the feed name, and add a "Feed URL" button that shows the feed name and the URL (copyable) in a popup, along with a "Go to Feed URL" button. (Owner, 2026-11-16.)
51. Make "Feed contact email" a mandatory field for in-browser key sign-ins. This can be a way to adopt feeds without the in-browser key. (Owner, 2026-11-16.)
52. New admin plugin setting "Number of days to keep a moved feed" (integer, default 28). Call it KeepMoved. (Owner, 2026-11-16.)
49. "Your hosted feeds": a "Move feed" button replaces the "New feed URL" field in the editor. Clicking it explains that this tells all apps the feed has moved to a new URL and that the person must also update every feed that already has a relationship to this feed. Only a new-URL field, "Move" and "Cancel". Move asks "Are you sure you want to move this feed?" and says the feed stays here for KeepMoved days. Confirming writes the tag to the feed and publishes (and podpings when that is enabled). The date moved is recorded in the admin settings area; an info message at the top of that page says moved feeds are ready to be deleted when any were moved more than KeepMoved days ago, and those feeds are highlighted in the list. (Owner, 2026-11-16.)
