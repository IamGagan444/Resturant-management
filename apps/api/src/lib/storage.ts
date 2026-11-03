import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { env } from "../env";

/** Menu photos are shown at most ~600 CSS px wide on phones; 1200 px covers 2× screens. */
const MAX_PX = 1200;

/** File signature check: the browser-sent MIME type and file name are not trusted. */
export function sniffImage(b: Buffer): "jpeg" | "png" | "webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * Normalise an uploaded photo: auto-rotate (EXIF), cap at MAX_PX, strip metadata (GPS etc.), WebP.
 * A 4 MB phone photo becomes ~100–200 KB, which matters on slow 4G menus.
 */
export async function toWebp(input: Buffer): Promise<Buffer> {
  if (!sniffImage(input)) throw new Error("Not a JPEG, PNG or WebP file");
  // 50 MP is beyond any phone camera; larger "images" are decompression bombs.
  return sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: MAX_PX, height: MAX_PX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}

let s3: S3Client | null = null;
function s3Client(): S3Client {
  s3 ??= new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}), // R2 / MinIO need a custom endpoint
    credentials: { accessKeyId: env.S3_ACCESS_KEY ?? "", secretAccessKey: env.S3_SECRET_KEY ?? "" },
  });
  return s3;
}

/** Store an image under the hotel's folder; returns its public URL. Keys are random and content never changes → cache forever. */
export async function saveImage(hotelId: string, image: Buffer): Promise<string> {
  const name = `${randomBytes(12).toString("base64url")}.webp`;
  if (env.STORAGE_DRIVER === "s3") {
    const key = `menu/${hotelId}/${name}`;
    await s3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: image,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return `${env.S3_PUBLIC_URL?.replace(/\/$/, "")}/${key}`;
  }
  const dir = path.resolve(env.UPLOAD_DIR, hotelId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), image);
  return `${env.API_URL}/uploads/${hotelId}/${name}`;
}
