# To do (owner requests, not yet done)

Added 2026-11-13. Wording is the owner's. Completed items are removed from this list (the history is in git and docs/DECISIONS.md).


## New (2026-11-13, evening)

## Testing still to do
14. Test other browser extensions for NIP-07 sign-in (for example nos2x).
15. Test the Nostr profile lookup against live relays (name, about, website, picture and Lightning address filled in on a new hosted feed), unless the Alby and Amber tests already covered it.
16. A wider look over the UI in different browsers.


## New (2026-11-15)
35. Simple on-ramp sign-in for non-technical people: "Create account" makes a Nostr key in the browser (never on the server) and signs the person in, with no extension or app. No backup or restore feature (owner, 2026-11-15): people who want a lasting account are directed to a remote signer (Amber, Primal, etc.) or a browser extension such as Sidecar. Extension, QR and bunker sign-in stay as "I already use Nostr".
36. "Upgrade my sign-in": a signed-in browser-key user connects a safer signer (extension, Amber, QR/bunker) and the account moves to that key, proving both keys, so feeds and GUIDs are kept. Admin "move feed to another account" stays as the fallback for people who lose a browser key.
37. Browser-key accounts (item 35): the Payments section is locked with a message that payments are not supported without a signer or browser extension, with a "more info" link. A second (and later) sign-in with the browser key shows a message to switch to a signer/extension, with the same link. The link URL is a setting in the plugin's Settings page (owner will create the page). (Owner, 2026-11-15.)
