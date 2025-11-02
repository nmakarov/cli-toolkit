/**
 * Error classes for the CLI toolkit
 */

export class FrameworkError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FrameworkError";
    }
}

export class ParamError extends FrameworkError {
    constructor(message: string) {
        super(message);
        this.name = "ParamError";
    }
}

export class InitError extends FrameworkError {
    constructor(message: string) {
        super(message);
        this.name = "InitError";
    }
}

export class CriticalRequestError extends FrameworkError {
    constructor(message: string) {
        super(message);
        this.name = "CriticalRequestError";
    }
}

export class ControlFlowError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ControlFlowError";
    }
}

