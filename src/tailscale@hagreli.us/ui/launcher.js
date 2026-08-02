/**
 * Launching things outside the shell: a browser for a tailnet URL, a terminal
 * for an SSH session.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {ok, err, errFrom} from '../daemon/result.js';

const TERMINAL_SCHEMA = 'org.gnome.desktop.default-applications.terminal';

/**
 * @param {string} uri an absolute URI
 * @returns {{ok: boolean, message?: string}} whether the handler was launched
 */
export function openUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, null);
        return ok(uri);
    } catch (error) {
        return errFrom(error, `Could not open ${uri}`);
    }
}

/**
 * Runs a command in the user's terminal.
 *
 * @param {string[]} command argv of the command to run inside the terminal
 * @param {string} override terminal command line from settings, or '' to detect
 * @returns {{ok: boolean, message?: string}} whether the terminal was spawned
 */
export function runInTerminal(command, override) {
    const prefix = override.trim() ? parseOverride(override) : detectTerminal();
    if (!prefix.ok)
        return prefix;

    try {
        // Detached: the terminal outlives the shell's interest in it.
        Gio.Subprocess.new(
            [...prefix.value, ...command],
            Gio.SubprocessFlags.NONE);
        return ok(null);
    } catch (error) {
        return errFrom(error, `Could not start ${prefix.value[0]}`);
    }
}

/**
 * @param {string} override a shell-style command line
 * @returns {{ok: boolean, value?: string[], message?: string}} argv prefix
 */
function parseOverride(override) {
    try {
        const [parsed, argv] = GLib.shell_parse_argv(override);
        if (!parsed || argv.length === 0)
            return err(`Could not parse the terminal command: ${override}`);
        return ok(argv);
    } catch (error) {
        return errFrom(error, 'Could not parse the terminal command');
    }
}

/**
 * Reads the desktop's configured terminal. On current GNOME this resolves to
 * `xdg-terminal-exec --`, which dispatches to whichever terminal is installed.
 *
 * @returns {{ok: boolean, value?: string[], message?: string}} argv prefix
 */
function detectTerminal() {
    const source = Gio.SettingsSchemaSource.get_default();
    const schema = source?.lookup(TERMINAL_SCHEMA, true);
    if (schema) {
        const settings = new Gio.Settings({settings_schema: schema});
        const exec = settings.get_string('exec');
        if (exec && GLib.find_program_in_path(exec)) {
            const execArg = settings.get_string('exec-arg');
            return ok(execArg ? [exec, execArg] : [exec]);
        }
    }

    for (const [program, argument] of [
        ['xdg-terminal-exec', '--'],
        ['ptyxis', '--'],
        ['gnome-terminal', '--'],
        ['kgx', '--'],
        ['xterm', '-e'],
    ]) {
        if (GLib.find_program_in_path(program))
            return ok([program, argument]);
    }

    return err('No terminal found. Set one in the extension preferences.');
}
