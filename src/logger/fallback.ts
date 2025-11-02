export interface BasicLogger {
    debug(message?: any, ...optionalParams: any[]): void;
    warn(message?: any, ...optionalParams: any[]): void;
    error(message?: any, ...optionalParams: any[]): void;
}

/**
 * Minimal logger used during init bootstrap before configuration, params,
 * or transports are ready. Simply proxies messages to the native console.
 */
export class ConsoleFallbackLogger implements BasicLogger {
    debug(message?: any, ...optionalParams: any[]): void {
        console.debug(message, ...optionalParams);
    }

    warn(message?: any, ...optionalParams: any[]): void {
        console.warn(message, ...optionalParams);
    }

    error(message?: any, ...optionalParams: any[]): void {
        console.error(message, ...optionalParams);
    }
}


