import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getR2Client, getR2Config } from '../config/r2';

/**
 * Sightengine Image Content Moderation Utility & 4-Tier Security System
 * 1. ตรวจสอบรูปภาพ: อนาจาร (Nudity 2.1), อาวุธ (Weapon), ความรุนแรง/เลือด (Gore)
 * 2. ลบภาพที่ไม่ปลอดภัยออกจาก Cloudflare R2 อัตโนมัติ (Auto-Delete)
 * 3. บันทึก Audit Log ลงตาราง moderation_logs
 * 4. ระบบ Rate Limit / Timeout อัตโนมัติ (หากตรวจพบภาพต้องห้าม >= 3 ครั้งใน 10 นาที)
 */

const SIGHTENGINE_API_URL = 'https://api.sightengine.com/1.0/check.json';
const DEFAULT_MODELS = 'nudity-2.1,weapon,gore';
const MAX_VIOLATIONS_BEFORE_TIMEOUT = 3; // ติดฟิลเตอร์ 3 ครั้ง
const VIOLATION_WINDOW_MINUTES = 10; // ภายใน 10 นาที
const TIMEOUT_DURATION_MINUTES = 15; // พักการใช้งาน 15 นาที

/**
 * ดึง IP Address ของ Client จาก Cloudflare Request Headers
 */
export function getClientIp(c) {
  if (!c || !c.req) return 'unknown';
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-real-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * ลบไฟล์ออกจาก Cloudflare R2 อัตโนมัติ (Tier 2 Auto-Delete)
 * @param {Object} c - Hono context
 * @param {string} fileKeyOrUrl - FileKey หรือ Public URL ของรูปภาพ
 */
export async function deleteFromR2(c, fileKeyOrUrl) {
  if (!fileKeyOrUrl) return;
  try {
    const { bucketName, publicUrl } = getR2Config(c);
    let key = fileKeyOrUrl;

    // หากส่งมาเป็น URL เต็ม ให้ตัด prefix ของ publicUrl ออก
    if (fileKeyOrUrl.startsWith('http://') || fileKeyOrUrl.startsWith('https://')) {
      if (publicUrl && fileKeyOrUrl.startsWith(publicUrl)) {
        key = fileKeyOrUrl.slice(publicUrl.length).replace(/^\/+/, '');
      } else {
        const urlObj = new URL(fileKeyOrUrl);
        key = urlObj.pathname.replace(/^\/+/, '');
      }
    }

    if (!key) return;

    const s3 = getR2Client(c);
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
    console.log(`[Tier 2 Auto-Delete] ลบรูปภาพอันตรายออกจาก R2 สำเร็จ: ${key}`);
  } catch (err) {
    console.warn(`[Tier 2 Auto-Delete Warning] ไม่สามารถลบไฟล์ ${fileKeyOrUrl}:`, err.message);
  }
}

/**
 * ตรวจสอบและสร้างตาราง moderation_logs อัตโนมัติ (Tier 3 Audit Log)
 */
let isTableInitialized = false;
export async function ensureModerationLogsTable(sql) {
  if (isTableInitialized || !sql) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS moderation_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        ip_address VARCHAR(100),
        file_key VARCHAR(255),
        image_url TEXT,
        reasons JSONB,
        scores JSONB,
        is_safe BOOLEAN DEFAULT false,
        action_taken VARCHAR(50) DEFAULT 'rejected',
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    isTableInitialized = true;
  } catch (err) {
    console.warn('[ensureModerationLogsTable note]:', err.message);
  }
}

/**
 * ตรวจสอบสถานะ Timeout / Rate Limit ของผู้ใช้
 * หากทำผิดซ้ำ >= 3 ครั้ง ภายใน 10 นาที จะถูกระงับ 15 นาที
 * @returns {Promise<{ isTimedOut: boolean, remainingMinutes: number, violationCount: number, message?: string }>}
 */
