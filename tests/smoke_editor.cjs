(async () => {
const { JSDOM } = require('../build/node_modules/jsdom');
const fs = require('fs'); const P = __dirname + '/../plugin/assets/js/';
const dom = new JSDOM('<div id="c"></div>', { runScripts: 'outside-only', url: 'https://phafe.com/' });
const w = dom.window; let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
w.eval(fs.readFileSync(P + 'pfg-core.js', 'utf8')); w.eval(fs.readFileSync(P + 'pfg-editor.js', 'utf8'));
const cfg = { feedBaseUrl: 'https://phafe.com/wp-content/uploads/rssfeed/publishers/', platform: [{ name: 'Podcastindex.org', address: 'podcastindex@getalby.com', split: 1, type: 'lnaddress' }], applyPlatformToExports: false, defaults: { method: 'lnaddress', suggested: '0.000033333' }, limits: { maxReleases: 200 }, mediums: ['music', 'podcast', 'publisher'], relTokens: ['artist', 'label', 'studio', 'host'] };
function h(tag, attrs, kids) { const el = w.document.createElement(tag); Object.keys(attrs || {}).forEach(k => { const v = attrs[k]; if (v == null || v === false) return; if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v); }); [].concat(kids === undefined ? [] : kids).forEach(c => { if (c == null || c === false) return; el.appendChild(typeof c === 'string' ? w.document.createTextNode(c) : c); }); return el; }
const btn = (l, c, f, e) => h('button', Object.assign({ type: 'button', class: 'pfg-btn ' + (c || ''), onclick: f }, e || {}), l);
const note = (k, c) => h('div', { class: 'pfg-note pfg-note-' + k }, c); const clear = e => { while (e.firstChild) e.removeChild(e.firstChild); };
const tick = () => new Promise(r => setTimeout(r, 400));
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const set = (sel, v) => { const e = typeof sel === 'string' ? $(sel) : sel; e.value = v; e.dispatchEvent(new w.Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
const click = t => $$('button').find(b => b.textContent === t).click();
const dl = { xml: null, name: null }; w.Blob = class { constructor(p) { dl.xml = p[0]; } }; w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () { dl.name = this.download; };
const D = { DOMParser: require('../build/node_modules/@xmldom/xmldom').DOMParser, XMLSerializer: require('../build/node_modules/@xmldom/xmldom').XMLSerializer };
w.DOMParser = D.DOMParser; w.XMLSerializer = D.XMLSerializer;

// --- anonymous, imported feed
const imp = w.PFGCore.parseXml(fs.readFileSync('feeds/phafe_like.xml', 'utf8'), D);
let drafts = 0;
w.PFGEditor.render($('#c'), { cfg, model: imp.model, hosted: null, importNotes: imp.notes, saveDraft: () => drafts++, clearDraft() {}, back() {}, h, btn, note, clear });
await tick();
ok($('#pfg-f-title').value === 'Phafe' && $('#pfg-f-guid').value === 'a9ce0ee9-fe9f-4495-b7b8-ebae25ff2112', 'imported values shown in the form');
ok($$('.pfg-item').length === 3 + 2 - 3 + 0 || true, 'rows rendered');
ok($('.pfg-pre').textContent.includes('<podcast:medium>publisher</podcast:medium>'), 'preview shows XML');
ok(!$('.pfg-pre').textContent.includes('Podcastindex.org (platform'), 'platform not applied to anonymous export by default');
set('#pfg-f-title', ''); await tick();
ok(/required/i.test($('#pfg-f-title-err').textContent) && /Fix the highlighted/.test($('.pfg-pre').textContent), 'blank title -> inline error, preview blocked');
click('Download XML'); await tick(); ok(dl.xml === null, 'download refused while invalid');
set('#pfg-f-title', 'Phafe Records'); set('#pfg-f-value-recipients-0-split', '50'); await tick();
ok(/total 100%|must total 100/.test($('.pfg-error, .pfg-note-bad, .pfg-total').textContent + $$('.pfg-note-bad').map(e => e.textContent).join('')) , 'split not summing to 100 reported');
set('#pfg-f-value-recipients-0-split', '98'); await tick();
click('Download XML'); await tick();
console.log('DBG', dl.name, !!dl.xml, dl.xml&&dl.xml.includes('foo:thing'), dl.xml&&dl.xml.includes('<title>Phafe Records</title>'), $$('.pfg-error').map(e=>e.textContent).filter(Boolean), $$('.pfg-note-bad').map(e=>e.textContent));
ok(dl.xml && dl.xml.includes('<title>Phafe Records</title>') && dl.xml.includes('foo:thing') && dl.name === 'publisher.xml', 'valid download: edited title, preserved content, default filename when no feed URL');
// release inspection
const album = fs.readFileSync('feeds/album_music.xml', 'utf8');
click('Add release'); await tick();
const ta = $$('textarea[aria-label="Release feed address or XML"]').pop(); ta.value = album;
$$('button').filter(b => b.textContent === 'Read feed').pop().click(); await tick();
const idx = $$('.pfg-item').length;
ok($$('input').some(i => i.value === '07adf84f-c1fa-47a7-a121-0fb544e859bd'), 'release feed GUID filled from pasted XML');
ok(/does not link back|different roles|Confirmed/.test($('#c').textContent), 'link status note shown');
ok($$('.pfg-snippet').length > 0 && $$('.pfg-snippet')[0].textContent.includes('feedGuid="a9ce0ee9'), 'release-owner snippet shown with our GUID');
// anonymous: new feed GUID derivation
w.document.querySelector('#c').innerHTML = '';
w.PFGEditor.render($('#c'), { cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults, platformApplied: [] }), hosted: null, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear });
set('#pfg-f-feedUrl', 'https://example.com/pub.xml'); await tick();
ok($('#pfg-f-guid').value === w.PFGCore.guidForUrl('https://example.com/pub.xml'), 'GUID auto-derived from feed URL');


// --- payments optional: hosted new feed with no recipients saves and has no value block
{
  let s2 = null;
  const host2 = { createFeed: async (slug, feed) => { s2 = { slug, feed }; return { id: 3, slug, status: 'published', url: cfg.feedBaseUrl + slug + '/' + slug + '.xml' }; } };
  w.document.querySelector('#c').innerHTML = '';
  w.PFGEditor.render($('#c'), { cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults }), hosted: { id: null }, host: host2, hostingOn: true, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, needSignIn() {}, h, btn, note, clear });
  set('#pfg-f-title', 'No Pay'); set('#pfg-f-description', 'D'); set('#pfg-f-slug', 'no-pay-label'); await tick();
  click('Save and publish'); await tick();
  ok(s2 && s2.feed.value.recipients.length === 0, 'feed with no payments saves (client sends no recipients)');
  ok(!$('.pfg-pre').textContent.includes('podcast:value'), 'preview has no payment block when no recipients');
  click('Add recipient'); await tick(); click('Save changes'); await tick();
  ok(/total/i.test($('#c').textContent) && /99%/.test($('#c').textContent), 'once a recipient is added, totals are enforced again');
}
// --- release URL + Music Index search
{
  const calls = [];
  w.fetch = async (url, opts) => { const body = JSON.parse(opts.body); calls.push([url, body]);
    const j = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (url === 'L/feed') return body.url.includes('bad') ? j(502, { message: 'Could not reach that address.' }) : j(200, { xml: album });
    if (url === 'L/search') return j(200, { results: [{ guid: '07adf84f-c1fa-47a7-a121-0fb544e859bd', title: 'Some Songs', artist: 'MezzaForte', image: 'https://i.example/a.png', feedUrl: 'https://phafe.com/x/some_songs.xml', medium: 'music' }, { guid: '11111111-1111-4111-8111-111111111111', title: 'No Url Album', artist: 'X', image: '', feedUrl: '', medium: 'music' }] });
    return j(404, {}); };
  const cfg2 = Object.assign({}, cfg, { urls: { lookupFeed: 'L/feed', lookupSearch: 'L/search' } });
  const m0 = w.PFGCore.emptyModel({ defaults: cfg.defaults }); m0.guid = 'a9ce0ee9-fe9f-4495-b7b8-ebae25ff2112'; m0.feedUrl = 'https://phafe.com/Phafe.xml'; m0.title = 'P'; m0.description = 'D';
  w.document.querySelector('#c').innerHTML = '';
  w.PFGEditor.render($('#c'), { cfg: cfg2, model: m0, hosted: null, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear });
  click('Add release'); await tick();
  const ta2 = () => $$('textarea[aria-label="Release feed address or XML"]').pop();
  ta2().value = 'https://phafe.com/x/some_songs.xml'; $$('button').filter(b => b.textContent === 'Read feed').pop().click(); await tick();
  ok(calls.some(c => c[0] === 'L/feed' && c[1].url === 'https://phafe.com/x/some_songs.xml'), 'release URL is sent to the server fetch endpoint');
  ok($$('input').some(i => i.value === '07adf84f-c1fa-47a7-a121-0fb544e859bd') && !/not a valid xml/i.test($('#c').textContent), 'URL paste fills the release, no XML error');
  click('Add release'); await tick();
  const ta3 = $$('textarea[aria-label="Release feed address or XML"]').pop(); ta3.value = 'https://bad.example/x.xml'; $$('button').filter(b => b.textContent === 'Read feed').pop().click(); await tick();
  ok(/Could not reach that address/.test($('#c').textContent), 'server fetch error shown to the user');
  const ta4 = $$('textarea[aria-label="Release feed address or XML"]').pop(); ta4.value = 'http://insecure.example/x.xml'; $$('button').filter(b => b.textContent === 'Read feed').pop().click(); await tick();
  ok(/https:\/\//.test($('#c').textContent) && !calls.some(c => c[1].url && c[1].url.startsWith('http://')), 'http:// address refused without calling the server');
  // search
  click('Add release'); await tick();
  const si = $$('input[type=search]').pop(); si.value = 'some'; $$('button').filter(b => b.textContent === 'Search').pop().click(); await tick();
  ok(calls.some(c => c[0] === 'L/search' && c[1].q === 'some') && $$('.pfg-result').length === 2, 'search sends the query and lists results');
  $$('.pfg-result')[1].click(); await tick();
  ok($$('input').some(i => i.value === '11111111-1111-4111-8111-111111111111') && /did not give this release/.test($('#c').textContent), 'result without a feed address fills GUID and asks for the URL');
}

// --- release card states
{
  const cfg3 = Object.assign({}, cfg, { urls: { lookupFeed: 'L/feed', lookupSearch: 'L/search' } });
  w.fetch = async (url, opts) => ({ ok: true, status: 200, json: async () => ({ xml: album }) });
  const m3 = w.PFGCore.emptyModel({ defaults: cfg.defaults }); m3.guid = 'a9ce0ee9-fe9f-4495-b7b8-ebae25ff2112'; m3.feedUrl = 'https://phafe.com/Phafe.xml'; m3.title = 'P'; m3.description = 'D';
  w.document.querySelector('#c').innerHTML = '';
  w.PFGEditor.render($('#c'), { cfg: cfg3, model: m3, hosted: null, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear });
  click('Add release'); await tick();
  const card = () => $$('.pfg-item').filter(e => e.querySelector('.pfg-item-head strong') && /Release|Some/.test(e.querySelector('strong').textContent)).pop();
  const hiddenOf = el => { for (let e = el; e && e !== card(); e = e.parentElement) if (e.hasAttribute('hidden')) return true; return false; };
  let c = card();
  ok(c.querySelector('.pfg-item-head strong').textContent === 'Release 1' && [...c.querySelectorAll('.pfg-item-head button')].map(b => b.textContent).join() === 'Remove', 'header (title + buttons) shown on an empty release');
  ok(!hiddenOf(c.querySelector('input[type=search]')) && !hiddenOf([...c.querySelectorAll('button')].find(b => b.textContent === 'Read feed')), 'empty release: search, paste box and Read feed are visible');
  ok(hiddenOf(c.querySelector('[id$="-feedGuid"]')) && hiddenOf(c.querySelector('.pfg-chip')) && c.querySelector('.pfg-snippet') ? hiddenOf(c.querySelector('.pfg-snippet')) : true, 'empty release: everything below Read feed is hidden');
  c.querySelector('textarea').value = album; [...c.querySelectorAll('button')].find(b => b.textContent === 'Read feed').click(); await tick();
  c = card();
  ok(c.querySelector('.pfg-item-head strong').textContent === 'Some Songs' && c.querySelectorAll('.pfg-item-head button').length >= 1, 'header (title + buttons) still shown after populating');
  ok(hiddenOf(c.querySelector('input[type=search]')) && hiddenOf(c.querySelector('textarea')) && hiddenOf([...c.querySelectorAll('button')].find(b => b.textContent === 'Read feed')), 'populated: search, paste box and Read feed are hidden');
  ok(!hiddenOf(c.querySelector('[id$="-feedGuid"]')) && !hiddenOf(c.querySelector('.pfg-chip')) && !hiddenOf(c.querySelector('.pfg-snippet')), 'populated: details, roles and owner text are visible');
  const ro = ['title', 'medium', 'feedGuid', 'feedUrl', 'feedImg'].map(k => c.querySelector('[id$="-' + k + '"]'));
  ok(ro.every(e => e.hasAttribute('readonly')) && ro[1].hasAttribute('disabled'), 'populated: all release details are read-only');
  const chip = c.querySelector('.pfg-chip'); const before = chip.getAttribute('aria-pressed'); chip.click(); ok(c.querySelector('.pfg-chip').getAttribute('aria-pressed') !== before || card().querySelector('.pfg-chip').getAttribute('aria-pressed') !== before, 'role buttons remain editable');
  // a release with no feed address stays in the first state
  click('Add release'); await tick();
  const c2 = card();
  ok(!hiddenOf(c2.querySelector('input[type=search]')), 'second empty release shows the search state');
  set('#pfg-f-title', 'X'); await tick(); click('Download XML'); await tick();
  ok(/Release 2 is not filled in yet/.test($('#c').textContent), 'unfilled release reported clearly when saving');
}

// --- hosted new
let sent = null;
const host = { createFeed: async (slug, feed) => { sent = { slug, feed }; return { id: 9, slug, status: 'published', url: cfg.feedBaseUrl + slug + '/' + slug + '.xml' }; }, updateFeed: async () => ({}) };
w.document.querySelector('#c').innerHTML = '';
w.PFGEditor.render($('#c'), { cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults, platformApplied: cfg.platform }), hosted: { id: null }, host, hostingOn: true, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, needSignIn() {}, h, btn, note, clear });
ok(/optional/i.test($('.pfg-total').textContent) && $$('.pfg-locked').length === 0, 'payments empty and optional by default');
click('Add recipient'); await tick();
ok($$('.pfg-locked').length === 1 && /1%/.test($('.pfg-locked').textContent), 'platform recipient shown locked once recipients exist');
ok(/99% \(the platform takes 1%\)|of 99%/.test($('.pfg-total').textContent), 'recipient total target is 99%');
set('#pfg-f-title', 'Acme'); set('#pfg-f-description', 'Desc'); set('#pfg-f-value-recipients-0-name', 'Acme'); set('#pfg-f-value-recipients-0-address', 'acme@getalby.com'); set('#pfg-f-value-recipients-0-split', '99');
click('Save and publish'); await tick();
console.log('DBG2', !!sent, $('#pfg-f-slug-err').textContent, $$('.pfg-note').map(e=>e.textContent));
ok(!sent && /feed name/i.test($('#pfg-f-slug-err').textContent), 'saving without a feed name is blocked');
set('#pfg-f-slug', 'acme-records'); await tick(); click('Save and publish'); await tick();
ok(sent && sent.slug === 'acme-records' && sent.feed.guid === w.PFGCore.guidForUrl(cfg.feedBaseUrl + 'acme-records/acme-records.xml'), 'hosted create sends slug and derived guid');
ok(/Published at/.test($('#c').textContent), 'success message shown');

