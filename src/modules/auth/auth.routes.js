import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import { getDrizzle } from "../../config/db.js";
import { users, sessions, accounts } from "../../db/schema.js";
import { eq, or, ilike, sql } from "drizzle-orm";
import {
  requireAuth,
  createDbSession,
  extractToken,
  getUserServiceQuota,
} from "../../middleware/auth.js";
import { createNotification } from "../notification/notification.service.js";

const auth = new Hono();

/**
 * ชุดคำ 4 ตัวอักษรอ่านง่ายสำหรับสร้าง One-Time Invite Code รูปแบบ WORD-WORD-WORD (เช่น TANK-HEAL-ABLE)
 */
const INVITE_WORDS = [
  "ABLE", "APEX", "ARTS", "AURA", "BEAM", "BLUE", "BOLD", "CALM", "CAST", "CORE",
  "CYAN", "DASH", "DAWN", "DRAW", "DUSK", "ECHO", "EDGE", "EPIC", "FADE", "FAST",
  "FINE", "FLOW", "FLUX", "FORM", "FREE", "GALE", "GLOW", "GOLD", "GRID", "HALO",
  "HEAL", "HERO", "HUES", "ICON", "IDEA", "INKY", "JADE", "JAZZ", "JUMP", "KEEN",
  "KIND", "KITE", "LARK", "LEAF", "LENS", "LILY", "LINE", "LINK", "LUCK", "LUNA",
  "LUSH", "LYRE", "MADE", "MAGE", "MASK", "MINT", "MIST", "MODE", "MOON", "MUSE",
  "NEON", "NEXT", "NODE", "NOIR", "NOVA", "OPAL", "PACE", "PAGE", "PALM", "PEAK",
  "PINE", "PLAY", "PLUM", "PLUS", "POEM", "PURE", "QUAD", "QUIZ", "RAIN", "RARE",
  "RAYS", "REAL", "REED", "RIFT", "RISE", "ROSE", "RUBY", "RUNE", "RUSH", "SAGE",
  "SAND", "SEAL", "SEED", "SILK", "SKIP", "SOAR", "SOFT", "SOLO", "SONG", "SOUL",
  "SPIN", "STAR", "STEP", "SYNC", "TALE", "TANK", "TEAL", "TIDE", "TILE", "TIME",
  "TINT", "TONE", "TRUE", "TUNE", "VAST", "VEIL", "VIBE", "VIEW", "VINE", "VIVA",
  "VOID", "WARM", "WAVE", "WILD", "WIND", "WING", "WISE", "WISH", "WOOD", "WORK",
  "WRIT", "YARN", "ZEAL", "ZERO", "ZEST", "ZINC", "ZONE", "ZOOM",
];

function generateReadableInviteCode() {
  const pick = () =>
    INVITE_WORDS[Math.floor(Math.random() * INVITE_WORDS.length)];
  return `${pick()}-${pick()}-${pick()}`;
}

function normalizeInviteCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^@/, "");
}

/**
 * ตรวจสอบว่าผู้ใช้มี One-Time Invite Code แล้วหรือยัง หากยังไม่มีให้สร้างและบันทึกลง preferences
 */
async function ensureUserInviteCode(db, user) {
  const prefs =
    user?.preferences && typeof user.preferences === "object"
      ? user.preferences
      : {};

  if (prefs.inviteCode) {
    return prefs;
  }

  let generatedCode = generateReadableInviteCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`UPPER(${users.preferences}->>'inviteCode') = ${generatedCode}`)
      .limit(1);
    if (existing.length === 0) break;
    generatedCode = generateReadableInviteCode();
  }

  const updatedPrefs = {
    ...prefs,
    inviteCode: generatedCode,
    inviteCodeUsed: Boolean(prefs.inviteCodeUsed),
    inviteCodeCreatedAt: new Date().toISOString(),
  };

  await db
    .update(users)
    .set({
      preferences: updatedPrefs,
      updatedAt: sql`NOW()`,
    })
    .where(eq(users.id, user.id));

  return updatedPrefs;
}

/**
 * Helper: ให้สิทธิ์โพสต์ Service เพิ่มจาก 1 เป็นสูงสุด 2 โพสต์ ทั้งคนชวน (Inviter) และคนถูกชวน (Invitee)
 * รองรับ One-Time Invite Code (XXXX-XXXX-XXXX) ที่ใช้ได้เพียง 1 ครั้งเท่านั้น
 */
