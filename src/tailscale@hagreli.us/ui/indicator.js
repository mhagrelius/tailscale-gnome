/**
 * The Quick Settings surface: the panel indicator and the menu toggle it owns.
 */

import GObject from 'gi://GObject';
import Pango from 'gi://Pango';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {BackendState} from '../daemon/tailscale.js';
import {DeviceList} from '../features/devices.js';
import {ExitNodePicker} from '../features/exitNodes.js';
import {OptionsPicker} from '../features/options.js';
import {SharePicker} from '../features/serve.js';
import {openUri, runInTerminal} from './launcher.js';

const ADMIN_CONSOLE = 'https://login.tailscale.com/admin/machines';

const TailscaleToggle = GObject.registerClass(
class TailscaleToggle extends QuickSettings.QuickMenuToggle {
    /**
     * @param {object} context {tailscale, settings, feedback, icon, openPreferences}
     */
    _init(context) {
        super._init({
            title: 'Tailscale',
            gicon: context.icon,
            toggleMode: true,
        });

        this._context = context;
        this._tailscale = context.tailscale;

        this.menu.setHeader(context.icon, 'Tailscale');

        this._health = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._health);

        this._login = new PopupMenu.PopupImageMenuItem(
            'Log In to Tailscale…', 'avatar-default-symbolic');
        this._login.connect('activate', () => this._logIn());
        this.menu.addMenuItem(this._login);

        this._devices = new DeviceList(context);
        this.menu.addMenuItem(this._devices.section);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._exitNodes = new ExitNodePicker(context);
        this.menu.addMenuItem(this._exitNodes.item);

        this._shares = new SharePicker(context);
        this.menu.addMenuItem(this._shares.item);

        this._options = new OptionsPicker(context);
        this.menu.addMenuItem(this._options.item);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const admin = new PopupMenu.PopupImageMenuItem(
            'Admin Console', 'insert-link-symbolic');
        admin.connect('activate', () => this._open(ADMIN_CONSOLE));
        this.menu.addMenuItem(admin);

        const preferences = new PopupMenu.PopupImageMenuItem(
            'Extension Settings', 'emblem-system-symbolic');
        preferences.connect('activate', () => context.openPreferences());
        this.menu.addMenuItem(preferences);

        this.connect('clicked', () =>
            this._tailscale.setConnected(!this._tailscale.connected));

        this._handlers = [
            this._tailscale.connect('notify::connected', () => this._sync()),
            this._tailscale.connect('notify::backend-state', () => this._sync()),
            this._tailscale.connect('notify::reachable', () => this._sync()),
            this._tailscale.connect('notify::exit-node-id', () => this._sync()),
            this._tailscale.connect('notify::peers', () => this._sync()),
            this._tailscale.connect('notify::health', () => this._syncHealth()),
        ];

        this._menuHandler = this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._tailscale.refresh();
        });

        this._sync();
        this._syncHealth();
    }

    destroy() {
        for (const id of this._handlers)
            this._tailscale.disconnect(id);
        this.menu.disconnect(this._menuHandler);

        this._devices.destroy();
        this._exitNodes.destroy();
        this._shares.destroy();
        this._options.destroy();

        super.destroy();
    }

    _sync() {
        const tailscale = this._tailscale;
        const needsLogin = tailscale.backendState === BackendState.NEEDS_LOGIN;

        this.checked = tailscale.connected;
        this.subtitle = describeState(tailscale);

        // A daemon we cannot reach will not act on a click, so say so by going
        // insensitive rather than letting the toggle latch onto nothing.
        this.reactive = tailscale.reachable && !needsLogin;
        this._login.visible = needsLogin;
    }

    _syncHealth() {
        this._health.removeAll();

        for (const warning of this._tailscale.health) {
            const item = new PopupMenu.PopupImageMenuItem(
                warning, 'dialog-warning-symbolic', {reactive: false});
            item.label.add_style_class_name('tailscale-warning');
            // Health text is written as full sentences, so it has to wrap
            // rather than ellipsize away the half that explains the problem.
            item.label.clutter_text.set({
                lineWrap: true,
                ellipsize: Pango.EllipsizeMode.NONE,
            });
            this._health.addMenuItem(item);
        }
    }

    _logIn() {
        // `tailscale up` prints an authentication URL and waits, so it needs a
        // terminal the person can see rather than a background subprocess.
        const result = runInTerminal(
            ['tailscale', 'up'],
            this._context.settings.get_string('terminal-command'));
        if (!result.ok)
            this._context.feedback.reportFailure(result.message);
    }

    _open(uri) {
        const result = openUri(uri);
        if (!result.ok)
            this._context.feedback.reportFailure(result.message);
    }
});

export const TailscaleIndicator = GObject.registerClass(
class TailscaleIndicator extends QuickSettings.SystemIndicator {
    /**
     * @param {object} context {tailscale, settings, feedback, icon, openPreferences}
     */
    _init(context) {
        super._init();

        this._tailscale = context.tailscale;
        this._settings = context.settings;

        this._icon = this._addIndicator();
        this._icon.gicon = context.icon;

        this._toggle = new TailscaleToggle(context);
        this.quickSettingsItems.push(this._toggle);

        this._handlers = [
            this._tailscale.connect('notify::connected', () => this._sync()),
            this._tailscale.connect('notify::exit-node-id', () => this._sync()),
        ];
        this._settingsHandler = this._settings.connect(
            'changed::show-indicator', () => this._sync());

        this._sync();
    }

    destroy() {
        for (const id of this._handlers)
            this._tailscale.disconnect(id);
        this._settings.disconnect(this._settingsHandler);

        this.quickSettingsItems.forEach(item => item.destroy());
        this.quickSettingsItems.length = 0;

        super.destroy();
    }

    _sync() {
        this._icon.visible = this._settings.get_boolean('show-indicator') &&
            this._tailscale.connected;
    }
});

/**
 * @param {Tailscale} tailscale the model
 * @returns {string} the toggle subtitle
 */
function describeState(tailscale) {
    if (!tailscale.reachable)
        return 'Not running';

    switch (tailscale.backendState) {
    case BackendState.NEEDS_LOGIN:
        return 'Not logged in';
    case BackendState.NEEDS_MACHINE_AUTH:
        return 'Waiting for approval';
    case BackendState.STARTING:
        return 'Connecting…';
    case BackendState.IN_USE_OTHER_USER:
        return 'In use by another user';
    default:
        break;
    }

    if (!tailscale.connected)
        return 'Disconnected';

    // The subtitle is one narrow line, so it carries the one thing that varies:
    // whether traffic is leaving through another device.
    const exitNode = tailscale.exitNode;
    return exitNode ? `Via ${exitNode.name}` : 'Connected';
}
