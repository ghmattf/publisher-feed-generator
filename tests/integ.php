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
  $id = null; if (preg_match('#^/me/feeds/(\d+)(/move)?$#', $route, $m)) { $id = $m[1]; $req['id'] = $id; }
  $perm = in_array($route, ['/auth/nonce', '/auth/login'], true) ? 'perm_hosting' : (strpos($route, '/lookup/') === 0 ? 'perm_lookup' : 'perm_session');
  $p = PFG_Rest::$perm($req); if (is_wp_error($p)) return $p;
  $map = ['POST /auth/nonce' => 'route_nonce', 'POST /auth/login' => 'route_login', 'POST /auth/logout' => 'route_logout', 'GET /me' => 'route_me', 'POST /lookup/feed' => 'route_lookup_feed', 'POST /lookup/search' => 'route_lookup_search', 'POST /lookup/guid' => 'route_lookup_guid', 'GET /me/feeds' => 'route_list', 'POST /me/feeds' => 'route_create', 'POST /me/upgrade' => 'route_upgrade'];
  $k = $method . ' ' . ($id ? '/me/feeds' : $route); 
  if ($id && substr($route, -5) === '/move') $h = 'route_move'; elseif ($id) $h = ['GET' => 'route_get', 'PUT' => 'route_update', 'DELETE' => 'route_delete'][$method]; else $h = $map[$k];
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
function feed($over = []){ return array_replace_recursive(['title' => 'Acme Records', 'author' => 'Acme', 'created' => 1000000000, 'description' => 'We make records.', 'link' => 'https://acme.example', 'language' => 'en', 'category' => 'Music', 'value' => ['method' => 'lnaddress', 'suggested' => '0.000033333', 'recipients' => [['name' => 'Acme', 'address' => 'acme@getalby.com', 'split' => 97, 'type' => 'lnaddress']]], 'releases' => [['feedGuid' => '07adf84f-c1fa-47a7-a121-0fb544e859bd', 'feedUrl' => 'https://phafe.com/x/some_songs.xml', 'medium' => 'music', 'title' => 'Some Songs', 'rel' => ['label', 'studio']]]], $over); }
ok(code(call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()])) === 403, 'create without CSRF header -> 403');
ok(code(call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()], ['X-PFG-CSRF' => str_repeat('a', 48)])) === 403, 'create with wrong CSRF -> 403');
ok(code(call('POST', '/me/feeds', 'slug=x', $H + ['Content-Type' => 'application/x-www-form-urlencoded'])) === 415, 'form-encoded body rejected (415)');
foreach (['../etc', 'ab', 'Acme Records', 'x/../y', str_repeat('a', 41)] as $bs) ok(code(call('POST', '/me/feeds', ['slug' => $bs, 'feed' => feed()], $H)) === 422, "bad/reserved slug refused: $bs");
$r = call('POST', '/me/feeds', ['slug' => 'acme-records', 'feed' => feed()], $H); ok(code($r) === 201, 'create hosted feed -> 201 (' . (is_wp_error($r) ? $r->message : '') . ')');
$f = data($r); $path = $GLOBALS['__up'] . '/wp-content/pubfeeds/acme-records/acme-records.xml';
ok(file_exists($path), 'XML written to wp-content/pubfeeds/acme-records/');
$xml = file_get_contents($path);
ok(strpos($xml, '<podcast:medium>publisher</podcast:medium>') !== false && strpos($xml, 'phafe@phafe.com') !== false && strpos($xml, 'heycitizen@getalby.com') !== false && strpos($xml, 'podcastindex@getalby.com') !== false && strpos($xml, 'split="97"') !== false && substr_count($xml, 'split="1"') === 3, 'file is a publisher feed with the user (97) and three support (1 each) recipients');
ok(strpos($xml, 'https://phafe.com/wp-content/pubfeeds/acme-records/acme-records.xml') !== false && strpos($xml, '<podcast:guid>' . PFG_Feed::guid_for_url('https://phafe.com/wp-content/pubfeeds/acme-records/acme-records.xml')) !== false, 'self URL and derived GUID in file');
$d = new DOMDocument(); ok($d->loadXML($xml), 'published XML is well-formed');
// the new feed address is only set by the Move action: an ordinary save ignores it
$nfu = feed(); $nfu['newFeedUrl'] = 'https://new.example.com/acme.xml';
$ru = call('PUT', '/me/feeds/' . $f['id'], ['feed' => $nfu], $H);
ok(code($ru) === 200 && strpos(@file_get_contents($path), 'new-feed-url') === false, 'an ordinary save ignores newFeedUrl (only the Move action sets it)');
// Move action
$murl = "$B/me/feeds/" . $f['id'] . '/move'; $mpath = '/me/feeds/' . $f['id'] . '/move';
$mb = json_encode(['newFeedUrl' => 'https://new.example.com/acme.xml']);
ok(code(call('POST', $mpath, $mb, $H)) === 428, 'move: needs a fresh signature (428)');
ok(strpos(@file_get_contents($path), 'new-feed-url') === false && (int) $wpdb->get_var("SELECT moved_at FROM wp_pfg_feeds WHERE id = " . (int) $f['id']) === 0, 'move: nothing changes without the signature');
$bad = json_encode(['newFeedUrl' => 'http://insecure.example.com/a.xml']);
ok(code(call('POST', $mpath, $bad, $H + ['X-PFG-Auth' => base64_encode(json_encode(sign($skA, $murl, 'POST', nonce(), $bad)))])) === 422, 'move: non-https address refused');
$same = json_encode(['newFeedUrl' => PFG_Storage::feed_url($f['slug'])]);
ok(code(call('POST', $mpath, $same, $H + ['X-PFG-Auth' => base64_encode(json_encode(sign($skA, $murl, 'POST', nonce(), $same)))])) === 422, 'move: the current address refused');
$t0 = time(); $rm = call('POST', $mpath, $mb, $H + ['X-PFG-Auth' => base64_encode(json_encode(sign($skA, $murl, 'POST', nonce(), $mb)))]);
ok(code($rm) === 200 && data($rm)['movedTo'] === 'https://new.example.com/acme.xml' && data($rm)['movedAt'] >= $t0, 'move: accepted with a fresh signature; response carries movedTo and movedAt');
ok(strpos(@file_get_contents($path), '<itunes:new-feed-url>https://new.example.com/acme.xml</itunes:new-feed-url>') !== false, 'move: the tag is written into the published file');
ok((int) $wpdb->get_var("SELECT moved_at FROM wp_pfg_feeds WHERE id = " . (int) $f['id']) >= $t0, 'move: the date moved is recorded');
$ru = call('PUT', '/me/feeds/' . $f['id'], ['feed' => feed()], $H);
ok(code($ru) === 200 && strpos(@file_get_contents($path), '<itunes:new-feed-url>https://new.example.com/acme.xml') !== false, 'move: later ordinary saves keep the tag');
$lst = data(call('GET', '/me/feeds')); $mine = array_values(array_filter($lst, fn($x) => $x['id'] == $f['id']))[0] ?? null;
ok($mine && $mine['movedTo'] === 'https://new.example.com/acme.xml' && $mine['movedAt'] >= $t0, 'move: the feed list shows where it moved and when');
// ready to delete: only after KeepMoved days
ok(PFG_Settings::get('keep_moved_days') === 28 && count(PFG_Storage::moved_ready_to_delete()) === 0, 'KeepMoved defaults to 28 days; a feed moved just now is not ready to delete');
$wpdb->query("UPDATE wp_pfg_feeds SET moved_at = " . (time() - 27 * 86400) . " WHERE id = " . (int) $f['id']);
ok(count(PFG_Storage::moved_ready_to_delete()) === 0, 'moved 27 days ago: not ready to delete yet');
$wpdb->query("UPDATE wp_pfg_feeds SET moved_at = " . (time() - 29 * 86400) . " WHERE id = " . (int) $f['id']);
$rdy = PFG_Storage::moved_ready_to_delete(); ok(count($rdy) === 1 && (int) $rdy[0]['id'] === (int) $f['id'], 'moved 29 days ago: ready to delete');
update_option('pfg_settings', array_merge((array) get_option('pfg_settings', []), ['keep_moved_days' => 60])); ok(count(PFG_Storage::moved_ready_to_delete()) === 0, 'raising KeepMoved to 60 days: no longer ready');
ok(PFG_Settings::sanitize(['keep_moved_days' => '0'])['keep_moved_days'] === 1 && PFG_Settings::sanitize(['keep_moved_days' => 'abc'])['keep_moved_days'] === 1 && PFG_Settings::sanitize(['keep_moved_days' => '14'])['keep_moved_days'] === 14, 'KeepMoved setting is a whole number of at least 1');
update_option('pfg_settings', array_merge((array) get_option('pfg_settings', []), ['keep_moved_days' => 28])); $wpdb->query("UPDATE wp_pfg_feeds SET moved_at = 0 WHERE id = " . (int) $f['id']);
$nfu = feed();
$nfu['persons'] = [['name' => 'Matt Finlay', 'role' => 'content manager', 'group' => 'administration', 'href' => 'https://phafe.com/mattfinlay']];
$nfu['newFeedUrl'] = ''; $nfu['persons'] = [['name' => 'Matt Finlay', 'role' => 'content manager', 'group' => 'administration', 'href' => 'https://phafe.com/mattfinlay']];
$rp = call('PUT', '/me/feeds/' . $f['id'], ['feed' => $nfu], $H); $px = (string) @file_get_contents($path);
ok(strpos($px, '<podcast:person href="https://phafe.com/mattfinlay" group="administration" role="content manager">Matt Finlay</podcast:person>') !== false && strpos($px, '<podcast:block>no</podcast:block>') !== false && strpos($px, '<category>Music</category>') !== false && strpos($px, '<podcast:complete>no</podcast:complete>') !== false, 'hosted file has the person and the fixed block / category / complete tags');

