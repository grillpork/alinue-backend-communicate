import { Hono } from 'hono';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getR2Client, getR2Config } from '../../config/r2';
import { getDb } from '../../config/db';
import { optionalAuth, requireAuth } from '../../middleware/auth';
import {
  checkImageUrl,
  checkImageFile,
  deleteFromR2,
  checkUserTimeoutStatus,
  recordModerationViolation,
  createModerationAppeal,
  getClientIp,
} from '../../utils/moderation';

const upload = new Hono();

// ประเภทไฟล์ที่อนุญาต (อนุญาตเฉพาะรูปภาพนิ่งเท่านั้น ไม่อนุญาต GIF หรือวิดีโอ)
const ALLOWED_MIME_TYPES = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
};

/**
 * 1. POST /api/upload/presigned-url
 * ออกใบผ่านทางชั่วคราว (Presigned URL) ให้ Frontend อัปโหลดไฟล์ตรงเข้า Cloudflare R2
 * - รองรับเฉพาะไฟล์รูปภาพนิ่งเท่านั้น (.webp, .jpg, .png, .avif)
 * - ปฏิเสธไฟล์ GIF, วิดีโอ หรือไฟล์ประเภทอื่นอย่างเด็ดขาด
 */
upload.post('/presigned-url', optionalAuth, async (c) => {
  try {
    const sql = getDb(c);
    const user = c.get('user');
    const ipAddress = getClientIp(c);

    // ตรวจสอบสถานะ Timeout / Rate Limit ของผู้ใช้ (Tier 3)
    const timeoutStatus = await checkUserTimeoutStatus(sql, {
      userId: user?.id,
      ipAddress,
    });
    if (timeoutStatus.isTimedOut) {
      return c.json(
        {
          success: false,
          isTimedOut: true,
          remainingMinutes: timeoutStatus.remainingMinutes,
          message: timeoutStatus.message,
        },
        429
      );
    }

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

    // ตรวจสอบปฏิเสธ GIF หรือวิดีโอทันที
    if (mime === 'image/gif' || mime.startsWith('video/')) {
      return c.json(
        {
          success: false,
          message:
            'ไม่อนุญาตให้อัปโหลดไฟล์ GIF หรือวิดีโอ (ระบบรองรับเฉพาะไฟล์รูปภาพนิ่ง JPG, PNG, WebP, AVIF เท่านั้น)',
        },
        400
      );
    }

    if (!ALLOWED_MIME_TYPES[mime]) {
      return c.json(
        {
          success: false,
          message: `ไม่อนุญาตให้อัปโหลดไฟล์ประเภท ${mime} (ระบบรองรับเฉพาะไฟล์รูปภาพนิ่ง JPG, PNG, WebP, AVIF เท่านั้น)`,
        },
        400
      );
    }

    // กำหนด extension ปลายทาง (แปลงเป็น webp เพื่อประสิทธิภาพสูงสุด)
    let ext = 'webp';
    let finalContentType = 'image/webp';
    if (!convertToWebp) {
      ext = ALLOWED_MIME_TYPES[mime] || 'webp';
      finalContentType = mime;
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

    const mime = (mimeType || '').toLowerCase();
    if (mime === 'image/gif' || mime.startsWith('video/') || !ALLOWED_MIME_TYPES[mime]) {
      return c.json(
        {
          success: false,
          message:
            'ไม่อนุญาตให้อัปโหลดไฟล์ประเภทนี้ (ระบบรองรับเฉพาะรูปภาพนิ่ง JPG, PNG, WebP, AVIF เท่านั้น ไม่อนุญาต GIF หรือวิดีโอ)',
        },
        400
      );
    }

    const sql = getDb(c);
    const ipAddress = getClientIp(c);
    const type = 'image';

    // ตรวจสอบความปลอดภัยของภาพผ่าน Sightengine
    const moderation = await checkImageUrl(url, c.env);
    if (!moderation.isSafe) {
      // 1. Tier 2: สั่งลบรูปภาพอันตรายออกจาก Cloudflare R2 ทันที
      await deleteFromR2(c, fileKey || url);

      // 2. Tier 3: บันทึก Audit Log ลงตาราง moderation_logs
      const logRecord = await recordModerationViolation(sql, {
        userId: user?.id,
        ipAddress,
        fileKey,
        imageUrl: url,
        reasons: moderation.reasons,
        scores: moderation.scores,
        actionTaken: 'rejected_and_deleted',
      });

      // 3. ตรวจสอบว่าติดฟิลเตอร์เกิน 3 ครั้งใน 10 นาที จนต้องระงับชั่วคราวหรือไม่
      const updatedTimeout = await checkUserTimeoutStatus(sql, {
        userId: user?.id,
        ipAddress,
      });

      if (updatedTimeout.isTimedOut) {
        return c.json(
          {
            success: false,
            isTimedOut: true,
            logId: logRecord?.id || null,
            imageUrl: url,
            remainingMinutes: updatedTimeout.remainingMinutes,
            message: updatedTimeout.message,
            reasons: moderation.reasons,
          },
          429
        );
      }

      return c.json(
        {
          success: false,
          logId: logRecord?.id || null,
          imageUrl: url,
          message: `รูปภาพไม่ผ่านการตรวจสอบความปลอดภัย: ${moderation.reasons.join(', ')}`,
          reasons: moderation.reasons,
          scores: moderation.scores,
        },
        400
      );
    }

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
    const sql = getDb(c);
    const ipAddress = getClientIp(c);

    // ตรวจสอบสถานะ Timeout / Rate Limit ก่อน (Tier 3)
    const timeoutStatus = await checkUserTimeoutStatus(sql, {
      userId: user.id,
      ipAddress,
    });
    if (timeoutStatus.isTimedOut) {
      return c.json(
        {
          success: false,
          isTimedOut: true,
          remainingMinutes: timeoutStatus.remainingMinutes,
          message: timeoutStatus.message,
        },
        429
      );
    }

    const body = await c.req.parseBody();
    const file = body['file'];
    const folder = body['folder'] || 'posts';

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, message: 'No file provided' }, 400);
    }

    const mime = (file.type || '').toLowerCase();
    if (mime === 'image/gif' || mime.startsWith('video/') || !ALLOWED_MIME_TYPES[mime]) {
      return c.json(
        {
          success: false,
          message:
            'ไม่อนุญาตให้อัปโหลดไฟล์ประเภทนี้ (ระบบรองรับเฉพาะรูปภาพนิ่ง JPG, PNG, WebP, AVIF เท่านั้น ไม่อนุญาต GIF หรือวิดีโอ)',
        },
        400
      );
    }

    // ตรวจสอบความปลอดภัยของภาพผ่าน Sightengine
    const moderation = await checkImageFile(file, c.env);
    if (!moderation.isSafe) {
      // บันทึก Audit Log
      await recordModerationViolation(sql, {
        userId: user.id,
        ipAddress,
        fileKey: null,
        imageUrl: null,
        reasons: moderation.reasons,
        scores: moderation.scores,
        actionTaken: 'rejected',
      });

      const updatedTimeout = await checkUserTimeoutStatus(sql, {
        userId: user.id,
        ipAddress,
      });

      if (updatedTimeout.isTimedOut) {
        return c.json(
          {
            success: false,
            isTimedOut: true,
            remainingMinutes: updatedTimeout.remainingMinutes,
            message: updatedTimeout.message,
            reasons: moderation.reasons,
          },
          429
        );
      }

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

/**
 * 5. GET /api/upload/moderation-status
 * Tier 4: Admin Oversight - ตรวจสอบสถานะ Timeout / Rate Limit ของผู้ใช้ปัจจุบัน
 * ใช้ให้ Frontend เช็คก่อนแสดงฟอร์มอัปโหลด หรือแสดง Cooldown UI
 */
upload.get('/moderation-status', optionalAuth, async (c) => {
  try {
    const sql = getDb(c);
    const user = c.get('user');
    const ipAddress = getClientIp(c);

    const status = await checkUserTimeoutStatus(sql, {
      userId: user?.id,
      ipAddress,
    });

    return c.json({
      success: true,
      isTimedOut: status.isTimedOut,
      remainingMinutes: status.remainingMinutes,
      violationCount: status.violationCount,
      message: status.message || null,
    });
  } catch (err) {
    console.error('Moderation status error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to check moderation status' },
      500
    );
  }
});

/**
 * 6. POST /api/upload/appeal
 * Tier 4: Appeal / Request Review - ส่งคำร้องขออุทธรณ์กรณีที่คิดว่าภาพเป็น False Positive
 */
upload.post('/appeal', optionalAuth, async (c) => {
  try {
    const user = c.get('user');
    const sql = getDb(c);
    const ipAddress = getClientIp(c);
    const body = await c.req.json();
    const { logId, imageUrl, fileKey, reasons, appealReason } = body;

    if (!appealReason || !appealReason.trim()) {
      return c.json(
        { success: false, message: 'กรุณาระบุเหตุผลการอุทธรณ์ เช่น เป็นภาพวาดกายวิภาค หรือศิลปะ' },
        400
      );
    }

    if (!imageUrl && !logId) {
      return c.json(
        { success: false, message: 'จำเป็นต้องระบุ imageUrl หรือ logId' },
        400
      );
    }

    const appeal = await createModerationAppeal(sql, {
      logId: logId ? parseInt(logId, 10) : null,
      userId: user?.id || null,
      ipAddress,
      imageUrl,
      fileKey,
      reasons: Array.isArray(reasons) ? reasons : reasons ? [reasons] : [],
      appealReason: appealReason.trim(),
    });

    return c.json(
      {
        success: true,
        message: 'ส่งคำร้องอุทธรณ์เรียบร้อยแล้ว แอดมินจะดำเนินการตรวจสอบให้โดยเร็วที่สุด',
        appeal,
      },
      201
    );
  } catch (err) {
    console.error('Submit appeal error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to submit appeal' },
      500
    );
  }
});

/**
 * 7. GET /api/upload/my-appeals
 * ดูรายการอุทธรณ์ของผู้ใช้ปัจจุบัน
 */
upload.get('/my-appeals', optionalAuth, async (c) => {
  try {
    const user = c.get('user');
    const sql = getDb(c);
    const ipAddress = getClientIp(c);

    if (!user?.id && (!ipAddress || ipAddress === 'unknown')) {
      return c.json({ success: true, appeals: [] });
    }

    const appeals = await sql`
      SELECT *
      FROM moderation_appeals
      WHERE 
        (${user?.id ? sql`user_id = ${user.id}` : sql`false`})
        OR (${ipAddress && ipAddress !== 'unknown' ? sql`ip_address = ${ipAddress}` : sql`false`})
      ORDER BY "createdAt" DESC
      LIMIT 20
    `;

    return c.json({
      success: true,
      appeals,
    });
  } catch (err) {
    console.error('Get my appeals error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to fetch appeals' },
      500
    );
  }
});

export default upload;

