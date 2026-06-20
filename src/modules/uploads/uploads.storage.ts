import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env";

const SIGNED_UPLOAD_TTL_SECONDS = 15 * 60;
const SIGNED_DOWNLOAD_TTL_SECONDS = 10 * 60;

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export class UploadsStorage {
  private readonly bucket = supabase.storage.from(env.SUPABASE_STORAGE_BUCKET);

  async createSignedUploadUrl(storageKey: string) {
    const { data, error } = await this.bucket.createSignedUploadUrl(storageKey, {
      upsert: false,
    });

    if (error || !data?.signedUrl) {
      throw error ?? new Error("Unable to create signed upload URL");
    }

    return data.signedUrl;
  }

  async createSignedDownloadUrl(storageKey: string) {
    const { data, error } = await this.bucket.createSignedUrl(storageKey, SIGNED_DOWNLOAD_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      throw error ?? new Error("Unable to create signed download URL");
    }

    return data.signedUrl;
  }

  async objectExists(storageKey: string) {
    const lastSlashIndex = storageKey.lastIndexOf("/");
    const folder = lastSlashIndex === -1 ? "" : storageKey.slice(0, lastSlashIndex);
    const fileName = lastSlashIndex === -1 ? storageKey : storageKey.slice(lastSlashIndex + 1);
    const { data, error } = await this.bucket.list(folder, {
      limit: 1,
      search: fileName,
    });

    if (error) {
      throw error;
    }

    return data.some((object) => object.name === fileName);
  }
}

export { SIGNED_DOWNLOAD_TTL_SECONDS, SIGNED_UPLOAD_TTL_SECONDS };
