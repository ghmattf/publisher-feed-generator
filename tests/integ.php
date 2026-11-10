<?php
require __DIR__ . '/wpenv.php';
$fails = 0; function ok($c, $m){ global $fails; echo ($c ? 'ok  : ' : 'FAIL: ') . $m . "\n"; if (!$c) $fails++; }
$B = 'https://phafe.com/wp-json/mspf/v1';
function sign($sk, $url, $method, $nonce, $body = '', $ts = ''){ return json_decode(shell_exec('node ' . escapeshellarg(__DIR__ . '/sign.cjs') . ' ' . implode(' ', array_map('escapeshellarg', [$sk, $url, $method, $nonce, $body, $ts]))), true); }
function nonce(){ return MSPF_Auth::issue_nonce()['nonce']; }
// route table mirrors register_routes
function call($method, $route, $body = null, $headers = []){
  MSPF_Auth::$session = null;
  $req = new WP_REST_Request($method, '/mspf/v1' . $route, $body, $headers);
  $id = null; if (preg_match('#^/me/feeds/(\d+)$#', $route, $m)) { $id = $m[1]; $req['id'] = $id; }
  $perm = in_array($route, ['/auth/nonce', '/auth/login'], true) ? 'perm_hosting' : (strpos($route, '/lookup/') === 0 ? 'perm_lookup' : 'perm_session');
  $p = MSPF_Rest::$perm($req); if (is_wp_error($p)) return $p;
  $map = ['POST /auth/nonce' => 'route_nonce', 'POST /auth/login' => 'route_login', 'POST /auth/logout' => 'route_logout', 'GET /me' => 'route_me', 'POST /lookup/feed' => 'route_lookup_feed', 'POST /lookup/search' => 'route_lookup_search', 'GET /me/feeds' => 'route_list', 'POST /me/feeds' => 'route_create'];
  $k = $method . ' ' . ($id ? '/me/feeds' : $route); 
  if ($id) $h = ['GET' => 'route_get', 'PUT' => 'route_update', 'DELETE' => 'route_delete'][$method]; else $h = $map[$k];
  return MSPF_Rest::$h($req);
}
function code($r){ return is_wp_error($r) ? ($r->data['status'] ?? 0) : $r->status; }
function data($r){ return is_wp_error($r) ? null : $r->data; }

$skA = bin2hex(random_bytes(32)); $skB = bin2hex(random_bytes(32));
$pubA = trim(shell_exec("node -e \"const {getPublicKey}=require('" . __DIR__ . "/../build/node_modules/nostr-tools/lib/cjs/pure.js');const {hexToBytes}=require('" . __DIR__ . "/../build/node_modules/@noble/hashes/utils.js');process.stdout.write(getPublicKey(hexToBytes('$skA')))\""));

// ---- login
ok(code(call('GET', '/me/feeds')) === 401, 'no session -> 401');
$n = nonce(); $ev = sign($skA, "$B/auth/login", 'POST', $n);
$r = call('POST', '/auth/login', ['event' => $ev]); ok(code($r) === 200 && data($r)['pubkey'] === $pubA, 'login with valid NIP-98 event');
$csrf = data($r)['csrf'];
ok(code(call('POST', '/auth/login', ['event' => $ev])) >= 400, 'replayed login event rejected (nonce single-use)');
$n = nonce(); ok(code(call('POST', '/auth/login', ['event' => sign($skA, "$B/auth/login", 'POST', $n, '', time() - 600)])) >= 400, 'old (10 min) event rejected');
$n = nonce(); ok(code(call('POST', '/auth/login', ['event' => sign($skA, "$B/auth/other", 'POST', $n)])) >= 400, 'event for another URL rejected');
$n = nonce(); $bad = sign($skA, "$B/auth/login", 'POST', $n); $bad['sig'] = str_repeat('0', 128); ok(code(call('POST', '/auth/login', ['event' => $bad])) >= 400, 'bad signature rejected');
$n = nonce(); ok(code(call('POST', '/auth/login', ['event' => sign($skA, "$B/auth/login", 'GET', $n)])) >= 400, 'event with wrong method rejected');
// session cookie: only the hash is stored, so plant a known token for the test
global $wpdb; $tok = bin2hex(random_bytes(32)); $wpdb->query("UPDATE wp_mspf_sessions SET token_hash = '" . hash('sha256', $tok) . "' WHERE account_id = 1"); $_COOKIE['mspf_session'] = $tok;
$H = ['X-MSPF-CSRF' => $csrf];
ok(code(call('GET', '/me')) === 200, 'GET /me with session cookie');
$csrf = data(call('GET', '/me'))['csrf']; $H = ['X-MSPF-CSRF' => $csrf];
ok(code(call('GET', '/me/feeds')) === 200 && data(call('GET', '/me/feeds')) === [], 'empty feed list');

