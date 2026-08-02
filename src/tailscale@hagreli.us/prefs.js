import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TailscalePreferences extends ExtensionPreferences {
    /**
     * @param {Adw.PreferencesWindow} window the window to fill
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Tailscale',
            iconName: 'network-vpn-symbolic',
        });
        page.add(menuGroup(settings));
        page.add(sessionGroup(settings));
        page.add(permissionsGroup());

        window.add(page);
    }
}

/**
 * @param {Gio.Settings} settings the extension's settings
 * @returns {Adw.PreferencesGroup} what the menu shows
 */
function menuGroup(settings) {
    const group = new Adw.PreferencesGroup({title: 'Menu'});

    const indicator = new Adw.SwitchRow({
        title: 'Show panel indicator',
        subtitle: 'Display a Tailscale icon in the top bar while connected',
    });
    settings.bind('show-indicator', indicator, 'active',
        Gio.SettingsBindFlags.DEFAULT);
    group.add(indicator);

    const offline = new Adw.SwitchRow({
        title: 'Show offline devices',
        subtitle: 'List devices that are not currently reachable',
    });
    settings.bind('show-offline-devices', offline, 'active',
        Gio.SettingsBindFlags.DEFAULT);
    group.add(offline);

    return group;
}

/**
 * @param {Gio.Settings} settings the extension's settings
 * @returns {Adw.PreferencesGroup} how SSH sessions are opened
 */
function sessionGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'SSH sessions',
        description: 'Devices running Tailscale SSH are reached with ' +
            '<tt>tailscale ssh</tt>, the rest with ordinary <tt>ssh</tt> over ' +
            `the tailnet. Leave these empty to connect as <tt>${
                GLib.markup_escape_text(GLib.get_user_name(), -1)
            }</tt> in the desktop’s terminal. A custom terminal command has the ` +
            'session appended to it, so it should end with its own ' +
            '“run this” argument, such as <tt>--</tt> or <tt>-e</tt>.',
    });

    const user = new Adw.EntryRow({
        title: 'User name',
        text: settings.get_string('ssh-user'),
    });
    user.connect('changed',
        () => settings.set_string('ssh-user', user.get_text().trim()));
    group.add(user);

    const terminal = new Adw.EntryRow({
        title: 'Terminal command',
        text: settings.get_string('terminal-command'),
    });
    terminal.connect('changed',
        () => settings.set_string('terminal-command', terminal.get_text().trim()));
    group.add(terminal);

    return group;
}

/**
 * @returns {Adw.PreferencesGroup} the operator requirement
 */
function permissionsGroup() {
    const group = new Adw.PreferencesGroup({
        title: 'Permissions',
        description: 'Reading status works for any user, but connecting, ' +
            'picking an exit node and sharing ports need operator access. ' +
            'Grant it once with <tt>sudo tailscale set --operator=$USER</tt>.',
    });
    return group;
}
