"use client";

/**
 * Phone cameras make 5-10 MB photos, far more than is needed to read a page of writing.
 * This scales a photo down to at most 1800 px on its longest side and saves it as a JPEG.
 * If the browser cannot do that, the original file is sent unchanged.
 */
export async function shrinkImage(file: File, maxSide = 1800): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 2 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#ffffff"; // a transparent PNG would otherwise turn black as a JPEG
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], "order.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
