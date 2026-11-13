# To do (owner requests, not yet done)

Added 2026-11-13. Wording is the owner's. Completed items are removed from this list (the history is in git and docs/DECISIONS.md).

## Front page and sign-in screen
1. The heading "Publisher feed generator" and the line "Build a Podcasting 2.0 publisher feed for your label, studio, host or artist page. Download it and host it yourself, or sign in and we will host it for you." are white and unreadable on the website theme's yellow background.
2. The "Publisher feed generator" text should be an h1 and be changed to "Roles feed generator".
3. Remove the text "Download it and host it yourself, or sign in and we will host it for you."
4. Make the "Sign in" button purple (not the "Start" button) on the first screen, and change its text from "Sign in" to "Get started".
5. Remove the "Edit an existing feed" section.
6. Change "Create a new feed" to "Want to self-host?" and remove the text "Start from scratch. "

## Editor
7. Hide the "Category" field. The focus is music, so keep the value set to Music but do not display it.
8. Change "Your npub (optional)" to "Include npub in the feed? (optional)".
9. When signed in with Nostr, assume the feed will be hosted: label "Feed URL (where you will host it)" simply as "Feed URL".
10. Force Title and Description to be filled in before moving on from the "Basics" section (Next button, and opening another section).
11. Need to generate the GUID. (Owner's wording; to confirm what is missing: the GUID is currently generated from the feed URL.)
12. The message "Downloaded publisher.xml. Upload it to your web server." should be shown at the bottom of the page, next to the download button.
