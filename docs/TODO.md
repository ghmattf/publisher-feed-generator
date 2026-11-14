# To do (owner requests, not yet done)

Added 2026-11-13. Wording is the owner's. Completed items are removed from this list (the history is in git and docs/DECISIONS.md).

17. Add the ability to move the feed. (Owner's wording; to confirm what moving means: for example telling apps the feed has a new address with `itunes:new-feed-url`, or moving a hosted feed to another host.)

## New (2026-11-13, evening)
23. Import my existing publisher feeds. (Conflicts with the out-of-scope rule in AGENTS.md: importing into hosting needs the owner's explicit go-ahead on how it should work.)

## Testing still to do
32. Amber QR (0.5.2): Amber shows "Error: Failed to send event. Try again." (0.5.1 and earlier showed no Amber error; the website just stayed on "Waiting for your signer to approve…"). (in progress)
13. Re-test Amber QR sign-in (item 25 attempt): the dialog should now say "Your signer connected. Asking it for your public key…" and then "Signing in…", or show a clear error after 60 seconds. If it still hangs, tell me which message it stops on.
14. Test other browser extensions for NIP-07 sign-in (for example nos2x).
15. Test the Nostr profile lookup against live relays (name, about, website, picture and Lightning address filled in on a new hosted feed), unless the Alby and Amber tests already covered it.
16. A wider look over the UI in different browsers.
