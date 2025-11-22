import { LoggerTransport } from "./types.js";

export class ConsoleTransport implements LoggerTransport {
    write(payload: any): void {
        console.info(payload);
    }
}

export class ParentProcessTransport implements LoggerTransport {
    write(payload: any): void {
        // Don't use IPC in test environments (Vitest workers interfere with process.send)
        if (process.env.VITEST || process.env.NODE_ENV === "test") {
            console.info(payload);
            return;
        }
        // Only use process.send if we're actually connected to a parent process
        // In Vitest workers, process.send exists but shouldn't be used
        if (typeof process.send === "function" && process.connected === true) {
            process.send(payload);
        } else {
            console.info(payload);
        }
    }
}


