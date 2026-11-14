/**
 * Publisher Feed Generator: the feed editor form.
 * window.PFGEditor.render(container, ctx) is called by pfg-app.js.
 * One editor serves both modes: anonymous (download/copy) and hosted (save).
 */
(function () {
  'use strict';

  var Core = window.PFGCore;
  var SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,39}$/;

  function getPath(obj, path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj); }
  function setPath(obj, path, val) {
    var ks = path.split('.'), last = ks.pop();
    var t = ks.reduce(function (o, k) { return o[k]; }, obj);
    t[last] = val;
  }

  function render(container, ctx) {
    var h = ctx.h, btn = ctx.btn, note = ctx.note, clear = ctx.clear, cfg = ctx.cfg;
    var hosted = ctx.hosted; // null (anonymous) or { id|null, slug, status, url }
    var m = JSON.parse(JSON.stringify(ctx.model));
    m.releases = m.releases || [];
    if (!m.created) m.created = Math.floor(Date.now() / 1000); // creation date for <pubDate>; kept in the draft; hosted feeds get the server's date
    m.value = m.value || { method: 'lnaddress', suggested: '', recipients: [] };
    m.funding = m.funding || { url: '', text: '' };
    var platform = cfg.platform || []; // configured "Support the developers" recipients; the creator chooses each split (m.support)
    m.support = Core.ensureSupport(m.support, platform);
    function pTotal() { return Core.platformTotal(Core.activePlatform(platform, m.support)); }
    var slug = hosted && hosted.slug ? hosted.slug : '';
    var fields = {};      // path -> {wrap, err}
    var showDet = new Set(); // releases whose feed details are expanded
    var ui = new Map();   // release object -> {status, info, open}
    var timer = null, saving = false, slugMsg = '', dirty = false; // dirty: changed since the last save
    var slugAuto = !!(hosted && !hosted.id); // the feed name follows the title until the user types their own

    /* ---------- model <-> options ---------- */
    function hostedUrl() { return cfg.feedBaseUrl + slug + '/' + slug + '.xml'; }
    function syncHostedIdentity() {
      if (!hosted) return;
      if (hosted.id) { m.feedUrl = hosted.url; return; }
      m.feedUrl = SLUG_RE.test(slug) ? hostedUrl() : '';
      m.guid = m.feedUrl ? Core.guidForUrl(m.feedUrl) : '';
    }
    function normOpts() {
      var o = { hosted: !!hosted, platform: platform, maxReleases: cfg.limits.maxReleases, defaultMethod: cfg.defaults.method, allowAttrs: !hosted };
      if (hosted) { o.guid = m.guid; o.feedUrl = m.feedUrl; }
      return o;
    }
    function clean() { return Core.normalize(m, normOpts()); }

    /* ---------- field builders ---------- */
    function field(label, path, o) {
      o = o || {};
      var id = 'pfg-f-' + path.replace(/\./g, '-');
      var val = getPath(m, path);
      var input;
      if (o.select) {
        var sopts = o.select.map(function (opt) { return typeof opt === 'string' ? { value: opt, label: opt } : opt; });
        var cur = val === undefined || val === null ? '' : String(val);
        var hit = sopts.filter(function (x) { return x.value.toLowerCase() === cur.toLowerCase(); })[0];
        // A value the list does not know (for example from an imported feed) stays selectable instead of being lost.
        if (o.keepUnknown && cur !== '' && !hit) { hit = { value: cur, label: cur + ' (current value)' }; sopts.push(hit); }
        input = h('select', { id: id }, sopts.map(function (opt) { return h('option', { value: opt.value, text: opt.label }); }));
        input.value = hit ? hit.value : sopts[0].value;
      } else if (o.textarea) {
        input = h('textarea', { id: id, rows: o.rows || 4 });
        input.value = val || '';
      } else {
        input = h('input', { id: id, type: o.type || 'text', autocomplete: 'off', spellcheck: 'false' });
        input.value = val === undefined || val === null ? '' : val;
        if (o.type === 'number') { input.setAttribute('min', '1'); input.setAttribute('max', '100'); input.setAttribute('step', '1'); }
      }
      if (o.readonly) { input.setAttribute('readonly', ''); if (o.select) input.setAttribute('disabled', ''); }
      if (o.placeholder) input.setAttribute('placeholder', o.placeholder);
      var err = h('div', { class: 'pfg-error', id: id + '-err' });
      var wrap = h('div', { class: 'pfg-field' + (o.wide ? ' pfg-wide' : '') }, [h('label', { for: id, text: label }), input, o.hint ? h('div', { class: 'pfg-hint', text: o.hint }) : null, err]);
      input.setAttribute('aria-describedby', id + '-err');
      var ev = o.select ? 'change' : 'input';
      input.addEventListener(ev, function () {
        var v = input.value;
        if (o.type === 'number') v = v === '' ? '' : parseInt(v, 10);
        setPath(m, path, v);
        if (o.onchange) o.onchange(v, input);
        changed();
      });
      fields[path] = { wrap: wrap, err: err, input: input };
      return wrap;
    }
    function check(label, path) {
      var cb = h('input', { type: 'checkbox', id: 'pfg-c-' + path });
      cb.checked = !!getPath(m, path);
      cb.addEventListener('change', function () { setPath(m, path, cb.checked); changed(); });
      return h('label', { class: 'pfg-check pfg-wide', for: 'pfg-c-' + path }, [cb, label]);
    }
    // The form sections work as an accordion: opening one closes the others, and every section but the last ends with a Next button.
    var sectionList = [], lastOpen = null;
    function openSection(d) {
      sectionList.forEach(function (x) { if (x !== d) x.removeAttribute('open'); });
      d.setAttribute('open', ''); lastOpen = d;
    }
    // A section can have a gate: you cannot move on from it (Next, or opening another section) until it passes.
    function mayLeave(d) { return !d || !d._gate || d._gate(); }
    function section(title, open, kids, hasNext, gate) {
      var idx = sectionList.length;
      var sum = h('summary', { text: title });
      var all = [sum].concat(kids);
      if (hasNext) all.push(h('div', { class: 'pfg-next' }, [btn('Next', 'pfg-btn-small pfg-btn-primary', function () {
        var n = sectionList[idx + 1];
        if (n && mayLeave(sectionList[idx])) { openSection(n); try { n.scrollIntoView({ block: 'start' }); } catch (e) { /* not essential */ } }
      })]));
      var d = h('details', { class: 'pfg-section' }, all);
      d._gate = gate || null;
      // After the browser has toggled this section: if it is now open, close the others and bring it to the top so the
      // reader keeps their place (the sections above may have collapsed).
      sum.addEventListener('click', function () {
        setTimeout(function () {
          if (!d.hasAttribute('open')) { if (lastOpen === d) lastOpen = null; return; } // it was closed
          if (lastOpen && lastOpen !== d && !mayLeave(lastOpen)) { d.removeAttribute('open'); lastOpen.setAttribute('open', ''); return; } // the section being left is not complete
          sectionList.forEach(function (x) { if (x !== d) x.removeAttribute('open'); });
          lastOpen = d;
          try { d.scrollIntoView({ block: 'start' }); } catch (e) { /* not essential */ }
        }, 0);
      });
      if (open) { d.setAttribute('open', ''); lastOpen = d; }
      sectionList.push(d);
      return d;
    }

    /* ---------- sections ---------- */
    var banner = h('div', { 'aria-live': 'polite' });
    var summaryErr = h('div');
    var lintEl = h('div');
    var doneEl = h('div', { 'aria-live': 'polite' }); // message about the download, shown under its button
    var totalEl = h('div', { class: 'pfg-total' });
    var recipsEl = h('div');
    var releasesEl = h('div');

    var basics = section('Basics', true, [h('div', { class: 'pfg-grid' }, [
      field('Name / title', 'title', { hint: 'Your label, studio or business name.', onchange: function () { autoSlug(); } }),
      field('Description', 'description', { textarea: true, wide: true }),
      field('Website', 'link', { type: 'url', placeholder: 'https://' }),
      field('Image URL (square)', 'image', { type: 'url', placeholder: 'https://' }),
      field('Language', 'language', { select: Core.LANGUAGES, keepUnknown: true, hint: 'The main language of your feed.' }),
      field('Feed maintainer (your name)', 'ownerName'),
      field('Feed contact email (your email)', 'ownerEmail', { type: 'email' }),
    ])], true, basicsGate);

    var slugField = null, slugInputs = null, identityKids = [], applySlug = null;
    function autoSlug() { if (slugAuto && applySlug) applySlug(Core.slugify(m.title)); }
    if (hosted && !hosted.id) {
      slugField = h('div', { class: 'pfg-field' }, []);
      var si = h('input', { type: 'text', id: 'pfg-f-slug', autocomplete: 'off', spellcheck: 'false', placeholder: 'my-label' });
      si.value = slug;
      var serr = h('div', { class: 'pfg-error', id: 'pfg-f-slug-err' });
      var urlOut = h('div', { class: 'pfg-hint pfg-mono' });
      function slugChanged() {
        slug = si.value.trim().toLowerCase();
        syncHostedIdentity();
        urlOut.textContent = m.feedUrl ? 'Your feed will be at ' + m.feedUrl : '';
        slugMsg = slug && !SLUG_RE.test(slug) ? 'Use 3 to 40 lowercase letters, numbers, "-" or "_", starting with a letter or number.' : '';
        serr.textContent = slugMsg;
        changed();
      }
      si.addEventListener('input', function () { slugAuto = si.value.trim() === ''; slugChanged(); }); // typing your own name stops the automatic one; clearing it brings it back
      applySlug = function (s) { si.value = s; slugChanged(); };
      // The feed name is made from the title automatically, so its input is hidden. It is shown only when it needs fixing (invalid or already taken).
      slugInputs = h('div', {}, [h('label', { for: 'pfg-f-slug', text: 'Feed name (web address)' }), si,
        h('div', { class: 'pfg-hint', text: 'Made from your name; change it if you like. After you save it cannot be changed, and the address can never be reused if you delete the feed.' })]);
      slugInputs.style.display = 'none';
      slugField.appendChild(slugInputs); slugField.appendChild(serr); slugField.appendChild(urlOut);
      fields.slug = { wrap: slugField, err: serr, input: si };
      identityKids.push(slugField);
    } else if (hosted) {
      identityKids.push(h('div', { class: 'pfg-field pfg-wide' }, [h('span', { class: 'pfg-label', text: 'Feed URL' }), h('div', { class: 'pfg-mono', text: hosted.url })]));
      identityKids.push(h('div', { class: 'pfg-field pfg-wide' }, [h('span', { class: 'pfg-label', text: 'Feed GUID' }), h('div', { class: 'pfg-mono', text: m.guid })]));
    } else {
      var nostrSession = ctx.host && ctx.host.getSession ? ctx.host.getSession() : null; // signed in with Nostr: assume the feed will be hosted
      identityKids.push(field(nostrSession ? 'Feed URL' : 'Feed URL (where you will host it)', 'feedUrl', {
        type: 'url', placeholder: 'https://example.com/publisher.xml', wide: true,
        hint: 'The final public address of this XML file.',
        onchange: function (v) {
          if (Core.isHttpsUrl(v) && (!m.guid || fields.guid.autoGuid)) { m.guid = Core.guidForUrl(v); fields.guid.input.value = m.guid; fields.guid.autoGuid = true; }
        },
      }));
      identityKids.push(field('Feed GUID', 'guid', {
        wide: true, hint: 'Filled in from the feed URL. Keep your existing GUID if you are editing a feed that already exists.',
        onchange: function () { fields.guid.autoGuid = false; },
      }));
      fields.guid.autoGuid = !m.guid;
      var guidStatus = h('span', { class: 'pfg-hint', 'aria-live': 'polite' });
      fields.guid.wrap.insertBefore(h('div', { class: 'pfg-row', style: 'margin-top:6px' }, [btn('Generate GUID', 'pfg-btn-small', function () {
        var url = (m.feedUrl || '').trim(), fromUrl = Core.isHttpsUrl(url);
        m.guid = fromUrl ? Core.guidForUrl(url) : Core.randomGuid();
        fields.guid.input.value = m.guid; fields.guid.autoGuid = fromUrl;
        guidStatus.textContent = fromUrl ? 'Made from your feed URL (the standard way).' : 'No feed URL yet, so this is a random GUID. Keep it: if you move the feed later, use the same GUID.';
        changed();
      }), guidStatus]), fields.guid.err);
    }
    identityKids.push(field('New feed URL (only if you are moving this feed)', 'newFeedUrl', { type: 'url', placeholder: 'https://', wide: true, hint: 'Tells Podcast Index and podcasting apps this feed now lives at a new address (itunes:new-feed-url). Keep this feed online at its old address, with the same GUID, until apps have switched. Leave empty otherwise.' }));
    identityKids.push(field('Include npub in the feed? (optional)', 'npub', { wide: true, hint: 'Public Nostr key only (starts with npub). Never paste a secret key (nsec).' }));
    // "Get your npub": from the signed-in account, or by asking a signer for its public key (nothing is saved).
    var npubStatus = h('span', { class: 'pfg-hint', 'aria-live': 'polite' });
    function setNpub(npub) { m.npub = npub; fields.npub.input.value = npub; changed(); }
    function getNpub() {
      var s = ctx.host && ctx.host.getSession ? ctx.host.getSession() : null;
      if (s && s.npub) { setNpub(s.npub); npubStatus.textContent = 'Filled in from your signed-in account.'; return; }
      if (ctx.getNpub) { ctx.getNpub(function (npub) { setNpub(npub); npubStatus.textContent = 'Filled in from your signer.'; }); return; }
      npubStatus.textContent = 'This page cannot connect to a signer. Copy your npub (it starts with npub1) from your Nostr app and paste it above.';
    }
    fields.npub.wrap.insertBefore(h('div', { class: 'pfg-row', style: 'margin-top:6px' }, [btn('Get your npub', 'pfg-btn-small', getNpub), npubStatus]), fields.npub.input.nextSibling);
    identityKids.push(field('Support link (optional)', 'funding.url', { type: 'url', placeholder: 'https://' }));
    identityKids.push(field('Support link text', 'funding.text', { hint: 'For example "Support us".' }));
    var identity = section('Identity and links', false, [h('div', { class: 'pfg-grid' }, identityKids)], true);

    /* payments */
    function renderRecipients() {
      clear(recipsEl);
      m.value.recipients.forEach(function (r, i) {
        var base = 'value.recipients.' + i;
        var item = h('div', { class: 'pfg-item' }, [
          h('div', { class: 'pfg-item-head' }, [h('strong', { text: 'Recipient ' + (i + 1) }), btn('Remove', 'pfg-btn-small pfg-btn-danger', function () { m.value.recipients.splice(i, 1); renderRecipients(); changed(); })]),
          h('div', { class: 'pfg-grid' }, [
            field('Name', base + '.name'),
            field('Type', base + '.type', { select: ['lnaddress', 'node'], onchange: function () { renderRecipients(); } }),
            field(r.type === 'node' ? 'Node public key (66 hex)' : 'Lightning address', base + '.address', { placeholder: r.type === 'node' ? '' : 'name@domain.com' }),
            field('Split (%)', base + '.split', { type: 'number' }),
            r.type === 'node' ? field('Custom key (optional)', base + '.customKey') : null,
            r.type === 'node' ? field('Custom value (optional)', base + '.customValue') : null,
          ].filter(Boolean)),
        ]);
        recipsEl.appendChild(item);
      });
      updateTotal();
    }
    function updateTotal() {
      var t = 0; m.value.recipients.forEach(function (r) { t += parseInt(r.split, 10) || 0; });
      var need = 100 - pTotal();
      if (!m.value.recipients.length) { totalEl.textContent = 'No payment recipients: your feed will have no payment block. This section is optional.'; totalEl.className = 'pfg-total'; return; }
      totalEl.textContent = 'Your recipients total ' + t + '% of ' + need + '%' + (pTotal() ? ' (support for the developers takes ' + pTotal() + '%)' : '') + '.';
      totalEl.className = 'pfg-total ' + (t === need ? 'pfg-good' : 'pfg-bad');
    }
    /* ---------- "Support the developers (optional)": editable split per configured recipient ---------- */
    var supportEl = h('div', { class: 'pfg-support' });
    function renderSupport() {
      clear(supportEl);
      if (!platform.length) return;
      supportEl.appendChild(h('h4', { class: 'pfg-subhead', text: 'Support the developers (optional)' }));
      supportEl.appendChild(h('p', { class: 'pfg-hint', text: 'These projects each get a small share of what is paid to your feed. Change a share, or set it to 0 to leave one out. They only apply once you have added your own payment recipient above.' }));
      m.support.forEach(function (row, i) {
        var p = platform.filter(function (x) { return String(x.address).toLowerCase() === String(row.address).toLowerCase(); })[0] || { name: row.address, address: row.address };
        var id = 'pfg-support-' + i;
        var inp = h('input', { id: id, type: 'number', min: '0', max: '99', step: '1', style: 'width:5em', 'aria-describedby': id + '-err' });
        inp.value = row.split;
        var err = h('div', { class: 'pfg-error', id: id + '-err' });
        inp.addEventListener('input', function () { row.split = inp.value === '' ? '' : parseInt(inp.value, 10); updateTotal(); changed(); });
        var wrap = h('div', { class: 'pfg-support-row' }, [h('div', { class: 'pfg-item-head' }, [
          h('label', { for: id }, [h('strong', { text: p.name }), ' ', h('span', { class: 'pfg-hint pfg-mono', text: p.address })]),
          h('span', {}, [inp, ' %']),
        ]), err]);
        fields['support.' + i + '.split'] = { wrap: wrap, err: err, input: inp };
        supportEl.appendChild(wrap);
      });
    }
    var payments = section('Payments', false, [
      h('p', { class: 'pfg-hint', text: 'Optional. Who receives value (streaming sats and boosts) sent to this feed. If you add anyone, the splits must add up to the total shown.' }),
      h('div', { class: 'pfg-grid' }, [field('Payment method', 'value.method', { select: ['lnaddress', 'keysend'] }), field('Suggested amount', 'value.suggested', { hint: 'Plain decimal, for example 0.000033333.' })]),
      recipsEl, totalEl,
      h('div', { class: 'pfg-row' }, [btn('Add recipient', 'pfg-btn-small', function () {
        if (m.value.recipients.length >= 10) return;
        m.value.recipients.push(Core.emptyRecipient(0)); renderRecipients(); changed();
      })]),
      supportEl,
    ], true);
    if (hosted) payments.insertBefore(note('', 'Changing who gets paid needs a fresh approval from your signer when you save.'), payments.children[1]);

    /* releases */
    function copyText(t, done) {
      function fallback() { var ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } document.body.removeChild(ta); done(); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
    }
    function roleChips(r) {
      var all = (cfg.relTokens || []).slice();
      (r.rel || []).forEach(function (t) { if (all.indexOf(t) < 0) all.push(t); });
      var groups = Core.splitRoles(all);
      function chipBox(tokens, label) {
        var box = h('div', { class: 'pfg-chips', role: 'group', 'aria-label': label });
        tokens.forEach(function (t) {
          var c = h('button', { type: 'button', class: 'pfg-chip', 'aria-pressed': r.rel.indexOf(t) >= 0 ? 'true' : 'false', text: t });
          c.addEventListener('click', function () {
            var ix = r.rel.indexOf(t);
            if (ix >= 0) r.rel.splice(ix, 1); else r.rel.push(t);
            c.setAttribute('aria-pressed', ix >= 0 ? 'false' : 'true');
            refreshReleaseHelp(r); changed();
          });
          box.appendChild(c);
        });
        return box;
      }
      var wrap = h('div', {}, [chipBox(groups.main, 'Roles')]);
      if (groups.other.length) { wrap.appendChild(h('div', { class: 'pfg-subhead', text: 'Other roles' })); wrap.appendChild(chipBox(groups.other, 'Other roles')); }
      return wrap;
    }
    function statusNote(r) {
      var st = ui.get(r) || {}, info = st.info;
      if (!info) return null;
      if (st.status === 'confirmed') return note('ok', 'Confirmed: this feed links back to yours' + (info.theirRel.length ? ' with the same roles.' : '.'));
      if (st.status === 'rel-mismatch') return note('warn', 'This feed links back to yours, but with different roles (' + info.theirRel.join(' ') + '). Apps ignore the link until both sides list the same roles.');
      if (st.status === 'missing') return note('warn', 'This feed does not link back to yours yet. Send its owner the text below so the link is confirmed both ways.');
      return null;
    }
    function snippetBox(r) {
      if (!m.guid) return h('p', { class: 'pfg-hint', text: 'Set your feed URL and GUID to get the text for the release owner.' });
      var txt = Core.snippetFor({ guid: m.guid, feedUrl: m.feedUrl }, r.rel);
      var b = btn('Copy text', 'pfg-btn-small', function () { copyText(txt, function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy text'; }, 1500); }); });
      return h('div', {}, [h('div', { class: 'pfg-label', text: 'Text for the release owner to add to their feed' }), h('pre', { class: 'pfg-snippet', text: txt }), b]);
    }
    function refreshReleaseHelp(r) {
      var el = r._helpEl; if (!el) return;
      var st = ui.get(r) || {};
      if (st.info && st.xml) { var i2 = Core.inspectReleaseFeed(st.xml, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer }, m.guid, r.rel); st.info = i2; st.status = i2.status; }
      clear(el);
      var sn = statusNote(r); if (sn) el.appendChild(sn);
      el.appendChild(snippetBox(r));
    }
    function isPopulated(r) { return Core.isUuid(r.feedGuid || '') && Core.isHttpsUrl(r.feedUrl || ''); }
    function renderReleases() {
      clear(releasesEl);
      if (!m.releases.length) releasesEl.appendChild(h('p', { class: 'pfg-hint', text: 'No releases yet. Add the albums, singles or shows you are involved in.' }));
      m.releases.forEach(function (r, i) {
        var base = 'releases.' + i;
        r.rel = r.rel || [];
        var helpEl = h('div'); Object.defineProperty(r, '_helpEl', { value: helpEl, enumerable: false, configurable: true, writable: true });
        var pop = isPopulated(r);
        var pasteMsg = h('div', { 'aria-live': 'polite' });
        var st0 = ui.get(r); if (st0 && st0.msg) pasteMsg.appendChild(note(st0.msg[0], st0.msg[1]));
        var searchIn = h('input', { type: 'search', id: 'pfg-s-' + i, placeholder: 'Search Music Index by album, track or artist, or paste a feed address', autocomplete: 'off', 'aria-label': 'Search Music Index by name, or paste a feed address' });
        var searchOut = h('div', { 'aria-live': 'polite' });
        function say(kind, text) { var st = ui.get(r) || {}; st.msg = text ? [kind, text] : null; ui.set(r, st); clear(pasteMsg); if (text) pasteMsg.appendChild(note(kind, text)); }
        function post(url, body) {
          return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
            .then(function (res) { return res.json().catch(function () { return null; }).then(function (d) { if (!res.ok) throw new Error((d && d.message) || 'Request failed (' + res.status + ').'); return d; }); });
        }
        /** Read a release feed from its https address (fetched by the server), fill the release in and check the link back. */
        function readFeed(text) {
          text = String(text || '').trim();
          if (!/^https:\/\/\S+$/i.test(text)) { say('bad', 'Feed addresses must start with https://.'); return Promise.resolve(); }
          var isUrl = true;
          say('', 'Fetching the feed…');
          return post(cfg.urls.lookupFeed, { url: text }).then(function (d) { return d.xml; }).then(function (xml) {
            var dom = { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer };
            var info = Core.inspectReleaseFeed(xml, dom, m.guid, r.rel, m.title);
            if (info.error) throw new Error(info.error);
            if (info.guid) r.feedGuid = info.guid;
            if (info.title) r.title = info.title;
            if (info.feedUrl) r.feedUrl = info.feedUrl; else if (isUrl) r.feedUrl = text;
            if (info.feedImg) r.feedImg = info.feedImg;
            if (info.medium && (cfg.mediums || []).indexOf(info.medium) >= 0) r.medium = info.medium;
            var prev = ui.get(r) || {};
            // Roles this release feed already gives our feed are selected by default (only when none were chosen yet).
            if (info.theirRel.length && !(r.rel && r.rel.length)) r.rel = info.theirRel.slice();
            var artist = info.artist || (info.artistUrl ? '' : (prev.artist || info.person));
            ui.set(r, { info: info, status: info.status, xml: xml, msg: null, artist: artist });
            renderReleases(); changed();
            if (!artist && info.artistUrl) {
              // the artist's publisher feed: read its title; if that fails use the Music Index artist or the first person tag
              post(cfg.urls.lookupFeed, { url: info.artistUrl }).then(function (d) { return Core.channelTitle(d.xml, dom); }).catch(function () { return ''; }).then(function (t) {
                var st = ui.get(r); if (!st) return;
                st.artist = t || prev.artist || info.person || '';
                if (st.artist) { renderReleases(); }
              });
            }
          }).catch(function (e) { say('bad', e.message); });
        }
        function sameUrl(a, b) { return String(a || '').trim().replace(/\/+$/, '').toLowerCase() === String(b || '').trim().replace(/\/+$/, '').toLowerCase(); }
        function runSearch() {
          var q = searchIn.value.trim(); clear(searchOut);
          var isUrl = /^https?:\/\/\S+$/i.test(q);
          if (isUrl && !/^https:\/\//i.test(q)) { searchOut.appendChild(note('warn', 'Feed addresses must start with https://.')); return; }
          if (q.length < 2) { searchOut.appendChild(note('warn', 'Type at least 2 characters.')); return; }
          searchOut.appendChild(note('', isUrl ? 'Looking up that feed address in Music Index…' : 'Searching…'));
          post(cfg.urls.lookupSearch, { q: q }).then(function (d) {
            clear(searchOut);
            var list = d.results || [];
            if (isUrl) {
              // A feed address: use the Music Index release whose feed address matches exactly, otherwise read the feed itself.
              var exact = list.filter(function (x) { return sameUrl(x.feedUrl, q); })[0];
              if (exact) { pick(exact); return; }
              readFeed(q); return;
            }
            if (!list.length) { searchOut.appendChild(note('warn', 'No releases found. Try other words, or paste the feed address instead.')); return; }
            var ul = h('div', { class: 'pfg-results', role: 'list' });
            list.forEach(function (x) {
              ul.appendChild(h('button', { type: 'button', class: 'pfg-result', role: 'listitem', onclick: function () { pick(x); } }, [
                h('strong', { text: x.title }), h('span', { class: 'pfg-hint', text: x.artist ? ' · ' + x.artist : '' }),
              ]));
            });
            searchOut.appendChild(ul);
          }).catch(function (e) {
            clear(searchOut);
            if (isUrl) { readFeed(q); return; } // Music Index could not be asked: read the feed directly
            searchOut.appendChild(note('bad', e.message));
          });
        }
        function pick(x) {
          var dupe = m.releases.some(function (o) { return o !== r && o.feedGuid && o.feedGuid.toLowerCase() === x.guid.toLowerCase(); });
          if (dupe) { clear(searchOut); searchOut.appendChild(note('warn', 'That release is already in your list.')); return; }
          r.feedGuid = x.guid; r.title = x.title;
          if (x.image) r.feedImg = x.image;
          if (x.feedUrl) r.feedUrl = x.feedUrl;
          if (x.medium && (cfg.mediums || []).indexOf(x.medium) >= 0) r.medium = x.medium;
          ui.set(r, { artist: x.artist || '', msg: x.feedUrl ? null : ['warn', 'Music Index did not give this release\'s feed address. Paste the feed\'s https address in the search box to finish adding it.'] });
          if (x.feedUrl) { renderReleases(); changed(); readFeed(x.feedUrl); } else { renderReleases(); changed(); }
        }
        searchIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); runSearch(); } });
        // Feed details (title, type, GUID, feed URL, cover image) are grouped and hidden until asked for.
        var artistIn = h('input', { id: 'pfg-f-releases-' + i + '-artist', type: 'text', autocomplete: 'off', placeholder: 'Not found in the feed' });
        artistIn.value = (ui.get(r) || {}).artist || ''; artistIn.setAttribute('readonly', '');
        var detailsGrid = h('div', { class: 'pfg-grid', id: 'pfg-details-' + i, hidden: !showDet.has(r) }, [
          h('div', { class: 'pfg-field pfg-wide' }, [h('label', { for: artistIn.id, text: 'Artist' }), artistIn, h('div', { class: 'pfg-hint', text: 'Read from the release feed. Shown in the heading; not saved in your feed.' })]),
          field('Title', base + '.title', { readonly: true }),
          field('Type', base + '.medium', { select: cfg.mediums || ['music'], readonly: true }),
          field('Feed GUID', base + '.feedGuid', { wide: true, readonly: true }),
          field('Feed URL', base + '.feedUrl', { type: 'url', wide: true, readonly: true }),
          field('Cover image URL', base + '.feedImg', { type: 'url', wide: true, readonly: true }),
        ]);
        var detailsToggle = btn('', 'pfg-btn-small', function () { setDetails(!showDet.has(r)); });
        detailsToggle.setAttribute('aria-controls', 'pfg-details-' + i);
        function setDetails(on) { if (on) showDet.add(r); else showDet.delete(r); detailsGrid.hidden = !on; detailsToggle.textContent = on ? 'Hide feed details' : 'Show feed details'; detailsToggle.setAttribute('aria-expanded', on ? 'true' : 'false'); }
        setDetails(showDet.has(r));
        ['title', 'medium', 'feedGuid', 'feedUrl', 'feedImg'].forEach(function (k) { if (fields[base + '.' + k]) fields[base + '.' + k].reveal = function () { setDetails(true); }; });
        var item = h('div', { class: 'pfg-item' }, [
          h('div', { class: 'pfg-item-head' }, [
            h('strong', { text: (r.title || 'Release ' + (i + 1)) + (((ui.get(r) || {}).artist) ? ' by ' + ui.get(r).artist : '') }),
            i > 0 ? btn('Up', 'pfg-btn-small', function () { m.releases.splice(i - 1, 0, m.releases.splice(i, 1)[0]); renderReleases(); changed(); }) : null,
            i < m.releases.length - 1 ? btn('Down', 'pfg-btn-small', function () { m.releases.splice(i + 1, 0, m.releases.splice(i, 1)[0]); renderReleases(); changed(); }) : null,
            btn('Remove', 'pfg-btn-small pfg-btn-danger', function () { ui.delete(r); m.releases.splice(i, 1); renderReleases(); changed(); }),
          ]),
          h('div', { hidden: pop }, [
            h('div', { class: 'pfg-row' }, [searchIn, btn('Search', 'pfg-btn-small', runSearch)]),
            h('div', { class: 'pfg-hint', text: 'Search by name or paste the feed url above.' }),
            searchOut,
            pasteMsg,
          ]),
          h('div', { hidden: !pop }, [detailsToggle, detailsGrid]),
          h('div', { class: 'pfg-field', hidden: !pop }, [h('span', { class: 'pfg-label', text: 'Your role on this release' }), roleChips(r), h('div', { class: 'pfg-hint', text: 'Pick every role that applies. The release feed must list the same roles.' }), h('div', { class: 'pfg-error', id: 'pfg-rel-err-' + i })]),
          h('div', { hidden: !pop }, [helpEl]),
        ]);
        fields[base + '.rel'] = { wrap: item, err: item.querySelector('#pfg-rel-err-' + i) };
        releasesEl.appendChild(item);
        refreshReleaseHelp(r);
      });
    }
    var releases = section('Releases', false, [
      h('p', { class: 'pfg-hint', text: 'Albums, singles and shows you published or worked on. Each one is confirmed when its own feed links back to this feed.' }),
      releasesEl,
      h('div', { class: 'pfg-row' }, [btn('Add release', 'pfg-btn-primary pfg-btn-small', function () {
        m.releases.push({ feedGuid: '', feedUrl: '', medium: 'music', title: '', feedImg: '', rel: [], attrs: {} });
        renderReleases(); changed();
      })]),
    ]);

    /* actions */
    var actions = h('div', { class: 'pfg-row' });
    var saveBtn, dlBtn, cpBtn;
    if (hosted) {
      saveBtn = btn(hosted.id ? 'Save changes' : 'Save and publish', 'pfg-btn-primary', save);
      actions.appendChild(saveBtn);
    } else {
      dlBtn = btn('Download XML', 'pfg-btn-primary', download);
      cpBtn = btn('Copy XML', '', function () { var r = build(); if (r) copyText(r.xml, function () { cpBtn.textContent = 'Copied'; setTimeout(function () { cpBtn.textContent = 'Copy XML'; }, 1500); }); });
      actions.appendChild(dlBtn); actions.appendChild(cpBtn);
    }
    actions.appendChild(btn(hosted ? 'Back to my feeds' : 'Start over', '', function () { if (!hosted || !dirty || window.confirm('Leave without saving?')) ctx.back(); }));

    /* notes from import */
    var kept = [];
    if (ctx.importNotes && ctx.importNotes.length) kept.push(note('', h('div', {}, [h('strong', { text: 'About your imported feed' }), h('ul', {}, ctx.importNotes.map(function (t) { return h('li', { text: t }); }))])));

    /* ---------- validation / refresh ---------- */
    function showErrors(errs) {
      // Unfilled releases hide their fields, so report them as one clear message instead.
      var told = {};
      errs = errs.reduce(function (acc, e) {
        var mt = /^releases\.(\d+)\./.exec(e.path);
        if (mt && m.releases[+mt[1]] && !isPopulated(m.releases[+mt[1]])) {
          if (!told[mt[1]]) { told[mt[1]] = true; acc.push({ path: 'releases.' + mt[1], message: 'Release ' + (+mt[1] + 1) + ' is not filled in yet. Search Music Index or paste its feed address, or remove it.' }); }
          return acc;
        }
        acc.push(e); return acc;
      }, []);
      Object.keys(fields).forEach(function (k) { var f = fields[k]; if (f.err) f.err.textContent = ''; if (f.wrap) f.wrap.classList.remove('pfg-invalid'); });
      if (fields.slug) fields.slug.err.textContent = slugMsg;
      var loose = [];
      errs.forEach(function (e) {
        var f = fields[e.path];
        if (f && f.err && !f.err.textContent) { f.err.textContent = e.message; f.wrap.classList.add('pfg-invalid'); if (f.reveal) f.reveal(); } else loose.push(e);
      });
      clear(summaryErr);
      if (loose.length) summaryErr.appendChild(note('bad', h('ul', {}, loose.map(function (e) { return h('li', { text: e.message }); }))));
    }
    // Title and Description must be filled in before leaving Basics.
    function basicsGate() {
      var bad = clean().errors.filter(function (e) { return e.path === 'title' || e.path === 'description'; });
      if (!bad.length) return true;
      showErrors(bad);
      var f = fields[bad[0].path]; if (f && f.input && f.input.focus) f.input.focus();
      return false;
    }
    // Bring the first problem into view: open the section it is in, focus the field and scroll to it. With no field
    // to point at (a general message), scroll to the message instead.
    function revealError(errs) {
      var first = errs && errs.length ? fields[errs[0].path] : null;
      var sec = first && first.wrap && first.wrap.closest ? first.wrap.closest('details.pfg-section') : null;
      if (sec) openSection(sec);
      if (first && first.input && first.input.focus) { try { first.input.focus({ preventScroll: true }); } catch (e) { first.input.focus(); } }
      var target = first && first.wrap ? first.wrap : (summaryErr.firstChild ? summaryErr : banner);
      setTimeout(function () { try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* not essential */ } }, 0);
    }
    function revealSlug() {
      if (slugInputs) slugInputs.style.display = '';
      var sec = fields.slug.wrap.closest ? fields.slug.wrap.closest('details.pfg-section') : null;
      if (sec) openSection(sec);
      fields.slug.input.focus(); setTimeout(function () { try { fields.slug.wrap.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* not essential */ } }, 0);
    }
    function build() {
      var r = clean();
      if (r.errors.length) {
        showErrors(r.errors);
        revealError(r.errors);
        return null;
      }
      return { model: r.model, xml: Core.buildXml(r.model, Core.activePlatform(platform, r.model.support), Date.now()) };
    }
    function refresh() {
      var r = clean();
      showErrors(hosted && !hosted.id && !SLUG_RE.test(slug) ? r.errors.filter(function (e) { return e.path !== 'guid' && e.path !== 'feedUrl'; }) : r.errors);
      updateTotal();
      clear(lintEl);
      var w = Core.lint(r.model);
      if (w.length) lintEl.appendChild(note('warn', h('ul', {}, w.map(function (t) { return h('li', { text: t }); }))));
      if (!hosted) ctx.saveDraft(m);
    }
    function changed(fromProfile) { if (!fromProfile) dirty = true; clearTimeout(timer); timer = setTimeout(refresh, 250); }

    /* ---------- actions ---------- */
    function fileName() {
      var last = (m.feedUrl || '').split('?')[0].split('/').filter(Boolean).pop() || '';
      return /\.xml$/i.test(last) ? last : 'publisher.xml';
    }
    function download() {
      clear(doneEl); setBanner();
      var r = build(); if (!r) { doneEl.appendChild(note('bad', 'Please fix the highlighted problems first.')); return; }
      var blob = new Blob([r.xml], { type: 'application/rss+xml' });
      var a = h('a', { href: URL.createObjectURL(blob), download: fileName() });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      doneEl.appendChild(note('ok', 'Downloaded ' + fileName() + '. Upload it to ' + (m.feedUrl || 'your web server') + '.'));
      ctx.clearDraft();
    }
    function setBanner(kind, msg) { clear(banner); if (msg) banner.appendChild(note(kind, msg)); }
    function save() {
      if (saving) return;
      var r = clean();
      if (hosted && !hosted.id && !SLUG_RE.test(slug)) { slugMsg = 'Choose a valid feed name first.'; showErrors([]); revealSlug(); return; }
      if (r.errors.length) { showErrors(r.errors); setBanner('bad', 'Please fix the highlighted problems first.'); revealError(r.errors); return; }
      saving = true; saveBtn.disabled = true; dirty = false; setBanner('', 'Saving… your signer may ask you to confirm.'); // edits made while saving set it again
      var p = hosted.id ? ctx.host.updateFeed(hosted.id, r.model) : ctx.host.createFeed(slug, r.model);
      p.then(function (res) {
        hosted.id = res.id; hosted.slug = res.slug; hosted.status = res.status; hosted.url = res.url;
        saveBtn.textContent = 'Save changes';
        if (res.status === 'published') setBanner('ok', ['Published at ', h('a', { href: res.url, target: '_blank', rel: 'noopener', text: res.url })]);
        else setBanner('warn', 'Saved. This feed is waiting for review and is not public yet.');
      }).catch(function (e) {
        dirty = true; // not saved
        if (e.status === 409 && fields.slug) {
          slugMsg = 'That feed name is already taken. Please choose another.'; slugAuto = false;
          fields.slug.err.textContent = slugMsg; setBanner('bad', slugMsg); revealSlug();
        } else if (e.errors && e.errors.length) { showErrors(e.errors); setBanner('bad', e.message); revealError(e.errors); }
        else if (e.status === 401 || /sign in again|not connected/i.test(e.message)) {
          setBanner('warn', h('span', {}, [e.message + ' ', btn('Sign in', 'pfg-btn-small', function () { ctx.needSignIn(function () { setBanner('ok', 'Signed in. Press save again.'); }); })]));
        } else { setBanner('bad', e.message); revealError([]); }
      }).then(function () { saving = false; saveBtn.disabled = false; });
    }

    /* ---------- assemble ---------- */
    syncHostedIdentity();
    clear(container);
    container.appendChild(h('h2', { text: hosted ? (hosted.id ? 'Edit hosted feed' : 'New hosted feed') : 'Feed editor' }));
    if (hosted && hosted.status && hosted.status !== 'published') container.appendChild(note('warn', 'Status: ' + hosted.status + '. This feed is not public.'));
    kept.forEach(function (n) { container.appendChild(n); });
    [banner, summaryErr, basics, identity, payments, releases, lintEl, actions, doneEl].forEach(function (n) { container.appendChild(n); });
    renderRecipients(); renderSupport(); renderReleases(); autoSlug(); refresh();
    dirty = false; // nothing to lose yet

    /* ---------- new hosted feed: start from the signed-in Nostr profile ---------- */
    function fillIfEmpty(path, value) {
      var f = fields[path], cur = getPath(m, path);
      if (!value || !f || (cur !== undefined && cur !== null && String(cur).trim() !== '')) return false;
      setPath(m, path, value); f.input.value = value;
      return true;
    }
    function prefillFromNostr() {
      var s = ctx.host.getSession ? ctx.host.getSession() : null;
      if (!s) return;
      var gotNpub = s.npub ? fillIfEmpty('npub', s.npub) : false;
      if (gotNpub) changed(true);
      if (!ctx.host.fetchProfile) return;
      // Hide the form until the profile has loaded, so nothing is typed into a form that is about to be filled in.
      var hideEls = [basics, identity, payments, releases, lintEl, actions];
      var loadingEl = h('p', { class: 'pfg-loading', role: 'status', 'aria-live': 'polite', text: 'Loading your Nostr profile to fill in the form…' });
      var loaded = false;
      function reveal() {
        if (loaded) return; loaded = true;
        if (loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
        hideEls.forEach(function (n) { n.hidden = false; n.style.removeProperty('display'); });
      }
      // "important" so that a theme rule such as details { display: block !important } cannot bring the sections back.
      hideEls.forEach(function (n) { n.hidden = true; n.style.setProperty('display', 'none', 'important'); });
      container.insertBefore(loadingEl, basics);
      var giveUp = setTimeout(reveal, 20000); // never leave the person stuck on a slow relay
      var mine = banner.firstChild;
      ctx.host.fetchProfile(s.pubkey).then(function (profile) {
        clearTimeout(giveUp);
        if (container.isConnected === false) return; // the user has already left this screen
        var wasDirty = dirty, f = Core.profileToFields(profile), filled = [];
        if (fillIfEmpty('title', f.name)) filled.push('name');
        if (fillIfEmpty('description', f.about)) filled.push('description');
        if (fillIfEmpty('link', f.website)) filled.push('website');
        if (fillIfEmpty('image', f.picture)) filled.push('image');
        if (f.lud16 && m.value.recipients.length === 0) {
          m.value.recipients.push({ name: f.name || 'Publisher', address: f.lud16, split: 100 - pTotal(), type: 'lnaddress' });
          renderRecipients();
          filled.push('Lightning address (see Payments)');
        }
        if (profile && gotNpub) filled.push('npub');
        autoSlug();
        changed(true); dirty = wasDirty; // filled in by us, not edited by the user
        reveal();
        if (banner.firstChild !== mine) return; // something more important is showing (for example a save result)
        if (!profile) setBanner('', 'No Nostr profile was found on the usual relays, so only your npub was filled in. Fill in the rest by hand.');
        else if (filled.length) setBanner('ok', 'Filled in from your Nostr profile: ' + filled.join(', ') + '. Check everything and change what you like.');
        else setBanner('', 'Your Nostr profile had nothing new to fill in.');
      }, function () { clearTimeout(giveUp); reveal(); });
    }
    if (hosted && !hosted.id && ctx.host) prefillFromNostr();
  }

  window.PFGEditor = { render: render };
})();
