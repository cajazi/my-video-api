import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env";
import { createRenderOutputStorageKey } from "./media-storage.paths";

const RENDERED_OUTPUT_SIGNED_DOWNLOAD_TTL_SECONDS = 10 * 60;

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export class RenderedOutputStorage {
  private readonly bucket = supabase.storage.from(env.SUPABASE_STORAGE_BUCKET);

  createOutputStorageKey(input: { userId: string; editJobId: string }) {
    return createRenderOutputStorageKey(input);
  }

  async uploadRenderedOutput(input: { localOutputPath: string; storageKey: string }) {
    const file = await readFile(input.localOutputPath);
    const { error } = await this.bucket.upload(input.storageKey, file, {
      contentType: "video/mp4",
      upsert: false,
    });

    if (error) {
      throw error;
    }

    return {
      storageKey: input.storageKey,
    };
  }

  async createSignedDownloadUrl(storageKey: string) {
    const { data, error } = await this.bucket.createSignedUrl(
      storageKey,
      RENDERED_OUTPUT_SIGNED_DOWNLOAD_TTL_SECONDS,
    );

    if (error || !data?.signedUrl) {
      throw error ?? new Error("Unable to create signed rendered output URL");
    }

    return data.signedUrl;
  }
}

export { RENDERED_OUTPUT_SIGNED_DOWNLOAD_TTL_SECONDS };
