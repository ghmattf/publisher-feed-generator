<?php
/**
 * Database tables and upgrades.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Installer {

	const DB_VERSION_OPTION = 'pfg_db_version';
	const DB_VERSION        = '2';

	/**
	 * Table name helper.
	 *
	 * @param string $name accounts|sessions|nonces|feeds.
	 * @return string
	 */
	public static function table( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'pfg_' . $name;
	}

	/**
	 * Activation.
	 */
	public static function activate() {
		self::create_tables();
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
		if ( false === get_option( PFG_Settings::OPTION ) ) {
			add_option( PFG_Settings::OPTION, PFG_Settings::defaults(), '', 'no' );
		}
	}

	/**
	 * Run on load; creates tables if the stored version is older.
	 */
	public static function maybe_upgrade() {
		if ( get_option( self::DB_VERSION_OPTION ) !== self::DB_VERSION ) {
			self::create_tables();
			if ( get_option( self::DB_VERSION_OPTION ) && version_compare( (string) get_option( self::DB_VERSION_OPTION ), '2', '<' ) ) {
				PFG_Storage::record_legacy_feeds(); // v2: existing feeds stay in uploads; only new feeds use /wp-content/pubfeeds/.
			}
			update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
		}
	}

	/**
	 * Create tables.
	 */
	public static function create_tables() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();

		$accounts = self::table( 'accounts' );
		$sessions = self::table( 'sessions' );
		$nonces   = self::table( 'nonces' );
		$feeds    = self::table( 'feeds' );

		// Accounts are keyed by Nostr public key (hex). They are not WordPress users.
		dbDelta(
			"CREATE TABLE {$accounts} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				pubkey char(64) NOT NULL,
				status varchar(16) NOT NULL DEFAULT 'active',
				created_at int(10) unsigned NOT NULL,
				last_login int(10) unsigned NOT NULL DEFAULT 0,
				PRIMARY KEY  (id),
				UNIQUE KEY pubkey (pubkey)
			) {$charset};"
		);

		dbDelta(
			"CREATE TABLE {$sessions} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				token_hash char(64) NOT NULL,
				csrf_hash char(64) NOT NULL,
				account_id bigint(20) unsigned NOT NULL,
				created_at int(10) unsigned NOT NULL,
				expires int(10) unsigned NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY token_hash (token_hash),
				KEY account_id (account_id),
				KEY expires (expires)
			) {$charset};"
		);

		dbDelta(
			"CREATE TABLE {$nonces} (
				nonce_hash char(64) NOT NULL,
				expires int(10) unsigned NOT NULL,
				PRIMARY KEY  (nonce_hash),
				KEY expires (expires)
			) {$charset};"
		);

		// status: published | pending | suspended | deleted (deleted rows keep the slug reserved).
		dbDelta(
			"CREATE TABLE {$feeds} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				account_id bigint(20) unsigned NOT NULL,
				slug varchar(64) NOT NULL,
				guid char(36) NOT NULL,
				title varchar(200) NOT NULL DEFAULT '',
				status varchar(16) NOT NULL DEFAULT 'pending',
				data longtext NOT NULL,
				created_at int(10) unsigned NOT NULL,
				updated_at int(10) unsigned NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY slug (slug),
				UNIQUE KEY guid (guid),
				KEY account_id (account_id),
				KEY status (status)
			) {$charset};"
		);
	}

	/**
	 * Remove all plugin data (used by uninstall.php when enabled).
	 */
	public static function drop_tables() {
		global $wpdb;
		foreach ( array( 'accounts', 'sessions', 'nonces', 'feeds' ) as $t ) {
			$wpdb->query( 'DROP TABLE IF EXISTS ' . self::table( $t ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		}
		delete_option( self::DB_VERSION_OPTION );
		delete_option( PFG_Settings::OPTION );
	}
}
