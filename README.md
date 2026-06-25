# easyclone

This tool is provided to manage Moodle plugin installations, as installing them manually can be very cumbersome.

Inspired by [silecs/moodle-gitplugins](https://github.com/silecs/moodle-gitplugins) but written in Deno.

Please refer to the example in `easyclone.example.yaml`.

## Config

- `moodle` (optional): Configuration for downloading and setting up Moodle.
  - `url` (required if `moodle` is set): URL to download the Moodle distribution (`.zip` or `.tgz`).
  - `path` (default: `.`): Location where Moodle will be extracted. This also serves as the base path for installing plugins.
  - `overwrite` (default: `false`): If `true`, automatically deletes the existing Moodle folder and re-downloads it. If `false`, skips the download if the directory already exists.
  - `patch` (default: `true`): If `true`, applies any `.patch` files found inside the `patch` directory locally.
  - `cache` (default: `true`): If `true`, caches the downloaded Moodle archive file inside a `.cache` folder to avoid network downloads on subsequent setup runs.
  - `patchDir` (default: `patch`): Directory containing `.patch` files to apply to Moodle.
  - `cleanup` (default: `[".git", ".github", ".gitattributes", ".gitignore", "README.txt", "readme_moodle.txt", "COPYING.txt"]`): An array of file or folder names to delete inside the extracted Moodle folder after installation.
- `strict` (default: `false`): If `true`, deletes the existing `repositories.target` directory before installing, provided `repositories.enable` is `true`.
- `force` (default: `false`): If `true`, deletes directories without asking for confirmation.
- `cleanup` (default: `[.git, .github]`): An array of file or folder names to delete after a plugin is installed.
- `skip` (default: `false`): If `true`, skips the installation of plugins globally (can be overridden per repository).
- `sshKey` (optional): Path to the private SSH key to use for git operations (e.g., `~/.ssh/id_rsa`).
- `repositories`:
  - `url`: The URL of the repository. Can be `org/repo` for GitHub repositories or an absolute URL like `https://gitlab.com/org/repo.git`. **Mutually exclusive with `path`.**
  - `isPrivate` (default: `false`): If `true`, transforms GitHub repository URLs/shortcuts to SSH format (e.g., `org/repo` to `git@github.com:org/repo.git` or `https://github.com/org/repo` to `git@github.com:org/repo.git`). If `false`, shortcut `org/repo` is cloned via HTTPS (`https://github.com/org/repo.git`).
  - `branch` (optional): Specifies a branch or tag. If omitted, the default branch is cloned. Applicable only when `url` is specified. **Mutually exclusive with `hash`.**
  - `hash` (optional): Specifies a commit hash. Applicable only when `url` is specified. **Mutually exclusive with `branch`.**
  - `path`: Path to a local directory containing the plugin. **Mutually exclusive with `url`.**
  - `target`: The destination path where the plugin should be installed.
  - `enable` (default: `true`): Enables the installation of the plugin.
  - `skip` (optional, boolean): Works the same as the global `skip` setting but overrides it for this specific plugin.
  - `cleanup` (default: `[]`): Works the same as the global `cleanup` setting, but applies specifically to files or folders in this plugin.

### Environment Variables

You can use environment variables to override the config values. The format is `${ENV_VARIABLE}` or `${ENV_VARIABLE:-defaultValue}`, for example:

```yaml
moodle:
  url: https://packaging.moodle.org/moodle-4.5.0.tgz
  path: ${MOODLE_ROOT:-path/to/moodle}
# ... other data
repositories:
  - url: https://${GH_USERNAME}:${GH_PERSONAL_ACCESS_TOKEN}@github.com/org/repo.git
    target: local/test
```

Credit: [eNiiju/safe-yaml-env](https://github.com/eNiiju/safe-yaml-env/blob/25937192c97dd9a39788747fb7d2ee6a872c9bc7/src/common/utils.ts)

## Running

`deno run -A main.ts`

## Compile

`deno compile --allow-run=git --allow-read --allow-write --allow-env main.ts`

### Arguments:

- `-c <path>, --config <path>` (optional): Specifies the configuration file location. Default is `easyclone.yaml`.

## Requirements

1. [Deno](https://deno.com)
2. [Git](https://git.com)
3. `patch` CLI utility (typically available out of the box on macOS and Linux)

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
