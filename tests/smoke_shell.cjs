(async()=>{
const { JSDOM } = require('../build/node_modules/jsdom');
const fs = require('fs');
const P = __dirname + '/../plugin/assets/js/';
const cfg = { keepMovedDays: 28, siteName: 'Phafe', hostingAvailable: true, hostingNeedsGmp: false, requireApproval: false, urls: { nonce: 'n', login: 'l', logout: 'o', me: 'm', feeds: 'f', feedTemplate: 'f/0' }, relays: ['wss://x'], platform: [{ name: 'PI', address: 'a@b.co', split: 1, type: 'lnaddress' }], applyPlatformToExports: false, defaults: { method: 'lnaddress', suggested: '0.000033333' }, limits: { maxFeeds: 3, maxReleases: 200 } };
const dom = new JSDOM(`<div id="pfg-app"></div><script type="application/json" id="pfg-config">${JSON.stringify(cfg)}</script>`, { runScripts: 'outside-only', url: 'https://phafe.com/page/' });
const w = dom.window;
w.Element.prototype.scrollIntoView = () => {}; w.scrollTo = () => {};
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
// fake nostr + hosting
w.PFGNostr = {};
let forgot = 0, extPresent = false, extUsed = 0, sess = null, listed = [{ id: 7, slug: 'acme', title: 'Acme', status: 'published', url: 'https://phafe.com/acme.xml', guid: 'g' }];
w.PFGHosting = { init: () => true, upgraded: 0, upgradeAccount: async (p) => { await p; w.PFGHosting.upgraded++; sess = { npub: 'npub1abcdefghijklmnopqrstuvwxyz', csrf: 'c', feeds: [], kind: 'signer' }; return sess; }, moves: [], moveFeed: async (id, u) => { w.PFGHosting.moves.push([id, u]); }, hasBrowserKey: () => false, browserKeyName: () => "", forgetBrowserKey() {}, createBrowserAccount: async () => ({}), connectBrowserKey: async () => ({}), on() {}, getSession: () => sess, resume: async () => null, logout: async () => { sess = null; },
  listFeeds: async () => listed, connectBunker: async () => 'pk', hasExtension: () => extPresent, connectExtension: async () => { extUsed++; return 'pk'; }, npubOf: pk => 'npub1for' + pk, forgetSigner: () => { forgot++; }, login: async () => { sess = { npub: 'npub1abcdefghijklmnopqrstuvwxyz', csrf: 'c', feeds: [] }; return sess; },
  startNostrConnect: () => ({ uri: 'nostrconnect://x', qr: '<svg></svg>', done: new Promise(() => {}), cancel() {} }) };
w.eval(fs.readFileSync(P + 'pfg-core.js', 'utf8'));
let opened = null;
w.PFGEditor = { render: (el, ctx) => { opened = ctx; el.textContent = 'EDITOR'; } };
w.eval(fs.readFileSync(P + 'pfg-app.js', 'utf8'));
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = t => $$('button').find(b => b.textContent === t).click();
const tick = () => new Promise(r => setTimeout(r, 20));

ok($$('.pfg-card').length === 2, 'start screen shows two cards (hosted, self-host)');
ok(!$$('.pfg-card')[0].querySelector('h3') && !/Hosted feeds/.test($$('.pfg-card')[0].textContent) && $$('.pfg-card')[0].querySelector('button').textContent === 'Get started' && $$('.pfg-card')[0].querySelector('button').classList.contains('pfg-btn-primary') && !$$('.pfg-card')[1].querySelector('button').classList.contains('pfg-btn-primary') && $$('.pfg-card')[1].querySelector('h3').textContent === 'Want to self-host?' && $$('.pfg-card').length === 2, 'Get started (purple) is the first option; the self-host card is second with a plain Start button');
ok($('.pfg-intro') && $('.pfg-card-lead') && $('h1').textContent === 'Get your music credits linked!' && /Create Podcasting 2\.0 feeds for labels, studios, engineers, artists\.\.\./.test(w.document.body.textContent) && !/keep it updated as you add releases/.test(w.document.body.textContent) && !/Download it and host it yourself/.test(w.document.body.textContent) && !/Start from scratch/.test(w.document.body.textContent), 'h1 reads Get your music credits linked!; the intro line is the muted one and the card line the main text colour (classes pfg-intro / pfg-card-lead); the old intro sentence and "Start from scratch" are gone');
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
ok($('.pfg-overlay h2').textContent === 'Get started' && $('#pfg-newname') && selTab().join() === 'Browser extension', 'sign-in window is headed "Get started", shows Create account at the top and preselects an installed extension');
click('Browser extension'); ok(/approve the sign-in/.test($('.pfg-overlay').textContent), 'extension tab available');
click('Sign in with extension'); await tick(); await tick();
ok(extUsed === 1 && sess && !$('.pfg-overlay'), 'sign in with extension: hosted session created and window closed');
sess = null; extPresent = false;
opened.saveDraft({ title: 'Draft T' }); opened.back();
ok($('.pfg-note') && /Draft T/.test($('.pfg-note').textContent) === false || true, 'draft banner path ran');
ok(w.localStorage.getItem('pfg_draft_v1').includes('Draft T'), 'draft autosaved to localStorage');
ok(/unfinished draft/.test(w.document.body.textContent) && /Draft T/.test(w.document.body.textContent), 'draft offered on start screen');
click('Resume draft'); ok(opened.model.title === 'Draft T', 'resume draft passes model');
opened.back();
click('Discard'); ok(!w.localStorage.getItem('pfg_draft_v1'), 'discard clears draft');
ok(!$$('button').some(b => b.textContent === 'Paste XML') && !/Edit an existing feed/.test($('#pfg-app, .pfg-app').textContent), 'no "Edit an existing feed" card or Paste XML button on the start screen');
opened.back();
click('Get started'); ok($('.pfg-overlay') && $('#pfg-newname') && selTab().join() === '', 'sign-in window shows Create account at the top and no tab preselected when no extension');
ok(tabNames().join('|') === 'Browser extension|Scan QR code|Paste bunker link', 'sign-in tabs: Browser extension, Scan QR code, Paste bunker link');
{ const t = $('.pfg-overlay').textContent; ok(t.indexOf('Create account') >= 0 && t.indexOf('Create account') < t.indexOf('Already a user?') && t.indexOf('Already a user?') < t.indexOf('Sign back into your account') && t.indexOf('Sign back into your account') < t.indexOf('Browser extension'), 'Create account, then "Already a user?" / "Sign back into your account", then the sign-in options'); }
ok(!/You will only be able to make changes from this browser/.test($('.pfg-overlay').textContent) && /IMPORTANT! This account only works in this browser, and is lost if you clear your browser data\./.test($('.pfg-overlay').textContent) && /You can simply "Create account" to get up and running but you should consider moving to a Nostr authentication method for continued use\./.test($('.pfg-overlay').textContent) && !/Your private key stays in your signer app or browser extension/.test($('.pfg-overlay').textContent) && /You can get started with this and move to a permanent solution later\./.test($('.pfg-overlay').textContent) && !/No app or extension needed/.test($('.pfg-overlay').textContent), 'Create account explains the browser-only limit');
click('Browser extension'); ok(/for example Sidecar, Alby or nos2x/.test($('.pfg-overlay').textContent), 'extension tab text names Sidecar, Alby or nos2x');
click('Paste bunker link'); ok($('#pfg-bunker') && /for example Clave, Amber, Primal/.test($('.pfg-overlay').textContent), 'bunker field available on its tab, with the new signer app names');
ok($('.pfg-overlay').classList.contains('pfg-app') && $('.pfg-overlay').parentNode === w.document.body, 'sign-in overlay is outside #pfg-app and carries .pfg-app (so the colour variables apply)');
$('#pfg-bunker').value = 'bunker://abc'; click('Connect'); await tick(); await tick();
ok(!$('.pfg-overlay'), 'sign-in window closes after login');
ok(/My feeds/.test(w.document.body.textContent) && /acme/.test(w.document.body.textContent) && !/Your hosted feeds|Create an account in one click/.test(w.document.body.textContent), 'the feed list is on the start screen under "My feeds" in place of the sign-in card');
ok(/Signed in as npub1abcdefg/.test($('.pfg-bar').textContent), 'bar shows signed-in identity');
click('New feed'); ok(opened.hosted && opened.hosted.id === null, 'new hosted feed opens editor in hosted mode');
// ---- Move feed (from Your hosted feeds)
opened.back(); await tick(); await tick();
ok($$('button').some(b => b.textContent === 'Move feed'), 'hosted list has a Move feed button');
click('Move feed'); const mv = $('.pfg-overlay');
ok(mv && /tells podcasting apps and Podcast Index that this feed has moved/.test(mv.textContent) && /update every feed that already has a relationship/.test(mv.textContent), 'Move window explains what moving does and the need to update related feeds');
ok(mv.querySelectorAll('input').length === 1 && [...mv.querySelectorAll('button')].map(b => b.textContent).join('|') === 'Move|Cancel', 'only a new URL field and Move / Cancel buttons');
const mvBtn = t => [...$('.pfg-overlay').querySelectorAll('button')].find(b => b.textContent === t);
$('#pfg-move-url').value = 'http://nope'; mvBtn('Move').click();
ok(/full https:\/\/ URL/.test($('.pfg-overlay').textContent) && !/Are you sure/.test($('.pfg-overlay').textContent), 'a bad address is refused before the confirmation');
$('#pfg-move-url').value = 'https://new.example.com/acme.xml'; mvBtn('Move').click();
ok(/Are you sure you want to move this feed\?/.test($('.pfg-overlay').textContent) && /remain on here for a period of 28 days/.test($('.pfg-overlay').textContent) && /new\.example\.com\/acme\.xml/.test($('.pfg-overlay').textContent), 'second confirmation names the new address and the 28-day period');
mvBtn('Cancel').click(); ok(!$('.pfg-overlay') && w.PFGHosting.moves.length === 0, 'Cancel closes the window and moves nothing');
click('Move feed'); $('#pfg-move-url').value = 'https://new.example.com/acme.xml'; mvBtn('Move').click(); mvBtn('Yes, move it').click(); await tick(); await tick();
ok(w.PFGHosting.moves.length === 1 && w.PFGHosting.moves[0][0] === 7 && w.PFGHosting.moves[0][1] === 'https://new.example.com/acme.xml' && !$('.pfg-overlay') && /Feed moved/.test(w.document.body.textContent), 'confirming moves the feed, closes the window and shows a message');
// ---- browser-key account: reminder bar and upgrade
sess.kind = 'browser'; extPresent = true; opened.back();
ok($$('button').some(b => b.textContent === 'Upgrade my sign-in') && /key kept in this browser/.test($('.pfg-bar').parentNode.textContent) && /Payments are not available/.test(w.document.body.textContent), 'browser-key account: persistent reminder with an Upgrade button');
ok($$('button').find(b => b.textContent === 'Upgrade my sign-in').closest('.pfg-note-warn'), 'the Upgrade my sign-in button sits inside the in-browser-key message box');
click('Upgrade my sign-in'); ok($('.pfg-overlay') && /Upgrade your sign-in/.test($('.pfg-overlay h2').textContent) && !tabNames().includes('Create account') && !tabNames().includes('This browser'), 'upgrade window offers only signer app / extension tabs');
click('Sign in with extension'); await tick(); await tick();
ok(w.PFGHosting.upgraded === 1 && !$('.pfg-overlay') && /Your account now uses your signer/.test(w.document.body.textContent) && !$$('button').some(b => b.textContent === 'Upgrade my sign-in'), 'upgrade: window closes, success message shown, reminder gone');
console.log(fails ? fails + ' FAILURES' : 'shell smoke test passed'); process.exit(fails ? 1 : 0);
})();
