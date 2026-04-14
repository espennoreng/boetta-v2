import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
export const R2_BUCKET = process.env.R2_BUCKET ?? "";

let cached: S3Client | null = null;
export function r2Client(): S3Client {
  if (cached) return cached;
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error(
      "R2 not configured: require R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET",
    );
  }
  cached = new S3Client({
    region: "auto",
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    },
  });
  return cached;
}

export async function presignPut(params: {
  key: string;
  contentType: string;
  expiresInSec?: number;
}): Promise<string> {
  return getSignedUrl(
    r2Client(),
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: params.key,
      ContentType: params.contentType,
    }),
    { expiresIn: params.expiresInSec ?? 600 },
  );
}

export async function presignGet(params: {
  key: string;
  expiresInSec?: number;
}): Promise<string> {
  return getSignedUrl(
    r2Client(),
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: params.key }),
    { expiresIn: params.expiresInSec ?? 300 },
  );
}

export async function fetchObjectStream(params: {
  key: string;
}): Promise<{ body: ReadableStream; contentType?: string }> {
  const out = await r2Client().send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: params.key }),
  );
  if (!out.Body) {
    throw new Error(`R2 object missing body: ${params.key}`);
  }
  return {
    body: out.Body.transformToWebStream(),
    contentType: out.ContentType,
  };
}

const MAX_NAME_LEN = 120;

export function sanitizeFilename(input: string): string {
  const lastSeg = input.split(/[\\/]/).filter(Boolean).join("-");
  let name = lastSeg
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-]+/, "")
    .replace(/-+\./g, ".");
  if (!name) return "file";
  if (name.length <= MAX_NAME_LEN) return name;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return name.slice(0, MAX_NAME_LEN);
  const ext = name.slice(dot);
  const stem = name.slice(0, dot);
  return stem.slice(0, MAX_NAME_LEN - ext.length) + ext;
}

function assertSafeKeySegment(name: string, value: string): void {
  if (!value) {
    throw new Error(`buildR2Key: ${name} is empty`);
  }
  if (/[\\/]/.test(value) || value === "." || value === "..") {
    throw new Error(`buildR2Key: ${name} must not contain slashes or be '.' / '..'`);
  }
}

export function buildR2Key(params: {
  orgId: string;
  sessionId: string;
  uuid: string;
  filename: string;
}): string {
  assertSafeKeySegment("orgId", params.orgId);
  assertSafeKeySegment("sessionId", params.sessionId);
  assertSafeKeySegment("uuid", params.uuid);
  return `org/${params.orgId}/session/${params.sessionId}/${params.uuid}-${sanitizeFilename(params.filename)}`;
}
