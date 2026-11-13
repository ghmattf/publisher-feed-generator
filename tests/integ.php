<?php
require __DIR__ . '/wpenv.php';
$fails = 0; function ok($c, $m){ global $fails; echo ($c ? 'ok  : ' : 'FAIL: ') . $m . "\n"; if (!$c) $fails++; }
$B = 'https://phafe.com/wp-json/pfg/v1';
function sign($sk, $url, $method, $nonce, $body = '', $ts = ''){ return json_decode(shell_exec('node ' . escapeshellarg(__DIR__ . '/sign.cjs') . ' ' . implode(' ', array_map('escapeshellarg', [$sk, $url, $method, $nonce, $body, $ts]))), true); }
function nonce(){ return PFG_Auth::issue_nonce()['nonce']; }
// route table mirrors register_routes
function call($method, $route, $body = null, $headers = []){
  PFG_Auth::$session = null;
  $req = new WP_REST_Request($method, '/pfg/v1' . $route, $body, $headers);
  $id = null; if (preg_match('#^/me/feeds/(\d+)$#', $route, $m)) { $id = $m[1]; $req['id'] = $id; }
  $perm = in_array($route, ['/auth/nonce', '/auth/login'], true) ? 'perm_hosting' : (strpos($route, '/lookup/') === 0 ? 'perm_lookup' : 'perm_session');
  $p = PFG_Rest::$perm($req); if (is_wp_error($p)) return $p;
  $map = ['POST /auth/nonce' => 'route_nonce', 'POST /auth/login' => 'route_login', 'POST /auth/logout' => 'route_logout', 'GET /me' => 'route_me', 'POST /lookup/feed' => 'route_lookup_feed', 'POST /lookup/search' => 'route_lookup_search', 'GET /me/feeds' => 'route_list', 'POST /me/feeds' => 'route_create'];
  $k = $method . ' ' . ($id ? '/me/feeds' : $route); 
  if ($id) $h = ['GET' => 'route_get', 'PUT' => 'route_update', 'DELETE' => 'route_delete'][$method]; else $h = $map[$k];
  return PFG_Rest::$h($req);
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
global $wpdb; $tok = bin2hex(random_bytes(32)); $wpdb->query("UPDATE wp_pfg_sessions SET token_hash = '" . hash('sha256', $tok) . "' WHERE account_id = 1"); $_COOKIE['pfg_session'] = $tok;
$H = ['X-PFG-CSRF' => $csrf];
ok(code(call('GET', '/me')) === 200, 'GET /me with session cookie');
$csrf = data(call('GET', '/me'))['csrf']; $H = ['X-PFG-CSRF' => $csrf];
ok(code(call('GET', '/me/feeds')) === 200 && data(call('GET', '/me/feeds')) === [], 'empty feed list');

// ---- create
function feed($over = []){ return array_replace_recursive(['title' => 'Acme Records', 'author' => 'Acme', 'description' => 'We make records.', 'link' => 'https://acme.example', 'language' => 'en', 'category' => 'Music', 'value' => ['method' => 'lnaddress', 'suggested' => '0.000033333', 'recipients' => [['name' => 'Acme', 'address' => 'acme@getalby.com', 'split' => 97, 'type' => 'lnaddress']]], 'releases' => [['feedGuid' => '07adf84f-c1fa-47a7-a121-0fb544e859bd', 'feedUrl' => 'https://phafe.com/x/some_songs.xml', 'medium' => 'music', 'title' => 'Some Songs', 'rel' => ['label', 'studio']]]], $over); }
ok(code(call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()])) === 403, 'create without CSRF header -> 403');
ok(code(call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()], ['X-PFG-CSRF' => str_repeat('a', 48)])) === 403, 'create with wrong CSRF -> 403');
ok(code(call('POST', '/me/feeds', 'slug=x', $H + ['Content-Type' => 'application/x-www-form-urlencoded'])) === 415, 'form-encoded body rejected (415)');
foreach (['../etc', 'ab', 'Acme Records', 'admin', 'x/../y', str_repeat('a', 41)] as $bs) ok(code(call('POST', '/me/feeds', ['slug' => $bs, 'feed' => feed()], $H)) === 422, "bad/reserved slug refused: $bs");
$r = call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()], $H); ok(code($r) === 201, 'create hosted feed -> 201 (' . (is_wp_error($r) ? $r->message : '') . ')');
$f = data($r); $path = $GLOBALS['__up'] . '/rssfeed/publishers/acme-records/acme-records.xml';
ok(file_exists($path), 'XML written to uploads/rssfeed/publishers/acme-records/');
$xml = file_get_contents($path);
ok(strpos($xml, '<podcast:medium>publisher</podcast:medium>') !== false && strpos($xml, 'phafe@phafe.com') !== false && strpos($xml, 'heycitizen@getalby.com') !== false && strpos($xml, 'podcastindex@getalby.com') !== false && strpos($xml, 'split="97"') !== false && substr_count($xml, 'split="1"') === 3, 'file is a publisher feed with the user (97) and three support (1 each) recipients');
ok(strpos($xml, 'https://phafe.com/wp-content/uploads/rssfeed/publishers/acme-records/acme-records.xml') !== false && strpos($xml, '<podcast:guid>' . PFG_Feed::guid_for_url('https://phafe.com/wp-content/uploads/rssfeed/publishers/acme-records/acme-records.xml')) !== false, 'self URL and derived GUID in file');
$d = new DOMDocument(); ok($d->loadXML($xml), 'published XML is well-formed');
ok(code(call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()], $H)) === 409, 'duplicate slug -> 409');
$r = call('POST', '/me/feeds', ['slug' => 'bad-split', 'feed' => feed(['value' => ['recipients' => [['split' => 50]]]])], $H); ok(code($r) === 422 && !empty($r->data['errors']), 'splits not totalling 97 -> 422 with errors');
ok(!file_exists($GLOBALS['__up'] . '/rssfeed/publishers/bad-split'), 'nothing written for an invalid feed');
$r = call('POST', '/me/feeds', ['slug' => 'inj', 'feed' => feed(['title' => "<script>x</script> & \"q\"", 'releases' => [['feedGuid' => '07adf84f-c1fa-47a7-a121-0fb544e859bd', 'feedUrl' => 'https://x.example/a.xml', 'rel' => ['label'], 'attrs' => ['onload' => 'evil']]]])], $H);
$ix = @file_get_contents($GLOBALS['__up'] . '/rssfeed/publishers/inj/inj.xml'); $dd = new DOMDocument(); ok($ix && $dd->loadXML($ix) && strpos($ix, '<script>') === false && strpos($ix, 'onload') === false, 'markup in title escaped and unknown attributes dropped in hosted output');
ok(code(call('POST', '/me/feeds', ['slug' => 'third-one', 'feed' => feed()], $H)) === 201, 'third feed allowed');
ok(code(call('POST', '/me/feeds', ['slug' => 'fourth-one', 'feed' => feed()], $H)) === 403, 'fourth feed refused (limit 3)');

