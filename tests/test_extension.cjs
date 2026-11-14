// Browser-extension (NIP-07) sign-in: the real pfg-hosting.js against a fake window.nostr that signs with a real key and a fake server.
(async () => {
const { JSDOM } = require('../build/node_modules/jsdom');
const T = require('../build/node_modules/nostr-tools/lib/cjs/pure.js');
const nip19 = require('../build/node_modules/nostr-tools/lib/cjs/nip19.js');
const fs = require('fs'); const P = __dirname + '/../plugin/assets/js/';
const dom = new JSDOM('<div></div>', { runScripts: 'outside-only', url: 'https://phafe.com/page/' });
const w = dom.window; let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
const sk = T.generateSecretKey(), PK = T.getPublicKey(sk);
const urls = { nonce: 'https://phafe.com/wp-json/pfg/v1/nonce', login: 'https://phafe.com/wp-json/pfg/v1/login', me: 'https://phafe.com/wp-json/pfg/v1/me', logout: 'https://phafe.com/wp-json/pfg/v1/logout', feeds: 'https://phafe.com/wp-json/pfg/v1/feeds', feedTemplate: 'https://phafe.com/wp-json/pfg/v1/feeds/0' };
// fake server
let nonceN = 0, loginEvent = null;
w.fetch = async (url, opts) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
  if (url === urls.nonce) return reply(200, { nonce: 'nonce-' + (++nonceN) });
  if (url === urls.login) { loginEvent = body.event; return reply(200, { npub: nip19.npubEncode(body.event.pubkey), csrf: 'c', feeds: [] }); }
  return reply(404, { message: 'nope' });
};
w.PFGNostr = { SimplePool: class {}, nip19, sha256Hex: s => require('crypto').createHash('sha256').update(s).digest('hex') };
w.eval(fs.readFileSync(P + 'pfg-hosting.js', 'utf8'));
const H = w.PFGHosting; H.init({ urls, relays: [] });

// ---- no extension
ok(H.hasExtension() === false, 'no window.nostr: extension not detected');
let err = null; try { await H.connectExtension(); } catch (e) { err = e; }
ok(err && /No Nostr browser extension was found/.test(err.message) && H.hasSigner() === false, 'connecting without an extension gives a clear error and no signer');
w.nostr = { getPublicKey: 'not a function' }; ok(H.hasExtension() === false, 'incomplete window.nostr is not accepted');
w.nostr = { getPublicKey: async () => PK }; ok(H.hasExtension() === false, 'window.nostr without signEvent is not accepted');

// ---- working extension
const calls = [];
const makeExt = (o) => Object.assign({
  getPublicKey: async function () { calls.push('getPublicKey'); return PK; },
  signEvent: async function (t) { calls.push('signEvent'); if (this !== w.nostr) throw new Error('signEvent called without window.nostr as this'); return T.finalizeEvent(JSON.parse(JSON.stringify(t)), sk); }, // real extensions get a serialised copy (also avoids jsdom's separate realm)
}, o || {});
w.nostr = makeExt(); ok(H.hasExtension() === true, 'complete window.nostr is detected');
const pk = await H.connectExtension();
ok(pk === PK && H.hasSigner() === true, 'connectExtension returns the public key and registers a signer');
ok(w.sessionStorage.getItem('pfg_signer') === '{"ext":true}', 'only a flag is remembered in sessionStorage (no key material)');
const sess = await H.login();
ok(calls.join() === 'getPublicKey,signEvent' && sess.npub === nip19.npubEncode(PK) && H.getSession() === sess, 'login signs through the extension and starts a session');
ok(loginEvent.kind === 27235 && loginEvent.pubkey === PK && T.verifyEvent(loginEvent), 'the event sent to the server is a valid signed kind 27235');
const tag = n => (loginEvent.tags.find(t => t[0] === n) || [])[1];
ok(tag('u') === urls.login && tag('method') === 'POST' && tag('nonce') === 'nonce-1' && !loginEvent.tags.some(t => t[0] === 'payload'), 'NIP-98 tags: u, method, single-use nonce, no payload for the empty login body');
ok(Math.abs(loginEvent.created_at - Math.floor(Date.now() / 1000)) <= 5, 'created_at is current (server window is 60 s)');

// ---- survives a reload of the page (same tab), as long as the extension is present
const dom2 = new JSDOM('<div></div>', { runScripts: 'outside-only', url: 'https://phafe.com/page/' });
const w2 = dom2.window; w2.sessionStorage.setItem('pfg_signer', '{"ext":true}'); w2.fetch = w.fetch; w2.PFGNostr = w.PFGNostr;
w2.eval(fs.readFileSync(P + 'pfg-hosting.js', 'utf8')); w2.PFGHosting.init({ urls, relays: [] });
ok(w2.PFGHosting.hasSigner() === false, 'after reload without the extension the signer is not restored (user must sign in again)');
w2.nostr = { getPublicKey: async () => PK, signEvent: async t => T.finalizeEvent(JSON.parse(JSON.stringify(t)), sk) };
ok(w2.PFGHosting.hasSigner() === true, 'after reload with the extension present the signer is restored');
await w2.PFGHosting.login(); ok(true, 'restored extension signer can sign a fresh login');

// ---- failures
H.forgetSigner(); ok(H.hasSigner() === false && w.sessionStorage.getItem('pfg_signer') === null, 'forgetSigner clears it');
w.nostr = makeExt({ getPublicKey: async () => { throw new Error('User rejected'); } });
err = null; try { await H.connectExtension(); } catch (e) { err = e; }
ok(err && /did not share your public key: User rejected/.test(err.message) && !H.hasSigner(), 'user declining the public key request: clear error, no signer');
for (const bad of ['', 'abc', 'g'.repeat(64), 'a'.repeat(63), null, 5, { x: 1 }]) {
  w.nostr = makeExt({ getPublicKey: async () => bad }); err = null; try { await H.connectExtension(); } catch (e) { err = e; }
  ok(err && /not a public key/.test(err.message) && !H.hasSigner(), 'invalid public key from the extension rejected: ' + JSON.stringify(bad));
}
w.nostr = makeExt({ getPublicKey: async () => PK.toUpperCase() }); ok(await H.connectExtension() === PK, 'uppercase hex from an extension is normalised');
w.nostr = makeExt({ signEvent: async () => { throw new Error('User rejected'); } });
err = null; try { await H.login(); } catch (e) { err = e; }
ok(err && /did not approve the request: User rejected/.test(err.message) && H.getSession() === sess, 'user declining the signature: clear error, previous session untouched');
w.nostr = makeExt(); await H.connectExtension(); const before = calls.length; delete w.nostr;
err = null; try { await H.login(); } catch (e) { err = e; }
ok(err && /did not approve|not connected/.test(err.message) && calls.length === before, 'extension disappearing mid-session fails cleanly');
let lastUri = null;
// ---- QR (nostrconnect) sign-in: progress messages, and a signer that goes quiet gives a clear error instead of waiting forever
Object.assign(w.PFGNostr, { generateSecretKey: () => new Uint8Array(32).fill(7), getPublicKey: () => 'b'.repeat(64), createNostrConnectURI: o => { lastUri = o; return 'nostrconnect://x?secret=s'; }, qrSvg: () => '<svg/>', bytesToHex: b => Buffer.from(b).toString('hex') });
H.init({ urls, relays: [], signerTimeoutMs: 60 });
const msgs = []; H.on('progress', m => msgs.push(m));
w.PFGNostr.BunkerSigner = { fromURI: async (sk, uri, params) => { msgs.push('skipSwitch=' + params.skipSwitchRelays); return { getPublicKey: () => new Promise(() => {}), close() {} }; } };
err = null; try { await H.startNostrConnect().done; } catch (e) { err = e; }
ok(err && /connected but did not share your public key/.test(err.message), 'QR: signer that connects but never answers get_public_key gives a clear timeout error');
ok(msgs.includes('skipSwitch=undefined') && msgs.some(m => /Your signer connected/.test(m)), 'QR: progress message after the signer connects; switch_relays is NOT skipped (lets the signer move us to relays it can reach)');
w.PFGNostr.BunkerSigner = { fromURI: async () => ({ getPublicKey: async () => 'c'.repeat(64), close() {}, bp: { pubkey: 'd'.repeat(64), relays: [] } }) };
H.init({ urls, relays: ['wss://a.x', 'wss://b.x', 'wss://c.x', 'wss://d.x', 'wss://e.x', 'wss://f.x'], signerTimeoutMs: 60 }); H.startNostrConnect().cancel();
ok(lastUri && lastUri.relays.length === 5 && lastUri.relays[3] === 'wss://d.x', 'QR: the first 5 settings relays go into the code (a relay added 4th is no longer left out)');
ok(await H.startNostrConnect().done === 'c'.repeat(64), 'QR: normal connection still resolves with the public key');

console.log(fails ? fails + ' FAILURES' : 'extension tests passed'); process.exit(fails ? 1 : 0);
})();
