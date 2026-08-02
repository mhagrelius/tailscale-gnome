/**
 * Expected failures cross the daemon boundary as values, not exceptions.
 * Everything above `daemon/` branches on `ok` and never needs a try block.
 */

/**
 * @param {*} value payload
 * @returns {{ok: true, value: *}} success
 */
export function ok(value) {
    return {ok: true, value};
}

/**
 * @param {string} message human-readable, safe to show in a notification
 * @returns {{ok: false, message: string}} failure
 */
export function err(message) {
    return {ok: false, message};
}

/**
 * Turns the thrown/rejected values of an external call into an `err`.
 *
 * @param {Error|*} error whatever the seam threw
 * @param {string} context short prefix naming the operation that failed
 * @returns {{ok: false, message: string}} failure
 */
export function errFrom(error, context) {
    const detail = error?.message ?? String(error);
    return err(`${context}: ${detail}`);
}
