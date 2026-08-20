const MAX_AVATAR_EDGE = 640;
const MAX_AVATAR_BYTES = 70 * 1024;
const LOCAL_AVATAR_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'%3E%3Crect width='240' height='240' fill='%2307110f'/%3E%3Ccircle cx='120' cy='88' r='42' fill='%23d3ff48'/%3E%3Cpath d='M42 220c6-54 34-82 78-82s72 28 78 82' fill='%23d3ff48'/%3E%3C/svg%3E";

const avatarTypes = new Map([
  ["image/jpeg", new Set(["jpg", "jpeg"])],
  ["image/png", new Set(["png"])],
  ["image/webp", new Set(["webp"])],
  ["image/heic", new Set(["heic", "heif"])],
  ["image/heif", new Set(["heic", "heif"])],
]);

export function isAcceptedAvatar(file: File) {
  const normalizedName = file.name.toLowerCase();
  const dotIndex = normalizedName.lastIndexOf(".");
  const extension = dotIndex >= 0 ? normalizedName.slice(dotIndex + 1) : "";
  if (!file.type) return Boolean(extension && [...avatarTypes.values()].some((extensions) => extensions.has(extension)));
  const extensions = avatarTypes.get(file.type.toLowerCase());
  if (!extensions) return false;
  return !extension || extensions.has(extension);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("อ่านรูปที่ย่อแล้วไม่สำเร็จ"));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function loadImage(file: File) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Safari can decode some camera formats through <img> even when createImageBitmap cannot.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("เบราว์เซอร์นี้ไม่สามารถย่อรูปที่เลือกได้"));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function compressAvatarForLocalStorage(file: File, fallbackDataUrl: string) {
  try {
    const image = await loadImage(file);
    const sourceWidth = image.width;
    const sourceHeight = image.height;
    const initialScale = Math.min(1, MAX_AVATAR_EDGE / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("ไม่สามารถเตรียมรูปสำหรับ Local Demo ได้");

    let width = Math.max(1, Math.round(sourceWidth * initialScale));
    let height = Math.max(1, Math.round(sourceHeight * initialScale));
    let result: Blob | null = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = "#07110f";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      result = await canvasToBlob(canvas, Math.max(0.48, 0.82 - attempt * 0.07));
      if (result && result.size <= MAX_AVATAR_BYTES) break;
      width = Math.max(240, Math.round(width * 0.82));
      height = Math.max(240, Math.round(height * 0.82));
    }

    if ("close" in image && typeof image.close === "function") image.close();
    return result ? await blobToDataUrl(result) : LOCAL_AVATAR_PLACEHOLDER;
  } catch {
    return fallbackDataUrl.length <= MAX_AVATAR_BYTES
      ? fallbackDataUrl
      : LOCAL_AVATAR_PLACEHOLDER;
  }
}