ok(PFG_Storage::available_slug('acme-records') === 'acme-records1', 'a name already used gets the next free one (acme-records1) instead of an error');
$r = call('POST', '/me/feeds', ['slug' => 'bad-split', 'feed' => feed(['value' => ['recipients' => [['split' => 50]]]])], $H); ok(code($r) === 422 && !empty($r->data['errors']), 'splits not totalling 97 -> 422 with errors');
ok(!file_exists($GLOBALS['__up'] . '/wp-content/pubfeeds/bad-split'), 'nothing written for an invalid feed');
$r = call('POST', '/me/feeds', ['slug' => 'inj', 'feed' => feed(['title' => "<script>x</script> & \"q\"", 'releases' => [['feedGuid' => '07adf84f-c1fa-47a7-a121-0fb544e859bd', 'feedUrl' => 'https://x.example/a.xml', 'rel' => ['label'], 'attrs' => ['onload' => 'evil']]]])], $H);
$ix = @file_get_contents($GLOBALS['__up'] . '/wp-content/pubfeeds/inj/inj.xml'); $dd = new DOMDocument(); ok($ix && $dd->loadXML($ix) && strpos($ix, '<script>') === false && strpos($ix, 'onload') === false, 'markup in title escaped and unknown attributes dropped in hosted output');
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
$rowC = PFG_Storage::get_feed($id); $pdC = gmdate('D, d M Y H:i:s', (int) $rowC['created_at']) . ' GMT'; $fileC = file_get_contents($path);
ok(strpos($fileC, "<pubDate>$pdC</pubDate>") !== false && strpos($fileC, '2001') === false, 'hosted feed pubDate is the server creation date (a date sent by the browser is ignored) and stays after updates');
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
ok(PFG_Storage::available_slug('acme-records') === 'acme-records1' && !PFG_Storage::slug_is_free('acme-records'), 'deleted slug cannot be re-registered (the next free name is offered instead)');
ok(code(call('GET', "/me/feeds/$id")) === 404, 'deleted feed no longer readable');