// ---- update
$id = $f['id']; $url = "$B/me/feeds/$id";
$r = call('PUT', "/me/feeds/$id", ['feed' => feed(['title' => 'Acme Renamed'])], $H); ok(code($r) === 200, 'edit title without a fresh signature works');
ok(strpos(file_get_contents($path), 'Acme Renamed') !== false, 'published file updated');
$body = json_encode(['feed' => feed(['value' => ['recipients' => [['name' => 'Evil', 'address' => 'evil@x.com', 'split' => 97, 'type' => 'lnaddress']]]])]);
$r = call('PUT', "/me/feeds/$id", $body, $H); ok(code($r) === 428, 'changing a payment recipient -> 428 fresh signature required');
ok(strpos(file_get_contents($path), 'evil@x.com') === false, 'file NOT changed after 428');
$ev = sign($skA, $url, 'PUT', nonce(), $body); $auth = base64_encode(json_encode($ev));
$r = call('PUT', "/me/feeds/$id", $body, $H + ['X-PFG-Auth' => $auth]); ok(code($r) === 200, 'payment change with fresh signature accepted');
ok(strpos(file_get_contents($path), 'evil@x.com') !== false, 'file updated with new recipient');
$body2 = json_encode(['feed' => feed(['value' => ['recipients' => [['name' => 'Other', 'address' => 'o@x.com', 'split' => 97, 'type' => 'lnaddress']]]])]);
$r = call('PUT', "/me/feeds/$id", $body2, $H + ['X-PFG-Auth' => $auth]); ok(code($r) >= 400, 'old signature cannot be replayed on a different body');
$ev = sign($skA, $url, 'PUT', nonce(), $body2); $r = call('PUT', "/me/feeds/$id", $body2, $H + ['X-PFG-Auth' => base64_encode(json_encode($ev))]); $okA = code($r) === 200;
// support split changes redirect value too, so they need a fresh signature as well
$bodyS = json_encode(['feed' => feed(['value' => ['recipients' => [['name' => 'Other', 'address' => 'o@x.com', 'split' => 96, 'type' => 'lnaddress']]]]) + ['support' => [['address' => 'phafe@phafe.com', 'split' => 2], ['address' => 'heycitizen@getalby.com', 'split' => 1], ['address' => 'podcastindex@getalby.com', 'split' => 1]]]]);
$r = call('PUT', "/me/feeds/$id", $bodyS, $H); ok(code($r) === 428, 'changing a support split -> 428 fresh signature required');
ok(strpos(file_get_contents($path), 'phafe@phafe.com" split="2"') === false, 'file NOT changed after 428 (support split)');
$r = call('PUT', "/me/feeds/$id", $bodyS, $H + ['X-PFG-Auth' => base64_encode(json_encode(sign($skA, $url, 'PUT', nonce(), $bodyS)))]); ok(code($r) === 200, 'support split change with fresh signature accepted');
ok(strpos(file_get_contents($path), 'phafe@phafe.com" split="2"') !== false, 'file updated with the new support split');
$r = call('PUT', "/me/feeds/$id", $body, $H + ['X-PFG-Auth' => base64_encode(json_encode(sign($skA, $url, 'PUT', 'ab' . str_repeat('0', 30), $body)))]); ok(code($r) === 428, 'made-up (never issued) nonce rejected');
$evB = sign($skB, $url, 'PUT', nonce(), $body); $r = call('PUT', "/me/feeds/$id", $body, $H + ['X-PFG-Auth' => base64_encode(json_encode($evB))]); ok(code($r) >= 400 && code($r) !== 200, 'signature from a different key rejected');
$bodyOther = json_encode(['feed' => feed(['value' => ['recipients' => [['name' => 'Z', 'address' => 'z@x.com', 'split' => 97, 'type' => 'lnaddress']]]])]);
$r = call('PUT', "/me/feeds/$id", $bodyOther, $H + ['X-PFG-Auth' => base64_encode(json_encode(sign($skA, "$B/me/feeds/999", 'PUT', nonce(), $bodyOther)))]); ok(code($r) >= 400 && code($r) !== 200, 'signature for a different URL rejected');

