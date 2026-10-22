const DATA_URI = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s;

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/**
 * Convierte un data URI en el adjunto que acepta el backend:
 * { filename, content (base64), encoding: 'base64', contentType }.
 */
export function dataUriToAttachment(dataUri, filename) {
  const match = typeof dataUri === "string" ? DATA_URI.exec(dataUri) : null;
  if (!match) throw new Error("Invalid data URI");

  const [, contentType, params, payload] = match;
  const isBase64 = params.split(";").includes("base64");
  const content = isBase64
    ? payload
    : utf8ToBase64(decodeURIComponent(payload));

  return {
    filename,
    content,
    encoding: "base64",
    contentType: contentType || "text/plain",
  };
}
