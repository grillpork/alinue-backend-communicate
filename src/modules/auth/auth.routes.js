import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import { getDb } from "../../config/db";
import {
  requireAuth,
  createDbSession,
  extractToken,
} from "../../middleware/auth";

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
    const sql = getDb(c);
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
    const existing = await sql`
      SELECT id, email, username FROM users 
      WHERE email = ${cleanEmail} OR username = ${finalUsername} 
      LIMIT 1
    `;

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
    const defaultAvatar = `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80`;

    // บันทึกลง Neon DB
    const inserted = await sql`
      INSERT INTO users (
        email, 
        password, 
        username, 
        "displayName", 
        "avatarUrl",
        "createdAt", 
        "updatedAt"
      ) VALUES (
        ${cleanEmail}, 
        ${hashedPassword}, 
        ${finalUsername}, 
        ${displayName}, 
        ${defaultAvatar},
        NOW(), 
        NOW()
      )
      RETURNING id, email, username, "displayName", "avatarUrl", "createdAt"
    `;

    const user = inserted[0];
    
    // สร้าง Session ลงในฐานข้อมูล Neon DB ตาราง sessions
    const session = await createDbSession(sql, user.id, c);

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
        message: "Account created successfully",
        token: session.token,
        user,
      },
      201,
    );
  } catch (err) {
    console.error("Sign-up error:", err);
    return c.json(
      { success: false, message: err.message || "Failed to sign up" },
      500,
    );
  }
});

/**
 * 2. POST /api/auth/sign-in - เข้าสู่ระบบ
 */
auth.post("/sign-in", async (c) => {
  try {
    const sql = getDb(c);
    const body = await c.req.json();
    const { email, password } = body;

    if (!email || !password) {
      return c.json(
        { success: false, message: "Email and password are required" },
        400,
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const users = await sql`
      SELECT id, email, username, password, "displayName", "avatarUrl", "isBanned", bio
      FROM users 
      WHERE email = ${cleanEmail} OR username = ${cleanEmail}
      LIMIT 1
    `;

    if (users.length === 0) {
      return c.json(
        { success: false, message: "Invalid email or password" },
        401,
      );
    }

    const user = users[0];

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
    const session = await createDbSession(sql, user.id, c);

    const isLocalhost =
      c.req.url.includes("localhost") || c.req.url.includes("127.0.0.1");

    setCookie(c, "auth_token", session.token, {
      path: "/",
      secure: !isLocalhost,
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "Lax",
    });

    const safeUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
    };

    return c.json({
      success: true,
      message: "Signed in successfully",
      token: session.token,
      user: safeUser,
    });
  } catch (err) {
    console.error("Sign-in error:", err);
    return c.json(
      { success: false, message: err.message || "Failed to sign in" },
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
    const sql = getDb(c);

    const users = await sql`
      SELECT id, email, username, "displayName", "avatarUrl", bio, location, banner, website, "createdAt"
      FROM users 
      WHERE id = ${authUser.id}
      LIMIT 1
    `;

    if (users.length === 0) {
      return c.json({ success: false, message: "User not found" }, 404);
    }

    return c.json({
      success: true,
      user: users[0],
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
      const sql = getDb(c);
      await sql`DELETE FROM sessions WHERE token = ${token}`;
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
      500
    );
  }

  const rootUrl = "https://accounts.google.com/o/oauth2/v2/auth";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
  });

  const url = `${rootUrl}?${params.toString()}`;

  // หาก request ขอ json ให้ส่ง url กลับไป หรือ redirect โดยตรง
  if (c.req.header("Accept")?.includes("application/json")) {
    return c.json({ success: true, url });
  }

  return c.redirect(url);
});

/**
 * 6. GET /api/auth/google/callback - Callback จาก Google OAuth
 */
auth.get("/google/callback", async (c) => {
  try {
    const { clientId, clientSecret, redirectUri, clientUrl } =
      getGoogleConfig(c);
    const code = c.req.query("code");
    const error = c.req.query("error");

    if (error || !code) {
      return c.redirect(`${clientUrl}/sign-in?error=google_auth_failed`);
    }

    // 1. แลก Authorization Code เป็น Tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("Google token exchange failed:", tokenData);
      return c.redirect(`${clientUrl}/sign-in?error=token_exchange_failed`);
    }

    // 2. ดึงข้อมูล User จาก Google UserInfo API
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

    const sql = getDb(c);
    const cleanEmail = googleUser.email.toLowerCase();

    // 3. ตรวจสอบว่ามี User ในระบบหรือยัง
    let users = await sql`
      SELECT id, email, username, "displayName", "avatarUrl" 
      FROM users 
      WHERE email = ${cleanEmail} 
      LIMIT 1
    `;

    let user;
    if (users.length > 0) {
      user = users[0];
      // อัปเดตรูปถ้ายังไม่มี
      if (!user.avatarUrl && googleUser.picture) {
        await sql`
          UPDATE users 
          SET "avatarUrl" = ${googleUser.picture}, "updatedAt" = NOW() 
          WHERE id = ${user.id}
        `;
        user.avatarUrl = googleUser.picture;
      }
    } else {
      // สร้างผู้ใช้ใหม่
      const baseUsername = cleanEmail
        .split("@")[0]
        .replace(/[^a-zA-Z0-9_]/g, "");
      const uniqueUsername = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

      const inserted = await sql`
        INSERT INTO users (
          email, 
          username, 
          "displayName", 
          "avatarUrl", 
          "isVerified",
          "createdAt", 
          "updatedAt"
        ) VALUES (
          ${cleanEmail}, 
          ${uniqueUsername}, 
          ${googleUser.name || baseUsername}, 
          ${googleUser.picture || null}, 
          true,
          NOW(), 
          NOW()
        )
        RETURNING id, email, username, "displayName", "avatarUrl"
      `;
      user = inserted[0];

      // บันทึกความเชื่อมโยงใน accounts table
      const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await sql`
        INSERT INTO accounts (
          id, 
          user_id, 
          "accountId", 
          "providerId", 
          "accessToken", 
          "createdAt", 
          "updatedAt"
        ) VALUES (
          ${accountId}, 
          ${user.id}, 
          ${googleUser.id}, 
          'google', 
          ${tokenData.access_token}, 
          NOW(), 
          NOW()
        )
      `.catch((e) => console.warn("Account link warning:", e.message));
    }

    // 4. สร้าง Session ในตาราง sessions ใน Neon DB
    const session = await createDbSession(sql, user.id, c);

    // 5. ส่ง Session Token กลับไปที่ Frontend ผ่าน Cookie และ Query Params
    const isLocalhost =
      clientUrl.includes("localhost") || clientUrl.includes("127.0.0.1");

    setCookie(c, "auth_token", session.token, {
      path: "/",
      secure: !isLocalhost,
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "Lax",
    });

    return c.redirect(
      `${clientUrl}/?token=${session.token}&auth_token=${session.token}&auth_success=true`,
    );
  } catch (err) {
    console.error("Google callback error:", err);
    const { clientUrl } = getGoogleConfig(c);
    return c.redirect(`${clientUrl}/sign-in?error=server_error`);
  }
});

