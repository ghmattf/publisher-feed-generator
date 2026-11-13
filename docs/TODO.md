# To do (owner requests, not yet done)

Added 2026-11-13. Wording is the owner's. Completed items are removed from this list (the history is in git and docs/DECISIONS.md).

17. Add the ability to move the feed. (Owner's wording; to confirm what moving means: for example telling apps the feed has a new address with `itunes:new-feed-url`, or moving a hosted feed to another host.)

## High priority
18. HIGH PRIORITY: use the "Name / title" to create the `<itunes:author>` tag. (Listed under the Amber item in the owner's message; treated as its own item. Note: the Author field was removed from the form on 2026-11-13.)

## New (2026-11-13, evening)
19. Clicking "Back to my feeds" gives a message about leaving without saving changes even though the changes have been saved.
20. Set feeds to be saved to /wp-content/publisher-feeds/ (create the directory if required). (Feeds are currently written under the uploads folder; the web server must also serve the new folder at the feed addresses.)
21. In Settings "Hosted feeds", the owner npub should be a clickable link that resolves the npub using a website such as njump.
23. Import my existing publisher feeds. (Conflicts with the out-of-scope rule in AGENTS.md: importing into hosting needs the owner's explicit go-ahead on how it should work.)
24. Add `<generator>Publisher Role Generator by Phafe</generator>` to the feed.
25. Using Amber, the QR code just stays at "Waiting for your signer to approve…" after scanning and authorizing in Amber.

## Testing still to do
14. Test other browser extensions for NIP-07 sign-in (for example nos2x).
15. Test the Nostr profile lookup against live relays (name, about, website, picture and Lightning address filled in on a new hosted feed), unless the Alby and Amber tests already covered it.
16. A wider look over the UI in different browsers.
