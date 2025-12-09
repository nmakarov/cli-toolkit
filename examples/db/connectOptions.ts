import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db.js";

// npx tsx examples/db/connectOptions.ts

const flow = async (context) => {
    const { logger } = context;
    const db = await dbInit(context);

    const fourResult = await context.db.raw("select 2 + 2 as result");
    if (fourResult) {
        context.logger.info("four:", fourResult.rows[0].result);
    } else {
        context.logger.info("database problems");
    } 
};

// TODO: make those "modules" work, finally:
// init(flow, { modules: [ "logger", "db" ] });
init(flow);
