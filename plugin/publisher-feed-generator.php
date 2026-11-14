<?php
/**
 * Plugin Name:       Publisher Feed Generator
 * Description:       Lets labels, studios, engineers, hosts and artists generate Podcasting 2.0 publisher feeds (podcast:medium "publisher"). Feeds can be exported and self-hosted, or hosted here with Nostr remote-signer (NIP-46) login. Use the [publisher_feed_generator] shortcode.
 * Version:           0.5.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Phafe
 * License:           GPL-2.0-or-later
 * Text Domain:       publisher-feed-generator
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'PFG_VERSION', '0.5.0' );
define( 'PFG_FILE', __FILE__ );
define( 'PFG_DIR', plugin_dir_path( __FILE__ ) );
define( 'PFG_URL', plugin_dir_url( __FILE__ ) );

require_once PFG_DIR . 'includes/class-pfg-settings.php';
require_once PFG_DIR . 'includes/class-pfg-installer.php';
require_once PFG_DIR . 'includes/class-pfg-nostr.php';
require_once PFG_DIR . 'includes/class-pfg-feed.php';
require_once PFG_DIR . 'includes/class-pfg-xml.php';
require_once PFG_DIR . 'includes/class-pfg-storage.php';
require_once PFG_DIR . 'includes/class-pfg-auth.php';
require_once PFG_DIR . 'includes/class-pfg-lookup.php';
require_once PFG_DIR . 'includes/class-pfg-rest.php';
require_once PFG_DIR . 'includes/class-pfg-shortcode.php';
require_once PFG_DIR . 'includes/class-pfg-admin.php';

register_activation_hook( __FILE__, array( 'PFG_Installer', 'activate' ) );

/**
 * Bootstrap.
 */
function pfg_init() {
	PFG_Installer::maybe_upgrade();
	PFG_Shortcode::init();
	PFG_Rest::init();
	if ( is_admin() ) {
		PFG_Admin::init();
	}
}
add_action( 'plugins_loaded', 'pfg_init' );

/**
 * Whether the server can verify Nostr (BIP-340) signatures, which hosting needs.
 *
 * @return bool
 */
function pfg_hosting_available() {
	return extension_loaded( 'gmp' ) && (bool) PFG_Settings::get( 'hosting_enabled' );
}
