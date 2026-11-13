# To do (owner requests, not yet done)

Added 2026-11-13. Wording is the owner's. Completed items are removed from this list (the history is in git and docs/DECISIONS.md).

## Editor
7. Hide the "Category" field. The focus is music, so keep the value set to Music but do not display it.
8. Change "Your npub (optional)" to "Include npub in the feed? (optional)".
9. When signed in with Nostr, assume the feed will be hosted: label "Feed URL (where you will host it)" simply as "Feed URL".
10. Force Title and Description to be filled in before moving on from the "Basics" section (Next button, and opening another section).
11. Need to generate the GUID. (Owner's wording; to confirm what is missing: the GUID is currently generated from the feed URL.)
12. The message "Downloaded publisher.xml. Upload it to your web server." should be shown at the bottom of the page, next to the download button.

17. Add the ability to move the feed. (Owner's wording; to confirm what moving means: for example telling apps the feed has a new address with `itunes:new-feed-url`, or moving a hosted feed to another host.)

## Testing still to do
14. Test other browser extensions for NIP-07 sign-in (for example nos2x).
15. Test the Nostr profile lookup against live relays (name, about, website, picture and Lightning address filled in on a new hosted feed), unless the Alby and Amber tests already covered it.
16. A wider look over the UI in different browsers.
