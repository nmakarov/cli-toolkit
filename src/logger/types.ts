export type LoggerMode = "text" | "json";

export interface LoggerProgressOptions {
    prefix?: string;
    count: number;
    total: number;
}

export interface LoggerOptions {
    mode?: LoggerMode;
    route?: "console" | "ipc";
    prefix?: string;
    silent?: boolean;
    showLevel?: boolean;
    timestamp?: boolean;
    levels?: string[];
    progress?: {
        withTimes?: boolean;
        throttleMs?: number;
    };
}

export interface LoggerTransport {
    write(payload: any): void;
}

export interface Logger {
    debug(message?: any, ...chunks: any[]): void;
    info(message?: any, ...chunks: any[]): void;
    notice(message?: any, ...chunks: any[]): void;
    warn(message?: any, ...chunks: any[]): void;
    error(message?: any, ...chunks: any[]): void;
    logic(message?: any, ...chunks: any[]): void;
    silly(message?: any, ...chunks: any[]): void;
    results(results: unknown): void;
    request(operation: string, ...chunks: any[]): void;
    response(operation: string, ...chunks: any[]): void;
    progress(message: string, progress: LoggerProgressOptions): void;
    setMode(mode: LoggerMode): void;
}

export type LevelName =
    | "error"
    | "warn"
    | "notice"
    | "info"
    | "logic"
    | "debug"
    | "silly"
    | "results"
    | "request"
    | "response"
    | "progress";

export interface LogPayload {
    level: LevelName;
    message?: string;
    chunks?: any[];
    prefix?: string;
    results?: any;
    count?: string | number;
    total?: number;
    elapsed?: number;
    remaining?: number;
}


