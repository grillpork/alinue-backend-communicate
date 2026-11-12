import fs from 'fs';
import path from 'path';

// ฟังก์ชันโหลด .env อัตโนมัติหากยังไม่มี env vars
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...values] = trimmed.split('=');
        const val = values.join('=').trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = val;
        }
      }
    });
  }
}

loadEnv();

/**
 * ฟังก์ชันตรวจสอบภาพสื่อถึง อนาจาร อาวุธ หรือความรุนแรง/เลือด
 * @param {string} imagePathOrUrl - Path ของไฟล์รูปในเครื่อง หรือ URL ของรูปภาพ
 */
export async function checkImage(imagePathOrUrl) {
  const apiUser = process.env.SIGHTENGINE_API_USER;
  const apiSecret = process.env.SIGHTENGINE_API_SECRET;

  if (!apiUser || !apiSecret) {
    console.error('❌ Error: กรุณากำหนด SIGHTENGINE_API_USER และ SIGHTENGINE_API_SECRET ใน .env ก่อน');
    return;
  }

  const models = 'nudity-2.1,weapon,gore';
  console.log(`\n🔍 กำลังตรวจสอบภาพ: ${imagePathOrUrl}`);
  console.log(`📋 Models ที่ใช้: ${models}\n`);

  try {
    let responseData;

    // กรณีเป็น URL (http:// หรือ https://)
    if (imagePathOrUrl.startsWith('http://') || imagePathOrUrl.startsWith('https://')) {
      const url = `https://api.sightengine.com/1.0/check.json?models=${models}&api_user=${apiUser}&api_secret=${apiSecret}&url=${encodeURIComponent(
        imagePathOrUrl
      )}`;
      const res = await fetch(url);
      responseData = await res.json();
    } else {
      // กรณีเป็นไฟล์ในเครื่อง (Local Path)
      const resolvedPath = path.resolve(process.cwd(), imagePathOrUrl);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`ไม่พบไฟล์ภาพที่ตำแหน่ง: ${resolvedPath}`);
      }

      const fileBuffer = fs.readFileSync(resolvedPath);
      const ext = path.extname(resolvedPath).replace('.', '') || 'jpg';
      const blob = new Blob([fileBuffer], { type: `image/${ext}` });

      const form = new FormData();
      form.append('media', blob, path.basename(resolvedPath));
      form.append('models', models);
      form.append('api_user', apiUser);
      form.append('api_secret', apiSecret);

      const res = await fetch('https://api.sightengine.com/1.0/check.json', {
        method: 'POST',
        body: form,
      });
      responseData = await res.json();
    }

    console.log('--- ผลการตรวจสอบจาก Sightengine (Raw Response) ---');
    console.log(JSON.stringify(responseData, null, 2));

    // ประเมินผลลัพธ์
    const violations = [];

    // 1. ตรวจสอบอนาจาร
    if (responseData.nudity) {
      const { sexual_activity = 0, sexual_display = 0, raw = 0, erotica = 0 } = responseData.nudity;
      if (sexual_activity >= 0.5 || sexual_display >= 0.5 || raw >= 0.5) {
        violations.push(`🚨 ตรวจพบเนื้อหาอนาจาร/ภาพโป๊เปลือย (Raw: ${raw}, Activity: ${sexual_activity})`);
      } else if (erotica >= 0.65) {
        violations.push(`⚠️ ตรวจพบเนื้อหายั่วยวนทางเพศ (Erotica: ${erotica})`);
      }
    }

    // 2. ตรวจสอบอาวุธ
    if (responseData.weapon?.classes) {
      const { firearm = 0, knife = 0 } = responseData.weapon.classes;
      if (firearm >= 0.5) {
        violations.push(`🚨 ตรวจพบอาวุธปืน (Firearm: ${firearm})`);
      }
      if (knife >= 0.6) {
        violations.push(`🚨 ตรวจพบอาวุธมีด/ของมีคม (Knife: ${knife})`);
      }
    }

    // 3. ตรวจสอบความรุนแรง เลือด ซากศพ
    if (responseData.gore) {
      const { prob = 0, classes = {} } = responseData.gore;
      if (prob >= 0.5 || classes.very_bloody >= 0.5 || classes.corpse >= 0.5) {
        violations.push(`🚨 ตรวจพบภาพความรุนแรง/เลือด/ศพ (Gore Prob: ${prob})`);
      }
    }

    console.log('\n--- สรุปผลการประเมินความปลอดภัย ---');
    if (violations.length > 0) {
      console.log('❌ รูปภาพนี้ไม่ผ่านเกณฑ์ความปลอดภัย:');
      violations.forEach((v) => console.log('  ', v));
    } else {
      console.log('✅ รูปภาพนี้ปลอดภัย (Safe to publish)');
    }

    return responseData;
  } catch (error) {
    console.error('❌ Moderation Error:', error.message);
  }
}

// รับ Argument จาก Command line เช่น: node backend/scripts/check-image.js ./images/test.jpg
const targetImage = process.argv[2] || './images/test-3.jpg';
if (process.argv[1]?.endsWith('check-image.js')) {
  checkImage(targetImage);
}
