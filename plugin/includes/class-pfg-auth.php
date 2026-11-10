<?php
/**
 * Authentication for hosted feeds: single-use nonces, Nostr (NIP-98) login,
 * cookie sessions with a CSRF token, and simple rate limiting.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Auth {

	const COOKIE    = 'pfg_session';
	const NONCE_TTL = 120;

	/** @var array|null Session loaded for the current request. */
	public static $session = null;

	/* ------------------------------------------------------------------ */
	/* Helpers                                                             */
	/* ------------------------------------------------------------------ */

	public static function client_ip() {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : '';
		if ( PFG_Settings::get( 'trust_cf_ip' ) && ! empty( $_SERVER['HTTP_CF_CONNECTING_IP'] ) ) {
			$ip = (string) $_SERVER['HTTP_CF_CONNECTING_IP'];
		}
		return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '0.0.0.0';
	}

	/**
	 * Fixed-window rate limit. Returns true when allowed, a WP_Error when not.
	 */
	public static function rate_limit( $bucket, $max, $window, $who = null ) {
		$who  = null === $who ? self::client_ip() : $who;
		$key  = 'pfg_rl_' . substr( hash( 'sha256', $bucket . '|' . $who ), 0, 32 );
		$hits = (int) get_transient( $key );
		if ( $hits >= $max ) {
			return new WP_Error( 'pfg_rate', 'Too many requests. Please wait a moment and try again.', array( 'status' => 429 ) );
		}
		set_transient( $key, $hits + 1, $window );
		return true;
	}

	/* ------------------------------------------------------------------ */
	/* Nonces                                                              */
	/* ------------------------------------------------------------------ */

	public static function issue_nonce() {
		global $wpdb;
		$t   = PFG_Installer::table( 'nonces' );
		$now = time();
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$t} WHERE expires < %d", $now ) ); // phpcs:ignore
		$nonce = bin2hex( random_bytes( 16 ) );
		$wpdb->insert(
			$t,
			array(
				'nonce_hash' => hash( 'sha256', $nonce ),
				'expires'    => $now + self::NONCE_TTL,
			),
			array( '%s', '%d' )
		);
		return array(
			'nonce'   => $nonce,
			'expires' => $now + self::NONCE_TTL,
		);
	}

	/**
	 * Atomically consume a nonce (deleting the row is the proof it was unused).
	 */
	public static function consume_nonce( $nonce ) {
		global $wpdb;
		$t    = PFG_Installer::table( 'nonces' );
		$rows = $wpdb->query( $wpdb->prepare( "DELETE FROM {$t} WHERE nonce_hash = %s AND expires >= %d", hash( 'sha256', $nonce ), time() ) ); // phpcs:ignore
		return 1 === (int) $rows;
	}

	/* ------------------------------------------------------------------ */
	/* Login / sessions                                                    */
	/* ------------------------------------------------------------------ */

	/**
	 * Complete a login from a signed NIP-98 event.
	 *
	 * @return array|WP_Error array( account, csrf, expires, token )
	 */
	public static function login( $event, $login_url ) {
		$v = PFG_Nostr::validate_http_auth( $event, $login_url, 'POST', null );
		if ( is_wp_error( $v ) ) {
			return $v;
		}
		if ( ! self::consume_nonce( $v['nonce'] ) ) {
			return new WP_Error( 'pfg_bad_auth', 'That sign-in request has expired or was already used. Please try again.', array( 'status' => 401 ) );
		}
		$acc = PFG_Storage::touch_account( $v['pubkey'] );
		if ( ! $acc || 'active' !== $acc['status'] ) {
			return new WP_Error( 'pfg_blocked', 'This account is not allowed to sign in.', array( 'status' => 403 ) );
		}
		return self::create_session( $acc );
	}

	private static function create_session( $acc ) {
		global $wpdb;
		$t       = PFG_Installer::table( 'sessions' );
		$now     = time();
		$expires = $now + (int) PFG_Settings::get( 'session_hours' ) * HOUR_IN_SECONDS;
		$token   = bin2hex( random_bytes( 32 ) );
		$csrf    = bin2hex( random_bytes( 24 ) );
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$t} WHERE expires < %d", $now ) ); // phpcs:ignore
		$wpdb->insert(
			$t,
			array(
				'token_hash' => hash( 'sha256', $token ),
				'csrf_hash'  => hash( 'sha256', $csrf ),
				'account_id' => (int) $acc['id'],
				'created_at' => $now,
				'expires'    => $expires,
			),
			array( '%s', '%s', '%d', '%d', '%d' )
		);
		self::set_cookie( $token, $expires );
		return array(
			'account' => $acc,
			'csrf'    => $csrf,
			'expires' => $expires,
		);
	}

	private static function set_cookie( $value, $expires ) {
		if ( headers_sent() ) {
			return;
		}
		setcookie(
			self::COOKIE,
			$value,
			array(
				'expires'  => $expires,
				'path'     => '/',
				'secure'   => is_ssl(),
				'httponly' => true,
				'samesite' => 'Strict',
			)
		);
	}

	/**
	 * Load the session for this request from the cookie. Returns the session row
	 * joined with its account, or null.
	 */
	public static function load_session() {
		if ( null !== self::$session ) {
			return self::$session ? self::$session : null;
		}
		self::$session = false;
		if ( empty( $_COOKIE[ self::COOKIE ] ) || ! is_string( $_COOKIE[ self::COOKIE ] ) || ! preg_match( '/^[0-9a-f]{64}$/', $_COOKIE[ self::COOKIE ] ) ) {
			return null;
		}
		global $wpdb;
		$s   = PFG_Installer::table( 'sessions' );
		$a   = PFG_Installer::table( 'accounts' );
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT s.id AS session_id, s.csrf_hash, s.expires, a.id AS account_id, a.pubkey, a.status FROM {$s} s INNER JOIN {$a} a ON a.id = s.account_id WHERE s.token_hash = %s AND s.expires >= %d", hash( 'sha256', $_COOKIE[ self::COOKIE ] ), time() ), ARRAY_A ); // phpcs:ignore
		if ( ! $row || 'active' !== $row['status'] ) {
			return null;
		}
		self::$session = $row;
		return $row;
	}

	/**
	 * Rotate the CSRF token (used by GET /me so a reloaded page can obtain it).
	 */
	public static function rotate_csrf( $session_id ) {
		global $wpdb;
		$csrf = bin2hex( random_bytes( 24 ) );
		$wpdb->update( PFG_Installer::table( 'sessions' ), array( 'csrf_hash' => hash( 'sha256', $csrf ) ), array( 'id' => (int) $session_id ), array( '%s' ), array( '%d' ) );
		return $csrf;
	}

	public static function check_csrf( $session, $header ) {
		return is_string( $header ) && preg_match( '/^[0-9a-f]{48}$/', $header ) && hash_equals( $session['csrf_hash'], hash( 'sha256', $header ) );
	}

	public static function logout( $session ) {
		global $wpdb;
		$wpdb->delete( PFG_Installer::table( 'sessions' ), array( 'id' => (int) $session['session_id'] ), array( '%d' ) );
		self::set_cookie( '', time() - DAY_IN_SECONDS );
		self::$session = null;
	}

	public static function destroy_account_sessions( $account_id ) {
		global $wpdb;
		$wpdb->delete( PFG_Installer::table( 'sessions' ), array( 'account_id' => (int) $account_id ), array( '%d' ) );
	}
}
