<?php
/**
 * Runs when the plugin is deleted from the Plugins screen.
 * Data is only removed if "Delete accounts, feeds and settings" was ticked.
 * Published XML files in the uploads folder are left in place.
 *
 * @package MSP_Publisher_Feeds
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

define( 'MSPF_DIR', plugin_dir_path( __FILE__ ) );
require_once MSPF_DIR . 'includes/class-mspf-settings.php';
require_once MSPF_DIR . 'includes/class-mspf-installer.php';

if ( MSPF_Settings::get( 'delete_data_on_uninstall' ) ) {
	MSPF_Installer::drop_tables();
}
