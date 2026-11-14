<?php
/**
 * Builds the publisher-feed XML. Mirrored by buildXml() in assets/js/pfg-core.js;
 * both must produce byte-identical output for the same input.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Xml {

	const NS_PODCAST = 'https://podcastindex.org/namespace/1.0';
	const NS_ITUNES  = 'http://www.itunes.com/dtds/podcast-1.0.dtd';
	const NS_ATOM    = 'http://www.w3.org/2005/Atom';

	public static function esc_text( $s ) {
		return str_replace( array( '&', '<', '>' ), array( '&amp;', '&lt;', '&gt;' ), (string) $s );
	}

	public static function esc_attr( $s ) {
		return str_replace( array( '&', '<', '>', '"' ), array( '&amp;', '&lt;', '&gt;', '&quot;' ), (string) $s );
	}

	/**
	 * @param array $m        Normalised model.
	 * @param array $platform Platform recipients to append to the value block.
	 * @param int   $now      Unix time for lastBuildDate.
	 * @return string
	 */
	public static function build( $m, $platform, $now ) {
		$i4 = '    ';
		$i8 = $i4 . $i4;
		$i12 = $i8 . $i4;
		$o  = array();

		$o[] = '<?xml version="1.0" encoding="UTF-8"?>';
		$o[] = '<rss xmlns:podcast="' . self::NS_PODCAST . '" xmlns:itunes="' . self::NS_ITUNES . '" xmlns:atom="' . self::NS_ATOM . '" version="2.0">';
		$o[] = $i4 . '<channel>';

		if ( '' !== $m['feedUrl'] ) {
			$o[] = $i8 . '<atom:link href="' . self::esc_attr( $m['feedUrl'] ) . '" rel="self" type="application/rss+xml" />';
		}
		if ( ! empty( $m['newFeedUrl'] ) ) {
			$o[] = $i8 . '<itunes:new-feed-url>' . self::esc_text( $m['newFeedUrl'] ) . '</itunes:new-feed-url>';
		}
		$o[] = $i8 . '<title>' . self::esc_text( $m['title'] ) . '</title>';
		if ( '' !== $m['author'] ) {
			$o[] = $i8 . '<itunes:author>' . self::esc_text( $m['author'] ) . '</itunes:author>';
		}
		$o[] = $i8 . '<description>' . self::esc_text( $m['description'] ) . '</description>';
		if ( '' !== $m['link'] ) {
			$o[] = $i8 . '<link>' . self::esc_text( $m['link'] ) . '</link>';
		}
		$o[] = $i8 . '<language>' . self::esc_text( $m['language'] ) . '</language>';
		$o[] = $i8 . '<generator>Phafe RSS Feed</generator>';
		if ( ! empty( $m['created'] ) ) {
			$o[] = $i8 . '<pubDate>' . gmdate( 'D, d M Y H:i:s', (int) $m['created'] ) . ' GMT</pubDate>';
		}
		$o[] = $i8 . '<lastBuildDate>' . gmdate( 'D, d M Y H:i:s', $now ) . ' GMT</lastBuildDate>';
		$o[] = $i8 . '<podcast:guid>' . self::esc_text( $m['guid'] ) . '</podcast:guid>';
		if ( '' !== $m['npub'] ) {
			$o[] = $i8 . '<podcast:txt purpose="npub">' . self::esc_text( $m['npub'] ) . '</podcast:txt>';
		}
		if ( '' !== $m['category'] ) {
			$o[] = $i8 . '<itunes:category text="' . self::esc_attr( $m['category'] ) . '" />';
		}
		if ( '' !== $m['keywords'] ) {
			$o[] = $i8 . '<itunes:keywords>' . self::esc_text( $m['keywords'] ) . '</itunes:keywords>';
		}
		if ( '' !== $m['image'] ) {
			$o[] = $i8 . '<image>';
			$o[] = $i12 . '<url>' . self::esc_text( $m['image'] ) . '</url>';
			$o[] = $i12 . '<title>' . self::esc_text( $m['title'] ) . '</title>';
			if ( '' !== $m['link'] ) {
				$o[] = $i12 . '<link>' . self::esc_text( $m['link'] ) . '</link>';
			}
			$o[] = $i8 . '</image>';
			$o[] = $i8 . '<itunes:image href="' . self::esc_attr( $m['image'] ) . '" />';
		}
		$o[] = $i8 . '<podcast:medium>publisher</podcast:medium>';
		if ( $m['explicit'] ) {
			$o[] = $i8 . '<itunes:explicit>true</itunes:explicit>'; // Apple's tag, not part of the Podcast namespace: only kept when a feed already has it.
		}
		if ( '' !== $m['ownerName'] || '' !== $m['ownerEmail'] ) {
			$o[] = $i8 . '<itunes:owner>';
			if ( '' !== $m['ownerName'] ) {
				$o[] = $i12 . '<itunes:name>' . self::esc_text( $m['ownerName'] ) . '</itunes:name>';
			}
			if ( '' !== $m['ownerEmail'] ) {
				$o[] = $i12 . '<itunes:email>' . self::esc_text( $m['ownerEmail'] ) . '</itunes:email>';
			}
			$o[] = $i8 . '</itunes:owner>';
		}

		$recips = $m['value']['recipients'] ? array_merge( $m['value']['recipients'], is_array( $platform ) ? $platform : array() ) : array();
		if ( $recips ) {
			$attrs = ' type="lightning" method="' . self::esc_attr( $m['value']['method'] ) . '"';
			if ( '' !== $m['value']['suggested'] ) {
				$attrs .= ' suggested="' . self::esc_attr( $m['value']['suggested'] ) . '"';
			}
			$o[] = $i8 . '<podcast:value' . $attrs . '>';
			foreach ( $recips as $r ) {
				$a = ' name="' . self::esc_attr( $r['name'] ) . '" address="' . self::esc_attr( $r['address'] ) . '" split="' . (int) $r['split'] . '" type="' . self::esc_attr( $r['type'] ) . '"';
				if ( 'node' === $r['type'] ) {
					if ( ! empty( $r['customKey'] ) ) {
						$a .= ' customKey="' . self::esc_attr( $r['customKey'] ) . '"';
					}
					if ( ! empty( $r['customValue'] ) ) {
						$a .= ' customValue="' . self::esc_attr( $r['customValue'] ) . '"';
					}
				}
				$o[] = $i12 . '<podcast:valueRecipient' . $a . ' />';
			}
			$o[] = $i8 . '</podcast:value>';
		}

		if ( '' !== $m['funding']['url'] && '' !== $m['funding']['text'] ) {
			$o[] = $i8 . '<podcast:funding url="' . self::esc_attr( $m['funding']['url'] ) . '">' . self::esc_text( $m['funding']['text'] ) . '</podcast:funding>';
		}

		foreach ( $m['releases'] as $r ) {
			$a = ' feedGuid="' . self::esc_attr( $r['feedGuid'] ) . '" feedUrl="' . self::esc_attr( $r['feedUrl'] ) . '" medium="' . self::esc_attr( $r['medium'] ) . '"';
			if ( '' !== $r['title'] ) {
				$a .= ' title="' . self::esc_attr( $r['title'] ) . '"';
			}
			if ( '' !== $r['feedImg'] ) {
				$a .= ' feedImg="' . self::esc_attr( $r['feedImg'] ) . '"';
			}
			if ( $r['rel'] ) {
				$a .= ' rel="' . self::esc_attr( implode( ' ', $r['rel'] ) ) . '"';
			}
			if ( ! empty( $r['attrs'] ) ) {
				foreach ( $r['attrs'] as $k => $val ) {
					$a .= ' ' . $k . '="' . self::esc_attr( $val ) . '"';
				}
			}
			$o[] = $i8 . '<podcast:remoteItem' . $a . ' />';
		}

		$o[] = $i4 . '</channel>';
		$o[] = '</rss>';
		return implode( "\n", $o ) . "\n";
	}
}
