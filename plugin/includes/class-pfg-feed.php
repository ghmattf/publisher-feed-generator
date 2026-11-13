<?php
/**
 * Feed data model: normalising and validating what a client submits.
 * The JavaScript twin of this lives in assets/js/pfg-core.js and must stay in step.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Feed {

	/** Podcasting 2.0 namespace used to derive feed GUIDs (UUIDv5). */
	const GUID_NAMESPACE = 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6';

	public static function builtin_rel_tokens() {
		return array( 'artist', 'host', 'author', 'label', 'producer', 'network', 'hosting', 'sponsor', 'songwriter', 'composer', 'musician', 'studio', 'engineer' );
	}

	/** The built-in roles the page shows under "Other roles" (same list as OTHER_RELS in pfg-core.js), alphabetical. */
	public static function other_rel_tokens() {
		return array( 'author', 'host', 'hosting', 'network', 'sponsor' );
	}

	/** The built-in roles the page shows in the main list, alphabetical. */
	public static function main_rel_tokens() {
		$main = array_values( array_diff( self::builtin_rel_tokens(), self::other_rel_tokens() ) );
		sort( $main );
		return $main;
	}

	public static function mediums() {
		return array( 'music', 'podcast', 'video', 'film', 'audiobook', 'newsletter', 'blog', 'publisher', 'course' );
	}

	/* ------------------------------------------------------------------ */
	/* GUIDs                                                               */
	/* ------------------------------------------------------------------ */

	public static function uuid5( $name ) {
		$ns   = hex2bin( str_replace( '-', '', self::GUID_NAMESPACE ) );
		$hash = sha1( $ns . $name, true );
		$b    = array_values( unpack( 'C16', substr( $hash, 0, 16 ) ) );
		$b[6] = ( $b[6] & 0x0f ) | 0x50;
		$b[8] = ( $b[8] & 0x3f ) | 0x80;
		$hex  = bin2hex( pack( 'C*', ...$b ) );
		return substr( $hex, 0, 8 ) . '-' . substr( $hex, 8, 4 ) . '-' . substr( $hex, 12, 4 ) . '-' . substr( $hex, 16, 4 ) . '-' . substr( $hex, 20, 12 );
	}

	/**
	 * Podcasting 2.0 recommended GUID: UUIDv5 of the feed URL without scheme and trailing slashes.
	 */
	public static function guid_for_url( $url ) {
		$u = preg_replace( '#^[A-Za-z][A-Za-z0-9+.-]*://#', '', trim( $url ) );
		$u = rtrim( $u, '/' );
		return self::uuid5( $u );
	}

	/* ------------------------------------------------------------------ */
	/* String helpers (mirrored in JS)                                     */
	/* ------------------------------------------------------------------ */

	private static function utf8( $v ) {
		if ( ! is_string( $v ) ) {
			return is_scalar( $v ) ? (string) $v : '';
		}
		if ( ! mb_check_encoding( $v, 'UTF-8' ) ) {
			$v = mb_convert_encoding( $v, 'UTF-8', 'UTF-8' );
		}
		return $v;
	}

	public static function line( $v ) {
		$v = self::utf8( $v );
		$v = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $v );
		$v = preg_replace( '/[ \t\r\n]+/', ' ', $v );
		return trim( $v, ' ' );
	}

	public static function text( $v ) {
		$v = self::utf8( $v );
		$v = preg_replace( '/\r\n?/', "\n", $v );
		$v = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $v );
		return trim( $v, " \t\n" );
	}

	private static function len( $s ) {
		return mb_strlen( $s, 'UTF-8' );
	}

	public static function is_https_url( $u ) {
		if ( strlen( $u ) > 2048 || ! preg_match( '#^https://[^\s<>"\']+$#i', $u ) ) {
			return false;
		}
		$p = wp_parse_url( $u );
		return is_array( $p ) && ! empty( $p['host'] ) && empty( $p['user'] ) && empty( $p['pass'] );
	}

	/** Website and Image accept http:// as well as https:// (everything else stays https-only). */
	public static function is_http_url( $u ) {
		if ( strlen( $u ) > 2048 || ! preg_match( '#^https?://[^\s<>"\']+$#i', $u ) ) {
			return false;
		}
		$p = wp_parse_url( $u );
		return is_array( $p ) && ! empty( $p['host'] ) && empty( $p['user'] ) && empty( $p['pass'] );
	}

	public static function is_uuid( $s ) {
		return (bool) preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $s );
	}

	private static function get( $arr, $key ) {
		return ( is_array( $arr ) && isset( $arr[ $key ] ) ) ? $arr[ $key ] : '';
	}

	private static function err( &$errors, $path, $msg ) {
		$errors[] = array(
			'path'    => $path,
			'message' => $msg,
		);
	}

	/* ------------------------------------------------------------------ */
	/* Normalise + validate                                                */
	/* ------------------------------------------------------------------ */

	/**
	 * @param mixed $in   Client data.
	 * @param array $opts hosted(bool), guid, feed_url, platform(array), max_releases, default_method, default_suggested, extra_rel(array), allow_attrs(bool).
	 * @return array array( 'model' => array, 'errors' => array of {path,message} )
	 */
	public static function normalize( $in, $opts = array() ) {
		$opts = array_merge(
			array(
				'hosted'            => true,
				'guid'              => '',
				'feed_url'          => '',
				'platform'          => array(),
				'max_releases'      => 200,
				'default_method'    => 'lnaddress',
				'default_suggested' => '',
				'allow_attrs'       => false,
			),
			$opts
		);
		$in     = is_array( $in ) ? $in : array();
		$errors = array();
		$m      = array( 'version' => 1 );

		$m['title'] = self::line( self::get( $in, 'title' ) );
		if ( '' === $m['title'] ) {
			self::err( $errors, 'title', 'A title is required.' );
		} elseif ( self::len( $m['title'] ) > 200 ) {
			self::err( $errors, 'title', 'Title is too long (200 characters max).' );
		}

		$m['author'] = $m['title']; // itunes:author is always the Name / title (no separate Author field).

		$m['description'] = self::text( self::get( $in, 'description' ) );
		if ( '' === $m['description'] ) {
			self::err( $errors, 'description', 'A description is required.' );
		} elseif ( self::len( $m['description'] ) > 4000 ) {
			self::err( $errors, 'description', 'Description is too long (4000 characters max).' );
		}

		$m['link'] = self::line( self::get( $in, 'link' ) );
		if ( '' !== $m['link'] && ! self::is_http_url( $m['link'] ) ) {
			self::err( $errors, 'link', 'Website must be an http:// or https:// URL.' );
		}

		$m['language'] = strtolower( self::line( self::get( $in, 'language' ) ) );
		if ( '' === $m['language'] ) {
			$m['language'] = 'en';
		}
		if ( ! preg_match( '/^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/', $m['language'] ) ) {
			self::err( $errors, 'language', 'Language must be a code such as "en" or "en-au".' );
		}

		$m['image'] = self::line( self::get( $in, 'image' ) );
		if ( '' !== $m['image'] && ! self::is_http_url( $m['image'] ) ) {
			self::err( $errors, 'image', 'Image must be an http:// or https:// URL.' );
		}

		$m['category'] = self::line( self::get( $in, 'category' ) );
		if ( self::len( $m['category'] ) > 100 ) {
			self::err( $errors, 'category', 'Category is too long.' );
		}
		$m['keywords'] = self::line( self::get( $in, 'keywords' ) );
		if ( self::len( $m['keywords'] ) > 300 ) {
			self::err( $errors, 'keywords', 'Keywords are too long (300 characters max).' );
		}

		$ex            = self::get( $in, 'explicit' );
		$m['explicit'] = ( true === $ex || 'true' === $ex || 1 === $ex || '1' === $ex );

		$m['ownerName']  = self::line( self::get( $in, 'ownerName' ) );
		$m['ownerEmail'] = self::line( self::get( $in, 'ownerEmail' ) );
		if ( self::len( $m['ownerName'] ) > 200 ) {
			self::err( $errors, 'ownerName', 'Feed creator/editor is too long.' );
		}
		if ( '' !== $m['ownerEmail'] && ( self::len( $m['ownerEmail'] ) > 200 || ! preg_match( '/^[^\s@<>&"\']+@[^\s@<>&"\']+\.[^\s@<>&"\']+$/', $m['ownerEmail'] ) ) ) {
			self::err( $errors, 'ownerEmail', 'Feed contact email is not valid.' );
		}

		// Identity: hosted feeds always use the server's values.
		if ( $opts['hosted'] ) {
			$m['feedUrl'] = $opts['feed_url'];
			$m['guid']    = $opts['guid'];
		} else {
			$m['feedUrl'] = self::line( self::get( $in, 'feedUrl' ) );
			$m['guid']    = strtolower( self::line( self::get( $in, 'guid' ) ) );
			if ( '' !== $m['feedUrl'] && ! self::is_https_url( $m['feedUrl'] ) ) {
				self::err( $errors, 'feedUrl', 'Feed URL must be an https:// URL.' );
			}
			if ( '' === $m['guid'] ) {
				self::err( $errors, 'guid', 'A feed GUID is required.' );
			} elseif ( ! self::is_uuid( $m['guid'] ) ) {
				self::err( $errors, 'guid', 'GUID must be a UUID.' );
			}
		}

		// Nostr npub (metadata only; it does not have to match the login key).
		$npub = self::line( self::get( $in, 'npub' ) );
		if ( '' !== $npub ) {
			if ( preg_match( '/^[0-9a-fA-F]{64}$/', $npub ) ) {
				$npub = PFG_Nostr::npub_encode( strtolower( $npub ) );
			}
			if ( ! $npub || false === PFG_Nostr::npub_decode( $npub ) ) {
				self::err( $errors, 'npub', 'That is not a valid npub (checksum failed). Never paste an nsec.' );
				$npub = self::line( self::get( $in, 'npub' ) );
			}
		}
		$m['npub'] = $npub;

		// Funding.
		$f   = self::get( $in, 'funding' );
		$fu  = self::line( self::get( $f, 'url' ) );
		$ft  = self::line( self::get( $f, 'text' ) );
		if ( '' !== $fu && ! self::is_https_url( $fu ) ) {
			self::err( $errors, 'funding.url', 'Funding link must be an https:// URL.' );
		}
		if ( self::len( $ft ) > 100 ) {
			self::err( $errors, 'funding.text', 'Funding text is too long (100 characters max).' );
		}
		if ( '' !== $fu && '' === $ft ) {
			self::err( $errors, 'funding.text', 'Add the text for the funding link.' );
		}
		$m['funding'] = array(
			'url'  => $fu,
			'text' => $ft,
		);

		// Value block.
		$v      = self::get( $in, 'value' );
		$method = self::line( self::get( $v, 'method' ) );
		if ( '' === $method ) {
			$method = $opts['default_method'];
		}
		if ( ! in_array( $method, array( 'keysend', 'lnaddress' ), true ) ) {
			self::err( $errors, 'value.method', 'Value method must be keysend or lnaddress.' );
		}
		$suggested = self::line( self::get( $v, 'suggested' ) );
		if ( '' !== $suggested && ! preg_match( '/^\d{1,3}(\.\d{1,9})?$/', $suggested ) ) {
			self::err( $errors, 'value.suggested', 'Suggested amount must be a plain decimal such as 0.000033333 (no scientific notation).' );
		}
		$recips     = array();
		$user_total = 0;
		$raw        = self::get( $v, 'recipients' );
		$raw        = is_array( $raw ) ? array_values( $raw ) : array();
		if ( count( $raw ) > 10 ) {
			self::err( $errors, 'value.recipients', 'At most 10 payment recipients.' );
			$raw = array_slice( $raw, 0, 10 );
		}
		foreach ( $raw as $i => $r ) {
			$p    = 'value.recipients.' . $i;
			$name = self::line( self::get( $r, 'name' ) );
			$type = 'node' === self::get( $r, 'type' ) ? 'node' : 'lnaddress';
			$addr = self::line( self::get( $r, 'address' ) );
			$sp   = self::get( $r, 'split' );
			$row  = array(
				'name'    => $name,
				'address' => $addr,
				'split'   => 0,
				'type'    => $type,
			);
			if ( '' === $name || self::len( $name ) > 100 ) {
				self::err( $errors, $p . '.name', 'Each recipient needs a name (100 characters max).' );
			}
			if ( 'lnaddress' === $type && ! preg_match( '/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/', $addr ) ) {
				self::err( $errors, $p . '.address', 'Not a valid lightning address (name@domain).' );
			}
			if ( 'node' === $type ) {
				if ( ! preg_match( '/^[0-9a-fA-F]{66}$/', $addr ) ) {
					self::err( $errors, $p . '.address', 'A node address must be 66 hex characters.' );
				}
				$ck = self::line( self::get( $r, 'customKey' ) );
				$cv = self::line( self::get( $r, 'customValue' ) );
				if ( '' !== $ck && ! preg_match( '/^\d{1,20}$/', $ck ) ) {
					self::err( $errors, $p . '.customKey', 'Custom key must be a number.' );
				}
				if ( '' !== $cv && ! preg_match( '/^[\x20-\x7E]{1,128}$/', $cv ) ) {
					self::err( $errors, $p . '.customValue', 'Custom value must be plain text (128 characters max).' );
				}
				$row['customKey']   = $ck;
				$row['customValue'] = $cv;
			}
			if ( is_int( $sp ) || ( is_string( $sp ) && preg_match( '/^\d{1,3}$/', trim( $sp ) ) ) ) {
				$sp = (int) $sp;
				if ( $sp < 1 || $sp > 100 ) {
					self::err( $errors, $p . '.split', 'Split must be between 1 and 100.' );
				} else {
					$row['split'] = $sp;
				}
			} else {
				self::err( $errors, $p . '.split', 'Split must be a whole number.' );
			}
			$user_total += $row['split'];
			$recips[]    = $row;
		}
		// "Support the developers": the creator chooses a split (0 to 99) for each configured recipient.
		$support        = self::support_rows( $opts['platform'], self::get( $in, 'support' ), $errors );
		$platform_total = 0;
		foreach ( $support as $sr ) {
			$platform_total += $sr['split'];
		}
		if ( $platform_total > 99 ) {
			self::err( $errors, 'support', 'Support splits must total less than 100%.' );
		}
		$m['support'] = $support;
		// Payments are optional. With no recipients there is no value block at all.
		if ( $recips && $user_total + $platform_total !== 100 ) {
			$need = 100 - $platform_total;
			self::err(
				$errors,
				'value.recipients',
				$platform_total
					? sprintf( 'Your recipients must total %d%% - it currently totals %d%%. (Support for the developers currently totals %d%%.)', $need, $user_total, $platform_total )
					: sprintf( 'Your recipients must total 100%% - it currently totals %d%%.', $user_total )
			);
		}
		$m['value'] = array(
			'method'     => $method,
			'suggested'  => $suggested,
			'recipients' => $recips,
		);

		// Releases (podcast:remoteItem entries).
		$releases = array();
		$raw      = self::get( $in, 'releases' );
		$raw      = is_array( $raw ) ? array_values( $raw ) : array();
		if ( count( $raw ) > $opts['max_releases'] ) {
			self::err( $errors, 'releases', sprintf( 'At most %d releases.', $opts['max_releases'] ) );
			$raw = array_slice( $raw, 0, $opts['max_releases'] );
		}
		$seen = array();
		foreach ( $raw as $i => $r ) {
			$p   = 'releases.' . $i;
			$row = array(
				'feedGuid' => strtolower( self::line( self::get( $r, 'feedGuid' ) ) ),
				'feedUrl'  => self::line( self::get( $r, 'feedUrl' ) ),
				'medium'   => strtolower( self::line( self::get( $r, 'medium' ) ) ),
				'title'    => self::line( self::get( $r, 'title' ) ),
				'feedImg'  => self::line( self::get( $r, 'feedImg' ) ),
				'rel'      => array(),
				'attrs'    => array(),
			);
			if ( '' === $row['medium'] ) {
				$row['medium'] = 'music';
			}
			if ( ! self::is_uuid( $row['feedGuid'] ) ) {
				self::err( $errors, $p . '.feedGuid', 'The feed GUID must be a UUID.' );
			} elseif ( isset( $seen[ $row['feedGuid'] ] ) ) {
				self::err( $errors, $p . '.feedGuid', 'This feed is already listed.' );
			} elseif ( $row['feedGuid'] === $m['guid'] ) {
				self::err( $errors, $p . '.feedGuid', 'A feed cannot list itself.' );
			}
			$seen[ $row['feedGuid'] ] = true;
			if ( '' === $row['feedUrl'] || ! self::is_https_url( $row['feedUrl'] ) ) {
				self::err( $errors, $p . '.feedUrl', 'The feed URL must be an https:// URL.' );
			}
			if ( ! in_array( $row['medium'], self::mediums(), true ) ) {
				self::err( $errors, $p . '.medium', 'Unknown medium.' );
			}
			if ( self::len( $row['title'] ) > 200 ) {
				self::err( $errors, $p . '.title', 'Title is too long.' );
			}
			if ( '' !== $row['feedImg'] && ! self::is_https_url( $row['feedImg'] ) ) {
				self::err( $errors, $p . '.feedImg', 'Image must be an https:// URL.' );
			}
			$rel = self::get( $r, 'rel' );
			if ( is_string( $rel ) ) {
				$rel = preg_split( '/\s+/', trim( $rel ) );
			}
			$tokens = array();
			foreach ( is_array( $rel ) ? $rel : array() as $t ) {
				$t = strtolower( self::line( $t ) );
				if ( '' === $t ) {
					continue;
				}
				if ( ! preg_match( '/^[a-z0-9][a-z0-9_-]{0,31}$/', $t ) ) {
					self::err( $errors, $p . '.rel', 'Roles may only use letters, numbers, "-" and "_".' );
					continue;
				}
				if ( ! in_array( $t, $tokens, true ) ) {
					$tokens[] = $t;
				}
			}
			if ( count( $tokens ) > 8 ) {
				self::err( $errors, $p . '.rel', 'At most 8 roles per release.' );
				$tokens = array_slice( $tokens, 0, 8 );
			}
			$row['rel'] = $tokens;
			if ( $opts['allow_attrs'] ) {
				$extra = self::get( $r, 'attrs' );
				if ( is_array( $extra ) ) {
					ksort( $extra );
					foreach ( $extra as $k => $val ) {
						if ( is_string( $k ) && preg_match( '/^[A-Za-z_][A-Za-z0-9_.:-]{0,40}$/', $k ) && ! in_array( $k, array( 'feedGuid', 'feedUrl', 'medium', 'title', 'feedImg', 'rel' ), true ) ) {
							$row['attrs'][ $k ] = self::line( $val );
						}
					}
				}
			}
			$releases[] = $row;
		}
		$m['releases'] = $releases;

		return array(
			'model'  => $m,
			'errors' => $errors,
		);
	}

	/**
	 * The creator's chosen split for each configured support recipient.
	 * Names, addresses and types always come from the configured list; only the split is theirs (0 to 99).
	 *
	 * @param array $platform Configured support recipients (name, address, split, type).
	 * @param mixed $input    Client rows: [ { address, split } ].
	 * @param array $errors   Collected errors.
	 * @return array [ { address, split } ] in the configured order.
	 */
	public static function support_rows( $platform, $input, &$errors ) {
		$input  = is_array( $input ) ? array_values( $input ) : array();
		$chosen = array();
		foreach ( $input as $i => $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$key = strtolower( self::line( self::get( $row, 'address' ) ) );
			if ( '' !== $key && ! isset( $chosen[ $key ] ) ) {
				$chosen[ $key ] = array( $i, self::get( $row, 'split' ) );
			}
		}
		$rows = array();
		foreach ( (array) $platform as $pr ) {
			$split = (int) $pr['split'];
			$key   = strtolower( $pr['address'] );
			if ( isset( $chosen[ $key ] ) ) {
				list( $i, $sp ) = $chosen[ $key ];
				if ( is_int( $sp ) || ( is_string( $sp ) && preg_match( '/^\d{1,2}$/', trim( $sp ) ) ) ) {
					$sp = (int) $sp;
					if ( $sp >= 0 && $sp <= 99 ) {
						$split = $sp;
					} else {
						self::err( $errors, 'support.' . $i . '.split', 'Support split must be a whole number from 0 to 99.' );
					}
				} else {
					self::err( $errors, 'support.' . $i . '.split', 'Support split must be a whole number from 0 to 99.' );
				}
			}
			$rows[] = array( 'address' => $pr['address'], 'split' => $split );
		}
		return $rows;
	}

	/**
	 * The support recipients that go into the feed: configured name/address/type with the creator's split,
	 * leaving out any set to 0. Without chosen splits the configured defaults apply.
	 */
	public static function active_platform( $platform, $support ) {
		$by = array();
		foreach ( is_array( $support ) ? $support : array() as $row ) {
			if ( is_array( $row ) && isset( $row['address'], $row['split'] ) ) {
				$by[ strtolower( (string) $row['address'] ) ] = (int) $row['split'];
			}
		}
		$out = array();
		foreach ( (array) $platform as $pr ) {
			$key   = strtolower( $pr['address'] );
			$split = isset( $by[ $key ] ) ? $by[ $key ] : (int) $pr['split'];
			if ( $split > 0 ) {
				$pr['split'] = $split;
				$out[]       = $pr;
			}
		}
		return $out;
	}

	/**
	 * The part of the model that controls where money goes (used to decide
	 * whether an update needs a fresh signature).
	 */
	public static function payment_fingerprint( $model ) {
		$v = isset( $model['value'] ) ? $model['value'] : array();
		return hash(
			'sha256',
			wp_json_encode(
				array(
					isset( $v['method'] ) ? $v['method'] : '',
					isset( $v['suggested'] ) ? $v['suggested'] : '',
					isset( $v['recipients'] ) ? $v['recipients'] : array(),
					isset( $model['support'] ) ? $model['support'] : array(), // support splits redirect value too
				)
			)
		);
	}
}
