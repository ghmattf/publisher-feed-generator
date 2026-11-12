// Unit tests for the editor-improvement helpers in pfg-core.js (feed name, dropdown lists, roles, support splits).
const fs = require('fs'); const { JSDOM } = require('../build/node_modules/jsdom');
const w = new JSDOM('<div></div>', { runScripts: 'outside-only', url: 'https://phafe.com/' }).window;
w.eval(fs.readFileSync(__dirname + '/../plugin/assets/js/pfg-core.js', 'utf8'));
const C = w.PFGCore; let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// feed name from title
ok(C.slugify('Acme Records') === 'acme-records', 'slugify: lower case, hyphens');
ok(C.slugify('Café Müller & Söhne') === 'cafe-muller-and-sohne', 'slugify: accents removed, & becomes and');
ok(C.slugify('  --Hello!!  World--  ') === 'hello-world', 'slugify: trims and collapses punctuation');
ok(C.slugify('ab') === '' && C.slugify('日本語') === '' && C.slugify('') === '', 'slugify: too short or no usable letters gives empty (user must choose)');
ok(C.slugify('x'.repeat(80)).length <= 40 && /^[a-z0-9][a-z0-9_-]{2,39}$/.test(C.slugify('x'.repeat(80))), 'slugify: at most 40 characters and always valid');
// lists
ok(C.CATEGORIES.includes('Music') && C.CATEGORIES.includes('Business') && C.LANGUAGES.some(l => l.value === 'en') && C.LANGUAGES.some(l => l.value === 'es'), 'category and language lists present');
// roles
const sp = C.splitRoles(['artist', 'host', 'songwriter', 'network', 'composer', 'musician', 'hosting', 'author', 'label', 'custom']);
ok(eq(sp.other, ['host', 'author', 'network', 'hosting']) && ['songwriter', 'composer', 'musician', 'artist', 'label', 'custom'].every(t => sp.main.includes(t)), 'roles: host, author, network, hosting move to Other roles; songwriter, composer, musician stay in the main list');
const m = C.emptyModel({}); m.guid = 'a9ce0ee9-fe9f-4495-b7b8-ebae25ff2112'; m.feedUrl = 'https://x.example/p.xml'; m.title = 'T'; m.description = 'D';
m.releases = [{ feedGuid: '07adf84f-c1fa-47a7-a121-0fb544e859bd', feedUrl: 'https://x.example/a.xml', medium: 'music', title: 'A', rel: ['songwriter', 'composer', 'musician'] }];
const res = C.normalize(m, { platform: [] });
ok(!res.errors.length && /rel="songwriter composer musician"/.test(C.buildXml(res.model, [], 1700000000)), 'new roles accepted and written to the feed');
// support splits
const plat = [{ name: 'A', address: 'a@x.com', split: 1, type: 'lnaddress' }, { name: 'B', address: 'b@x.com', split: 1, type: 'lnaddress' }];
ok(eq(C.ensureSupport([], plat).map(r => [r.address, r.split]), [['a@x.com', 1], ['b@x.com', 1]]), 'ensureSupport: defaults come from the site settings');
ok(eq(C.activePlatform(plat, [{ address: 'a@x.com', split: 0 }, { address: 'B@x.com', split: 4 }]).map(r => r.split), [4]), 'activePlatform: zero is dropped, address match ignores case');
const lifted = C.liftSupport({ value: { recipients: [{ name: 'Me', address: 'me@x.com', split: 98, type: 'lnaddress' }, { name: 'B', address: 'b@x.com', split: 2, type: 'lnaddress' }] } }, plat);
ok(eq(lifted.support, [{ address: 'a@x.com', split: 0 }, { address: 'b@x.com', split: 2 }]) && eq(lifted.value.recipients.map(r => r.address), ['me@x.com']), 'liftSupport: an import keeps exactly its own splits; unlisted support recipients become 0')
console.log(fails ? fails + ' FAILURES' : 'editor feature tests passed'); process.exit(fails ? 1 : 0);
