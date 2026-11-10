<?php
require __DIR__ . '/stub.php';
foreach (['nostr','feed','xml'] as $f) require __DIR__ . "/../plugin/includes/class-mspf-$f.php";
$cases = json_decode(file_get_contents(__DIR__ . '/cases.json'), true);
$NOW = 1794000000; $out = [];
foreach ($cases as $c) {
  $o = $c['opts'];
  $r = MSPF_Feed::normalize($c['input'], [
    'hosted' => $o['hosted'], 'guid' => $o['guid'] ?? '', 'feed_url' => $o['feedUrl'] ?? '', 'platform' => $o['platform'],
    'max_releases' => $o['maxReleases'], 'default_method' => $o['defaultMethod'], 'allow_attrs' => $o['allowAttrs'],
  ]);
  $xml = $r['errors'] ? null : MSPF_Xml::build($r['model'], $o['platform'], $NOW);
  $out[] = ['name' => $c['name'], 'errors' => $r['errors'], 'xml' => $xml];
}
file_put_contents(__DIR__ . '/out_php.json', json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
