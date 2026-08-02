/**
 * HTTP client for the tailscaled LocalAPI, which listens on a unix socket.
 *
 * Reads are allowed for any local user; writes require the caller to be root
 * or the configured Tailscale operator (`tailscale set --operator=$USER`).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {ok, err, errFrom} from './result.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Soup.Session.prototype, 'send_async');
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async');

export const SOCKET_PATH = '/var/run/tailscale/tailscaled.sock';

// tailscaled rejects requests whose Host header it does not recognise.
const BASE_URI = 'http://local-tailscaled.sock';

/** Bits of ipn.NotifyWatchOpt we ask the bus to send on connect. */
const NOTIFY_INITIAL_STATE = 1 << 1;
const NOTIFY_INITIAL_PREFS = 1 << 2;
const NOTIFY_INITIAL_NETMAP = 1 << 3;
const NOTIFY_INITIAL_HEALTH_STATE = 1 << 6;

const WATCH_MASK =
    NOTIFY_INITIAL_STATE |
    NOTIFY_INITIAL_PREFS |
    NOTIFY_INITIAL_NETMAP |
    NOTIFY_INITIAL_HEALTH_STATE;

export class LocalApi {
    constructor(socketPath = SOCKET_PATH) {
        this._socketPath = socketPath;
        this._session = new Soup.Session({
            remoteConnectable: new Gio.UnixSocketAddress({path: socketPath}),
            // The IPN bus is a long-lived stream; neither timeout may fire.
            timeout: 0,
            idleTimeout: 0,
        });
        this._decoder = new TextDecoder();
        this._encoder = new TextEncoder();
    }

    /**
     * @returns {boolean} whether the daemon socket exists at all
     */
    get socketExists() {
        return GLib.file_test(this._socketPath, GLib.FileTest.EXISTS);
    }

    /**
     * @param {string} method HTTP method
     * @param {string} path LocalAPI path, e.g. `/localapi/v0/prefs`
     * @param {object|null} body JSON request body
     * @returns {Promise<{ok: boolean, value?: *, message?: string}>} parsed response
     */
    async request(method, path, body = null) {
        if (!this.socketExists)
            return err('tailscaled is not running');

        const message = Soup.Message.new(method, `${BASE_URI}${path}`);
        if (message === null)
            return err(`Could not build a request for ${path}`);

        if (body !== null) {
            const bytes = new GLib.Bytes(this._encoder.encode(JSON.stringify(body)));
            message.set_request_body_from_bytes('application/json', bytes);
        }

        let responseBytes;
        try {
            responseBytes = await this._session.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, null);
        } catch (error) {
            return errFrom(error, `${method} ${path}`);
        }

        const text = this._decoder.decode(responseBytes.get_data() ?? new Uint8Array());
        const status = message.get_status();
        if (status < 200 || status >= 300)
            return err(describeFailure(status, text, path));

        return parseBody(message.response_headers.get_one('Content-Type'), text);
    }

    /**
     * Streams `ipn.Notify` messages until the daemon closes the connection or
     * `cancellable` is triggered.
     *
     * Yields each notify object. A failure ends the stream; the reason is
     * reported through `onError` rather than thrown, so callers can drive this
     * with a plain `for await`.
     *
     * @param {Gio.Cancellable} cancellable cancels the stream
     * @param {function(string): void} onError called once if the stream breaks
     * @yields {object} an ipn.Notify message
     */
    async *watchIpnBus(cancellable, onError) {
        const path = `/localapi/v0/watch-ipn-bus?mask=${WATCH_MASK}`;
        const message = Soup.Message.new('GET', `${BASE_URI}${path}`);
        if (message === null) {
            onError(`Could not build a request for ${path}`);
            return;
        }

        let stream = null;
        try {
            const baseStream = await this._session.send_async(
                message, GLib.PRIORITY_DEFAULT, cancellable);

            const status = message.get_status();
            if (status < 200 || status >= 300) {
                onError(describeFailure(status, '', path));
                return;
            }

            stream = new Gio.DataInputStream({baseStream});
            for (;;) {
                const [line, length] = await stream.read_line_async(
                    GLib.PRIORITY_DEFAULT, cancellable);
                if (length === 0 || line === null)
                    return;

                const parsed = parseBody('application/json', this._decoder.decode(line));
                if (!parsed.ok) {
                    onError(parsed.message);
                    return;
                }
                yield parsed.value;
            }
        } catch (error) {
            if (!isCancelled(error))
                onError(errFrom(error, 'IPN bus').message);
        } finally {
            stream?.close(null);
        }
    }

    destroy() {
        this._session.abort();
        this._session = null;
    }
}

/**
 * @param {Error|*} error a caught value
 * @returns {boolean} whether it is the cancellation we asked for
 */
function isCancelled(error) {
    return error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

/**
 * @param {string|null} contentType response content type
 * @param {string} text response body
 * @returns {{ok: boolean, value?: *, message?: string}} parsed body
 */
function parseBody(contentType, text) {
    if (contentType !== 'application/json')
        return ok(text);

    try {
        return ok(JSON.parse(text));
    } catch (error) {
        return errFrom(error, 'Malformed response from tailscaled');
    }
}

/**
 * @param {number} status HTTP status code
 * @param {string} text response body, often a bare error string
 * @param {string} path the path that failed
 * @returns {string} a message worth showing to a person
 */
function describeFailure(status, text, path) {
    const detail = text.trim();
    if (status === Soup.Status.FORBIDDEN) {
        return 'Tailscale refused the change. Run ' +
            '`sudo tailscale set --operator=$USER` to allow it without root.';
    }
    return detail
        ? `${path} failed (${status}): ${detail}`
        : `${path} failed (${status})`;
}
