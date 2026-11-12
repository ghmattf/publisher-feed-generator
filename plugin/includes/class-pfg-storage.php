<?php
/**
 * Database access and feed-file writing for hosted feeds.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Storage {

	/** Slugs that can never be claimed. */
	public static function reserved_slugs() {
		return array( 'admin', 'api', 'feed', 'feeds', 'index', 'music', 'phafe', 'publishers', 'rss', 'test', 'wp-admin', 'wp-content', 'wp-json', 'www' );
	}

	public static function slug_error( $slug ) {
		if ( ! preg_match( '/^[a-z0-9][a-z0-9_-]{2,39}$/', $slug ) ) {
			return 'The feed name must be 3-40 characters: lowercase letters, numbers, "-" and "_".';
		}
		if ( in_array( $slug, self::reserved_slugs(), true ) ) {
			return 'That feed name is reserved. Please choose another.';
		}
		return '';
	}

	/* ------------------------------------------------------------------ */
	/* Paths                                                               */
	/* ------------------------------------------------------------------ */

	private static function subdir() {
		return trim( (string) PFG_Settings::get( 'feed_subdir' ), '/' );
	}

	public static function feed_url( $slug ) {
		$u = wp_get_upload_dir();
		return trailingslashit( $u['baseurl'] ) . self::subdir() . '/' . $slug . '/' . $slug . '.xml';
	}

	/**
	 * Absolute file path for a slug, or false if it would fall outside uploads.
	 */
	public static function feed_path( $slug ) {
		if ( self::slug_error( $slug ) ) {
			return false;
		}
		$u    = wp_get_upload_dir();
		$base = wp_normalize_path( $u['basedir'] );
		$dir  = $base . '/' . self::subdir() . '/' . $slug;
		return array(
			'dir'  => $dir,
			'file' => $dir . '/' . $slug . '.xml',
			'base' => $base,
		);
	}

	/**
	 * Write the feed XML atomically. Returns true or a WP_Error.
	 */
	public static function write_file( $slug, $xml ) {
		$p = self::feed_path( $slug );
		if ( ! $p ) {
			return new WP_Error( 'pfg_path', 'Invalid feed path.', array( 'status' => 400 ) );
		}
		if ( ! wp_mkdir_p( $p['dir'] ) ) {
			return new WP_Error( 'pfg_mkdir', 'The server could not create the feed folder.', array( 'status' => 500 ) );
		}
		$real_dir  = realpath( $p['dir'] );
		$real_base = realpath( $p['base'] );
		if ( false === $real_dir || false === $real_base || 0 !== strpos( wp_normalize_path( $real_dir ) . '/', wp_normalize_path( $real_base ) . '/' ) ) {
			return new WP_Error( 'pfg_path', 'Invalid feed path.', array( 'status' => 400 ) );
		}
		$tmp = tempnam( $real_dir, '.pfg' );
		if ( false === $tmp ) {
			return new WP_Error( 'pfg_write', 'The server could not write the feed file.', array( 'status' => 500 ) );
		}
		if ( false === file_put_contents( $tmp, $xml ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions
			@unlink( $tmp ); // phpcs:ignore
			return new WP_Error( 'pfg_write', 'The server could not write the feed file.', array( 'status' => 500 ) );
		}
		@chmod( $tmp, 0644 ); // phpcs:ignore
		if ( ! @rename( $tmp, $real_dir . '/' . $slug . '.xml' ) ) { // phpcs:ignore
			@unlink( $tmp ); // phpcs:ignore
			return new WP_Error( 'pfg_write', 'The server could not write the feed file.', array( 'status' => 500 ) );
		}
		return true;
	}

	public static function delete_file( $slug ) {
		$p = self::feed_path( $slug );
		if ( $p && file_exists( $p['file'] ) ) {
			@unlink( $p['file'] ); // phpcs:ignore
		}
	}

	/* ------------------------------------------------------------------ */
	/* Accounts                                                            */
	/* ------------------------------------------------------------------ */

	public static function get_account_by_pubkey( $pubkey ) {
		global $wpdb;
		$t = PFG_Installer::table( 'accounts' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE pubkey = %s", $pubkey ), ARRAY_A ); // phpcs:ignore
	}

	public static function get_account( $id ) {
		global $wpdb;
		$t = PFG_Installer::table( 'accounts' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE id = %d", $id ), ARRAY_A ); // phpcs:ignore
	}

	public static function touch_account( $pubkey ) {
		global $wpdb;
		$t   = PFG_Installer::table( 'accounts' );
		$now = time();
		$acc = self::get_account_by_pubkey( $pubkey );
		if ( ! $acc ) {
			$wpdb->insert(
				$t,
				array(
					'pubkey'     => $pubkey,
					'status'     => 'active',
					'created_at' => $now,
					'last_login' => $now,
				),
				array( '%s', '%s', '%d', '%d' )
			);
			return self::get_account_by_pubkey( $pubkey );
		}
		$wpdb->update( $t, array( 'last_login' => $now ), array( 'id' => (int) $acc['id'] ), array( '%d' ), array( '%d' ) );
		return $acc;
	}

	public static function set_account_status( $id, $status ) {
		global $wpdb;
		$wpdb->update( PFG_Installer::table( 'accounts' ), array( 'status' => $status ), array( 'id' => (int) $id ), array( '%s' ), array( '%d' ) );
	}

	/* ------------------------------------------------------------------ */
	/* Feeds                                                               */
	/* ------------------------------------------------------------------ */

	public static function get_feed( $id ) {
		global $wpdb;
		$t = PFG_Installer::table( 'feeds' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE id = %d", $id ), ARRAY_A ); // phpcs:ignore
	}

	public static function slug_or_guid_taken( $slug, $guid ) {
		global $wpdb;
		$t = PFG_Installer::table( 'feeds' );
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t} WHERE slug = %s OR guid = %s", $slug, $guid ) ) > 0; // phpcs:ignore
	}

	public static function count_feeds_for_account( $account_id ) {
		global $wpdb;
		$t = PFG_Installer::table( 'feeds' );
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t} WHERE account_id = %d AND status <> 'deleted'", $account_id ) ); // phpcs:ignore
	}

	public static function list_feeds_for_account( $account_id ) {
		global $wpdb;
		$t = PFG_Installer::table( 'feeds' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT id, slug, guid, title, status, created_at, updated_at FROM {$t} WHERE account_id = %d AND status <> 'deleted' ORDER BY id ASC", $account_id ), ARRAY_A ); // phpcs:ignore
	}

	public static function list_all_feeds() {
		global $wpdb;
		$f = PFG_Installer::table( 'feeds' );
		$a = PFG_Installer::table( 'accounts' );
		return $wpdb->get_results( "SELECT f.id, f.slug, f.guid, f.title, f.status, f.created_at, f.updated_at, f.account_id, a.pubkey, a.status AS account_status FROM {$f} f LEFT JOIN {$a} a ON a.id = f.account_id ORDER BY f.id DESC LIMIT 500", ARRAY_A ); // phpcs:ignore
	}

	public static function insert_feed( $account_id, $slug, $guid, $model, $status ) {
		global $wpdb;
		$now = time();
		$ok  = $wpdb->insert(
			PFG_Installer::table( 'feeds' ),
			array(
				'account_id' => $account_id,
				'slug'       => $slug,
				'guid'       => $guid,
				'title'      => mb_substr( $model['title'], 0, 200 ),
				'status'     => $status,
				'data'       => wp_json_encode( $model ),
				'created_at' => $now,
				'updated_at' => $now,
			),
			array( '%d', '%s', '%s', '%s', '%s', '%s', '%d', '%d' )
		);
		return $ok ? (int) $wpdb->insert_id : 0;
	}

	public static function update_feed_data( $id, $model ) {
		global $wpdb;
		return false !== $wpdb->update(
			PFG_Installer::table( 'feeds' ),
			array(
				'title'      => mb_substr( $model['title'], 0, 200 ),
				'data'       => wp_json_encode( $model ),
				'updated_at' => time(),
			),
			array( 'id' => (int) $id ),
			array( '%s', '%s', '%d' ),
			array( '%d' )
		);
	}

	public static function set_feed_status( $id, $status ) {
		global $wpdb;
		$wpdb->update( PFG_Installer::table( 'feeds' ), array( 'status' => $status, 'updated_at' => time() ), array( 'id' => (int) $id ), array( '%s', '%d' ), array( '%d' ) );
	}

	/**
	 * Soft delete: drop the data and file but keep the row so the slug (and so the GUID) cannot be reused by someone else.
	 */
	public static function tombstone_feed( $feed ) {
		global $wpdb;
		self::delete_file( $feed['slug'] );
		$wpdb->update(
			PFG_Installer::table( 'feeds' ),
			array(
				'status'     => 'deleted',
				'data'       => '{}',
				'title'      => '',
				'updated_at' => time(),
			),
			array( 'id' => (int) $feed['id'] ),
			array( '%s', '%s', '%s', '%d' ),
			array( '%d' )
		);
	}

	public static function decode_model( $feed ) {
		$m = json_decode( isset( $feed['data'] ) ? $feed['data'] : '{}', true );
		return is_array( $m ) ? $m : array();
	}

	/**
	 * Build and publish the XML for a feed row. Returns the XML string or a WP_Error.
	 */
	public static function publish( $feed, $model ) {
		$platform = PFG_Settings::platform_recipients();
		$xml      = PFG_Xml::build( $model, $platform, time() );
		$res      = self::write_file( $feed['slug'], $xml );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		return $xml;
	}
}
