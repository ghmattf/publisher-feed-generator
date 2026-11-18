/**
 * Publisher Feed Generator: app shell.
 *
 * Start screen, draft autosave, sign-in window and the
 * hosted feed list. The feed form itself lives in pfg-editor.js
 * (window.PFGEditor.render).
 */
(function () {
  'use strict';

  var root = document.getElementById('pfg-app');
  if (!root) return;

  var cfg;
  try { cfg = JSON.parse(document.getElementById('pfg-config').textContent); } catch (e) { cfg = null; }
  if (!cfg) { root.textContent = 'The feed generator could not load its settings.'; return; }

  var Core = window.PFGCore;
  var Host = window.PFGHosting;
  var signerOn = !!(window.PFGNostr && Host && Host.init(cfg)); // signer connection works without hosting
  var hostingOn = !!(cfg.hostingAvailable && signerOn);
  var DRAFT_KEY = 'pfg_draft_v1';

  /* ---------------- helpers ---------------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids === undefined ? [] : kids).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function btn(label, cls, fn, extra) { return h('button', Object.assign({ type: 'button', class: 'pfg-btn ' + (cls || ''), onclick: fn }, extra || {}), label); }
  function note(kind, content) { return h('div', { class: 'pfg-note pfg-note-' + kind, role: kind === 'bad' ? 'alert' : 'status' }, content); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function errText(e) { return e && e.message ? e.message : String(e); }

  var draftStore = {
    load: function () { try { var s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
    save: function (model) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), model: model })); } catch (e) { /* storage unavailable */ } },
    clear: function () { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } },
  };

  /* ---------------- layout ---------------- */
  var barEl = h('div', { class: 'pfg-bar' });
  var kindEl = h('div'); // the reminder shown to people signed in with a key kept in this browser
  var bodyEl = h('div', { class: 'pfg-body' });
  var bannerEl = h('div', { 'aria-live': 'polite' });
  root.appendChild(barEl);
  root.appendChild(kindEl);

  root.appendChild(bannerEl);
  root.appendChild(bodyEl);
  /* ---------------- credit invitation (?credit=<feed GUID>) ---------------- */
  var credit = null; // {guid, pending, title, artist, image, feedUrl, medium}; pending until Music Index has answered
  var creditShown = true, creditWatchers = [];
  var creditEl = h('div');
  root.insertBefore(creditEl, kindEl); // above the "signed in with a key kept in this browser" reminder
  function renderCredit() {
    clear(creditEl);
    if (!credit || !creditShown) return;
    var detail = credit.pending ? 'Someone wants to credit you.' : (credit.artist || 'Someone') + ' wants to credit you for your work on ' + credit.title + '.';
    creditEl.appendChild(note('ok', h('div', { class: 'pfg-row' }, [
      h('div', {}, [h('strong', { text: 'Congratulations!' }), h('br'), h('span', { text: detail })]),
      h('span', { class: 'pfg-spacer' }),
      btn('Dismiss', 'pfg-btn-small', function () { creditShown = false; renderCredit(); }),
    ])));
  }
  (function readCreditParam() {
    var g = '';
    try { g = new URLSearchParams(window.location.search).get('credit') || ''; } catch (e) { return; }
    g = g.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g) || !cfg.urls || !cfg.urls.lookupGuid) return;
    // Roles to tick by default: ?roles=Engineer,Mixer (or repeated roles= / role=), matched to the known role names.
    var known = cfg.relTokens || [], roles = [];
    try {
      var q = new URLSearchParams(window.location.search);
      q.getAll('roles').concat(q.getAll('role')).join(',').split(',').forEach(function (t) {
        t = t.trim().toLowerCase();
        for (var i = 0; i < known.length; i++) if (known[i].toLowerCase() === t && roles.indexOf(known[i]) < 0) roles.push(known[i]);
      });
    } catch (e) {}
    credit = { guid: g, pending: true, roles: roles };
    renderCredit();
    fetch(cfg.urls.lookupGuid, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ guid: g }) })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (d) {
        if (d && d.feed && d.feed.title) { d.feed.roles = credit.roles; credit = d.feed; renderCredit(); creditWatchers.slice().forEach(function (f) { try { f(); } catch (e) {} }); }
        else { credit = null; renderCredit(); }
      })
      .catch(function () { credit = null; renderCredit(); });
  })();

  function renderBar() {
    clear(barEl);
    var s = hostingOn ? Host.getSession() : null;
    barEl.appendChild(h('h1', { class: 'pfg-bar-title', text: 'Get your music credits linked!' }));
    var actions = h('div', { class: 'pfg-bar-actions' });
    if (s) {
      actions.appendChild(h('span', { class: 'pfg-who', text: 'Signed in as ' + s.npub.slice(0, 12) + '…' + s.npub.slice(-6) }));
      actions.appendChild(btn('Sign out', 'pfg-btn-small', function () { Host.logout().then(function () { showStart(); }); }));
    }
    barEl.appendChild(actions);
    clear(kindEl);
    if (s && s.kind === 'browser') {
      kindEl.appendChild(note('warn', [
        h('div', {}, [
          'You are signed in with a key kept in this browser. Payments are not available, and this account is lost if you clear your browser data. For a lasting account that can set up payments, use a signer app or a browser extension. ',
          moreInfoLink(),
        ]),
        h('div', { class: 'pfg-row', style: 'margin-top:10px' }, [btn('Upgrade my sign-in', 'pfg-btn-primary', function () { openLogin(view === 'editor' ? null : showHostedList, { upgrade: true }); })]),
      ]));
    }
  }
  /** Scroll to the in-browser-key reminder and flash its background green twice. */
  function flashKeyReminder() {
    var box = kindEl.querySelector('.pfg-note');
    if (!box) return;
    if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.classList.remove('pfg-flash');
    void box.offsetWidth; // restart the animation if it is clicked again
    box.classList.add('pfg-flash');
    setTimeout(function () { box.classList.remove('pfg-flash'); }, 1500);
  }
  function moreInfoLink() {
    return cfg.moreInfoUrl ? h('a', { href: cfg.moreInfoUrl, target: '_blank', rel: 'noopener', text: 'More information' }) : null;
  }

  function setBanner(kind, msg) { clear(bannerEl); if (msg) bannerEl.appendChild(note(kind, msg)); }

  function mount(node, name) { if (name) view = name; mountNode(node); }
  function mountNode(node) { clear(bodyEl); bodyEl.appendChild(node); renderBar(); window.scrollTo && root.scrollIntoView && root.scrollIntoView({ block: 'start' }); }

  /* ---------------- start screen ---------------- */
  var view = 'start';
  function showStart(keepBanner) {
    view = 'start';
    if (keepBanner !== true) setBanner();
    var wrap = h('div');
    var draft = draftStore.load();
    if (draft && draft.model) {
      wrap.appendChild(note('', h('div', { class: 'pfg-row' }, [
        h('span', { text: 'You have an unfinished draft' + (draft.model.title ? ' ("' + draft.model.title + '")' : '') + ' saved in this browser.' }),
        h('span', { class: 'pfg-spacer' }),
        btn('Resume draft', 'pfg-btn-primary pfg-btn-small', function () { openEditor({ model: draft.model, hosted: null }); }),
        btn('Discard', 'pfg-btn-small', function () { draftStore.clear(); showStart(); }),
      ])));
    }
    wrap.appendChild(h('p', { class: 'pfg-intro', text: 'Create Podcasting 2.0 feeds for labels, studios, engineers, artists...' }));
    var cards = h('div', { class: 'pfg-cards' });
    if (hostingOn) {
      var s = Host.getSession();
      if (s) {
        wrap.appendChild(feedsBox());
      } else {
        cards.appendChild(h('div', { class: 'pfg-card' }, [
          h('p', { class: 'pfg-card-lead', text: 'Create an account in one click, or sign in with a Nostr signer app or browser extension.' }),
          btn('Get started', 'pfg-btn-primary', function () { openLogin(showStart); }),
        ]));
      }
    } else if (cfg.hostingNeedsGmp) {
      wrap.appendChild(h('p', { class: 'pfg-hint', text: 'Hosting is unavailable on this server right now. You can still create and download feeds.' }));
    }
    cards.appendChild(h('div', { class: 'pfg-card' }, [
      h('h3', { text: 'Want to self-host?' }),
      h('p', { text: 'No account needed. Download the XML when you are done.' }),
      btn('Start', '', function () { openEditor({ model: Core.emptyModel({ defaults: cfg.defaults }), hosted: null }); }),
    ]));
    wrap.appendChild(cards);
    mount(wrap);
  }

  /* ---------------- editor ---------------- */
  function openEditor(opts) {
    if (!window.PFGEditor) { setBanner('bad', 'The editor failed to load. Please reload the page.'); return; }
    var wrap = h('div');
    creditWatchers = [];
    view = 'editor';
    mount(wrap);
    window.PFGEditor.render(wrap, {
      cfg: cfg,
      model: opts.model,
      hosted: opts.hosted,
      importNotes: opts.importNotes || [],
      host: hostingOn ? Host : null,
      hostingOn: hostingOn,
      saveDraft: function (m) { if (!opts.hosted) draftStore.save(m); },
      clearDraft: draftStore.clear,
      needSignIn: function (then) { openLogin(then); },
      // Ask a signer for the public key only (no hosted session). Calls back with the npub.
      getNpub: signerOn ? function (then) { openLogin(then, { npubOnly: true }); } : null,
      back: function () { if (opts.hosted) showHostedList(); else showStart(); },
      // A key kept in this browser cannot set up payments (the server enforces this too).
      paymentsLocked: !!(opts.hosted && hostingOn && Host.getSession() && Host.getSession().kind === 'browser'),
      moreInfoUrl: cfg.moreInfoUrl || '',
      showKeyReminder: flashKeyReminder,
      getCredit: function () { return credit && !credit.pending ? credit : null; },
      creditInFeed: function () { if (creditShown) { creditShown = false; renderCredit(); } },
      onCredit: function (f) { creditWatchers.push(f); },
      suggestedName: Host.browserKeyName ? Host.browserKeyName() : '',
      h: h, btn: btn, note: note, clear: clear,
    });
  }

  /* ---------------- hosted list ---------------- */
  /** The signed-in person's feeds: shown on the start screen in place of the sign-in card. */
  function feedsBox() {
    var wrap = h('div', { class: 'pfg-feeds' }, [h('h2', { text: 'My feeds' }), h('p', { text: 'Loading…' })]);
    Host.listFeeds().then(function (feeds) {
      clear(wrap);
      wrap.appendChild(h('h2', { text: 'My feeds' }));
      var full = feeds.length >= (cfg.limits && cfg.limits.maxFeeds || 3);
      wrap.appendChild(h('div', { class: 'pfg-row' }, [
        btn('New feed', 'pfg-btn-primary', function () {
          openEditor({ model: Core.emptyModel({ defaults: cfg.defaults }), hosted: { id: null } });
        }, full ? { disabled: true } : {}),
      ]));
      if (full) wrap.appendChild(h('p', { class: 'pfg-hint', text: 'You have reached the limit of ' + cfg.limits.maxFeeds + ' hosted feeds.' }));
      if (cfg.requireApproval) wrap.appendChild(h('p', { class: 'pfg-hint', text: 'New feeds are reviewed before they go live.' }));
      if (!feeds.length) { wrap.appendChild(h('p', { text: 'You have no hosted feeds yet.' })); return; }
      feeds.forEach(function (f) {
        var live = f.status === 'published';
        wrap.appendChild(h('div', { class: 'pfg-card pfg-feed-card' }, [
          h('div', { class: 'pfg-feed-top' }, [
            h('strong', { text: f.title || f.slug }),
            h('span', { class: 'pfg-badge ' + (live ? 'pfg-badge-ok' : 'pfg-badge-warn'), text: f.status }),
          ]),
          f.movedTo ? h('div', { class: 'pfg-hint', text: 'Moved to ' + f.movedTo + ' on ' + new Date(f.movedAt * 1000).toISOString().slice(0, 10) }) : null,
          h('div', { class: 'pfg-row' }, [
            btn('Edit', 'pfg-btn-small', function () { editHosted(f); }),
            btn('Feed URL', 'pfg-btn-small', function () { openFeedUrl(f); }, live ? {} : { disabled: true, title: 'Not public yet' }),
            btn('Move feed', 'pfg-btn-small', function () { openMove(f); }),
            btn('Delete', 'pfg-btn-small pfg-btn-danger', function () { deleteHosted(f); }),
          ]),
        ]));
      });
    }).catch(function (e) {
      clear(wrap);
      if (e.status === 401) { // the session has ended: offer the sign-in again (no reload loop)
        wrap.appendChild(note('warn', 'Your session ended. Please sign in again.'));
        wrap.appendChild(btn('Get started', 'pfg-btn-primary', function () { openLogin(showStart); }));
        return;
      }
      wrap.appendChild(note('bad', errText(e)));
    });
    return wrap;
  }
  // The feed list is part of the start screen now.
  function showHostedList() { showStart(true); }

  function editHosted(f) {
    setBanner();
    Host.getFeed(f.id).then(function (r) {
      var m = r.feed, dropped = [], notes = [];
      if (r.importXml) { // a feed that was already on the server: read its existing file into the form
        var pr = window.PFGCore.parseXml(r.importXml, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
        if (pr.error) { setBanner('bad', 'Could not read the existing feed file: ' + pr.error); return; }
        m = Core.liftSupport(pr.model, cfg.platform); dropped = pr.droppedItems || [];
        notes = (pr.notes || []).filter(function (n) { return !/^Kept as-is/.test(n); }); // hosted feeds do not keep those tags: the save warning lists them
      }
      m.guid = r.guid; m.feedUrl = r.url;
      openEditor({ model: m, importNotes: notes, hosted: { id: r.id, slug: r.slug, status: r.status, url: r.url, dropped: dropped } });
    }).catch(function (e) { setBanner('bad', errText(e)); });
  }

  /* ---------------- move a feed to a new address ---------------- */
  // Two steps in one window: explain and ask for the new address, then ask "Are you sure?". Moving writes the new
  // address into the feed (itunes:new-feed-url) and publishes it; the feed stays here for cfg.keepMovedDays days.
  /** A window with the feed name and its address (copyable) and a button to open it. */
  function openFeedUrl(f) {
    var overlay = h('div', { class: 'pfg-app pfg-overlay' + (root && root.classList.contains('pfg-light') ? ' pfg-light' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Feed URL' });
    var modal = h('div', { class: 'pfg-modal' });
    overlay.appendChild(modal);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener('keydown', onKey); }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    var urlIn = h('input', { type: 'text', readonly: true, id: 'pfg-feedurl', value: f.url || '', 'aria-label': 'Feed URL' });
    urlIn.addEventListener('focus', function () { urlIn.select(); });
    var msg = h('div', { 'aria-live': 'polite' });
    function copy() {
      urlIn.select();
      var done = function () { clear(msg); msg.appendChild(note('ok', 'Copied.')); };
      var fail = function () { clear(msg); msg.appendChild(note('warn', 'Could not copy automatically. The address is selected: press Ctrl+C.')); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(f.url).then(done, fail);
      else { try { document.execCommand('copy') ? done() : fail(); } catch (e) { fail(); } }
    }
    modal.appendChild(h('h2', { text: f.title || f.slug }));
    modal.appendChild(h('label', { for: 'pfg-feedurl', text: 'Feed URL' }));
    modal.appendChild(urlIn);
    modal.appendChild(msg);
    modal.appendChild(h('div', { class: 'pfg-row', style: 'margin-top:12px' }, [
      btn('Copy', 'pfg-btn-primary', copy),
      h('a', { class: 'pfg-btn', href: f.url, target: '_blank', rel: 'noopener', text: 'Go to Feed URL' }),
      btn('Close', '', close),
    ]));
    document.body.appendChild(overlay);
    urlIn.focus();
  }

  function openMove(f) {
    var days = cfg.keepMovedDays || 28;
    var overlay = h('div', { class: 'pfg-app pfg-overlay' + (root && root.classList.contains('pfg-light') ? ' pfg-light' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Move feed' });
    var modal = h('div', { class: 'pfg-modal' });
    overlay.appendChild(modal);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener('keydown', onKey); }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    var urlIn = h('input', { type: 'url', id: 'pfg-move-url', placeholder: 'https://', autocomplete: 'off', 'aria-label': 'New feed URL', value: f.movedTo || '' });
    var msg = h('div');
    function step1() {
      clear(modal);
      modal.appendChild(h('h2', { text: 'Move "' + (f.title || f.slug) + '"' }));
      modal.appendChild(h('p', { text: 'This tells podcasting apps and Podcast Index that this feed has moved to a new URL, so they follow it there.' }));
      modal.appendChild(h('p', { text: 'You also need to update every feed that already has a relationship to this feed (for example the publisher feed and the feeds it lists) so they point to the new URL.' }));
      modal.appendChild(h('label', { for: 'pfg-move-url', text: 'New feed URL' }));
      modal.appendChild(urlIn);
      modal.appendChild(msg);
      modal.appendChild(h('div', { class: 'pfg-row', style: 'margin-top:12px' }, [
        btn('Move', 'pfg-btn-primary', function () {
          clear(msg);
          var v = urlIn.value.trim();
          if (!/^https:\/\/[^\s]+\.[^\s]+/i.test(v)) { msg.appendChild(note('bad', 'Enter the new address as a full https:// URL.')); urlIn.focus(); return; }
          step2(v);
        }),
        btn('Cancel', '', close),
      ]));
      urlIn.focus();
    }
    function step2(newUrl) {
      clear(modal);
      var err = h('div');
      modal.appendChild(h('h2', { text: 'Are you sure you want to move this feed?' }));
      modal.appendChild(h('p', {}, ['It will be moved to ', h('strong', { class: 'pfg-mono', text: newUrl }), '.']));
      modal.appendChild(h('p', { text: 'The feed will remain on here for a period of ' + days + ' ' + (days === 1 ? 'day' : 'days') + ' so apps can find the move. After that the site owner can delete it.' }));
      modal.appendChild(err);
      var go = btn('Yes, move it', 'pfg-btn-primary', function () {
        go.disabled = true; clear(err); err.appendChild(note('', 'Waiting for your signer to confirm…'));
        Host.moveFeed(f.id, newUrl).then(function () {
          close(); setBanner('ok', 'Feed moved. Apps will now be told about the new address.'); showHostedList();
        }).catch(function (e) { go.disabled = false; clear(err); err.appendChild(note('bad', errText(e))); });
      });
      modal.appendChild(h('div', { class: 'pfg-row', style: 'margin-top:12px' }, [go, btn('Cancel', '', close)]));
    }
    document.body.appendChild(overlay);
    step1();
  }

  function deleteHosted(f) {
    if (!window.confirm('Delete "' + (f.title || f.slug) + '"?\n\nThe public feed will stop working and its address can never be reused. Your signer will ask you to confirm.')) return;
    setBanner('', 'Waiting for your signer to confirm…');
    Host.deleteFeed(f.id).then(function () { setBanner('ok', 'Feed deleted.'); showHostedList(); })
      .catch(function (e) { setBanner('bad', errText(e)); });
  }

  /* ---------------- sign-in window ---------------- */
  function openLogin(after, opts) {
    opts = opts || {};
    var upgrade = !!opts.upgrade; // move this browser-key account to a signer app or extension (both keys sign)
    var npubOnly = !!opts.npubOnly; // read the public key only: no hosted session, signer forgotten afterwards
    var attempt = null, closed = false;
    var status = h('div', { 'aria-live': 'polite' });
    var panel = h('div');
    // The overlay is attached to <body>, outside #pfg-app, so it needs the app class to get the colour variables and base styles.
    var overlay = h('div', { class: 'pfg-app pfg-overlay' + (root && root.classList.contains('pfg-light') ? ' pfg-light' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': npubOnly ? 'Get your npub' : 'Get started' });
    var modal = h('div', { class: 'pfg-modal' });
    overlay.appendChild(modal);

    function close() {
      closed = true;
      if (attempt) { try { attempt.cancel(); } catch (e) { /* ignore */ } attempt = null; }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    function finish(connectPromise, waitMsg) {
      status.replaceChildren(note('', waitMsg || 'Waiting for your signer to approve…'));
      connectPromise.then(function (pk) { return upgrade ? Host.upgradeAccount(connectPromise) : (npubOnly ? pk : Host.login()); }).then(function (res) {
        if (closed) return;
        if (npubOnly) {
          var npub = Host.npubOf(res);
          Host.forgetSigner();
          close();
          if (typeof after === 'function') after(npub);
          return;
        }
        close(); renderBar();
        if (upgrade) setBanner('ok', 'Your account now uses your signer. Payments can be set up (reopen your feed if it is open), and your feeds and their addresses are unchanged.');
        if (typeof after === 'function') after();
      }).catch(function (e) {
        if (closed) return;
        status.replaceChildren(note('bad', errText(e)));
      });
    }

    Host.on('progress', function (msg) {
      if (closed) return;
      status.replaceChildren(note('', msg));
    });
    Host.on('auth-url', function (url) {
      if (closed || !/^https:\/\//i.test(url)) return;
      status.replaceChildren(note('warn', ['Your signer needs you to approve this in a browser: ', h('a', { href: url, target: '_blank', rel: 'noopener', text: 'open approval page' })]));
    });

    function tabExtension() {
      clear(panel);
      if (Host.hasExtension()) {
        panel.appendChild(h('p', { text: npubOnly
          ? 'Use your Nostr browser extension (for example Sidecar, Alby or nos2x). It will ask you to share your public key.'
          : 'Use your Nostr browser extension (for example Sidecar, Alby or nos2x). It will ask you to approve the sign-in.' }));
        panel.appendChild(h('div', { class: 'pfg-row', style: 'margin-top:10px' }, [
          btn(npubOnly ? 'Get npub from extension' : 'Sign in with extension', 'pfg-btn-primary', function () { finish(Host.connectExtension(), 'Waiting for your extension to approve…'); }),
        ]));
      } else {
        panel.appendChild(h('p', { text: 'No Nostr browser extension was found on this page. Install one (for example Sidecar, Alby or nos2x), allow it on this site, then press Check again. You can also use a signer app with the other options.' }));
        panel.appendChild(h('div', { class: 'pfg-row', style: 'margin-top:10px' }, [btn('Check again', '', function () { tabExtension(); })]));
      }
    }
    function tabPaste() {
      var input = h('input', { type: 'text', id: 'pfg-bunker', placeholder: 'bunker://…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Bunker link' });
      clear(panel);
      panel.appendChild(h('p', { text: 'In your signer app (for example Clave, Amber, Primal), copy the connection link that starts with bunker:// and paste it here.' }));
      panel.appendChild(input);
      panel.appendChild(h('div', { class: 'pfg-row', style: 'margin-top:10px' }, [
        btn('Connect', 'pfg-btn-primary', function () { finish(Host.connectBunker(input.value)); }),
      ]));
      input.focus();
    }
    function tabQr() {
      clear(panel);
      if (attempt) { attempt.cancel(); }
      attempt = Host.startNostrConnect();
      panel.appendChild(h('p', { text: 'Scan this code with your signer app (eg. Primal, Amber, Clave), or copy the link into it.' }));
      var qr = h('div', { class: 'pfg-qr' });
      qr.innerHTML = attempt.qr; // generated locally from the connection link
      panel.appendChild(qr);
      var link = h('input', { type: 'text', readonly: true, value: attempt.uri, 'aria-label': 'Connection link' });
      link.addEventListener('focus', function () { link.select(); });
      panel.appendChild(link);
      panel.appendChild(h('p', { class: 'pfg-hint', text: 'Relays used: ' + (attempt.relays && attempt.relays.length ? attempt.relays.join(', ') : 'none set') + '. Your signer must be able to reach at least one of them.' }));
      finish(attempt.done);
    }

    var tabs = h('div', { class: 'pfg-tabs', role: 'tablist' });
    function tabNew() {
      clear(panel);
      if (Host.hasBrowserKey()) {
        panel.appendChild(h('p', { text: 'A key from an account you made here is kept in this browser.' }));
        panel.appendChild(h('div', { class: 'pfg-row' }, [
          btn('Sign in with this browser\'s key', 'pfg-btn-primary', function () { finish(Host.connectBrowserKey(), 'Signing in…'); }),
        ]));
        panel.appendChild(h('p', { class: 'pfg-hint', style: 'margin-top:12px' }, ['For a safer, lasting account that can set up payments, use a signer app or a browser extension. ', moreInfoLink()]));
        panel.appendChild(h('div', { class: 'pfg-row' }, [btn('Forget this key', 'pfg-btn-small pfg-btn-danger', function () {
          if (window.confirm('Forget the key kept in this browser? You will not be able to sign in to that account again, and its feeds will be out of reach.')) { Host.forgetBrowserKey(); close(); openLogin(after, opts); }
        })]));
        return;
      }
      panel.appendChild(h('p', { text: 'No key is kept in this browser.' }));
    }
    var createBlock = h('div');
    if (!Host.hasBrowserKey()) {
        var input = h('input', { type: 'text', id: 'pfg-newname', placeholder: 'Your name', autocomplete: 'off', 'aria-label': 'Your name' });
        createBlock.appendChild(h('p', { text: 'You can get started with this and move to a permanent solution later.' }));
        createBlock.appendChild(input);
        createBlock.appendChild(h('div', { class: 'pfg-row', style: 'margin-top:10px' }, [
          btn('Create account', 'pfg-btn-primary', function () { finish(Host.createBrowserAccount(input.value), 'Creating your account…'); }),
        ]));
        createBlock.appendChild(h('p', { class: 'pfg-hint', style: 'margin-top:12px' }, ['IMPORTANT! This account only works in this browser, and is lost if you clear your browser data. Payments are not available until you use a signer app or a browser extension. ', moreInfoLink()]));

      setTimeout(function () { if (!closed) input.focus(); }, 0);
    }
    var tNew = btn('This browser', 'pfg-tab', function () { sel(tNew); status.replaceChildren(); if (attempt) { attempt.cancel(); attempt = null; } tabNew(); }, { role: 'tab' });
    var tExt = btn('Browser extension', 'pfg-tab', function () { sel(tExt); status.replaceChildren(); if (attempt) { attempt.cancel(); attempt = null; } tabExtension(); }, { role: 'tab' });
    var tPaste = btn('Paste bunker link', 'pfg-tab', function () { sel(tPaste); status.replaceChildren(); if (attempt) { attempt.cancel(); attempt = null; } tabPaste(); }, { role: 'tab' });
    var tQr = btn('Scan QR code', 'pfg-tab', function () { sel(tQr); status.replaceChildren(); tabQr(); }, { role: 'tab' });
    function sel(t) { [tNew, tExt, tPaste, tQr].forEach(function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); }); }
    // An installed extension is the quickest way in, so it comes first and is preselected; otherwise it is the last option.
    var extFirst = Host.hasExtension();
    // Create account is first and the default (when it is offered), then Scan QR code, then the rest.
    var newFirst = !npubOnly && !upgrade;
    var order = newFirst ? (Host.hasBrowserKey() ? [tNew, tExt, tQr, tPaste] : [tExt, tQr, tPaste]) : (extFirst ? [tExt, tPaste, tQr] : [tPaste, tQr, tExt]);
    order.forEach(function (t) { tabs.appendChild(t); });

    modal.appendChild(h('h2', { text: upgrade ? 'Upgrade your sign-in' : (npubOnly ? 'Get your npub' : 'Get started') }));
    modal.appendChild(h('p', { class: 'pfg-hint', text: upgrade
      ? 'Connect a signer app or browser extension. Your account, feeds and feed addresses move to that key. You will be asked to approve the move, and the key kept in this browser is removed afterwards.'
      : npubOnly
      ? 'Connect your signer app or browser extension so we can read your public key (npub). You are not signed in and nothing is saved on this site. Your private key stays in your signer.'
      : 'You can simply "Create account" to get up and running but you should consider moving to a Nostr authentication method for continued use.' }));
    if (newFirst) {
      modal.appendChild(createBlock);
      modal.appendChild(h('h3', { text: 'Already using Nostr?' }));
      modal.appendChild(h('p', { text: 'Sign back into your account' }));
    }
    modal.appendChild(tabs);
    modal.appendChild(panel);
    modal.appendChild(status);
    modal.appendChild(h('div', { class: 'pfg-row', style: 'margin-top:12px' }, [btn('Cancel', '', close)]));
    document.body.appendChild(overlay);
    if (newFirst) { if (Host.hasBrowserKey()) { sel(tNew); tabNew(); } else if (extFirst) { sel(tExt); tabExtension(); } } else if (extFirst) { sel(tExt); tabExtension(); } else { sel(tPaste); tabPaste(); }
  }

  /* ---------------- start ---------------- */
  showStart();
  if (hostingOn) {
    Host.on('session', function () { renderBar(); });
    Host.resume().then(function (s) { if (s) { renderBar(); if (view === 'start') showStart(); } });
  }
})();
