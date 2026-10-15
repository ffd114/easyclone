# easyclone — Behavioral Specification

Language-neutral specification of easyclone v0.1.1 (Deno implementation, commit `5cc802e`), written to support a rewrite in another language. It describes **what the current code actually does**, including quirks. Section 11 lists the quirks and bugs so you can decide, one by one, whether the rewrite keeps or fixes them.

Conventions: `cwd` = the process working directory at startup. "Throw" = abort the whole run with that message (see §9). Log lines are shown verbatim, with `<placeholders>`.

---

## 1. Purpose

easyclone builds a Moodle installation from a YAML manifest, in one go:

1. Optionally download a Moodle distribution archive (cached on disk), extract it, apply local patches to it, and delete unwanted files.
2. Install a list of Moodle plugins into paths under the Moodle root. Each plugin comes from a git repository (branch/tag, commit hash, or default branch) or from a local directory, either whole or as selected subdirectories.
3. Optionally apply core patches shipped *inside* a plugin to the Moodle root, then delete unwanted files from each plugin.

Design stance: it is meant for container builds, where the filesystem is fresh on every run. It **only installs, never reconciles**: targets are always deleted and recreated. There are no prompts, no dry-run, no "keep existing" mode. The only exception is `skip` (§7.2).

---

## 2. Runtime requirements

| Dependency | When needed | How it's invoked |
|---|---|---|
| `git` | any repository with `url` | subprocess, see §7.4 |
| `ssh` | SSH git URLs / `sshKey` | indirectly via `GIT_SSH_COMMAND` |
| `patch` | `moodle.patch` with patch files, or repo `patch: true` | `patch -p1 -d <dir> -i <file>` |
| `tar` | Moodle archive that is not `.zip` | `tar -xf <archive> --strip-components=1 -C <target>` |
| `unzip` | Moodle archive URL containing `.zip` | `unzip -q <archive> -d <tmpdir>` |
| Network (HTTP/HTTPS) | Moodle download on cache miss | built-in HTTP client, follows redirects |

None of these are checked up front. A missing binary shows up as a failure when it is first used.

---

## 3. CLI

```
easyclone [-c <path> | --config <path> | --config=<path>]
```

- `-c`, `--config`: path to the config file. Default `easyclone.yaml`, resolved relative to `cwd`.
- Unknown flags and positional arguments are **silently ignored**.
- There is no `--help` and no `--version`. The version `0.1.1` exists only in `deno.json`.
- Exit code `0` on success, `1` on any error (§9). Nothing is printed on success beyond the progress logs.

---

## 4. Top-level flow

```
main:
  config = loadConfig(args.config)         # §5
  setupMoodle(config)                      # §6 (no-op if moodle absent)
  for repo in config.repositories (in order, sequentially):
      processRepository(config, repo)      # §7
  on any error: print message to stderr, exit 1   # §9
```

- Everything runs strictly sequentially. Nothing runs in parallel.
- The first error aborts the run. Work already done stays on disk; nothing is rolled back.
- **All relative paths** (config file, `moodle.path`, `moodle.patchDir`, repository `path`, the `.cache` dir) resolve against **`cwd`**, *not* against the config file's directory.

---

## 5. Configuration loading

### 5.1 Pipeline

