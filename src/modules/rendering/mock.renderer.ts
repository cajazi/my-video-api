import type { Renderer } from "./renderer.interface";
import type { RenderInput } from "./rendering.types";

const MOCK_RENDER_DELAY_MS = 1000;

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class MockRenderer implements Renderer {
  constructor(private readonly delay = wait) {}

  async render(input: RenderInput) {
    const startedAt = Date.now();

    await this.delay(MOCK_RENDER_DELAY_MS);

    return {
      outputStorageKey: `outputs/${input.userId}/${input.editJobId}.mp4`,
      durationMs: Date.now() - startedAt,
      metadata: {
        renderer: "mock",
        sourceStorageKey: input.sourceStorageKey,
      },
    };
  }
}