/**
 * 7. POST /api/auth/google/token - สำหรับ Frontend ส่ง Google ID Token มา Verify โดยตรง (เช่น Google One-Tap)
 */
auth.post("/google/token", async (c) => {
  try {
    const { idToken, credential } = await c.req.json();
    const tokenToVerify = idToken || credential;

    if (!tokenToVerify) {
      return c.json(
        { success: false, message: "Google token/credential is required" },
        400,
      );
    }

    // ตรวจสอบ token กับ Google API
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${tokenToVerify}`,
    );
    const payload = await verifyRes.json();

    if (!payload.email || payload.error_description) {
      return c.json(
        { success: false, message: "Invalid Google credential" },
        401,
      );
    }

    const sql = getDb(c);
    const cleanEmail = payload.email.toLowerCase();

    let users = await sql`
      SELECT id, email, username, "displayName", "avatarUrl" 
      FROM users 
      WHERE email = ${cleanEmail} 
      LIMIT 1
    `;

    let user;
    if (users.length > 0) {
      user = users[0];
      if (!user.avatarUrl && payload.picture) {
        await sql`
          UPDATE users SET "avatarUrl" = ${payload.picture}, "updatedAt" = NOW() 
          WHERE id = ${user.id}
        `;
        user.avatarUrl = payload.picture;
      }
    } else {
      const baseUsername = cleanEmail
        .split("@")[0]
        .replace(/[^a-zA-Z0-9_]/g, "");
      const uniqueUsername = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

      const inserted = await sql`
        INSERT INTO users (
          email, 
          username, 
          "displayName", 
          "avatarUrl", 
          "isVerified",
          "createdAt", 
          "updatedAt"
        ) VALUES (
          ${cleanEmail}, 
          ${uniqueUsername}, 
          ${payload.name || baseUsername}, 
          ${payload.picture || null}, 
          true,
          NOW(), 
          NOW()
        )
        RETURNING id, email, username, "displayName", "avatarUrl"
      `;
      user = inserted[0];
    }

    // สร้าง Session ในตาราง sessions ใน Neon DB
    const session = await createDbSession(sql, user.id, c);

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