// ---- existing feeds are never moved
$GLOBALS['__opts']['pfg_db_version'] = '1';
$GLOBALS['__opts'][PFG_Settings::OPTION] = ['feed_subdir' => 'rssfeed/publishers'];
$wpdb->query("UPDATE wp_pfg_feeds SET status='deleted' WHERE slug='mig-feed'");
$mg = data(call('POST', '/me/feeds', ['slug' => 'mig-feed', 'feed' => feed()], $H));
PFG_Storage::record_legacy_feeds(); // what the v1 to v2 upgrade runs
$lu = PFG_Storage::feed_url('mig-feed');
ok($lu === 'https://phafe.com/wp-content/uploads/rssfeed/publishers/mig-feed/mig-feed.xml', 'a feed that already existed keeps its uploads URL after the upgrade: ' . $lu);
ok(strpos(PFG_Storage::feed_path('mig-feed')['file'], '/rssfeed/publishers/mig-feed/') !== false, 'and its uploads file path');
ok(PFG_Storage::feed_url('brand-new') === 'https://phafe.com/wp-content/pubfeeds/brand-new/brand-new.xml', 'a feed created after the upgrade uses /wp-content/pubfeeds/');
@unlink($GLOBALS['__up'] . '/wp-content/pubfeeds/mig-feed/mig-feed.xml');
$mgf = $wpdb->get_row("SELECT * FROM wp_pfg_feeds WHERE slug='mig-feed'", ARRAY_A);
ok(!is_wp_error(PFG_Storage::publish($mgf, PFG_Storage::decode_model($mgf))) && file_exists($GLOBALS['__up'] . '/rssfeed/publishers/mig-feed/mig-feed.xml') && !file_exists($GLOBALS['__up'] . '/wp-content/pubfeeds/mig-feed/mig-feed.xml'), 'editing an existing feed rewrites it in place, not in pubfeeds');
$wpdb->query("UPDATE wp_pfg_feeds SET status='deleted' WHERE slug='mig-feed'");

