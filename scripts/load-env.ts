import { existsSync } from "node:fs";

/**
 * What `import "dotenv/config"` did, with Node's built-in loader: read `.env`
 * from the working directory — or the file `DOTENV_CONFIG_PATH` names, kept
 * for compatibility — when it exists. Variables already set in the
 * environment win, as with dotenv. `.env.local` is Next's file and is not read.
 */
const file = process.env.DOTENV_CONFIG_PATH || ".env";
if (existsSync(file)) process.loadEnvFile(file);
