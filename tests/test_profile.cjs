// Unit tests: Nostr profile -> form values (pure) and the relay lookup in pfg-hosting.js (fake pool).
(async () => {
const { JSDOM } = require('../build/node_modules/jsdom');
const nip19 = require('../build/node_modules/nostr-tools/lib/cjs/nip19.js');
const fs = require('fs'); const P = __dirname + '/../plugin/assets/js/';
const dom = new JSDOM('<div></div>', { runScripts: 'outside-only', url: 'https://phafe.com/' });
const w = dom.window; let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
const realTimeout = w.setTimeout.bind(w); w.setTimeout = (fn, ms) => realTimeout(fn, ms > 1000 ? 30 : ms); // make the 8 s lookup timeout fast
w.eval(fs.readFileSync(P + 'pfg-core.js', 'utf8'));
const f = w.PFGCore.profileToFields;

// ---- profileToFields
let r = f({ display_name: '  Acme\tRecords ', name: 'acme', about: 'Hi\r\nthere', website: 'https://acme.example/', picture: 'https://acme.example/a.png', lud16: 'Acme@GetAlby.com' });
ok(r.name === 'Acme Records' && r.about === 'Hi\nthere' && r.website === 'https://acme.example/' && r.picture === 'https://acme.example/a.png' && r.lud16 === 'Acme@GetAlby.com', 'normal profile mapped and tidied');
ok(f({ name: 'acme' }).name === 'acme' && f({ displayName: 'Camel' }).name === 'Camel' && f({ display_name: '   ', name: 'fallback' }).name === 'fallback', 'name falls back: display_name, displayName, name');
ok(f({ website: 'example.com' }).website === 'https://example.com' && f({ website: 'example.com/shop?a=1' }).website === 'https://example.com/shop?a=1', 'bare domain gets https://');
ok(f({ website: 'http://example.com' }).website === 'http://example.com' && f({ picture: 'http://example.com/x.jpg' }).picture === 'http://example.com/x.jpg', 'http:// kept for website and picture');
for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example', 'not a url', 'https://', 'https://u:p@x.example/', 'https://x.example/a b', '//x.example', 'mailto:a@b.co']) {
  ok(f({ website: bad }).website === '' && f({ picture: bad }).picture === '', 'unusable URL ignored: ' + bad);
}
for (const bad of ['LNURL1DP68GURN8GHJ7', 'nolocalhost', 'a@b', 'a b@c.co', '<a@b.co>', '']) ok(f({ lud16: bad }).lud16 === '', 'not a lightning address ignored: ' + JSON.stringify(bad));
ok(f({ name: '🎵'.repeat(300) }).name === '🎵'.repeat(200) && f({ about: 'y'.repeat(5000) }).about.length === 4000, 'length limits applied by characters, not UTF-16 units');
for (const v of [null, undefined, 'str', 5, [], [1, 2], true]) { const o = f(v); ok(o.name === '' && o.about === '' && o.website === '' && o.picture === '' && o.lud16 === '', 'non-object profile gives empty result: ' + JSON.stringify(v)); }
const o2 = f({ name: 5, about: ['x'], website: {}, picture: 1, lud16: null }); ok(!o2.name && !o2.about && !o2.website && !o2.picture && !o2.lud16, 'non-string fields ignored');

// ---- fetchProfile against a fake pool
const PK = 'ab'.repeat(32); let seen = null, behaviour = null;
w.PFGNostr = { SimplePool: class { get(relays, filter, params) { seen = { relays, filter, params }; return behaviour(); } }, nip19 };
w.eval(fs.readFileSync(P + 'pfg-hosting.js', 'utf8'));
const H = w.PFGHosting; H.init({ relays: ['wss://relay.nsec.app', 'wss://nos.lol', 'ws://insecure.example', 'https://notarelay.example', 42] });
const ev = (o) => Object.assign({ kind: 0, pubkey: PK, created_at: 1, content: JSON.stringify({ name: 'A' }) }, o);
behaviour = async () => ev({}); let p = await H.fetchProfile(PK);
ok(p && p.name === 'A', 'returns the parsed profile');
ok(seen.filter.kinds[0] === 0 && seen.filter.authors[0] === PK && seen.params.maxWait > 0, 'asks relays for kind 0 by this author with a wait limit');
ok(seen.relays.every(u => /^wss:\/\//.test(u)) && seen.relays.indexOf('wss://nos.lol') === seen.relays.lastIndexOf('wss://nos.lol') && seen.relays.includes('wss://relay.nsec.app') && seen.relays.includes('wss://purplepag.es') && seen.relays.length <= 8, 'relay list: site relays + profile relays, wss only, no duplicates, max 8');
behaviour = async () => ev({ pubkey: 'cd'.repeat(32) }); ok(await H.fetchProfile(PK) === null, 'event from a different key is rejected');
behaviour = async () => ev({ kind: 1 }); ok(await H.fetchProfile(PK) === null, 'wrong kind is rejected');
behaviour = async () => ev({ content: 'not json' }); ok(await H.fetchProfile(PK) === null, 'invalid JSON gives null');
behaviour = async () => ev({ content: '[1,2]' }); ok(await H.fetchProfile(PK) === null, 'JSON array gives null');
behaviour = async () => null; ok(await H.fetchProfile(PK) === null, 'no event gives null');
behaviour = async () => { throw new Error('socket'); }; ok(await H.fetchProfile(PK) === null, 'relay error gives null (never rejects)');
behaviour = () => new Promise(() => {}); ok(await H.fetchProfile(PK) === null, 'a relay that never answers is cut off by the timeout');
ok(await H.fetchProfile('xyz') === null && await H.fetchProfile('') === null && await H.fetchProfile(undefined) === null, 'bad pubkey gives null without asking relays');
ok(H.npubOf(PK) === nip19.npubEncode(PK) && /^npub1/.test(H.npubOf(PK)), 'npubOf encodes the hex key');
console.log(fails ? fails + ' FAILURES' : 'profile tests passed'); process.exit(fails ? 1 : 0);
})();
