export const MEDIA_STORAGE_PREFIXES = {
  sourceMedia: "source-media",
  renderOutputs: "render-outputs",
  thumbnails: "thumbnails",
  audioAssets: "audio-assets",
  timelineAssets: "timeline-assets",
  temporaryRenderWorkspace: "temporary-render-workspace",
} as const;

export function createRenderOutputStorageKey(input: { userId: string; editJobId: string }) {
  return `${MEDIA_STORAGE_PREFIXES.renderOutputs}/${input.userId}/${input.editJobId}/output.mp4`;
}

export function createSourceMediaStoragePrefix(userId: string) {
  return `${MEDIA_STORAGE_PREFIXES.sourceMedia}/${userId}`;
}

export function createThumbnailStoragePrefix(input: { userId: string; editJobId: string }) {
  return `${MEDIA_STORAGE_PREFIXES.thumbnails}/${input.userId}/${input.editJobId}`;
}

export function createAudioAssetStoragePrefix(userId: string) {
  return `${MEDIA_STORAGE_PREFIXES.audioAssets}/${userId}`;
}

export function createTimelineAssetStoragePrefix(input: { userId: string; editJobId: string }) {
  return `${MEDIA_STORAGE_PREFIXES.timelineAssets}/${input.userId}/${input.editJobId}`;
}

export function createTemporaryRenderWorkspaceStoragePrefix(input: { userId: string; editJobId: string }) {
  return `${MEDIA_STORAGE_PREFIXES.temporaryRenderWorkspace}/${input.userId}/${input.editJobId}`;
}