1. Read the file as UTF-8 bytes. If it is missing or unreadable, throw with the OS error message.
2. **Environment substitution on the raw text** (§5.2), *before* YAML parsing.
3. Parse YAML. On a syntax error, throw with exactly the message `Invalid YAML` (the parser's details are discarded).
4. Validate and coerce against the schema (§5.3–§5.6). The first validation error aborts (abort-early).

### 5.2 Environment variable substitution

Applied to the entire file text, **including YAML comments**.

- Pattern (JS regex): `\\?\$\{(\w+)(?::-(.*?))?\}`, applied globally.
  - `\w+` = `[A-Za-z0-9_]+`.
  - The default is the non-greedy text up to the **first** `}`.
- Rules for each match:
  1. If the match starts with a backslash (`\${VAR}`), replace it with the literal `${VAR}` (backslash removed, no lookup).
  2. Else, if env var `VAR` is set (even to the empty string), use its value.
  3. Else, if a default was given (`${VAR:-...}`, possibly empty), use the default.
  4. Else throw: `Environment variable VAR is not set and no default value is provided.`
- The value is inserted **raw**, with no YAML quoting or escaping. A value containing `:`, `#`, quotes or newlines can change the YAML structure.
- Not supported: `$VAR`, `${VAR-default}`, `${VAR:?err}`, nested expansions.
- Verified examples (with `X` unset):

  | Input | Output |
  |---|---|
  | `\${X}` | `${X}` |
  | `${X:-}` | *(empty)* |
  | `${X:-x}y}` | `xy}` |
  | `${X:-a:-b}` | `a:-b` |
  | `# note ${X}` (in a comment) | **throws** |

### 5.3 Coercion and unknown keys

The current implementation uses yup in its default (non-strict) mode, so:

- **Unknown keys are kept and ignored.** They are neither errors nor warnings.
- Scalars are coerced. Numbers become strings for string fields (`branch: 2024041001` → `"2024041001"`). Strings `"true"`/`"false"` (and yup's other boolean-like values) become booleans for boolean fields.
- An **empty string counts as "missing"** for required strings and for the presence checks in §5.6.
- Values of the wrong type that cannot be coerced fail validation with a type error.

### 5.4 Root schema

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `moodle` | object (§5.5) | no | absent | If absent, Moodle setup is skipped and the plugin root is `.` |
| `cleanup` | list of string | no | `[".git", ".github"]` | Applied to **every** installed plugin target. An explicit `[]` disables it. |
| `skip` | bool | no | `false` | See §7.2 |
| `sshKey` | string | no | — | Private key path for git over SSH (§7.4). `~` is not expanded by easyclone; the shell inside `GIT_SSH_COMMAND` expands it. |
| `repositories` | list of repo (§5.6) | **yes** | — | Must be present and non-null. An empty list `[]` is valid (it does nothing). |

### 5.5 `moodle` schema

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `url` | string | **yes** (if `moodle` present) | — | `.zip`, `.tgz` or `.tar.gz` distribution URL |
| `path` | string | **yes** (if `moodle` present) | — | Extraction dir **and** base dir for plugin targets. Must not be cwd or an ancestor of it (§8.1). |
| `patch` | bool | no | `true` | Apply `*.patch` from `patchDir` to Moodle |
| `patchDir` | string | yes (non-empty) | `"patch"` | Relative to `cwd`. Missing dir = silently no patches. |
| `cleanup` | list of string | no | `[".git", ".github", ".gitattributes", ".gitignore", "README.txt", "readme_moodle.txt", "COPYING.txt"]` | Names/relative paths deleted under `moodle.path` |

Error if `moodle` is present without `url`: `moodle.url is a required field`. Without `path`: `moodle.path is a required field`.

### 5.6 Repository schema

| Key | Type | Default | Notes |
|---|---|---|---|
| `url` | string | — | Git URL or GitHub shortcut `org/repo`. Normalized (§5.7). XOR with `path`. |
| `path` | string | — | Local source dir (relative to `cwd`). XOR with `url`. |
| `isPrivate` | bool | `false` | Controls URL normalization (§5.7) |
| `branch` | string | — | Branch **or tag** to clone. XOR with `hash`. Ignored when `path` is used. |
| `hash` | string | — | Commit SHA to check out. XOR with `branch`. Ignored when `path` is used. |
| `target` | string | — | Install dir, relative to the plugin root (§7.1). XOR with `subdirs`. |
| `subdirs` | list of `{subdir: string (req), target: string (req)}` | — | At least one item. XOR with `target`. |
| `enable` | bool | `true` | `false` = the entry is a complete no-op (§7.2) |
| `skip` | bool | unset | Per-repo skip; when set, overrides root `skip` (§7.2) |
| `patch` | bool | `false` | Apply `<target>/patch/*.patch` to the plugin root (§7.5) |
| `cleanup` | list of string | `[]` | Extra names deleted in each target, after root `cleanup` |

**Cross-field rules**, checked in this order after normalization. The first failure throws:

| # | Condition | Message |
|---|---|---|
| 1 | neither `url` nor `path` | `Either url or path must be provided. Target: (<T>)` |
| 2 | both `url` and `path` | `Either url or path must be provided, not both. Target: (<T>)` |
| 3 | both `hash` and `branch` | `Either hash or branch must be provided, not both. Target: (<T>)` |
| 4 | both or neither of `target` / `subdirs` | `Either target or subdirs must be provided, not both. Source: (<url or path>)` |

`<T>` is `target` if set, otherwise the `subdirs[].target` values joined with `, `. (Rule 4's message says "not both" even when *neither* is set.)

Field-level errors use yup's wording, for example `repositories is a required field`, `repositories[0].subdirs field must have at least 1 items`. The rewrite does not need to match these exactly.

### 5.7 URL normalization

Let `SHORT = ^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$` (dots are **not** allowed, so `org/repo.js` is not a shortcut).

| `isPrivate` | Input | Result |
|---|---|---|
| false | matches `SHORT` | `https://github.com/<input>.git` |
| false | anything else | unchanged |
| true | matches `SHORT` | `git@github.com:<input>.git` |
| true | starts with exactly `https://github.com/` | prefix replaced with `git@github.com:`, any trailing `.git` stripped, then `.git` appended |
| true | anything else | unchanged |

Unchanged non-shortcut inputs like `org/repo.js` get passed to git as-is, and git treats them as local paths.

---

## 6. Moodle setup

Runs only if `moodle` is present and `moodle.url` is non-empty.

```
target = moodle.path
rm(target)                                        # §8.1
cacheDir = <cwd>/.cache ; mkdir -p cacheDir

key  = lowercase hex SHA-256 of the UTF-8 url string (after env substitution)
low  = lowercase(url)
ext  = ".zip"    if low contains ".zip"
     = ".tar.gz" elif low contains ".tgz" or ".tar.gz"
     = ".tgz"    otherwise
archive = cacheDir/<key><ext>
```

### 6.1 Cache / download

- **Cache hit** if `archive` exists and is a regular file. Log `Using cached Moodle archive: <archive>`. There is no integrity check, no expiry, and old entries are never cleaned up.
- **Cache miss:**
  1. Log `Downloading Moodle from: <url>`.
  2. HTTP GET (follow redirects). If the status is not 2xx, throw `Failed to download Moodle: <statusText>` (no file is created).
  3. Create `archive` and stream the body into it.
  4. Progress bar (TTY only, via the `cli-progress` library):
     - With `Content-Length`: `Downloading [{bar}] {percentage}% | {valueMB}MB / {totalMB}MB`, using `█`/`░` characters.
     - Without it: `Downloading | {valueMB}MB`.
     - MB = bytes / 1024 / 1024, 2 decimals.
  5. If the stream fails partway, the partial file **stays** in the cache and is treated as valid on later runs (§11 Q5).

### 6.2 Extraction

Log `Extracting Moodle to <target>`, then `mkdir -p target`.

- If the **original (case-sensitive)** url contains `.zip`:
  1. Make a system temp dir. Run `unzip -q <archive> -d <tmp>`.
  2. Take the **first directory entry** found in `<tmp>` (directory listing order, usually the single `moodle/` folder) as the source. If there is none, use `<tmp>` itself.
  3. Recursively copy the source's *contents* into `target` (§8.2; symlinks are dropped). Then `rm(<tmp>)`.
- Otherwise: `tar -xf <archive> --strip-components=1 -C <target>` (tar detects the compression).
- **A non-zero exit from unzip or tar does not abort.** Its stderr is printed to stderr and the run continues (§11 Q6).

### 6.3 Patch and cleanup

1. If `moodle.patch`: `applyPatches(moodle.patchDir, target)` (§8.3). A missing `patchDir` is silently ignored.
2. For each `name` in `moodle.cleanup`: `rm(join(target, name))`.

---

## 7. Repository processing

### 7.1 Install list

```
rootDir  = moodle.path if moodle present else "."
installs = repo.subdirs ? [{subdir, target: join(rootDir, t)} for each]
                        : [{subdir: none, target: join(rootDir, repo.target)}]
```

`join` normalizes paths (`a/./b/../c` → `a/c`). Targets can escape `rootDir` with `..`; nothing guards against it.

### 7.2 Skip / enable decision

```
allExist = every install.target exists and is a directory
skip     = repo.skip if set else root.skip   # repo overrides root, both ways

if skip and repo.enable and allExist:
    for each install: log "Skipping: <target>"
    return                                  # no patch, no cleanup
if not repo.enable:
    return                                  # silent; existing targets left untouched
```

Truth table (E = enable, A = all targets exist):

| skip (effective) | E | A | Result |
|---|---|---|---|
| any | false | any | nothing, no log |
| true | true | true | log `Skipping:` per target, nothing else |
| true | true | false | full install (§7.3) |
| false | true | any | full install (§7.3) |

### 7.3 Install

1. `rm(target)` for every install.
2. Get the source, using exactly one of three modes:

**Mode A, local `path`:** for each install:
- `source = repo.path` (no subdir) or `join(repo.path, subdir)`.
- If `source` is not an existing directory, throw `Missing: <source>`.
- `copyDir(source, target)` (§8.2). Copies everything, including `.git` and dotfiles. Symlinks are dropped.

**Mode B, `url` without `subdirs`:**
- If `hash` is set: `checkoutHash(url, target, hash)`. Otherwise: `cloneBranch(url, target, branch?)` (§7.4).

**Mode C, `url` with `subdirs`:**
1. `mkdir -p rootDir`. Create a uniquely named temp dir **inside `rootDir`** with prefix `.easyclone-` (`staging`). Putting it inside `rootDir` keeps it on the same filesystem, so rename works.
2. Clone or fetch into `staging`, same as Mode B.
3. For each install, in order:
   - `source = join(staging, subdir)`. If it is not an existing directory, throw `Missing: <subdir> | <url>`.
   - Log `Moving: <source> | output <target>`.
   - `mkdir -p dirname(target)`, then **rename** `source` → `target`.
   - Consequence: if two entries name the same `subdir`, or one is nested inside another already moved, the later one fails with `Missing`.
4. **Always** (even on error) `rm(staging)`.

3. Post-install, for each install, in order (§7.5).

### 7.4 Git operations

Environment for every git subprocess: the inherited process env, plus, if root `sshKey` is set:

```
GIT_SSH_COMMAND = "ssh -i <sshKey> -o StrictHostKeyChecking=no"
```

This replaces any existing `GIT_SSH_COMMAND`. The key path is not quoted, so spaces break it. git evaluates the value through a shell, so `~` expands. It applies to every repo, including HTTPS ones (harmless there).

git's stdout and stderr are captured, not streamed. On a non-zero exit, throw `Failed: git <args joined by space> | <stderr>`.

**cloneBranch(url, dest, branch?)**, run in `cwd`:
```
log  "Cloning: <url> branch <branch> | output <dest>"     # with branch
log  "Cloning: <url>  | output <dest>"                    # without (note double space)
git clone --depth=1 --single-branch [--branch <branch>] <url> <dest>
```
(The arg order is exactly `clone --depth=1 --single-branch --branch <b> <url> <dest>`.) Without a branch, git clones the remote's default branch.

**checkoutHash(url, dest, hash)**:
```
log "Fetching: <url> hash <hash> | output <dest>"
mkdir -p dest
(cwd = dest) git init
(cwd = dest) git remote add origin <url>
(cwd = dest) git fetch --depth=1 origin <hash>
(cwd = dest) git checkout FETCH_HEAD          # detached HEAD
```
The server must allow fetching by SHA, and in practice a **full** SHA is required.

### 7.5 Post-install (per install target)

1. If `repo.patch`:
   - `pd = join(target, "patch")`. The dir name is fixed and cannot be configured.
   - If `pd` is not an existing dir, throw `Missing: <pd>`.
   - `applyPatches(pd, rootDir)`. The patches apply to the **Moodle root**, not the plugin. If `moodle` is absent, `rootDir` is `.`.
   - `rm(pd)`. This runs even if `pd` contained no `.patch` files.
2. For each `name` in root `cleanup`: `rm(join(target, name))`.
3. For each `name` in `repo.cleanup`: `rm(join(target, name))`.

---

## 8. Shared primitives

### 8.1 `rm(path)`: best-effort delete
- **Guard (fatal, checked first):** if `path` exists and its real path (symlinks resolved) is the real cwd or an ancestor of it, throw `Refusing to delete: <path> | contains the working directory`. This applies to every caller (Moodle path, plugin targets, cleanup entries).
- `stat(path)` (follows symlinks). If it is a dir or a regular file: log `Deleting: <path>` (to stdout) and remove recursively.
- **Every error is swallowed**: not-found, permission denied, partial failure. A broken symlink does not stat, so it is left alone.
- Without the guard, `rm(".")` would delete every entry inside the cwd (verified on v0.1.1), which is why the guard exists.

### 8.2 `copyDir(src, dest)`
- Log `Copying : <src> | output <dest>` (note the space before the colon).
- `mkdir -p dest`. Then recursively: directories → `mkdir -p` and recurse; regular files → copy (permissions preserved by the OS copy). **Symlinks and special files are skipped.**
- The Moodle zip path (§6.2) uses the same recursion without the log line or the initial mkdir.

### 8.3 `applyPatches(patchDir, targetDir)`
1. If `patchDir` doesn't exist, isn't a directory, or can't be read: **return silently**.
2. Collect regular files whose name ends with `.patch` (case-sensitive, top level only, not recursive).
3. If there are none, return silently.
4. Sort the names lexicographically by UTF-16 code units. Use the `0001-…`, `0002-…` naming convention to control order.
5. Log `Patching: <targetDir> | <N> patch` (N = 1) or `… | <N> patches`.
6. For each patch in order:
   - Log `Patching: <name> | output <targetDir>`.
   - Patch file path: absolute if `patchDir` is absolute, otherwise `<cwd>/<patchDir>/<name>`.
   - Run `patch -p1 -d <targetDir> -i <patchFile>` in `cwd`.
   - On a non-zero exit, throw `Failed: patch <name> | <stderr>`. `patch` often reports on stdout, which is discarded, so the message can be empty after `|`.
   - Patches applied before the failure stay applied. `patch` may leave `.orig`/`.rej` files behind.

---

## 9. Errors and output

- Progress logs go to **stdout**. Error output goes to **stderr**.
- Top-level handler:
  - YAML syntax error → stderr `Invalid YAML`.
  - Any other error → stderr `<error message>` (no stack trace, no prefix).
  - Exit code `1`.
- Non-fatal stderr output: tar/unzip failure text (§6.2).
- Error messages include the full git URL (§7.4). **Credentials embedded via env substitution (e.g. `https://user:token@github.com/...`) get printed** (§11 Q8). The `Cloning:`/`Fetching:` log lines print them too.

### 9.1 Complete list of log line formats

```
Deleting: <path>
Using cached Moodle archive: <archivePath>
Downloading Moodle from: <url>
Extracting Moodle to <target>
Patching: <targetDir> | <N> patch|patches
Patching: <patchName> | output <targetDir>
Skipping: <target>
Copying : <src> | output <dest>
Cloning: <url> branch <branch> | output <dest>
Cloning: <url>  | output <dest>
Fetching: <url> hash <hash> | output <dest>
Moving: <source> | output <target>
```

### 9.2 Complete list of fatal error messages

```
<OS error reading config>
Invalid YAML
Environment variable <VAR> is not set and no default value is provided.
<schema validation message>                          (§5.4–§5.6)
Failed to download Moodle: <statusText>
Missing: <source>                                    (local path / subdir of local path)
Missing: <subdir> | <url>                            (subdir of cloned repo)
Missing: <target>/patch                              (repo patch: true)
Refusing to delete: <path> | contains the working directory
Failed: git <args> | <stderr>
Failed: patch <name> | <stderr>
<any other IO error, e.g. rename/mkdir/copy failure>
```

---

## 10. Filesystem footprint

| Path | Lifecycle |
|---|---|
| `<cwd>/.cache/<sha256(url)><ext>` | Created on cache miss. Never deleted. |
| system temp dir (zip only) | Created per run, removed after copy |
| `<rootDir>/.easyclone-<random>` | Created per subdirs-repo, always removed |
| `moodle.path` | Deleted and recreated every run |
| each plugin `target` | Deleted and recreated, unless skipped or disabled |
| `<target>/patch` | Deleted after use when repo `patch: true` |

The repo's `.gitignore` ignores `easyclone.yaml`, `easyclone` (compiled binary), `moodle`, `plugins`, `patch`, `.cache`.

---

## 11. Quirks and bugs: decide keep or fix

| # | Behavior today | Severity | Suggested rewrite behavior |
|---|---|---|---|
| Q1 | **Fixed.** In v0.1.1, `moodle` set with `path` omitted → default `"."` → `rm(".")` wiped the entire cwd. Now `moodle.path` is required and `rm` refuses cwd or its ancestors (§8.1). | — | Keep the fix |
| Q2 | **Fixed.** In v0.1.1, `skip = repo.skip OR root.skip`, so per-repo `skip: false` couldn't override root `skip: true`. Now `effective = repo.skip if set else root.skip`. | — | Keep the fix |
| Q3 | `enable: false` is silent. | Low | Log `Disabled: <target>` |
| Q4 | Env substitution runs on comments, so an unset var in a commented-out line throws. Values are inserted raw (no YAML escaping). | Medium | Substitute after YAML parsing, on string scalars only. Or keep it and document it. |
| Q5 | An interrupted download leaves a corrupt archive in the cache that is reused forever. | Medium | Download to `<file>.part`, then rename atomically. Optionally support a checksum. |
| Q6 | A tar/unzip failure is not fatal. The run continues with an empty or partial Moodle. | Medium | Make it fatal. |
| Q7 | `.zip` detection is case-insensitive for the cache extension but case-sensitive for choosing the extractor. It is substring based (`?format=.zip` matches). | Low | Use one decision, based on the URL path's suffix (or magic bytes). |
| Q8 | Credentials in URLs are logged in `Cloning:`/`Fetching:` lines and in `Failed: git …` errors. | Medium | Redact `userinfo` in URLs before logging. |
| Q9 | Relative paths resolve against cwd, not the config file's directory. | Design | Keep (container use), but document it. |
| Q10 | Symlinks are dropped by local `path` copies and by zip extraction, but kept by tar extraction and git clones. | Low | Preserve symlinks in copies. |
| Q11 | `sshKey` is not quoted in `GIT_SSH_COMMAND`, and `StrictHostKeyChecking=no` is always on. | Low | Quote the path. Consider `accept-new`. |
| Q12 | Unknown config keys are silently accepted, so typos like `taget:` go unnoticed. That example then fails rule 4 with a confusing message. | Low | Reject or warn on unknown keys. |
| Q13 | Rule 4's message says "not both" even when neither is given. | Cosmetic | Separate messages. |
| Q14 | A `Missing: …/patch` check happens after the clone. An empty patch dir still passes and gets deleted. | Low | Fine either way. |
| Q15 | The YAML error detail (line/column) is thrown away (`Invalid YAML`). | Low | Include the parser message. |
| Q16 | No `--help` / `--version`. Unknown flags are ignored. | Low | Add both. Error on unknown flags. |
| Q17 | The schema says "branch" but git accepts tags there too. That's intended; the README says "branch or tag". | — | Keep |

---

## 12. Acceptance scenarios (for a test suite)

Use a temp `cwd` per test, local bare git repos (`file://` URLs) and a local HTTP server for the archive.

**Config**
1. Missing config file → exit 1, OS error on stderr.
2. Malformed YAML → exit 1, stderr `Invalid YAML`.
3. `${UNSET}` anywhere (even in a comment) → exit 1 with the env message. `${UNSET:-d}` → `d`. `\${X}` → literal `${X}`.
4. `repositories` missing → error. `repositories: []` → success, no-op.
5. `moodle: {path: m}` without url → `moodle.url is a required field`.
6. Each cross-field rule in §5.6 produces its message.
7. `branch: 2024041001` (unquoted number) is accepted as the string `"2024041001"`.
8. URL normalization table in §5.7, every row.

**Moodle**
9. A `.tgz` URL downloads, gets cached at `.cache/<sha256>.tar.gz`, and extracts with the top-level dir stripped.
10. A second run uses the cache (no HTTP request, logs `Using cached…`).
11. A `.zip` URL extracts the inner folder's contents into `path`.
12. HTTP 404 → exit 1, `Failed to download Moodle: Not Found`, no cache file left behind.
13. `patch/0002-b.patch` and `patch/0001-a.patch` apply in order 0001, 0002. A non-`.patch` file is ignored. A missing `patch/` dir is OK.
14. A failing patch → exit 1, `Failed: patch <name> | …`.
15. `moodle.cleanup` entries are removed. Missing entries are silently ignored.
15a. `moodle.path: .` (or `..`, or an absolute ancestor of cwd) → exit 1, `Refusing to delete: …`, nothing in cwd deleted. A plugin `target: .` without `moodle` behaves the same.
16. Without a `moodle` section, plugins install relative to `cwd`.

**Repositories**
17. Shortcut + `branch` → shallow single-branch clone at that branch/tag. Root cleanup removes `.git`.
18. `hash` → working tree at that commit (detached).
19. No branch/hash → default branch.
20. `path` → recursive copy. A missing path → `Missing: <path>`.
21. `subdirs` from a git repo → each subdir lands at its target. No `.easyclone-*` is left in rootDir, even when a subdir is missing (which throws `Missing: <subdir> | <url>`).
22. `subdirs` from a local `path` → copies each subdir.
23. `enable: false` → target untouched, no output.
24. `skip: true` + existing target → `Skipping:` and no change. `skip: true` + missing target → installs.
25. Root `skip: true`, repo `skip: false`, existing target → **reinstalled** (repo overrides root). Root `skip: false`, repo `skip: true`, existing target → skipped.
26. `patch: true` → `<target>/patch/*.patch` applied to the Moodle root, then `<target>/patch` removed. Missing dir → `Missing: <target>/patch`.
27. Root `cleanup` runs before repo `cleanup`. Both apply to every subdirs target.
28. A git failure → exit 1, `Failed: git clone … | <stderr>`. Earlier repos remain installed.
29. `sshKey` set → git subprocess env has `GIT_SSH_COMMAND=ssh -i <key> -o StrictHostKeyChecking=no`.

---

## 13. Porting notes

- **Distribution:** today the tool ships as `deno compile --allow-run=git,unzip,tar,patch --allow-read --allow-write --allow-env --allow-net main.ts` → a single binary. A rewrite that also produces one static binary keeps the container story the same. Go and Rust both do this natively.
- **Library choices that remove external binaries (optional):** a native tar/gzip and zip reader removes the `tar`/`unzip` dependency (and fixes Q6/Q7/Q10). Keep `git` and `patch` as subprocesses. Reimplementing them in-process is not worth it, and `patch -p1` semantics are what users' patch files expect.
- **Progress bar:** cosmetic and TTY-only. Any equivalent is fine.
- **Validation library:** the yup coercion rules (§5.3) are loose. If you want strict typing in the rewrite, quote numeric branches (`branch: "2024041001"`) in existing configs. The example config already does.
- **Behavior to preserve exactly** (users depend on it): the config schema, defaults, URL normalization, patch ordering and `-p1`, the delete-then-install semantics, the cache location and key, relative-to-cwd resolution, and the ordering of setup → repos → (patch → root cleanup → repo cleanup).
