import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import 'dotenv/config';

const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? 'minioadmin';
export const S3_BUCKET = process.env.S3_BUCKET ?? 'pointer-updates';

export const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

export async function ensureBucket(bucket: string = S3_BUCKET): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export async function upload(
  key: string,
  buffer: Buffer | Uint8Array | Readable,
  contentType = 'application/octet-stream',
): Promise<{ key: string; bucket: string }> {
  const uploader = new Upload({
    client: s3,
    params: {
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    },
  });
  await uploader.done();
  return { key, bucket: S3_BUCKET };
}

export async function download(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const body = res.Body as Readable | undefined;
  if (!body) throw new Error(`Empty body for ${key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

export async function getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return awsGetSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}
