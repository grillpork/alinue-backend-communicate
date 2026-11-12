import { S3Client } from '@aws-sdk/client-s3';

/**
 * ดึง S3Client สำหรับเชื่อมต่อ Cloudflare R2 จาก Environment Variables
 */
export function getR2Client(c) {
  const accountId = (c?.env?.R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || '').replace(/['"]/g, '').trim();
  const accessKeyId = (c?.env?.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '').replace(/['"]/g, '').trim();
  const secretAccessKey = (c?.env?.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '').replace(/['"]/g, '').trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) are not configured');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * ดึงชื่อ bucket และ public url ของ R2 จาก Environment Variables
 */
export function getR2Config(c) {
  const bucketName = (c?.env?.R2_BUCKET_NAME || process.env.R2_BUCKET_NAME || '').replace(/['"]/g, '').trim();
  const publicUrl = (c?.env?.R2_PUBLIC_URL || process.env.R2_PUBLIC_URL || '').replace(/['"]/g, '').trim();

  return {
    bucketName,
    publicUrl,
  };
}

