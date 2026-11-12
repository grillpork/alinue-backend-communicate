/**
 * Sightengine Image Content Moderation Utility
 * ตรวจสอบรูปภาพ:
 * 1. อนาจาร / โป๊เปลือย (Nudity 2.1)
 * 2. อาวุธ / ของมีคม (Weapon)
 * 3. ความรุนแรง / เลือด / ซากศพ (Gore & Graphic Violence)
 */

const SIGHTENGINE_API_URL = 'https://api.sightengine.com/1.0/check.json';
const DEFAULT_MODELS = 'nudity-2.1,weapon,gore';

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

