/*!
 * Publisher Feed Generator - core logic (no UI, no network).
 * Mirrors includes/class-pfg-feed.php and class-pfg-xml.php. Keep them in step:
 * the same input must give byte-identical XML and the same error list in both.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PFGCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NS_PODCAST = 'https://podcastindex.org/namespace/1.0';
  var NS_PODCAST_LEGACY = 'https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md';
  var NS_ITUNES = 'http://www.itunes.com/dtds/podcast-1.0.dtd';
  var NS_ATOM = 'http://www.w3.org/2005/Atom';
  var STD_NS = { podcast: NS_PODCAST, itunes: NS_ITUNES, atom: NS_ATOM };
  var GUID_NAMESPACE = 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6';
  var MEDIUMS = ['music', 'podcast', 'video', 'film', 'audiobook', 'newsletter', 'blog', 'publisher', 'course'];
  var BUILTIN_RELS = ['artist', 'host', 'author', 'label', 'producer', 'network', 'hosting', 'sponsor', 'songwriter', 'composer', 'musician', 'studio', 'engineer'];
  // The role picker shows the roles that fit a release first and these under "Other roles".
  var OTHER_RELS = ['author', 'host', 'hosting', 'network', 'sponsor'];
  var RESERVED_ATTRS = ['feedGuid', 'feedUrl', 'medium', 'title', 'feedImg', 'rel'];

  /* ---------------------------------------------------------------- */
  /* SHA-1 (only for UUIDv5)                                           */
  /* ---------------------------------------------------------------- */

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function sha1(bytes) {
    var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    var len = bytes.length, padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    var bits = len * 8, dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(padded.length - 4, bits >>> 0);
    var w = new Uint32Array(80);
    function rol(n, s) { return ((n << s) | (n >>> (32 - s))) >>> 0; }
    for (var off = 0; off < padded.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        var t = (rol(a, 5) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = rol(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    var out = new Uint8Array(20), o = new DataView(out.buffer);
    o.setUint32(0, h0); o.setUint32(4, h1); o.setUint32(8, h2); o.setUint32(12, h3); o.setUint32(16, h4);
    return out;
  }

  function hex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  function uuid5(name) {
    var ns = [], h = GUID_NAMESPACE.replace(/-/g, '');
    for (var i = 0; i < 16; i++) ns.push(parseInt(h.substr(i * 2, 2), 16));
    var nb = utf8Bytes(name), buf = new Uint8Array(16 + nb.length);
    buf.set(ns); buf.set(nb, 16);
    var d = sha1(buf).slice(0, 16);
    d[6] = (d[6] & 0x0f) | 0x50;
    d[8] = (d[8] & 0x3f) | 0x80;
    var x = hex(d);
    return x.substr(0, 8) + '-' + x.substr(8, 4) + '-' + x.substr(12, 4) + '-' + x.substr(16, 4) + '-' + x.substr(20, 12);
  }

  /** Podcasting 2.0 recommended GUID: UUIDv5 of the feed URL without scheme and trailing slashes. */
  function guidForUrl(url) {
    var u = String(url).trim().replace(/^[A-Za-z][A-Za-z0-9+.\-]*:\/\//, '').replace(/\/+$/, '');
    return uuid5(u);
  }

  /** A random (version 4) UUID, for a feed that has no address yet. Editor use only. */
  function randomGuid() {
    var b = new Uint8Array(16), c = (typeof globalThis !== 'undefined' && globalThis.crypto) || (typeof window !== 'undefined' && window.crypto);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* ---------------------------------------------------------------- */
  /* bech32 / npub                                                     */
  /* ---------------------------------------------------------------- */

  var B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  function polymod(values) {
    var gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3], chk = 1;
    for (var i = 0; i < values.length; i++) {
      var b = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ values[i];
      for (var j = 0; j < 5; j++) if ((b >>> j) & 1) chk ^= gen[j];
    }
    return chk >>> 0;
  }
  function hrpExpand(hrp) {
    var r = [], i;
    for (i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) >> 5);
    r.push(0);
    for (i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) & 31);
    return r;
  }
  function convertBits(data, from, to, pad) {
    var acc = 0, bits = 0, ret = [], maxv = (1 << to) - 1;
    for (var i = 0; i < data.length; i++) {
      acc = (acc << from) | data[i];
      bits += from;
      while (bits >= to) { bits -= to; ret.push((acc >> bits) & maxv); }
      acc &= (1 << bits) - 1;
    }
    if (pad) { if (bits > 0) ret.push((acc << (to - bits)) & maxv); }
    else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
    return ret;
  }
  function npubEncode(hexKey) {
    if (!/^[0-9a-f]{64}$/.test(hexKey)) return false;
    var bytes = [];
    for (var i = 0; i < 32; i++) bytes.push(parseInt(hexKey.substr(i * 2, 2), 16));
    var data = convertBits(bytes, 8, 5, true);
    var chk = polymod(hrpExpand('npub').concat(data, [0, 0, 0, 0, 0, 0])) ^ 1, out = 'npub1', k;
    for (k = 0; k < data.length; k++) out += B32[data[k]];
    for (k = 0; k < 6; k++) out += B32[(chk >>> (5 * (5 - k))) & 31];
    return out;
  }
  function npubDecode(s) {
    if (typeof s !== 'string' || s.length !== 63 || s.indexOf('npub1') !== 0 || s.toLowerCase() !== s) return false;
    var data = [];
    for (var i = 5; i < 63; i++) {
      var p = B32.indexOf(s[i]);
      if (p < 0) return false;
      data.push(p);
    }
    if (polymod(hrpExpand('npub').concat(data)) !== 1) return false;
    var bytes = convertBits(data.slice(0, data.length - 6), 5, 8, false);
    if (!bytes || bytes.length !== 32) return false;
    return hex(bytes);
  }

  /* ---------------------------------------------------------------- */
  /* String helpers                                                    */
  /* ---------------------------------------------------------------- */

  function stripLoneSurrogates(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        var n = s.charCodeAt(i + 1);
        if (n >= 0xdc00 && n <= 0xdfff) { out += s[i] + s[i + 1]; i++; }
      } else if (c < 0xdc00 || c > 0xdfff) {
        out += s[i];
      }
    }
    return out;
  }
  function coerce(v) {
    if (typeof v === 'string') return stripLoneSurrogates(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  }
  function line(v) {
    return coerce(v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/[ \t\r\n]+/g, ' ').replace(/^ +| +$/g, '');
  }
  function text(v) {
    return coerce(v).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/^[ \t\n]+|[ \t\n]+$/g, '');
  }
  function len(s) { return Array.from(s).length; }
  function get(obj, key) { return obj && typeof obj === 'object' && obj[key] !== undefined && obj[key] !== null ? obj[key] : ''; }

  function isHttpsUrl(u) {
    if (u.length > 2048 || !/^https:\/\/[^\s<>"']+$/i.test(u)) return false;
    try {
      var p = new URL(u);
      return !!p.hostname && !p.username && !p.password;
    } catch (e) { return false; }
  }
  /** Website and Image accept http:// as well as https:// (everything else stays https-only). */
  function isHttpUrl(u) {
    if (u.length > 2048 || !/^https?:\/\/[^\s<>"']+$/i.test(u)) return false;
    try {
      var p = new URL(u);
      return !!p.hostname && !p.username && !p.password;
    } catch (e) { return false; }
  }
  function isUuid(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s); }

  /* ---------------------------------------------------------------- */
  /* Normalise + validate                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Turn a Nostr profile (kind 0 content, untrusted) into values for a new feed form.
   * Returns only what is usable: strings are trimmed and cut to the feed limits, URLs must be
   * http(s), and the lightning address must look like name@domain (lud06/LNURL is ignored).
   * Pure function, client only (not part of the PHP/JS output parity).
   */
  function profileToFields(profile) {
    var out = { name: '', about: '', website: '', picture: '', lud16: '' };
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return out;
    function str(k) { return typeof profile[k] === 'string' ? profile[k] : ''; }
    function clip(s, n) { var a = Array.from(s); return a.length > n ? a.slice(0, n).join('') : s; }
    out.name = clip(line(str('display_name') || str('displayName') || str('name')), 200);
    if (out.name === '') out.name = clip(line(str('name')), 200);
    out.about = clip(text(str('about')), 4000);
    var site = line(str('website'));
    if (site !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(site) && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}([\/?#]\S*)?$/i.test(site)) site = 'https://' + site; // bare "example.com"
    if (site !== '' && isHttpUrl(site)) out.website = site;
    var pic = line(str('picture'));
    if (pic !== '' && isHttpUrl(pic)) out.picture = pic;
    var ln = line(str('lud16'));
    if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(ln)) out.lud16 = ln;
    return out;
  }

  /** Feed name (web address) made from a title: lowercase letters, digits and "-", 3 to 40 chars, or '' if nothing usable. */
  function slugify(title) {
    var t = String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    t = t.slice(0, 40).replace(/-+$/g, '');
    return /^[a-z0-9][a-z0-9_-]{2,39}$/.test(t) ? t : '';
  }

  /** iTunes top-level categories (the feed carries one). */
  var CATEGORIES = ['Arts', 'Business', 'Comedy', 'Education', 'Fiction', 'Government', 'Health & Fitness', 'History', 'Kids & Family', 'Leisure', 'Music', 'News', 'Religion & Spirituality', 'Science', 'Society & Culture', 'Sports', 'Technology', 'True Crime', 'TV & Film'];

  /** Language codes for the feed's <language> element, English variants first. */
  var LANGUAGES = [
    ['en', 'English'], ['en-au', 'English (Australia)'], ['en-ca', 'English (Canada)'], ['en-gb', 'English (United Kingdom)'], ['en-ie', 'English (Ireland)'], ['en-nz', 'English (New Zealand)'], ['en-us', 'English (United States)'], ['en-za', 'English (South Africa)'],
    ['af', 'Afrikaans'], ['ar', 'Arabic'], ['eu', 'Basque'], ['bn', 'Bengali'], ['bg', 'Bulgarian'], ['ca', 'Catalan'], ['zh', 'Chinese'], ['zh-cn', 'Chinese (Simplified)'], ['zh-tw', 'Chinese (Traditional, Taiwan)'], ['zh-hk', 'Chinese (Hong Kong)'],
    ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'], ['nl', 'Dutch'], ['et', 'Estonian'], ['fil', 'Filipino'], ['fi', 'Finnish'], ['fr', 'French'], ['fr-ca', 'French (Canada)'], ['fr-ch', 'French (Switzerland)'],
    ['gl', 'Galician'], ['de', 'German'], ['de-at', 'German (Austria)'], ['de-ch', 'German (Switzerland)'], ['el', 'Greek'], ['he', 'Hebrew'], ['hi', 'Hindi'], ['hu', 'Hungarian'], ['is', 'Icelandic'], ['id', 'Indonesian'], ['ga', 'Irish'],
    ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['ms', 'Malay'], ['mi', 'Maori'], ['no', 'Norwegian'], ['fa', 'Persian'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['pt-br', 'Portuguese (Brazil)'], ['pt-pt', 'Portuguese (Portugal)'],
    ['ro', 'Romanian'], ['ru', 'Russian'], ['sr', 'Serbian'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['es', 'Spanish'], ['es-ar', 'Spanish (Argentina)'], ['es-mx', 'Spanish (Mexico)'], ['es-es', 'Spanish (Spain)'], ['es-us', 'Spanish (United States)'],
    ['sw', 'Swahili'], ['sv', 'Swedish'], ['ta', 'Tamil'], ['te', 'Telugu'], ['th', 'Thai'], ['tr', 'Turkish'], ['uk', 'Ukrainian'], ['ur', 'Urdu'], ['vi', 'Vietnamese'], ['cy', 'Welsh'],
  ].map(function (p) { return { value: p[0], label: p[1] + ' (' + p[0] + ')' }; });

  /** Split role tokens for the picker: { main, other }. Both lists are alphabetical. Unknown or custom tokens go with the main roles. */
  function splitRoles(tokens) {
    var main = [], other = [];
    (tokens || []).forEach(function (t) { if (OTHER_RELS.indexOf(t) >= 0) other.push(t); else main.push(t); });
    function alpha(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
    return { main: main.sort(alpha), other: other.sort(alpha) };
  }

  function emptyRecipient(split) {
    return { name: '', address: '', split: split || 0, type: 'lnaddress' };
  }

  /**
   * "Support the developers": the creator's chosen split (0 to 99) for each configured recipient.
   * Names, addresses and types always come from the configured list. Mirrors PFG_Feed::support_rows.
   */
  function supportRows(platform, input, err) {
    input = Array.isArray(input) ? input : [];
    var chosen = {};
    input.forEach(function (row, i) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return;
      var key = line(get(row, 'address')).toLowerCase();
      if (key !== '' && !Object.prototype.hasOwnProperty.call(chosen, key)) chosen[key] = { i: i, sp: get(row, 'split') };
    });
    return (platform || []).map(function (pr) {
      var split = parseInt(pr.split, 10) || 0, key = String(pr.address).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(chosen, key)) {
        var c = chosen[key], sp = c.sp;
        if ((typeof sp === 'number' && Number.isInteger(sp)) || (typeof sp === 'string' && /^\d{1,2}$/.test(sp.trim()))) {
          sp = parseInt(sp, 10);
          if (sp >= 0 && sp <= 99) split = sp;
          else err('support.' + c.i + '.split', 'Support split must be a whole number from 0 to 99.');
        } else {
          err('support.' + c.i + '.split', 'Support split must be a whole number from 0 to 99.');
        }
      }
      return { address: pr.address, split: split };
    });
  }

  /** The recipients that go into the feed: configured name/address/type with the creator's split, leaving out 0. Mirrors PFG_Feed::active_platform. */
  function activePlatform(platform, support) {
    var by = {};
    (Array.isArray(support) ? support : []).forEach(function (row) {
      if (row && typeof row === 'object' && row.address !== undefined && row.split !== undefined) by[String(row.address).toLowerCase()] = parseInt(row.split, 10) || 0;
    });
    var out = [];
    (platform || []).forEach(function (pr) {
      var key = String(pr.address).toLowerCase(), split = Object.prototype.hasOwnProperty.call(by, key) ? by[key] : parseInt(pr.split, 10) || 0;
      if (split > 0) out.push(Object.assign({}, pr, { split: split }));
    });
    return out;
  }

  /** Editor helper: one row per configured recipient, using the stored split when it is a valid 0..99 whole number, else the default. */
  function ensureSupport(support, platform) {
    var by = {};
    (Array.isArray(support) ? support : []).forEach(function (row) { if (row && row.address) by[String(row.address).toLowerCase()] = row.split; });
    return (platform || []).map(function (pr) {
      var sp = by[String(pr.address).toLowerCase()], n = typeof sp === 'string' && /^\d{1,2}$/.test(sp.trim()) ? parseInt(sp, 10) : sp;
      return { address: pr.address, split: Number.isInteger(n) && n >= 0 && n <= 99 ? n : (parseInt(pr.split, 10) || 0) };
    });
  }

  /**
   * An imported feed that already has payment recipients keeps exactly its own split: any recipient that is one of the
   * configured support recipients becomes that support split, and the others are set to 0. A feed without recipients gets the defaults.
   * Returns the model (changed in place).
   */
  function liftSupport(model, platform) {
    var recips = model && model.value && Array.isArray(model.value.recipients) ? model.value.recipients : [];
    if (!recips.length) { model.support = ensureSupport([], platform); return model; }
    var rows = (platform || []).map(function (pr) { return { address: pr.address, split: 0 }; });
    var keep = [];
    recips.forEach(function (r) {
      var ix = -1;
      (platform || []).forEach(function (pr, i) { if (ix < 0 && String(pr.address).toLowerCase() === String(r.address).toLowerCase()) ix = i; });
      var n = parseInt(r.split, 10);
      if (ix >= 0 && rows[ix].split === 0 && Number.isInteger(n) && n >= 1 && n <= 99) rows[ix].split = n; else keep.push(r);
    });
    model.value.recipients = keep; model.support = rows;
    return model;
  }

  function platformTotal(platform) {
    var t = 0;
    (platform || []).forEach(function (p) { t += parseInt(p.split, 10) || 0; });
    return t;
  }

  function emptyModel(cfg) {
    cfg = cfg || {};
    var d = cfg.defaults || {};
    return {
      version: 1, title: '', author: '', description: '', link: '', language: 'en', image: '',
      category: 'Music', keywords: '', explicit: false, created: 0, ownerName: '', ownerEmail: '',
      feedUrl: '', guid: '', npub: '',
      funding: { url: '', text: '' },
      value: { method: d.method || 'lnaddress', suggested: d.suggested || '', recipients: [] },
      support: [],
      releases: [],
    };
  }

  /**
   * @param {object} input Client data.
   * @param {object} opts  hosted, guid, feedUrl, platform[], maxReleases, defaultMethod, allowAttrs
   * @returns {{model:object, errors:Array<{path:string,message:string}>}}
   */
  function normalize(input, opts) {
    opts = Object.assign({ hosted: false, guid: '', feedUrl: '', platform: [], maxReleases: 200, defaultMethod: 'lnaddress', allowAttrs: true }, opts || {});
    input = input && typeof input === 'object' ? input : {};
    var errors = [];
    function err(path, message) { errors.push({ path: path, message: message }); }
    var m = { version: 1 };

    m.title = line(get(input, 'title'));
    if (m.title === '') err('title', 'A title is required.');
    else if (len(m.title) > 200) err('title', 'Title is too long (200 characters max).');

    m.author = m.title; // itunes:author is always the Name / title (no separate Author field)

    m.description = text(get(input, 'description'));
    if (m.description === '') err('description', 'A description is required.');
    else if (len(m.description) > 4000) err('description', 'Description is too long (4000 characters max).');

    m.link = line(get(input, 'link'));
    if (m.link !== '' && !isHttpUrl(m.link)) err('link', 'Website must be an http:// or https:// URL.');

    m.language = line(get(input, 'language')).toLowerCase();
    if (m.language === '') m.language = 'en';
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/.test(m.language)) err('language', 'Language must be a code such as "en" or "en-au".');

    m.image = line(get(input, 'image'));
    if (m.image !== '' && !isHttpUrl(m.image)) err('image', 'Image must be an http:// or https:// URL.');

    m.category = line(get(input, 'category'));
    if (len(m.category) > 100) err('category', 'Category is too long.');
    m.keywords = line(get(input, 'keywords'));
    if (len(m.keywords) > 300) err('keywords', 'Keywords are too long (300 characters max).');

    var cr = get(input, 'created'); // creation time (Unix seconds); 0 = none
    m.created = 0;
    if (typeof cr === 'number' && isFinite(cr) && cr > 0 && cr < 4102444800) m.created = Math.floor(cr);
    else if (typeof cr === 'string' && /^[0-9]{1,10}$/.test(cr) && +cr > 0 && +cr < 4102444800) m.created = +cr;
    var ex = get(input, 'explicit');
    m.explicit = (ex === true || ex === 'true' || ex === 1 || ex === '1');

    m.ownerName = line(get(input, 'ownerName'));
    m.ownerEmail = line(get(input, 'ownerEmail'));
    if (len(m.ownerName) > 200) err('ownerName', 'Feed creator/editor is too long.');
    if (m.ownerEmail !== '' && (len(m.ownerEmail) > 200 || !/^[^\s@<>&"']+@[^\s@<>&"']+\.[^\s@<>&"']+$/.test(m.ownerEmail))) err('ownerEmail', 'Feed contact email is not valid.');

    if (opts.hosted) {
      m.feedUrl = opts.feedUrl;
      m.guid = opts.guid;
    } else {
      m.feedUrl = line(get(input, 'feedUrl'));
      m.guid = line(get(input, 'guid')).toLowerCase();
      if (m.feedUrl !== '' && !isHttpsUrl(m.feedUrl)) err('feedUrl', 'Feed URL must be an https:// URL.');
      if (m.guid === '') err('guid', 'A feed GUID is required.');
      else if (!isUuid(m.guid)) err('guid', 'GUID must be a UUID.');
    }

    var npub = line(get(input, 'npub'));
    if (npub !== '') {
      if (/^[0-9a-fA-F]{64}$/.test(npub)) npub = npubEncode(npub.toLowerCase());
      if (!npub || npubDecode(npub) === false) {
        err('npub', 'That is not a valid npub (checksum failed). Never paste an nsec.');
        npub = line(get(input, 'npub'));
      }
    }
    m.npub = npub;

    var f = get(input, 'funding'), fu = line(get(f, 'url')), ft = line(get(f, 'text'));
    if (fu !== '' && !isHttpsUrl(fu)) err('funding.url', 'Funding link must be an https:// URL.');
    if (len(ft) > 100) err('funding.text', 'Funding text is too long (100 characters max).');
    if (fu !== '' && ft === '') err('funding.text', 'Add the text for the funding link.');
    m.funding = { url: fu, text: ft };

    var v = get(input, 'value'), method = line(get(v, 'method'));
    if (method === '') method = opts.defaultMethod;
    if (method !== 'keysend' && method !== 'lnaddress') err('value.method', 'Value method must be keysend or lnaddress.');
    var suggested = line(get(v, 'suggested'));
    if (suggested !== '' && !/^\d{1,3}(\.\d{1,9})?$/.test(suggested)) err('value.suggested', 'Suggested amount must be a plain decimal such as 0.000033333 (no scientific notation).');
    var recips = [], userTotal = 0, raw = get(v, 'recipients');
    raw = Array.isArray(raw) ? raw.slice() : [];
    if (raw.length > 10) { err('value.recipients', 'At most 10 payment recipients.'); raw = raw.slice(0, 10); }
    raw.forEach(function (r, i) {
      var p = 'value.recipients.' + i, name = line(get(r, 'name')), type = get(r, 'type') === 'node' ? 'node' : 'lnaddress', addr = line(get(r, 'address')), sp = get(r, 'split');
      var row = { name: name, address: addr, split: 0, type: type };
      if (name === '' || len(name) > 100) err(p + '.name', 'Each recipient needs a name (100 characters max).');
      if (type === 'lnaddress' && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(addr)) err(p + '.address', 'Not a valid lightning address (name@domain).');
      if (type === 'node') {
        if (!/^[0-9a-fA-F]{66}$/.test(addr)) err(p + '.address', 'A node address must be 66 hex characters.');
        var ck = line(get(r, 'customKey')), cv = line(get(r, 'customValue'));
        if (ck !== '' && !/^\d{1,20}$/.test(ck)) err(p + '.customKey', 'Custom key must be a number.');
        if (cv !== '' && !/^[\x20-\x7E]{1,128}$/.test(cv)) err(p + '.customValue', 'Custom value must be plain text (128 characters max).');
        row.customKey = ck; row.customValue = cv;
      }
      if ((typeof sp === 'number' && Number.isInteger(sp)) || (typeof sp === 'string' && /^\d{1,3}$/.test(sp.trim()))) {
        sp = parseInt(sp, 10);
        if (sp < 1 || sp > 100) err(p + '.split', 'Split must be between 1 and 100.');
        else row.split = sp;
      } else {
        err(p + '.split', 'Split must be a whole number.');
      }
      userTotal += row.split;
      recips.push(row);
    });
    // "Support the developers": the creator chooses a split (0 to 99) for each configured recipient.
    var support = supportRows(opts.platform, get(input, 'support'), err), pTotal = 0;
    support.forEach(function (s) { pTotal += s.split; });
    if (pTotal > 99) err('support', 'Support splits must total less than 100%.');
    m.support = support;
    // Payments are optional. With no recipients there is no value block at all.
    if (recips.length && userTotal + pTotal !== 100) {
      err('value.recipients', pTotal
        ? 'Your recipients must total ' + (100 - pTotal) + '% - it currently totals ' + userTotal + '%. (Support for the developers currently totals ' + pTotal + '%.)'
        : 'Your recipients must total 100% - it currently totals ' + userTotal + '%.');
    }
    m.value = { method: method, suggested: suggested, recipients: recips };

    var releases = [], rraw = get(input, 'releases');
    rraw = Array.isArray(rraw) ? rraw.slice() : [];
    if (rraw.length > opts.maxReleases) { err('releases', 'At most ' + opts.maxReleases + ' releases.'); rraw = rraw.slice(0, opts.maxReleases); }
    var seen = {};
    rraw.forEach(function (r, i) {
      var p = 'releases.' + i;
      var row = {
        feedGuid: line(get(r, 'feedGuid')).toLowerCase(), feedUrl: line(get(r, 'feedUrl')), medium: line(get(r, 'medium')).toLowerCase(),
        title: line(get(r, 'title')), feedImg: line(get(r, 'feedImg')), rel: [], attrs: {},
      };
      if (row.medium === '') row.medium = 'music';
      if (!isUuid(row.feedGuid)) err(p + '.feedGuid', 'The feed GUID must be a UUID.');
      else if (seen[row.feedGuid]) err(p + '.feedGuid', 'This feed is already listed.');
      else if (row.feedGuid === m.guid) err(p + '.feedGuid', 'A feed cannot list itself.');
      seen[row.feedGuid] = true;
      if (row.feedUrl === '' || !isHttpsUrl(row.feedUrl)) err(p + '.feedUrl', 'The feed URL must be an https:// URL.');
      if (MEDIUMS.indexOf(row.medium) < 0) err(p + '.medium', 'Unknown medium.');
      if (len(row.title) > 200) err(p + '.title', 'Title is too long.');
      if (row.feedImg !== '' && !isHttpsUrl(row.feedImg)) err(p + '.feedImg', 'Image must be an https:// URL.');
      var rel = get(r, 'rel');
      if (typeof rel === 'string') rel = rel.trim().split(/\s+/);
      var tokens = [];
      (Array.isArray(rel) ? rel : []).forEach(function (t) {
        t = line(t).toLowerCase();
        if (t === '') return;
        if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(t)) { err(p + '.rel', 'Roles may only use letters, numbers, "-" and "_".'); return; }
        if (tokens.indexOf(t) < 0) tokens.push(t);
      });
      if (tokens.length > 8) { err(p + '.rel', 'At most 8 roles per release.'); tokens = tokens.slice(0, 8); }
      row.rel = tokens;
      if (opts.allowAttrs) {
        var extra = get(r, 'attrs');
        if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
          Object.keys(extra).sort().forEach(function (k) {
            if (/^[A-Za-z_][A-Za-z0-9_.:-]{0,40}$/.test(k) && RESERVED_ATTRS.indexOf(k) < 0) row.attrs[k] = line(extra[k]);
          });
        }
      }
      releases.push(row);
    });
    m.releases = releases;

    if (opts.allowAttrs && input.preserved && typeof input.preserved === 'object') {
      m.preserved = {
        ns: Object.assign({}, input.preserved.ns || {}),
        channel: Array.isArray(input.preserved.channel) ? input.preserved.channel.map(String) : [],
        names: Array.isArray(input.preserved.names) ? input.preserved.names.map(String) : [],
      };
    }
    return { model: m, errors: errors };
  }

  /** Non-blocking advice. */
  function lint(m) {
    var w = [];
    if (!m.image) w.push('Add a feed image so apps can show your artwork.');
    if (!m.link) w.push('Add your website so listeners can find you.');
    if (!m.npub) w.push('Optional: add your npub so people can find you on Nostr.');
    (m.releases || []).forEach(function (r, i) {
      if (!r.rel || !r.rel.length) w.push('Release ' + (i + 1) + ' has no role. Add one (for example "label" or "producer") so both feeds can confirm the link.');
    });
    return w;
  }

  /* ---------------------------------------------------------------- */
  /* XML builder                                                       */
  /* ---------------------------------------------------------------- */

  function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /**
   * @param {object} m        Normalised model.
   * @param {Array}  platform Recipients to append to the value block.
   * @param {number} nowMs    Milliseconds since epoch (lastBuildDate).
   */
  function buildXml(m, platform, nowMs) {
    var i4 = '    ', i8 = i4 + i4, i12 = i8 + i4, o = [];
    var extraNs = '';
    var pres = m.preserved || { ns: {}, channel: [] };
    Object.keys(pres.ns || {}).sort().forEach(function (p) {
      if (!STD_NS[p] && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(p) && /^[^"<>&\s]+$/.test(pres.ns[p])) extraNs += ' xmlns:' + p + '="' + escAttr(pres.ns[p]) + '"';
    });
    o.push('<?xml version="1.0" encoding="UTF-8"?>');
    o.push('<rss xmlns:podcast="' + NS_PODCAST + '" xmlns:itunes="' + NS_ITUNES + '" xmlns:atom="' + NS_ATOM + '"' + extraNs + ' version="2.0">');
    o.push(i4 + '<channel>');
    if (m.feedUrl !== '') o.push(i8 + '<atom:link href="' + escAttr(m.feedUrl) + '" rel="self" type="application/rss+xml" />');
    o.push(i8 + '<title>' + escText(m.title) + '</title>');
    if (m.author !== '') o.push(i8 + '<itunes:author>' + escText(m.author) + '</itunes:author>');
    o.push(i8 + '<description>' + escText(m.description) + '</description>');
    if (m.link !== '') o.push(i8 + '<link>' + escText(m.link) + '</link>');
    o.push(i8 + '<language>' + escText(m.language) + '</language>');
    o.push(i8 + '<generator>Publisher Feed Generator</generator>');
    if (m.created) o.push(i8 + '<pubDate>' + new Date(m.created * 1000).toUTCString() + '</pubDate>');
    o.push(i8 + '<lastBuildDate>' + new Date(nowMs).toUTCString() + '</lastBuildDate>');
    o.push(i8 + '<podcast:guid>' + escText(m.guid) + '</podcast:guid>');
    if (m.npub !== '') o.push(i8 + '<podcast:txt purpose="npub">' + escText(m.npub) + '</podcast:txt>');
    if (m.category !== '') o.push(i8 + '<itunes:category text="' + escAttr(m.category) + '" />');
    if (m.keywords !== '') o.push(i8 + '<itunes:keywords>' + escText(m.keywords) + '</itunes:keywords>');
    if (m.image !== '') {
      o.push(i8 + '<image>');
      o.push(i12 + '<url>' + escText(m.image) + '</url>');
      o.push(i12 + '<title>' + escText(m.title) + '</title>');
      if (m.link !== '') o.push(i12 + '<link>' + escText(m.link) + '</link>');
      o.push(i8 + '</image>');
      o.push(i8 + '<itunes:image href="' + escAttr(m.image) + '" />');
    }
    o.push(i8 + '<podcast:medium>publisher</podcast:medium>');
    if (m.explicit) o.push(i8 + '<itunes:explicit>true</itunes:explicit>'); // Apple's tag, not part of the Podcast namespace: only kept when a feed already has it
    if (m.ownerName !== '' || m.ownerEmail !== '') {
      o.push(i8 + '<itunes:owner>');
      if (m.ownerName !== '') o.push(i12 + '<itunes:name>' + escText(m.ownerName) + '</itunes:name>');
      if (m.ownerEmail !== '') o.push(i12 + '<itunes:email>' + escText(m.ownerEmail) + '</itunes:email>');
      o.push(i8 + '</itunes:owner>');
    }
    var recips = m.value.recipients.length ? m.value.recipients.concat(Array.isArray(platform) ? platform : []) : [];
    if (recips.length) {
      var attrs = ' type="lightning" method="' + escAttr(m.value.method) + '"';
      if (m.value.suggested !== '') attrs += ' suggested="' + escAttr(m.value.suggested) + '"';
      o.push(i8 + '<podcast:value' + attrs + '>');
      recips.forEach(function (r) {
        var a = ' name="' + escAttr(r.name) + '" address="' + escAttr(r.address) + '" split="' + (parseInt(r.split, 10) || 0) + '" type="' + escAttr(r.type) + '"';
        if (r.type === 'node') {
          if (r.customKey) a += ' customKey="' + escAttr(r.customKey) + '"';
          if (r.customValue) a += ' customValue="' + escAttr(r.customValue) + '"';
        }
        o.push(i12 + '<podcast:valueRecipient' + a + ' />');
      });
      o.push(i8 + '</podcast:value>');
    }
    if (m.funding.url !== '' && m.funding.text !== '') o.push(i8 + '<podcast:funding url="' + escAttr(m.funding.url) + '">' + escText(m.funding.text) + '</podcast:funding>');
    m.releases.forEach(function (r) {
      var a = ' feedGuid="' + escAttr(r.feedGuid) + '" feedUrl="' + escAttr(r.feedUrl) + '" medium="' + escAttr(r.medium) + '"';
      if (r.title !== '') a += ' title="' + escAttr(r.title) + '"';
      if (r.feedImg !== '') a += ' feedImg="' + escAttr(r.feedImg) + '"';
      if (r.rel && r.rel.length) a += ' rel="' + escAttr(r.rel.join(' ')) + '"';
      Object.keys(r.attrs || {}).forEach(function (k) { a += ' ' + k + '="' + escAttr(r.attrs[k]) + '"'; });
      o.push(i8 + '<podcast:remoteItem' + a + ' />');
    });
    (pres.channel || []).forEach(function (raw) { o.push(i8 + raw); });
    o.push(i4 + '</channel>');
    o.push('</rss>');
    return o.join('\n') + '\n';
  }

  /* ---------------------------------------------------------------- */
  /* Import (paste XML)                                                */
  /* ---------------------------------------------------------------- */

  function isPodcastNs(ns) { return ns === NS_PODCAST || ns === NS_PODCAST_LEGACY; }
  function childEls(node) {
    var out = [];
    for (var n = node.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n);
    return out;
  }
  function elText(el) { return line(el.textContent || ''); }
  function attr(el, name) { return el.hasAttribute(name) ? el.getAttribute(name) : ''; }
  function relTokens(s) { return line(s).toLowerCase().split(' ').filter(Boolean); }

  function parseDoc(xml, dom) {
    if (typeof xml !== 'string' || !xml.trim()) return { error: 'Paste the feed XML first.' };
    if (xml.length > 2000000) return { error: 'That file is too large (2 MB max).' };
    if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) return { error: 'Feeds with a DOCTYPE or entity declarations are not accepted.' };
    var doc;
    try {
      doc = new dom.DOMParser().parseFromString(xml.replace(/^﻿/, ''), 'application/xml');
    } catch (e) {
      return { error: 'That is not valid XML.' };
    }
    if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) return { error: 'That is not valid XML.' };
    var rootEl = doc.documentElement;
    if (rootEl.localName !== 'rss') return { error: 'That does not look like an RSS feed.' };
    var channel = childEls(rootEl).filter(function (e) { return e.localName === 'channel'; })[0];
    if (!channel) return { error: 'The feed has no channel.' };
    return { doc: doc, root: rootEl, channel: channel };
  }

  /**
   * Parse a pasted publisher feed into the editor model.
   * Anything not modelled is preserved verbatim and re-emitted on export.
   * @param {string} xml
   * @param {{DOMParser:Function, XMLSerializer:Function}} dom
   */
  function parseXml(xml, dom) {
    var pd = parseDoc(xml, dom);
    if (pd.error) return { error: pd.error };
    var rootEl = pd.root, channel = pd.channel, ser = new dom.XMLSerializer();
    var notes = [], dropped = [], m = emptyModel({});
    m.value.recipients = []; m.category = ''; m.language = '';
    var pres = { ns: {}, channel: [], names: [] };
    var seen = {}, medium = null;

    var atts = rootEl.attributes;
    for (var a = 0; a < atts.length; a++) {
      var an = atts[a].name;
      if (an.indexOf('xmlns:') === 0) pres.ns[an.slice(6)] = atts[a].value;
    }

    function preserve(el) {
      var s = ser.serializeToString(el).trim();
      Object.keys(pres.ns).forEach(function (p) {
        s = s.split(' xmlns:' + p + '="' + pres.ns[p] + '"').join('');
      });
      Object.keys(STD_NS).forEach(function (p) {
        s = s.split(' xmlns:' + p + '="' + STD_NS[p] + '"').join('');
      });
      pres.channel.push(s);
      pres.names.push(el.nodeName);
    }
    function first(key) { if (seen[key]) return false; seen[key] = true; return true; }

    childEls(channel).forEach(function (el) {
      var ns = el.namespaceURI || '', name = el.localName;
      if (!ns) {
        if (name === 'title' && first('title')) m.title = elText(el);
        else if (name === 'description' && first('description')) m.description = text(el.textContent || '');
        else if (name === 'link' && first('link')) m.link = elText(el);
        else if (name === 'language' && first('language')) m.language = elText(el);
        else if (name === 'image' && first('image')) {
          var u = childEls(el).filter(function (c) { return c.localName === 'url'; })[0];
          m.image = u ? elText(u) : '';
        } else if (name === 'pubDate' && !m.created && isFinite(Date.parse(elText(el)))) {
          m.created = Math.floor(Date.parse(elText(el)) / 1000); // becomes the creation date, written back as pubDate
        } else if (name === 'generator' || name === 'lastBuildDate') {
          if (name === 'lastBuildDate') notes.push('lastBuildDate and generator are regenerated on export.');
        } else preserve(el);
      } else if (ns === NS_ITUNES) {
        if (name === 'author' && first('author')) m.author = elText(el);
        else if (name === 'keywords' && first('keywords')) m.keywords = elText(el);
        else if (name === 'explicit' && first('explicit')) m.explicit = /^(true|yes)$/i.test(elText(el));
        else if (name === 'image' && first('itunesimage')) { if (!m.image) m.image = attr(el, 'href'); }
        else if (name === 'category' && !childEls(el).length && first('category')) m.category = attr(el, 'text');
        else if (name === 'owner' && first('owner') && childEls(el).every(function (c) { return c.localName === 'name' || c.localName === 'email'; })) {
          childEls(el).forEach(function (c) { if (c.localName === 'name') m.ownerName = elText(c); else m.ownerEmail = elText(c); });
        } else preserve(el);
      } else if (ns === NS_ATOM && name === 'link' && attr(el, 'rel') === 'self' && first('self')) {
        m.feedUrl = line(attr(el, 'href'));
      } else if (isPodcastNs(ns)) {
        if (name === 'guid' && first('guid')) m.guid = elText(el).toLowerCase();
        else if (name === 'medium' && first('medium')) medium = elText(el).toLowerCase();
        else if (name === 'txt' && attr(el, 'purpose') === 'npub' && first('npub')) m.npub = elText(el);
        else if (name === 'funding' && first('funding')) m.funding = { url: line(attr(el, 'url')), text: elText(el) };
        else if (name === 'value' && first('value')) {
          m.value.method = line(attr(el, 'method')) || 'lnaddress';
          m.value.suggested = line(attr(el, 'suggested'));
          if (attr(el, 'type') && attr(el, 'type') !== 'lightning') dropped.push('payment type "' + attr(el, 'type') + '" (only lightning is supported)');
          Array.prototype.forEach.call(el.attributes, function (at) {
            if (['type', 'method', 'suggested'].indexOf(at.name) < 0) dropped.push('podcast:value attribute "' + at.name + '"');
          });
          childEls(el).forEach(function (c) {
            if (c.localName !== 'valueRecipient') { dropped.push('<' + c.nodeName + '> inside podcast:value'); return; }
            var r = { name: line(attr(c, 'name')), address: line(attr(c, 'address')), split: attr(c, 'split'), type: attr(c, 'type') === 'node' ? 'node' : 'lnaddress' };
            if (r.type === 'node') { r.customKey = line(attr(c, 'customKey')); r.customValue = line(attr(c, 'customValue')); }
            Array.prototype.forEach.call(c.attributes, function (at) {
              if (['name', 'address', 'split', 'type', 'customKey', 'customValue'].indexOf(at.name) < 0) dropped.push('payment recipient attribute "' + at.name + '"');
            });
            m.value.recipients.push(r);
          });
        } else if (name === 'remoteItem') {
          var rel = { feedGuid: line(attr(el, 'feedGuid')), feedUrl: line(attr(el, 'feedUrl')), medium: line(attr(el, 'medium')) || 'music', title: line(attr(el, 'title')), feedImg: line(attr(el, 'feedImg')), rel: relTokens(attr(el, 'rel')), attrs: {} };
          Array.prototype.forEach.call(el.attributes, function (at) {
            if (RESERVED_ATTRS.indexOf(at.name) < 0 && at.name.indexOf('xmlns') !== 0) rel.attrs[at.name] = line(at.value);
          });
          m.releases.push(rel);
        } else preserve(el);
      } else preserve(el);
    });

    if (medium === null) return { error: 'This feed has no podcast:medium. Only publisher feeds (podcast:medium "publisher") can be edited here.' };
    if (medium !== 'publisher') return { error: 'This is a "' + medium + '" feed. Only publisher feeds (podcast:medium "publisher") can be edited here.' };
    if (!m.language) m.language = 'en';
    if (dropped.length) {
      var uniq = dropped.filter(function (d, i) { return dropped.indexOf(d) === i; });
      notes.push('These parts of the payment block are not supported and will be dropped: ' + uniq.join(', ') + '.');
    }
    if (pres.channel.length) notes.push('Kept as-is (not editable here): ' + pres.names.filter(function (n, i) { return pres.names.indexOf(n) === i; }).join(', ') + '.');
    m.preserved = pres;
    return { model: m, notes: notes };
  }

  /**
   * Read a pasted release feed and check whether it links back to this publisher.
   * @returns {{error?:string, guid, title, feedUrl, feedImg, medium, status:'confirmed'|'missing'|'rel-mismatch'|'unknown', theirRel:string[]}}
   */
  function inspectReleaseFeed(xml, dom, ownGuid, ourRel, ownTitle) {
    var pd = parseDoc(xml, dom);
    if (pd.error) return { error: pd.error };
    var info = { guid: '', title: '', feedUrl: '', feedImg: '', medium: '', status: 'unknown', theirRel: [], artist: '', artistUrl: '', person: '' }, back = [], people = [];
    var iImg = '', cImg = '';
    childEls(pd.channel).forEach(function (el) {
      var ns = el.namespaceURI || '', name = el.localName;
      if (!ns && name === 'title' && !info.title) info.title = elText(el);
      else if (!ns && name === 'image') { var u = childEls(el).filter(function (c) { return c.localName === 'url'; })[0]; cImg = u ? elText(u) : ''; }
      else if (ns === NS_ITUNES && name === 'image') iImg = line(attr(el, 'href'));
      else if (ns === NS_ATOM && name === 'link' && attr(el, 'rel') === 'self' && !info.feedUrl) info.feedUrl = line(attr(el, 'href'));
      else if (isPodcastNs(ns) && name === 'guid') info.guid = elText(el).toLowerCase();
      else if (isPodcastNs(ns) && name === 'medium') info.medium = elText(el).toLowerCase();
      else if (isPodcastNs(ns) && name === 'publisher') childEls(el).forEach(function (c) { if (c.localName === 'remoteItem') back.push(c); });
      else if (isPodcastNs(ns) && name === 'person' && elText(el)) people.push({ name: elText(el), role: attr(el, 'role').toLowerCase() });
    });
    info.feedImg = iImg || cImg;
    // Artist: the publisher feed with rel="artist", else the first publisher feed; its name is our own title when it is
    // this feed, a title attribute if the link has one, otherwise the editor reads that feed. Then the first podcast:person.
    var artistLink = back.filter(function (c) { return relTokens(attr(c, 'rel')).indexOf('artist') >= 0; })[0] || back[0];
    if (artistLink) {
      if (ownGuid && line(attr(artistLink, 'feedGuid')).toLowerCase() === ownGuid.toLowerCase()) info.artist = line(ownTitle || '');
      else if (line(attr(artistLink, 'title'))) info.artist = line(attr(artistLink, 'title'));
      else if (isHttpsUrl(line(attr(artistLink, 'feedUrl')))) info.artistUrl = line(attr(artistLink, 'feedUrl'));
    }
    var pe = people.filter(function (x) { return x.role === 'artist'; })[0] || people.filter(function (x) { return !x.role; })[0] || people[0];
    if (pe) info.person = pe.name;
    if (!ownGuid) return info;
    var mine = back.filter(function (c) { return line(attr(c, 'feedGuid')).toLowerCase() === ownGuid.toLowerCase(); })[0];
    if (!mine) { info.status = 'missing'; return info; }
    info.theirRel = relTokens(attr(mine, 'rel'));
    ourRel = ourRel || [];
    var a = ourRel.slice().sort().join(' '), b = info.theirRel.slice().sort().join(' ');
    info.status = (!a || !b || a === b) ? 'confirmed' : 'rel-mismatch';
    return info;
  }

  /** Title of a feed's channel (used to name the artist's publisher feed). */
  function channelTitle(xml, dom) {
    var pd = parseDoc(xml, dom);
    if (pd.error) return '';
    var t = childEls(pd.channel).filter(function (el) { return !(el.namespaceURI || '') && el.localName === 'title'; })[0];
    return t ? elText(t) : '';
  }

  /** The text a release owner must add to their own feed so the link is confirmed both ways. */
  function snippetFor(m, rel) {
    var a = ' medium="publisher" feedGuid="' + escAttr(m.guid) + '"';
    if (m.feedUrl) a += ' feedUrl="' + escAttr(m.feedUrl) + '"';
    if (rel && rel.length) a += ' rel="' + escAttr(rel.join(' ')) + '"';
    return '<podcast:publisher>\n    <podcast:remoteItem' + a + ' />\n</podcast:publisher>';
  }

  return {
    NS_PODCAST: NS_PODCAST, NS_ITUNES: NS_ITUNES, NS_ATOM: NS_ATOM, MEDIUMS: MEDIUMS, BUILTIN_RELS: BUILTIN_RELS,
    uuid5: uuid5, guidForUrl: guidForUrl, randomGuid: randomGuid, npubEncode: npubEncode, npubDecode: npubDecode,
    emptyModel: emptyModel, emptyRecipient: emptyRecipient, platformTotal: platformTotal,
    normalize: normalize, lint: lint, buildXml: buildXml, parseXml: parseXml, inspectReleaseFeed: inspectReleaseFeed, channelTitle: channelTitle, snippetFor: snippetFor,
    line: line, text: text, isHttpsUrl: isHttpsUrl, isHttpUrl: isHttpUrl, profileToFields: profileToFields, supportRows: supportRows, activePlatform: activePlatform, ensureSupport: ensureSupport, liftSupport: liftSupport, slugify: slugify, splitRoles: splitRoles, OTHER_RELS: OTHER_RELS, CATEGORIES: CATEGORIES, LANGUAGES: LANGUAGES, isUuid: isUuid, len: len,
  };
});
