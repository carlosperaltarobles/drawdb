function validView(value) {
  return (
    Number.isFinite(value?.pan?.x) &&
    Number.isFinite(value?.pan?.y) &&
    Number.isFinite(value?.zoom) &&
    value.zoom >= 0.02 &&
    value.zoom <= 5
  );
}

export function load(projectId, userId = null) {
  try {
    const value = JSON.parse(localStorage.getItem(`drawdb:view:${projectId}`));
    if (!validView(value) || (value.userId ?? null) !== userId) return null;
    return { pan: value.pan, zoom: value.zoom };
  } catch {
    // Storage may be disabled, full, or contain data from an older client.
    return null;
  }
}

export function save(projectId, view, userId = null) {
  if (!validView(view)) return;
  try {
    localStorage.setItem(
      `drawdb:view:${projectId}`,
      JSON.stringify({ pan: view.pan, zoom: view.zoom, userId }),
    );
  } catch {
    // Local navigation persistence is optional; collaboration must keep working.
  }
}