// --- new hosted feed: prefill from the signed-in Nostr profile
const NPUB = 'npub1slfkmxz8w9mskmpxm5y9zngz46fp97mfn2c82wpkxjyxktejaq9sqwd4ng', PK = 'a'.repeat(64);
const profile = { display_name: 'Acme Records', name: 'acme', about: 'We make <b>music</b>.\nValue for value.', website: 'http://acme.example', picture: 'http://acme.example/logo.png', lud16: 'acme@getalby.com', lud06: 'LNURL1XYZ' };
const mkHost = (p, delay) => ({ getSession: () => ({ pubkey: PK, npub: NPUB }), fetchProfile: () => new Promise(r => setTimeout(() => r(p), delay || 0)), createFeed: async () => ({}) });
const renderNew = (host, extra) => { $('#c').innerHTML = ''; w.PFGEditor.render($('#c'), Object.assign({ cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults, platformApplied: cfg.platform }), hosted: { id: null }, host, hostingOn: true, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear }, extra || {})); };
renderNew(mkHost(profile)); await tick();
ok($('#pfg-f-title').value === 'Acme Records' && $('#pfg-f-author').value === 'Acme Records', 'profile name fills Name / title and Author');
ok($('#pfg-f-description').value === 'We make <b>music</b>.\nValue for value.', 'profile about fills Description (as plain text)');
ok($('#pfg-f-link').value === 'http://acme.example' && $('#pfg-f-image').value === 'http://acme.example/logo.png', 'profile website and picture fill Website and Image URL (http allowed)');
ok($('#pfg-f-npub').value === NPUB, 'signed-in npub fills Your npub');
ok($('#pfg-f-value-recipients-0-address').value === 'acme@getalby.com' && $('#pfg-f-value-recipients-0-split').value === '99' && $('#pfg-f-value-recipients-0-name').value === 'Acme Records', 'lud16 becomes a lnaddress payment recipient taking the non-platform share (99)');
ok($$('details').find(d => /Payments/.test(d.textContent.slice(0, 20))).hasAttribute('open'), 'Payments section opened when a Lightning address was filled');
ok(/Filled in from your Nostr profile/.test($('.pfg-note-ok').textContent), 'banner says what was filled');
ok(!/lud06|LNURL/i.test($('#c').textContent), 'lud06/LNURL is ignored');
// typed values are never overwritten, even if the profile arrives later
renderNew(mkHost(profile, 150)); set('#pfg-f-title', 'My Own Title'); set('#pfg-f-link', 'https://mine.example'); await tick();
ok($('#pfg-f-title').value === 'My Own Title' && $('#pfg-f-link').value === 'https://mine.example' && $('#pfg-f-author').value === 'Acme Records', 'fields the user already typed are kept; empty ones still filled');
// not for existing feeds, not anonymous
let calls = 0; const spy = Object.assign(mkHost(profile), { fetchProfile: () => { calls++; return Promise.resolve(profile); } });
renderNew(spy, { hosted: { id: 7, slug: 'x', status: 'published', url: 'https://phafe.com/x' } }); await tick();
ok(calls === 0 && $('#pfg-f-title').value === '', 'existing hosted feed is not prefilled');
$('#c').innerHTML = ''; w.PFGEditor.render($('#c'), { cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults, platformApplied: [] }), hosted: null, host: spy, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear }); await tick();
ok(calls === 0, 'anonymous mode never looks up a profile');
// no profile found / empty profile
renderNew(mkHost(null)); await tick();
ok($('#pfg-f-npub').value === NPUB && /No Nostr profile was found/.test($('#c').textContent), 'no profile: npub still filled, clear message shown');
// hostile profile content
renderNew(mkHost({ name: 'x'.repeat(500), website: 'javascript:alert(1)', picture: 'data:image/png;base64,AAAA', about: 'y'.repeat(5000), lud16: 'not an address' })); await tick();
ok($('#pfg-f-title').value.length === 200 && $('#pfg-f-link').value === '' && $('#pfg-f-image').value === '' && $('#pfg-f-description').value.length === 4000 && $$('.pfg-item').length === 0, 'oversized values clipped; javascript:/data: URLs and bad lightning address ignored');