// ---- another account cannot touch it
$n = nonce(); $rB = call('POST', '/auth/login', ['event' => sign($skB, "$B/auth/login", 'POST', $n)]); ok(code($rB) === 200, 'second account logs in');
$tokB = bin2hex(random_bytes(32)); $wpdb->query("UPDATE wp_pfg_sessions SET token_hash = '" . hash('sha256', $tokB) . "' WHERE account_id = 2"); $savedCookie = $_COOKIE['pfg_session']; $_COOKIE['pfg_session'] = $tokB;
$HB = ['X-PFG-CSRF' => data(call('GET', '/me'))['csrf']];
ok(code(call('GET', "/me/feeds/$id")) === 404, "other account cannot read someone else's feed (404)");
ok(code(call('PUT', "/me/feeds/$id", ['feed' => feed()], $HB)) === 404, "other account cannot edit someone else's feed");
ok(code(call('DELETE', "/me/feeds/$id", null, $HB)) === 404, "other account cannot delete someone else's feed");
$_COOKIE['pfg_session'] = $savedCookie;

// ---- delete
ok(code(call('DELETE', "/me/feeds/$id", null, $H)) === 428, 'delete without fresh signature -> 428');
ok(file_exists($path), 'file still present after refused delete');
$r = call('DELETE', "/me/feeds/$id", null, $H + ['X-PFG-Auth' => base64_encode(json_encode(sign($skA, $url, 'DELETE', nonce())))]); ok(code($r) === 200, 'delete with fresh signature');
ok(!file_exists($path) || strpos(file_get_contents($path), 'podcast:medium') === false, 'published file removed or neutralised');
ok(code(call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()], $H)) === 409, 'deleted slug cannot be re-registered');
ok(code(call('GET', "/me/feeds/$id")) === 404, 'deleted feed no longer readable');


