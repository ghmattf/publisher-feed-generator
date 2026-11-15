# To do (owner requests, not yet done)

Added 2026-11-13. Wording is the owner's. Completed items are removed from this list (the history is in git and docs/DECISIONS.md).


## New (2026-11-13, evening)

## Testing still to do
14. Test other browser extensions for NIP-07 sign-in (for example nos2x).
15. Test the Nostr profile lookup against live relays (name, about, website, picture and Lightning address filled in on a new hosted feed), unless the Alby and Amber tests already covered it.
16. A wider look over the UI in different browsers.


## New (2026-11-15)
35. Simple sign-in for non-technical people: "Create account" makes a Nostr key in the browser (never on the server), protected by a password, with a backup step (recovery file and/or copy of the key) and a restore route. Extension, QR and bunker stay as "I already use Nostr". Owner approved this direction on 2026-11-15 after asking how the key is handled and how other scripts on the site could reach it (see answers). Build in small steps: create + sign in first, then backup and restore.
36. Admin action to move an adopted/hosted feed to a different account (for lost keys). Uses the existing "Adopt" screen idea.
