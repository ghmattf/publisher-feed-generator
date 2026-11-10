# Rebuilding `plugin/assets/js/nostr-bundle.js`

The bundle exposes `window.PFGNostr` (nostr-tools NIP-46/NIP-19, SimplePool, sha256, QR code). It is generated, do not edit it by hand.

    cd build
    npm install
    npx esbuild entry.js --bundle --minify --format=iife --platform=browser --outfile=../plugin/assets/js/nostr-bundle.js

Verified: this command produces a bundle exposing the full API listed below.

`node_modules` is also what the test scripts use (nostr-tools to sign, jsdom, xmldom).
