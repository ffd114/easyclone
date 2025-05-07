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
