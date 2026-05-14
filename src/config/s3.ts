import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
export const r2BucketName = process.env.R2_BUCKET_NAME;
export const r2PublicUrl = process.env.R2_PUBLIC_URL;

export const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: accessKeyId || "",
    secretAccessKey: secretAccessKey || "",
  },
});

export const generatePresignedUrl = async (fileType: string, customExtension?: string) => {
  if (!r2BucketName || !r2PublicUrl) throw new Error("R2 is not configured properly");

  const ext = customExtension || fileType.split("/")[1] || "bin";
  const filename = `${crypto.randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: r2BucketName,
    Key: filename,
    ContentType: fileType,
  });

  // URL expires in 60 seconds
  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });

  return {
    uploadUrl: signedUrl,
    fileUrl: `${r2PublicUrl}/${filename}`,
    filename,
  };
};

export const uploadBase64ToR2 = async (base64String: string, mimeType: string, customExtension?: string) => {
  if (!r2BucketName || !r2PublicUrl) throw new Error("R2 is not configured properly");

  // Remove data:image/png;base64, from string
  const base64Data = base64String.replace(/^data:([A-Za-z-+/]+);base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  const ext = customExtension || mimeType.split("/")[1] || "bin";
  const filename = `${crypto.randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: r2BucketName,
    Key: filename,
    Body: buffer,
    ContentType: mimeType,
  });

  await s3Client.send(command);

  // Return the public URL
  return `${r2PublicUrl}/${filename}`;
};

export const uploadBufferToR2 = async (buffer: Buffer, mimeType: string, customExtension?: string) => {
  if (!r2BucketName || !r2PublicUrl) throw new Error("R2 is not configured properly");

  const ext = customExtension || mimeType.split("/")[1] || "bin";
  const filename = `${crypto.randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: r2BucketName,
    Key: filename,
    Body: buffer,
    ContentType: mimeType,
  });

  await s3Client.send(command);

  return `${r2PublicUrl}/${filename}`;
};

export const deleteFileFromR2 = async (fileUrl: string) => {
  if (!r2BucketName || !r2PublicUrl) return;

  // Extract the key from the public URL
  // e.g., https://pub-xxxx.r2.dev/filename.png -> filename.png
  const key = fileUrl.replace(`${r2PublicUrl}/`, "");

  if (key === fileUrl) return; // Not an R2 URL or already just a key

  try {
    const command = new DeleteObjectCommand({
      Bucket: r2BucketName,
      Key: key,
    });
    await s3Client.send(command);
    console.log(`Deleted file from R2: ${key}`);
  } catch (error) {
    console.error(`Failed to delete file from R2: ${key}`, error);
  }
};