// ---- create
function feed($over = []){ return array_replace_recursive(['title' => 'Acme Records', 'author' => 'Acme', 'description' => 'We make records.', 'link' => 'https://acme.example', 'language' => 'en', 'category' => 'Music', 'value' => ['method' => 'lnaddress', 'suggested' => '0.000033333', 'recipients' => [['name' => 'Acme', 'address' => 'acme@getalby.com', 'split' => 99, 'type' => 'lnaddress']]], 'releases' => [['feedGuid' => '07adf84f-c1fa-47a7-a121-0fb544e859bd', 'feedUrl' => 'https://phafe.com/x/some_songs.xml', 'medium' => 'music', 'title' => 'Some Songs', 'rel' => ['label', 'studio']]]], $over); }
ok(code(call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()])) === 403, 'create without CSRF header -> 403');
ok(code(call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()], ['X-MSPF-CSRF' => str_repeat('a', 48)])) === 403, 'create with wrong CSRF -> 403');
ok(code(call('POST', '/me/feeds', 'slug=x', $H + ['Content-Type' => 'application/x-www-form-urlencoded'])) === 415, 'form-encoded body rejected (415)');
foreach (['../etc', 'ab', 'Acme Records', 'admin', 'x/../y', str_repeat('a', 41)] as $bs) ok(code(call('POST', '/me/feeds', ['slug' => $bs, 'feed' => feed()], $H)) === 422, "bad/reserved slug refused: $bs");
$r = call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()], $H); ok(code($r) === 201, 'create hosted feed -> 201 (' . (is_wp_error($r) ? $r->message : '') . ')');
$f = data($r); $path = $GLOBALS['__up'] . '/rssfeed/publishers/acme-records/acme-records.xml';
ok(file_exists($path), 'XML written to uploads/rssfeed/publishers/acme-records/');
$xml = file_get_contents($path);
ok(strpos($xml, '<podcast:medium>publisher</podcast:medium>') !== false && strpos($xml, 'podcastindex@getalby.com') !== false && strpos($xml, 'split="99"') !== false && strpos($xml, 'split="1"') !== false, 'file is a publisher feed with user (99) and platform (1) recipients');
ok(strpos($xml, 'https://phafe.com/wp-content/uploads/rssfeed/publishers/acme-records/acme-records.xml') !== false && strpos($xml, '<podcast:guid>' . MSPF_Feed::guid_for_url('https://phafe.com/wp-content/uploads/rssfeed/publishers/acme-records/acme-records.xml')) !== false, 'self URL and derived GUID in file');
$d = new DOMDocument(); ok($d->loadXML($xml), 'published XML is well-formed');
ok(code(call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()], $H)) === 409, 'duplicate slug -> 409');
$r = call('POST', '/me/feeds', ['slug' => 'bad-split', 'feed' => feed(['value' => ['recipients' => [['split' => 50]]]])], $H); ok(code($r) === 422 && !empty($r->data['errors']), 'splits not totalling 99 -> 422 with errors');
ok(!file_exists($GLOBALS['__up'] . '/rssfeed/publishers/bad-split'), 'nothing written for an invalid feed');
$r = call('POST', '/me/feeds', ['slug' => 'inj', 'feed' => feed(['title' => "<script>x</script> & \"q\"", 'releases' => [['feedGuid' => '07adf84f-c1fa-47a7-a121-0fb544e859bd', 'feedUrl' => 'https://x.example/a.xml', 'rel' => ['label'], 'attrs' => ['onload' => 'evil']]]])], $H);
$ix = @file_get_contents($GLOBALS['__up'] . '/rssfeed/publishers/inj/inj.xml'); $dd = new DOMDocument(); ok($ix && $dd->loadXML($ix) && strpos($ix, '<script>') === false && strpos($ix, 'onload') === false, 'markup in title escaped and unknown attributes dropped in hosted output');
ok(code(call('POST', '/me/feeds', ['slug' => 'third-one', 'feed' => feed()], $H)) === 201, 'third feed allowed');
ok(code(call('POST', '/me/feeds', ['slug' => 'fourth-one', 'feed' => feed()], $H)) === 403, 'fourth feed refused (limit 3)');