export async function checkUserTimeoutStatus(sql, { userId, ipAddress }) {
  if (!sql) return { isTimedOut: false, remainingMinutes: 0, violationCount: 0 };
  try {
    await ensureModerationLogsTable(sql);

    const logs = await sql`
      SELECT 
        COUNT(*) as violation_count,
        MAX("createdAt") as latest_violation
      FROM moderation_logs
      WHERE 
        is_safe = false
        AND "createdAt" >= NOW() - INTERVAL '10 minutes'
        AND (
          (${userId ? sql`user_id = ${userId}` : sql`false`})
          OR (${ipAddress && ipAddress !== 'unknown' ? sql`ip_address = ${ipAddress}` : sql`false`})
        )
    `;

    const count = parseInt(logs[0]?.violation_count || '0', 10);
    const latestViolation = logs[0]?.latest_violation;

    if (count >= MAX_VIOLATIONS_BEFORE_TIMEOUT && latestViolation) {
      const latestTime = new Date(latestViolation).getTime();
      const timeoutExpiresAt = latestTime + TIMEOUT_DURATION_MINUTES * 60 * 1000;
      const msLeft = timeoutExpiresAt - Date.now();
      const remainingMinutes = Math.max(1, Math.ceil(msLeft / (60 * 1000)));

      if (msLeft > 0) {
        return {
          isTimedOut: true,
          remainingMinutes,
          violationCount: count,
          message: `บัญชีของคุณถูกระงับการอัปโหลดและโพสต์ชั่วคราวเป็นเวลา ${remainingMinutes} นาที เนื่องจากตรวจพบการอัปโหลดรูปภาพที่ละเมิดความปลอดภัยซ้ำกันหลายครั้ง (${count} ครั้งใน 10 นาที)`,
        };
      }
    }

    return { isTimedOut: false, remainingMinutes: 0, violationCount: count };
  } catch (err) {
    console.error('[checkUserTimeoutStatus error]:', err.message);
    return { isTimedOut: false, remainingMinutes: 0, violationCount: 0 };
  }
}

/**
 * บันทึกประวัติการละเมิดลงตาราง moderation_logs (Tier 3 Logging)
 */
export async function recordModerationViolation(
  sql,
  { userId, ipAddress, fileKey, imageUrl, reasons, scores, actionTaken = 'rejected' }
) {
  if (!sql) return;
  try {
    await ensureModerationLogsTable(sql);

    await sql`
      INSERT INTO moderation_logs (
        user_id,
        ip_address,
        file_key,
        image_url,
        reasons,
        scores,
        is_safe,
        action_taken,
        "createdAt"
      ) VALUES (
        ${userId || null},
        ${ipAddress || null},
        ${fileKey || null},
        ${imageUrl || null},
        ${JSON.stringify(reasons || [])}::jsonb,
        ${JSON.stringify(scores || {})}::jsonb,
        false,
        ${actionTaken},
        NOW()
      )
    `;

    console.log(
      `[Tier 3 Audit Log] บันทึกการตรวจพบภาพอันตราย (User: ${userId || 'Guest'}, IP: ${ipAddress}): ${reasons?.join(', ')}`
    );
  } catch (err) {
    console.error('[recordModerationViolation error]:', err.message);
  }
}

/**
 * ดึง API User และ API Secret จาก env
 */
function getSightengineCredentials(env = {}) {
  const apiUser =
    env?.SIGHTENGINE_API_USER ||
    process.env.SIGHTENGINE_API_USER ||
    '';
  const apiSecret =
    env?.SIGHTENGINE_API_SECRET ||
    process.env.SIGHTENGINE_API_SECRET ||
    '';

  return {
    apiUser: String(apiUser).trim(),
    apiSecret: String(apiSecret).trim(),
  };
}

/**
 * แปลงผลลัพธ์จาก Sightengine เป็นเกณฑ์ความปลอดภัย
 * @param {Object} data - ข้อมูล JSON ตอบกลับจาก Sightengine
 * @returns {{ isSafe: boolean, reasons: string[], scores: Object, raw: Object }}
 */
