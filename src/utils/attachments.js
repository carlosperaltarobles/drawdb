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

export const MAX_ATTACHMENTS_BYTES = 5 * 1024 * 1024;

/** Tamaño exacto en bytes de los adjuntos ya codificados en base64. */
export function attachmentsSize(attachments) {
  return attachments.reduce(
    (total, { content }) =>
      total +
      Math.floor((content.length * 3) / 4) -
      (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0),
    0,
  );
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("attachment_failed"));
    reader.onabort = () => reject(new Error("attachment_failed"));
    reader.readAsDataURL(file);
  });
}

export async function readAttachments(files, readFile = readDataUrl) {
  if (
    files.reduce((total, file) => total + file.fileInstance.size, 0) >
    MAX_ATTACHMENTS_BYTES
  ) {
    throw new Error("attachments_too_large");
  }
  const attachments = await Promise.all(
    files.map(async ({ name, fileInstance }) =>
      dataUriToAttachment(await readFile(fileInstance), name),
    ),
  );
  if (attachmentsSize(attachments) > MAX_ATTACHMENTS_BYTES) {
    throw new Error("attachments_too_large");
  }
  return attachments;
}