async function applyMutualReferral(db, newUser, rawRef) {
  const cleanRaw = String(rawRef || "").trim();
  if (!cleanRaw || !newUser?.id) {
    return { applied: false, reason: "invalid_code", message: "กรุณาระบุโค้ดคำเชิญ" };
  }

  const upperCode = normalizeInviteCode(cleanRaw);
  const looksLikeCode = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(upperCode);

  try {
    // 1. ค้นหาจาก One-Time Invite Code ก่อนเสมอ
    let inviterRows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        preferences: users.preferences,
      })
      .from(users)
      .where(sql`UPPER(${users.preferences}->>'inviteCode') = ${upperCode}`)
      .limit(1);

    let matchedByOneTimeCode = inviterRows.length > 0;

    // 2. Fallback รองรับลิงก์ ref แบบเก่า (username / id) เฉพาะกรณีที่ไม่ใช่รูปแบบโค้ด XXXX-XXXX-XXXX
    if (!matchedByOneTimeCode && !looksLikeCode) {
      const cleanLegacy = cleanRaw.replace(/^@/, "").toLowerCase();
      const refAsNumber = parseInt(cleanLegacy, 10);
      inviterRows = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          preferences: users.preferences,
        })
        .from(users)
        .where(
          !isNaN(refAsNumber) && String(refAsNumber) === cleanLegacy
            ? or(eq(users.id, refAsNumber), ilike(users.username, cleanLegacy))
            : ilike(users.username, cleanLegacy),
        )
        .limit(1);
    }

    if (inviterRows.length === 0) {
      return {
        applied: false,
        reason: "not_found",
        message: "ไม่พบโค้ดคำเชิญนี้ หรือโค้ดไม่ถูกต้อง",
      };
    }

    const inviter = inviterRows[0];

    // ห้ามใช้โค้ดของตัวเอง
    if (String(inviter.id) === String(newUser.id)) {
      return {
        applied: false,
        reason: "self_invite",
        message: "ไม่สามารถใช้โค้ดคำเชิญของตัวเองได้",
      };
    }

    const inviterPrefs =
      inviter.preferences && typeof inviter.preferences === "object"
        ? inviter.preferences
        : {};
    const newUserPrefs =
      newUser.preferences && typeof newUser.preferences === "object"
        ? newUser.preferences
        : {};

    // หากโค้ดแบบใช้ครั้งเดียวถูกใช้ไปแล้ว ห้ามใช้ซ้ำเด็ดขาด
    if (inviterPrefs.inviteCodeUsed) {
      return {
        applied: false,
        reason: "already_used",
        message: "โค้ดคำเชิญนี้ถูกใช้งานไปแล้ว (ใช้ได้เพียง 1 ครั้งเท่านั้น)",
      };
    }

    // หากผู้ใช้นี้เคยรับสิทธิ์จากโค้ดคำเชิญอื่นไปแล้ว ไม่สามารถรับซ้ำได้
    if (newUserPrefs.referredBy) {
      return {
        applied: false,
        reason: "already_claimed",
        message: "บัญชีของคุณเคยรับสิทธิ์จากโค้ดคำเชิญไปแล้ว",
      };
    }

    const nowIso = new Date().toISOString();

    // 1. อัปเดตสิทธิ์ให้คนถูกชวน (Invitee): เพิ่มเป็นสูงสุด 2 โพสต์
    const updatedNewUserPrefs = {
      ...newUserPrefs,
      serviceQuotaBonus: true,
      maxServicePosts: 2,
      referredBy: inviter.username,
      referredById: inviter.id,
      referredCode: inviterPrefs.inviteCode || upperCode,
      referredAt: nowIso,
    };

    await db
      .update(users)
      .set({
        preferences: updatedNewUserPrefs,
        updatedAt: sql`NOW()`,
      })
      .where(eq(users.id, newUser.id));

    // 2. อัปเดตสิทธิ์ให้คนชวน (Inviter) และล็อกโค้ดเป็น "ใช้งานแล้ว" (One-Time Use)
    const updatedInviterPrefs = {
      ...inviterPrefs,
      serviceQuotaBonus: true,
      maxServicePosts: 2,
      inviteCodeUsed: true,
      inviteCodeUsedBy: newUser.username,
      inviteCodeUsedAt: nowIso,
      referralCount: (Number(inviterPrefs.referralCount) || 0) + 1,
      lastReferredUsername: newUser.username,
      lastReferralAt: nowIso,
    };

    await db
      .update(users)
      .set({
        preferences: updatedInviterPrefs,
        updatedAt: sql`NOW()`,
      })
      .where(eq(users.id, inviter.id));

    // 3. แจ้งเตือนคนชวนว่าเพื่อนใช้โค้ดสำเร็จและปลดล็อกโควตา 2 โพสต์แล้ว
    await createNotification(db, {
      userId: inviter.id,
      actorId: newUser.id,
      type: "follow",
      message:
        "ใช้โค้ดคำเชิญของคุณสำเร็จ! คุณและเพื่อนได้รับสิทธิ์โพสต์รับงานเพิ่มเป็นสูงสุด 2 โพสต์แล้ว 🎉",
    });

    return {
      applied: true,
      inviterUsername: inviter.username,
      message: "ปลดล็อกสิทธิ์โพสต์รับงานเพิ่มเป็นสูงสุด 2 โพสต์เรียบร้อยแล้ว!",
    };
  } catch (err) {
    console.warn("applyMutualReferral warning:", err.message);
    return {
      applied: false,
      reason: "error",
      message: "เกิดข้อผิดพลาดในการตรวจสอบโค้ดคำเชิญ",
    };
  }
}

