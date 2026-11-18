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
		add_action( 'admin_post_pfg_adopt', array( __CLASS__, 'handle_adopt' ) );
		add_action( 'admin_post_pfg_move', array( __CLASS__, 'handle_move' ) );
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
						$res    = PFG_Storage::unsuspend_feed( $feed );
						$notice = is_wp_error( $res ) ? 'writefail' : 'published';
					}
					break;
				case 'suspend':
					if ( PFG_Storage::is_adopted_pending( $feed ) ) {
						$notice = 'adopted_untouched';
						break;
					}
					PFG_Storage::suspend_feed( $feed );
					$notice = 'suspended';
					break;
				case 'delete':
					if ( PFG_Storage::is_adopted_pending( $feed ) ) {
						$notice = 'adopted_untouched';
						break;
					}
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
						if ( PFG_Storage::is_adopted_pending( PFG_Storage::get_feed( (int) $row['id'] ) ) ) {
							continue; // an adopted feed that has not been edited yet: leave its original file alone.
						}
						PFG_Storage::suspend_feed( PFG_Storage::get_feed( (int) $row['id'] ) );
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

	/** Take over a feed file that already exists on this server (admin only). */
	public static function handle_adopt() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Not allowed.', 403 );
		}
		check_admin_referer( 'pfg_adopt' );
		$url = isset( $_POST['adopt_url'] ) ? esc_url_raw( wp_unslash( $_POST['adopt_url'] ) ) : '';
		$acc = isset( $_POST['adopt_account'] ) ? (int) $_POST['adopt_account'] : 0;
		$res = PFG_Storage::adopt_from_url( $url, $acc );
		$args = array( 'page' => 'pfg' );
		if ( is_wp_error( $res ) ) {
			$args['pfg_notice'] = 'adopt_error';
			$args['pfg_msg']    = rawurlencode( $res->get_error_message() );
		} else {
			$args['pfg_notice'] = 'adopted';
		}
		wp_safe_redirect( add_query_arg( $args, admin_url( 'options-general.php' ) ) );
		exit;
	}

 	/** Move a feed to another account (admin only). The new owner must show control of the feed's website. */
	public static function handle_move() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Not allowed.', 403 );
		}
		check_admin_referer( 'pfg_move' );
		$id   = isset( $_POST['move_feed'] ) ? (int) $_POST['move_feed'] : 0;
		$key  = isset( $_POST['move_key'] ) ? sanitize_text_field( wp_unslash( $_POST['move_key'] ) ) : '';
		$skip = ! empty( $_POST['move_skip'] );
		$res  = PFG_Storage::move_feed( $id, $key, $skip );
		$args = array( 'page' => 'pfg' );
		if ( is_wp_error( $res ) ) {
			$args['pfg_notice'] = 'adopt_error';
			$args['pfg_msg']    = rawurlencode( $res->get_error_message() );
		} else {
			$args['pfg_notice'] = 'moved';
		}
		wp_safe_redirect( add_query_arg( $args, admin_url( 'options-general.php' ) ) );
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
			'suspended' => 'Feed suspended. Its file was moved out of public view and can be restored by unsuspending.',
			'deleted'   => 'Feed deleted. Its name stays reserved.',
			'blocked'   => 'Account blocked, its sessions ended and its feeds suspended (their files were kept and can be restored by unsuspending).',
			'unblocked' => 'Account unblocked. Its feeds stay suspended until you unsuspend them.',
			'adopted'   => 'Feed adopted. Its owner can now find it under Your hosted feeds and edit it. The file was not changed.',
			'moved'     => 'Feed moved. Its new owner can now find it under Your hosted feeds. The file, address and GUID did not change.',
			'adopted_untouched' => 'That adopted feed has not been edited yet, so its original file is left alone. Edit and save it first.',
			'writefail' => 'The feed file could not be written. Check that wp-content is writable.',
		);
		$notice  = isset( $_GET['pfg_notice'] ) ? sanitize_key( wp_unslash( $_GET['pfg_notice'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$tab_for = array( 'adopted' => 'tools', 'moved' => 'tools', 'adopted_untouched' => 'tools', 'adopt_error' => 'tools', 'published' => 'feeds', 'suspended' => 'feeds', 'deleted' => 'feeds', 'blocked' => 'feeds', 'unblocked' => 'feeds', 'writefail' => 'feeds' );
		$tab     = isset( $tab_for[ $notice ] ) ? $tab_for[ $notice ] : 'hosting';
		?>
		<div class="wrap" data-pfg-default-tab="<?php echo esc_attr( $tab ); ?>">
			<h1>Publisher Feeds</h1>
			<p class="description">Publisher Feed Generator version <strong><?php echo esc_html( PFG_VERSION ); ?></strong></p>
			<?php if ( isset( $notices[ $notice ] ) ) : ?>
				<div class="notice notice-info is-dismissible"><p><?php echo esc_html( $notices[ $notice ] ); ?></p></div>
			<?php endif; ?>
			<?php $overdue = PFG_Storage::moved_ready_to_delete(); ?>
			<?php if ( $overdue ) : ?>
				<div class="notice notice-warning"><p><strong><?php echo esc_html( count( $overdue ) . ( 1 === count( $overdue ) ? ' moved feed is' : ' moved feeds are' ) ); ?> ready to be deleted.</strong> <?php echo esc_html( 1 === count( $overdue ) ? 'It was' : 'They were' ); ?> moved more than <?php echo (int) $s['keep_moved_days']; ?> days ago. They are highlighted in the list below.</p></div>
			<?php endif; ?>
			<?php if ( 'adopt_error' === $notice && isset( $_GET['pfg_msg'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="notice notice-error is-dismissible"><p><?php echo esc_html( sanitize_text_field( rawurldecode( wp_unslash( $_GET['pfg_msg'] ) ) ) ); // phpcs:ignore ?></p></div>
			<?php endif; ?>
			<?php if ( ! extension_loaded( 'gmp' ) ) : ?>
				<div class="notice notice-error"><p><strong>The PHP GMP extension is not installed.</strong> Hosting is switched off because the server cannot verify Nostr signatures without it. Ask your host to enable <code>gmp</code>. The generator, import and export still work.</p></div>
			<?php endif; ?>

			<p>Add the generator to any page with the shortcode <code>[publisher_feed_generator]</code>.</p>

			<h2 class="nav-tab-wrapper pfg-tabs" id="pfg-tabs">
				<a href="#hosting" class="nav-tab" data-pfg-tab="hosting">Hosting</a>
				<a href="#payments" class="nav-tab" data-pfg-tab="payments">Payments</a>
				<a href="#roles" class="nav-tab" data-pfg-tab="roles">Roles</a>
				<a href="#feeds" class="nav-tab" data-pfg-tab="feeds">Hosted feeds</a>
				<a href="#tools" class="nav-tab" data-pfg-tab="tools">Adopt or move a feed</a>
			</h2>
			<form method="post" action="options.php">
				<?php settings_fields( 'pfg' ); ?>
			<div class="pfg-tab-panel" data-pfg-tab="hosting">
				<h2>Hosting</h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Hosted feeds</th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( self::field_name( 'hosting_enabled' ) ); ?>" value="1" <?php checked( $s['hosting_enabled'] ); ?> /> Let people sign in with Nostr and host feeds on this site</label></td>
					</tr>
					<tr>
						<th scope="row"><label for="pfg-moreinfo">More information page for Nostr sign in</label></th>
						<td>
							<input id="pfg-moreinfo" type="url" class="regular-text" name="<?php echo esc_attr( self::field_name( 'more_info_url' ) ); ?>" value="<?php echo esc_attr( $s['more_info_url'] ); ?>" placeholder="https://" />
							<p class="description">Linked from the messages shown to people who sign in with a key kept in their browser, explaining why a signer app or browser extension is needed for payments. Leave empty to show no link.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Feed folder</th>
						<td>
							<code><?php echo esc_html( PFG_Storage::base_url() ); ?></code>
							<p class="description">Each feed is written to <code>&lt;name&gt;/&lt;name&gt;.xml</code> inside this folder (<code>wp-content/pubfeeds</code>), which is created automatically.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Approval</th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( self::field_name( 'require_approval' ) ); ?>" value="1" <?php checked( $s['require_approval'] ); ?> /> New hosted feeds stay unpublished until I approve them</label></td>
					</tr>
					<tr>
						<th scope="row"><label for="pfg-keepmoved">Number of days to keep a moved feed</label></th>
						<td>
							<input id="pfg-keepmoved" type="number" min="1" max="3650" name="<?php echo esc_attr( self::field_name( 'keep_moved_days' ) ); ?>" value="<?php echo esc_attr( $s['keep_moved_days'] ); ?>" /> days
							<p class="description">After a feed owner moves a feed to a new address, the old feed stays here (with its new-address tag) for this long so apps can pick up the move. Then it is shown in the list, highlighted, ready for you to delete.</p>
						</td>
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
							<p class="description">One <code>wss://</code> relay per line. Used for the "scan with your signer" (nostrconnect) option: the first 5 go into the QR code, so put the relays your signer uses first (in Amber, see Settings, Relays). Pasted <code>bunker://</code> links bring their own relays.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Behind Cloudflare</th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( self::field_name( 'trust_cf_ip' ) ); ?>" value="1" <?php checked( $s['trust_cf_ip'] ); ?> /> Use the <code>CF-Connecting-IP</code> header for rate limiting</label>
						<p class="description">Only tick this if all traffic really passes through Cloudflare, otherwise the header can be forged.</p></td>
					</tr>
				</table>

				<h2>Uninstall</h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Data</th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( self::field_name( 'delete_data_on_uninstall' ) ); ?>" value="1" <?php checked( $s['delete_data_on_uninstall'] ); ?> /> Delete accounts, feeds and settings when the plugin is deleted</label>
						<p class="description">Published XML files in wp-content/pubfeeds are never deleted automatically.</p></td>
					</tr>
				</table>
			</div>
			<div class="pfg-tab-panel" data-pfg-tab="payments">
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

			</div>
			<div class="pfg-tab-panel" data-pfg-tab="roles">
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

			</div>
				<div class="pfg-tab-save" data-pfg-for="hosting payments roles"><?php submit_button(); ?></div>
			</form>

			<div class="pfg-tab-panel" data-pfg-tab="tools">
			<h2>Adopt an existing feed</h2>
			<p>For a publisher feed that is already on this server. It stays at its current address with its current GUID. Pick the Nostr account that will own it; that person can then edit it from the front page. The file is not changed until they save.</p>
			<?php $accounts = PFG_Storage::list_accounts(); ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="pfg_adopt" />
				<?php wp_nonce_field( 'pfg_adopt' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="pfg-adopt-url">Feed address</label></th>
						<td><input id="pfg-adopt-url" type="url" class="regular-text" name="adopt_url" placeholder="<?php echo esc_attr( trailingslashit( wp_get_upload_dir()['baseurl'] ) . 'folder/name/name.xml' ); ?>" required />
						<p class="description">Must be a file in this site's uploads folder, named <code>name/name.xml</code>.</p></td>
					</tr>
					<tr>
						<th scope="row"><label for="pfg-adopt-account">Owner</label></th>
						<td>
							<select id="pfg-adopt-account" name="adopt_account" required>
								<option value="">Choose an account</option>
								<?php foreach ( $accounts as $a ) : ?>
									<?php $np = PFG_Nostr::npub_encode( (string) $a['pubkey'] ); ?>
									<option value="<?php echo (int) $a['id']; ?>"><?php echo esc_html( substr( $np, 0, 14 ) . '…' . substr( $np, -8 ) ); ?></option>
								<?php endforeach; ?>
							</select>
							<p class="description">Only people who have signed in at least once appear here.</p>
						</td>
					</tr>
				</table>
				<?php submit_button( 'Adopt feed', 'secondary' ); ?>
			</form>

			<h2>Move a feed to another account</h2>
			<p>For someone who lost their browser key, or who wants a feed on a different key. The feed keeps its file, address and GUID. Before moving it, the plugin checks that the new owner controls the website in the feed: their npub must appear on that page, or their key must be listed in the domain's <code>/.well-known/nostr.json</code> (NIP-05). The new owner does not need to have signed in before.</p>
			<?php $movable = array_filter( (array) PFG_Storage::list_all_feeds(), function ( $f ) { return 'deleted' !== $f['status']; } ); ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Move this feed to the new owner? The previous owner will lose access to it.');">
				<input type="hidden" name="action" value="pfg_move" />
				<?php wp_nonce_field( 'pfg_move' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="pfg-move-feed">Feed</label></th>
						<td>
							<select id="pfg-move-feed" name="move_feed" required>
								<option value="">Choose a feed</option>
								<?php foreach ( $movable as $f ) : ?>
									<option value="<?php echo (int) $f['id']; ?>"><?php echo esc_html( $f['slug'] . ' (' . $f['title'] . ')' ); ?></option>
								<?php endforeach; ?>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="pfg-move-key">New owner</label></th>
						<td><input id="pfg-move-key" type="text" class="regular-text" name="move_key" placeholder="npub1…" autocomplete="off" required /></td>
					</tr>
					<tr>
						<th scope="row">Website check</th>
						<td><label><input type="checkbox" name="move_skip" value="1" /> I have confirmed this person owns the feed another way: skip the website check</label></td>
					</tr>
				</table>
				<?php submit_button( 'Move feed', 'secondary' ); ?>
			</form>

			</div>
			<div class="pfg-tab-panel" data-pfg-tab="feeds">
			<h2>Hosted feeds</h2>
			<?php
			$feeds = PFG_Storage::list_all_feeds();
			if ( ! $feeds ) {
				echo '<p>No hosted feeds yet.</p>';
			} else {
				?>
				<table class="widefat striped">
					<thead><tr><th>Name</th><th>Title</th><th>Owner</th><th>Status</th><th>Updated</th><th>Moved</th><th>Actions</th></tr></thead>
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
						<?php $is_overdue = (int) $f['moved_at'] > 0 && 'deleted' !== $f['status'] && (int) $f['moved_at'] < time() - (int) $s['keep_moved_days'] * DAY_IN_SECONDS; ?>
						<tr<?php echo $is_overdue ? ' style="background:#fcf0f1;outline:2px solid #d63638"' : ''; // phpcs:ignore ?>>
							<td><?php echo 'published' === $f['status'] ? '<a href="' . esc_url( PFG_Storage::feed_url( $f['slug'] ) ) . '" target="_blank" rel="noopener">' . esc_html( $f['slug'] ) . '</a>' : esc_html( $f['slug'] ); // phpcs:ignore ?></td>
							<td><?php echo esc_html( $f['title'] ); ?></td>
							<td><?php if ( $npub ) : ?><a href="<?php echo esc_url( 'https://njump.me/' . $npub ); ?>" target="_blank" rel="noopener noreferrer" title="<?php echo esc_attr( $npub ); ?>"><code><?php echo esc_html( $short ); ?></code></a><?php else : ?><code><?php echo esc_html( $short ); ?></code><?php endif; ?><?php echo 'blocked' === $f['account_status'] ? ' <em>(blocked)</em>' : ''; ?></td>
							<td><?php echo esc_html( $f['status'] ); ?></td>
							<td><?php echo esc_html( wp_date( 'Y-m-d H:i', (int) $f['updated_at'] ) ); ?></td>
							<td><?php echo (int) $f['moved_at'] > 0 ? esc_html( wp_date( 'Y-m-d', (int) $f['moved_at'] ) ) . ( $is_overdue ? ' <strong>(ready to delete)</strong>' : '' ) : '&ndash;'; // phpcs:ignore ?></td>
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
			<style>
				.pfg-js .pfg-tab-panel, .pfg-js .pfg-tab-save { display: none; }
				.pfg-js .pfg-tab-panel.is-active, .pfg-js .pfg-tab-save.is-active { display: block; }
				.pfg-tabs { margin-bottom: 16px; }
			</style>
			<script>
				( function () {
					var wrap = document.querySelector( '.wrap[data-pfg-default-tab]' );
					if ( ! wrap ) { return; }
					wrap.classList.add( 'pfg-js' );
					var links = wrap.querySelectorAll( '#pfg-tabs [data-pfg-tab]' );
					var panels = wrap.querySelectorAll( '.pfg-tab-panel' );
					var saves = wrap.querySelectorAll( '.pfg-tab-save' );
					var names = [].map.call( links, function ( a ) { return a.getAttribute( 'data-pfg-tab' ); } );
					function show( name ) {
						if ( names.indexOf( name ) < 0 ) { name = names[0]; }
						[].forEach.call( links, function ( a ) { a.classList.toggle( 'nav-tab-active', a.getAttribute( 'data-pfg-tab' ) === name ); a.setAttribute( 'aria-current', a.getAttribute( 'data-pfg-tab' ) === name ? 'page' : 'false' ); } );
						[].forEach.call( panels, function ( p ) { p.classList.toggle( 'is-active', p.getAttribute( 'data-pfg-tab' ) === name ); } );
						[].forEach.call( saves, function ( p ) { p.classList.toggle( 'is-active', p.getAttribute( 'data-pfg-for' ).split( ' ' ).indexOf( name ) >= 0 ); } );
					}
					[].forEach.call( links, function ( a ) {
						a.addEventListener( 'click', function ( ev ) { ev.preventDefault(); var n = a.getAttribute( 'data-pfg-tab' ); show( n ); try { history.replaceState( null, '', '#' + n ); } catch ( e ) {} } );
					} );
					var fromHash = ( location.hash || '' ).replace( '#', '' );
					show( names.indexOf( fromHash ) >= 0 ? fromHash : wrap.getAttribute( 'data-pfg-default-tab' ) );
				}() );
			</script>
		</div>
		<?php
	}
}
