import { isAbsolute, join } from "@std/path";

// Modified from https://github.com/eNiiju/safe-yaml-env/blob/25937192c97dd9a39788747fb7d2ee6a872c9bc7/src/common/utils.ts
export function replaceEnvVars(data: string): string {
  // Replace environment variables in strings
  // Matches ${VAR} and ${VAR:-default_value}, taking into account escape character (\)
  const envVarRegex = /\\?\${(\w+)(?::-(.*?))?}/g;

  return data.replace(envVarRegex, (match, envKey, defaultValueFromYaml) => {
    // If the match starts with a backslash, ignore it (escaped)
    if (match.startsWith("\\")) {
      return match.slice(1);
    }

    const envValue = Deno.env.get(envKey);
    const defaultEnvValue = defaultValueFromYaml;

    if (envValue === undefined && defaultEnvValue === undefined) {
      // If there is no env value nor default value, throw an error
      throw new Deno.errors.InvalidData(
        `Environment variable ${envKey} is not set and no default value is provided.`
      );
    } else if (envValue === undefined) {
      return defaultEnvValue;
    }

    return envValue;
  });
}

export const rm = async (target: string) => {
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

export const isDirExists = async (path: string) => {
  try {
    const targetInfo = await Deno.stat(path);
    return targetInfo.isDirectory;
  } catch (_) {
    return false;
  }
};

export const _copyDir = async (src: string, dest: string) => {
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

export const copyDir = async (src: string, dest: string) => {
  console.log(`Copying : ${src} | output ${dest}`);

  await Deno.mkdir(dest, { recursive: true });

  await _copyDir(src, dest);
};

export const applyPatches = async (patchDir: string, target: string) => {
  const patches: string[] = [];
  try {
    const dirInfo = await Deno.stat(patchDir);
    if (!dirInfo.isDirectory) return;

    for await (const entry of Deno.readDir(patchDir)) {
      if (entry.isFile && entry.name.endsWith(".patch")) {
        patches.push(entry.name);
      }
    }
  } catch (_) {
    // Patch directory does not exist or cannot be read, safely ignore
    return;
  }

  if (patches.length === 0) return;

  patches.sort();
  console.log(`Applying ${patches.length} patches to ${target}`);
  for (const patch of patches) {
    console.log(`Applying patch: ${patch}`);
    const patchPath = isAbsolute(patchDir)
      ? join(patchDir, patch)
      : join(Deno.cwd(), patchDir, patch);
    const { code, stderr } = await new Deno.Command("patch", {
      args: ["-p1", "-d", target, "-i", patchPath],
    }).output();

    if (code !== 0) {
      throw new Error(`Failed to apply patch ${patch} to ${target}: ${new TextDecoder().decode(stderr)}`);
    }
  }
};