export function evaluateModerationResult(data) {
  const reasons = [];
  const scores = {};

  if (!data || data.status !== 'success') {
    return {
      isSafe: true,
      reasons: [],
      scores: {},
      raw: data,
    };
  }

  // 1. ตรวจสอบเนื้อหาลามกอนาจารและยั่วยวนทางเพศ (Nudity 2.1)
  if (data.nudity) {
    const {
      sexual_activity = 0,
      sexual_display = 0,
      erotica = 0,
      raw = 0,
      safe = 1,
    } = data.nudity;

    scores.nudity = { sexual_activity, sexual_display, erotica, raw, safe };

    if (sexual_activity >= 0.5 || sexual_display >= 0.5 || raw >= 0.5) {
      reasons.push('ตรวจพบภาพลามกอนาจารหรือภาพโป๊เปลือย (Explicit Nudity / Sexual Content)');
    } else if (erotica >= 0.65) {
      reasons.push('ตรวจพบเนื้อหายั่วยวนทางเพศที่ไม่เหมาะสม (Suggestive / Erotica)');
    }
  }

  // 2. ตรวจสอบอาวุธปืนและของมีคม (Weapon)
  if (data.weapon?.classes) {
    const { firearm = 0, knife = 0 } = data.weapon.classes;
    scores.weapon = { firearm, knife };

    if (firearm >= 0.5) {
      reasons.push('ตรวจพบอาวุธปืนหรือสิ่งเทียมอาวุธปืน (Firearm / Weapon)');
    } else if (knife >= 0.6) {
      reasons.push('ตรวจพบอาวุธมีดหรือของมีคมอันตราย (Knife / Blade Weapon)');
    }
  }

  // 3. ตรวจสอบความรุนแรง เลือด และสิ่งสยดสยอง (Gore & Violence)
  if (data.gore) {
    const prob = data.gore.prob ?? 0;
    const classes = data.gore.classes || {};
    scores.gore = { prob, classes };

    if (
      prob >= 0.5 ||
      (classes.very_bloody && classes.very_bloody >= 0.5) ||
      (classes.corpse && classes.corpse >= 0.5) ||
      (classes.serious_injury && classes.serious_injury >= 0.5)
    ) {
      reasons.push('ตรวจพบภาพความรุนแรง เลือด หรือสิ่งสยดสยอง (Gore, Blood, or Graphic Violence)');
    }
  }

  return {
    isSafe: reasons.length === 0,
    reasons,
    scores,
    raw: data,
  };
}

/**
 * ตรวจสอบรูปภาพจาก Public URL
 * @param {string} imageUrl - URL ของรูปภาพ (เช่น R2 URL หรือ CDN)
 * @param {Object} env - Cloudflare Worker env หรือ process.env
 * @returns {Promise<{ isSafe: boolean, reasons: string[], scores: Object, skipped?: boolean }>}
 */
export async function checkImageUrl(imageUrl, env = {}) {
  try {
    const { apiUser, apiSecret } = getSightengineCredentials(env);

    if (!apiUser || !apiSecret) {
      console.warn(
        '[Sightengine] SIGHTENGINE_API_USER หรือ SIGHTENGINE_API_SECRET ยังไม่ได้ตั้งค่าใน .env, ข้ามการตรวจสอบชั่วคราว'
      );
      return { isSafe: true, skipped: true, reasons: [] };
    }

    const endpoint = new URL(SIGHTENGINE_API_URL);
    endpoint.searchParams.set('models', DEFAULT_MODELS);
    endpoint.searchParams.set('api_user', apiUser);
    endpoint.searchParams.set('api_secret', apiSecret);
    endpoint.searchParams.set('url', imageUrl);

    const res = await fetch(endpoint.toString(), {
      method: 'GET',
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Sightengine URL Check Error]:', res.status, errText);
      return { isSafe: true, skipped: true, reasons: [] };
    }

    const data = await res.json();
    return evaluateModerationResult(data);
  } catch (err) {
    console.error('[Sightengine checkImageUrl exception]:', err.message);
    // หากระบบภายนอกล่ม ไม่บล็อกผู้ใช้โดยไม่จำเป็น
    return { isSafe: true, skipped: true, reasons: [] };
  }
}

/**
 * ตรวจสอบรูปภาพจากไฟล์ / Blob / Buffer / Stream
 * @param {Blob|File|Buffer} fileOrBlob - ไฟล์รูปภาพ
 * @param {Object} env - Cloudflare Worker env หรือ process.env
 * @returns {Promise<{ isSafe: boolean, reasons: string[], scores: Object, skipped?: boolean }>}
 */
export async function checkImageFile(fileOrBlob, env = {}) {
  try {
    const { apiUser, apiSecret } = getSightengineCredentials(env);

    if (!apiUser || !apiSecret) {
      console.warn(
        '[Sightengine] SIGHTENGINE_API_USER หรือ SIGHTENGINE_API_SECRET ยังไม่ได้ตั้งค่าใน .env, ข้ามการตรวจสอบชั่วคราว'
      );
      return { isSafe: true, skipped: true, reasons: [] };
    }

    const formData = new FormData();
    formData.append('media', fileOrBlob);
    formData.append('models', DEFAULT_MODELS);
    formData.append('api_user', apiUser);
    formData.append('api_secret', apiSecret);

    const res = await fetch(SIGHTENGINE_API_URL, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Sightengine File Check Error]:', res.status, errText);
      return { isSafe: true, skipped: true, reasons: [] };
    }

    const data = await res.json();
    return evaluateModerationResult(data);
  } catch (err) {
    console.error('[Sightengine checkImageFile exception]:', err.message);
    return { isSafe: true, skipped: true, reasons: [] };
  }
}