/**
 * Helper ดึง Google OAuth Config
 */
function getGoogleConfig(c) {
  const rawClientId =
    c?.env?.GOOGLE_CLIENT_ID ||
    c?.env?.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    '';

  const rawClientSecret =
    c?.env?.GOOGLE_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    '';

  let clientUrl =
    c?.env?.CLIENT_URL ||
    process.env.CLIENT_URL ||
    'https://catako.site';

  let backendUrl = c?.env?.BACKEND_URL || process.env.BACKEND_URL;
  if (!backendUrl && c?.req) {
    try {
      backendUrl = new URL(c.req.url).origin;
    } catch {
      backendUrl = 'http://localhost:8787';
    }
  }
  if (!backendUrl) {
    backendUrl = 'http://localhost:8787';
  }

  // หากเป็นโหมดทดสอบในเครื่อง local ให้ redirect กลับมาที่ frontend บน localhost:3000
  if (backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1')) {
    clientUrl = 'http://localhost:3000';
  }

  const clientId = String(rawClientId).replace(/['"]/g, '').trim();
  const clientSecret = String(rawClientSecret).replace(/['"]/g, '').trim();

  return {
    clientId,
    clientSecret,
    clientUrl,
    redirectUri: `${backendUrl}/api/auth/google/callback`,
  };
}

/**
 * 1. POST /api/auth/sign-up - สมัครสมาชิกใหม่
 */
auth.post("/sign-up", async (c) => {
  try {
    const db = getDrizzle(c);
    const body = await c.req.json();
    const { email, password, username, name, ref, referredBy } = body;

    if (!email || !password) {
      return c.json(
        { success: false, message: "Email and password are required" },
        400,
      );
    }

    if (password.length < 6) {
      return c.json(
        { success: false, message: "Password must be at least 6 characters" },
        400,
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const finalUsername = (
      username ||
      cleanEmail.split("@")[0] + "_" + Math.floor(1000 + Math.random() * 9000)
    )
      .trim()
      .toLowerCase();

    // ตรวจสอบว่ามีอีเมลหรือชื่อผู้ใช้นี้อยู่แล้วหรือไม่
    const existing = await db
      .select({ id: users.id, email: users.email, username: users.username })
      .from(users)
      .where(or(eq(users.email, cleanEmail), eq(users.username, finalUsername)))
      .limit(1);

    if (existing.length > 0) {
      const isEmail = existing[0].email === cleanEmail;
      return c.json(
        {
          success: false,
          message: isEmail
            ? "This email is already registered"
            : "This username is already taken",
        },
        400,
      );
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const displayName = name || finalUsername;
    const defaultAvatar = null;

    // บันทึกลง Neon DB ผ่าน Drizzle ORM
    const inserted = await db
      .insert(users)
      .values({
        email: cleanEmail,
        password: hashedPassword,
        username: finalUsername,
        displayName,
        avatarUrl: defaultAvatar,
      })
      .returning({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        preferences: users.preferences,
        createdAt: users.createdAt,
      });

    const user = inserted[0];

    // สร้าง One-Time Invite Code ให้ผู้ใช้ใหม่ทันที
    const initialPrefs = await ensureUserInviteCode(db, user);
    user.preferences = initialPrefs;

    // หากสมัครผ่านลิงก์ชวนเพื่อน (ref / referredBy) ให้ปลดล็อกโควตา Service เป็น 2 โพสต์ทั้งสองฝ่าย
    const rawReferral = ref || referredBy || getCookie(c, "alinue_ref");
    let referralApplied = false;
    if (rawReferral) {
      const refResult = await applyMutualReferral(db, user, rawReferral);
      referralApplied = Boolean(refResult?.applied);
      deleteCookie(c, "alinue_ref", { path: "/" });
    }

    // สร้าง Session ลงในฐานข้อมูล Neon DB ตาราง sessions
    const session = await createDbSession(db, user.id, c);

    const isLocalhost =
      c.req.url.includes("localhost") || c.req.url.includes("127.0.0.1");

    setCookie(c, "auth_token", session.token, {
      path: "/",
      secure: !isLocalhost,
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "Lax",
    });

    return c.json(
      {
        success: true,
        message: "User registered successfully",
        token: session.token,
        referralApplied,
        user: {
          ...user,
          serviceQuota: referralApplied ? 2 : 1,
          isReferralUnlocked: referralApplied,
        },
      },
      201,
    );
  } catch (err) {
    console.error("Sign-up error:", err);
    return c.json(
      { success: false, message: err.message || "Registration failed" },
      500,
    );
  }
});

/**
 * 2. POST /api/auth/sign-in - เข้าสู่ระบบ
 */
auth.post("/sign-in", async (c) => {
  try {
    const db = getDrizzle(c);
    const body = await c.req.json();
    const { email, password } = body;

    if (!email || !password) {
      return c.json(
        { success: false, message: "Email and password are required" },
        400,
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const userList = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        password: users.password,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        isBanned: users.isBanned,
        bio: users.bio,
      })
      .from(users)
      .where(or(eq(users.email, cleanEmail), eq(users.username, cleanEmail)))
      .limit(1);

    if (userList.length === 0) {
      return c.json(
        { success: false, message: "Invalid email or password" },
        401,
      );
    }

    const user = userList[0];

    if (user.isBanned) {
      return c.json(
        { success: false, message: "This account has been suspended" },
        403,
      );
    }

    if (!user.password) {
      return c.json(
        {
          success: false,
          message:
            "This account was created with Google OAuth. Please sign in with Google.",
        },
        400,
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return c.json(
        { success: false, message: "Invalid email or password" },
        401,
      );
    }

    // สร้าง Session ลงในฐานข้อมูล Neon DB ตาราง sessions
    const session = await createDbSession(db, user.id, c);

    const isLocalhost =
      c.req.url.includes("localhost") || c.req.url.includes("127.0.0.1");

    setCookie(c, "auth_token", session.token, {
      path: "/",
      secure: !isLocalhost,
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "Lax",
    });

    const { password: _, ...userWithoutPassword } = user;

    return c.json({
      success: true,
      message: "Signed in successfully",
      token: session.token,
      user: userWithoutPassword,
    });
  } catch (err) {
    console.error("Sign-in error:", err);
    return c.json(
      { success: false, message: err.message || "Sign-in failed" },
      500,
    );
  }
});

/**
 * 3. GET /api/auth/me - ตรวจสอบผู้ใช้ปัจจุบัน
 */
auth.get("/me", requireAuth, async (c) => {
  try {
    const authUser = c.get("user");
    const db = getDrizzle(c);

    const userList = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        location: users.location,
        banner: users.banner,
        website: users.website,
        socialLinks: users.socialLinks,
        preferences: users.preferences,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, authUser.id))
      .limit(1);

    if (userList.length === 0) {
      return c.json({ success: false, message: "User not found" }, 404);
    }

    const u = userList[0];
    const ensuredPrefs = await ensureUserInviteCode(db, u);
    const quotaInfo = getUserServiceQuota(ensuredPrefs);

    return c.json({
      success: true,
      user: {
        ...u,
        preferences: ensuredPrefs,
        serviceQuota: quotaInfo.maxServicePosts,
        isReferralUnlocked: quotaInfo.isReferralUnlocked,
        referralCount: quotaInfo.referralCount,
        referredBy: quotaInfo.referredBy,
        inviteCode: quotaInfo.inviteCode,
        inviteCodeUsed: quotaInfo.inviteCodeUsed,
        inviteCodeUsedBy: quotaInfo.inviteCodeUsedBy,
        inviteRemainingUses: quotaInfo.inviteRemainingUses,
      },
    });
  } catch (err) {
    console.error("Get /me error:", err);
    return c.json({ success: false, message: "Server error" }, 500);
  }
});

/**
 * 3.05 GET /api/auth/invite-code - ดึง One-Time Invite Code ของผู้ใช้ปัจจุบัน
 */
auth.get("/invite-code", requireAuth, async (c) => {
  try {
    const authUser = c.get("user");
    const db = getDrizzle(c);

    const userRows = await db
      .select({
        id: users.id,
        username: users.username,
        preferences: users.preferences,
      })
      .from(users)
      .where(eq(users.id, authUser.id))
      .limit(1);

    if (userRows.length === 0) {
      return c.json({ success: false, message: "User not found" }, 404);
    }

    const ensuredPrefs = await ensureUserInviteCode(db, userRows[0]);
    const quotaInfo = getUserServiceQuota(ensuredPrefs);

    return c.json({
      success: true,
      inviteCode: quotaInfo.inviteCode,
      isUsed: quotaInfo.inviteCodeUsed,
      usedBy: quotaInfo.inviteCodeUsedBy,
      remainingUses: quotaInfo.inviteRemainingUses,
      isReferralUnlocked: quotaInfo.isReferralUnlocked,
      maxServicePosts: quotaInfo.maxServicePosts,
    });
  } catch (err) {
    console.error("Get /invite-code error:", err);
    return c.json({ success: false, message: "Server error" }, 500);
  }
});

/**
 * 3.06 GET /api/auth/invite/:code - ตรวจสอบ One-Time Invite Code (Public สำหรับหน้า /join/[code])
 */
auth.get("/invite/:code", async (c) => {
  try {
    const rawCode = c.req.param("code");
    const normalizedCode = normalizeInviteCode(rawCode);
    if (!normalizedCode) {
      return c.json({
        success: true,
        valid: false,
        reason: "invalid_code",
        message: "รูปแบบโค้ดคำเชิญไม่ถูกต้อง",
      });
    }

    const db = getDrizzle(c);
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        preferences: users.preferences,
      })
      .from(users)
      .where(sql`UPPER(${users.preferences}->>'inviteCode') = ${normalizedCode}`)
      .limit(1);

    if (rows.length === 0) {
      return c.json({
        success: true,
        valid: false,
        isUsed: false,
        code: normalizedCode,
        reason: "not_found",
        message: "ไม่พบโค้ดคำเชิญนี้ หรือโค้ดไม่ถูกต้อง",
      });
    }

    const inviter = rows[0];
    const inviterPrefs =
      inviter.preferences && typeof inviter.preferences === "object"
        ? inviter.preferences
        : {};
    const isUsed = Boolean(inviterPrefs.inviteCodeUsed);

    return c.json({
      success: true,
      valid: !isUsed,
      isUsed,
      code: inviterPrefs.inviteCode || normalizedCode,
      reason: isUsed ? "already_used" : null,
      message: isUsed
        ? "โค้ดคำเชิญนี้ถูกใช้งานไปแล้ว (ใช้ได้เพียง 1 ครั้ง)"
        : "โค้ดคำเชิญนี้สามารถใช้งานได้",
      inviter: {
        username: inviter.username,
        displayName: inviter.displayName || inviter.username,
        avatarUrl: inviter.avatarUrl || null,
      },
    });
  } catch (err) {
    console.error("Inspect /invite/:code error:", err);
    return c.json({ success: false, message: "Server error" }, 500);
  }
});

/**
 * 3.1 POST /api/auth/claim-referral - รับสิทธิ์จากการใส่ One-Time Invite Code
 */
auth.post("/claim-referral", requireAuth, async (c) => {
  try {
    const authUser = c.get("user");
    const db = getDrizzle(c);
    const body = await c.req.json().catch(() => ({}));
    const rawRef = body.code || body.ref || body.referredBy;

    if (!rawRef) {
      return c.json(
        { success: false, message: "กรุณาระบุโค้ดคำเชิญ" },
        400,
      );
    }

    const userRows = await db
      .select({
        id: users.id,
        username: users.username,
        preferences: users.preferences,
      })
      .from(users)
      .where(eq(users.id, authUser.id))
      .limit(1);

    if (userRows.length === 0) {
      return c.json({ success: false, message: "User not found" }, 404);
    }

    const currentUser = userRows[0];
    const result = await applyMutualReferral(db, currentUser, rawRef);

    return c.json({
      success: true,
      applied: result.applied,
      reason: result.reason || null,
      inviterUsername: result.inviterUsername || null,
      serviceQuota: result.applied
        ? 2
        : getUserServiceQuota(currentUser.preferences).maxServicePosts,
      message: result.message,
    });
  } catch (err) {
    console.error("Claim referral error:", err);
    return c.json({ success: false, message: "Server error" }, 500);
  }
});

/**
 * 4. POST /api/auth/sign-out - ออกจากระบบ และลบ Session ใน Database
 */
auth.post("/sign-out", async (c) => {
  try {
    const token = extractToken(c);
    if (token) {
      const db = getDrizzle(c);
      await db.delete(sessions).where(eq(sessions.token, token));
    }
  } catch (err) {
    console.error("Sign-out DB error:", err);
  }
  deleteCookie(c, "auth_token", { path: "/" });
  return c.json({ success: true, message: "Signed out successfully" });
});

/**
 * 5. GET /api/auth/google - ขอ URL สำหรับ Login ผ่าน Google OAuth
 */
auth.get("/google", (c) => {
  const { clientId, redirectUri } = getGoogleConfig(c);
  const ref = (c.req.query("ref") || "").trim();

  if (!clientId) {
    return c.json(
      {
        success: false,
        message:
          "GOOGLE_CLIENT_ID is not configured in environment variables",
      },
      500,
    );
  }

  const nonce = Math.random().toString(36).substring(7);
  const state = ref ? `ref:${ref}:${nonce}` : nonce;

  if (ref) {
    const isLocalhost =
      c.req.url.includes("localhost") || c.req.url.includes("127.0.0.1");
    setCookie(c, "alinue_ref", ref, {
      path: "/",
      secure: !isLocalhost,
      httpOnly: false,
      maxAge: 60 * 30,
      sameSite: "Lax",
    });
  }

  const googleAuthUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("state", state);
  googleAuthUrl.searchParams.set("prompt", "select_account");

  const isDirectBrowser = c.req.header("accept")?.includes("text/html");
  if (isDirectBrowser) {
    return c.redirect(googleAuthUrl.toString(), 302);
  }

  return c.json({
    success: true,
    url: googleAuthUrl.toString(),
  });
});

/**
 * 6. GET /api/auth/google/callback - Callback จาก Google OAuth
 */
auth.get("/google/callback", async (c) => {
  const { clientId, clientSecret, clientUrl, redirectUri } =
    getGoogleConfig(c);
  const code = c.req.query("code");
  const error = c.req.query("error");
  const state = c.req.query("state") || "";

  let refFromState = null;
  if (state.startsWith("ref:")) {
    const parts = state.split(":");
    if (parts[1]) refFromState = parts[1];
  }
  const referralCode = refFromState || getCookie(c, "alinue_ref") || null;

  if (error || !code) {
    return c.redirect(
      `${clientUrl}/sign-in?error=${encodeURIComponent(error || "no_code")}`,
    );
  }

  try {
    // 1. แลกเปลี่ยน Auth Code เป็น Access Token จาก Google
    const tokenParams = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("Google token exchange error:", tokenData);
      return c.redirect(
        `${clientUrl}/sign-in?error=token_exchange_failed`,
      );
    }

    // 2. ดึงข้อมูล User Profile จาก Google
    const userRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      },
    );
    const googleUser = await userRes.json();

    if (!googleUser.email) {
      return c.redirect(`${clientUrl}/sign-in?error=no_email_from_google`);
    }

    const db = getDrizzle(c);
    const cleanEmail = googleUser.email.toLowerCase();

    // 3. ตรวจสอบว่ามี User ในระบบหรือยัง
    let userList = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        preferences: users.preferences,
      })
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    let user;
    if (userList.length > 0) {
      user = userList[0];
      // อัปเดตรูปถ้ายังไม่มี
      if (!user.avatarUrl && googleUser.picture) {
        await db
          .update(users)
          .set({ avatarUrl: googleUser.picture, updatedAt: sql`NOW()` })
          .where(eq(users.id, user.id));
        user.avatarUrl = googleUser.picture;
      }
    } else {
      // สร้างผู้ใช้ใหม่
      const baseUsername = cleanEmail
        .split("@")[0]
        .replace(/[^a-zA-Z0-9_]/g, "");
      const uniqueUsername = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

      const inserted = await db
        .insert(users)
        .values({
          email: cleanEmail,
          username: uniqueUsername,
          displayName: googleUser.name || baseUsername,
          avatarUrl: googleUser.picture || null,
          isVerified: true,
        })
        .returning({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          preferences: users.preferences,
        });
      user = inserted[0];

      if (referralCode) {
        await applyMutualReferral(db, user, referralCode);
        deleteCookie(c, "alinue_ref", { path: "/" });
      }

      // บันทึกความเชื่อมโยงใน accounts table
      const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db
        .insert(accounts)
        .values({
          id: accountId,
          userId: user.id,
          accountId: String(googleUser.id),
          providerId: 'google',
          accessToken: tokenData.access_token,
        })
        .catch((e) => console.warn("Account link warning:", e.message));
    }

    // 4. สร้าง Session ในตาราง sessions ใน Neon DB
    const session = await createDbSession(db, user.id, c);

    // 5. ส่ง Session Token กลับไปที่ Frontend ผ่าน Cookie และ Query Params
    const isLocalhost =
      c.req.url.includes("localhost") || c.req.url.includes("127.0.0.1");

    setCookie(c, "auth_token", session.token, {
      path: "/",
      secure: !isLocalhost,
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "Lax",
    });

    const userParam = encodeURIComponent(
      JSON.stringify({
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.displayName || user.username,
        avatar: user.avatarUrl,
      }),
    );

    return c.redirect(
      `${clientUrl}/?token=${session.token}&user=${userParam}`,
    );
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return c.redirect(`${clientUrl}/sign-in?error=server_error`);
  }
});

