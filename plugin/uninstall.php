<?php
/**
 * Runs when the plugin is deleted from the Plugins screen.
 * Data is only removed if "Delete accounts, feeds and settings" was ticked.
 * Published XML files in the uploads folder are left in place.
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

define( 'PFG_DIR', plugin_dir_path( __FILE__ ) );
require_once PFG_DIR . 'includes/class-pfg-settings.php';
require_once PFG_DIR . 'includes/class-pfg-installer.php';

if ( PFG_Settings::get( 'delete_data_on_uninstall' ) ) {
	PFG_Installer::drop_tables();
}
