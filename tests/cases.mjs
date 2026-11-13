import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const npubs = require('./vectors.json').npubs;
const G1 = '07adf84f-c1fa-47a7-a121-0fb544e859bd', G2 = '9620e1f8-0cca-5f08-b947-1c8f93244ff8', G3 = 'a9ce0ee9-fe9f-4495-b7b8-ebae25ff2112';
const base = () => ({
  title: 'Phafe', author: 'Phafe Records', description: 'A label & studio for "value for value" music.', link: 'https://phafe.com',
  language: 'en', image: 'https://phafe.com/img/phafe.png', category: 'Music', keywords: 'music, v4v', explicit: false,
  ownerName: 'Phafe', ownerEmail: 'hello@phafe.com', npub: npubs[0].npub,
  funding: { url: 'https://phafe.com/support', text: 'Support Phafe' },
  value: { method: 'lnaddress', suggested: '0.000033333', recipients: [{ name: 'Phafe', address: 'phafe@getalby.com', split: 99, type: 'lnaddress' }] },
  releases: [{ feedGuid: G1, feedUrl: 'https://phafe.com/x/some_songs.xml', medium: 'music', title: 'Some Songs', feedImg: 'https://phafe.com/x/a.png', rel: ['label', 'studio', 'host'] }],
});
const P1 = [{ name: 'Podcastindex.org', address: 'podcastindex@getalby.com', split: 1, type: 'lnaddress' }];
const cases = [];
const add = (name, input, opts) => cases.push({ name, input, opts });
const hosted = { hosted: true, guid: G3, feedUrl: 'https://phafe.com/wp-content/uploads/rssfeed/publishers/phafe/phafe.xml', platform: P1, maxReleases: 200, defaultMethod: 'lnaddress', allowAttrs: false };
const anon = { hosted: false, platform: [], maxReleases: 200, defaultMethod: 'lnaddress', allowAttrs: true };

