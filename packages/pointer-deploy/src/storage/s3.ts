import {
  S3Client,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import 'dotenv/config';

const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? 'minioadmin';
export const S3_BUCKET = process.env.S3_BUCKET ?? 'pointer-builds';

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

export async function getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return awsGetSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
