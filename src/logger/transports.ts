import { LoggerTransport } from "./types.js";

export class ConsoleTransport implements LoggerTransport {
    write(payload: any): void {
        console.info(payload);
    }
}

export class ParentProcessTransport implements LoggerTransport {
    write(payload: any): void {
        if (typeof process.send === "function") {
            process.send(payload);
        } else {
            console.info(payload);
        }
    }
}


