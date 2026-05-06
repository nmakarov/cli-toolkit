import { describe, it, expect } from "vitest";
import {
    FrameworkError,
    ParamError,
    InitError,
    CriticalRequestError,
    ControlFlowError
} from "../../errors.js";

describe("Errors CI", () => {
    it("retains prototype chains and custom names", () => {
        const framework = new FrameworkError("framework");
        expect(framework).toBeInstanceOf(Error);
        expect(framework.name).toBe("FrameworkError");
        expect(framework.message).toBe("framework");

        const param = new ParamError("param");
        expect(param).toBeInstanceOf(FrameworkError);
        expect(param.name).toBe("ParamError");

        const init = new InitError("init");
        expect(init).toBeInstanceOf(FrameworkError);
        expect(init.name).toBe("InitError");

        const critical = new CriticalRequestError("critical");
        expect(critical).toBeInstanceOf(FrameworkError);
        expect(critical.name).toBe("CriticalRequestError");

        const control = new ControlFlowError("control");
        expect(control).toBeInstanceOf(Error);
        expect(control).not.toBeInstanceOf(FrameworkError);
        expect(control.name).toBe("ControlFlowError");
    });
});


