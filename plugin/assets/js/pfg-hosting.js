/**
 * Publisher Feed Generator: hosted-mode client.
 *
 * Handles Nostr remote-signer (NIP-46) connection, NIP-98 signing, the cookie
 * session, and calls to the plugin's REST API. Private keys never reach this
 * site: the signer app holds the user's key. This script only holds a throwaway
 * "client key" used to talk to the signer over relays.
 *
 * Exposes window.PFGHosting.
 */
(function () {
  'use strict';

  var N = window.PFGNostr;
  var STORE_KEY = 'pfg_signer';

  var cfg = null;
  var pool = null;
  var signer = null;
  var clientSk = null;
  var pending = null; // in-flight nostrconnect attempt
  var session = null; // { pubkey, npub, csrf, expires, feeds }
  var listeners = {};

  /* ---------------- tiny event emitter ---------------- */
  function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
  function emit(name, data) { (listeners[name] || []).forEach(function (fn) { try { fn(data); } catch (e) { /* ignore */ } }); }

  /* ---------------- storage (sessionStorage, may be unavailable) ---------------- */
  function store(val) {
    try {
      if (val === null) sessionStorage.removeItem(STORE_KEY);
      else sessionStorage.setItem(STORE_KEY, JSON.stringify(val));
    } catch (e) { /* private mode etc. */ }
  }
  function loadStore() {
    try { var s = sessionStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }

  /* ---------------- helpers ---------------- */
  function init(config) {
    cfg = config;
    if (!N) return false;
    pool = new N.SimplePool();
    return true;
  }

  function randomHex(bytes) {
    var a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return N.bytesToHex(a);
  }

  function onauth(url) {
    // Some signers ask the user to approve in a browser page first.
    emit('auth-url', url);
  }

  function b64Json(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }

  function apiError(res, body) {
    var e = new Error((body && body.message) || ('Request failed (' + res.status + ').'));
    e.status = res.status;
    e.code = body && body.code;
    e.errors = body && body.data && body.data.errors ? body.data.errors : [];
    return e;
  }

  /* ---------------- signer connection ---------------- */
  function clearSigner() {
    if (pending) { try { pending.cancel(); } catch (e) { /* ignore */ } pending = null; }
    if (signer) { try { signer.close(); } catch (e) { /* ignore */ } }
    signer = null; clientSk = null;
    store(null);
  }

  function remember(bp) {
    store({ sk: N.bytesToHex(clientSk), bp: { pubkey: bp.pubkey, relays: bp.relays, secret: bp.secret || null } });
  }

  /** Connect using a pasted bunker:// link (or name@domain). Resolves with the user's pubkey (hex). */
  async function connectBunker(input) {
    clearSigner();
    input = String(input || '').trim();
    if (!input) throw new Error('Paste your bunker:// connection link first.');
    if (/^nostrconnect:/i.test(input)) throw new Error('That is a nostrconnect:// link. Paste a bunker:// link, or scan the QR code with your signer instead.');
    var bp = await N.parseBunkerInput(input);
    if (!bp || !bp.pubkey || !bp.relays || !bp.relays.length) throw new Error('That does not look like a valid bunker:// link.');
    clientSk = N.generateSecretKey();
    signer = N.BunkerSigner.fromBunker(clientSk, bp, { pool: pool, onauth: onauth });
    try {
      await signer.connect();
      var pk = await signer.getPublicKey();
      remember(bp);
      return pk;
    } catch (e) {
      clearSigner();
      throw new Error('Could not reach your signer: ' + (e && e.message ? e.message : e));
    }
  }

  /**
   * Start a nostrconnect:// attempt. Returns { uri, qr, done, cancel }.
   * `done` resolves with the user's pubkey once the signer approves.
   */
  function startNostrConnect() {
    clearSigner();
    clientSk = N.generateSecretKey();
    var sk = clientSk;
    var secret = randomHex(16);
    var relays = (cfg.relays || []).slice(0, 3);
    var uri = N.createNostrConnectURI({
      clientPubkey: N.getPublicKey(sk),
      relays: relays,
      secret: secret,
      name: cfg.siteName || 'Publisher feeds',
      url: location.origin,
      perms: ['sign_event:27235', 'get_public_key'],
    });
    var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var cancelled = false;
    var done = N.BunkerSigner.fromURI(sk, uri, { pool: pool, onauth: onauth }, ac ? ac.signal : 300000)
      .then(function (s) {
        if (cancelled) { try { s.close(); } catch (e) { /* ignore */ } throw new Error('Cancelled.'); }
        signer = s;
        return s.getPublicKey().then(function (pk) {
          remember(s.bp || { pubkey: pk, relays: relays, secret: secret });
          pending = null;
          return pk;
        });
      })
      .catch(function (e) {
        pending = null;
        if (cancelled) throw new Error('Cancelled.');
        throw new Error('The signer did not connect: ' + (e && e.message ? e.message : e));
      });
    var attempt = {
      uri: uri,
      qr: N.qrSvg(uri),
      done: done,
      cancel: function () { cancelled = true; if (ac) { try { ac.abort(); } catch (e) { /* ignore */ } } },
    };
    pending = attempt;
    return attempt;
  }

  /** Rebuild the signer after a page reload (same tab only). */
  function restoreSigner() {
    if (signer) return true;
    var s = loadStore();
    if (!s || !s.sk || !s.bp) return false;
    try {
      clientSk = N.hexToBytes(s.sk);
      signer = N.BunkerSigner.fromBunker(clientSk, s.bp, { pool: pool, onauth: onauth });
      return true;
    } catch (e) {
      clearSigner();
      return false;
    }
  }

  function hasSigner() { return !!signer || restoreSigner(); }

  /* ---------------- REST ---------------- */
  async function rawFetch(method, url, body, headers) {
    var opts = { method: method, credentials: 'same-origin', headers: Object.assign({ Accept: 'application/json' }, headers || {}) };
    if (body !== undefined && body !== null) {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
    var res = await fetch(url, opts);
    var data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { res: res, data: data };
  }

  async function getNonce() {
    var r = await rawFetch('POST', cfg.urls.nonce);
    if (!r.res.ok || !r.data || !r.data.nonce) throw apiError(r.res, r.data);
    return r.data.nonce;
  }

  /** Build and sign a NIP-98 HTTP auth event bound to url, method, optional body, and a fresh nonce. */
  async function signHttpAuth(url, method, bodyString) {
    if (!hasSigner()) throw new Error('Your signer is not connected. Please sign in again.');
    var nonce = await getNonce();
    var tags = [['u', url], ['method', method], ['nonce', nonce]];
    if (bodyString) tags.push(['payload', N.sha256Hex(bodyString)]);
    var template = { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: tags, content: '' };
    try {
      return await signer.signEvent(template);
    } catch (e) {
      throw new Error('Your signer did not approve the request: ' + (e && e.message ? e.message : e));
    }
  }

  /** Sign in: the signer proves control of a key, the server starts a cookie session. */
  async function login() {
    var event = await signHttpAuth(cfg.urls.login, 'POST', null);
    var r = await rawFetch('POST', cfg.urls.login, { event: event });
    if (!r.res.ok) throw apiError(r.res, r.data);
    session = r.data;
    emit('session', session);
    return session;
  }

  /** Reuse an existing cookie session after a reload. Returns the session or null. */
  async function resume() {
    var r;
    try { r = await rawFetch('GET', cfg.urls.me); } catch (e) { return null; }
    if (!r.res.ok) { session = null; return null; }
    session = r.data;
    emit('session', session);
    return session;
  }

  /**
   * Authenticated call. Sends the CSRF header; if the server answers 428 the
   * signer is asked for a fresh signature and the call is retried once.
   */
  async function api(method, url, body) {
    if (!session) throw new Error('Not signed in.');
    var bodyString = body !== undefined && body !== null ? JSON.stringify(body) : null;
    var headers = { 'X-PFG-CSRF': session.csrf };
    var r = await rawFetch(method, url, bodyString, headers);
    if (r.res.status === 428) {
      emit('confirm-needed', true);
      try {
        var ev = await signHttpAuth(url, method, bodyString);
        headers['X-PFG-Auth'] = b64Json(ev);
        r = await rawFetch(method, url, bodyString, headers);
      } finally {
        emit('confirm-needed', false);
      }
    }
    if (r.res.status === 401 || (r.res.status === 403 && r.data && r.data.code === 'pfg_csrf')) {
      session = null;
      emit('session', null);
    }
    if (!r.res.ok) throw apiError(r.res, r.data);
    return r.data;
  }

  async function logout() {
    try { if (session) await rawFetch('POST', cfg.urls.logout, null, { 'X-PFG-CSRF': session.csrf }); } catch (e) { /* ignore */ }
    session = null;
    clearSigner();
    emit('session', null);
  }

  /* ---------------- Nostr profile (read only, no signing) ---------------- */
  // Relays that usually hold profiles. The site's signer relays (Settings) are tried too.
  var PROFILE_RELAYS = ['wss://purplepag.es', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

  function profileRelays() {
    var all = (cfg && cfg.relays ? cfg.relays : []).concat(PROFILE_RELAYS), seen = {}, out = [];
    all.forEach(function (u) { if (typeof u === 'string' && /^wss:\/\//i.test(u) && !seen[u]) { seen[u] = true; out.push(u); } });
    return out.slice(0, 8);
  }

  /**
   * Fetch the newest profile (kind 0) for a public key (hex) straight from relays.
   * Resolves with the parsed profile object, or null if none was found in time. Never rejects.
   */
  async function fetchProfile(pubkeyHex) {
    if (!pool || !/^[0-9a-f]{64}$/i.test(String(pubkeyHex || ''))) return null;
    var timer;
    try {
      var lookup = pool.get(profileRelays(), { kinds: [0], authors: [pubkeyHex.toLowerCase()] }, { maxWait: 5000 });
      var timeout = new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, 8000); });
      var ev = await Promise.race([lookup, timeout]);
      if (!ev || ev.kind !== 0 || String(ev.pubkey).toLowerCase() !== pubkeyHex.toLowerCase()) return null;
      var content = JSON.parse(ev.content);
      return content && typeof content === 'object' && !Array.isArray(content) ? content : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function npubOf(pubkeyHex) { return N.nip19.npubEncode(pubkeyHex); }

  /* ---------------- feed helpers ---------------- */
  function feedUrl(id) { return cfg.urls.feedTemplate.replace(/\/0$/, '/' + encodeURIComponent(id)); }

  window.PFGHosting = {
    init: init,
    on: on,
    connectBunker: connectBunker,
    startNostrConnect: startNostrConnect,
    hasSigner: hasSigner,
    fetchProfile: fetchProfile,
    npubOf: npubOf,
    forgetSigner: clearSigner,
    login: login,
    resume: resume,
    logout: logout,
    getSession: function () { return session; },
    listFeeds: function () { return api('GET', cfg.urls.feeds); },
    getFeed: function (id) { return api('GET', feedUrl(id)); },
    createFeed: function (slug, feed) { return api('POST', cfg.urls.feeds, { slug: slug, feed: feed }); },
    updateFeed: function (id, feed) { return api('PUT', feedUrl(id), { feed: feed }); },
    deleteFeed: function (id) { return api('DELETE', feedUrl(id)); },
  };
})();
