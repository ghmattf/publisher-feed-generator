<?php
define('ABSPATH', __DIR__ . '/');
class WP_Error { public $code; public $message; public $data; function __construct($c='', $m='', $d=null){ $this->code=$c; $this->message=$m; $this->data=$d; } function get_error_message(){ return $this->message; } }
function is_wp_error($x){ return $x instanceof WP_Error; }
function wp_json_encode($d, $f = 0){ return json_encode($d, $f); }
function wp_parse_url($u){ return parse_url($u); }
