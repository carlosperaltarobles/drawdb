// Loads a version to preview. Only the most recent request is shown, so quick clicks on several
// versions never end on the wrong one; failures are reported instead of left unhandled.
export function createPreviewLoader({ fetch, start, onError }) {
  let latest = 0;
  return async (snapshotId) => {
    const request = ++latest;
    try {
      const snapshot = await fetch(snapshotId);
      if (request === latest) start(snapshot);
    } catch (err) {
      if (request === latest) onError(err);
    }
  };
}
