import type { Renderer } from "./renderer.interface";
import type { RenderInput } from "./rendering.types";

const FFMPEG_STUB_RENDER_DELAY_MS = 1000;

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class FFmpegRenderer implements Renderer {
  constructor(private readonly delay = wait) {}

  async render(input: RenderInput) {
    const startedAt = Date.now();

    await this.delay(FFMPEG_STUB_RENDER_DELAY_MS);

    return {
      outputStorageKey: `outputs/${input.userId}/${input.editJobId}.mp4`,
      durationMs: Date.now() - startedAt,
      metadata: {
        renderer: "ffmpeg",
        mode: "stub",
      },
    };
  }
}