// ---- update
$id = $f['id']; $url = "$B/me/feeds/$id";
$r = call('PUT', "/me/feeds/$id", ['feed' => feed(['title' => 'Acme Renamed'])], $H); ok(code($r) === 200, 'edit title without a fresh signature works');
ok(strpos(file_get_contents($path), 'Acme Renamed') !== false, 'published file updated');
$body = json_encode(['feed' => feed(['value' => ['recipients' => [['name' => 'Evil', 'address' => 'evil@x.com', 'split' => 99, 'type' => 'lnaddress']]]])]);
$r = call('PUT', "/me/feeds/$id", $body, $H); ok(code($r) === 428, 'changing a payment recipient -> 428 fresh signature required');
ok(strpos(file_get_contents($path), 'evil@x.com') === false, 'file NOT changed after 428');
$ev = sign($skA, $url, 'PUT', nonce(), $body); $auth = base64_encode(json_encode($ev));
$r = call('PUT', "/me/feeds/$id", $body, $H + ['X-MSPF-Auth' => $auth]); ok(code($r) === 200, 'payment change with fresh signature accepted');
ok(strpos(file_get_contents($path), 'evil@x.com') !== false, 'file updated with new recipient');
$body2 = json_encode(['feed' => feed(['value' => ['recipients' => [['name' => 'Other', 'address' => 'o@x.com', 'split' => 99, 'type' => 'lnaddress']]]])]);
$r = call('PUT', "/me/feeds/$id", $body2, $H + ['X-MSPF-Auth' => $auth]); ok(code($r) >= 400, 'old signature cannot be replayed on a different body');
$ev = sign($skA, $url, 'PUT', nonce(), $body2); $r = call('PUT', "/me/feeds/$id", $body2, $H + ['X-MSPF-Auth' => base64_encode(json_encode($ev))]); $okA = code($r) === 200;
$r = call('PUT', "/me/feeds/$id", $body, $H + ['X-MSPF-Auth' => base64_encode(json_encode(sign($skA, $url, 'PUT', 'ab' . str_repeat('0', 30), $body)))]); ok(code($r) === 428, 'made-up (never issued) nonce rejected');
$evB = sign($skB, $url, 'PUT', nonce(), $body); $r = call('PUT', "/me/feeds/$id", $body, $H + ['X-MSPF-Auth' => base64_encode(json_encode($evB))]); ok(code($r) >= 400 && code($r) !== 200, 'signature from a different key rejected');
$bodyOther = json_encode(['feed' => feed(['value' => ['recipients' => [['name' => 'Z', 'address' => 'z@x.com', 'split' => 99, 'type' => 'lnaddress']]]])]);
$r = call('PUT', "/me/feeds/$id", $bodyOther, $H + ['X-MSPF-Auth' => base64_encode(json_encode(sign($skA, "$B/me/feeds/999", 'PUT', nonce(), $bodyOther)))]); ok(code($r) >= 400 && code($r) !== 200, 'signature for a different URL rejected');

// ---- another account cannot touch it
$n = nonce(); $rB = call('POST', '/auth/login', ['event' => sign($skB, "$B/auth/login", 'POST', $n)]); ok(code($rB) === 200, 'second account logs in');
$tokB = bin2hex(random_bytes(32)); $wpdb->query("UPDATE wp_mspf_sessions SET token_hash = '" . hash('sha256', $tokB) . "' WHERE account_id = 2"); $savedCookie = $_COOKIE['mspf_session']; $_COOKIE['mspf_session'] = $tokB;
$HB = ['X-MSPF-CSRF' => data(call('GET', '/me'))['csrf']];
ok(code(call('GET', "/me/feeds/$id")) === 404, "other account cannot read someone else's feed (404)");
ok(code(call('PUT', "/me/feeds/$id", ['feed' => feed()], $HB)) === 404, "other account cannot edit someone else's feed");
ok(code(call('DELETE', "/me/feeds/$id", null, $HB)) === 404, "other account cannot delete someone else's feed");
$_COOKIE['mspf_session'] = $savedCookie;

