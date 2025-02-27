# easyclone

This tools is provided to manage moodle plugins installation since installing manually is very cumbersome.

Inspired by [silecs/moodle-gitplugins](https://github.com/silecs/moodle-gitplugins) but using Deno

Follow the example on `.easyclone.yaml`

## Config

* `root` (default: `.`): Location of the moodle base or any project
* `strict` (default: `false`): see explanation of `repositories.enable`
* `force` (default: `false`): if `true` it will not ask confirmation when deleting folder
* `cleanup`(default: `[.git, .github]`): array of string which files or folders will be deleted after installing plugin
* `repositories`:
  * `url`: URL of the repo, can be `org/repo` for Github repositories or absolute URL `https://gitlab.com/org/repo.git`
  * `branch` (optional): specify branch or tag otherwise it will clone the latest
  * `hash` (optional): specify hash. Warning! this will override `branch` config
  * `path`: location to install
  * `enable` (default: `true`): if `strict` is `true` and this value is `false` it will delete existing directory, otherwise it will just skip installing if `false`
  * `cleanup` (default: `[]`): Same as `cleanup` parent config but specific files or folders per plugin

## Running

`deno run -A main.ts`

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