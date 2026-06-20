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