// ---- payments optional
$nof = feed(); $nof['value']['recipients'] = [];
$wpdb->query("UPDATE wp_pfg_feeds SET status='deleted' WHERE slug='inj'");
$r2 = call('POST', '/me/feeds', ['slug' => 'no-pay', 'feed' => $nof], $H);
ok(code($r2) === 201, 'feed with no payment recipients is accepted (' . (is_wp_error($r2) ? $r2->message : '') . ')');
$npx = @file_get_contents($GLOBALS['__up'] . '/rssfeed/publishers/no-pay/no-pay.xml'); $dn = new DOMDocument();
ok($npx && $dn->loadXML($npx) && strpos($npx, 'podcast:value') === false, 'no-payments feed has no value block (and no platform recipient)');
$half = feed(); $half['value']['recipients'] = [['name' => 'A', 'address' => 'a@x.com', 'split' => 50, 'type' => 'lnaddress']];
ok(code(call('PUT', '/me/feeds/' . data($r2)['id'], ['feed' => $half], $H)) === 422, 'if recipients are given, totals are still enforced');

// ---- sites that saved the old single-recipient default get the three new defaults; deliberate customisations are kept
update_option(PFG_Settings::OPTION, ['platform_recipients' => [['name' => 'Podcastindex.org', 'address' => 'podcastindex@getalby.com', 'split' => 1, 'type' => 'lnaddress']]]);
ok(count(PFG_Settings::platform_recipients()) === 3 && PFG_Settings::platform_recipients()[0]['address'] === 'phafe@phafe.com', 'old saved single default (Podcastindex only) is upgraded to the three defaults');
update_option(PFG_Settings::OPTION, ['platform_recipients' => [['name' => 'Mine', 'address' => 'mine@x.com', 'split' => 2, 'type' => 'lnaddress']]]);
ok(count(PFG_Settings::platform_recipients()) === 1 && PFG_Settings::platform_recipients()[0]['address'] === 'mine@x.com', 'a customised list is left alone');
update_option(PFG_Settings::OPTION, []);

// ---- built-in roles shown in two groups (must match OTHER_RELS in pfg-core.js)
ok(PFG_Feed::other_rel_tokens() === ['author', 'host', 'hosting', 'network', 'sponsor'], 'Other roles: author, host, hosting, network, sponsor');
ok(PFG_Feed::main_rel_tokens() === ['artist', 'composer', 'engineer', 'label', 'musician', 'producer', 'songwriter', 'studio'], 'Roles: the rest, alphabetical');
ok(count(array_merge(PFG_Feed::main_rel_tokens(), PFG_Feed::other_rel_tokens())) === count(PFG_Feed::builtin_rel_tokens()), 'the two groups together are exactly the built-in roles');

