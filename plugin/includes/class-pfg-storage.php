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

	/** Folder (inside wp-content) that holds every hosted feed. */
	const DIR = 'pubfeeds';

	const LEGACY_OPTION = 'pfg_legacy_feeds';

	/**
	 * Folder (below uploads) of a feed made before /wp-content/pubfeeds/
	 * existed, or '' for any other feed. Such feeds are never moved: their URL
	 * may already be registered with podcast apps and directories.
	 */
	private static function legacy_map() {
		$l = get_option( self::LEGACY_OPTION );
		if ( ! is_array( $l ) ) {
			return array();
		}
		$map = isset( $l['map'] ) && is_array( $l['map'] ) ? $l['map'] : array();
		if ( ! empty( $l['subdir'] ) && ! empty( $l['slugs'] ) ) { // first (0.5.x) shape: one folder for many feeds.
			foreach ( (array) $l['slugs'] as $sl ) {
				if ( ! isset( $map[ $sl ] ) ) {
					$map[ $sl ] = $l['subdir'];
				}
			}
		}
		return $map;
	}

	private static function legacy_subdir( $slug ) {
		$map = self::legacy_map();
		return isset( $map[ $slug ] ) ? (string) $map[ $slug ] : '';
	}

	private static function add_legacy( $slug, $subdir ) {
		$map          = self::legacy_map();
		$map[ $slug ] = $subdir;
		update_option( self::LEGACY_OPTION, array( 'map' => $map ), false );
	}

	/**
	 * Called once when upgrading from a version that saved feeds in uploads:
	 * remember which feeds live there so they stay where they are.
	 */
	public static function record_legacy_feeds() {
		global $wpdb;
		$t     = PFG_Installer::table( 'feeds' );
		$slugs = array_column( (array) $wpdb->get_results( "SELECT slug FROM {$t}", ARRAY_A ), 'slug' ); // phpcs:ignore
		if ( ! $slugs ) {
			return;
		}
		$opt    = get_option( PFG_Settings::OPTION );
		$subdir = is_array( $opt ) && isset( $opt['feed_subdir'] ) ? trim( (string) $opt['feed_subdir'], " \t\n\r\0\x0B/" ) : 'rssfeed/publishers';
		if ( ! preg_match( '#^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+){0,3}$#', $subdir ) ) {
			$subdir = 'rssfeed/publishers';
		}
		update_option( self::LEGACY_OPTION, array( 'subdir' => $subdir, 'slugs' => array_values( $slugs ) ), false );
	}

	public static function feed_url( $slug ) {
		$legacy = self::legacy_subdir( $slug );
		if ( '' !== $legacy ) {
			$u = wp_get_upload_dir();
			return trailingslashit( $u['baseurl'] ) . $legacy . '/' . $slug . '/' . $slug . '.xml';
		}
		return trailingslashit( content_url( self::DIR ) ) . $slug . '/' . $slug . '.xml';
	}

	/** Public base URL of the feed folder for new feeds, with a trailing slash. */
	public static function base_url() {
		return trailingslashit( content_url( self::DIR ) );
	}

	/**
	 * Absolute file path for a slug, or false if the slug is not allowed.
	 * The folder is created on demand when a feed is written.
	 */
	public static function feed_path( $slug ) {
		if ( self::slug_error( $slug ) ) {
			return false;
		}
		$legacy = self::legacy_subdir( $slug );
		if ( '' !== $legacy ) {
			$u    = wp_get_upload_dir();
			$base = wp_normalize_path( $u['basedir'] );
			$dir  = $base . '/' . $legacy . '/' . $slug;
		} else {
			$base = wp_normalize_path( WP_CONTENT_DIR ) . '/' . self::DIR;
			$dir  = $base . '/' . $slug;
		}
		return array(
			'dir'    => $dir,
			'file'   => $dir . '/' . $slug . '.xml',
			'base'   => $base,
			'legacy' => '' !== $legacy,
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
		if ( ! wp_mkdir_p( $p['base'] ) || ! wp_mkdir_p( $p['dir'] ) ) {
			return new WP_Error( 'pfg_mkdir', 'The server could not create the feed folder.', array( 'status' => 500 ) );
		}
		$real_dir  = realpath( $p['dir'] );
		$real_base = realpath( $p['base'] );
		if ( false === $real_dir || false === $real_base || 0 !== strpos( wp_normalize_path( $real_dir ) . '/', wp_normalize_path( $real_base ) . '/' ) ) {
			return new WP_Error( 'pfg_path', 'Invalid feed path.', array( 'status' => 400 ) );
		}
		$index = $real_base . '/index.html';
		if ( empty( $p['legacy'] ) && ! file_exists( $index ) ) {
			@file_put_contents( $index, '' ); // phpcs:ignore -- stops directory listing.
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

	/** True for a feed taken over from an existing file that has not been saved from the editor yet. */
	public static function is_adopted_pending( $feed ) {
		$m = self::decode_model( $feed );
		return ! empty( $m['adopted'] );
	}

	/** Current contents of a feed's file, or '' if it is not there. */
	public static function read_file( $slug ) {
		$p = self::feed_path( $slug );
		if ( ! $p || ! is_readable( $p['file'] ) ) {
			return '';
		}
		$x = file_get_contents( $p['file'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		return false === $x ? '' : $x;
	}

	public static function list_accounts() {
		global $wpdb;
		$t = PFG_Installer::table( 'accounts' );
		return (array) $wpdb->get_results( "SELECT id, pubkey, status FROM {$t} ORDER BY id ASC LIMIT 500", ARRAY_A ); // phpcs:ignore
	}

	/**
	 * Take over a feed file that already exists in this site's uploads folder, so its owner can edit it in the
	 * editor. The file stays where it is and keeps its GUID. Admin use only (the caller checks the capability).
	 * Returns the new feed id or a WP_Error.
	 */
	public static function adopt_from_url( $url, $account_id ) {
		$u    = wp_get_upload_dir();
		$base = trailingslashit( $u['baseurl'] );
		$url  = trim( (string) $url );
		if ( 0 !== strpos( $url, $base ) ) {
			return new WP_Error( 'pfg_adopt', 'The feed must be a file on this site, under ' . $base );
		}
		$rel = substr( $url, strlen( $base ) );
		if ( ! preg_match( '#^((?:[A-Za-z0-9_-]+/){1,4})([a-z0-9][a-z0-9_-]{2,39})/\2\.xml$#', $rel, $mm ) ) {
			return new WP_Error( 'pfg_adopt', 'The address must look like ' . $base . 'folder/name/name.xml (the file name must repeat the folder name).' );
		}
		$subdir = rtrim( $mm[1], '/' );
		$slug   = $mm[2];
		if ( self::slug_error( $slug ) ) {
			return new WP_Error( 'pfg_adopt', self::slug_error( $slug ) );
		}
		$basedir = realpath( $u['basedir'] );
		$file    = realpath( wp_normalize_path( $u['basedir'] ) . '/' . $rel );
		if ( false === $basedir || false === $file || 0 !== strpos( wp_normalize_path( $file ), wp_normalize_path( $basedir ) . '/' ) || ! is_file( $file ) ) {
			return new WP_Error( 'pfg_adopt', 'That file was not found on this server.' );
		}
		if ( filesize( $file ) > 1048576 ) {
			return new WP_Error( 'pfg_adopt', 'That file is larger than 1 MB.' );
		}
		$xml = file_get_contents( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		$doc = new DOMDocument();
		$prev = libxml_use_internal_errors( true );
		$ok   = $xml && $doc->loadXML( $xml, LIBXML_NONET );
		libxml_clear_errors();
		libxml_use_internal_errors( $prev );
		if ( ! $ok ) {
			return new WP_Error( 'pfg_adopt', 'That file is not well-formed XML.' );
		}
		$xp = new DOMXPath( $doc );
		$xp->registerNamespace( 'podcast', PFG_Xml::NS_PODCAST );
		$medium = $xp->evaluate( 'string(/rss/channel/podcast:medium)' );
		if ( 'publisher' !== trim( $medium ) ) {
			return new WP_Error( 'pfg_adopt', 'That is not a publisher feed (podcast:medium must be "publisher").' );
		}
		$guid = strtolower( trim( $xp->evaluate( 'string(/rss/channel/podcast:guid)' ) ) );
		if ( ! PFG_Feed::is_uuid( $guid ) ) {
			return new WP_Error( 'pfg_adopt', 'The feed has no valid podcast:guid, so it cannot be adopted.' );
		}
		$title = trim( $xp->evaluate( 'string(/rss/channel/title)' ) );
		if ( ! self::get_account( (int) $account_id ) ) {
			return new WP_Error( 'pfg_adopt', 'Choose the account that will own this feed.' );
		}
		if ( self::slug_or_guid_taken( $slug, $guid ) ) {
			return new WP_Error( 'pfg_adopt', 'This feed name or GUID is already managed by the plugin.' );
		}
		$id = self::insert_feed( (int) $account_id, $slug, $guid, array( 'title' => $title, 'adopted' => true ), 'published' );
		if ( ! $id ) {
			return new WP_Error( 'pfg_adopt', 'The feed could not be saved.' );
		}
		self::add_legacy( $slug, $subdir );
		return $id;
	}

	public static function decode_model( $feed ) {
		$m = json_decode( isset( $feed['data'] ) ? $feed['data'] : '{}', true );
		return is_array( $m ) ? $m : array();
	}

	/**
	 * Build and publish the XML for a feed row. Returns the XML string or a WP_Error.
	 */
	public static function publish( $feed, $model ) {
		if ( empty( $model['created'] ) && ! empty( $feed['created_at'] ) ) {
			$model['created'] = (int) $feed['created_at']; // feeds saved before pubDate existed: use the date the feed row was made.
		}
		$platform = PFG_Feed::active_platform( PFG_Settings::platform_recipients(), isset( $model['support'] ) ? $model['support'] : null );
		$xml      = PFG_Xml::build( $model, $platform, time() );
		$res      = self::write_file( $feed['slug'], $xml );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		return $xml;
	}
}
