<?php
/**
 * Server-side lookups used by the Releases section:
 *  - fetch a release feed from a URL (so the page can check it links back)
 *  - search the Music Index API for releases
 *
 * Both run on the server because browsers cannot read other sites' feeds or
 * call third-party APIs freely. Neither needs an account.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Lookup {

	const MI_BASE       = 'https://api.musicindex.org/v1';
	const MAX_FEED_SIZE = 2097152; // 2 MB.
	const MAX_RESULTS   = 8;
	const TTL_DETAILS   = DAY_IN_SECONDS;

	/**
	 * Fetch the XML of a feed. https only; WordPress's "safe" HTTP functions
	 * refuse private/internal addresses, including on redirects.
	 *
	 * @return string|WP_Error
	 */
	public static function fetch_feed( $url ) {
		$url = is_string( $url ) ? trim( $url ) : '';
		if ( '' === $url || strlen( $url ) > 2000 || ! preg_match( '#^https://[^\s<>"\']+$#i', $url ) ) {
			return new WP_Error( 'pfg_bad_url', 'Enter a full https:// feed address.', array( 'status' => 422 ) );
		}
		$res = wp_safe_remote_get(
			$url,
			array(
				'timeout'             => 8,
				'redirection'         => 3,
				'limit_response_size' => self::MAX_FEED_SIZE + 1,
				'headers'             => array(
					'Accept'     => 'application/rss+xml, application/xml, text/xml, */*;q=0.5',
					'User-Agent' => 'PublisherFeedGenerator/1.0 (' . home_url() . ')',
				),
			)
		);
		if ( is_wp_error( $res ) ) {
			return new WP_Error( 'pfg_fetch_failed', 'Could not reach that address. Check the link, or paste the XML instead.', array( 'status' => 502 ) );
		}
		$code = (int) wp_remote_retrieve_response_code( $res );
		if ( 200 !== $code ) {
			return new WP_Error( 'pfg_fetch_failed', sprintf( 'That address answered with HTTP %d. Check the link, or paste the XML instead.', $code ), array( 'status' => 502 ) );
		}
		$body = (string) wp_remote_retrieve_body( $res );
		if ( strlen( $body ) > self::MAX_FEED_SIZE ) {
			return new WP_Error( 'pfg_too_big', 'That feed is too large (2 MB limit).', array( 'status' => 413 ) );
		}
		if ( '' === trim( $body ) ) {
			return new WP_Error( 'pfg_fetch_failed', 'That address returned nothing.', array( 'status' => 502 ) );
		}
		return $body;
	}

	/** GET against the Music Index API. Returns decoded array or null. */
	private static function mi_get( $path ) {
		$res = wp_remote_get(
			self::MI_BASE . $path,
			array(
				'timeout'     => 6,
				'redirection' => 0,
				'headers'     => array( 'User-Agent' => 'PublisherFeedGenerator/1.0 (' . home_url() . ')' ),
			)
		);
		if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			return null;
		}
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		return is_array( $body ) ? $body : null;
	}

	private static function is_guid( $g ) {
		return is_string( $g ) && (bool) preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $g );
	}

	private static function str( $v, $max = 300 ) {
		$v = is_scalar( $v ) ? trim( preg_replace( '/[\x00-\x1F\x7F]+/', ' ', (string) $v ) ) : '';
		return function_exists( 'mb_substr' ) ? mb_substr( $v, 0, $max ) : substr( $v, 0, $max );
	}

	private static function https_or_empty( $u ) {
		$u = self::str( $u, 2000 );
		return preg_match( '#^https://[^\s<>"\']+$#i', $u ) ? $u : '';
	}

	/** Details for one album/feed GUID (cached). */
	private static function feed_details( $guid ) {
		$key    = 'pfg_mi_' . md5( strtolower( $guid ) );
		$cached = get_transient( $key );
		if ( is_array( $cached ) ) {
			return $cached;
		}
		$body = self::mi_get( '/feeds/' . rawurlencode( $guid ) );
		if ( ! $body || empty( $body['data']['title'] ) || ! is_array( $body['data'] ) ) {
			return null;
		}
		$d   = $body['data'];
		$out = array(
			'guid'    => strtolower( $guid ),
			'title'   => self::str( $d['title'], 200 ),
			'artist'  => self::str( isset( $d['release_artist'] ) ? $d['release_artist'] : '', 200 ),
			'image'   => self::https_or_empty( isset( $d['image_url'] ) ? $d['image_url'] : '' ),
			// The API may or may not return the feed address; the page asks the user when it does not.
			'feedUrl' => self::https_or_empty( isset( $d['feed_url'] ) ? $d['feed_url'] : ( isset( $d['url'] ) ? $d['url'] : '' ) ),
			'medium'  => self::str( isset( $d['medium'] ) ? $d['medium'] : 'music', 30 ),
		);
		set_transient( $key, $out, self::TTL_DETAILS );
		return $out;
	}

	/**
	 * Search Music Index. Track hits are mapped to their album; duplicates are dropped.
	 *
	 * @return array|WP_Error list of release suggestions.
	 */
	public static function search( $q ) {
		// A pasted feed address can be long; a text search stays short.
		$q = self::str( $q, preg_match( '#^https?://#i', trim( (string) $q ) ) ? 400 : 100 );
		if ( function_exists( 'mb_strlen' ) ? mb_strlen( $q ) < 2 : strlen( $q ) < 2 ) {
			return new WP_Error( 'pfg_bad_query', 'Type at least 2 characters.', array( 'status' => 422 ) );
		}
		$body = self::mi_get( '/search?q=' . rawurlencode( $q ) . '&limit=20' );
		if ( null === $body ) {
			return new WP_Error( 'pfg_mi_down', 'Music Index could not be reached. Try again, or paste the release feed address in the search box.', array( 'status' => 502 ) );
		}
		$seen = array();
		$out  = array();
		$rows = isset( $body['data'] ) && is_array( $body['data'] ) ? $body['data'] : array();
		foreach ( $rows as $hit ) {
			if ( ! is_array( $hit ) || empty( $hit['entity_type'] ) || empty( $hit['entity_id'] ) ) {
				continue;
			}
			$guid = 'track' === $hit['entity_type'] ? ( isset( $hit['feed_guid'] ) ? $hit['feed_guid'] : '' ) : $hit['entity_id'];
			if ( ! self::is_guid( $guid ) || isset( $seen[ strtolower( $guid ) ] ) ) {
				continue;
			}
			$seen[ strtolower( $guid ) ] = true;
			$d = self::feed_details( $guid );
			if ( $d ) {
				$out[] = $d;
			}
			if ( count( $out ) >= self::MAX_RESULTS ) {
				break;
			}
		}
		return $out;
	}
}
