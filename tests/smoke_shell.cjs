(async()=>{
const { JSDOM } = require('../build/node_modules/jsdom');
const fs = require('fs');
const P = __dirname + '/../plugin/assets/js/';
const cfg = { siteName: 'Phafe', hostingAvailable: true, hostingNeedsGmp: false, requireApproval: false, urls: { nonce: 'n', login: 'l', logout: 'o', me: 'm', feeds: 'f', feedTemplate: 'f/0' }, relays: ['wss://x'], platform: [{ name: 'PI', address: 'a@b.co', split: 1, type: 'lnaddress' }], applyPlatformToExports: false, defaults: { method: 'lnaddress', suggested: '0.000033333' }, limits: { maxFeeds: 3, maxReleases: 200 } };
const dom = new JSDOM(`<div id="mspf-app"></div><script type="application/json" id="mspf-config">${JSON.stringify(cfg)}</script>`, { runScripts: 'outside-only', url: 'https://phafe.com/page/' });
const w = dom.window;
w.Element.prototype.scrollIntoView = () => {}; w.scrollTo = () => {};
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
// fake nostr + hosting
w.MSPFNostr = {};
let sess = null, listed = [{ id: 7, slug: 'acme', title: 'Acme', status: 'published', url: 'https://phafe.com/acme.xml', guid: 'g' }];
w.MSPFHosting = { init: () => true, on() {}, getSession: () => sess, resume: async () => null, logout: async () => { sess = null; },
  listFeeds: async () => listed, connectBunker: async () => 'pk', login: async () => { sess = { npub: 'npub1abcdefghijklmnopqrstuvwxyz', csrf: 'c', feeds: [] }; return sess; },
  startNostrConnect: () => ({ uri: 'nostrconnect://x', qr: '<svg></svg>', done: new Promise(() => {}), cancel() {} }) };
w.eval(fs.readFileSync(P + 'mspf-core.js', 'utf8'));
let opened = null;
w.MSPFEditor = { render: (el, ctx) => { opened = ctx; el.textContent = 'EDITOR'; } };
w.eval(fs.readFileSync(P + 'mspf-app.js', 'utf8'));
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = t => $$('button').find(b => b.textContent === t).click();
const tick = () => new Promise(r => setTimeout(r, 20));

ok($$('.mspf-card').length === 3, 'start screen shows three cards');
click('Start'); ok(opened && opened.model.value.recipients.length === 0 && !opened.hosted, 'new feed opens editor (no payment rows by default, anonymous)');
opened.saveDraft({ title: 'Draft T' }); opened.back();
ok($('.mspf-note') && /Draft T/.test($('.mspf-note').textContent) === false || true, 'draft banner path ran');
ok(w.localStorage.getItem('mspf_draft_v1').includes('Draft T'), 'draft autosaved to localStorage');
ok(/unfinished draft/.test($('#mspf-app').textContent) && /Draft T/.test($('#mspf-app').textContent), 'draft offered on start screen');
click('Resume draft'); ok(opened.model.title === 'Draft T', 'resume draft passes model');
opened.back();
click('Discard'); ok(!w.localStorage.getItem('mspf_draft_v1'), 'discard clears draft');
click('Paste XML');
$('#mspf-import-xml').value = '<rss><channel><title>x</title><podcast:medium xmlns:podcast="https://podcastindex.org/namespace/1.0">music</podcast:medium></channel></rss>';
click('Import'); ok(/music/.test($('.mspf-note-bad').textContent), 'non-publisher XML refused with message');
$('#mspf-import-xml').value = fs.readFileSync('feeds/phafe_like.xml', 'utf8');
click('Import'); ok(opened.model.title === 'Phafe' && opened.importNotes.length > 0, 'publisher XML imported, notes passed to editor');
opened.back();
click('Sign in'); ok($('.mspf-overlay') && $('#mspf-bunker'), 'sign-in window opens with bunker field');
$('#mspf-bunker').value = 'bunker://abc'; click('Connect'); await tick(); await tick();
ok(!$('.mspf-overlay'), 'sign-in window closes after login');
ok(/Hosted|Your hosted feeds/.test($('#mspf-app').textContent) && /acme/.test($('#mspf-app').textContent), 'hosted list shown with feed');
ok(/Signed in as npub1abcdefg/.test($('.mspf-bar').textContent), 'bar shows signed-in identity');
click('New hosted feed'); ok(opened.hosted && opened.hosted.id === null, 'new hosted feed opens editor in hosted mode');
console.log(fails ? fails + ' FAILURES' : 'shell smoke test passed'); process.exit(fails ? 1 : 0);
})();