// ---- delete
ok(code(call('DELETE', "/me/feeds/$id", null, $H)) === 428, 'delete without fresh signature -> 428');
ok(file_exists($path), 'file still present after refused delete');
$r = call('DELETE', "/me/feeds/$id", null, $H + ['X-MSPF-Auth' => base64_encode(json_encode(sign($skA, $url, 'DELETE', nonce())))]); ok(code($r) === 200, 'delete with fresh signature');
ok(!file_exists($path) || strpos(file_get_contents($path), 'podcast:medium') === false, 'published file removed or neutralised');
ok(code(call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()], $H)) === 409, 'deleted slug cannot be re-registered');
ok(code(call('GET', "/me/feeds/$id")) === 404, 'deleted feed no longer readable');


// ---- payments optional
$nof = feed(); $nof['value']['recipients'] = [];
$wpdb->query("UPDATE wp_mspf_feeds SET status='deleted' WHERE slug='inj'");
$r2 = call('POST', '/me/feeds', ['slug' => 'no-pay', 'feed' => $nof], $H);
ok(code($r2) === 201, 'feed with no payment recipients is accepted (' . (is_wp_error($r2) ? $r2->message : '') . ')');
$npx = @file_get_contents($GLOBALS['__up'] . '/rssfeed/publishers/no-pay/no-pay.xml'); $dn = new DOMDocument();
ok($npx && $dn->loadXML($npx) && strpos($npx, 'podcast:value') === false, 'no-payments feed has no value block (and no platform recipient)');
$half = feed(); $half['value']['recipients'] = [['name' => 'A', 'address' => 'a@x.com', 'split' => 50, 'type' => 'lnaddress']];
ok(code(call('PUT', '/me/feeds/' . data($r2)['id'], ['feed' => $half], $H)) === 422, 'if recipients are given, totals are still enforced');

// ---- lookups (no session needed)
$_COOKIE = [];
$xmlOk = '<?xml version="1.0"?><rss><channel><title>T</title></channel></rss>';
$GLOBALS['__http'] = fn($u, $a) => ['code' => 200, 'body' => $xmlOk]; $GLOBALS['__httplog'] = [];
$r = call('POST', '/lookup/feed', ['url' => 'https://phafe.com/x/some_songs.xml']);
ok(code($r) === 200 && data($r)['xml'] === $xmlOk, 'feed URL fetched on the server and XML returned');
ok($GLOBALS['__httplog'][0][0] === 'safe' && $GLOBALS['__httplog'][0][2]['redirection'] <= 3 && $GLOBALS['__httplog'][0][2]['limit_response_size'] > 0, 'fetch uses the SSRF-safe WordPress HTTP function with size limit');
foreach (['http://phafe.com/x.xml', 'ftp://x/y', 'https://', '', 'file:///etc/passwd', 'javascript:alert(1)', "https://a.com/x y"] as $bad) { $GLOBALS['__httplog'] = []; ok(code(call('POST', '/lookup/feed', ['url' => $bad])) === 422 && !$GLOBALS['__httplog'], 'bad feed URL refused without fetching: ' . var_export($bad, true)); }
$GLOBALS['__http'] = fn($u, $a) => ['code' => 404, 'body' => '']; ok(code(call('POST', '/lookup/feed', ['url' => 'https://phafe.com/gone.xml'])) === 502, 'upstream 404 -> clear 502 error');
$GLOBALS['__http'] = fn($u, $a) => new WP_Error('http_request_failed', 'blocked'); ok(code(call('POST', '/lookup/feed', ['url' => 'https://127.0.0.1/x.xml'])) === 502, 'blocked/unreachable address -> 502');
$GLOBALS['__http'] = fn($u, $a) => ['code' => 200, 'body' => str_repeat('a', 2097153)]; ok(code(call('POST', '/lookup/feed', ['url' => 'https://phafe.com/big.xml'])) === 413, 'oversized feed refused');
ok(code(call('POST', '/lookup/feed', 'url=https://x.com', ['Content-Type' => 'application/x-www-form-urlencoded'])) === 415, 'lookup refuses non-JSON bodies');

