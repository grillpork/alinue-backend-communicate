import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import { getDb } from '../config/db';

export function getJwtSecret(c) {
  const secret =
    c?.env?.BETTER_AUTH_SECRET ||
    c?.env?.JWT_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET or JWT_SECRET is not configured in environment variables');
  }

  return String(secret).replace(/['"]/g, '').trim();
}

/**
 * ดึง Token จาก Header หรือ Cookie
 */
export function extractToken(c) {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return getCookie(c, 'auth_token') || null;
}

/**
 * ตรวจสอบ Session จากฐานข้อมูล Neon DB (ตาราง sessions) เป็นหลัก
 */
export async function getSessionUser(c) {
  const token = extractToken(c);
  if (!token) return null;

  try {
    const sql = getDb(c);

    // 1. ตรวจสอบกับ sessions table ในฐานข้อมูล
    const rows = await sql`
      SELECT 
        s.id AS "sessionId",
        s.token AS "sessionToken",
        s."expiresAt",
        u.id,
        u.email,
        u.username,
        u."displayName",
        u."avatarUrl",
        u.bio,
        u.location,
        u.banner,
        u.website,
        u."isBanned"
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ${token} AND s."expiresAt" > NOW()
      LIMIT 1
    `;

    if (rows && rows.length > 0) {
      const user = rows[0];
      if (user.isBanned) return null;
      return user;
    }

    // 2. Fallback: หากเป็น legacy JWT token
    try {
      const secret = getJwtSecret(c);
      const payload = await verify(token, secret, 'HS256');
      if (payload && payload.id) {
        const uRows = await sql`
          SELECT id, email, username, "displayName", "avatarUrl", bio, location, banner, website, "isBanned"
          FROM users
          WHERE id = ${payload.id}
          LIMIT 1
        `;
        if (uRows.length > 0 && !uRows[0].isBanned) {
          return uRows[0];
        }
      }
    } catch {}

    return null;
  } catch (err) {
    console.error('getSessionUser error:', err);
    return null;
  }
}

/**
 * สร้าง Session ใหม่ลงตาราง sessions ในฐานข้อมูล
 */
export async function createDbSession(sql, userId, c) {
  // สุ่ม Session Token ความยาว 64 ตัวอักษร
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const sessionToken = Array.from(tokenBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const ipAddress =
    c?.req?.header('cf-connecting-ip') ||
    c?.req?.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1';
  const userAgent = c?.req?.header('user-agent') || '';

  await sql`
    INSERT INTO sessions (
      id,
      user_id,
      token,
      "expiresAt",
      "ipAddress",
      "userAgent",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${sessionId},
      ${userId},
      ${sessionToken},
      ${expiresAt},
      ${ipAddress},
      ${userAgent},
      NOW(),
      NOW()
    )
  `;

  return {
    sessionId,
    token: sessionToken,
    expiresAt,
  };
}

/**
 * Middleware บังคับว่าต้องมี Session ที่ถูกต้องใน Database
 */
export async function requireAuth(c, next) {
  const user = await getSessionUser(c);
  if (!user) {
    return c.json(
      { success: false, message: 'Unauthorized: Invalid or expired session' },
      401
    );
  }

  c.set('user', user);
  await next();
}

/**
 * Middleware ตรวจสอบ Auth แบบ Optional ผ่าน Session ใน DB
 */
export async function optionalAuth(c, next) {
  const user = await getSessionUser(c);
  c.set('user', user || null);
  await next();
}