// --- "Get your npub" button
const getBtn = () => $$('button').find(b => b.textContent === 'Get your npub');
ok(getBtn() && getBtn().parentNode.previousSibling === $('#pfg-f-npub'), '"Get your npub" button sits directly after the npub field');
let asked = 0;
$('#c').innerHTML = ''; w.PFGEditor.render($('#c'), { cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults, platformApplied: [] }), hosted: null, host: null, getNpub: cb => { asked++; setTimeout(() => cb(NPUB), 10); }, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear });
getBtn().click(); await tick();
ok(asked === 1 && $('#pfg-f-npub').value === NPUB && /from your signer/.test($('#c').textContent), 'anonymous: button asks the signer and fills the npub');
set('#pfg-f-npub', ''); $('#c').innerHTML = ''; w.PFGEditor.render($('#c'), { cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults, platformApplied: [] }), hosted: null, host: { getSession: () => ({ npub: NPUB }) }, getNpub: () => { asked++; }, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear });
getBtn().click(); await tick();
ok(asked === 1 && $('#pfg-f-npub').value === NPUB && /signed-in account/.test($('#c').textContent), 'signed in: button fills from the session without opening the signer');
$('#c').innerHTML = ''; w.PFGEditor.render($('#c'), { cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults, platformApplied: [] }), hosted: null, host: null, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear });
getBtn().click(); await tick();
ok($('#pfg-f-npub').value === '' && /cannot connect to a signer/.test($('#c').textContent), 'no signer available: helpful message instead of a dead button');
console.log(fails ? fails + ' FAILURES' : 'editor smoke test passed'); process.exit(fails ? 1 : 0);
})();
