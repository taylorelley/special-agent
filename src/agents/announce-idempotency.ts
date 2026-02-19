export function buildAnnounceIdFromChildRun(params: {
  childSessionKey: string;
  childRunId: string;
}): string {
  return `v1:${params.childSessionKey}:${params.childRunId}`;
}

export function buildAnnounceIdempotencyKey(announceId: string): string {
  return `announce:${announceId}`;
}

export function resolveQueueAnnounceId(params: {
  childSessionKey: string;
  childRunId?: string;
}): string | undefined {
  if (!params.childRunId) {
    return undefined;
  }
  return buildAnnounceIdFromChildRun({
    childSessionKey: params.childSessionKey,
    childRunId: params.childRunId,
  });
}
