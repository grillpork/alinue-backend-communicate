import { Hono } from 'hono';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getR2Client, getR2Config } from '../../config/r2';
import { getDb } from '../../config/db';
import { optionalAuth, requireAuth } from '../../middleware/auth';
import { checkImageUrl, checkImageFile } from '../../utils/moderation';

const upload = new Hono();

// ประเภทไฟล์ที่อนุญาต
const ALLOWED_MIME_TYPES = {
  // รูปภาพ (แปลงเป็น .webp เพื่อความเร็วและขนาดไฟล์ที่เล็กที่สุด)
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  // วิดีโอ (รองรับ .webm และ .mp4)
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/**
 * 1. POST /api/upload/presigned-url
 * ออกใบผ่านทางชั่วคราว (Presigned URL) ให้ Frontend อัปโหลดไฟล์ตรงเข้า Cloudflare R2
 * - รวดเร็วระดับ Edge ทั่วโลก
 * - รองรับ .webp, .webm, gif, video
 * - ไม่ติด timeout ของ Cloudflare Worker
 */
upload.post('/presigned-url', optionalAuth, async (c) => {
  try {
    const body = await c.req.json();
    const {
      filename,
      contentType,
      folder = 'posts',
      convertToWebp = true,
    } = body;

    if (!contentType) {
      return c.json(
        { success: false, message: 'contentType is required' },
        400
      );
    }

    const mime = contentType.toLowerCase();
    if (!ALLOWED_MIME_TYPES[mime]) {
      return c.json(
        {
          success: false,
          message: `Unsupported file type: ${mime}. Allowed: WebP, JPEG, PNG, GIF, WebM, MP4.`,
        },
        400
      );
    }

    // กำหนด extension ปลายทาง
    let ext = ALLOWED_MIME_TYPES[mime];
    let finalContentType = mime;

    // หากเป็นรูปภาพและ frontend เตรียมแปลงเป็น .webp หรือระบุเป็น webp
    if (mime.startsWith('image/') && mime !== 'image/gif' && convertToWebp) {
      ext = 'webp';
      finalContentType = 'image/webp';
    } else if (mime.startsWith('video/') && ext === 'webm') {
      ext = 'webm';
      finalContentType = 'video/webm';
    }

    // สร้าง Path และ Key ที่ไม่ซ้ำกัน
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const safeBaseName = filename
      ? filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')
      : 'file';

    const fileKey = `${folder}/${yearMonth}/${uniqueId}-${safeBaseName}.${ext}`;

    const s3 = getR2Client(c);
    const { bucketName, publicUrl } = getR2Config(c);

    // ออกใบผ่านทางชั่วคราว (Presigned PUT URL) อายุ 15 นาที (900 วินาที)
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentType: finalContentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    const fullPublicUrl = `${publicUrl}/${fileKey}`;

    return c.json({
      success: true,
      uploadUrl,
      publicUrl: fullPublicUrl,
      fileKey,
      folder,
      contentType: finalContentType,
      expiresInSeconds: 900,
    });
  } catch (err) {
    console.error('Presigned URL error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to generate upload URL' },
      500
    );
  }
});

/**
 * 2. POST /api/upload/check
 * ตรวจสอบความเหมาะสมของรูปภาพผ่าน Sightengine API (อนาจาร, อาวุธ, ความรุนแรง/เลือด)
 * รองรับทั้งการส่ง { url: 'https://...' } หรือส่งไฟล์ผ่าน FormData ('file' หรือ 'media')
 */
upload.post('/check', optionalAuth, async (c) => {
  try {
    const contentType = c.req.header('content-type') || '';

    // กรณีส่ง JSON พร้อม Image URL
    if (contentType.includes('application/json')) {
      const { url } = await c.req.json();
      if (!url) {
        return c.json({ success: false, message: 'Image url is required' }, 400);
      }

      const result = await checkImageUrl(url, c.env);
      return c.json({
        success: true,
        ...result,
      });
    }

    // กรณีส่งไฟล์ภาพตรงผ่าน multipart/form-data
    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody();
      const file = body['file'] || body['media'];

      if (!file || !(file instanceof File)) {
        return c.json({ success: false, message: 'Image file is required' }, 400);
      }

      const result = await checkImageFile(file, c.env);
      return c.json({
        success: true,
        ...result,
      });
    }

    return c.json({ success: false, message: 'Invalid Content-Type' }, 400);
  } catch (err) {
    console.error('Image moderation check error:', err);
    return c.json(
      { success: false, message: err.message || 'Image moderation failed' },
      500
    );
  }
});

