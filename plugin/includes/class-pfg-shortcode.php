<?php
/**
 * [publisher_feed_generator] shortcode: renders the generator app.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Shortcode {

	public static function init() {
		add_shortcode( 'publisher_feed_generator', array( __CLASS__, 'render' ) );
	}

	private static function asset( $rel ) {
		$path = PFG_DIR . $rel;
		return array(
			'url' => PFG_URL . $rel,
			'ver' => file_exists( $path ) ? (string) filemtime( $path ) : PFG_VERSION,
		);
	}

	private static function enqueue() {
		$css = self::asset( 'assets/css/generator.css' );
		wp_enqueue_style( 'pfg-generator', $css['url'], array(), $css['ver'] );

		$scripts = array(
			'pfg-nostr'   => 'assets/js/nostr-bundle.js',
			'pfg-core'    => 'assets/js/pfg-core.js',
			'pfg-hosting' => 'assets/js/pfg-hosting.js',
			'pfg-editor'  => 'assets/js/pfg-editor.js',
			'pfg-app'     => 'assets/js/pfg-app.js',
		);
		$prev = array();
		foreach ( $scripts as $handle => $rel ) {
			$a = self::asset( $rel );
			wp_enqueue_script( $handle, $a['url'], $prev, $a['ver'], true );
			$prev = array( $handle );
		}
	}

	public static function render( $atts = array() ) {
		self::enqueue();
		$config = wp_json_encode( PFG_Rest::client_config(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );
		ob_start();
		?>
		<div id="pfg-app" class="pfg-app">
			<noscript><p>This page needs JavaScript to build your feed.</p></noscript>
		</div>
		<script type="application/json" id="pfg-config"><?php echo $config; // phpcs:ignore WordPress.Security.EscapeOutput ?></script>
		<?php
		return ob_get_clean();
	}
}
