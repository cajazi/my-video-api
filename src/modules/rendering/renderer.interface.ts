import type { RenderInput, RenderResult } from "./rendering.types";

export interface Renderer {
  render(input: RenderInput): Promise<RenderResult>;
}
