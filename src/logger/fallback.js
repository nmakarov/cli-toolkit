





/**
 * Minimal logger used during init bootstrap before configuration, params,
 * or transports are ready. Simply proxies messages to the native console.
 */
export class ConsoleFallbackLogger  {
    debug(message, ...optionalParams) {
        console.debug(message, ...optionalParams);
    }

    warn(message, ...optionalParams) {
        console.warn(message, ...optionalParams);
    }

    error(message, ...optionalParams) {
        console.error(message, ...optionalParams);
    }
}


