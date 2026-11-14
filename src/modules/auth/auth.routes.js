import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import { getDrizzle } from "../../config/db.js";
import { users, sessions, accounts } from "../../db/schema.js";
import { eq, or, sql } from "drizzle-orm";
import {
  requireAuth,
  createDbSession,
  extractToken,
} from "../../middleware/auth.js";

const auth = new Hono();

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
    const { email, password, username, name } = body;

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
        createdAt: users.createdAt,
      });

    const user = inserted[0];
    
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
        user,
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
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, authUser.id))
      .limit(1);

    if (userList.length === 0) {
      return c.json({ success: false, message: "User not found" }, 404);
    }

    return c.json({
      success: true,
      user: userList[0],
    });
  } catch (err) {
    console.error("Get /me error:", err);
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

  const state = Math.random().toString(36).substring(7);

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
        });
      user = inserted[0];

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
      `${clientUrl}/sign-in?token=${session.token}&user=${userParam}`,
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
