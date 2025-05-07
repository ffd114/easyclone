# easyclone

This tools is provided to manage moodle plugins installation since installing manually is very cumbersome.

Inspired by [silecs/moodle-gitplugins](https://github.com/silecs/moodle-gitplugins) but using Deno

Follow the example on `easyclone.example.yaml`

## Config

- `root` (default: `.`): Location of the moodle base or any project
- `strict` (default: `false`): see explanation of `repositories.enable`
- `force` (default: `false`): if `true` it will not ask confirmation when deleting folder
- `skip` (default: `false`): skip install when plugin exist. **Warning!** this will still delete if `strict` is `true` and `repositories.enable` is `false`
- `cleanup`(default: `[.git, .github]`): array of string which files or folders will be deleted after installing plugin
- `repositories`:
  - `url`: URL of the repo, can be `org/repo` for Github repositories or absolute URL `https://gitlab.com/org/repo.git`. **Mutually exclusive with `path`**
  - `branch` (optional): specify branch or tag otherwise it will clone the latest. Only when `url` is specified
  - `hash` (optional): specify hash. This will skip branch config if specified. Only when `url` is specified
  - `path`: path to the plugin for local directory. **Mutually exclusive with `url`**
  - `target`: location to install
  - `enable` (default: `true`): if `strict` is `true` and this value is `false` it will delete existing directory, otherwise it will just skip installing if `false`
  - `cleanup` (default: `[]`): Same as `cleanup` parent config but specific files or folders per plugin

### Environment Variables

You can use environment variables to override the config values. The format is `${ENV_VARIABLE}` or `${ENV_VARIABLE:-defaultValue}`, for example:

```yaml
root: ${MOODLE_ROOT:-path/to/moodle}
# ... other data
repositories:
  - url: https://${GH_USERNAME}:${GH_PERSONAL_ACCESS_TOKEN}@github.com/org/repo.git
    target: local/test
```

Credit to: [eNiiju/safe-yaml-env](https://github.com/eNiiju/safe-yaml-env/blob/25937192c97dd9a39788747fb7d2ee6a872c9bc7/src/common/utils.ts)

## Running

`deno run -A main.ts`

## Compile

`deno compile --allow-run=git --allow-read --allow-write main.ts`

### Args:

- `-p <path>, --path <path>` (optional): specify config file location. Default: `easyclone.yaml`

## Requirements

1. [Deno](https://deno.com)
2. [Git](https://git.com)

# License

```
MIT License

Copyright (c) [2025] [Farly Fitrian Dwiputra]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
