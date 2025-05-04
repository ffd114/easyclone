import { parseArgs } from "@std/cli/parse-args";
import { load } from "@niiju/safe-yaml-env/zod";
import z, { ZodError } from "zod";
import { FileNotFoundError, MissingEnvVarError } from "@niiju/safe-yaml-env";
import { join } from "@std/path";

const repositorySchema = z.object({
  url: z.string().transform((val) => {
    const repoPattern = /^[\w-_]+\/[\w-_]+$/;

    if (repoPattern.test(val)) {
      return `https://github.com/${val}.git`;
    }

    return val;
  }),
  branch: z.string().optional(),
  hash: z.string().optional(),
  enable: z.boolean().default(true),
  path: z.string(),
  cleanup: z.array(z.string()).default([]),
});

const schema = z
  .object({
    root: z.string().default("."),
    strict: z.boolean().default(false),
    force: z.boolean().default(false),
    cleanup: z.array(z.string()).default([".git", ".github"]),
    skip: z.boolean().default(false),
    repositories: z.array(repositorySchema),
  })
  .strict();

type Config = z.infer<typeof schema>;
type RootConfig = Omit<Config, "repositories">;
type RepositoryConfig = z.infer<typeof repositorySchema>;

const parseFile = async (path: string): Promise<Config> => {
  const configFile = await Deno.open(path);
  const configFileInfo = await configFile.stat();

  if (!configFileInfo.isFile) {
    throw new Error("Config file is not found");
  }

  const data = load(path, schema);
  return data as Config;
};

const ask = (message: string): boolean => {
  const confirmed = prompt(`${message} (y/n)`);
  return confirmed === "y";
};

const rm = async (target: string) => {
  try {
    const targetInfo = await Deno.stat(target);
    if (targetInfo.isDirectory || targetInfo.isFile) {
      await Deno.remove(target, { recursive: true });
    }
  } catch (_) {
    // Nothing to do
  }
};

const isDirExists = async (path: string) => {
  try {
    const targetInfo = await Deno.stat(path);
    return targetInfo.isDirectory;
  } catch (_) {
    return false;
  }
};

const checkoutHash = (url: string, target: string, hash: string) => {
  // References: https://graphite.dev/guides/git-clone-specific-commit
  console.log(`Fetching: ${url} hash ${hash} | output ${target}`);

  Deno.mkdirSync(target, { recursive: true });

  new Deno.Command("git", {
    args: ["init"],
    cwd: target,
  }).outputSync();

  new Deno.Command("git", {
    args: ["remote", "add", "origin", url],
    cwd: target,
  }).outputSync();

  new Deno.Command("git", {
    args: ["fetch", "--depth=1", "origin", hash],
    cwd: target,
  }).outputSync();

  new Deno.Command("git", {
    args: ["checkout", "FETCH_HEAD"],
    cwd: target,
  }).outputSync();
};

const cloneBranch = async (url: string, target: string, branch?: string) => {
  const args = ["clone", "--depth=1", "--single-branch", url, target];
  if (branch) {
    args.splice(3, 0, "--branch", branch);
  }
  const git = new Deno.Command("git", {
    args,
  });

  console.log(
    `Cloning: ${url} ${branch ? `branch ${branch}` : ""} | output ${target}`
  );
  const { code, stderr } = await git.output();

  if (code !== 0) {
    console.error(new TextDecoder().decode(stderr));
  }
};

const processRepository = async (
  rootConfig: RootConfig,
  repo: RepositoryConfig
) => {
  const target = join(rootConfig.root, repo.path);

  if (!repo.enable && rootConfig.strict && (await isDirExists(target))) {
    if (!rootConfig.force && !ask(`Are you sure you want to delete ${target}?`))
      return;
    console.log(`Deleting: ${target}`);
    await rm(target);
    return;
  }

  if (repo.enable && rootConfig.skip && (await isDirExists(target))) {
    console.log(`Skipping: ${target}`);
    return;
  }

  if (repo.enable) {
    if (
      (await isDirExists(target)) &&
      !rootConfig.force &&
      !ask(`Target ${target} exists. Delete?`)
    )
      return;

    await rm(target);

    if (repo.hash) {
      checkoutHash(repo.url, target, repo.hash);
    } else {
      await cloneBranch(repo.url, target, repo.branch);
    }

    // cleanup using root config
    for (const cleanup of rootConfig.cleanup) {
      await rm(join(target, cleanup));
    }

    // cleanup using repo config
    for (const cleanup of repo.cleanup) {
      await rm(join(target, cleanup));
    }
  }
};

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["path"],
    alias: { path: "p" },
    default: { path: "easyclone.yaml" },
  });

  try {
    const data = await parseFile(args.path);

    for (const repo of data.repositories) {
      await processRepository(data, repo);
    }
  } catch (error: unknown) {
    if (error instanceof FileNotFoundError) {
      console.error("File not found");
    } else if (error instanceof SyntaxError) {
      console.error("Invalid YAML");
    } else if (error instanceof MissingEnvVarError) {
      console.error("Missing environment variable:", error.envVarKey);
    } else if (error instanceof ZodError) {
      console.error("Invalid data:", error.errors);
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
  }
}