// ---- adopting a feed that already exists on the server
@mkdir($GLOBALS['__up'] . '/rssfeed/music/old_pub', 0777, true);
$oldx = '<?xml version="1.0"?><rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:foo="urn:foo" version="2.0"><channel><title>Old Pub</title><podcast:guid>6b8a1c1e-5d0e-5a77-9f40-0e0b1f3f9a11</podcast:guid><podcast:medium>publisher</podcast:medium><foo:thing>x</foo:thing></channel></rss>';
file_put_contents($GLOBALS['__up'] . '/rssfeed/music/old_pub/old_pub.xml', $oldx);
$ad = PFG_Storage::adopt_from_url('https://phafe.com/wp-content/uploads/rssfeed/music/old_pub/old_pub.xml', 1);
ok(is_int($ad) || ctype_digit((string) $ad), 'adopt: an existing publisher feed file is taken over');
ok(PFG_Storage::feed_url('old_pub') === 'https://phafe.com/wp-content/uploads/rssfeed/music/old_pub/old_pub.xml', 'adopt: it keeps its own URL (other folder than the default)');
ok($wpdb->get_row("SELECT guid FROM wp_pfg_feeds WHERE slug='old_pub'", ARRAY_A)['guid'] === '6b8a1c1e-5d0e-5a77-9f40-0e0b1f3f9a11', 'adopt: it keeps its GUID');
ok(file_get_contents($GLOBALS['__up'] . '/rssfeed/music/old_pub/old_pub.xml') === $oldx, 'adopt: the file is not changed by adopting');
$gr = data(call('GET', '/me/feeds/' . $ad, [], $H));
ok(isset($gr['importXml']) && strpos($gr['importXml'], 'Old Pub') !== false, 'adopt: the owner gets the existing file to fill the editor');
ok(is_wp_error(PFG_Storage::adopt_from_url('https://phafe.com/wp-content/uploads/rssfeed/music/old_pub/old_pub.xml', 1)), 'adopt: the same feed cannot be adopted twice');
ok(is_wp_error(PFG_Storage::adopt_from_url('https://evil.example/wp-content/uploads/rssfeed/music/old_pub/old_pub.xml', 1)), 'adopt: a URL on another site is refused');
ok(is_wp_error(PFG_Storage::adopt_from_url('https://phafe.com/wp-content/uploads/rssfeed/music/../../../etc/x/x.xml', 1)), 'adopt: path tricks are refused');
@mkdir($GLOBALS['__up'] . '/rssfeed/music/not_pub', 0777, true);
file_put_contents($GLOBALS['__up'] . '/rssfeed/music/not_pub/not_pub.xml', str_replace('publisher', 'music', $oldx));
ok(is_wp_error(PFG_Storage::adopt_from_url('https://phafe.com/wp-content/uploads/rssfeed/music/not_pub/not_pub.xml', 1)), 'adopt: a feed that is not a publisher feed is refused');
$wpdb->query("UPDATE wp_pfg_feeds SET status='deleted' WHERE slug='old_pub'");

