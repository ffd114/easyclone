import { parseArgs } from "@std/cli/parse-args";
import * as yup from "yup";
import { join } from "@std/path";
import { parse } from "@std/yaml";

const repositorySchema = yup
  .object({
    url: yup
      .string()
      .transform((val) => {
        const repoPattern = /^[\w-_]+\/[\w-_]+$/;

        if (repoPattern.test(val)) {
          return `https://github.com/${val}.git`;
        }

        return val;
      })
      .optional(),
    path: yup.string().optional(),
    target: yup.string().required(),
    branch: yup.string().optional(),
    hash: yup.string().optional(),
    enable: yup.boolean().required().default(true),
    cleanup: yup.array().of(yup.string().required()).required().default([]),
  })
  .test(
    "url-path",
    "Either url or path must be provided",
    function (value, ctx) {
      if (!value.url && !value.path) {
        return ctx.createError({
          // Just for experimenting on how to use params
          params: { target: value.target },
          message: "Either url or path must be provided. Target: (${target})",
        });
      }

      if (value.url && value.path) {
        return ctx.createError({
          message: `Either url or path must be provided, not both. Target: (${value.target})`,
        });
      }

      if (value.hash && value.branch) {
        return ctx.createError({
          message: `Either hash or branch must be provided, not both. Target: (${value.target})`,
        });
      }

      return true;
    }
  );
const schema = yup.object({
  root: yup.string().required().default("."),
  strict: yup.boolean().required().default(false),
  force: yup.boolean().required().default(false),
  cleanup: yup.array(yup.string().required()).default([".git", ".github"]),
  skip: yup.boolean().required().default(false),
  repositories: yup.array().of(repositorySchema).required(),
});

interface Config extends yup.InferType<typeof schema> {}
type RootConfig = Omit<Config, "repositories">;

interface RepositoryConfig extends yup.InferType<typeof repositorySchema> {}

const parseFile = async (path: string): Promise<Config> => {
  const decoder = new TextDecoder("utf-8");
  const content = await Deno.readFile(path);
  const decoded = decoder.decode(content);

  const data = parse(decoded);

  return (await schema.validate(data)) as Config;
};

const ask = (message: string): boolean => {
  const confirmed = prompt(`${message} (y/n)`);
  return confirmed === "y";
};

const rm = async (target: string) => {
  try {
    const targetInfo = await Deno.stat(target);

    if (targetInfo.isDirectory || targetInfo.isFile) {
      console.info(`Deleting: ${target}`);
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

const _copyDir = async (src: string, dest: string) => {
  for await (const entry of Deno.readDir(src)) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory) {
      await Deno.mkdir(destPath, { recursive: true });
      await _copyDir(srcPath, destPath);
    } else if (entry.isFile) {
      await Deno.copyFile(srcPath, destPath);
    }
  }
};

const copyDir = async (src: string, dest: string) => {
  console.log(`Copying : ${src} | output ${dest}`);

  await Deno.mkdir(dest, { recursive: true });

  await _copyDir(src, dest);
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
  const target = join(rootConfig.root, repo.target);

  if (!repo.enable && rootConfig.strict && (await isDirExists(target))) {
    if (!rootConfig.force && !ask(`Are you sure you want to delete ${target}?`))
      return;
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

    if (repo.path) {
      await copyDir(repo.path, target);
    } else if (repo.url) {
      if (repo.hash) {
        checkoutHash(repo.url, target, repo.hash);
      } else {
        await cloneBranch(repo.url, target, repo.branch);
      }
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
    string: ["config"],
    alias: { config: "c" },
    default: { config: "easyclone.yaml" },
  });

  try {
    const data = await parseFile(args.config);

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
  }
}
