import path from "node:path";

export function getEditJobWorkspacePath(editJobId: string) {
  return path.resolve(process.cwd(), "tmp", "jobs", editJobId);
}
