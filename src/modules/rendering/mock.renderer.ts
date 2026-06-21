import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Renderer } from "./renderer.interface";
import type { RenderInput } from "./rendering.types";
import { createRenderOutputStorageKey } from "../storage/media-storage.paths";
import { getEditJobOutputPath } from "./workspace.util";

const MOCK_RENDER_DELAY_MS = 1000;
const MOCK_OUTPUT_FILE_CONTENT = "mock rendered output";

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class MockRenderer implements Renderer {
  constructor(private readonly delay = wait) {}

  async render(input: RenderInput) {
    const startedAt = Date.now();
    const localOutputPath = getEditJobOutputPath(input.editJobId);

    await this.delay(MOCK_RENDER_DELAY_MS);
    await mkdir(path.dirname(localOutputPath), {
      recursive: true,
    });
    await writeFile(localOutputPath, MOCK_OUTPUT_FILE_CONTENT);

    return {
      outputStorageKey: createRenderOutputStorageKey(input),
      localOutputPath,
      durationMs: Date.now() - startedAt,
      metadata: {
        renderer: "mock",
        sourceStorageKey: input.sourceStorageKey,
      },
    };
  }
}
