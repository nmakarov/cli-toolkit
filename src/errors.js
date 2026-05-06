/**
 * Error classes for the CLI toolkit
 */

export class FrameworkError extends Error {
    constructor(message) {
        super(message);
        this.name = "FrameworkError";
    }
}

export class ParamError extends FrameworkError {
    constructor(message) {
        super(message);
        this.name = "ParamError";
    }
}

export class InitError extends FrameworkError {
    constructor(message) {
        super(message);
        this.name = "InitError";
    }
}

export class CriticalRequestError extends FrameworkError {
    constructor(message) {
        super(message);
        this.name = "CriticalRequestError";
    }
}

export class ControlFlowError extends Error {
    constructor(message) {
        super(message);
        this.name = "ControlFlowError";
    }
}

export class HttpClientError extends FrameworkError {
    constructor(message,   cause) {
        super(message);this.cause = cause;;
        this.name = "HttpClientError";
    }
}

export class FileDatabaseError extends FrameworkError {
    constructor(message) {
        super(message);
        this.name = "FileDatabaseError";
    }
}

