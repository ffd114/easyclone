import * as yup from "yup";
import { parse } from "@std/yaml";
import { replaceEnvVars } from "./utils.ts";

export const repositorySchema = yup
  .object({
    isPrivate: yup.boolean().optional().default(false),
    url: yup
      .string()
      .when("isPrivate", {
        is: true,
        then: (schema) =>
          schema.transform((val?: string) => {
            if (!val) return val;
            const repoPattern = /^[\w-_]+\/[\w-_]+$/;
            if (repoPattern.test(val)) {
              return `git@github.com:${val}.git`;
            }
            if (val.startsWith("https://github.com/")) {
              return val.replace("https://github.com/", "git@github.com:").replace(/\.git$/, "") + ".git";
            }
            return val;
          }),
        otherwise: (schema) =>
          schema.transform((val?: string) => {
            if (!val) return val;
            const repoPattern = /^[\w-_]+\/[\w-_]+$/;
            if (repoPattern.test(val)) {
              return `https://github.com/${val}.git`;
            }
            return val;
          }),
      })
      .optional(),
    path: yup.string().optional(),
    target: yup.string().required(),
    branch: yup.string().optional(),
    hash: yup.string().optional(),
    skip: yup.boolean().optional(),
    enable: yup.boolean().required().default(true),
    patch: yup.boolean().optional().default(false),
    cleanup: yup.array().of(yup.string().required()).required().default([]),
  })
  .test(
    "url-path",
    "Either url or path must be provided",
    function (value, ctx) {
      if (!value.url && !value.path) {
        return ctx.createError({
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

export const schema = yup.object({
  moodle: yup.object({
    url: yup.string().required(),
    path: yup.string().required().default("."),
    patch: yup.boolean().default(true),
    patchDir: yup.string().required().default("patch"),
    cleanup: yup.array(yup.string().required()).default([
      ".git",
      ".github",
      ".gitattributes",
      ".gitignore",
      "README.txt",
      "readme_moodle.txt",
      "COPYING.txt",
    ]),
  }).optional(),
  cleanup: yup.array(yup.string().required()).default([".git", ".github"]),
  skip: yup.boolean().required().default(false),
  sshKey: yup.string().optional(),
  repositories: yup.array().of(repositorySchema).required(),
});

export interface Config extends yup.InferType<typeof schema> {}
export type RootConfig = Omit<Config, "repositories">;
export interface RepositoryConfig extends yup.InferType<typeof repositorySchema> {}

export const parseFile = async (path: string): Promise<Config> => {
  const decoder = new TextDecoder("utf-8");
  const content = await Deno.readFile(path);
  const decoded = decoder.decode(content);
  const decodedWithEnv = replaceEnvVars(decoded);

  const data = parse(decodedWithEnv);

  return (await schema.validate(data)) as Config;
};
