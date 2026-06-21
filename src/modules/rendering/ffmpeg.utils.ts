import { spawn } from "node:child_process";

export function checkFfmpegAvailability() {
  return new Promise<boolean>((resolve) => {
    const child = spawn("ffmpeg", ["-version"], {
      windowsHide: true,
    });

    child.once("error", () => {
      resolve(false);
    });
    child.once("exit", (code) => {
      resolve(code === 0);
    });
  });
}

export function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      windowsHide: true,
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`FFmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}