/**
 * 7. POST /api/auth/google-one-tap - รับ Google Credential JWT จาก Google One Tap
 */
auth.post("/google-one-tap", async (c) => {
  try {
    const body = await c.req.json();
    const { credential } = body;

    if (!credential) {
      return c.json(
        { success: false, message: "Missing Google credential" },
        400,
      );
    }

    // ตรวจสอบ Google ID Token กับ Google Tokeninfo API
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`,
    );
    const payload = await verifyRes.json();

    if (!payload.email || payload.error_description) {
      return c.json(
        { success: false, message: "Invalid Google credential" },
        401,
      );
    }

    const db = getDrizzle(c);
    const cleanEmail = payload.email.toLowerCase();

    let userList = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    let user;
    if (userList.length > 0) {
      user = userList[0];
      if (!user.avatarUrl && payload.picture) {
        await db
          .update(users)
          .set({ avatarUrl: payload.picture, updatedAt: sql`NOW()` })
          .where(eq(users.id, user.id));
        user.avatarUrl = payload.picture;
      }
    } else {
      const baseUsername = cleanEmail
        .split("@")[0]
        .replace(/[^a-zA-Z0-9_]/g, "");
      const uniqueUsername = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

      const inserted = await db
        .insert(users)
        .values({
          email: cleanEmail,
          username: uniqueUsername,
          displayName: payload.name || baseUsername,
          avatarUrl: payload.picture || null,
          isVerified: true,
        })
        .returning({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        });
      user = inserted[0];
    }

    // สร้าง Session ในตาราง sessions ใน Neon DB
    const session = await createDbSession(db, user.id, c);

    const isLocalhost =
      c.req.url.includes("localhost") || c.req.url.includes("127.0.0.1");

    setCookie(c, "auth_token", session.token, {
      path: "/",
      secure: !isLocalhost,
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "Lax",
    });

    return c.json({
      success: true,
      message: "Authenticated with Google successfully",
      token: session.token,
      user,
    });
  } catch (err) {
    console.error("Google token verify error:", err);
    return c.json(
      { success: false, message: "Google authentication failed" },
      500,
    );
  }
});

export default auth;
