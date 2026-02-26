import { init } from "../../src/init/index.js";
import { Db } from "../../src/db.js";

// npx tsx examples/db/connectOptions.ts --dbName=local
// npx tsx examples/db/connectOptions.ts --dbName=everystate

const flow = async (context) => {
    context.db = await Db.init(context);
    const { logger, db } = context;

    const fourResult = await db.raw("select 2 + 2 as result");
    if (fourResult) {
        logger.info("four:", fourResult.rows[0].result);
    } else {
        logger.info("database problems");
    } 
};

// TODO: make those "modules" work, finally:
// init(flow, { modules: [ "logger", "db" ] });
init(flow);
