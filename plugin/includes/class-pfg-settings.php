<?php
/**
 * Plugin settings: defaults, access and sanitising.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Settings {

	const OPTION = 'pfg_settings';

	/**
	 * Default settings.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'hosting_enabled'          => 1,
			'feed_subdir'              => 'rssfeed/publishers',
			'max_feeds_per_account'    => 3,
			'max_releases'             => 200,
			'require_approval'         => 0,
			'session_hours'            => 24,
			'relays'                   => array( 'wss://relay.nsec.app', 'wss://relay.damus.io', 'wss://nos.lol' ),
			// "Support the developers (optional)": shown to every feed creator with these default splits.
			// The creator can change each split (0 to 99); name, address and type are fixed here.
			// Review the addresses before going live; an empty list means no support section.
			'platform_recipients'      => array(
				array(
					'name'    => 'Phafe.com',
					'address' => 'phafe@phafe.com',
					'split'   => 1,
					'type'    => 'lnaddress',
				),
				array(
					'name'    => 'musicindex.org',
					'address' => 'heycitizen@getalby.com',
					'split'   => 1,
					'type'    => 'lnaddress',
				),
				array(
					'name'    => 'Podcastindex.org',
					'address' => 'podcastindex@getalby.com',
					'split'   => 1,
					'type'    => 'lnaddress',
				),
			),
			'default_suggested'        => '0.000033333',
			'default_value_method'     => 'lnaddress',
			'extra_rel_tokens'         => '',
			'trust_cf_ip'              => 0,
			'delete_data_on_uninstall' => 0,
		);
	}

	/**
	 * All settings merged over defaults.
	 *
	 * @return array
	 */
	public static function all() {
		$saved = get_option( self::OPTION, array() );
		if ( ! is_array( $saved ) ) {
			$saved = array();
		}
		$all = array_merge( self::defaults(), $saved );
		if ( self::is_old_default_platform( isset( $saved['platform_recipients'] ) ? $saved['platform_recipients'] : null ) ) {
			// Settings saved before the support list had three entries: still the old single default, so use the new defaults.
			$all['platform_recipients'] = self::defaults()['platform_recipients'];
		}
		return $all;
	}

	/**
	 * True when saved platform recipients are exactly the old built-in default (Podcastindex.org only, 1%).
	 *
	 * @param mixed $rows Saved rows.
	 * @return bool
	 */
	private static function is_old_default_platform( $rows ) {
		if ( ! is_array( $rows ) || 1 !== count( $rows ) ) {
			return false;
		}
		$r = reset( $rows );
		return is_array( $r )
			&& isset( $r['address'], $r['split'] )
			&& 'podcastindex@getalby.com' === strtolower( (string) $r['address'] )
			&& 1 === (int) $r['split'];
	}

	/**
	 * One setting.
	 *
	 * @param string $key Key.
	 * @return mixed
	 */
	public static function get( $key ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ] : null;
	}

	/**
	 * Validated platform recipients (only well-formed rows, splits < 100 in total).
	 *
	 * @return array
	 */
	public static function platform_recipients() {
		$rows = self::get( 'platform_recipients' );
		return is_array( $rows ) ? $rows : array();
	}

	/**
	 * Sanitise submitted settings.
	 *
	 * @param mixed $in Raw input.
	 * @return array
	 */
	public static function sanitize( $in ) {
		$d   = self::defaults();
		$in  = is_array( $in ) ? $in : array();
		$out = array();

		$out['hosting_enabled']           = empty( $in['hosting_enabled'] ) ? 0 : 1;
		$out['require_approval']          = empty( $in['require_approval'] ) ? 0 : 1;
		$out['trust_cf_ip']               = empty( $in['trust_cf_ip'] ) ? 0 : 1;
		$out['delete_data_on_uninstall']  = empty( $in['delete_data_on_uninstall'] ) ? 0 : 1;

		$subdir = isset( $in['feed_subdir'] ) ? trim( (string) $in['feed_subdir'], " \t\n\r\0\x0B/" ) : $d['feed_subdir'];
		if ( ! preg_match( '#^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+){0,3}$#', $subdir ) ) {
			$subdir = $d['feed_subdir'];
		}
		$out['feed_subdir'] = $subdir;

		$out['max_feeds_per_account'] = max( 1, min( 50, (int) ( isset( $in['max_feeds_per_account'] ) ? $in['max_feeds_per_account'] : $d['max_feeds_per_account'] ) ) );
		$out['max_releases']          = max( 1, min( 1000, (int) ( isset( $in['max_releases'] ) ? $in['max_releases'] : $d['max_releases'] ) ) );
		$out['session_hours']         = max( 1, min( 24 * 30, (int) ( isset( $in['session_hours'] ) ? $in['session_hours'] : $d['session_hours'] ) ) );

		$relays = array();
		$raw    = isset( $in['relays'] ) ? (string) $in['relays'] : '';
		foreach ( preg_split( '/[\r\n]+/', $raw ) as $line ) {
			$line = trim( $line );
			if ( preg_match( '#^wss://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$#', $line ) && strlen( $line ) <= 200 ) {
				$relays[] = $line;
			}
		}
		$relays        = array_slice( array_values( array_unique( $relays ) ), 0, 8 );
		$out['relays'] = $relays ? $relays : $d['relays'];

		$suggested = isset( $in['default_suggested'] ) ? trim( (string) $in['default_suggested'] ) : '';
		if ( '' !== $suggested && ! preg_match( '/^\d{1,3}(\.\d{1,9})?$/', $suggested ) ) {
			$suggested = $d['default_suggested'];
		}
		$out['default_suggested'] = $suggested;

		$method                      = isset( $in['default_value_method'] ) ? (string) $in['default_value_method'] : $d['default_value_method'];
		$out['default_value_method'] = in_array( $method, array( 'keysend', 'lnaddress' ), true ) ? $method : $d['default_value_method'];

		$tokens = array();
		$raw    = isset( $in['extra_rel_tokens'] ) ? strtolower( (string) $in['extra_rel_tokens'] ) : '';
		foreach ( preg_split( '/[\s,]+/', $raw ) as $t ) {
			if ( preg_match( '/^[a-z0-9][a-z0-9_-]{0,31}$/', $t ) ) {
				$tokens[] = $t;
			}
		}
		$out['extra_rel_tokens'] = implode( ' ', array_slice( array_values( array_unique( $tokens ) ), 0, 20 ) );

		$platform = array();
		$total    = 0;
		if ( isset( $in['platform'] ) && is_array( $in['platform'] ) ) {
			foreach ( $in['platform'] as $row ) {
				if ( ! is_array( $row ) ) {
					continue;
				}
				$name    = isset( $row['name'] ) ? trim( preg_replace( '/[\x00-\x1F\x7F]+/', ' ', (string) $row['name'] ) ) : '';
				$address = isset( $row['address'] ) ? trim( (string) $row['address'] ) : '';
				$type    = isset( $row['type'] ) && 'node' === $row['type'] ? 'node' : 'lnaddress';
				$split   = isset( $row['split'] ) ? (int) $row['split'] : 0;
				if ( '' === $name && '' === $address ) {
					continue;
				}
				if ( '' === $name || mb_strlen( $name ) > 100 || $split < 1 || $split > 99 ) {
					continue;
				}
				if ( 'lnaddress' === $type && ! preg_match( '/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/', $address ) ) {
					continue;
				}
				if ( 'node' === $type && ! preg_match( '/^[0-9a-fA-F]{66}$/', $address ) ) {
					continue;
				}
				if ( $total + $split > 99 ) {
					continue;
				}
				$total     += $split;
				$platform[] = array(
					'name'    => $name,
					'address' => $address,
					'split'   => $split,
					'type'    => $type,
				);
			}
		}
		$out['platform_recipients'] = $platform;

		return $out;
	}
}
