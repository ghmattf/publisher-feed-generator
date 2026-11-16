<?php
/**
 * REST API (namespace pfg/v1).
 *
 * Auth model: the browser signs a NIP-98 (kind 27235) event with the user's
 * Nostr remote signer. The event carries a single-use server nonce. A verified
 * login creates a cookie session (HttpOnly, SameSite=Strict) plus a CSRF token.
 * Changing payment recipients or deleting a feed needs a fresh signature
 * (X-PFG-Auth header) even inside a session.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Rest {

	const NS = 'pfg/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_filter( 'rest_post_dispatch', array( __CLASS__, 'no_store' ), 10, 3 );
	}

	/** Never let a CDN or browser cache our API responses. */
	public static function no_store( $response, $server, $request ) {
		if ( 0 === strpos( $request->get_route(), '/' . self::NS ) ) {
			$response->header( 'Cache-Control', 'no-store, private' );
		}
		return $response;
	}

	public static function register_routes() {
		$pub = array( __CLASS__, 'perm_public' );
		$hst = array( __CLASS__, 'perm_hosting' );
		$ses = array( __CLASS__, 'perm_session' );

		register_rest_route( self::NS, '/config', array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'route_config' ), 'permission_callback' => $pub ) );
		$lkp = array( __CLASS__, 'perm_lookup' );
		register_rest_route( self::NS, '/lookup/feed', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'route_lookup_feed' ), 'permission_callback' => $lkp ) );
		register_rest_route( self::NS, '/lookup/search', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'route_lookup_search' ), 'permission_callback' => $lkp ) );
		register_rest_route( self::NS, '/auth/nonce', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'route_nonce' ), 'permission_callback' => $hst ) );
		register_rest_route( self::NS, '/auth/login', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'route_login' ), 'permission_callback' => $hst ) );
		register_rest_route( self::NS, '/auth/logout', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'route_logout' ), 'permission_callback' => $ses ) );
		register_rest_route( self::NS, '/me', array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'route_me' ), 'permission_callback' => $ses ) );
		register_rest_route( self::NS, '/me/upgrade', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'route_upgrade' ), 'permission_callback' => $ses ) );
		register_rest_route(
			self::NS,
			'/me/feeds',
			array(
				array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'route_list' ), 'permission_callback' => $ses ),
				array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'route_create' ), 'permission_callback' => $ses ),
			)
		);
		register_rest_route( self::NS, '/me/feeds/(?P<id>\d+)/move', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'route_move' ), 'permission_callback' => $ses ) );
		register_rest_route(
			self::NS,
			'/me/feeds/(?P<id>\d+)',
			array(
				array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'route_get' ), 'permission_callback' => $ses ),
				array( 'methods' => 'PUT', 'callback' => array( __CLASS__, 'route_update' ), 'permission_callback' => $ses ),
				array( 'methods' => 'DELETE', 'callback' => array( __CLASS__, 'route_delete' ), 'permission_callback' => $ses ),
			)
		);
	}

	/* ------------------------------------------------------------------ */
	/* Permissions                                                         */
	/* ------------------------------------------------------------------ */

	public static function perm_public() {
		return true;
	}

	/** Lookups are open to anonymous visitors, so they are rate limited. JSON only. */
	public static function perm_lookup( $request ) {
		return self::require_json_body( $request );
	}

	public static function route_lookup_feed( WP_REST_Request $r ) {
		$rl = PFG_Auth::rate_limit( 'lookup', 20, 300 );
		if ( is_wp_error( $rl ) ) {
			return $rl;
		}
		$body = $r->get_json_params();
		$xml  = PFG_Lookup::fetch_feed( is_array( $body ) && isset( $body['url'] ) ? $body['url'] : '' );
		return is_wp_error( $xml ) ? $xml : rest_ensure_response( array( 'xml' => $xml ) );
	}

	public static function route_lookup_search( WP_REST_Request $r ) {
		$rl = PFG_Auth::rate_limit( 'search', 20, 300 );
		if ( is_wp_error( $rl ) ) {
			return $rl;
		}
		$body = $r->get_json_params();
		$res  = PFG_Lookup::search( is_array( $body ) && isset( $body['q'] ) ? $body['q'] : '' );
		return is_wp_error( $res ) ? $res : rest_ensure_response( array( 'results' => $res ) );
	}

	public static function perm_hosting( $request ) {
		if ( ! pfg_hosting_available() ) {
			return new WP_Error( 'pfg_disabled', 'Hosting is not available on this site.', array( 'status' => 503 ) );
		}
		return self::require_json_body( $request );
	}

	public static function perm_session( $request ) {
		if ( ! pfg_hosting_available() ) {
			return new WP_Error( 'pfg_disabled', 'Hosting is not available on this site.', array( 'status' => 503 ) );
		}
		$s = PFG_Auth::load_session();
		if ( ! $s ) {
			return new WP_Error( 'pfg_auth', 'Please sign in.', array( 'status' => 401 ) );
		}
		if ( 'GET' !== $request->get_method() ) {
			if ( ! PFG_Auth::check_csrf( $s, $request->get_header( 'x-pfg-csrf' ) ) ) {
				return new WP_Error( 'pfg_csrf', 'Your session needs refreshing. Reload the page and try again.', array( 'status' => 403 ) );
			}
			return self::require_json_body( $request );
		}
		return true;
	}

	/**
	 * Any request that carries a body must declare JSON. (A custom Content-Type
	 * also means cross-site form posts cannot reach these endpoints.)
	 */
	private static function require_json_body( $request ) {
		if ( '' === $request->get_body() ) {
			return true;
		}
		$ct_info = $request->get_content_type();
		$ct      = is_array( $ct_info ) && isset( $ct_info['value'] ) ? strtolower( (string) $ct_info['value'] ) : '';
		if ( 'application/json' !== $ct ) {
			return new WP_Error( 'pfg_content_type', 'Expected application/json.', array( 'status' => 415 ) );
		}
		return true;
	}

	/* ------------------------------------------------------------------ */
	/* Config                                                              */
	/* ------------------------------------------------------------------ */

	public static function client_config() {
		$rels = array_values( array_unique( array_merge( PFG_Feed::builtin_rel_tokens(), array_filter( explode( ' ', (string) PFG_Settings::get( 'extra_rel_tokens' ) ) ) ) ) );
		return array(
			'siteName'               => get_bloginfo( 'name' ),
			'hostingAvailable'       => pfg_hosting_available(),
			'hostingNeedsGmp'        => ! extension_loaded( 'gmp' ),
			'requireApproval'        => (bool) PFG_Settings::get( 'require_approval' ),
			'urls'                   => array(
				'nonce'        => rest_url( self::NS . '/auth/nonce' ),
				'login'        => rest_url( self::NS . '/auth/login' ),
				'logout'       => rest_url( self::NS . '/auth/logout' ),
				'me'           => rest_url( self::NS . '/me' ),
				'upgrade'      => rest_url( self::NS . '/me/upgrade' ),
				'feeds'        => rest_url( self::NS . '/me/feeds' ),
				'feedTemplate' => rest_url( self::NS . '/me/feeds/0' ),
				'lookupFeed'   => rest_url( self::NS . '/lookup/feed' ),
				'lookupSearch' => rest_url( self::NS . '/lookup/search' ),
			),
			'feedBaseUrl'            => PFG_Storage::base_url(),
			'moreInfoUrl'            => (string) PFG_Settings::get( 'more_info_url' ),
			'keepMovedDays'          => (int) PFG_Settings::get( 'keep_moved_days' ),
			'relays'                 => array_values( (array) PFG_Settings::get( 'relays' ) ),
			'platform'               => array_values( PFG_Settings::platform_recipients() ),
			'defaults'               => array(
				'suggested' => (string) PFG_Settings::get( 'default_suggested' ),
				'method'    => (string) PFG_Settings::get( 'default_value_method' ),
			),
			'relTokens'              => array_values( array_unique( $rels ) ),
			'mediums'                => PFG_Feed::mediums(),
			'limits'                 => array(
				'maxReleases' => (int) PFG_Settings::get( 'max_releases' ),
				'maxFeeds'    => (int) PFG_Settings::get( 'max_feeds_per_account' ),
			),
		);
	}

	public static function route_config() {
		return rest_ensure_response( self::client_config() );
	}

	/* ------------------------------------------------------------------ */
	/* Auth routes                                                         */
	/* ------------------------------------------------------------------ */

	public static function route_nonce() {
		$rl = PFG_Auth::rate_limit( 'nonce', 30, 300 );
		if ( is_wp_error( $rl ) ) {
			return $rl;
		}
		return rest_ensure_response( PFG_Auth::issue_nonce() );
	}

	public static function route_login( WP_REST_Request $r ) {
		$rl = PFG_Auth::rate_limit( 'login', 10, 600 );
		if ( is_wp_error( $rl ) ) {
			return $rl;
		}
		$body = $r->get_json_params();
		if ( ! is_array( $body ) || ! isset( $body['event'] ) ) {
			return new WP_Error( 'pfg_bad_request', 'Missing signed event.', array( 'status' => 400 ) );
		}
		$res = PFG_Auth::login( $body['event'], rest_url( self::NS . '/auth/login' ), ! empty( $body['browserKey'] ) ? 'browser' : 'signer' );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		return rest_ensure_response( self::session_payload( $res['account'], $res['csrf'], $res['expires'] ) );
	}

	public static function route_logout() {
		$s = PFG_Auth::load_session();
		if ( $s ) {
			PFG_Auth::logout( $s );
		}
		return rest_ensure_response( array( 'ok' => true ) );
	}

	public static function route_me() {
		$s    = PFG_Auth::load_session();
		$acc  = PFG_Storage::get_account( (int) $s['account_id'] );
		$csrf = PFG_Auth::rotate_csrf( (int) $s['session_id'] );
		return rest_ensure_response( self::session_payload( $acc, $csrf, (int) $s['expires'] ) );
	}

	private static function session_payload( $acc, $csrf, $expires ) {
		return array(
			'pubkey'  => $acc['pubkey'],
			'kind'    => isset( $acc['kind'] ) && 'browser' === $acc['kind'] ? 'browser' : 'signer',
			'npub'    => PFG_Nostr::npub_encode( $acc['pubkey'] ),
			'csrf'    => $csrf,
			'expires' => (int) $expires,
			'feeds'   => array_map( array( __CLASS__, 'feed_summary' ), PFG_Storage::list_feeds_for_account( (int) $acc['id'] ) ),
		);
	}

	/* ------------------------------------------------------------------ */
	/* Feed routes                                                         */
	/* ------------------------------------------------------------------ */

	private static function feed_summary( $row ) {
		$moved_to = '';
		if ( ! empty( $row['data'] ) ) {
			$dm       = json_decode( $row['data'], true );
			$moved_to = is_array( $dm ) && ! empty( $dm['newFeedUrl'] ) && ! empty( $row['moved_at'] ) ? (string) $dm['newFeedUrl'] : '';
		}
		return array(
			'movedAt'   => (int) ( isset( $row['moved_at'] ) ? $row['moved_at'] : 0 ),
			'movedTo'   => $moved_to,
			'id'        => (int) $row['id'],
			'slug'      => $row['slug'],
			'guid'      => $row['guid'],
			'title'     => $row['title'],
			'status'    => $row['status'],
			'url'       => PFG_Storage::feed_url( $row['slug'] ),
			'updatedAt' => (int) $row['updated_at'],
		);
	}

	private static function norm_opts( $slug, $guid ) {
		return array(
			'hosted'            => true,
			'guid'              => $guid,
			'feed_url'          => PFG_Storage::feed_url( $slug ),
			'platform'          => PFG_Settings::platform_recipients(),
			'max_releases'      => (int) PFG_Settings::get( 'max_releases' ),
			'default_method'    => (string) PFG_Settings::get( 'default_value_method' ),
			'default_suggested' => (string) PFG_Settings::get( 'default_suggested' ),
			'allow_attrs'       => false,
		);
	}

	/**
	 * Accounts whose key is kept in the person's browser may not set up payments (recipients or a funding link):
	 * a stolen browser key must not be able to redirect money. Returns a WP_Error, or null when allowed.
	 */
	private static function payments_lock( $session, $model ) {
		$acc = PFG_Storage::get_account( (int) $session['account_id'] );
		if ( ! $acc || empty( $acc['kind'] ) || 'browser' !== $acc['kind'] ) {
			return null;
		}
		$has_recipients = ! empty( $model['value']['recipients'] );
		$has_funding    = ! empty( $model['funding']['url'] );
		if ( $has_recipients || $has_funding ) {
			return new WP_Error( 'pfg_payments_locked', 'Payments are not supported when you sign in with a key kept in this browser. Sign in with a signer app or a browser extension to set up payments.', array( 'status' => 403 ) );
		}
		return null;
	}

	private static function invalid( $errors ) {
		return new WP_Error( 'pfg_invalid', 'Please fix the highlighted problems.', array( 'status' => 422, 'errors' => $errors ) );
	}

	private static function owned_feed( $id, $session ) {
		$feed = PFG_Storage::get_feed( (int) $id );
		if ( ! $feed || (int) $feed['account_id'] !== (int) $session['account_id'] || 'deleted' === $feed['status'] ) {
			return new WP_Error( 'pfg_not_found', 'Feed not found.', array( 'status' => 404 ) );
		}
		return $feed;
	}

	public static function route_list() {
		$s = PFG_Auth::load_session();
		return rest_ensure_response( array_map( array( __CLASS__, 'feed_summary' ), PFG_Storage::list_feeds_for_account( (int) $s['account_id'] ) ) );
	}

	public static function route_get( WP_REST_Request $r ) {
		$s    = PFG_Auth::load_session();
		$feed = self::owned_feed( $r['id'], $s );
		if ( is_wp_error( $feed ) ) {
			return $feed;
		}
		$out = array_merge( self::feed_summary( $feed ), array( 'feed' => PFG_Storage::decode_model( $feed ) ) );
		if ( PFG_Storage::is_adopted_pending( $feed ) ) {
			$out['importXml'] = PFG_Storage::read_file( $feed['slug'] ); // the editor reads this existing file to fill the form.
		}
		return rest_ensure_response( $out );
	}

	public static function route_create( WP_REST_Request $r ) {
		$s  = PFG_Auth::load_session();
		$rl = PFG_Auth::rate_limit( 'write', 30, 600, 'acct' . $s['account_id'] );
		if ( is_wp_error( $rl ) ) {
			return $rl;
		}
		$body = $r->get_json_params();
		if ( ! is_array( $body ) ) {
			return new WP_Error( 'pfg_bad_request', 'Invalid request.', array( 'status' => 400 ) );
		}
		$slug  = strtolower( trim( isset( $body['slug'] ) && is_string( $body['slug'] ) ? $body['slug'] : '' ) );
		if ( ! preg_match( '/^[a-z0-9][a-z0-9_-]{2,39}$/', $slug ) ) {
			return self::invalid( array( array( 'path' => 'slug', 'message' => PFG_Storage::slug_error( $slug ) ) ) );
		}
		// A name that is reserved, already used or already on disk is not an error: the next free one is used
		// (test, test1, test2 ...). The response carries the name that was used.
		$slug = PFG_Storage::available_slug( $slug );
		if ( '' === $slug ) {
			return new WP_Error( 'pfg_taken', 'That feed name is already taken. Please choose another.', array( 'status' => 409 ) );
		}
		if ( PFG_Storage::count_feeds_for_account( (int) $s['account_id'] ) >= (int) PFG_Settings::get( 'max_feeds_per_account' ) ) {
			return new WP_Error( 'pfg_limit', 'You have reached the maximum number of hosted feeds.', array( 'status' => 403 ) );
		}
		if ( isset( $body['feed'] ) && is_array( $body['feed'] ) ) {
			$body['feed']['newFeedUrl'] = ''; // a new feed has not moved anywhere.
		}
		$guid = PFG_Feed::guid_for_url( PFG_Storage::feed_url( $slug ) );
		if ( PFG_Storage::slug_or_guid_taken( $slug, $guid ) ) {
			return new WP_Error( 'pfg_taken', 'That feed name is already taken. Please choose another.', array( 'status' => 409 ) );
		}
		$res = PFG_Feed::normalize( isset( $body['feed'] ) ? $body['feed'] : array(), self::norm_opts( $slug, $guid ) );
		if ( $res['errors'] ) {
			return self::invalid( $res['errors'] );
		}
		$lock = self::payments_lock( $s, $res['model'] );
		if ( $lock ) {
			return $lock;
		}
		$res['model']['created'] = time(); // the server decides the creation date, whatever the browser sent.
		$status = PFG_Settings::get( 'require_approval' ) ? 'pending' : 'published';
		$id     = PFG_Storage::insert_feed( (int) $s['account_id'], $slug, $guid, $res['model'], $status );
		if ( ! $id ) {
			return new WP_Error( 'pfg_taken', 'That feed name is already taken. Please choose another.', array( 'status' => 409 ) );
		}
		$xml = null;
		if ( 'published' === $status ) {
			$xml = PFG_Storage::publish( array( 'slug' => $slug ), $res['model'] );
			if ( is_wp_error( $xml ) ) {
				global $wpdb;
				$wpdb->delete( PFG_Installer::table( 'feeds' ), array( 'id' => $id ), array( '%d' ) );
				return $xml;
			}
		}
		$row = PFG_Storage::get_feed( $id );
		$out = rest_ensure_response( array_merge( self::feed_summary( $row ), array( 'feed' => $res['model'], 'xml' => $xml ) ) );
		$out->set_status( 201 );
		return $out;
	}

	public static function route_update( WP_REST_Request $r ) {
		$s    = PFG_Auth::load_session();
		$feed = self::owned_feed( $r['id'], $s );
		if ( is_wp_error( $feed ) ) {
			return $feed;
		}
		$rl = PFG_Auth::rate_limit( 'write', 30, 600, 'acct' . $s['account_id'] );
		if ( is_wp_error( $rl ) ) {
			return $rl;
		}
		$body = $r->get_json_params();
		if ( ! is_array( $body ) ) {
			return new WP_Error( 'pfg_bad_request', 'Invalid request.', array( 'status' => 400 ) );
		}
		// The new feed address is only ever set by the "Move feed" action, never by an ordinary save.
		$stored_model = PFG_Storage::decode_model( $feed );
		if ( isset( $body['feed'] ) && is_array( $body['feed'] ) ) {
			$body['feed']['newFeedUrl'] = isset( $stored_model['newFeedUrl'] ) ? (string) $stored_model['newFeedUrl'] : '';
		}
		$res = PFG_Feed::normalize( isset( $body['feed'] ) ? $body['feed'] : array(), self::norm_opts( $feed['slug'], $feed['guid'] ) );
		if ( $res['errors'] ) {
			return self::invalid( $res['errors'] );
		}
		$lock = self::payments_lock( $s, $res['model'] );
		if ( $lock ) {
			return $lock;
		}
		$old = PFG_Storage::decode_model( $feed );
		if ( PFG_Feed::payment_fingerprint( $old ) !== PFG_Feed::payment_fingerprint( $res['model'] ) ) {
			$fresh = self::verify_fresh_auth( $r, rest_url( self::NS . '/me/feeds/' . (int) $feed['id'] ), 'PUT', $s );
			if ( is_wp_error( $fresh ) ) {
				return $fresh;
			}
		}
		$res['model']['created'] = (int) $feed['created_at']; // never changes after creation.
		$xml = null;
		if ( 'published' === $feed['status'] ) {
			$xml = PFG_Storage::publish( $feed, $res['model'] );
			if ( is_wp_error( $xml ) ) {
				return $xml;
			}
		}
		PFG_Storage::update_feed_data( (int) $feed['id'], $res['model'] );
		$row = PFG_Storage::get_feed( (int) $feed['id'] );
		return rest_ensure_response( array_merge( self::feed_summary( $row ), array( 'feed' => $res['model'], 'xml' => $xml ) ) );
	}

	/**
	 * Move a browser-key account to a safer key (a signer app or extension). Both keys must sign, so nobody can
	 * take over an account without the old key and nobody can be given an account without agreeing to it:
	 * - the old key signs a fresh NIP-98 event (X-PFG-Auth) and must be the key of this session;
	 * - the new key signs a fresh NIP-98 event (X-PFG-Auth-New);
	 * - both events are for this URL and bound to the same body, which names the new key.
	 * Feeds stay with the account, so URLs and GUIDs do not change.
	 */
	public static function route_upgrade( WP_REST_Request $r ) {
		$s   = PFG_Auth::load_session();
		$acc = PFG_Storage::get_account( (int) $s['account_id'] );
		if ( ! $acc || 'browser' !== $acc['kind'] ) {
			return new WP_Error( 'pfg_upgrade', 'Only an account created with a key kept in the browser can be upgraded.', array( 'status' => 409 ) );
		}
		$rl = PFG_Auth::rate_limit( 'upgrade', 10, 600, (string) $acc['id'] );
		if ( is_wp_error( $rl ) ) {
			return $rl;
		}
		$body = $r->get_json_params();
		$new  = is_array( $body ) && isset( $body['newPubkey'] ) && is_string( $body['newPubkey'] ) ? strtolower( $body['newPubkey'] ) : '';
		if ( ! preg_match( '/^[0-9a-f]{64}$/', $new ) ) {
			return new WP_Error( 'pfg_bad_request', 'Missing the new public key.', array( 'status' => 400 ) );
		}
		if ( hash_equals( $acc['pubkey'], $new ) ) {
			return new WP_Error( 'pfg_upgrade', 'That is the same key you are signed in with. Connect a different signer.', array( 'status' => 422 ) );
		}
		$url = rest_url( self::NS . '/me/upgrade' );
		$raw = $r->get_body();
		// Old key: validated first, but its nonce is only spent once both signatures are good.
		$hdr_old = $r->get_header( 'x-pfg-auth' );
		$hdr_new = $r->get_header( 'x-pfg-auth-new' );
		if ( ! $hdr_old || ! $hdr_new ) {
			return new WP_Error( 'pfg_fresh_auth_required', 'Both your old and your new key must confirm this move.', array( 'status' => 428 ) );
		}
		$vs = array();
		foreach ( array( 'old' => $hdr_old, 'new' => $hdr_new ) as $which => $hdr ) {
			$json  = base64_decode( $hdr, true );
			$event = false === $json ? null : json_decode( $json, true );
			$v     = PFG_Nostr::validate_http_auth( $event, $url, 'POST', $raw );
			if ( is_wp_error( $v ) ) {
				return $v;
			}
			$vs[ $which ] = $v;
		}
		if ( ! hash_equals( $acc['pubkey'], $vs['old']['pubkey'] ) ) {
			return new WP_Error( 'pfg_bad_auth', 'The first signature is not from the key you are signed in with.', array( 'status' => 403 ) );
		}
		if ( ! hash_equals( $new, $vs['new']['pubkey'] ) ) {
			return new WP_Error( 'pfg_bad_auth', 'The second signature is not from the new key.', array( 'status' => 403 ) );
		}
		if ( hash_equals( $vs['old']['nonce'], $vs['new']['nonce'] ) ) {
			return new WP_Error( 'pfg_bad_auth', 'Each key must sign its own request.', array( 'status' => 401 ) );
		}
		$existing = PFG_Storage::get_account_by_pubkey( $new );
		if ( $existing && PFG_Storage::count_feeds_for_account( (int) $existing['id'] ) > 0 ) {
			return new WP_Error( 'pfg_upgrade', 'That key already has an account with feeds here. Use a key that has not been used on this site, or ask the site owner to move the feeds for you.', array( 'status' => 409 ) );
		}
		foreach ( $vs as $v ) {
			if ( ! PFG_Auth::consume_nonce( $v['nonce'] ) ) {
				return new WP_Error( 'pfg_fresh_auth_required', 'That confirmation expired. Please confirm again.', array( 'status' => 428 ) );
			}
		}
		if ( $existing ) {
			// An empty account left by earlier sign-ins with the new key: the new key just proved it is theirs.
			PFG_Storage::delete_empty_account( (int) $existing['id'] );
		}
		if ( ! PFG_Storage::change_account_key( (int) $acc['id'], $new ) ) {
			return new WP_Error( 'pfg_upgrade', 'The account could not be moved.', array( 'status' => 500 ) );
		}
		$acc  = PFG_Storage::get_account( (int) $acc['id'] );
		$csrf = PFG_Auth::rotate_csrf( (int) $s['session_id'] );
		return rest_ensure_response( self::session_payload( $acc, $csrf, (int) $s['expires'] ) );
	}

	/**
	 * Tell apps that a feed has moved: writes <itunes:new-feed-url> into the feed and publishes it. The feed stays
	 * on this site (the admin deletes it after `keep_moved_days`). Needs a fresh signature like other sensitive changes.
	 */
	public static function route_move( WP_REST_Request $r ) {
		$s    = PFG_Auth::load_session();
		$feed = self::owned_feed( $r['id'], $s );
		if ( is_wp_error( $feed ) ) {
			return $feed;
		}
		if ( PFG_Storage::is_adopted_pending( $feed ) ) {
			return new WP_Error( 'pfg_move', 'Open this feed and save it once before moving it, so the file is rebuilt with the new address.', array( 'status' => 409 ) );
		}
		$body = $r->get_json_params();
		$new  = is_array( $body ) && isset( $body['newFeedUrl'] ) && is_string( $body['newFeedUrl'] ) ? trim( $body['newFeedUrl'] ) : '';
		if ( '' === $new || strlen( $new ) > 2000 || ! PFG_Feed::is_https_url( $new ) ) {
			return self::invalid( array( array( 'path' => 'newFeedUrl', 'message' => 'The new address must be a full https:// URL.' ) ) );
		}
		if ( $new === PFG_Storage::feed_url( $feed['slug'] ) ) {
			return self::invalid( array( array( 'path' => 'newFeedUrl', 'message' => 'That is this feed\'s current address.' ) ) );
		}
		$fresh = self::verify_fresh_auth( $r, rest_url( self::NS . '/me/feeds/' . (int) $feed['id'] . '/move' ), 'POST', $s );
		if ( is_wp_error( $fresh ) ) {
			return $fresh;
		}
		$model               = PFG_Storage::decode_model( $feed );
		$model['newFeedUrl'] = $new;
		$xml                 = null;
		if ( 'published' === $feed['status'] ) {
			$xml = PFG_Storage::publish( $feed, $model );
			if ( is_wp_error( $xml ) ) {
				return $xml;
			}
		}
		// Podping: not built yet. When it is, it is sent here, right after the feed is published.
		PFG_Storage::update_feed_data( (int) $feed['id'], $model );
		PFG_Storage::set_moved_at( (int) $feed['id'], time() );
		return rest_ensure_response( self::feed_summary( PFG_Storage::get_feed( (int) $feed['id'] ) ) );
	}

	public static function route_delete( WP_REST_Request $r ) {
		$s    = PFG_Auth::load_session();
		$feed = self::owned_feed( $r['id'], $s );
		if ( is_wp_error( $feed ) ) {
			return $feed;
		}
		$fresh = self::verify_fresh_auth( $r, rest_url( self::NS . '/me/feeds/' . (int) $feed['id'] ), 'DELETE', $s );
		if ( is_wp_error( $fresh ) ) {
			return $fresh;
		}
		PFG_Storage::tombstone_feed( $feed );
		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * Require a fresh NIP-98 signature (X-PFG-Auth: base64 of the signed event JSON)
	 * from the same key as the session, bound to this URL, method, body and a new nonce.
	 */
	private static function verify_fresh_auth( WP_REST_Request $r, $url, $method, $session ) {
		$hdr = $r->get_header( 'x-pfg-auth' );
		if ( ! $hdr ) {
			return new WP_Error( 'pfg_fresh_auth_required', 'Confirm this change with your signer.', array( 'status' => 428 ) );
		}
		$json  = base64_decode( $hdr, true );
		$event = false === $json ? null : json_decode( $json, true );
		$v     = PFG_Nostr::validate_http_auth( $event, $url, $method, $r->get_body() );
		if ( is_wp_error( $v ) ) {
			return $v;
		}
		if ( ! hash_equals( $session['pubkey'], $v['pubkey'] ) ) {
			return new WP_Error( 'pfg_bad_auth', 'The signature is from a different key than your session.', array( 'status' => 403 ) );
		}
		if ( ! PFG_Auth::consume_nonce( $v['nonce'] ) ) {
			return new WP_Error( 'pfg_fresh_auth_required', 'That confirmation expired. Please confirm again.', array( 'status' => 428 ) );
		}
		return true;
	}
}
