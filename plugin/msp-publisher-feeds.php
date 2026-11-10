<?php
/**
 * Plugin Name:       MSP Publisher Feeds
 * Description:       Lets labels, studios, engineers, hosts and artists generate Podcasting 2.0 publisher feeds (podcast:medium "publisher"). Feeds can be exported and self-hosted, or hosted here with Nostr remote-signer (NIP-46) login. Use the [msp_feed_generator] shortcode.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Phafe
 * License:           GPL-2.0-or-later
 * Text Domain:       msp-publisher-feeds
 *
 * @package MSP_Publisher_Feeds
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'MSPF_VERSION', '1.0.0' );
define( 'MSPF_FILE', __FILE__ );
define( 'MSPF_DIR', plugin_dir_path( __FILE__ ) );
define( 'MSPF_URL', plugin_dir_url( __FILE__ ) );

require_once MSPF_DIR . 'includes/class-mspf-settings.php';
require_once MSPF_DIR . 'includes/class-mspf-installer.php';
require_once MSPF_DIR . 'includes/class-mspf-nostr.php';
require_once MSPF_DIR . 'includes/class-mspf-feed.php';
require_once MSPF_DIR . 'includes/class-mspf-xml.php';
require_once MSPF_DIR . 'includes/class-mspf-storage.php';
require_once MSPF_DIR . 'includes/class-mspf-auth.php';
require_once MSPF_DIR . 'includes/class-mspf-lookup.php';
require_once MSPF_DIR . 'includes/class-mspf-rest.php';
require_once MSPF_DIR . 'includes/class-mspf-shortcode.php';
require_once MSPF_DIR . 'includes/class-mspf-admin.php';

register_activation_hook( __FILE__, array( 'MSPF_Installer', 'activate' ) );

/**
 * Bootstrap.
 */
function mspf_init() {
	MSPF_Installer::maybe_upgrade();
	MSPF_Shortcode::init();
	MSPF_Rest::init();
	if ( is_admin() ) {
		MSPF_Admin::init();
	}
}
add_action( 'plugins_loaded', 'mspf_init' );

/**
 * Whether the server can verify Nostr (BIP-340) signatures, which hosting needs.
 *
 * @return bool
 */
function mspf_hosting_available() {
	return extension_loaded( 'gmp' ) && (bool) MSPF_Settings::get( 'hosting_enabled' );
}
