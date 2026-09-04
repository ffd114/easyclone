import { join } from "@std/path";
import { RootConfig, RepositoryConfig } from "./config.ts";
import { rm, isDirExists, copyDir, applyPatches } from "./utils.ts";

export const checkoutHash = (
  url: string,
  target: string,
  hash: string,
  sshKey?: string
) => {
  // References: https://graphite.dev/guides/git-clone-specific-commit
  console.log(`Fetching: ${url} hash ${hash} | output ${target}`);

  Deno.mkdirSync(target, { recursive: true });

  const env = {
    ...Deno.env.toObject(),
    ...(sshKey ? { GIT_SSH_COMMAND: `ssh -i ${sshKey} -o StrictHostKeyChecking=no` } : {}),
  };

  new Deno.Command("git", {
    args: ["init"],
    cwd: target,
    env,
  }).outputSync();

  new Deno.Command("git", {
    args: ["remote", "add", "origin", url],
    cwd: target,
    env,
  }).outputSync();

  new Deno.Command("git", {
    args: ["fetch", "--depth=1", "origin", hash],
    cwd: target,
    env,
  }).outputSync();

  new Deno.Command("git", {
    args: ["checkout", "FETCH_HEAD"],
    cwd: target,
    env,
  }).outputSync();
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
    console.error(new TextDecoder().decode(stderr));
  }
};

export const processRepository = async (
  rootConfig: RootConfig,
  repo: RepositoryConfig
) => {
  const rootDir = rootConfig.moodle?.path ?? ".";
  const target = join(rootDir, repo.target);

  const isTargetExists = await isDirExists(target);

  // Skip with higher priority for repo config
  const skip = repo.skip || rootConfig.skip;

  if (skip === true && repo.enable === true && isTargetExists) {
    console.log(`Skipping: ${target}`);
    return;
  }

  if (repo.enable) {
    await rm(target);

    const sshKey = rootConfig.sshKey;

    if (repo.path) {
      await copyDir(repo.path, target);
    } else if (repo.url) {
      if (repo.hash) {
        checkoutHash(repo.url, target, repo.hash, sshKey);
      } else {
        await cloneBranch(repo.url, target, repo.branch, sshKey);
      }
    }

    if (repo.patch) {
      const patchDir = join(target, "patch");
      if (!(await isDirExists(patchDir))) {
        throw new Error(`patch is enabled for ${target} but no patch directory was found at ${patchDir}`);
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
};
