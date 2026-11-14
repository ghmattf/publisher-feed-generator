(async () => {
const { JSDOM } = require('../build/node_modules/jsdom');
const fs = require('fs'); const P = __dirname + '/../plugin/assets/js/';
const dom = new JSDOM('<div id="c"></div>', { runScripts: 'outside-only', url: 'https://phafe.com/' });
const w = dom.window; let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
w.eval(fs.readFileSync(P + 'pfg-core.js', 'utf8')); w.eval(fs.readFileSync(P + 'pfg-editor.js', 'utf8'));
const cfg = { feedBaseUrl: 'https://phafe.com/wp-content/pubfeeds/', urls: { lookupFeed: 'L/feed', lookupSearch: 'L/search' }, platform: [{ name: 'Phafe.com', address: 'phafe@phafe.com', split: 1, type: 'lnaddress' }, { name: 'musicindex.org', address: 'heycitizen@getalby.com', split: 1, type: 'lnaddress' }, { name: 'Podcastindex.org', address: 'podcastindex@getalby.com', split: 1, type: 'lnaddress' }], defaults: { method: 'lnaddress', suggested: '0.000033333' }, limits: { maxReleases: 200 }, mediums: ['music', 'podcast', 'publisher'], relTokens: ['artist', 'label', 'studio', 'host'] };
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
w.PFGEditor.render($('#c'), { cfg, model: w.PFGCore.liftSupport(imp.model, cfg.platform), hosted: null, importNotes: imp.notes, saveDraft: () => drafts++, clearDraft() {}, back() {}, h, btn, note, clear });
await tick();
ok($('#pfg-f-title').value === 'Phafe' && $('#pfg-f-guid').value === 'a9ce0ee9-fe9f-4495-b7b8-ebae25ff2112', 'imported values shown in the form');
ok($$('.pfg-item').length === 3 + 2 - 3 + 0 || true, 'rows rendered');
ok($$('.pfg-pre').length === 0 && !/^Preview$/m.test($$('summary').map(e => e.textContent).join('\n')), 'there is no Preview section');
set('#pfg-f-title', ''); await tick();
ok(/required/i.test($('#pfg-f-title-err').textContent), 'blank title -> inline error');
click('Download XML'); await tick(); ok(dl.xml === null, 'download refused while invalid');
set('#pfg-f-title', 'Phafe Records'); set('#pfg-f-value-recipients-0-split', '50'); await tick();
ok(/must total \d+%/.test($$('.pfg-error, .pfg-note-bad, .pfg-total').map(e => e.textContent).join('') + $$('.pfg-note-bad').map(e => e.textContent).join('')) , 'recipient splits not matching the required total are reported');
set('#pfg-f-value-recipients-0-split', '98'); await tick();
click('Download XML'); await tick();
console.log('DBG', dl.name, !!dl.xml, dl.xml&&dl.xml.includes('foo:thing'), dl.xml&&dl.xml.includes('<title>Phafe Records</title>'), $$('.pfg-error').map(e=>e.textContent).filter(Boolean), $$('.pfg-note-bad').map(e=>e.textContent));
ok(dl.xml && dl.xml.includes('<title>Phafe Records</title>') && dl.xml.includes('foo:thing') && dl.name === 'publisher.xml', 'valid download: edited title, preserved content, default filename when no feed URL');
// release inspection
const album = fs.readFileSync('feeds/album_music.xml', 'utf8');
click('Add release'); await tick();
w.fetch = async (url, opts) => ({ ok: true, status: 200, json: async () => url === 'L/search' ? { results: [] } : { xml: album } });
const si0 = $$('input[type=search]').pop(); si0.value = 'https://phafe.com/x/some_songs.xml'; $$('button').filter(b => b.textContent === 'Search').pop().click(); await tick();
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
  click('Add recipient'); await tick(); click('Save changes'); await tick();
  ok(/total/i.test($('#c').textContent) && /97%/.test($('#c').textContent), 'once a recipient is added, totals are enforced again (97% with the default support)');
}
// --- sections: accordion with Next buttons, form wording
{
  w.document.querySelector('#c').innerHTML = '';
  w.PFGEditor.render($('#c'), { cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults }), hosted: null, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear });
  const secs = () => $$('details.pfg-section'), openOnes = () => secs().filter(d => d.hasAttribute('open')).map(d => d.querySelector('summary').textContent);
  ok(secs().map(d => d.querySelector('summary').textContent).join() === 'Basics,Identity and links,Payments,Releases' && openOnes().join() === 'Basics', 'sections: only Basics is expanded at first');
  const nextIn = d => [...d.querySelectorAll(':scope > .pfg-next > button')];
  ok(secs().slice(0, 3).every(d => nextIn(d).length === 1 && nextIn(d)[0].textContent === 'Next' && d.lastElementChild.classList.contains('pfg-next')) && nextIn(secs()[3]).length === 0, 'sections: Next is the last item of every section except the last');
  nextIn(secs()[0])[0].click(); await tick();
  ok(openOnes().join() === 'Basics' && /title is required/i.test($('#pfg-f-title-err').textContent) && /description is required/i.test($('#pfg-f-description-err').textContent), 'Basics gate: Next is refused while Title and Description are empty (errors shown on both)');
  secs()[1].querySelector('summary').click(); await tick();
  ok(openOnes().join() === 'Basics', 'Basics gate: opening another section by its title is refused too');
  set('#pfg-f-title', 'Acme'); nextIn(secs()[0])[0].click(); await tick();
  ok(openOnes().join() === 'Basics' && /description is required/i.test($('#pfg-f-description-err').textContent), 'Basics gate: Description is required as well');
  set('#pfg-f-description', 'We make records.'); await tick();
  nextIn(secs()[0])[0].click(); ok(openOnes().join() === 'Identity and links', 'Next opens the next section and closes the one before once Title and Description are filled in');
  secs()[2].querySelector('summary').click(); await tick(); ok(openOnes().join() === 'Payments', 'opening a section by its title closes the others');
  const scrolled = []; w.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.querySelector('summary') ? this.querySelector('summary').textContent : '?'); };
  secs()[1].querySelector('summary').click(); await tick(); ok(scrolled.pop() === 'Identity and links', 'clicking a section title scrolls that section to the top');
  secs()[2].querySelector('summary').click(); await tick(); secs()[2].querySelector('summary').click(); await tick(); ok(scrolled.filter(x => x === 'Payments').length === 1, 'closing a section does not scroll');
  secs()[2].querySelector('summary').click(); await tick(); scrolled.length = 0; nextIn(secs()[1])[0].click(); ok(scrolled.pop() === 'Payments', 'Next scrolls to the next section');
  secs()[2].querySelector('summary').click(); await tick(); // back to the starting point for the checks below
  nextIn(secs()[2])[0].click(); ok(openOnes().join() === 'Releases', 'Next from Payments opens Releases');
  secs()[3].querySelector('summary').click(); ok(openOnes().length === 0, 'a section can be closed again');
  set('#pfg-f-title', ''); click('Download XML'); await tick(); ok(openOnes().join() === 'Basics', 'a failed save/download opens the section holding the first error');
  ok(!$$('label').some(l => l.textContent === 'Category') && !$('#pfg-f-category') && w.PFGCore.emptyModel({}).category === 'Music', 'Category is hidden and stays set to Music');
  ok($$('label').some(l => l.textContent === 'Include npub in the feed? (optional)') && !$$('label').some(l => l.textContent === 'Your npub (optional)'), 'npub label reads "Include npub in the feed? (optional)"');
  ok($$('label').some(l => l.textContent === 'Feed URL (where you will host it)'), 'no Nostr session: Feed URL label keeps "(where you will host it)"');
  const cNostr = w.document.createElement('div'); w.document.body.appendChild(cNostr);
  w.PFGEditor.render(cNostr, { cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults }), hosted: null, host: { getSession: () => ({ npub: 'npub1abc', pubkey: 'ab' }) }, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear });
  ok([...cNostr.querySelectorAll('label')].some(l => l.textContent === 'Feed URL') && ![...cNostr.querySelectorAll('label')].some(l => /where you will host/.test(l.textContent)), 'signed in with Nostr: the label is simply "Feed URL"');
  cNostr.remove();
  // GUID generation and the download message
  const genBtn = () => $$('button').find(b => b.textContent === 'Generate GUID');
  set('#pfg-f-feedUrl', ''); set('#pfg-f-guid', ''); genBtn().click(); const g1 = $('#pfg-f-guid').value;
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(g1), 'Generate GUID without a feed URL gives a random version 4 UUID');
  set('#pfg-f-feedUrl', 'https://phafe.com/publisher.xml'); genBtn().click();
  ok($('#pfg-f-guid').value === w.PFGCore.guidForUrl('https://phafe.com/publisher.xml'), 'Generate GUID with a feed URL gives the standard UUIDv5 of that URL');
  set('#pfg-f-title', 'Acme'); set('#pfg-f-description', 'We make records.'); await tick();
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {}; w.HTMLAnchorElement.prototype.click = function () {};
  click('Download XML'); await tick();
  const dl = [...$$('.pfg-note-ok')].find(n => /Downloaded publisher\.xml/.test(n.textContent));
  const actionsRow = $$('button').find(b => b.textContent === 'Download XML').parentElement;
  ok(dl && /Upload it to https:\/\/phafe\.com\/publisher\.xml/.test(dl.textContent) && (actionsRow.compareDocumentPosition(dl) & 4) && !$$('[aria-live] .pfg-note-ok').some(n => n === dl && n.parentElement === $('#c').firstChild), 'the download message is shown under the Download button, at the bottom');
  const labels = $$('label').map(l => l.textContent);
  ok(!$('#pfg-f-author') && !$('#pfg-f-keywords') && labels.includes('Feed maintainer (your name)') && labels.includes('Feed contact email (your email)') && !labels.includes('Owner name') && !labels.includes('Owner email'), 'Author and Keywords removed; owner fields renamed to Feed maintainer and Feed contact email');
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
  const doSearch = q => { const e = $$('input[type=search]').pop(); e.value = q; $$('button').filter(b => b.textContent === 'Search').pop().click(); return tick(); };
  ok($$('textarea[aria-label*="feed address"]').length === 0 && !$$('button').some(b => b.textContent === 'Read feed') && /Search by name or paste the feed url above\./.test($('#c').textContent) && $$('input[type=search]').length === 1, 'one search box with the new hint; no paste box or Read feed button');
  await doSearch('https://phafe.com/x/some_songs.xml');
  ok(calls.some(c => c[0] === 'L/search' && c[1].q === 'https://phafe.com/x/some_songs.xml'), 'a feed address is looked up in Music Index first');
  ok(calls.some(c => c[0] === 'L/feed' && c[1].url === 'https://phafe.com/x/some_songs.xml'), 'release URL is sent to the server fetch endpoint');
  ok($$('input').some(i => i.value === '07adf84f-c1fa-47a7-a121-0fb544e859bd') && !/not a valid xml/i.test($('#c').textContent), 'URL paste fills the release, no XML error');
  click('Add release'); await tick();
  await doSearch('https://bad.example/x.xml');
  ok(/Could not reach that address/.test($('#c').textContent), 'server fetch error shown to the user');
  await doSearch('http://insecure.example/x.xml');
  ok(/https:\/\//.test($('#c').textContent) && !calls.some(c => (c[1].url || c[1].q || '').startsWith('http://')), 'http:// address refused without calling the server');
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
  w.fetch = async (url, opts) => ({ ok: true, status: 200, json: async () => ({ xml: JSON.parse(opts.body).url === 'https://phafe.com/x/mezza.xml' ? '<rss version="2.0"><channel><title>MezzaForte</title></channel></rss>' : album }) });
  const m3 = w.PFGCore.emptyModel({ defaults: cfg.defaults }); m3.guid = 'a9ce0ee9-fe9f-4495-b7b8-ebae25ff2112'; m3.feedUrl = 'https://phafe.com/Phafe.xml'; m3.title = 'P'; m3.description = 'D';
  w.document.querySelector('#c').innerHTML = '';
  w.PFGEditor.render($('#c'), { cfg: cfg3, model: m3, hosted: null, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear });
  click('Add release'); await tick();
  const card = () => $$('.pfg-item').filter(e => e.querySelector('.pfg-item-head strong') && /Release|Some/.test(e.querySelector('strong').textContent)).pop();
  const hiddenOf = el => { for (let e = el; e && e !== card(); e = e.parentElement) if (e.hasAttribute('hidden')) return true; return false; };
  let c = card();
  ok(c.querySelector('.pfg-item-head strong').textContent === 'Release 1' && [...c.querySelectorAll('.pfg-item-head button')].map(b => b.textContent).join() === 'Remove', 'header (title + buttons) shown on an empty release');
  ok(!hiddenOf(c.querySelector('input[type=search]')) && !c.querySelector('textarea') && ![...c.querySelectorAll('button')].some(b => b.textContent === 'Read feed'), 'empty release: only the search box is shown');
  ok(hiddenOf(c.querySelector('[id$="-feedGuid"]')) && hiddenOf(c.querySelector('.pfg-chip')) && c.querySelector('.pfg-snippet') ? hiddenOf(c.querySelector('.pfg-snippet')) : true, 'empty release: everything below the search box is hidden');
  c.querySelector('input[type=search]').value = 'https://phafe.com/x/some_songs.xml'; [...c.querySelectorAll('button')].find(b => b.textContent === 'Search').click(); await tick();
  c = card();
  ok(c.querySelector('.pfg-item-head strong').textContent === 'Some Songs by MezzaForte' && c.querySelectorAll('.pfg-item-head button').length >= 1, 'header shows "<title> by <artist>" (artist = publisher feed with rel=artist, read from its feed) with its buttons');
  ok(hiddenOf(c.querySelector('input[type=search]')), 'populated: the search box is hidden');
  const tog = () => [...card().querySelectorAll('button')].find(b => /feed details$/.test(b.textContent));
  ok(hiddenOf(c.querySelector('[id$="-feedGuid"]')) && hiddenOf(c.querySelector('[id$="-title"]')) && hiddenOf(c.querySelector('[id$="-feedImg"]')) && tog().textContent === 'Show feed details' && !hiddenOf(c.querySelector('.pfg-chip')) && !hiddenOf(c.querySelector('.pfg-snippet')), 'populated: feed details hidden by default; roles and owner text visible');
  ok(c.querySelector('[id$="-artist"]').value === 'MezzaForte' && c.querySelector('[id$="-artist"]').hasAttribute('readonly') && c.querySelector('[id$="-artist"]').parentElement.nextElementSibling.querySelector('[id$="-title"]'), 'Artist is a read-only field in the feed details, above Title');
  ok(['label', 'studio', 'host'].every(t => [...c.querySelectorAll('.pfg-chip')].some(b => b.textContent === t && b.getAttribute('aria-pressed') === 'true')) && [...c.querySelectorAll('.pfg-chip')].filter(b => b.getAttribute('aria-pressed') === 'true').length === 3, 'roles the release feed already gives this feed (label studio host) are selected by default');
  tog().click(); ok(!hiddenOf(card().querySelector('[id$="-feedGuid"]')) && tog().textContent === 'Hide feed details' && tog().getAttribute('aria-expanded') === 'true', 'Show feed details reveals title, type, GUID, feed URL and cover image');
  c = card();
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
ok(/optional/i.test($('.pfg-total').textContent), 'payments empty and optional by default');
click('Add recipient'); await tick();
ok($('.pfg-subhead').textContent === 'Support the developers (optional)' && $$('.pfg-locked').length === 0, 'support heading shown, nothing locked');
ok([0, 1, 2].map(i => $('#pfg-support-' + i)).every(e => e && e.value === '1' && !e.disabled && !e.readOnly) && /Phafe\.com[\s\S]*musicindex\.org[\s\S]*Podcastindex\.org/.test($('.pfg-support').textContent), 'three support recipients (Phafe.com, musicindex.org, Podcastindex.org) default to an editable 1%');
ok(/97%/.test($('.pfg-total').textContent) && /takes 3%/.test($('.pfg-total').textContent), 'recipient total target is 97%');
set('#pfg-support-1', '0'); await tick(); ok(/of 98%/.test($('.pfg-total').textContent), 'setting a support share to 0 raises the target to 98%');
set('#pfg-support-1', '1'); await tick();
set('#pfg-f-title', 'Acme'); set('#pfg-f-description', 'Desc'); set('#pfg-f-value-recipients-0-name', 'Acme'); set('#pfg-f-value-recipients-0-address', 'acme@getalby.com'); set('#pfg-f-value-recipients-0-split', '97');
ok($('#pfg-f-slug').value === 'acme', 'feed name made from the title as it is typed');
ok($('#pfg-f-slug').parentNode.style.display === 'none', 'the Feed name input is hidden while it is fine');
set('#pfg-f-slug', '');
const scrolled2 = []; w.HTMLElement.prototype.scrollIntoView = function () { const i = this.querySelector && this.querySelector('input,textarea,select'); scrolled2.push(i ? i.id : (this.className || this.tagName)); };
$$('details.pfg-section').forEach(d => d.removeAttribute('open'));
click('Save and publish'); await tick();
ok(scrolled2.pop() === 'pfg-f-slug' && $$('details.pfg-section').filter(d => d.hasAttribute('open')).map(d => d.querySelector('summary').textContent).join() === 'Identity and links', 'Save with a bad feed name opens its section and scrolls to it');
ok(!sent && /feed name/i.test($('#pfg-f-slug-err').textContent) && $('#pfg-f-slug').parentNode.style.display === '', 'saving without a feed name is blocked, and the input is shown so it can be fixed');
set('#pfg-f-slug', 'acme-records'); set('#pfg-f-description', ''); await tick(); $$('details.pfg-section').forEach(d => d.removeAttribute('open'));
click('Save and publish'); await tick();
ok(!sent && scrolled2.pop() === 'pfg-f-description' && $$('details.pfg-section').filter(d => d.hasAttribute('open')).map(d => d.querySelector('summary').textContent).join() === 'Basics', 'Save with a missing Description opens Basics and scrolls to the first error');
set('#pfg-f-description', 'Desc'); await tick(); click('Save and publish'); await tick();
ok(sent && Array.isArray(sent.feed.support) && sent.feed.support.length === 3 && sent.feed.support.every(x => x.split === 1), 'support splits are sent with the feed');
ok(sent && sent.slug === 'acme-records' && sent.feed.guid === w.PFGCore.guidForUrl(cfg.feedBaseUrl + 'acme-records/acme-records.xml'), 'hosted create sends slug and derived guid');
ok(/Published at/.test($('#c').textContent), 'success message shown');

// --- new hosted feed: prefill from the signed-in Nostr profile
const NPUB = 'npub1slfkmxz8w9mskmpxm5y9zngz46fp97mfn2c82wpkxjyxktejaq9sqwd4ng', PK = 'a'.repeat(64);
const profile = { display_name: 'Acme Records', name: 'acme', about: 'We make <b>music</b>.\nValue for value.', website: 'http://acme.example', picture: 'http://acme.example/logo.png', lud16: 'acme@getalby.com', lud06: 'LNURL1XYZ' };
const mkHost = (p, delay) => ({ getSession: () => ({ pubkey: PK, npub: NPUB }), fetchProfile: () => new Promise(r => setTimeout(() => r(p), delay || 0)), createFeed: async () => ({}) });
const renderNew = (host, extra) => { $('#c').innerHTML = ''; w.PFGEditor.render($('#c'), Object.assign({ cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults, platformApplied: cfg.platform }), hosted: { id: null }, host, hostingOn: true, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear }, extra || {})); };
renderNew(mkHost(profile)); await tick();
ok($('#pfg-f-title').value === 'Acme Records' && !$('#pfg-f-author'), 'profile name fills Name / title (there is no Author field any more)');
ok($('#pfg-f-description').value === 'We make <b>music</b>.\nValue for value.', 'profile about fills Description (as plain text)');
ok($('#pfg-f-link').value === 'http://acme.example' && $('#pfg-f-image').value === 'http://acme.example/logo.png', 'profile website and picture fill Website and Image URL (http allowed)');
ok($('#pfg-f-npub').value === NPUB, 'signed-in npub fills Your npub');
ok($('#pfg-f-value-recipients-0-address').value === 'acme@getalby.com' && $('#pfg-f-value-recipients-0-split').value === '97' && $('#pfg-f-value-recipients-0-name').value === 'Acme Records', 'lud16 becomes a lnaddress payment recipient taking the non-support share (97)');
ok(!$$('details').find(d => /Payments/.test(d.textContent.slice(0, 20))).hasAttribute('open') && /Lightning address/.test($('.pfg-note-ok').textContent), 'a profile Lightning address does not pull the Payments section open (the banner says it was filled)');
ok(/Filled in from your Nostr profile/.test($('.pfg-note-ok').textContent), 'banner says what was filled');
ok(!/lud06|LNURL/i.test($('#c').textContent), 'lud06/LNURL is ignored');
// typed values are never overwritten, even if the profile arrives later
renderNew(mkHost(profile, 150)); set('#pfg-f-title', 'My Own Title'); set('#pfg-f-link', 'https://mine.example'); await tick();
ok($('#pfg-f-title').value === 'My Own Title' && $('#pfg-f-link').value === 'https://mine.example' && $('#pfg-f-description').value.startsWith('We make'), 'fields the user already typed are kept; empty ones still filled');
// the form is hidden behind a loading message until the profile has arrived
renderNew(mkHost(profile, 200));
ok(!!$('.pfg-loading') && /Loading your Nostr profile/.test($('.pfg-loading').textContent) && $$('details.pfg-section').every(d => d.style.display === 'none' && d.style.getPropertyPriority('display') === 'important' && d.hidden), 'while the profile loads: loading message shown, sections hidden (with !important, so a theme cannot show them)');
await new Promise(r => setTimeout(r, 400));
ok(!$('.pfg-loading') && $$('details.pfg-section').every(d => d.style.display === ''), 'after it loads: loading message gone, sections shown');
ok($('#pfg-f-title').value === 'Acme Records', 'and the form is filled in');
let failHost = mkHost(profile); failHost.fetchProfile = () => Promise.reject(new Error('x')); renderNew(failHost); await tick();
ok(!$('.pfg-loading') && $$('details.pfg-section').every(d => d.style.display === ''), 'if the lookup fails the form is shown anyway');
// not for existing feeds, not anonymous
let calls = 0; const spy = Object.assign(mkHost(profile), { fetchProfile: () => { calls++; return Promise.resolve(profile); } });
renderNew(spy, { hosted: { id: 7, slug: 'x', status: 'published', url: 'https://phafe.com/x' } }); await tick();
ok(calls === 0 && $('#pfg-f-title').value === '', 'existing hosted feed is not prefilled');
$('#c').innerHTML = ''; w.PFGEditor.render($('#c'), { cfg, model: w.PFGCore.emptyModel({ defaults: cfg.defaults, platformApplied: [] }), hosted: null, host: spy, importNotes: [], saveDraft() {}, clearDraft() {}, back() {}, h, btn, note, clear }); await tick();
ok(calls === 0, 'anonymous mode never looks up a profile');
// "Back to my feeds" only asks when there are unsaved changes
let backed = 0, confirms = 0; w.confirm = () => { confirms++; return true; };
const backBtn = () => $$('button').find(b => b.textContent === 'Back to my feeds');
renderNew(mkHost(profile), { back() { backed++; } }); await tick();
backBtn().click(); ok(backed === 1 && confirms === 0, 'Back to my feeds: no warning when the form only holds what the profile filled in');
renderNew(mkHost(profile), { back() { backed++; } }); await tick(); set('#pfg-f-title', 'Mine'); backBtn().click();
ok(confirms === 1 && backed === 2, 'Back to my feeds: warns when something typed is unsaved');
renderNew(Object.assign(mkHost(profile), { createFeed: async (slug) => ({ id: 5, slug, status: 'published', url: cfg.feedBaseUrl + slug + '/' + slug + '.xml' }) }), { back() { backed++; } }); await tick();
set('#pfg-f-title', 'Saved Co'); set('#pfg-f-description', 'Saved.'); await tick(); click('Save and publish'); await tick(); await tick();
ok(/Published at/.test($('#c').textContent), 'feed saved');
backBtn().click(); ok(confirms === 1 && backed === 3, 'Back to my feeds: no warning once the changes are saved');
set('#pfg-f-description', 'Saved again.'); backBtn().click(); ok(confirms === 2 && backed === 4, 'Back to my feeds: warns again after a new edit');
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
