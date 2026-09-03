import { join } from "@std/path";

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
