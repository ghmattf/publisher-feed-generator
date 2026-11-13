<?php
/**
 * Admin: settings and moderation (Settings → Publisher Feeds).
 *
 * @package Publisher_Feed_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PFG_Admin {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		add_action( 'admin_post_pfg_feed_action', array( __CLASS__, 'handle_action' ) );
	}

	public static function menu() {
		add_options_page( 'Publisher Feeds', 'Publisher Feeds', 'manage_options', 'pfg', array( __CLASS__, 'page' ) );
	}

	public static function register() {
		register_setting(
			'pfg',
			PFG_Settings::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( 'PFG_Settings', 'sanitize' ),
				'default'           => PFG_Settings::defaults(),
			)
		);
	}

	/* ------------------------------------------------------------------ */
	/* Moderation actions                                                  */
	/* ------------------------------------------------------------------ */

	public static function handle_action() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Not allowed.', 403 );
		}
		$id = isset( $_POST['feed_id'] ) ? (int) $_POST['feed_id'] : 0;
		$do = isset( $_POST['do'] ) ? sanitize_key( wp_unslash( $_POST['do'] ) ) : '';
		check_admin_referer( 'pfg_feed_action_' . $id );

		$feed   = $id ? PFG_Storage::get_feed( $id ) : null;
		$notice = 'nothing';
		if ( $feed ) {
			switch ( $do ) {
				case 'approve':
				case 'unsuspend':
					if ( 'deleted' !== $feed['status'] ) {
						$model = PFG_Storage::decode_model( $feed );
						$res   = $model ? PFG_Storage::publish( $feed, $model ) : new WP_Error( 'x', 'No data' );
						if ( is_wp_error( $res ) ) {
							$notice = 'writefail';
						} else {
							PFG_Storage::set_feed_status( $id, 'published' );
							$notice = 'published';
						}
					}
					break;
				case 'suspend':
					PFG_Storage::delete_file( $feed['slug'] );
					PFG_Storage::set_feed_status( $id, 'suspended' );
					$notice = 'suspended';
					break;
				case 'delete':
					PFG_Storage::tombstone_feed( $feed );
					$notice = 'deleted';
					break;
				case 'block':
					PFG_Storage::set_account_status( (int) $feed['account_id'], 'blocked' );
					PFG_Auth::destroy_account_sessions( (int) $feed['account_id'] );
					global $wpdb;
					$t    = PFG_Installer::table( 'feeds' );
					$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, slug FROM {$t} WHERE account_id = %d AND status = 'published'", (int) $feed['account_id'] ), ARRAY_A ); // phpcs:ignore
					foreach ( (array) $rows as $row ) {
						PFG_Storage::delete_file( $row['slug'] );
						PFG_Storage::set_feed_status( (int) $row['id'], 'suspended' );
					}
					$notice = 'blocked';
					break;
				case 'unblock':
					PFG_Storage::set_account_status( (int) $feed['account_id'], 'active' );
					$notice = 'unblocked';
					break;
			}
		}
		wp_safe_redirect( add_query_arg( array( 'page' => 'pfg', 'pfg_notice' => $notice ), admin_url( 'options-general.php' ) ) );
		exit;
	}

	/* ------------------------------------------------------------------ */
	/* Page                                                                */
	/* ------------------------------------------------------------------ */

	private static function field_name( $key ) {
		return PFG_Settings::OPTION . '[' . $key . ']';
	}

	public static function page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$s       = PFG_Settings::all();
		$notices = array(
			'published' => 'Feed published.',
			'suspended' => 'Feed suspended and its file removed.',
			'deleted'   => 'Feed deleted. Its name stays reserved.',
			'blocked'   => 'Account blocked, its sessions ended and its feeds suspended.',
			'unblocked' => 'Account unblocked. Its feeds stay suspended until you unsuspend them.',
			'writefail' => 'The feed file could not be written. Check the uploads folder permissions.',
		);
		$notice  = isset( $_GET['pfg_notice'] ) ? sanitize_key( wp_unslash( $_GET['pfg_notice'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		?>
		<div class="wrap">
			<h1>Publisher Feeds</h1>
			<p class="description">Publisher Feed Generator version <strong><?php echo esc_html( PFG_VERSION ); ?></strong></p>
			<?php if ( isset( $notices[ $notice ] ) ) : ?>
				<div class="notice notice-info is-dismissible"><p><?php echo esc_html( $notices[ $notice ] ); ?></p></div>
			<?php endif; ?>
			<?php if ( ! extension_loaded( 'gmp' ) ) : ?>
				<div class="notice notice-error"><p><strong>The PHP GMP extension is not installed.</strong> Hosting is switched off because the server cannot verify Nostr signatures without it. Ask your host to enable <code>gmp</code>. The generator, import and export still work.</p></div>
			<?php endif; ?>

			<p>Add the generator to any page with the shortcode <code>[publisher_feed_generator]</code>.</p>

			<form method="post" action="options.php">
				<?php settings_fields( 'pfg' ); ?>
				<h2>Hosting</h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Hosted feeds</th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( self::field_name( 'hosting_enabled' ) ); ?>" value="1" <?php checked( $s['hosting_enabled'] ); ?> /> Let people sign in with Nostr and host feeds on this site</label></td>
					</tr>
					<tr>
						<th scope="row"><label for="pfg-subdir">Feed folder</label></th>
						<td>
							<code><?php echo esc_html( trailingslashit( wp_get_upload_dir()['baseurl'] ) ); ?></code>
							<input id="pfg-subdir" type="text" class="regular-text" name="<?php echo esc_attr( self::field_name( 'feed_subdir' ) ); ?>" value="<?php echo esc_attr( $s['feed_subdir'] ); ?>" />
							<p class="description">Each feed is written to <code>&lt;folder&gt;/&lt;name&gt;/&lt;name&gt;.xml</code>. Changing this later does not move existing feeds.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Approval</th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( self::field_name( 'require_approval' ) ); ?>" value="1" <?php checked( $s['require_approval'] ); ?> /> New hosted feeds stay unpublished until I approve them</label></td>
					</tr>
					<tr>
						<th scope="row"><label for="pfg-maxfeeds">Limits</label></th>
						<td>
							<input id="pfg-maxfeeds" type="number" min="1" max="50" name="<?php echo esc_attr( self::field_name( 'max_feeds_per_account' ) ); ?>" value="<?php echo esc_attr( $s['max_feeds_per_account'] ); ?>" /> feeds per account &nbsp;
							<input type="number" min="1" max="1000" name="<?php echo esc_attr( self::field_name( 'max_releases' ) ); ?>" value="<?php echo esc_attr( $s['max_releases'] ); ?>" /> releases per feed &nbsp;
							<input type="number" min="1" max="720" name="<?php echo esc_attr( self::field_name( 'session_hours' ) ); ?>" value="<?php echo esc_attr( $s['session_hours'] ); ?>" /> hours signed in
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="pfg-relays">Signer relays</label></th>
						<td>
							<textarea id="pfg-relays" rows="3" cols="50" name="<?php echo esc_attr( self::field_name( 'relays' ) ); ?>"><?php echo esc_textarea( implode( "\n", (array) $s['relays'] ) ); ?></textarea>
							<p class="description">One <code>wss://</code> relay per line. Used for the "scan with your signer" (nostrconnect) option. Pasted <code>bunker://</code> links bring their own relays.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Behind Cloudflare</th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( self::field_name( 'trust_cf_ip' ) ); ?>" value="1" <?php checked( $s['trust_cf_ip'] ); ?> /> Use the <code>CF-Connecting-IP</code> header for rate limiting</label>
						<p class="description">Only tick this if all traffic really passes through Cloudflare, otherwise the header can be forged.</p></td>
					</tr>
				</table>

				<h2>Payments</h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Platform recipients</th>
						<td>
							<table class="widefat striped" style="max-width:720px">
								<thead><tr><th>Name</th><th>Address</th><th>Type</th><th>Split %</th></tr></thead>
								<tbody>
								<?php
								$rows = array_values( (array) $s['platform_recipients'] );
								for ( $i = 0; $i < count( $rows ) + 2; $i++ ) {
									$r = isset( $rows[ $i ] ) ? $rows[ $i ] : array( 'name' => '', 'address' => '', 'type' => 'lnaddress', 'split' => '' );
									$n = PFG_Settings::OPTION . '[platform][' . $i . ']';
									?>
									<tr>
										<td><input type="text" name="<?php echo esc_attr( $n ); ?>[name]" value="<?php echo esc_attr( $r['name'] ); ?>" /></td>
										<td><input type="text" class="regular-text" name="<?php echo esc_attr( $n ); ?>[address]" value="<?php echo esc_attr( $r['address'] ); ?>" /></td>
										<td><select name="<?php echo esc_attr( $n ); ?>[type]"><option value="lnaddress" <?php selected( $r['type'], 'lnaddress' ); ?>>lnaddress</option><option value="node" <?php selected( $r['type'], 'node' ); ?>>node</option></select></td>
										<td><input type="number" min="1" max="99" style="width:70px" name="<?php echo esc_attr( $n ); ?>[split]" value="<?php echo esc_attr( $r['split'] ); ?>" /></td>
									</tr>
								<?php } ?>
								</tbody>
							</table>
							<p class="description">Shown to every feed creator (hosted or downloaded) under &ldquo;Support the developers (optional)&rdquo;. The split here is the default; each creator can change it from 0 to 99%, and any set to 0 is left out of their feed. Name, address and type cannot be changed by creators. They only apply once a feed has at least one payment recipient of its own. <strong>Check the addresses carefully before going live.</strong> Changing them only affects feeds saved afterwards. Leave blank for no support section.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="pfg-sug">Defaults</label></th>
						<td>
							Suggested amount <input id="pfg-sug" type="text" size="14" name="<?php echo esc_attr( self::field_name( 'default_suggested' ) ); ?>" value="<?php echo esc_attr( $s['default_suggested'] ); ?>" />
							&nbsp; Value method
							<select name="<?php echo esc_attr( self::field_name( 'default_value_method' ) ); ?>">
								<option value="lnaddress" <?php selected( $s['default_value_method'], 'lnaddress' ); ?>>lnaddress</option>
								<option value="keysend" <?php selected( $s['default_value_method'], 'keysend' ); ?>>keysend</option>
							</select>
						</td>
					</tr>
				</table>

				<h2>Roles</h2>
				<p class="description">The built-in roles follow the list proposed in Podcast Namespace PR #793. The role picker on the website shows them in two groups, each in alphabetical order.</p>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Roles</th>
						<td><code><?php echo esc_html( implode( ' ', PFG_Feed::main_rel_tokens() ) ); ?></code></td>
					</tr>
					<tr>
						<th scope="row">Other roles</th>
						<td><code><?php echo esc_html( implode( ' ', PFG_Feed::other_rel_tokens() ) ); ?></code></td>
					</tr>
					<tr>
						<th scope="row"><label for="pfg-rel">Extra role words</label></th>
						<td>
							<input id="pfg-rel" type="text" class="regular-text" name="<?php echo esc_attr( self::field_name( 'extra_rel_tokens' ) ); ?>" value="<?php echo esc_attr( $s['extra_rel_tokens'] ); ?>" />
							<p class="description">Added to the Roles group in the role picker. Space separated.</p>
						</td>
					</tr>
				</table>

				<h2>Uninstall</h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Data</th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( self::field_name( 'delete_data_on_uninstall' ) ); ?>" value="1" <?php checked( $s['delete_data_on_uninstall'] ); ?> /> Delete accounts, feeds and settings when the plugin is deleted</label>
						<p class="description">Published XML files in the uploads folder are never deleted automatically.</p></td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<h2>Hosted feeds</h2>
			<?php
			$feeds = PFG_Storage::list_all_feeds();
			if ( ! $feeds ) {
				echo '<p>No hosted feeds yet.</p>';
			} else {
				?>
				<table class="widefat striped">
					<thead><tr><th>Name</th><th>Title</th><th>Owner</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
					<tbody>
					<?php foreach ( $feeds as $f ) : ?>
						<?php
						$npub = PFG_Nostr::npub_encode( (string) $f['pubkey'] );
						$short = $npub ? substr( $npub, 0, 12 ) . '…' . substr( $npub, -6 ) : '';
						$actions = array();
						if ( 'deleted' !== $f['status'] ) {
							if ( 'pending' === $f['status'] ) {
								$actions['approve'] = 'Approve';
							}
							if ( 'suspended' === $f['status'] ) {
								$actions['unsuspend'] = 'Unsuspend';
							}
							if ( 'published' === $f['status'] ) {
								$actions['suspend'] = 'Suspend';
							}
							$actions['delete'] = 'Delete';
						}
						$actions[ 'blocked' === $f['account_status'] ? 'unblock' : 'block' ] = 'blocked' === $f['account_status'] ? 'Unblock owner' : 'Block owner';
						?>
						<tr>
							<td><?php echo 'published' === $f['status'] ? '<a href="' . esc_url( PFG_Storage::feed_url( $f['slug'] ) ) . '" target="_blank" rel="noopener">' . esc_html( $f['slug'] ) . '</a>' : esc_html( $f['slug'] ); // phpcs:ignore ?></td>
							<td><?php echo esc_html( $f['title'] ); ?></td>
							<td><?php if ( $npub ) : ?><a href="<?php echo esc_url( 'https://njump.me/' . $npub ); ?>" target="_blank" rel="noopener noreferrer" title="<?php echo esc_attr( $npub ); ?>"><code><?php echo esc_html( $short ); ?></code></a><?php else : ?><code><?php echo esc_html( $short ); ?></code><?php endif; ?><?php echo 'blocked' === $f['account_status'] ? ' <em>(blocked)</em>' : ''; ?></td>
							<td><?php echo esc_html( $f['status'] ); ?></td>
							<td><?php echo esc_html( wp_date( 'Y-m-d H:i', (int) $f['updated_at'] ) ); ?></td>
							<td>
								<?php foreach ( $actions as $do => $label ) : ?>
									<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline" <?php echo in_array( $do, array( 'delete', 'block' ), true ) ? 'onsubmit="return confirm(\'Are you sure?\');"' : ''; // phpcs:ignore ?>>
										<input type="hidden" name="action" value="pfg_feed_action" />
										<input type="hidden" name="feed_id" value="<?php echo esc_attr( (int) $f['id'] ); ?>" />
										<input type="hidden" name="do" value="<?php echo esc_attr( $do ); ?>" />
										<?php wp_nonce_field( 'pfg_feed_action_' . (int) $f['id'] ); ?>
										<button class="button button-small"><?php echo esc_html( $label ); ?></button>
									</form>
								<?php endforeach; ?>
							</td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php } ?>
		</div>
		<?php
	}
}
