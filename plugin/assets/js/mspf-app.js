/**
 * MSP Publisher Feeds: app shell.
 *
 * Start screen, pasted-XML import, draft autosave, sign-in window and the
 * hosted feed list. The feed form itself lives in mspf-editor.js
 * (window.MSPFEditor.render).
 */
(function () {
  'use strict';

  var root = document.getElementById('mspf-app');
  if (!root) return;

  var cfg;
  try { cfg = JSON.parse(document.getElementById('mspf-config').textContent); } catch (e) { cfg = null; }
  if (!cfg) { root.textContent = 'The feed generator could not load its settings.'; return; }

  var Core = window.MSPFCore;
  var Host = window.MSPFHosting;
  var hostingOn = !!(cfg.hostingAvailable && window.MSPFNostr && Host && Host.init(cfg));
  var DRAFT_KEY = 'mspf_draft_v1';

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
  function btn(label, cls, fn, extra) { return h('button', Object.assign({ type: 'button', class: 'mspf-btn ' + (cls || ''), onclick: fn }, extra || {}), label); }
  function note(kind, content) { return h('div', { class: 'mspf-note mspf-note-' + kind, role: kind === 'bad' ? 'alert' : 'status' }, content); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function errText(e) { return e && e.message ? e.message : String(e); }

  var draftStore = {
    load: function () { try { var s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
    save: function (model) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), model: model })); } catch (e) { /* storage unavailable */ } },
    clear: function () { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } },
  };

  /* ---------------- layout ---------------- */
  var barEl = h('div', { class: 'mspf-bar' });
  var bodyEl = h('div', { class: 'mspf-body' });
  var bannerEl = h('div', { 'aria-live': 'polite' });
  root.appendChild(barEl);
  root.appendChild(bannerEl);
  root.appendChild(bodyEl);

  function renderBar() {
    clear(barEl);
    var s = hostingOn ? Host.getSession() : null;
    barEl.appendChild(h('div', { class: 'mspf-bar-title', text: 'Publisher feed generator' }));
    var actions = h('div', { class: 'mspf-bar-actions' });
    if (s) {
      actions.appendChild(h('span', { class: 'mspf-who', text: 'Signed in as ' + s.npub.slice(0, 12) + '…' + s.npub.slice(-6) }));
      actions.appendChild(btn('Sign out', 'mspf-btn-small', function () { Host.logout().then(function () { showStart(); }); }));
    }
    barEl.appendChild(actions);
  }

  function setBanner(kind, msg) { clear(bannerEl); if (msg) bannerEl.appendChild(note(kind, msg)); }

  function mount(node, name) { if (name) view = name; mountNode(node); }
  function mountNode(node) { clear(bodyEl); bodyEl.appendChild(node); renderBar(); window.scrollTo && root.scrollIntoView && root.scrollIntoView({ block: 'start' }); }

  /* ---------------- start screen ---------------- */
  var view = 'start';
  function showStart() {
    view = 'start';
    setBanner();
    var wrap = h('div');
    var draft = draftStore.load();
    if (draft && draft.model) {
      wrap.appendChild(note('', h('div', { class: 'mspf-row' }, [
        h('span', { text: 'You have an unfinished draft' + (draft.model.title ? ' ("' + draft.model.title + '")' : '') + ' saved in this browser.' }),
        h('span', { class: 'mspf-spacer' }),
        btn('Resume draft', 'mspf-btn-primary mspf-btn-small', function () { openEditor({ model: draft.model, hosted: null }); }),
        btn('Discard', 'mspf-btn-small', function () { draftStore.clear(); showStart(); }),
      ])));
    }
    wrap.appendChild(h('p', { text: 'Build a Podcasting 2.0 publisher feed for your label, studio, host or artist page. Download it and host it yourself, or sign in and we will host it for you.' }));
    var cards = h('div', { class: 'mspf-cards' }, [
      h('div', { class: 'mspf-card' }, [
        h('h3', { text: 'Create a new feed' }),
        h('p', { text: 'Start from scratch. No account needed. Download the XML when you are done.' }),
        btn('Start', 'mspf-btn-primary', function () { openEditor({ model: Core.emptyModel({ defaults: cfg.defaults, platformApplied: cfg.applyPlatformToExports ? cfg.platform : [] }), hosted: null }); }),
      ]),
      h('div', { class: 'mspf-card' }, [
        h('h3', { text: 'Edit an existing feed' }),
        h('p', { text: 'Paste the XML of a publisher feed you already have, change it, and download the result.' }),
        btn('Paste XML', '', showImport),
      ]),
    ]);
    if (hostingOn) {
      var s = Host.getSession();
      cards.appendChild(h('div', { class: 'mspf-card' }, [
        h('h3', { text: 'Hosted feeds' }),
        h('p', { text: 'We host your feed at ' + (cfg.siteName || 'this site') + ' and keep it updated as you add releases. Sign in with a Nostr remote signer.' }),
        btn(s ? 'My feeds' : 'Sign in', '', function () { if (s) showHostedList(); else openLogin(showHostedList); }),
      ]));
    } else if (cfg.hostingNeedsGmp) {
      wrap.appendChild(h('p', { class: 'mspf-hint', text: 'Hosting is unavailable on this server right now. You can still create and download feeds.' }));
    }
    wrap.appendChild(cards);
    mount(wrap);
  }

  /* ---------------- import (paste XML only) ---------------- */
  function showImport() {
    setBanner();
    var ta = h('textarea', { class: 'mspf-xml', id: 'mspf-import-xml', placeholder: '<?xml version="1.0" encoding="UTF-8"?>\n<rss …>', 'aria-label': 'Feed XML', spellcheck: 'false' });
    var out = h('div', { 'aria-live': 'polite' });
    var wrap = h('div', {}, [
      h('h2', { text: 'Edit an existing feed' }),
      h('p', { text: 'Paste the full XML of a publisher feed (one with podcast:medium "publisher"). Anything this tool cannot edit is kept as it is.' }),
      ta, out,
      h('div', { class: 'mspf-row' }, [
        btn('Import', 'mspf-btn-primary', function () {
          clear(out);
          var r = Core.parseXml(ta.value, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
          if (r.error) { out.appendChild(note('bad', r.error)); return; }
          openEditor({ model: r.model, hosted: null, importNotes: r.notes || [] });
        }),
        btn('Back', '', showStart),
      ]),
    ]);
    mount(wrap);
    ta.focus();
  }

  /* ---------------- editor ---------------- */
  function openEditor(opts) {
    if (!window.MSPFEditor) { setBanner('bad', 'The editor failed to load. Please reload the page.'); return; }
    var wrap = h('div');
    view = 'editor';
    mount(wrap);
    window.MSPFEditor.render(wrap, {
      cfg: cfg,
      model: opts.model,
      hosted: opts.hosted,
      importNotes: opts.importNotes || [],
      host: hostingOn ? Host : null,
      hostingOn: hostingOn,
      saveDraft: function (m) { if (!opts.hosted) draftStore.save(m); },
      clearDraft: draftStore.clear,
      needSignIn: function (then) { openLogin(then); },
      back: function () { if (opts.hosted) showHostedList(); else showStart(); },
      h: h, btn: btn, note: note, clear: clear,
    });
  }

  /* ---------------- hosted list ---------------- */
  function showHostedList() {
    var wrap = h('div', {}, [h('h2', { text: 'Your hosted feeds' }), h('p', { text: 'Loading…' })]);
    mount(wrap);
    Host.listFeeds().then(function (feeds) {
      clear(wrap);
      wrap.appendChild(h('h2', { text: 'Your hosted feeds' }));
      var full = feeds.length >= (cfg.limits && cfg.limits.maxFeeds || 3);
      var top = h('div', { class: 'mspf-row' }, [
        btn('New hosted feed', 'mspf-btn-primary', function () {
          openEditor({ model: Core.emptyModel({ defaults: cfg.defaults, platformApplied: cfg.platform }), hosted: { id: null } });
        }, full ? { disabled: true } : {}),
        btn('Back', '', showStart),
      ]);
      wrap.appendChild(top);
      if (full) wrap.appendChild(h('p', { class: 'mspf-hint', text: 'You have reached the limit of ' + cfg.limits.maxFeeds + ' hosted feeds.' }));
      if (cfg.requireApproval) wrap.appendChild(h('p', { class: 'mspf-hint', text: 'New feeds are reviewed before they go live.' }));
      if (!feeds.length) { wrap.appendChild(h('p', { text: 'You have no hosted feeds yet.' })); return; }
      var tbody = h('tbody');
      feeds.forEach(function (f) {
        var live = f.status === 'published';
        tbody.appendChild(h('tr', {}, [
          h('td', {}, [h('strong', { text: f.title || f.slug }), h('div', { class: 'mspf-hint mspf-mono', text: f.slug })]),
          h('td', {}, [h('span', { class: 'mspf-badge ' + (live ? 'mspf-badge-ok' : 'mspf-badge-warn'), text: f.status })]),
          h('td', {}, live ? [h('a', { href: f.url, target: '_blank', rel: 'noopener', text: f.url })] : [h('span', { class: 'mspf-hint', text: 'Not public' })]),
          h('td', {}, [h('div', { class: 'mspf-row' }, [
            btn('Edit', 'mspf-btn-small', function () { editHosted(f); }),
            btn('Delete', 'mspf-btn-small mspf-btn-danger', function () { deleteHosted(f); }),
          ])]),
        ]));
      });
      wrap.appendChild(h('table', { class: 'mspf-table' }, [
        h('thead', {}, [h('tr', {}, ['Feed', 'Status', 'URL', ''].map(function (t) { return h('th', { text: t }); }))]),
        tbody,
      ]));
    }).catch(function (e) {
      if (e.status === 401) { showStart(); setBanner('warn', 'Your session ended. Please sign in again.'); return; }
      clear(wrap); wrap.appendChild(note('bad', errText(e))); wrap.appendChild(btn('Back', '', showStart));
    });
  }

  function editHosted(f) {
    setBanner();
    Host.getFeed(f.id).then(function (r) {
      var m = r.feed;
      m.guid = r.guid; m.feedUrl = r.url;
      openEditor({ model: m, hosted: { id: r.id, slug: r.slug, status: r.status, url: r.url } });
    }).catch(function (e) { setBanner('bad', errText(e)); });
  }

  function deleteHosted(f) {
    if (!window.confirm('Delete "' + (f.title || f.slug) + '"?\n\nThe public feed will stop working and its address can never be reused. Your signer will ask you to confirm.')) return;
    setBanner('', 'Waiting for your signer to confirm…');
    Host.deleteFeed(f.id).then(function () { setBanner('ok', 'Feed deleted.'); showHostedList(); })
      .catch(function (e) { setBanner('bad', errText(e)); });
  }

  /* ---------------- sign-in window ---------------- */
  function openLogin(after) {
    var attempt = null, closed = false;
    var status = h('div', { 'aria-live': 'polite' });
    var panel = h('div');
    var overlay = h('div', { class: 'mspf-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sign in' });
    var modal = h('div', { class: 'mspf-modal' });
    overlay.appendChild(modal);

    function close() {
      closed = true;
      if (attempt) { try { attempt.cancel(); } catch (e) { /* ignore */ } attempt = null; }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    function finish(connectPromise) {
      status.replaceChildren(note('', 'Waiting for your signer to approve…'));
      connectPromise.then(function () { return Host.login(); }).then(function () {
        if (closed) return;
        close(); renderBar();
        if (typeof after === 'function') after();
      }).catch(function (e) {
        if (closed) return;
        status.replaceChildren(note('bad', errText(e)));
      });
    }

    Host.on('auth-url', function (url) {
      if (closed || !/^https:\/\//i.test(url)) return;
      status.replaceChildren(note('warn', ['Your signer needs you to approve this in a browser: ', h('a', { href: url, target: '_blank', rel: 'noopener', text: 'open approval page' })]));
    });

    function tabPaste() {
      var input = h('input', { type: 'text', id: 'mspf-bunker', placeholder: 'bunker://…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Bunker link' });
      clear(panel);
      panel.appendChild(h('p', { text: 'In your signer app (for example nsec.app or Amber), copy the connection link that starts with bunker:// and paste it here.' }));
      panel.appendChild(input);
      panel.appendChild(h('div', { class: 'mspf-row', style: 'margin-top:10px' }, [
        btn('Connect', 'mspf-btn-primary', function () { finish(Host.connectBunker(input.value)); }),
      ]));
      input.focus();
    }
    function tabQr() {
      clear(panel);
      if (attempt) { attempt.cancel(); }
      attempt = Host.startNostrConnect();
      panel.appendChild(h('p', { text: 'Scan this code with your signer app, or copy the link into it.' }));
      var qr = h('div', { class: 'mspf-qr' });
      qr.innerHTML = attempt.qr; // generated locally from the connection link
      panel.appendChild(qr);
      var link = h('input', { type: 'text', readonly: true, value: attempt.uri, 'aria-label': 'Connection link' });
      link.addEventListener('focus', function () { link.select(); });
      panel.appendChild(link);
      finish(attempt.done);
    }

    var tabs = h('div', { class: 'mspf-tabs', role: 'tablist' });
    var tPaste = btn('Paste bunker link', 'mspf-tab', function () { sel(tPaste); status.replaceChildren(); if (attempt) { attempt.cancel(); attempt = null; } tabPaste(); }, { role: 'tab' });
    var tQr = btn('Scan QR code', 'mspf-tab', function () { sel(tQr); status.replaceChildren(); tabQr(); }, { role: 'tab' });
    function sel(t) { [tPaste, tQr].forEach(function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); }); }
    tabs.appendChild(tPaste); tabs.appendChild(tQr);

    modal.appendChild(h('h2', { text: 'Sign in with Nostr' }));
    modal.appendChild(h('p', { class: 'mspf-hint', text: 'Your private key stays in your signer app. This site never sees it.' }));
    modal.appendChild(tabs);
    modal.appendChild(panel);
    modal.appendChild(status);
    modal.appendChild(h('div', { class: 'mspf-row', style: 'margin-top:12px' }, [btn('Cancel', '', close)]));
    document.body.appendChild(overlay);
    sel(tPaste); tabPaste();
  }

  /* ---------------- start ---------------- */
  showStart();
  if (hostingOn) {
    Host.on('session', function () { renderBar(); });
    Host.resume().then(function (s) { if (s) { renderBar(); if (view === 'start') showStart(); } });
  }
})();