add('hosted full', base(), hosted);
add('hosted minimal', { title: 'T', description: 'D', value: { recipients: [{ name: 'Me', address: 'me@x.io', split: 99 }] } }, hosted);
add('anon full', { ...base(), guid: G3.toUpperCase(), feedUrl: 'https://example.com/pub.xml', value: { ...base().value, recipients: [{ name: 'Phafe', address: 'phafe@getalby.com', split: 100, type: 'lnaddress' }] } }, anon);
add('anon no payments', { ...base(), guid: G3, feedUrl: 'https://example.com/pub.xml', value: { recipients: [] }, funding: {} }, anon);
add('special chars', { ...base(), title: 'Tom & Jerry <b> "q" \'s', description: 'Line1\r\nLine2\rLine3\n\n  spaced  \u0001ctrl\u007f', author: 'Ünï ✓ 日本語 🎵', keywords: 'a\tb\nc' }, hosted);
add('whitespace', { ...base(), title: '   lots   of\t\tspace  ', description: '\n\n  x  \n\n' }, hosted);
add('created int', { ...base(), created: 1700000000 }, hosted);
add('created float', { ...base(), created: 1700000000.9 }, hosted);
add('created digits text', { ...base(), created: '1700000000' }, hosted);
add('created zero/negative', { ...base(), created: 0 }, hosted);
add('created negative', { ...base(), created: -5 }, hosted);
add('created too big', { ...base(), created: 99999999999 }, hosted);
add('created bool/null/text', { ...base(), created: true }, hosted);
add('created null', { ...base(), created: null }, hosted);
add('created junk text', { ...base(), created: '17e8' }, anon);
add('created int anon', { ...base(), guid: G3, feedUrl: 'https://example.com/pub.xml', created: 1700000000 }, anon);
add('explicit variants', { ...base(), explicit: 'true' }, hosted);
add('explicit 1', { ...base(), explicit: 1 }, hosted);
add('npub hex input', { ...base(), npub: npubs[3].hex }, hosted);
add('npub invalid', { ...base(), npub: 'npub1' + 'q'.repeat(58) }, hosted);
add('nsec pasted', { ...base(), npub: 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5' }, hosted);
add('node recipient', { ...base(), value: { method: 'keysend', suggested: '0.00001', recipients: [{ name: 'Node', address: '02' + 'ab'.repeat(32), split: 99, type: 'node', customKey: '696969', customValue: 'abc123' }] } }, hosted);
add('node bad', { ...base(), value: { recipients: [{ name: 'Node', address: 'zz', split: 99, type: 'node', customKey: 'x', customValue: 'é' }] } }, hosted);
add('bad splits total', { ...base(), value: { recipients: [{ name: 'A', address: 'a@b.co', split: 50 }, { name: 'B', address: 'b@b.co', split: 20 }] } }, hosted);
add('bad splits no platform', { ...base(), value: { recipients: [{ name: 'A', address: 'a@b.co', split: 50 }] } }, { ...hosted, platform: [] });
add('no recipients w/ platform', { ...base(), value: { recipients: [] } }, hosted);
add('split strings', { ...base(), value: { recipients: [{ name: 'A', address: 'a@b.co', split: '99' }, ] } }, hosted);
add('split bad', { ...base(), value: { recipients: [{ name: 'A', address: 'a@b.co', split: 'lots' }, { name: '', address: 'nope', split: 0 }, { name: 'C', address: 'c@d.ee', split: 101 }] } }, hosted);
add('suggested sci', { ...base(), value: { ...base().value, suggested: '5e-8' } }, hosted);
add('bad method', { ...base(), value: { ...base().value, method: 'carrier-pigeon' } }, hosted);
add('everything invalid', { title: '', description: '', link: 'http://insecure', image: 'ftp://x', language: 'English!', category: 'x'.repeat(101), keywords: 'k'.repeat(301), ownerEmail: 'not an email', funding: { url: 'https://a.b/c', text: '' }, releases: [{ feedGuid: 'nope', feedUrl: 'http://x', medium: 'weird', title: 't'.repeat(201), feedImg: 'gopher://x', rel: ['Bad Role!', 'a'.repeat(40)] }] }, hosted);
add('anon missing identity', { title: 'T', description: 'D', guid: 'not-a-uuid', feedUrl: 'http://x', value: { recipients: [] } }, anon);
add('anon empty guid', { title: 'T', description: 'D' }, anon);
add('releases dup+self', { ...base(), releases: [{ feedGuid: G1, feedUrl: 'https://a.b/c.xml', rel: 'artist' }, { feedGuid: G1.toUpperCase(), feedUrl: 'https://a.b/d.xml' }, { feedGuid: G3, feedUrl: 'https://a.b/e.xml' }] }, hosted);
add('rel normalisation', { ...base(), releases: [{ feedGuid: G1, feedUrl: 'https://a.b/c.xml', rel: ['Artist', 'artist', ' HOST ', 'producer'] }] }, hosted);
add('rel string', { ...base(), releases: [{ feedGuid: G1, feedUrl: 'https://a.b/c.xml', rel: '  artist   host  ' }] }, hosted);
add('rel too many', { ...base(), releases: [{ feedGuid: G1, feedUrl: 'https://a.b/c.xml', rel: ['a1','a2','a3','a4','a5','a6','a7','a8','a9'] }] }, hosted);
add('attrs allowed (anon)', { ...base(), guid: G3, feedUrl: 'https://example.com/pub.xml', value: { recipients: [{ name: 'A', address: 'a@b.co', split: 100 }] }, releases: [{ feedGuid: G1, feedUrl: 'https://a.b/c.xml', attrs: { itemGuid: 'abc"&<', 'bad name': 'x', feedGuid: 'zzz', z: '1', a: '2' } }] }, anon);
add('attrs ignored (hosted)', { ...base(), releases: [{ feedGuid: G1, feedUrl: 'https://a.b/c.xml', attrs: { itemGuid: 'abc' } }] }, hosted);
add('many releases cap', { ...base(), releases: Array.from({ length: 5 }, (_, i) => ({ feedGuid: `00000000-0000-4000-8000-00000000000${i}`, feedUrl: 'https://a.b/c' + i + '.xml', rel: ['artist'] })) }, { ...hosted, maxReleases: 3 });
add('too many recipients', { ...base(), value: { recipients: Array.from({ length: 11 }, (_, i) => ({ name: 'R' + i, address: `r${i}@x.io`, split: 9 })) } }, { ...hosted, platform: [] });
add('long fields', { ...base(), title: 'T'.repeat(201), author: 'A'.repeat(201), description: 'D'.repeat(4001) }, hosted);
add('unicode length', { ...base(), title: '🎵'.repeat(200) }, hosted);
add('language case', { ...base(), language: 'EN-AU' }, hosted);
add('url with spaces', { ...base(), link: 'https://phafe.com/a b' }, hosted);
add('url with creds', { ...base(), link: 'https://user:pw@phafe.com/' }, hosted);
add('http website and image allowed', { ...base(), link: 'http://phafe.com', image: 'http://phafe.com/img/phafe.png' }, hosted);
add('http uppercase scheme', { ...base(), guid: G3, feedUrl: 'https://example.com/pub.xml', value: { ...base().value, recipients: [{ name: 'Phafe', address: 'phafe@getalby.com', split: 100, type: 'lnaddress' }] }, link: 'HTTP://phafe.com/Path', image: 'HTTPS://phafe.com/a.png' }, anon);
add('ftp website refused', { ...base(), link: 'ftp://phafe.com' }, hosted);
add('javascript image refused', { ...base(), image: 'javascript:alert(1)' }, hosted);
add('http release feed url still refused', { ...base(), releases: [{ ...base().releases[0], feedUrl: 'http://phafe.com/x/some_songs.xml' }] }, hosted);
add('http funding link still refused', { ...base(), funding: { url: 'http://phafe.com/support', text: 'x' } }, hosted);
add('non-object input', 'garbage', hosted);
add('empty object', {}, hosted);
add('json null fields', { ...base(), title: null, author: null, funding: null, value: null, releases: null }, hosted);
add('two platform recipients', base(), { ...hosted, platform: [{ name: 'MSP 2.0', address: 'msp@getalby.com', split: 5, type: 'lnaddress' }, { name: 'Podcastindex.org', address: 'podcastindex@getalby.com', split: 4, type: 'lnaddress' }] });
fs.writeFileSync('cases.json', JSON.stringify(cases));
console.log(cases.length, 'cases');
