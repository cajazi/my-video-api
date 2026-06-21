import path from "node:path";
import { rm } from "node:fs/promises";

export function getEditJobWorkspacePath(editJobId: string) {
  return path.resolve(process.cwd(), "tmp", "jobs", editJobId);
}

export function getEditJobOutputPath(editJobId: string) {
  return path.join(getEditJobWorkspacePath(editJobId), "output.mp4");
}

export async function deleteEditJobWorkspace(editJobId: string) {
  const jobsRoot = path.resolve(process.cwd(), "tmp", "jobs");
  const workspacePath = getEditJobWorkspacePath(editJobId);
  const relativeWorkspacePath = path.relative(jobsRoot, workspacePath);

  if (
    !relativeWorkspacePath ||
    relativeWorkspacePath.startsWith("..") ||
    path.isAbsolute(relativeWorkspacePath)
  ) {
    throw new Error("Refusing to delete workspace outside tmp/jobs");
  }

  await rm(workspacePath, {
    recursive: true,
    force: true,
  });
}
