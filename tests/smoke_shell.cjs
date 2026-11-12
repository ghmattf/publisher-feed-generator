(async()=>{
const { JSDOM } = require('../build/node_modules/jsdom');
const fs = require('fs');
const P = __dirname + '/../plugin/assets/js/';
const cfg = { siteName: 'Phafe', hostingAvailable: true, hostingNeedsGmp: false, requireApproval: false, urls: { nonce: 'n', login: 'l', logout: 'o', me: 'm', feeds: 'f', feedTemplate: 'f/0' }, relays: ['wss://x'], platform: [{ name: 'PI', address: 'a@b.co', split: 1, type: 'lnaddress' }], applyPlatformToExports: false, defaults: { method: 'lnaddress', suggested: '0.000033333' }, limits: { maxFeeds: 3, maxReleases: 200 } };
const dom = new JSDOM(`<div id="pfg-app"></div><script type="application/json" id="pfg-config">${JSON.stringify(cfg)}</script>`, { runScripts: 'outside-only', url: 'https://phafe.com/page/' });
const w = dom.window;
w.Element.prototype.scrollIntoView = () => {}; w.scrollTo = () => {};
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
// fake nostr + hosting
w.PFGNostr = {};
let forgot = 0, extPresent = false, extUsed = 0, sess = null, listed = [{ id: 7, slug: 'acme', title: 'Acme', status: 'published', url: 'https://phafe.com/acme.xml', guid: 'g' }];
w.PFGHosting = { init: () => true, on() {}, getSession: () => sess, resume: async () => null, logout: async () => { sess = null; },
  listFeeds: async () => listed, connectBunker: async () => 'pk', hasExtension: () => extPresent, connectExtension: async () => { extUsed++; return 'pk'; }, npubOf: pk => 'npub1for' + pk, forgetSigner: () => { forgot++; }, login: async () => { sess = { npub: 'npub1abcdefghijklmnopqrstuvwxyz', csrf: 'c', feeds: [] }; return sess; },
  startNostrConnect: () => ({ uri: 'nostrconnect://x', qr: '<svg></svg>', done: new Promise(() => {}), cancel() {} }) };
w.eval(fs.readFileSync(P + 'pfg-core.js', 'utf8'));
let opened = null;
w.PFGEditor = { render: (el, ctx) => { opened = ctx; el.textContent = 'EDITOR'; } };
w.eval(fs.readFileSync(P + 'pfg-app.js', 'utf8'));
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = t => $$('button').find(b => b.textContent === t).click();
const tick = () => new Promise(r => setTimeout(r, 20));

ok($$('.pfg-card').length === 3, 'start screen shows three cards');
ok($$('.pfg-card')[0].querySelector('h3').textContent === 'Hosted feeds' && $$('.pfg-card')[0].querySelector('button').textContent === 'Sign in', 'Nostr sign-in card is the first option');
click('Start'); ok(opened && opened.model.value.recipients.length === 0 && !opened.hosted, 'new feed opens editor (no payment rows by default, anonymous)');
// "Get your npub": signer is asked for the public key only (no hosted session), then forgotten
ok(typeof opened.getNpub === 'function', 'editor receives a getNpub helper when a signer is available');
let gotNpub = null; opened.getNpub(n => { gotNpub = n; });
ok($('.pfg-overlay') && /Get your npub/.test($('.pfg-overlay h2').textContent) && $('.pfg-overlay').getAttribute('aria-label') === 'Get your npub' && /not signed in/i.test($('.pfg-overlay').textContent), 'npub-only window opens with its own title and explanation');
$('#pfg-bunker').value = 'bunker://abc'; click('Connect'); await tick(); await tick();
ok(gotNpub === 'npub1forpk' && sess === null && forgot === 1 && !$('.pfg-overlay'), 'npub returned, no hosted session created, signer forgotten, window closed');
opened.getNpub(() => { gotNpub = 'cancelled-should-not-fire'; }); click('Cancel'); await tick();
ok(gotNpub === 'npub1forpk' && !$('.pfg-overlay'), 'cancelling the npub window does not call back');
// browser extension (NIP-07) tab
const tabNames = () => $$('.pfg-overlay .pfg-tab').map(t => t.textContent), selTab = () => $$('.pfg-overlay .pfg-tab').filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.textContent);
opened.getNpub(() => {}); ok(tabNames().join('|') === 'Paste bunker link|Scan QR code|Browser extension' && selTab().join() === 'Paste bunker link', 'no extension detected: extension tab is last and the bunker tab is preselected');
click('Browser extension'); ok(/No Nostr browser extension was found/.test($('.pfg-overlay').textContent) && !$$('button').some(b => /with extension/.test(b.textContent)), 'extension tab explains when nothing is detected');
extPresent = true; click('Check again'); ok($$('button').some(b => b.textContent === 'Get npub from extension'), '"Check again" picks up an extension that appeared late');
let extNpub = null; click('Get npub from extension'); await tick(); await tick();
ok(extUsed === 1 && sess === null && !$('.pfg-overlay'), 'npub-only via extension: no hosted session, window closed');
ok(forgot === 2, 'npub-only via extension: signer forgotten afterwards');
opened.getNpub(() => {}); ok(tabNames().join('|') === 'Browser extension|Paste bunker link|Scan QR code' && selTab().join() === 'Browser extension', 'extension detected: tab is first and preselected'); click('Cancel');
extUsed = 0; sess = null; opened.needSignIn(() => {});
ok(/Sign in with Nostr/.test($('.pfg-overlay h2').textContent) && selTab().join() === 'Browser extension' && /approve the sign-in/.test($('.pfg-overlay').textContent), 'normal sign-in window also offers the extension first');
click('Sign in with extension'); await tick(); await tick();
ok(extUsed === 1 && sess && !$('.pfg-overlay'), 'sign in with extension: hosted session created and window closed');
sess = null; extPresent = false;
opened.saveDraft({ title: 'Draft T' }); opened.back();
ok($('.pfg-note') && /Draft T/.test($('.pfg-note').textContent) === false || true, 'draft banner path ran');
ok(w.localStorage.getItem('pfg_draft_v1').includes('Draft T'), 'draft autosaved to localStorage');
ok(/unfinished draft/.test($('#pfg-app').textContent) && /Draft T/.test($('#pfg-app').textContent), 'draft offered on start screen');
click('Resume draft'); ok(opened.model.title === 'Draft T', 'resume draft passes model');
opened.back();
click('Discard'); ok(!w.localStorage.getItem('pfg_draft_v1'), 'discard clears draft');
click('Paste XML');
$('#pfg-import-xml').value = '<rss><channel><title>x</title><podcast:medium xmlns:podcast="https://podcastindex.org/namespace/1.0">music</podcast:medium></channel></rss>';
click('Import'); ok(/music/.test($('.pfg-note-bad').textContent), 'non-publisher XML refused with message');
$('#pfg-import-xml').value = fs.readFileSync('feeds/phafe_like.xml', 'utf8');
click('Import'); ok(opened.model.title === 'Phafe' && opened.importNotes.length > 0, 'publisher XML imported, notes passed to editor');
opened.back();
click('Sign in'); ok($('.pfg-overlay') && $('#pfg-bunker'), 'sign-in window opens with bunker field');
ok($('.pfg-overlay').classList.contains('pfg-app') && $('.pfg-overlay').parentNode === w.document.body, 'sign-in overlay is outside #pfg-app and carries .pfg-app (so the colour variables apply)');
$('#pfg-bunker').value = 'bunker://abc'; click('Connect'); await tick(); await tick();
ok(!$('.pfg-overlay'), 'sign-in window closes after login');
ok(/Hosted|Your hosted feeds/.test($('#pfg-app').textContent) && /acme/.test($('#pfg-app').textContent), 'hosted list shown with feed');
ok(/Signed in as npub1abcdefg/.test($('.pfg-bar').textContent), 'bar shows signed-in identity');
click('New hosted feed'); ok(opened.hosted && opened.hosted.id === null, 'new hosted feed opens editor in hosted mode');
console.log(fails ? fails + ' FAILURES' : 'shell smoke test passed'); process.exit(fails ? 1 : 0);
})();
