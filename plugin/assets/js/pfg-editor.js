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
    m.value = m.value || { method: 'lnaddress', suggested: '', recipients: [] };
    m.funding = m.funding || { url: '', text: '' };
    var platform = (hosted || cfg.applyPlatformToExports) ? (cfg.platform || []) : [];
    var pTotal = Core.platformTotal(platform);
    var slug = hosted && hosted.slug ? hosted.slug : '';
    var fields = {};      // path -> {wrap, err}
    var ui = new Map();   // release object -> {status, info, open}
    var timer = null, saving = false, slugMsg = '';

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
        input = h('select', { id: id }, o.select.map(function (opt) { return h('option', { value: opt, text: opt }); }));
        input.value = val || o.select[0];
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
    function section(title, open, kids) {
      var d = h('details', { class: 'pfg-section' }, [h('summary', { text: title })].concat(kids));
      if (open) d.setAttribute('open', '');
      return d;
    }

    /* ---------- sections ---------- */
    var banner = h('div', { 'aria-live': 'polite' });
    var summaryErr = h('div');
    var previewEl = h('pre', { class: 'pfg-pre', tabindex: '0', 'aria-label': 'XML preview' });
    var lintEl = h('div');
    var totalEl = h('div', { class: 'pfg-total' });
    var recipsEl = h('div');
    var releasesEl = h('div');

    var basics = section('Basics', true, [h('div', { class: 'pfg-grid' }, [
      field('Name / title', 'title', { hint: 'Your label, studio or business name.' }),
      field('Author', 'author', { hint: 'Shown as the publisher in podcast apps.' }),
      field('Description', 'description', { textarea: true, wide: true }),
      field('Website', 'link', { type: 'url', placeholder: 'https://' }),
      field('Image URL (square, https)', 'image', { type: 'url', placeholder: 'https://' }),
      field('Language', 'language', { hint: 'For example en, en-au.' }),
      field('Category', 'category', { hint: 'iTunes category, for example Music.' }),
      field('Keywords', 'keywords', { hint: 'Comma separated.' }),
      field('Owner name', 'ownerName'),
      field('Owner email', 'ownerEmail', { type: 'email' }),
      check('Contains explicit content', 'explicit'),
    ])]);

    var slugField = null, identityKids = [];
    if (hosted && !hosted.id) {
      slugField = h('div', { class: 'pfg-field' }, []);
      var si = h('input', { type: 'text', id: 'pfg-f-slug', autocomplete: 'off', spellcheck: 'false', placeholder: 'my-label' });
      si.value = slug;
      var serr = h('div', { class: 'pfg-error', id: 'pfg-f-slug-err' });
      var urlOut = h('div', { class: 'pfg-hint pfg-mono' });
      si.addEventListener('input', function () {
        slug = si.value.trim().toLowerCase();
        syncHostedIdentity();
        urlOut.textContent = m.feedUrl ? 'Your feed will be at ' + m.feedUrl : '';
        slugMsg = slug && !SLUG_RE.test(slug) ? 'Use 3 to 40 lowercase letters, numbers, "-" or "_", starting with a letter or number.' : '';
        serr.textContent = slugMsg;
        changed();
      });
      slugField.appendChild(h('label', { for: 'pfg-f-slug', text: 'Feed name (web address)' }));
      slugField.appendChild(si); slugField.appendChild(serr); slugField.appendChild(urlOut);
      slugField.appendChild(h('div', { class: 'pfg-hint', text: 'This cannot be changed later, and the address can never be reused if you delete the feed.' }));
      fields.slug = { wrap: slugField, err: serr, input: si };
      identityKids.push(slugField);
    } else if (hosted) {
      identityKids.push(h('div', { class: 'pfg-field pfg-wide' }, [h('span', { class: 'pfg-label', text: 'Feed URL' }), h('div', { class: 'pfg-mono', text: hosted.url })]));
      identityKids.push(h('div', { class: 'pfg-field pfg-wide' }, [h('span', { class: 'pfg-label', text: 'Feed GUID' }), h('div', { class: 'pfg-mono', text: m.guid })]));
    } else {
      identityKids.push(field('Feed URL (where you will host it)', 'feedUrl', {
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
    }
    identityKids.push(field('Your npub (optional)', 'npub', { wide: true, hint: 'Public Nostr key only (starts with npub). Never paste a secret key (nsec).' }));
    identityKids.push(field('Support link (optional)', 'funding.url', { type: 'url', placeholder: 'https://' }));
    identityKids.push(field('Support link text', 'funding.text', { hint: 'For example "Support us".' }));
    var identity = section('Identity and links', true, [h('div', { class: 'pfg-grid' }, identityKids)]);

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
      if (m.value.recipients.length) platform.forEach(function (p) {
        recipsEl.appendChild(h('div', { class: 'pfg-item pfg-locked' }, [h('div', { class: 'pfg-item-head' }, [
          h('strong', { text: p.name }), h('span', { class: 'pfg-badge', text: p.split + '% (platform, fixed)' }),
        ])]));
      });
      updateTotal();
    }
    function updateTotal() {
      var t = 0; m.value.recipients.forEach(function (r) { t += parseInt(r.split, 10) || 0; });
      var need = 100 - pTotal;
      if (!m.value.recipients.length) { totalEl.textContent = 'No payment recipients: your feed will have no payment block. This section is optional.'; totalEl.className = 'pfg-total'; return; }
      totalEl.textContent = 'Your recipients total ' + t + '% of ' + need + '%' + (pTotal ? ' (the platform takes ' + pTotal + '%)' : '') + '.';
      totalEl.className = 'pfg-total ' + (t === need ? 'pfg-good' : 'pfg-bad');
    }
    var payments = section('Payments', false, [
      h('p', { class: 'pfg-hint', text: 'Optional. Who receives value (streaming sats and boosts) sent to this feed. If you add anyone, the splits must add up to the total shown.' }),
      h('div', { class: 'pfg-grid' }, [field('Payment method', 'value.method', { select: ['lnaddress', 'keysend'] }), field('Suggested amount', 'value.suggested', { hint: 'Plain decimal, for example 0.000033333.' })]),
      recipsEl, totalEl,
      h('div', { class: 'pfg-row' }, [btn('Add recipient', 'pfg-btn-small', function () {
        if (m.value.recipients.length >= 10) return;
        m.value.recipients.push(Core.emptyRecipient(0)); renderRecipients(); changed();
      })]),
    ]);
    if (hosted) payments.insertBefore(note('', 'Changing who gets paid needs a fresh approval from your signer when you save.'), payments.children[1]);

    /* releases */
    function copyText(t, done) {
      function fallback() { var ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } document.body.removeChild(ta); done(); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
    }
    function roleChips(r) {
      var all = (cfg.relTokens || []).slice();
      (r.rel || []).forEach(function (t) { if (all.indexOf(t) < 0) all.push(t); });
      var box = h('div', { class: 'pfg-chips', role: 'group', 'aria-label': 'Roles' });
      all.forEach(function (t) {
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
        var pasteTa = h('textarea', { rows: 3, class: 'pfg-xml', placeholder: 'Paste the release feed address (https://…) or its XML', 'aria-label': 'Release feed address or XML' });
        var pasteMsg = h('div', { 'aria-live': 'polite' });
        var st0 = ui.get(r); if (st0 && st0.msg) pasteMsg.appendChild(note(st0.msg[0], st0.msg[1]));
        var searchIn = h('input', { type: 'search', id: 'pfg-s-' + i, placeholder: 'Search Music Index by album, track or artist', autocomplete: 'off', 'aria-label': 'Search Music Index' });
        var searchOut = h('div', { 'aria-live': 'polite' });
        function say(kind, text) { var st = ui.get(r) || {}; st.msg = text ? [kind, text] : null; ui.set(r, st); clear(pasteMsg); if (text) pasteMsg.appendChild(note(kind, text)); }
        function post(url, body) {
          return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
            .then(function (res) { return res.json().catch(function () { return null; }).then(function (d) { if (!res.ok) throw new Error((d && d.message) || 'Request failed (' + res.status + ').'); return d; }); });
        }
        /** Read a feed (URL fetched by the server, or pasted XML), fill the release in and check the link back. */
        function readFeed(text) {
          text = String(text || '').trim();
          if (!text) { say('bad', 'Paste a feed address or its XML first.'); return Promise.resolve(); }
          var isUrl = /^https?:\/\/\S+$/i.test(text);
          var getXml = isUrl
            ? (/^https:\/\//i.test(text) ? post(cfg.urls.lookupFeed, { url: text }).then(function (d) { return d.xml; }) : Promise.reject(new Error('Feed addresses must start with https://.')))
            : Promise.resolve(text);
          say('', isUrl ? 'Fetching the feed…' : 'Reading…');
          return getXml.then(function (xml) {
            var info = Core.inspectReleaseFeed(xml, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer }, m.guid, r.rel);
            if (info.error) throw new Error(info.error);
            if (info.guid) r.feedGuid = info.guid;
            if (info.title) r.title = info.title;
            if (info.feedUrl) r.feedUrl = info.feedUrl; else if (isUrl) r.feedUrl = text;
            if (info.feedImg) r.feedImg = info.feedImg;
            if (info.medium && (cfg.mediums || []).indexOf(info.medium) >= 0) r.medium = info.medium;
            ui.set(r, { info: info, status: info.status, xml: xml, msg: (!info.feedUrl && !isUrl) ? ['warn', 'That feed does not state its own address (atom:link rel="self"), so it cannot be added from pasted XML. Paste the feed\'s https address instead.'] : null });
            renderReleases(); changed();
          }).catch(function (e) { say('bad', e.message); });
        }
        function runSearch() {
          var q = searchIn.value.trim(); clear(searchOut);
          if (q.length < 2) { searchOut.appendChild(note('warn', 'Type at least 2 characters.')); return; }
          searchOut.appendChild(note('', 'Searching…'));
          post(cfg.urls.lookupSearch, { q: q }).then(function (d) {
            clear(searchOut);
            var list = d.results || [];
            if (!list.length) { searchOut.appendChild(note('warn', 'No releases found. Try other words, or paste the feed below.')); return; }
            var ul = h('div', { class: 'pfg-results', role: 'list' });
            list.forEach(function (x) {
              ul.appendChild(h('button', { type: 'button', class: 'pfg-result', role: 'listitem', onclick: function () { pick(x); } }, [
                h('strong', { text: x.title }), h('span', { class: 'pfg-hint', text: x.artist ? ' · ' + x.artist : '' }),
              ]));
            });
            searchOut.appendChild(ul);
          }).catch(function (e) { clear(searchOut); searchOut.appendChild(note('bad', e.message)); });
        }
        function pick(x) {
          var dupe = m.releases.some(function (o) { return o !== r && o.feedGuid && o.feedGuid.toLowerCase() === x.guid.toLowerCase(); });
          if (dupe) { clear(searchOut); searchOut.appendChild(note('warn', 'That release is already in your list.')); return; }
          r.feedGuid = x.guid; r.title = x.title;
          if (x.image) r.feedImg = x.image;
          if (x.feedUrl) r.feedUrl = x.feedUrl;
          if (x.medium && (cfg.mediums || []).indexOf(x.medium) >= 0) r.medium = x.medium;
          ui.set(r, { msg: x.feedUrl ? null : ['warn', 'Music Index did not give this release\'s feed address. Paste the feed\'s https address below to finish adding it.'] });
          if (x.feedUrl) { renderReleases(); changed(); readFeed(x.feedUrl); } else { renderReleases(); changed(); }
        }
        searchIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); runSearch(); } });
        var item = h('div', { class: 'pfg-item' }, [
          h('div', { class: 'pfg-item-head' }, [
            h('strong', { text: r.title || 'Release ' + (i + 1) }),
            i > 0 ? btn('Up', 'pfg-btn-small', function () { m.releases.splice(i - 1, 0, m.releases.splice(i, 1)[0]); renderReleases(); changed(); }) : null,
            i < m.releases.length - 1 ? btn('Down', 'pfg-btn-small', function () { m.releases.splice(i + 1, 0, m.releases.splice(i, 1)[0]); renderReleases(); changed(); }) : null,
            btn('Remove', 'pfg-btn-small pfg-btn-danger', function () { ui.delete(r); m.releases.splice(i, 1); renderReleases(); changed(); }),
          ]),
          h('div', { hidden: pop }, [
            h('div', { class: 'pfg-row' }, [searchIn, btn('Search', 'pfg-btn-small', runSearch)]),
            searchOut,
            pasteTa,
            h('div', { class: 'pfg-row', style: 'margin:6px 0 10px' }, [btn('Read feed', 'pfg-btn-small', function () { readFeed(pasteTa.value); })]),
            pasteMsg,
          ]),
          h('div', { class: 'pfg-grid', hidden: !pop }, [
            field('Title', base + '.title', { readonly: true }),
            field('Type', base + '.medium', { select: cfg.mediums || ['music'], readonly: true }),
            field('Feed GUID', base + '.feedGuid', { wide: true, readonly: true }),
            field('Feed URL', base + '.feedUrl', { type: 'url', wide: true, readonly: true }),
            field('Cover image URL', base + '.feedImg', { type: 'url', wide: true, readonly: true }),
          ]),
          h('div', { class: 'pfg-field', hidden: !pop }, [h('span', { class: 'pfg-label', text: 'Your role on this release' }), roleChips(r), h('div', { class: 'pfg-hint', text: 'Pick every role that applies. The release feed must list the same roles.' }), h('div', { class: 'pfg-error', id: 'pfg-rel-err-' + i })]),
          h('div', { hidden: !pop }, [helpEl]),
        ]);
        fields[base + '.rel'] = { wrap: item, err: item.querySelector('#pfg-rel-err-' + i) };
        releasesEl.appendChild(item);
        refreshReleaseHelp(r);
      });
    }
    var releases = section('Releases', true, [
      h('p', { class: 'pfg-hint', text: 'Albums, singles and shows you published or worked on. Each one is confirmed when its own feed links back to this feed.' }),
      releasesEl,
      h('div', { class: 'pfg-row' }, [btn('Add release', 'pfg-btn-primary pfg-btn-small', function () {
        m.releases.push({ feedGuid: '', feedUrl: '', medium: 'music', title: '', feedImg: '', rel: [], attrs: {} });
        renderReleases(); changed();
      })]),
    ]);

    /* preview + actions */
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
    actions.appendChild(btn(hosted ? 'Back to my feeds' : 'Start over', '', function () { if (!hosted || window.confirm('Leave without saving?')) ctx.back(); }));
    var preview = section('Preview', false, [h('p', { class: 'pfg-hint', text: 'This is the exact file that will be produced.' }), previewEl]);

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
          if (!told[mt[1]]) { told[mt[1]] = true; acc.push({ path: 'releases.' + mt[1], message: 'Release ' + (+mt[1] + 1) + ' is not filled in yet. Search Music Index or read its feed, or remove it.' }); }
          return acc;
        }
        acc.push(e); return acc;
      }, []);
      Object.keys(fields).forEach(function (k) { var f = fields[k]; if (f.err) f.err.textContent = ''; if (f.wrap) f.wrap.classList.remove('pfg-invalid'); });
      if (fields.slug) fields.slug.err.textContent = slugMsg;
      var loose = [];
      errs.forEach(function (e) {
        var f = fields[e.path];
        if (f && f.err && !f.err.textContent) { f.err.textContent = e.message; f.wrap.classList.add('pfg-invalid'); } else loose.push(e);
      });
      clear(summaryErr);
      if (loose.length) summaryErr.appendChild(note('bad', h('ul', {}, loose.map(function (e) { return h('li', { text: e.message }); }))));
    }
    function build() {
      var r = clean();
      if (r.errors.length) {
        showErrors(r.errors);
        var first = fields[r.errors[0].path];
        if (first && first.input && first.input.focus) first.input.focus();
        return null;
      }
      return { model: r.model, xml: Core.buildXml(r.model, platform, Date.now()) };
    }
    function refresh() {
      var r = clean();
      showErrors(hosted && !hosted.id && !SLUG_RE.test(slug) ? r.errors.filter(function (e) { return e.path !== 'guid' && e.path !== 'feedUrl'; }) : r.errors);
      updateTotal();
      clear(lintEl);
      var w = Core.lint(r.model);
      if (w.length) lintEl.appendChild(note('warn', h('ul', {}, w.map(function (t) { return h('li', { text: t }); }))));
      if (!r.errors.length) previewEl.textContent = Core.buildXml(r.model, platform, Date.now());
      else previewEl.textContent = 'Fix the highlighted problems to see the preview.';
      if (!hosted) ctx.saveDraft(m);
    }
    function changed() { clearTimeout(timer); timer = setTimeout(refresh, 250); }

    /* ---------- actions ---------- */
    function fileName() {
      var last = (m.feedUrl || '').split('?')[0].split('/').filter(Boolean).pop() || '';
      return /\.xml$/i.test(last) ? last : 'publisher.xml';
    }
    function download() {
      var r = build(); if (!r) { setBanner('bad', 'Please fix the highlighted problems first.'); return; }
      var blob = new Blob([r.xml], { type: 'application/rss+xml' });
      var a = h('a', { href: URL.createObjectURL(blob), download: fileName() });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      setBanner('ok', 'Downloaded ' + fileName() + '. Upload it to ' + (m.feedUrl || 'your web server') + '.');
      ctx.clearDraft();
    }
    function setBanner(kind, msg) { clear(banner); if (msg) banner.appendChild(note(kind, msg)); }
    function save() {
      if (saving) return;
      var r = clean();
      if (hosted && !hosted.id && !SLUG_RE.test(slug)) { slugMsg = 'Choose a valid feed name first.'; showErrors([]); fields.slug.input.focus(); return; }
      if (r.errors.length) { showErrors(r.errors); setBanner('bad', 'Please fix the highlighted problems first.'); return; }
      saving = true; saveBtn.disabled = true; setBanner('', 'Saving… your signer may ask you to confirm.');
      var p = hosted.id ? ctx.host.updateFeed(hosted.id, r.model) : ctx.host.createFeed(slug, r.model);
      p.then(function (res) {
        hosted.id = res.id; hosted.slug = res.slug; hosted.status = res.status; hosted.url = res.url;
        saveBtn.textContent = 'Save changes';
        if (res.status === 'published') setBanner('ok', ['Published at ', h('a', { href: res.url, target: '_blank', rel: 'noopener', text: res.url })]);
        else setBanner('warn', 'Saved. This feed is waiting for review and is not public yet.');
      }).catch(function (e) {
        if (e.errors && e.errors.length) { showErrors(e.errors); setBanner('bad', e.message); }
        else if (e.status === 401 || /sign in again|not connected/i.test(e.message)) {
          setBanner('warn', h('span', {}, [e.message + ' ', btn('Sign in', 'pfg-btn-small', function () { ctx.needSignIn(function () { setBanner('ok', 'Signed in. Press save again.'); }); })]));
        } else setBanner('bad', e.message);
      }).then(function () { saving = false; saveBtn.disabled = false; });
    }

    /* ---------- assemble ---------- */
    syncHostedIdentity();
    clear(container);
    container.appendChild(h('h2', { text: hosted ? (hosted.id ? 'Edit hosted feed' : 'New hosted feed') : 'Feed editor' }));
    if (hosted && hosted.status && hosted.status !== 'published') container.appendChild(note('warn', 'Status: ' + hosted.status + '. This feed is not public.'));
    kept.forEach(function (n) { container.appendChild(n); });
    [banner, summaryErr, basics, identity, payments, releases, lintEl, preview, actions].forEach(function (n) { container.appendChild(n); });
    renderRecipients(); renderReleases(); refresh();
  }

  window.PFGEditor = { render: render };
})();
