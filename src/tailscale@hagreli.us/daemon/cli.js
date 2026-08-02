/**
 * Subprocess boundary for the `tailscale` CLI.
 *
 * Prefs and status go through the LocalAPI; `serve` and `funnel` go through the
 * CLI because it validates ports, provisions certificates and rejects funnel
 * targets the tailnet policy disallows — reimplementing that against the raw
 * serve-config endpoint would mean reimplementing those checks too.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {ok, err, errFrom} from './result.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const TAILSCALE = 'tailscale';

/**
 * Runs the CLI and captures its output.
 *
 * @param {string[]} args arguments after the `tailscale` binary
 * @returns {Promise<{ok: boolean, value?: string, message?: string}>} stdout on success
 */
export async function runTailscale(args) {
    let process;
    try {
        process = Gio.Subprocess.new(
            [TAILSCALE, ...args],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    } catch (error) {
        return errFrom(error, 'Could not run tailscale');
    }

    let stdout, stderr;
    try {
        [, stdout, stderr] = await process.communicate_utf8_async(null, null);
    } catch (error) {
        return errFrom(error, `tailscale ${args[0]}`);
    }

    if (!process.get_successful()) {
        const detail = (stderr || stdout || '').trim().split('\n')[0];
        return err(detail || `tailscale ${args.join(' ')} failed`);
    }

    return ok(stdout ?? '');
}

/**
 * Shares a local port on the tailnet over HTTPS.
 *
 * @param {number} port local TCP port to proxy
 * @param {boolean} publicToInternet true to use Funnel instead of tailnet-only Serve
 * @returns {Promise<{ok: boolean, value?: string, message?: string}>} CLI output
 */
export function share(port, publicToInternet) {
    const verb = publicToInternet ? 'funnel' : 'serve';
    return runTailscale([verb, '--bg', String(port)]);
}

/**
 * Clears every serve and funnel handler on this node.
 *
 * @returns {Promise<{ok: boolean, value?: string, message?: string}>} CLI output
 */
export async function stopSharing() {
    // `funnel reset` only clears the funnel flag; `serve reset` clears the
    // handlers underneath it, so both run and the first failure wins.
    const funnel = await runTailscale(['funnel', 'reset']);
    if (!funnel.ok)
        return funnel;
    return runTailscale(['serve', 'reset']);
}

/**
 * @returns {Promise<{ok: boolean, value?: object, message?: string}>} parsed `serve status --json`
 */
export async function serveStatus() {
    const result = await runTailscale(['serve', 'status', '--json']);
    if (!result.ok)
        return result;

    try {
        return ok(JSON.parse(result.value));
    } catch (error) {
        return errFrom(error, 'Could not read serve status');
    }
}

/**
 * Builds the argument vector for an SSH session to a peer.
 *
 * Tailscale SSH is used when the peer advertises it, because it needs no key
 * exchange and is authorised by tailnet policy. Peers that do not run it are
 * still reachable over the tailnet by ordinary SSH, which is the common case
 * for a Linux box with sshd, so that is the fallback rather than an error.
 *
 * @param {object} peer a normalized peer
 * @param {string} user user name to connect as
 * @returns {string[]} argv suitable for a terminal to run
 */
export function sshCommand(peer, user) {
    const host = peer.fqdn || peer.ipv4;
    const target = user ? `${user}@${host}` : host;
    return peer.sshAvailable ? [TAILSCALE, 'ssh', target] : ['ssh', target];
}

/**
 * @returns {string} the local user name, used as the default SSH user
 */
export function localUserName() {
    return GLib.get_user_name();
}
