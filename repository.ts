import { dirname, join } from "@std/path";
import { RootConfig, RepositoryConfig } from "./config.ts";
import { rm, isDirExists, copyDir, applyPatches } from "./utils.ts";

export const checkoutHash = async (
  url: string,
  target: string,
  hash: string,
  sshKey?: string
) => {
  // References: https://graphite.dev/guides/git-clone-specific-commit
  console.log(`Fetching: ${url} hash ${hash} | output ${target}`);

  await Deno.mkdir(target, { recursive: true });

  const env = {
    ...Deno.env.toObject(),
    ...(sshKey ? { GIT_SSH_COMMAND: `ssh -i ${sshKey} -o StrictHostKeyChecking=no` } : {}),
  };

  const run = async (args: string[]) => {
    const { code, stderr } = await new Deno.Command("git", {
      args,
      cwd: target,
      env,
    }).output();

    if (code !== 0) {
      throw new Error(`Failed: git ${args.join(" ")} | ${new TextDecoder().decode(stderr)}`);
    }
  };

  await run(["init"]);
  await run(["remote", "add", "origin", url]);
  await run(["fetch", "--depth=1", "origin", hash]);
  await run(["checkout", "FETCH_HEAD"]);
};

export const cloneBranch = async (
  url: string,
  target: string,
  branch?: string,
  sshKey?: string
) => {
  const args = ["clone", "--depth=1", "--single-branch", url, target];
  if (branch) {
    args.splice(3, 0, "--branch", branch);
  }

  const env = {
    ...Deno.env.toObject(),
    ...(sshKey ? { GIT_SSH_COMMAND: `ssh -i ${sshKey} -o StrictHostKeyChecking=no` } : {}),
  };

  const git = new Deno.Command("git", {
    args,
    env,
  });

  console.log(
    `Cloning: ${url} ${branch ? `branch ${branch}` : ""} | output ${target}`
  );
  const { code, stderr } = await git.output();

  if (code !== 0) {
    throw new Error(`Failed: git ${args.join(" ")} | ${new TextDecoder().decode(stderr)}`);
  }
};

export const processRepository = async (
  rootConfig: RootConfig,
  repo: RepositoryConfig
) => {
  const rootDir = rootConfig.moodle?.path ?? ".";

  // Without subdirs, the whole source is installed into a single target
  const installs = (repo.subdirs ?? [{ subdir: undefined, target: repo.target! }]).map(
    ({ subdir, target }) => ({ subdir, target: join(rootDir, target) })
  );

  const isTargetExists = (
    await Promise.all(installs.map(({ target }) => isDirExists(target)))
  ).every(Boolean);

  // Skip with higher priority for repo config
  const skip = repo.skip || rootConfig.skip;

  if (skip === true && repo.enable === true && isTargetExists) {
    for (const { target } of installs) {
      console.log(`Skipping: ${target}`);
    }
    return;
  }

  if (repo.enable) {
    for (const { target } of installs) {
      await rm(target);
    }

    const sshKey = rootConfig.sshKey;

    if (repo.path) {
      for (const { subdir, target } of installs) {
        const source = subdir ? join(repo.path, subdir) : repo.path;
        if (!(await isDirExists(source))) {
          throw new Error(`Missing: ${source}`);
        }

        await copyDir(source, target);
      }
    } else if (repo.url && !repo.subdirs) {
      const { target } = installs[0];
      if (repo.hash) {
        await checkoutHash(repo.url, target, repo.hash, sshKey);
      } else {
        await cloneBranch(repo.url, target, repo.branch, sshKey);
      }
    } else if (repo.url) {
      // Clone once into a staging dir, then move each subdir into its target
      await Deno.mkdir(rootDir, { recursive: true });
      const cloneTarget = await Deno.makeTempDir({ dir: rootDir, prefix: ".easyclone-" });

      try {
        if (repo.hash) {
          await checkoutHash(repo.url, cloneTarget, repo.hash, sshKey);
        } else {
          await cloneBranch(repo.url, cloneTarget, repo.branch, sshKey);
        }

        for (const { subdir, target } of installs) {
          const source = join(cloneTarget, subdir!);
          if (!(await isDirExists(source))) {
            throw new Error(`Missing: ${subdir} | ${repo.url}`);
          }

          console.log(`Moving: ${source} | output ${target}`);
          await Deno.mkdir(dirname(target), { recursive: true });
          await Deno.rename(source, target);
        }
      } finally {
        await rm(cloneTarget);
      }
    }

    for (const { target } of installs) {
      if (repo.patch) {
        const patchDir = join(target, "patch");
        if (!(await isDirExists(patchDir))) {
          throw new Error(`Missing: ${patchDir}`);
        }

        await applyPatches(patchDir, rootDir);
        await rm(patchDir);
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
  }
};