$G1 = '07adf84f-c1fa-47a7-a121-0fb544e859bd'; $G2 = '11111111-1111-4111-8111-111111111111';
$GLOBALS['__http'] = function($u, $a) use ($G1, $G2) {
  if (strpos($u, 'https://api.musicindex.org/v1/search') === 0) return ['code' => 200, 'body' => json_encode(['data' => [
    ['entity_type' => 'track', 'entity_id' => 'trk1', 'feed_guid' => $G1], ['entity_type' => 'feed', 'entity_id' => $G1], ['entity_type' => 'feed', 'entity_id' => 'not-a-guid'], ['entity_type' => 'feed', 'entity_id' => $G2], ['bad' => 1]], 'pagination' => ['has_more' => true, 'cursor' => 'c']])];
  if (strpos($u, "https://api.musicindex.org/v1/feeds/$G1") === 0) return ['code' => 200, 'body' => json_encode(['data' => ['title' => 'Some <b>Songs</b>', 'release_artist' => 'MezzaForte', 'image_url' => 'http://insecure/a.png', 'feed_url' => 'https://phafe.com/x/some_songs.xml']])];
  if (strpos($u, "https://api.musicindex.org/v1/feeds/$G2") === 0) return ['code' => 200, 'body' => json_encode(['data' => ['title' => 'Other', 'release_artist' => '', 'image_url' => 'https://i.example/o.png']])];
  return ['code' => 404, 'body' => ''];
};
$GLOBALS['__httplog'] = []; $r = call('POST', '/lookup/search', ['q' => 'some songs']); $res = data($r)['results'] ?? [];
ok(code($r) === 200 && count($res) === 2, 'search returns de-duplicated albums (track hit mapped to album, junk hits skipped)');
ok($res[0]['guid'] === $G1 && $res[0]['feedUrl'] === 'https://phafe.com/x/some_songs.xml' && $res[0]['artist'] === 'MezzaForte' && $res[0]['image'] === '', 'details parsed; non-https image dropped');
ok($res[1]['feedUrl'] === '' && $res[1]['image'] === 'https://i.example/o.png', 'missing feed address left empty for the user to fill');
ok(array_reduce($GLOBALS['__httplog'], fn($c, $l) => $c && $l[0] === 'plain' && strpos($l[1], 'https://api.musicindex.org/v1/') === 0, true), 'only api.musicindex.org is contacted for search');
$n = count($GLOBALS['__httplog']); call('POST', '/lookup/search', ['q' => 'some songs']); ok(count($GLOBALS['__httplog']) === $n + 1, 'album details cached (second search makes only the search call)');
ok(code(call('POST', '/lookup/search', ['q' => 'a'])) === 422, 'too-short query refused');
ok(code(call('POST', '/lookup/search', ['q' => 'x&limit=999#'])) === 200 && strpos(end($GLOBALS['__httplog'])[1], 'q=x%26limit%3D999%23') !== false, 'query is URL-encoded (no parameter injection)');
$GLOBALS['__http'] = fn($u, $a) => new WP_Error('x', 'down'); ok(code(call('POST', '/lookup/search', ['q' => 'anything'])) === 502, 'Music Index down -> 502 with friendly message');
$GLOBALS['__tr'] = []; $hit429 = false; for ($i = 0; $i < 25; $i++) { if (code(call('POST', '/lookup/search', ['q' => 'abc'])) === 429) { $hit429 = true; break; } } ok($hit429, 'lookups are rate limited (429)');

$_COOKIE['mspf_session'] = $savedCookie; $GLOBALS['__tr'] = [];
// ---- logout, config
ok(code(call('POST', '/auth/logout', null, $H)) === 200 && code(call('GET', '/me')) === 401, 'logout ends the session');
$cfg = MSPF_Rest::client_config(); ok(json_encode($cfg) && $cfg['hostingAvailable'] === true && $cfg['urls']['feedTemplate'] === "$B/me/feeds/0" && count($cfg['platform']) === 1, 'client config sane');
echo $fails ? "\n$fails FAILURES\n" : "\nintegration tests passed\n"; exit($fails ? 1 : 0);
