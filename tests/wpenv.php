<?php
// Minimal WordPress stand-in: enough for the plugin's PHP classes to run for real against SQLite.
ob_start();
define('ABSPATH', __DIR__ . '/'); define('HOUR_IN_SECONDS', 3600); define('DAY_IN_SECONDS', 86400); define('ARRAY_A', 'ARRAY_A');
define('MSPF_VERSION', 't'); define('MSPF_DIR', __DIR__ . '/../plugin/'); define('MSPF_URL', 'https://phafe.com/wp-content/plugins/msp-publisher-feeds/');
class WP_Error { public $code; public $message; public $data; function __construct($c='', $m='', $d=null){ $this->code=$c; $this->message=$m; $this->data=$d; } function get_error_message(){ return $this->message; } function get_error_code(){ return $this->code; } function get_error_data(){ return $this->data; } }
function is_wp_error($x){ return $x instanceof WP_Error; }
class WP_REST_Response { public $data; public $status = 200; function __construct($d){ $this->data = $d; } function set_status($s){ $this->status = $s; } function header(){} }
class WP_REST_Request implements ArrayAccess {
  public $method, $headers = [], $body, $route, $params = [];
  function __construct($m, $route, $body = null, $headers = []) { $this->method = $m; $this->route = $route; $this->body = $body === null ? '' : (is_string($body) ? $body : json_encode($body)); foreach ($headers as $k => $v) $this->headers[strtolower(str_replace('_', '-', $k))] = $v; if ($this->body !== '' && !isset($this->headers['content-type'])) $this->headers['content-type'] = 'application/json'; }
  function get_method(){ return $this->method; } function get_route(){ return $this->route; }
  function get_header($k){ $k = strtolower(str_replace('_', '-', $k)); return $this->headers[$k] ?? null; }
  function get_body(){ return $this->body; }
  function get_json_params(){ $j = json_decode($this->body, true); return is_array($j) ? $j : null; }
  function get_content_type(){ $c = $this->get_header('content-type'); return $c ? ['value' => strtolower(trim(explode(';', $c)[0]))] : null; }
  function offsetExists($o): bool { return isset($this->params[$o]); } function offsetGet($o): mixed { return $this->params[$o] ?? null; } function offsetSet($o, $v): void { $this->params[$o] = $v; } function offsetUnset($o): void {}
}
function rest_ensure_response($d){ return is_wp_error($d) ? $d : ($d instanceof WP_REST_Response ? $d : new WP_REST_Response($d)); }
function rest_url($p = ''){ return 'https://phafe.com/wp-json/' . ltrim($p, '/'); }
function wp_json_encode($d, $f = 0){ return json_encode($d, $f); }
function wp_parse_url($u, $c = -1){ return parse_url($u, $c); }
function trailingslashit($s){ return rtrim($s, '/\\') . '/'; }
function wp_normalize_path($p){ return preg_replace('|/+|', '/', str_replace('\\', '/', $p)); }
function wp_mkdir_p($d){ return is_dir($d) || mkdir($d, 0755, true); }
function is_ssl(){ return true; }
function get_bloginfo($k = ''){ return 'Phafe'; }
function add_action(){} function add_filter(){} function add_shortcode(){} function register_activation_hook(){}
$GLOBALS['__opts'] = []; $GLOBALS['__tr'] = [];
function get_option($k, $d = false){ return $GLOBALS['__opts'][$k] ?? $d; } function update_option($k, $v){ $GLOBALS['__opts'][$k] = $v; return true; } function delete_option($k){ unset($GLOBALS['__opts'][$k]); }
function get_transient($k){ return $GLOBALS['__tr'][$k] ?? false; } function set_transient($k, $v){ $GLOBALS['__tr'][$k] = $v; return true; }
$UP = sys_get_temp_dir() . '/mspf_uploads_' . getmypid(); @mkdir($UP, 0755, true); $GLOBALS['__up'] = $UP;
function wp_get_upload_dir(){ return ['basedir' => $GLOBALS['__up'], 'baseurl' => 'https://phafe.com/wp-content/uploads', 'path' => $GLOBALS['__up'], 'url' => 'https://phafe.com/wp-content/uploads', 'error' => false]; }
function wp_delete_file($f){ @unlink($f); }
function esc_attr($s){ return htmlspecialchars($s, ENT_QUOTES); } function esc_html($s){ return htmlspecialchars($s, ENT_QUOTES); } function esc_url($s){ return $s; } function __($s){ return $s; } function esc_html__($s){ return $s; }
// wpdb over sqlite
class FakeWpdb {
  public $prefix = 'wp_', $insert_id = 0; public $pdo;
  function __construct(){ $this->pdo = new PDO('sqlite::memory:'); $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    foreach ([
      'accounts' => 'id INTEGER PRIMARY KEY AUTOINCREMENT, pubkey TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT "active", created_at INT NOT NULL, last_login INT NOT NULL DEFAULT 0',
      'sessions' => 'id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT UNIQUE NOT NULL, csrf_hash TEXT NOT NULL, account_id INT NOT NULL, created_at INT NOT NULL, expires INT NOT NULL',
      'nonces' => 'nonce_hash TEXT PRIMARY KEY, expires INT NOT NULL',
      'feeds' => 'id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INT NOT NULL, slug TEXT UNIQUE NOT NULL, guid TEXT UNIQUE NOT NULL, title TEXT NOT NULL DEFAULT "", status TEXT NOT NULL DEFAULT "pending", data TEXT NOT NULL, created_at INT NOT NULL, updated_at INT NOT NULL',
    ] as $t => $cols) $this->pdo->exec("CREATE TABLE wp_mspf_$t ($cols)"); }
  function get_charset_collate(){ return ''; }
  function prepare($sql, ...$args){ if (count($args) === 1 && is_array($args[0])) $args = $args[0]; $i = 0; return preg_replace_callback('/%[sd]/', function($m) use (&$i, $args){ $v = $args[$i++]; return $m[0] === '%d' ? (string)(int)$v : $this->pdo->quote((string)$v); }, $sql); }
  function query($sql){ return $this->pdo->exec($sql); }
  function get_row($sql, $out = null){ $r = $this->pdo->query($sql)->fetch(PDO::FETCH_ASSOC); return $r ?: null; }
  function get_results($sql, $out = null){ return $this->pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC); }
  function get_var($sql){ $r = $this->pdo->query($sql)->fetch(PDO::FETCH_NUM); return $r ? $r[0] : null; }
  private function where($w){ return implode(' AND ', array_map(fn($k) => "$k = " . $this->pdo->quote((string)$w[$k]), array_keys($w))); }
  function insert($t, $d, $f = null){ try { $cols = implode(',', array_keys($d)); $vals = implode(',', array_map(fn($v) => $this->pdo->quote((string)$v), $d)); $this->pdo->exec("INSERT INTO $t ($cols) VALUES ($vals)"); $this->insert_id = (int)$this->pdo->lastInsertId(); return 1; } catch (PDOException $e) { return false; } }
  function update($t, $d, $w, $f = null, $wf = null){ $set = implode(',', array_map(fn($k) => "$k = " . $this->pdo->quote((string)$d[$k]), array_keys($d))); return $this->pdo->exec("UPDATE $t SET $set WHERE " . $this->where($w)); }
  function delete($t, $w, $f = null){ return $this->pdo->exec("DELETE FROM $t WHERE " . $this->where($w)); }
}
$wpdb = new FakeWpdb();
$GLOBALS['__http'] = null; $GLOBALS['__httplog'] = [];
function home_url(){ return 'https://phafe.com'; }
function __http($kind, $url, $a){ $GLOBALS['__httplog'][] = [$kind, $url, $a]; $f = $GLOBALS['__http']; return $f ? $f($url, $a) : new WP_Error('x', 'no http'); }
function wp_safe_remote_get($u, $a = []){ return __http('safe', $u, $a); } function wp_remote_get($u, $a = []){ return __http('plain', $u, $a); }
function wp_remote_retrieve_response_code($r){ return $r['code'] ?? 0; } function wp_remote_retrieve_body($r){ return $r['body'] ?? ''; }
foreach (['settings','installer','nostr','feed','xml','storage','auth','lookup','rest'] as $c) require MSPF_DIR . "includes/class-mspf-$c.php";
function mspf_hosting_available(){ return extension_loaded('gmp') && MSPF_Settings::get('hosting_enabled'); }
