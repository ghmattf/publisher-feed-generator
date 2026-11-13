const fs = require('fs'), xd = require('../build/node_modules/@xmldom/xmldom'), C = require(__dirname + '/../plugin/assets/js/pfg-core.js');
const dom = { DOMParser: class { parseFromString(x, t) { return new xd.DOMParser({ onError(l, m) { if (l !== 'warning') throw new Error(m); } }).parseFromString(x, t); } }, XMLSerializer: xd.XMLSerializer };
let fails = 0; const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL:', msg); } else console.log('ok  :', msg); };
const read = f => fs.readFileSync('feeds/' + f, 'utf8');

// 1. Import a publisher feed with awkward extras
const r = C.parseXml(read('phafe_like.xml'), dom);
ok(!r.error, 'publisher feed imports');
const m = r.model;
ok(m.title === 'Phafe' && m.guid === 'a9ce0ee9-fe9f-4495-b7b8-ebae25ff2112', 'title and guid read');
ok(m.npub.startsWith('npub12znrejs'), 'npub read from podcast:txt purpose=npub');
ok(m.value.recipients.length === 3 && m.releases.length === 2, 'recipients and releases read');
ok(m.releases[0].rel.join(' ') === 'label studio host' && m.releases[0].attrs.itemGuid === 'abc', 'rel tokens and extra remoteItem attribute kept');
ok(m.explicit === false, 'explicit "no" -> false');
console.log('   notes:', r.notes);
ok(r.notes.some(n => /fee/.test(n)), 'warns that the recipient "fee" attribute is unsupported');
const names = m.preserved.names;
ok(m.created === Date.UTC(2026, 9, 6, 10, 10, 6) / 1000 && !names.includes('pubDate'), 'imported pubDate becomes the creation date (not kept twice)');
['itunes:new-feed-url', 'podcast:locked', 'foo:thing', 'item', 'podcast:txt', 'itunes:category'].forEach(n => ok(names.includes(n), 'preserved ' + n));

// 2. Re-export, must be well-formed and keep the preserved content
const n = C.normalize(m, { hosted: false, platform: [], allowAttrs: true });
ok(n.errors.filter(e => !/split|recipient/i.test(e.path + e.message)).length === 0, 'no unexpected validation errors: ' + JSON.stringify(n.errors));
const xml1 = C.buildXml(n.model, [], 1794000000000);
let doc; try { doc = new xd.DOMParser({ onError(l, m2) { throw new Error(m2); } }).parseFromString(xml1, 'application/xml'); } catch (e) { doc = null; console.log(e.message); }
ok(!!doc, 'exported XML is well-formed');
['itunes:new-feed-url', 'podcast:locked', 'foo:thing', 'keep me', 'Hello <b>world</b>', 'xmlns:foo="https://example.com/ns/foo"', 'itemGuid="abc"', 'Music Commentary'].forEach(s => ok(xml1.includes(s), 'export still contains: ' + s));
ok(!xml1.includes('Old Generator') && xml1.includes('<generator>Publisher Role Generator by Phafe</generator>'), 'generator regenerated');
ok((xml1.match(/xmlns:foo=/g) || []).length === 1, 'extra namespace declared once (hoisted to <rss>)');
ok((xml1.match(/xmlns:podcast=/g) || []).length === 1, 'standard namespaces not repeated on preserved elements');

// 3. Idempotence: import the export again and rebuild -> same XML
const r2 = C.parseXml(xml1, dom);
ok(!r2.error, 'export re-imports');
const n2 = C.normalize(r2.model, { hosted: false, platform: [], allowAttrs: true });
const xml2 = C.buildXml(n2.model, [], 1794000000000);
ok(xml1 === xml2, 'import -> export -> import -> export is stable');
if (xml1 !== xml2) { const a = xml1.split('\n'), b = xml2.split('\n'); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { console.log(' line', i, '\n  1:', a[i], '\n  2:', b[i]); break; } }

// 4. Rejections
ok(C.parseXml(read('album_music.xml'), dom).error.includes('"music" feed'), 'album (medium music) is refused');
ok(/DOCTYPE/.test(C.parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><rss><channel/></rss>', dom).error), 'DOCTYPE/entities refused');
ok(!!C.parseXml('<rss><channel><title>x</title>', dom).error, 'broken XML refused');
ok(/RSS/.test(C.parseXml('<html><body/></html>', dom).error), 'non-RSS refused');
ok(/no podcast:medium/.test(C.parseXml('<rss><channel><title>x</title></channel></rss>', dom).error), 'feed without medium refused');
ok(!!C.parseXml('', dom).error, 'empty input refused');

// 5. Release inspection (link checking, per PR #793 rules)
const album = read('album_music.xml'), own = 'a9ce0ee9-fe9f-4495-b7b8-ebae25ff2112';
let i = C.inspectReleaseFeed(album, dom, own, ['label', 'studio', 'host']);
ok(i.status === 'confirmed' && i.guid === '07adf84f-c1fa-47a7-a121-0fb544e859bd' && i.title === 'Some Songs' && i.feedUrl === 'https://phafe.com/x/some_songs.xml' && i.medium === 'music', 'release feed read and link confirmed (same rel set, any order)');
i = C.inspectReleaseFeed(album, dom, own, ['host', 'studio', 'label']); ok(i.status === 'confirmed', 'rel order does not matter');
i = C.inspectReleaseFeed(album, dom, own, ['label']); ok(i.status === 'rel-mismatch' && i.theirRel.join(' ') === 'label studio host', 'differing rel sets flagged');
i = C.inspectReleaseFeed(album, dom, own, []); ok(i.status === 'confirmed', 'no rel on our side keeps the link');
i = C.inspectReleaseFeed(album, dom, '11111111-1111-4111-8111-111111111111', ['label']); ok(i.status === 'missing', 'no back-link -> missing');
i = C.inspectReleaseFeed(album.replace('ebae25ff2112', 'ebae25ff21128'), dom, own, ['label']); ok(i.status === 'missing', 'typo in back-link GUID (the 13-char bug) is caught');
console.log('snippet:\n' + C.snippetFor({ guid: own, feedUrl: 'https://phafe.com/Phafe.xml' }, ['label', 'studio']));
console.log(fails ? `\n${fails} FAILURES` : '\nall import tests passed');
process.exit(fails ? 1 : 0);
