import { parseArgs } from "@std/cli/parse-args";
import { parseFile } from "./config.ts";
import { setupMoodle } from "./moodle.ts";
import { processRepository } from "./repository.ts";

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["config"],
    alias: { config: "c" },
    default: { config: "easyclone.yaml" },
  });

  try {
    const data = await parseFile(args.config);

    await setupMoodle(data);

    for (const repo of data.repositories) {
      await processRepository(data, repo);
    }
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      console.error("Invalid YAML");
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    Deno.exit(1);
  }
}
