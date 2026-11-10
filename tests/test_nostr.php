<?php
require __DIR__ . '/stub.php';
require __DIR__ . '/../plugin/includes/class-mspf-nostr.php';
$v = json_decode(file_get_contents(__DIR__ . '/vectors.json'), true);
$fail = 0; $n = 0;
foreach ($v['npubs'] as $r) {
  $n++;
  if (MSPF_Nostr::npub_encode($r['hex']) !== $r['npub']) { echo "npub_encode mismatch {$r['hex']}\n"; $fail++; }
  if (MSPF_Nostr::npub_decode($r['npub']) !== $r['hex']) { echo "npub_decode mismatch {$r['npub']}\n"; $fail++; }
  $bad = $r['npub']; $bad[10] = ($bad[10] === 'q') ? 'p' : 'q';
  if (MSPF_Nostr::npub_decode($bad) !== false) { echo "bad checksum accepted\n"; $fail++; }
}
foreach ($v['bip340'] as $b) { $n++; if (MSPF_Nostr::schnorr_verify($b['pk'], $b['msg'], $b['sig']) !== $b['ok']) { echo "BIP340 vector 0 failed\n"; $fail++; } }
$t0 = microtime(true);
foreach ($v['events'] as $i => $e) {
  $n++;
  $res = MSPF_Nostr::verify_event($e['event']);
  $ok = !is_wp_error($res);
  if ($ok !== $e['valid']) { echo "event #$i expected " . ($e['valid']?'valid':'invalid') . " got " . ($ok?'valid':'invalid') . " (" . ($e['why'] ?? 'good') . ")\n"; $fail++; }
}
printf("%d checks, %d failures, %.0f ms per event verification\n", $n, $fail, (microtime(true)-$t0)*1000/count($v['events']));
exit($fail ? 1 : 0);
