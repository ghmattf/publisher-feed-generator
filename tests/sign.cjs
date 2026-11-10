// usage: node sign.cjs <sk-hex> <url> <method> <nonce> [bodyString]
const { finalizeEvent } = require('../build/node_modules/nostr-tools/lib/cjs/pure.js');
const { sha256 } = require('../build/node_modules/@noble/hashes/sha2.js');
const { bytesToHex, hexToBytes } = require('../build/node_modules/@noble/hashes/utils.js');
const [sk, url, method, nonce, body, ts] = process.argv.slice(2);
const tags = [['u', url], ['method', method], ['nonce', nonce]];
if (body) tags.push(['payload', bytesToHex(sha256(new TextEncoder().encode(body)))]);
process.stdout.write(JSON.stringify(finalizeEvent({ kind: 27235, created_at: ts ? +ts : Math.floor(Date.now() / 1000), tags, content: '' }, hexToBytes(sk))));
