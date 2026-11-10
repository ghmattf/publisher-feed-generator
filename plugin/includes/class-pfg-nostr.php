<?php
/**
 * Nostr primitives needed by the server: bech32 (npub), event hashing,
 * BIP-340 Schnorr signature verification (secp256k1, via GMP) and
 * NIP-98 HTTP-auth event validation.
 *
 * The server never holds or sees a private key; it only verifies signatures.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Nostr {

	const KIND_HTTP_AUTH = 27235;
	const AUTH_WINDOW    = 60; // seconds either side of "now".

	const CURVE_P  = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F';
	const CURVE_N  = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141';
	const CURVE_GX = '79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798';
	const CURVE_GY = '483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8';

	const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

	/* ------------------------------------------------------------------ */
	/* bech32 / npub                                                       */
	/* ------------------------------------------------------------------ */

	private static function bech32_polymod( array $values ) {
		$gen = array( 0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3 );
		$chk = 1;
		foreach ( $values as $v ) {
			$b   = $chk >> 25;
			$chk = ( ( $chk & 0x1ffffff ) << 5 ) ^ $v;
			for ( $i = 0; $i < 5; $i++ ) {
				if ( ( $b >> $i ) & 1 ) {
					$chk ^= $gen[ $i ];
				}
			}
		}
		return $chk;
	}

	private static function bech32_hrp_expand( $hrp ) {
		$out = array();
		$len = strlen( $hrp );
		for ( $i = 0; $i < $len; $i++ ) {
			$out[] = ord( $hrp[ $i ] ) >> 5;
		}
		$out[] = 0;
		for ( $i = 0; $i < $len; $i++ ) {
			$out[] = ord( $hrp[ $i ] ) & 31;
		}
		return $out;
	}

	private static function convert_bits( array $data, $from, $to, $pad ) {
		$acc    = 0;
		$bits   = 0;
		$ret    = array();
		$maxv   = ( 1 << $to ) - 1;
		$max_ac = ( 1 << ( $from + $to - 1 ) ) - 1;
		foreach ( $data as $value ) {
			if ( $value < 0 || ( $value >> $from ) !== 0 ) {
				return null;
			}
			$acc  = ( ( $acc << $from ) | $value ) & $max_ac;
			$bits += $from;
			while ( $bits >= $to ) {
				$bits  -= $to;
				$ret[] = ( $acc >> $bits ) & $maxv;
			}
		}
		if ( $pad ) {
			if ( $bits > 0 ) {
				$ret[] = ( $acc << ( $to - $bits ) ) & $maxv;
			}
		} elseif ( $bits >= $from || ( ( $acc << ( $to - $bits ) ) & $maxv ) ) {
			return null;
		}
		return $ret;
	}

	/**
	 * Encode a 32-byte hex public key as npub1…
	 *
	 * @param string $hex 64 hex characters.
	 * @return string|false
	 */
	public static function npub_encode( $hex ) {
		if ( ! is_string( $hex ) || ! preg_match( '/^[0-9a-f]{64}$/', $hex ) ) {
			return false;
		}
		$bytes = array_values( unpack( 'C*', hex2bin( $hex ) ) );
		$data  = self::convert_bits( $bytes, 8, 5, true );
		$hrp   = 'npub';
		$chk   = self::bech32_polymod( array_merge( self::bech32_hrp_expand( $hrp ), $data, array( 0, 0, 0, 0, 0, 0 ) ) ) ^ 1;
		$out   = $hrp . '1';
		foreach ( $data as $d ) {
			$out .= self::BECH32_CHARSET[ $d ];
		}
		for ( $i = 0; $i < 6; $i++ ) {
			$out .= self::BECH32_CHARSET[ ( $chk >> ( 5 * ( 5 - $i ) ) ) & 31 ];
		}
		return $out;
	}

	/**
	 * Decode an npub1… string to 64 lowercase hex characters (checksum verified).
	 *
	 * @param string $npub npub string.
	 * @return string|false
	 */
	public static function npub_decode( $npub ) {
		if ( ! is_string( $npub ) || strlen( $npub ) !== 63 || 0 !== strpos( $npub, 'npub1' ) ) {
			return false;
		}
		if ( strtolower( $npub ) !== $npub ) {
			return false; // Mixed or upper case is not accepted.
		}
		$data = array();
		for ( $i = 5; $i < 63; $i++ ) {
			$pos = strpos( self::BECH32_CHARSET, $npub[ $i ] );
			if ( false === $pos ) {
				return false;
			}
			$data[] = $pos;
		}
		if ( 1 !== self::bech32_polymod( array_merge( self::bech32_hrp_expand( 'npub' ), $data ) ) ) {
			return false;
		}
		$payload = array_slice( $data, 0, count( $data ) - 6 );
		$bytes   = self::convert_bits( $payload, 5, 8, false );
		if ( null === $bytes || 32 !== count( $bytes ) ) {
			return false;
		}
		return bin2hex( pack( 'C*', ...$bytes ) );
	}

	/* ------------------------------------------------------------------ */
	/* secp256k1 + BIP-340                                                 */
	/* ------------------------------------------------------------------ */

	private static function p() {
		static $v = null;
		if ( null === $v ) {
			$v = gmp_init( self::CURVE_P, 16 );
		}
		return $v;
	}

	private static function n() {
		static $v = null;
		if ( null === $v ) {
			$v = gmp_init( self::CURVE_N, 16 );
		}
		return $v;
	}

	private static function g() {
		static $v = null;
		if ( null === $v ) {
			$v = array( gmp_init( self::CURVE_GX, 16 ), gmp_init( self::CURVE_GY, 16 ) );
		}
		return $v;
	}

	/**
	 * Affine point addition. Points are array(x, y) of GMP numbers, null = infinity.
	 */
	private static function point_add( $a, $b ) {
		if ( null === $a ) {
			return $b;
		}
		if ( null === $b ) {
			return $a;
		}
		$p = self::p();
		if ( 0 === gmp_cmp( $a[0], $b[0] ) ) {
			if ( 0 !== gmp_cmp( $a[1], $b[1] ) || 0 === gmp_sign( $a[1] ) ) {
				return null; // a = -b.
			}
			$lam = gmp_mod( gmp_mul( gmp_mul( 3, gmp_mul( $a[0], $a[0] ) ), gmp_invert( gmp_mul( 2, $a[1] ), $p ) ), $p );
		} else {
			$lam = gmp_mod( gmp_mul( gmp_sub( $b[1], $a[1] ), gmp_invert( gmp_mod( gmp_sub( $b[0], $a[0] ), $p ), $p ) ), $p );
		}
		$x3 = gmp_mod( gmp_sub( gmp_sub( gmp_mul( $lam, $lam ), $a[0] ), $b[0] ), $p );
		$y3 = gmp_mod( gmp_sub( gmp_mul( $lam, gmp_sub( $a[0], $x3 ) ), $a[1] ), $p );
		return array( $x3, $y3 );
	}

	private static function point_mul( $k, $point ) {
		$result = null;
		$addend = $point;
		$bits   = strlen( gmp_strval( $k, 2 ) );
		for ( $i = 0; $i < $bits; $i++ ) {
			if ( gmp_testbit( $k, $i ) ) {
				$result = self::point_add( $result, $addend );
			}
			$addend = self::point_add( $addend, $addend );
		}
		return $result;
	}

	/**
	 * BIP-340 lift_x: the curve point with this x and an even y, or null.
	 */
	private static function lift_x( $x ) {
		$p = self::p();
		if ( gmp_cmp( $x, $p ) >= 0 ) {
			return null;
		}
		$c = gmp_mod( gmp_add( gmp_powm( $x, 3, $p ), 7 ), $p );
		$y = gmp_powm( $c, gmp_div_q( gmp_add( $p, 1 ), 4 ), $p );
		if ( 0 !== gmp_cmp( gmp_powm( $y, 2, $p ), $c ) ) {
			return null;
		}
		if ( gmp_testbit( $y, 0 ) ) {
			$y = gmp_sub( $p, $y );
		}
		return array( $x, $y );
	}

	private static function tagged_hash( $tag, $msg ) {
		$t = hash( 'sha256', $tag, true );
		return hash( 'sha256', $t . $t . $msg, true );
	}

	/**
	 * Verify a BIP-340 Schnorr signature.
	 *
	 * @param string $pubkey_hex 64 hex chars (x-only public key).
	 * @param string $msg_hex    64 hex chars (the 32-byte message, i.e. the Nostr event id).
	 * @param string $sig_hex    128 hex chars.
	 * @return bool
	 */
	public static function schnorr_verify( $pubkey_hex, $msg_hex, $sig_hex ) {
		if ( ! extension_loaded( 'gmp' ) ) {
			return false;
		}
		if ( ! preg_match( '/^[0-9a-f]{64}$/', $pubkey_hex ) || ! preg_match( '/^[0-9a-f]{64}$/', $msg_hex ) || ! preg_match( '/^[0-9a-f]{128}$/', $sig_hex ) ) {
			return false;
		}
		$p_point = self::lift_x( gmp_init( $pubkey_hex, 16 ) );
		if ( null === $p_point ) {
			return false;
		}
		$r_hex = substr( $sig_hex, 0, 64 );
		$r     = gmp_init( $r_hex, 16 );
		$s     = gmp_init( substr( $sig_hex, 64 ), 16 );
		if ( gmp_cmp( $r, self::p() ) >= 0 || gmp_cmp( $s, self::n() ) >= 0 ) {
			return false;
		}
		$e = gmp_mod(
			gmp_init( bin2hex( self::tagged_hash( 'BIP0340/challenge', hex2bin( $r_hex ) . hex2bin( $pubkey_hex ) . hex2bin( $msg_hex ) ) ), 16 ),
			self::n()
		);
		// R = s*G - e*P.
		$sg = self::point_mul( $s, self::g() );
		$ep = self::point_mul( gmp_mod( gmp_sub( self::n(), $e ), self::n() ), $p_point );
		$rr = self::point_add( $sg, $ep );
		if ( null === $rr || gmp_testbit( $rr[1], 0 ) || 0 !== gmp_cmp( $rr[0], $r ) ) {
			return false;
		}
		return true;
	}

	/* ------------------------------------------------------------------ */
	/* Nostr events                                                        */
	/* ------------------------------------------------------------------ */

	/**
	 * NIP-01 event id for the given fields.
	 */
	public static function event_id( $pubkey, $created_at, $kind, array $tags, $content ) {
		$json = wp_json_encode(
			array( 0, $pubkey, $created_at, $kind, $tags, $content ),
			JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS
		);
		if ( false === $json ) {
			return false;
		}
		return hash( 'sha256', $json );
	}

	/**
	 * Structurally validate an event and check its id and signature.
	 *
	 * @param mixed $event Decoded event.
	 * @return array|WP_Error The event (typed) on success.
	 */
	public static function verify_event( $event ) {
		$bad = new WP_Error( 'pfg_bad_event', 'Invalid Nostr event.', array( 'status' => 401 ) );
		if ( ! is_array( $event ) ) {
			return $bad;
		}
		foreach ( array( 'id', 'pubkey', 'sig', 'content' ) as $k ) {
			if ( ! isset( $event[ $k ] ) || ! is_string( $event[ $k ] ) ) {
				return $bad;
			}
		}
		if ( ! isset( $event['created_at'], $event['kind'], $event['tags'] ) || ! is_int( $event['created_at'] ) || ! is_int( $event['kind'] ) || ! is_array( $event['tags'] ) ) {
			return $bad;
		}
		if ( ! preg_match( '/^[0-9a-f]{64}$/', $event['id'] ) || ! preg_match( '/^[0-9a-f]{64}$/', $event['pubkey'] ) || ! preg_match( '/^[0-9a-f]{128}$/', $event['sig'] ) ) {
			return $bad;
		}
		if ( count( $event['tags'] ) > 20 || strlen( $event['content'] ) > 1000 ) {
			return $bad;
		}
		foreach ( $event['tags'] as $tag ) {
			if ( ! is_array( $tag ) || count( $tag ) > 8 ) {
				return $bad;
			}
			foreach ( $tag as $part ) {
				if ( ! is_string( $part ) || strlen( $part ) > 2100 ) {
					return $bad;
				}
			}
		}
		$tags = array_map( 'array_values', array_values( $event['tags'] ) );
		$id   = self::event_id( $event['pubkey'], $event['created_at'], $event['kind'], $tags, $event['content'] );
		if ( false === $id || ! hash_equals( $id, $event['id'] ) ) {
			return $bad;
		}
		if ( ! self::schnorr_verify( $event['pubkey'], $event['id'], $event['sig'] ) ) {
			return $bad;
		}
		$event['tags'] = $tags;
		return $event;
	}

	/**
	 * Normalise a URL for comparing the NIP-98 "u" tag with the URL we expect.
	 * Scheme differences between http and https are ignored (proxies such as
	 * Cloudflare can make WordPress believe it is on http).
	 */
	public static function normalize_url( $url ) {
		$url   = rawurldecode( (string) $url );
		$url   = preg_replace( '/#.*$/', '', $url );
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
			return '';
		}
		$path = isset( $parts['path'] ) ? rtrim( $parts['path'], '/' ) : '';
		$out  = strtolower( $parts['host'] );
		if ( ! empty( $parts['port'] ) && ! in_array( (int) $parts['port'], array( 80, 443 ), true ) ) {
			$out .= ':' . (int) $parts['port'];
		}
		$out .= $path;
		if ( ! empty( $parts['query'] ) ) {
			$out .= '?' . $parts['query'];
		}
		return $out;
	}

	/**
	 * Validate a NIP-98 HTTP auth event for a request, extended with a
	 * server-issued single-use nonce (tag "nonce") to prevent replay.
	 *
	 * @param mixed       $event        Decoded event.
	 * @param string      $expected_url Absolute URL the client is calling.
	 * @param string      $method       HTTP method.
	 * @param string|null $body         Raw request body; when non-empty the "payload" tag must be its sha256.
	 * @return array|WP_Error array( 'pubkey' => hex, 'nonce' => string )
	 */
	public static function validate_http_auth( $event, $expected_url, $method, $body = null ) {
		$event = self::verify_event( $event );
		if ( is_wp_error( $event ) ) {
			return $event;
		}
		$fail = static function ( $msg ) {
			return new WP_Error( 'pfg_bad_auth', $msg, array( 'status' => 401 ) );
		};
		if ( self::KIND_HTTP_AUTH !== $event['kind'] ) {
			return $fail( 'Wrong event kind.' );
		}
		if ( abs( time() - $event['created_at'] ) > self::AUTH_WINDOW ) {
			return $fail( 'The signed request is too old or its clock is off. Try again.' );
		}
		$u      = null;
		$m      = null;
		$payload = null;
		$nonce  = null;
		foreach ( $event['tags'] as $tag ) {
			if ( count( $tag ) < 2 ) {
				continue;
			}
			if ( 'u' === $tag[0] && null === $u ) {
				$u = $tag[1];
			} elseif ( 'method' === $tag[0] && null === $m ) {
				$m = $tag[1];
			} elseif ( 'payload' === $tag[0] && null === $payload ) {
				$payload = $tag[1];
			} elseif ( 'nonce' === $tag[0] && null === $nonce ) {
				$nonce = $tag[1];
			}
		}
		if ( null === $u || self::normalize_url( $u ) !== self::normalize_url( $expected_url ) || '' === self::normalize_url( $u ) ) {
			return $fail( 'The signed URL does not match.' );
		}
		if ( null === $m || strtoupper( $m ) !== strtoupper( $method ) ) {
			return $fail( 'The signed method does not match.' );
		}
		if ( null !== $body && '' !== $body ) {
			if ( null === $payload || ! hash_equals( hash( 'sha256', $body ), strtolower( $payload ) ) ) {
				return $fail( 'The signed payload hash does not match the request body.' );
			}
		}
		if ( null === $nonce || ! preg_match( '/^[0-9a-f]{32,64}$/', $nonce ) ) {
			return $fail( 'Missing nonce.' );
		}
		return array(
			'pubkey' => $event['pubkey'],
			'nonce'  => $nonce,
		);
	}
}
