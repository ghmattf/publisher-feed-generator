// Upgrade a browser-key account to a signer: the real pfg-hosting.js against a fake server that checks both signatures.
(async () => {
const { JSDOM } = require('../build/node_modules/jsdom');
const T = require('../build/node_modules/nostr-tools/lib/cjs/pure.js');
const { hexToBytes, bytesToHex } = require('../build/node_modules/@noble/hashes/utils.js');
const fs = require('fs'); const crypto = require('crypto'); const P = __dirname + '/../plugin/assets/js/';
const dom = new JSDOM('<div></div>', { runScripts: 'outside-only', url: 'https://phafe.com/page/' });
const w = dom.window; let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
const U = 'https://phafe.com/wp-json/pfg/v1/';
const urls = { nonce: U + 'auth/nonce', login: U + 'auth/login', me: U + 'me', logout: U + 'auth/logout', feeds: U + 'me/feeds', feedTemplate: U + 'me/feeds/0', upgrade: U + 'me/upgrade' };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
let n = 0, kind = 'browser', pubkey = null, upgradeReq = null, upgradeStatus = 200;
w.fetch = async (url, opts) => {
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (url === urls.nonce) return reply(200, { nonce: ('0'.repeat(31) + (++n)).slice(-32) });
  if (url === urls.login) { pubkey = body.event.pubkey; kind = body.browserKey ? 'browser' : 'signer'; return reply(200, { pubkey, kind, csrf: 'c1', feeds: [] }); }
  if (url === urls.upgrade) {
    upgradeReq = { body: opts.body, h: opts.headers };
    if (upgradeStatus !== 200) return reply(upgradeStatus, { message: 'That key already has an account with feeds here.' });
    kind = 'signer'; pubkey = body.newPubkey; return reply(200, { pubkey, kind, csrf: 'c2', feeds: [{ id: 1, slug: 'keep' }] });
  }
  return reply(404, { message: 'nope' });
};
w.PFGNostr = { SimplePool: class {}, nip19: {}, sha256Hex: sha, generateSecretKey: T.generateSecretKey, getPublicKey: T.getPublicKey, finalizeEvent: (t, k) => T.finalizeEvent(JSON.parse(JSON.stringify(t)), k), hexToBytes, bytesToHex };
w.eval(fs.readFileSync(P + 'pfg-hosting.js', 'utf8'));
const H = w.PFGHosting; H.init({ urls, relays: [] });

const oldPk = await H.createBrowserAccount('Mia');
let s = await H.login();
ok(s.kind === 'browser' && H.hasBrowserKey() && s.pubkey === oldPk, 'precondition: signed in with a browser key');
const oldSk = JSON.parse(w.localStorage.getItem('pfg_browser_key')).sk;

// the new signer (a pretend extension with a different key)
const sk2 = T.generateSecretKey(), pk2 = T.getPublicKey(sk2);
w.nostr = { getPublicKey: async () => pk2, signEvent: async function (t) { return T.finalizeEvent(JSON.parse(JSON.stringify(t)), sk2); } };

// 1. server refuses: the browser key stays and stays signed in
upgradeStatus = 409; let err = null;
try { await H.upgradeAccount(H.connectExtension()); } catch (e) { err = e; }
ok(err && /already has an account/.test(err.message), 'server refusal reaches the person');
ok(H.hasBrowserKey() && H.getSession().kind === 'browser' && H.hasSigner() && w.sessionStorage.getItem('pfg_signer') === '{"local":true}', 'after a failed upgrade the browser key is kept and is the active signer again');

// 2. success
upgradeStatus = 200; upgradeReq = null;
const res = await H.upgradeAccount(H.connectExtension());
ok(res.kind === 'signer' && res.pubkey === pk2 && H.getSession() === res, 'upgrade returns the new session');
const body = JSON.parse(upgradeReq.body);
ok(body.newPubkey === pk2 && Object.keys(body).length === 1, 'body names only the new key');
const evOld = JSON.parse(Buffer.from(upgradeReq.h['X-PFG-Auth'], 'base64').toString()), evNew = JSON.parse(Buffer.from(upgradeReq.h['X-PFG-Auth-New'], 'base64').toString());
ok(T.verifyEvent(evOld) && T.verifyEvent(evNew) && evOld.pubkey === oldPk && evNew.pubkey === pk2, 'the old key and the new key each signed a valid event');
const tg = (e, k) => (e.tags.find(t => t[0] === k) || [])[1];
ok([evOld, evNew].every(e => tg(e, 'u') === urls.upgrade && tg(e, 'method') === 'POST' && tg(e, 'payload') === sha(upgradeReq.body)), 'both events are for the upgrade URL and bound to the same body');
ok(tg(evOld, 'nonce') !== tg(evNew, 'nonce'), 'each event has its own nonce');
ok(upgradeReq.h['X-PFG-CSRF'] === 'c1', 'session CSRF header sent');
ok(!H.hasBrowserKey() && w.localStorage.getItem('pfg_browser_key') === null, 'the key kept in this browser is removed after a successful upgrade');
ok(w.sessionStorage.getItem('pfg_signer') === '{"ext":true}', 'the extension is now the remembered signer');
let err2 = null; try { await H.upgradeAccount(H.connectExtension()); } catch (e) { err2 = e; }
ok(err2 && /Only an account made with a key kept in this browser/.test(err2.message), 'a signer account cannot start an upgrade');
console.log(fails ? fails + ' FAILURES' : 'upgrade tests passed'); process.exit(fails ? 1 : 0);
})();