// ---- "Support the developers": creator-chosen splits (name/address/type stay under the site's control)
$no = new ReflectionMethod('PFG_Rest', 'norm_opts'); $no->setAccessible(true);
$po = $no->invoke(null, 'sup-test', PFG_Feed::guid_for_url(PFG_Storage::feed_url('sup-test')));
$mk = function ($recip, $support = null) { $f = feed(['value' => ['recipients' => $recip]]); if (null !== $support) { $f['support'] = $support; } return $f; };
$rc = fn($sp) => [['name' => 'Acme', 'address' => 'acme@getalby.com', 'split' => $sp, 'type' => 'lnaddress']];
$res = PFG_Feed::normalize($mk($rc(97)), $po);
ok(!$res['errors'] && array_column($res['model']['support'], 'split') === [1, 1, 1] && array_column($res['model']['support'], 'address') === ['phafe@phafe.com', 'heycitizen@getalby.com', 'podcastindex@getalby.com'], 'no support rows sent: configured defaults (1, 1, 1) apply');
$res = PFG_Feed::normalize($mk($rc(94), [['address' => 'phafe@phafe.com', 'split' => 0], ['address' => 'HEYCITIZEN@getalby.com', 'split' => '5'], ['address' => 'podcastindex@getalby.com', 'split' => 1]]), $po);
ok(!$res['errors'] && array_column($res['model']['support'], 'split') === [0, 5, 1], 'creator splits applied (0, 5 as text, 1); address match is case-insensitive');
$ap = PFG_Feed::active_platform($po['platform'], $res['model']['support']);
ok(array_column($ap, 'address') === ['heycitizen@getalby.com', 'podcastindex@getalby.com'] && array_column($ap, 'split') === [5, 1] && $ap[0]['name'] === 'musicindex.org', 'a split of 0 leaves that recipient out; names come from the site settings');
$xml0 = PFG_Xml::build($res['model'], $ap, 1700000000); ok(strpos($xml0, 'phafe@phafe.com') === false && strpos($xml0, 'name="musicindex.org" address="heycitizen@getalby.com" split="5"') !== false && strpos($xml0, 'split="94"') !== false, 'XML has the creator split and omits the 0 recipient');
$res = PFG_Feed::normalize($mk($rc(97), [['address' => 'evil@x.com', 'split' => 50, 'name' => 'Evil', 'type' => 'node']]), $po);
ok(!$res['errors'] && array_column($res['model']['support'], 'address') === ['phafe@phafe.com', 'heycitizen@getalby.com', 'podcastindex@getalby.com'] && array_column($res['model']['support'], 'split') === [1, 1, 1] && strpos(json_encode($res['model']), 'evil@x.com') === false, 'an address the site did not configure is ignored (cannot add or change a payee)');
foreach ([100, -1, 'x', 1.5, '100', '', null, [1], true] as $bad) {
	$res = PFG_Feed::normalize($mk($rc(97), [['address' => 'phafe@phafe.com', 'split' => $bad]]), $po);
	ok(!empty($res['errors']) && in_array('support.0.split', array_column($res['errors'], 'path'), true), 'invalid support split refused: ' . json_encode($bad));
}
$po2 = $po; $po2['platform'] = [['name' => 'A', 'address' => 'a@x.com', 'split' => 60, 'type' => 'lnaddress'], ['name' => 'B', 'address' => 'b@x.com', 'split' => 60, 'type' => 'lnaddress']];
$nf2 = $mk($rc(97)); $nf2['value']['recipients'] = [];
$res = PFG_Feed::normalize($nf2, $po2); ok(in_array('support', array_column($res['errors'], 'path'), true), 'support splits totalling 100 or more are refused');
$nf = $mk($rc(97), [['address' => 'phafe@phafe.com', 'split' => 50]]); $nf['value']['recipients'] = [];
$res = PFG_Feed::normalize($nf, $po); $xn = PFG_Xml::build($res['model'], PFG_Feed::active_platform($po['platform'], $res['model']['support']), 1700000000);
ok(!$res['errors'] && strpos($xn, 'podcast:value') === false, 'no own recipients: no value block, whatever the support splits');
$fp = fn($m) => PFG_Feed::payment_fingerprint($m);
$a = PFG_Feed::normalize($mk($rc(97)), $po)['model']; $b = PFG_Feed::normalize($mk($rc(97)), $po)['model']; $c = PFG_Feed::normalize($mk($rc(96), [['address' => 'phafe@phafe.com', 'split' => 2]]), $po)['model'];
ok($fp($a) === $fp($b) && $fp($a) !== $fp($c), 'payment fingerprint changes when a support split changes');
$resE = PFG_Feed::normalize($mk($rc(97)), $po); $xE = PFG_Xml::build($resE['model'], [], 1700000000);
ok(strpos($xE, 'itunes:explicit') === false, 'PHP: a new feed has no itunes:explicit tag');
$fe = $mk($rc(97)); $fe['explicit'] = true; $resE2 = PFG_Feed::normalize($fe, $po);
ok(strpos(PFG_Xml::build($resE2['model'], [], 1700000000), '<itunes:explicit>true</itunes:explicit>') !== false, 'PHP: explicit true keeps the tag');

$res = PFG_Feed::normalize($mk($rc(50)), $po);
ok(in_array('Your recipients must total 97% - it currently totals 50%. (Support for the developers currently totals 3%.)', array_column($res['errors'], 'message'), true), 'PHP recipient total message wording matches the new text');


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

$_COOKIE['pfg_session'] = $savedCookie; $GLOBALS['__tr'] = [];
// ---- logout, config
ok(code(call('POST', '/auth/logout', null, $H)) === 200 && code(call('GET', '/me')) === 401, 'logout ends the session');
$cfg = PFG_Rest::client_config(); ok(json_encode($cfg) && $cfg['hostingAvailable'] === true && $cfg['urls']['feedTemplate'] === "$B/me/feeds/0" && count($cfg['platform']) === 3 && !array_key_exists('applyPlatformToExports', $cfg) && $cfg['platform'][0]['address'] === 'phafe@phafe.com' && $cfg['platform'][1]['address'] === 'heycitizen@getalby.com' && $cfg['platform'][2]['address'] === 'podcastindex@getalby.com', 'client config sane (three support recipients in order: Phafe, Music Index, Podcastindex)');
echo $fails ? "\n$fails FAILURES\n" : "\nintegration tests passed\n"; exit($fails ? 1 : 0);