/**
 * 3. POST /api/upload/complete
 * ตรวจสอบความปลอดภัยของรูปภาพ และบันทึกข้อมูลมีเดียลง Neon DB เมื่อ Frontend อัปโหลดไฟล์เข้า R2 เสร็จสิ้น
 */
upload.post('/complete', optionalAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const {
      fileKey,
      url,
      mimeType,
      originalName,
      size,
      width,
      height,
      entityType = 'post',
      entityId,
    } = body;

    if (!fileKey || !url) {
      return c.json(
        { success: false, message: 'fileKey and url are required' },
        400
      );
    }

    const type = mimeType?.startsWith('video/') ? 'video' : 'image';

    // ตรวจสอบความปลอดภัยของภาพ หากเป็นรูปภาพ
    if (type === 'image') {
      const moderation = await checkImageUrl(url, c.env);
      if (!moderation.isSafe) {
        return c.json(
          {
            success: false,
            message: `รูปภาพไม่ผ่านการตรวจสอบความปลอดภัย: ${moderation.reasons.join(', ')}`,
            reasons: moderation.reasons,
            scores: moderation.scores,
          },
          400
        );
      }
    }

    const sql = getDb(c);

    const inserted = await sql`
      INSERT INTO media (
        "fileKey",
        url,
        type,
        "mimeType",
        "originalName",
        size,
        width,
        height,
        "entityType",
        "entityId",
        uploaded_by,
        "createdAt"
      ) VALUES (
        ${fileKey},
        ${url},
        ${type},
        ${mimeType || null},
        ${originalName || null},
        ${size || null},
        ${width || null},
        ${height || null},
        ${entityType},
        ${entityId || null},
        ${user?.id || null},
        NOW()
      )
      RETURNING *
    `;

    return c.json({
      success: true,
      media: inserted[0],
    });
  } catch (err) {
    console.error('Upload complete record error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to record media' },
      500
    );
  }
});

/**
 * 3. POST /api/upload/direct
 * อัปโหลดไฟล์ตรงผ่าน Worker (สำหรับไฟล์เล็ก หรือกรณีที่ Client ไม่สะดวกทำ direct presigned upload)
 */
upload.post('/direct', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.parseBody();
    const file = body['file'];
    const folder = body['folder'] || 'posts';

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, message: 'No file provided' }, 400);
    }

    // ตรวจสอบความปลอดภัยของภาพ หากเป็นรูปภาพ
    if (file.type?.startsWith('image/')) {
      const moderation = await checkImageFile(file, c.env);
      if (!moderation.isSafe) {
        return c.json(
          {
            success: false,
            message: `รูปภาพไม่ผ่านการตรวจสอบความปลอดภัย: ${moderation.reasons.join(', ')}`,
            reasons: moderation.reasons,
            scores: moderation.scores,
          },
          400
        );
      }
    }

    const s3 = getR2Client(c);
    const { bucketName, publicUrl } = getR2Config(c);

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileKey = `${folder}/${yearMonth}/${uniqueId}-${safeName}`;

    const arrayBuffer = await file.arrayBuffer();

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        Body: Buffer.from(arrayBuffer),
        ContentType: file.type || 'application/octet-stream',
      })
    );

    const fullPublicUrl = `${publicUrl}/${fileKey}`;
    const type = file.type.startsWith('video/') ? 'video' : 'image';

    const sql = getDb(c);
    const inserted = await sql`
      INSERT INTO media (
        "fileKey",
        url,
        type,
        "mimeType",
        "originalName",
        size,
        uploaded_by,
        "createdAt"
      ) VALUES (
        ${fileKey},
        ${fullPublicUrl},
        ${type},
        ${file.type},
        ${file.name},
        ${file.size},
        ${user.id},
        NOW()
      )
      RETURNING *
    `;

    return c.json({
      success: true,
      url: fullPublicUrl,
      fileKey,
      media: inserted[0],
    });
  } catch (err) {
    console.error('Direct upload error:', err);
    return c.json(
      { success: false, message: err.message || 'Direct upload failed' },
      500
    );
  }
});

export default upload;