// ---- payments optional
$nof = feed(); $nof['value']['recipients'] = [];
$wpdb->query("UPDATE wp_pfg_feeds SET status='deleted' WHERE slug='inj'");
$r2 = call('POST', '/me/feeds', ['slug' => 'no-pay', 'feed' => $nof], $H);
ok(code($r2) === 201, 'feed with no payment recipients is accepted (' . (is_wp_error($r2) ? $r2->message : '') . ')');
$npx = @file_get_contents($GLOBALS['__up'] . '/wp-content/pubfeeds/no-pay/no-pay.xml'); $dn = new DOMDocument();
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
$fc = $mk($rc(97)); $fc['created'] = 1700000000; $rcx = PFG_Feed::normalize($fc, $po);
ok(strpos(PFG_Xml::build($rcx['model'], [], 1794000000), '<pubDate>Tue, 14 Nov 2023 22:13:20 GMT</pubDate>') !== false, 'PHP: pubDate is the creation date');
$fa = $mk($rc(97)); $fa['author'] = 'Someone Else'; $fa['title'] = 'Acme & Co'; $ra = PFG_Feed::normalize($fa, $po); $xa = PFG_Xml::build($ra['model'], [], 1700000000);
ok(strpos($xa, '<itunes:author>Acme &amp; Co</itunes:author>') !== false && strpos($xa, 'Someone Else') === false, 'PHP: itunes:author is made from Name / title');

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
foreach (['', 'nope', '../x', "11111111-2222-4333-8444-55555555555g"] as $badg) { $GLOBALS['__httplog'] = []; ok(code(call('POST', '/lookup/guid', ['guid' => $badg])) === 400 && !$GLOBALS['__httplog'], 'bad credit GUID refused without a lookup: ' . var_export($badg, true)); }
$GLOBALS['__http'] = fn($u, $a) => ['code' => 200, 'body' => json_encode(['data' => ['title' => 'Night Songs', 'release_artist' => 'Mia', 'image_url' => 'https://x.test/a.jpg', 'medium' => 'music']])];
$rg = call('POST', '/lookup/guid', ['guid' => '11111111-2222-4333-8444-555555555555']);
ok(code($rg) === 200 && (data($rg)['feed']['title'] ?? '') === 'Night Songs' && (data($rg)['feed']['artist'] ?? '') === 'Mia', 'credit GUID: title and artist come from Music Index');
$GLOBALS['__http'] = fn($u, $a) => ['code' => 404, 'body' => ''];
ok(code(call('POST', '/lookup/guid', ['guid' => '99999999-2222-4333-8444-555555555555'])) === 404, 'credit GUID: unknown feed gives 404');
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
// ---- browser-key accounts: payments locked server-side
$skC = bin2hex(random_bytes(32)); $nC = nonce();
$rC = call('POST', '/auth/login', ['event' => sign($skC, "$B/auth/login", 'POST', $nC), 'browserKey' => true]);
ok(code($rC) === 200 && data($rC)['kind'] === 'browser', 'browser-key login: session reports kind=browser');
$tokC = bin2hex(random_bytes(32)); $accC = $wpdb->get_row("SELECT id FROM wp_pfg_accounts WHERE kind = 'browser'", ARRAY_A);
$wpdb->query("UPDATE wp_pfg_sessions SET token_hash = '" . hash('sha256', $tokC) . "' WHERE account_id = " . (int) $accC['id']); $_COOKIE['pfg_session'] = $tokC;
$HC = ['X-PFG-CSRF' => data(call('GET', '/me'))['csrf']];
$noPay = feed(['value' => ['recipients' => []]]); $noPay['value']['recipients'] = [];
ok(code(call('POST', '/me/feeds', ['slug' => 'locked-pay', 'feed' => feed()], $HC)) === 403, 'browser account: feed with payment recipients refused (403)');
$withFund = $noPay; $withFund['funding'] = ['url' => 'https://acme.example/support', 'text' => 'Support'];
ok(code(call('POST', '/me/feeds', ['slug' => 'locked-fund', 'feed' => $withFund], $HC)) === 403, 'browser account: funding link refused (403)');
$rc = call('POST', '/me/feeds', ['slug' => 'no-money', 'feed' => $noPay], $HC); ok(code($rc) === 201, 'browser account: feed without payments is created');
ok(code(call('PUT', '/me/feeds/' . data($rc)['id'], ['feed' => feed()], $HC)) === 403, 'browser account: adding payments on update refused (403)');
// the lock is decided by the account flag set at creation: a later login without the flag does not unlock it
$nC = nonce(); call('POST', '/auth/login', ['event' => sign($skC, "$B/auth/login", 'POST', $nC)]);
ok($wpdb->get_var("SELECT kind FROM wp_pfg_accounts WHERE id = " . (int) $accC['id']) === 'browser', 'logging in again without the browser flag does not unlock the account');
// ---- upgrade a browser-key account to a signer (two-key move)
$UP = "$B/me/upgrade";
function upgrade_call($skOld, $skNew, $newPub, $H, $nOld = null, $nNew = null){
  global $UP; $body = json_encode(['newPubkey' => $newPub]);
  $h = $H;
  if ($skOld) $h['X-PFG-Auth'] = base64_encode(json_encode(sign($skOld, $UP, 'POST', $nOld ?: nonce(), $body)));
  if ($skNew) $h['X-PFG-Auth-New'] = base64_encode(json_encode(sign($skNew, $UP, 'POST', $nNew ?: nonce(), $body)));
  return call('POST', '/me/upgrade', $body, $h);
}
function pubof($sk){ return trim(shell_exec("node -e \"const {getPublicKey}=require('" . __DIR__ . "/../build/node_modules/nostr-tools/lib/cjs/pure.js');const {hexToBytes}=require('" . __DIR__ . "/../build/node_modules/@noble/hashes/utils.js');console.log(getPublicKey(hexToBytes('$sk')))\"")); }
$skN = bin2hex(random_bytes(32)); $pubN = pubof($skN); $pubC = pubof($skC);
ok(code(upgrade_call($skC, null, $pubN, $HC)) === 428 && code(upgrade_call(null, $skN, $pubN, $HC)) === 428, 'upgrade needs both signatures (428 when either is missing)');
ok(code(upgrade_call($skC, $skC, $pubC, $HC)) === 422, 'upgrading to the same key refused');
$skX = bin2hex(random_bytes(32));
ok(code(upgrade_call($skC, $skX, $pubN, $HC)) === 403, 'new-key signature from a different key than the one named: refused');
ok(code(upgrade_call($skX, $skN, $pubN, $HC)) === 403, 'old-key signature from a key that is not the session key: refused');
$same = nonce(); ok(code(upgrade_call($skC, $skN, $pubN, $HC, $same, $same)) >= 400, 'both keys sharing one nonce refused');
$me = data(call('GET', '/me')); $HC = ['X-PFG-CSRF' => $me['csrf']]; ok($me['pubkey'] === $pubC, 'failed attempts changed nothing');
ok(code(upgrade_call($skC, $skA, $pubA, $HC)) === 409, 'new key that already has an account with feeds: refused');
// a throwaway empty account for the new key is replaced, not blocking
$nE = nonce(); call('POST', '/auth/login', ['event' => sign($skN, "$B/auth/login", 'POST', $nE)]); $_COOKIE['pfg_session'] = $tokC;
ok((int) $wpdb->get_var("SELECT COUNT(*) FROM wp_pfg_accounts WHERE pubkey = '$pubN'") === 1, 'precondition: the new key already has an empty account');
$HC = ['X-PFG-CSRF' => data(call('GET', '/me'))['csrf']];
$oldN = nonce(); $newN = nonce(); $ru = upgrade_call($skC, $skN, $pubN, $HC, $oldN, $newN);
ok(code($ru) === 200 && data($ru)['kind'] === 'signer' && data($ru)['pubkey'] === $pubN, 'two-key move accepted: account is now a signer account on the new key');
ok(count(data($ru)['feeds']) === 1 && data($ru)['feeds'][0]['slug'] === 'no-money', 'feeds stay with the account (same slug, GUID and URL)');
ok((int) $wpdb->get_var("SELECT COUNT(*) FROM wp_pfg_accounts WHERE pubkey = '$pubN'") === 1 && (int) $wpdb->get_var("SELECT COUNT(*) FROM wp_pfg_accounts WHERE pubkey = '$pubC'") === 0, 'one account per key after the move (the old key has none)');
$HC = ['X-PFG-CSRF' => data(call('GET', '/me'))['csrf']];
ok(code(call('POST', '/me/feeds', ['slug' => 'now-paid', 'feed' => feed()], $HC)) === 201, 'payments unlocked after the upgrade');
// feed names: reserved or used names are bumped to the next free one, checking the real folder as well as the list
$rs = call('POST', '/me/feeds', ['slug' => 'admin', 'feed' => feed()], $HC);
ok(code($rs) === 201 && data($rs)['slug'] === 'admin1' && file_exists($GLOBALS['__up'] . '/wp-content/pubfeeds/admin1/admin1.xml'), 'reserved name "admin" is silently saved as admin1 (the response carries the name used)');
ok(PFG_Storage::available_slug('test') === 'test1', 'reserved name test becomes test1');
mkdir($GLOBALS['__up'] . '/wp-content/pubfeeds/diskonly', 0755, true); mkdir($GLOBALS['__up'] . '/wp-content/pubfeeds/diskonly1', 0755, true); file_put_contents($GLOBALS['__up'] . '/wp-content/pubfeeds/diskonly2.xml', 'x');
ok(PFG_Storage::slug_is_free('diskonly') === false && PFG_Storage::available_slug('diskonly') === 'diskonly3', 'a folder or file that exists on disk (but not in the database) is skipped: diskonly, diskonly1, diskonly2 taken, diskonly3 used');
$long = str_repeat('a', 40); $av = PFG_Storage::available_slug($long); ok($av === $long, 'a free 40-character name is kept'); mkdir($GLOBALS['__up'] . '/wp-content/pubfeeds/' . $long, 0755, true);
$av = PFG_Storage::available_slug($long); ok($av === str_repeat('a', 39) . '1' && strlen($av) === 40, 'a 40-character name that is taken stays within 40 characters when numbered');
ok(PFG_Storage::available_slug('ab') === '' && PFG_Storage::available_slug('Bad Name') === '', 'malformed names are not "fixed" by numbering');
ok(code(upgrade_call($skN, $skA, $pubA, $HC)) === 409, 'a signer account cannot be "upgraded" again');
ok(code(call('POST', '/auth/login', ['event' => sign($skC, "$B/auth/login", 'POST', nonce()), 'browserKey' => true])) === 200 && $wpdb->get_var("SELECT kind FROM wp_pfg_accounts WHERE pubkey = '$pubC'") === 'browser', 'the old key signing in again gets a fresh empty browser account, not the moved one');
// ---- admin: move a feed to another account (domain-control check)
$mvId = (int) data($rc)['id']; $skZ = bin2hex(random_bytes(32)); $pubZ = pubof($skZ); $npubZ = PFG_Nostr::npub_encode($pubZ);
$ownerOf = fn($id) => (string) $wpdb->get_var("SELECT a.pubkey FROM wp_pfg_feeds f JOIN wp_pfg_accounts a ON a.id = f.account_id WHERE f.id = " . (int) $id);
$GLOBALS['__httplog'] = []; $GLOBALS['__http'] = fn($u, $a) => ['code' => 404, 'body' => ''];
$r1 = PFG_Storage::move_feed($mvId, $npubZ); ok(is_wp_error($r1) && strpos($r1->get_error_message(), 'not shown control') === false ? true : is_wp_error($r1), 'move: refused when the website shows nothing');
ok(is_wp_error($r1) && strpos($r1->get_error_message(), $npubZ) !== false && strpos($r1->get_error_message(), '/.well-known/nostr.json') !== false, 'move: the refusal tells the new owner what to publish');
ok($ownerOf($mvId) === $pubN, 'move: the feed stays with its owner after a refusal');
ok(array_reduce($GLOBALS['__httplog'], fn($c, $l) => $c && $l[0] === 'safe' && strpos($l[1], 'https://acme.example') === 0, true) && count($GLOBALS['__httplog']) === 2, 'move: only the feed\'s own https website is contacted, through the safe HTTP function (nostr.json and the page)');
$GLOBALS['__http'] = fn($u, $a) => strpos($u, 'nostr.json') ? ['code' => 200, 'body' => json_encode(['names' => ['someone' => ($pubZ[0] === 'a' ? 'b' : 'a') . substr($pubZ, 1)]])] : ['code' => 200, 'body' => '<html>no key here</html>'];
ok(is_wp_error(PFG_Storage::move_feed($mvId, $npubZ)), 'move: a nostr.json that lists a different key does not pass');
$GLOBALS['__http'] = fn($u, $a) => strpos($u, 'nostr.json') ? ['code' => 200, 'body' => json_encode(['names' => ['_' => $pubZ]])] : ['code' => 404, 'body' => ''];
$GLOBALS['__tr'] = []; $mv = PFG_Storage::move_feed($mvId, $npubZ);
ok(!is_wp_error($mv) && $ownerOf($mvId) === $pubZ && strpos($mv['how'], 'nostr.json') !== false, 'move: NIP-05 listing on the feed\'s domain proves control; the feed moves');
ok(file_exists($GLOBALS['__up'] . '/wp-content/pubfeeds/no-money/no-money.xml') && (int) $wpdb->get_var("SELECT COUNT(*) FROM wp_pfg_feeds WHERE id = $mvId") === 1, 'move: file and feed record unchanged (same address, same GUID)');
// the page itself shows the npub (second proof)
$GLOBALS['__http'] = fn($u, $a) => strpos($u, 'nostr.json') ? ['code' => 404, 'body' => ''] : ['code' => 200, 'body' => '<a href="https://njump.me/' . PFG_Nostr::npub_encode($pubN) . '">me</a>'];
$mv2 = PFG_Storage::move_feed($mvId, $pubN); ok(!is_wp_error($mv2) && $ownerOf($mvId) === $pubN, 'move: npub shown on the website also proves control (moved back, key given as hex)'. ' ' . (is_wp_error($mv2) ? $mv2->get_error_message() : ''));
$GLOBALS['__http'] = fn($u, $a) => ['code' => 404, 'body' => ''];
$mv3 = PFG_Storage::move_feed($mvId, $npubZ, true); ok(!is_wp_error($mv3) && $ownerOf($mvId) === $pubZ, 'move: the administrator can skip the check explicitly');
ok(is_wp_error(PFG_Storage::move_feed($mvId, $npubZ, true)), 'move: moving to the current owner is refused');
ok(is_wp_error(PFG_Storage::move_feed($mvId, 'npub1notvalid', true)) && is_wp_error(PFG_Storage::move_feed(999999, $npubZ, true)), 'move: bad key or unknown feed refused');
$accZ = PFG_Storage::get_account_by_pubkey($pubZ); PFG_Storage::set_account_status((int) $accZ['id'], 'blocked');
ok(is_wp_error(PFG_Storage::move_feed((int) $f['id'], $npubZ, true)), 'move: a blocked account cannot be given a feed'); PFG_Storage::set_account_status((int) $accZ['id'], 'active');
$GLOBALS['__http'] = null; $GLOBALS['__httplog'] = [];
// ---- suspend keeps the file (recoverable); delete is final
$sf = PFG_Storage::get_feed($mvId); $pubFile = $GLOBALS['__up'] . '/wp-content/pubfeeds/' . $sf['slug'] . '/' . $sf['slug'] . '.xml'; $before = file_get_contents($pubFile);
PFG_Storage::suspend_feed($sf);
$qd = $GLOBALS['__up'] . '/wp-content/pubfeeds-suspended'; $qfiles = glob($qd . '/' . $sf['slug'] . '-*.xml');
ok(!file_exists($pubFile) && PFG_Storage::get_feed($mvId)['status'] === 'suspended', 'suspend: the public file is gone and the feed is suspended');
ok(count($qfiles) === 1 && file_get_contents($qfiles[0]) === $before, 'suspend: the file was moved (kept byte for byte), not deleted');
ok(file_exists($qd . '/.htaccess') && file_exists($qd . '/index.html') && preg_match('/-[0-9a-f]{16}\.xml$/', $qfiles[0]), 'suspended files are in a closed folder with a name that cannot be guessed');
ok(PFG_Storage::unsuspend_feed(PFG_Storage::get_feed($mvId)) === true && file_get_contents($pubFile) === $before && PFG_Storage::get_feed($mvId)['status'] === 'published' && !glob($qd . '/' . $sf['slug'] . '-*.xml'), 'unsuspend: the same file is put back and the kept copy is cleared');
PFG_Storage::suspend_feed(PFG_Storage::get_feed($mvId)); array_map('unlink', glob($qd . '/' . $sf['slug'] . '-*.xml'));
ok(PFG_Storage::unsuspend_feed(PFG_Storage::get_feed($mvId)) === true && file_exists($pubFile) && strpos(file_get_contents($pubFile), '<rss') !== false, 'unsuspend with no kept file: rebuilt from the saved settings');
PFG_Storage::suspend_feed(PFG_Storage::get_feed($mvId)); PFG_Storage::tombstone_feed(PFG_Storage::get_feed($mvId));
ok(!glob($qd . '/' . $sf['slug'] . '-*.xml') && !file_exists($pubFile), 'delete is final: the kept copy is removed too');
$_COOKIE['pfg_session'] = $savedCookie;
// ---- logout, config
ok(code(call('POST', '/auth/logout', null, $H)) === 200 && code(call('GET', '/me')) === 401, 'logout ends the session');
$cfg = PFG_Rest::client_config(); ok(json_encode($cfg) && $cfg['hostingAvailable'] === true && $cfg['urls']['feedTemplate'] === "$B/me/feeds/0" && count($cfg['platform']) === 3 && !array_key_exists('applyPlatformToExports', $cfg) && $cfg['platform'][0]['address'] === 'phafe@phafe.com' && $cfg['platform'][1]['address'] === 'heycitizen@getalby.com' && $cfg['platform'][2]['address'] === 'podcastindex@getalby.com', 'client config sane (three support recipients in order: Phafe, Music Index, Podcastindex)');
echo $fails ? "\n$fails FAILURES\n" : "\nintegration tests passed\n"; exit($fails ? 1 : 0);
