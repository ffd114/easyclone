import { isAbsolute, join } from "@std/path";
import cliProgress from "cli-progress";
import { RootConfig } from "./config.ts";
import { rm, isDirExists, _copyDir, ask } from "./utils.ts";

export const setupMoodle = async (rootConfig: RootConfig) => {
  if (!rootConfig.moodle || !rootConfig.moodle.url) return;

  const target = rootConfig.moodle.path;
  const isTargetExists = await isDirExists(target);

  if (isTargetExists) {
    if (!rootConfig.moodle.overwrite) {
      if (rootConfig.moodle.patch) {
        console.log(`Skipping moodle: ${target} already exists (patching is also skipped). To run patches, delete the folder or set overwrite: true.`);
      } else {
        console.log(`Skipping moodle: ${target} already exists`);
      }
      return;
    }

    if (!rootConfig.force && !ask(`Target ${target} exists. Delete?`)) return;
    await rm(target);
  }

  let archivePath = "";
  let isFromCache = false;
  const useCache = rootConfig.moodle.cache;

  if (useCache) {
    const cacheDir = join(Deno.cwd(), ".cache");
    await Deno.mkdir(cacheDir, { recursive: true });
    
    const msgUint8 = new TextEncoder().encode(rootConfig.moodle.url);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    const urlLower = rootConfig.moodle.url.toLowerCase();
    const ext = urlLower.includes(".zip") ? ".zip" : urlLower.includes(".tgz") || urlLower.includes(".tar.gz") ? ".tar.gz" : ".tgz";
    
    archivePath = join(cacheDir, `${hashHex}${ext}`);
    try {
      const stat = await Deno.stat(archivePath);
      if (stat.isFile) {
        console.log(`Using cached Moodle archive: ${archivePath}`);
        isFromCache = true;
      }
    } catch (_) {
      // Cache file does not exist
    }
  }

  if (!isFromCache) {
    console.log(`Downloading Moodle from: ${rootConfig.moodle.url}`);
    const res = await fetch(rootConfig.moodle.url);
    if (!res.ok) {
      throw new Error(`Failed to download Moodle: ${res.statusText}`);
    }

    const contentLength = res.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    
    const progressBar = new cliProgress.SingleBar({
      format: totalBytes 
        ? 'Downloading [{bar}] {percentage}% | {valueMB}MB / {totalMB}MB'
        : 'Downloading | {valueMB}MB',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(totalBytes || 100, 0, {
      valueMB: "0.00",
      totalMB: totalBytes ? (totalBytes / 1024 / 1024).toFixed(2) : "Unknown"
    });

    const destPath = useCache ? archivePath : await Deno.makeTempFile();
    const file = await Deno.open(destPath, { write: true, create: true });
    
    if (res.body) {
      let downloadedBytes = 0;
      const progressStream = new TransformStream({
        transform(chunk, controller) {
          downloadedBytes += chunk.byteLength;
          progressBar.update(totalBytes ? downloadedBytes : 0, {
            valueMB: (downloadedBytes / 1024 / 1024).toFixed(2)
          });
          controller.enqueue(chunk);
        },
        flush() {
          progressBar.stop();
        }
      });

      await res.body.pipeThrough(progressStream).pipeTo(file.writable);
    } else {
      progressBar.stop();
    }
    
    if (!useCache) {
      archivePath = destPath;
    }
  }

  console.log(`Extracting Moodle to ${target}`);
  await Deno.mkdir(target, { recursive: true });

  if (rootConfig.moodle.url.includes(".zip")) {
    const tempDir = await Deno.makeTempDir();
    const { code, stderr } = await new Deno.Command("unzip", {
      args: ["-q", archivePath, "-d", tempDir],
    }).output();
    
    if (code !== 0) {
      console.error(new TextDecoder().decode(stderr));
    }
    
    // Find the extracted folder (usually "moodle")
    let sourceDir = tempDir;
    for await (const entry of Deno.readDir(tempDir)) {
      if (entry.isDirectory) {
        sourceDir = join(tempDir, entry.name);
        break;
      }
    }
    
    await _copyDir(sourceDir, target);
    await rm(tempDir);
  } else {
    const { code, stderr } = await new Deno.Command("tar", {
      args: ["-xf", archivePath, "--strip-components=1", "-C", target],
    }).output();
    
    if (code !== 0) {
      console.error(new TextDecoder().decode(stderr));
    }
  }

  if (!useCache) {
    await rm(archivePath);
  }

  if (rootConfig.moodle.patch) {
    const patchDir = rootConfig.moodle.patchDir;
    try {
      const dirInfo = await Deno.stat(patchDir);
      if (dirInfo.isDirectory) {
        const patches: string[] = [];
        for await (const entry of Deno.readDir(patchDir)) {
          if (entry.isFile && entry.name.endsWith(".patch")) {
            patches.push(entry.name);
          }
        }

        if (patches.length > 0) {
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
              console.error(`Failed to apply ${patch}:`, new TextDecoder().decode(stderr));
            }
          }
        }
      }
    } catch (_) {
      // Patch directory does not exist or cannot be read, safely ignore
    }
  }
};
