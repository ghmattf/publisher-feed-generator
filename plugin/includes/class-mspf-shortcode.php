<?php
/**
 * [msp_feed_generator] shortcode: renders the generator app.
 *
 * @package MSP_Publisher_Feeds
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class MSPF_Shortcode {

	public static function init() {
		add_shortcode( 'msp_feed_generator', array( __CLASS__, 'render' ) );
	}

	private static function asset( $rel ) {
		$path = MSPF_DIR . $rel;
		return array(
			'url' => MSPF_URL . $rel,
			'ver' => file_exists( $path ) ? (string) filemtime( $path ) : MSPF_VERSION,
		);
	}

	private static function enqueue() {
		$css = self::asset( 'assets/css/generator.css' );
		wp_enqueue_style( 'mspf-generator', $css['url'], array(), $css['ver'] );

		$scripts = array(
			'mspf-nostr'   => 'assets/js/nostr-bundle.js',
			'mspf-core'    => 'assets/js/mspf-core.js',
			'mspf-hosting' => 'assets/js/mspf-hosting.js',
			'mspf-editor'  => 'assets/js/mspf-editor.js',
			'mspf-app'     => 'assets/js/mspf-app.js',
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
		$config = wp_json_encode( MSPF_Rest::client_config(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );
		ob_start();
		?>
		<div id="mspf-app" class="mspf-app">
			<noscript><p>This page needs JavaScript to build your feed.</p></noscript>
		</div>
		<script type="application/json" id="mspf-config"><?php echo $config; // phpcs:ignore WordPress.Security.EscapeOutput ?></script>
		<?php
		return ob_get_clean();
	}
}
