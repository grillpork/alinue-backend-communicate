import { Hono } from 'hono';
import { getDrizzle, getDb } from '../../config/db.js';
import { services, serviceLikes, users, searchLogs } from '../../db/schema.js';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import {
  checkImageUrl,
  deleteFromR2,
  checkUserTimeoutStatus,
  recordModerationViolation,
  getClientIp,
} from '../../utils/moderation.js';
import { createNotification } from '../notification/notification.service.js';
import { eq, and, or, ilike, sql, desc, gt, lte } from 'drizzle-orm';

const serviceRouter = new Hono();

/**
 * Helper: คำนวณวันหมดอายุและสถานะ
 */
function computeExpirationStats(expiresAtStr) {
  if (!expiresAtStr) return { isExpired: false, daysLeft: 0, hoursLeft: 0 };
  const now = Date.now();
  const expTime = new Date(expiresAtStr).getTime();
  const diffMs = expTime - now;
  const isExpired = diffMs <= 0;
  const daysLeft = isExpired ? 0 : Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  const hoursLeft = isExpired ? 0 : Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60)));
  return { isExpired, daysLeft, hoursLeft };
}

/**
 * 1. GET /api/services - ดึงรายการโพสต์รับงาน Service ทั้งหมด
 * รองรับการกรอง: search, tag, username, user_id, status, include_expired, page, limit
 * โดยค่าเริ่มต้นจะแสดงเฉพาะงานที่ยังไม่หมดอายุ (อายุ 1 เดือน) และ status = 'active'
 */
serviceRouter.get('/', optionalAuth, async (c) => {
  try {
    const db = getDrizzle(c);
    const currentUser = c.get('user');

    const search = c.req.query('search')?.trim() || '';
    const tag = c.req.query('tag')?.trim() || '';
    const username = c.req.query('username')?.trim().toLowerCase() || '';
    const userIdParam = c.req.query('user_id');
    const statusParam = c.req.query('status')?.trim().toLowerCase() || 'active'; // 'active', 'paused', 'closed', 'expired', 'all'
    const includeExpired = c.req.query('include_expired') === 'true';
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    let targetUserId = userIdParam ? parseInt(userIdParam, 10) : null;
    if (!targetUserId && username) {
      const uRes = await db
        .select({ id: users.id })
        .from(users)
        .where(ilike(users.username, username))
        .limit(1);

      if (uRes.length > 0) {
        targetUserId = uRes[0].id;
      } else {
        return c.json({
          success: true,
          services: [],
          pagination: { page, limit, hasMore: false },
        });
      }
    }

    const conditions = [eq(services.isPublished, true)];

    if (targetUserId) {
      conditions.push(eq(services.userId, targetUserId));
    }

    // กรองสถานะ
    if (statusParam !== 'all' && statusParam !== 'expired') {
      conditions.push(eq(services.status, statusParam));
    }

    // กรองวันหมดอายุ (มีอายุ 1 เดือนแล้วจะหายไป)
    if (statusParam === 'expired') {
      conditions.push(lte(services.expiresAt, sql`NOW()`));
    } else if (!includeExpired && statusParam === 'active') {
      conditions.push(gt(services.expiresAt, sql`NOW()`));
    }

    // ค้นหา
    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          ilike(services.title, searchPattern),
          ilike(services.description, searchPattern),
          ilike(users.displayName, searchPattern),
          ilike(users.username, searchPattern),
          sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${services.tags}) t WHERE t ILIKE ${searchPattern})`
        )
      );
    }

    // กรองแท็กเฉพาะ
    if (tag) {
      const cleanTag = tag.replace(/^#/, '');
      conditions.push(
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${services.tags}) t WHERE LOWER(t) = LOWER(${cleanTag}))`
      );
    }

    const items = await db
      .select({
        id: services.id,
        userId: services.userId,
        title: services.title,
        description: services.description,
        images: services.images,
        coverUrl: services.coverUrl,
        tags: services.tags,
        price: services.price,
        priceText: services.priceText,
        status: services.status,
        expiresAt: services.expiresAt,
        likesCount: services.likesCount,
        viewsCount: services.viewsCount,
        createdAt: services.createdAt,
        updatedAt: services.updatedAt,
        authorUsername: users.username,
        authorName: users.displayName,
        authorAvatar: users.avatarUrl,
        isLiked: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM service_likes sl WHERE sl.service_id = ${services.id} AND sl.user_id = ${currentUser.id})`
          : sql`false`,
      })
      .from(services)
      .leftJoin(users, eq(services.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(services.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;

    const formatted = resultItems.map((s) => {
      const { isExpired, daysLeft, hoursLeft } = computeExpirationStats(s.expiresAt);
      const rawImages = Array.isArray(s.images)
        ? s.images
        : typeof s.images === 'string'
        ? JSON.parse(s.images || '[]')
        : [];

      return {
        id: s.id,
        userId: s.userId,
        title: s.title,
        description: s.description || '',
        images: rawImages,
        coverUrl: s.coverUrl || rawImages[0] || null,
        tags: Array.isArray(s.tags) ? s.tags : [],
        price: s.price ? Number(s.price) : null,
        priceText: s.priceText || null,
        status: isExpired ? 'expired' : s.status,
        expiresAt: s.expiresAt,
        isExpired,
        daysLeft,
        hoursLeft,
        likesCount: s.likesCount || 0,
        viewsCount: s.viewsCount || 0,
        isLiked: Boolean(s.isLiked),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        author: {
          id: s.userId,
          name: s.authorName || s.authorUsername || 'Creator',
          username: s.authorUsername || 'user',
          avatar: s.authorAvatar || null,
        },
      };
    });

    // บันทึก Log การค้นหา
    if (search && search.trim()) {
      try {
        const rawSql = getDb(c);
        const ipAddress = getClientIp(c);
        rawSql`
          INSERT INTO search_logs (query, user_id, search_type, result_count, ip_address)
          VALUES (${search.trim()}, ${currentUser?.id || null}, 'services', ${formatted.length}, ${ipAddress})
        `.catch(() => {});
      } catch {}
    }

    return c.json({
      success: true,
      services: formatted,
      pagination: {
        page,
        limit,
        hasMore,
      },
    });
  } catch (err) {
    console.error('Get services error:', err);
    return c.json({ success: false, message: 'Failed to fetch services' }, 500);
  }
});

/**
 * 2. GET /api/services/my - ดูรายการงานที่ผู้ใช้โพสต์รับงานไว้ทั้งหมด (รวมหมดอายุและกำลังเปิดรับ)
 */
serviceRouter.get('/my', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const db = getDrizzle(c);

    const items = await db
      .select({
        id: services.id,
        userId: services.userId,
        title: services.title,
        description: services.description,
        images: services.images,
        coverUrl: services.coverUrl,
        tags: services.tags,
        price: services.price,
        priceText: services.priceText,
        status: services.status,
        expiresAt: services.expiresAt,
        likesCount: services.likesCount,
        viewsCount: services.viewsCount,
        createdAt: services.createdAt,
        updatedAt: services.updatedAt,
      })
      .from(services)
      .where(eq(services.userId, user.id))
      .orderBy(desc(services.createdAt));

    let activeCount = 0;
    let expiredCount = 0;
    let pausedCount = 0;

    const formatted = items.map((s) => {
      const { isExpired, daysLeft, hoursLeft } = computeExpirationStats(s.expiresAt);
      const computedStatus = isExpired ? 'expired' : s.status;

      if (computedStatus === 'active') activeCount++;
      else if (computedStatus === 'expired') expiredCount++;
      else if (computedStatus === 'paused') pausedCount++;

      const rawImages = Array.isArray(s.images)
        ? s.images
        : typeof s.images === 'string'
        ? JSON.parse(s.images || '[]')
        : [];

      return {
        ...s,
        images: rawImages,
        coverUrl: s.coverUrl || rawImages[0] || null,
        tags: Array.isArray(s.tags) ? s.tags : [],
        price: s.price ? Number(s.price) : null,
        status: computedStatus,
        isExpired,
        daysLeft,
        hoursLeft,
      };
    });

    return c.json({
      success: true,
      services: formatted,
      stats: {
        total: formatted.length,
        active: activeCount,
        expired: expiredCount,
        paused: pausedCount,
      },
    });
  } catch (err) {
    console.error('Get my services error:', err);
    return c.json({ success: false, message: 'Failed to fetch your services' }, 500);
  }
});

/**
 * 3. GET /api/services/:id - ดึงรายละเอียดโพสต์รับงานรายชิ้น
 */
serviceRouter.get('/:id', optionalAuth, async (c) => {
  try {
    const serviceId = parseInt(c.req.param('id'), 10);
    if (isNaN(serviceId)) {
      return c.json({ success: false, message: 'Invalid service ID' }, 400);
    }

    const db = getDrizzle(c);
    const currentUser = c.get('user');

    // อัปเดตยอดวิว
    await db
      .update(services)
      .set({ viewsCount: sql`${services.viewsCount} + 1` })
      .where(eq(services.id, serviceId));

    const rows = await db
      .select({
        id: services.id,
        userId: services.userId,
        title: services.title,
        description: services.description,
        images: services.images,
        coverUrl: services.coverUrl,
        tags: services.tags,
        price: services.price,
        priceText: services.priceText,
        status: services.status,
        expiresAt: services.expiresAt,
        likesCount: services.likesCount,
        viewsCount: services.viewsCount,
        createdAt: services.createdAt,
        updatedAt: services.updatedAt,
        authorUsername: users.username,
        authorName: users.displayName,
        authorAvatar: users.avatarUrl,
        isLiked: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM service_likes sl WHERE sl.service_id = ${services.id} AND sl.user_id = ${currentUser.id})`
          : sql`false`,
      })
      .from(services)
      .leftJoin(users, eq(services.userId, users.id))
      .where(eq(services.id, serviceId))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ success: false, message: 'Service not found' }, 404);
    }

    const s = rows[0];
    const { isExpired, daysLeft, hoursLeft } = computeExpirationStats(s.expiresAt);
    const rawImages = Array.isArray(s.images)
      ? s.images
      : typeof s.images === 'string'
      ? JSON.parse(s.images || '[]')
      : [];

    return c.json({
      success: true,
      service: {
        id: s.id,
        userId: s.userId,
        title: s.title,
        description: s.description || '',
        images: rawImages,
        coverUrl: s.coverUrl || rawImages[0] || null,
        tags: Array.isArray(s.tags) ? s.tags : [],
        price: s.price ? Number(s.price) : null,
        priceText: s.priceText || null,
        status: isExpired ? 'expired' : s.status,
        expiresAt: s.expiresAt,
        isExpired,
        daysLeft,
        hoursLeft,
        likesCount: s.likesCount || 0,
        viewsCount: s.viewsCount || 0,
        isLiked: Boolean(s.isLiked),
        isOwner: currentUser ? currentUser.id === s.userId : false,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        author: {
          id: s.userId,
          name: s.authorName || s.authorUsername || 'Creator',
          username: s.authorUsername || 'user',
          avatar: s.authorAvatar || null,
        },
      },
    });
  } catch (err) {
    console.error('Get service detail error:', err);
    return c.json({ success: false, message: 'Failed to fetch service' }, 500);
  }
});

/**
 * 4. POST /api/services - สร้างโพสต์รับงาน Service ใหม่
 * กำหนดอายุ 1 เดือน (30 วัน) อัตโนมัติ โดยระบุ title, description, images (ตัวอย่างงาน), tags ได้
 */
serviceRouter.post('/', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const rawSql = getDb(c);
    const db = getDrizzle(c);
    const ipAddress = getClientIp(c);

    // ตรวจสอบ Timeout / Rate Limit
    const timeoutStatus = await checkUserTimeoutStatus(rawSql, {
      userId: user.id,
      ipAddress,
    });
    if (timeoutStatus.isTimedOut) {
      return c.json(
        {
          success: false,
          isTimedOut: true,
          action: 'timeout',
          message: timeoutStatus.message,
          retryAfterSeconds: timeoutStatus.retryAfterSeconds,
          timeoutExpiresAt: timeoutStatus.timeoutExpiresAt,
        },
        429
      );
    }

    const {
      title,
      description = '',
      images = [],
      mediaUrls = [], // รองรับทั้งชื่อ images หรือ mediaUrls
      coverUrl = null,
      tags: rawTags = [],
      price = null,
      priceText = null,
      durationDays = 30, // อายุของโพสต์รับงาน ค่าเริ่มต้นคือ 30 วัน (1 เดือน)
    } = body;

    if (!title || !title.trim()) {
      return c.json({ success: false, message: 'กรุณาระบุชื่องานที่รับ (Title)' }, 400);
    }

    // รวมรายการรูปภาพตัวอย่างงาน
    const sampleImages = Array.isArray(images) && images.length > 0
      ? images
      : Array.isArray(mediaUrls)
      ? mediaUrls
      : [];

    const finalImages = sampleImages.filter((url) => typeof url === 'string' && url.trim().length > 0);

    // ตรวจสอบความปลอดภัยรูปภาพที่มาจาก R2
    const r2Config = {
      accountId: c.env.R2_ACCOUNT_ID,
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      bucketName: c.env.R2_BUCKET_NAME || 'cats-coworker',
      publicUrl: c.env.R2_PUBLIC_URL || 'https://pub-6d43351c06b34d6c91ecef3d7be6d4c3.r2.dev',
    };

    const urlsToCheck = Array.from(new Set([...finalImages, coverUrl].filter(Boolean)));
    for (const imgUrl of urlsToCheck) {
      const isOurR2Image = imgUrl.includes(r2Config.publicUrl) || imgUrl.includes('.r2.dev');
      if (isOurR2Image) {
        const check = await checkImageUrl(imgUrl, c.env);
        if (!check.isSafe) {
          const fileKey = imgUrl.replace(`${r2Config.publicUrl}/`, '').replace(/^https?:\/\/[^/]+\//, '');
          if (fileKey) {
            await deleteFromR2(fileKey, r2Config);
          }
          await recordModerationViolation(rawSql, {
            userId: user.id,
            ipAddress,
            fileKey,
            imageUrl: imgUrl,
            reasons: check.reasons,
            scores: check.scores,
          });

          return c.json(
            {
              success: false,
              isBlocked: true,
              message: `รูปภาพตัวอย่างงานไม่เหมาะสม: ${check.reasons.join(', ')}`,
            },
            400
          );
        }
      }
    }

    const finalCoverUrl = coverUrl || finalImages[0] || null;

    // ประมวลผลแท็ก
    const finalTags = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean)
      : typeof rawTags === 'string'
      ? rawTags.split(/[,\s]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
      : [];

    // คำนวณวันหมดอายุ: 1 เดือน (30 วัน)
    const validDays = Math.min(60, Math.max(1, parseInt(durationDays, 10) || 30));
    const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString();

    const inserted = await db
      .insert(services)
      .values({
        userId: user.id,
        title: title.trim(),
        description: description ? description.trim() : null,
        images: finalImages,
        coverUrl: finalCoverUrl,
        tags: finalTags,
        price: price ? String(price) : null,
        priceText: priceText ? priceText.trim() : null,
        status: 'active',
        expiresAt,
        likesCount: 0,
        viewsCount: 0,
        isPublished: true,
      })
      .returning();

    const s = inserted[0];
    const { isExpired, daysLeft, hoursLeft } = computeExpirationStats(s.expiresAt);

    return c.json(
      {
        success: true,
        message: 'โพสต์รับงานเรียบร้อยแล้ว (มีอายุ 1 เดือน)',
        service: {
          id: s.id,
          userId: s.userId,
          title: s.title,
          description: s.description || '',
          images: Array.isArray(s.images) ? s.images : [],
          coverUrl: s.coverUrl,
          tags: Array.isArray(s.tags) ? s.tags : [],
          price: s.price ? Number(s.price) : null,
          priceText: s.priceText || null,
          status: s.status,
          expiresAt: s.expiresAt,
          isExpired,
          daysLeft,
          hoursLeft,
          likesCount: s.likesCount || 0,
          viewsCount: s.viewsCount || 0,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          author: {
            id: user.id,
            name: user.displayName || user.username || 'You',
            username: user.username,
            avatar: user.avatarUrl,
          },
        },
      },
      201
    );
  } catch (err) {
    console.error('Create service error:', err);
    return c.json({ success: false, message: 'Failed to create service' }, 500);
  }
});

/**
 * 5. PUT /api/services/:id - แก้ไขโพสต์รับงาน
 */
serviceRouter.put('/:id', requireAuth, async (c) => {
  try {
    const serviceId = parseInt(c.req.param('id'), 10);
    if (isNaN(serviceId)) {
      return c.json({ success: false, message: 'Invalid service ID' }, 400);
    }

    const user = c.get('user');
    const db = getDrizzle(c);

    // ตรวจสอบความเป็นเจ้าของ
    const existing = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);

    if (existing.length === 0) {
      return c.json({ success: false, message: 'Service not found' }, 404);
    }

    if (existing[0].userId !== user.id) {
      return c.json({ success: false, message: 'Forbidden: You do not own this service post' }, 403);
    }

    const body = await c.req.json();
    const {
      title,
      description,
      images,
      mediaUrls,
      coverUrl,
      tags,
      price,
      priceText,
      status,
      isPublished,
    } = body;

    const updateData = {
      updatedAt: sql`NOW()`,
    };

    if (title !== undefined && title.trim()) {
      updateData.title = title.trim();
    }
    if (description !== undefined) {
      updateData.description = description ? description.trim() : null;
    }
    const finalImages = images !== undefined ? images : mediaUrls;
    if (finalImages !== undefined && Array.isArray(finalImages)) {
      updateData.images = finalImages.filter((u) => typeof u === 'string' && u.trim().length > 0);
    }
    if (coverUrl !== undefined) {
      updateData.coverUrl = coverUrl;
    }
    if (tags !== undefined) {
      updateData.tags = Array.isArray(tags)
        ? tags.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean)
        : [];
    }
    if (price !== undefined) {
      updateData.price = price !== null ? String(price) : null;
    }
    if (priceText !== undefined) {
      updateData.priceText = priceText ? String(priceText).trim() : null;
    }
    if (status !== undefined) {
      updateData.status = status;
    }
    if (isPublished !== undefined) {
      updateData.isPublished = Boolean(isPublished);
    }

    const updated = await db
      .update(services)
      .set(updateData)
      .where(eq(services.id, serviceId))
      .returning();

    const s = updated[0];
    const { isExpired, daysLeft, hoursLeft } = computeExpirationStats(s.expiresAt);

    return c.json({
      success: true,
      message: 'บันทึกการแก้ไขเรียบร้อยแล้ว',
      service: {
        ...s,
        price: s.price ? Number(s.price) : null,
        isExpired,
        daysLeft,
        hoursLeft,
      },
    });
  } catch (err) {
    console.error('Update service error:', err);
    return c.json({ success: false, message: 'Failed to update service' }, 500);
  }
});

/**
 * 6. DELETE /api/services/:id - ลบโพสต์รับงาน
 */
serviceRouter.delete('/:id', requireAuth, async (c) => {
  try {
    const serviceId = parseInt(c.req.param('id'), 10);
    if (isNaN(serviceId)) {
      return c.json({ success: false, message: 'Invalid service ID' }, 400);
    }

    const user = c.get('user');
    const db = getDrizzle(c);

    const existing = await db
      .select({ id: services.id, userId: services.userId })
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);

    if (existing.length === 0) {
      return c.json({ success: false, message: 'Service not found' }, 404);
    }

    if (existing[0].userId !== user.id) {
      return c.json({ success: false, message: 'Forbidden' }, 403);
    }

    await db.delete(services).where(eq(services.id, serviceId));

    return c.json({
      success: true,
      message: 'ลบโพสต์รับงานเรียบร้อยแล้ว',
    });
  } catch (err) {
    console.error('Delete service error:', err);
    return c.json({ success: false, message: 'Failed to delete service' }, 500);
  }
});

/**
 * 7. POST /api/services/:id/renew - ต่ออายุการรับงานอีก 30 วัน (1 เดือน)
 */
serviceRouter.post('/:id/renew', requireAuth, async (c) => {
  try {
    const serviceId = parseInt(c.req.param('id'), 10);
    if (isNaN(serviceId)) {
      return c.json({ success: false, message: 'Invalid service ID' }, 400);
    }

    const user = c.get('user');
    const db = getDrizzle(c);

    const existing = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);

    if (existing.length === 0) {
      return c.json({ success: false, message: 'Service not found' }, 404);
    }

    if (existing[0].userId !== user.id) {
      return c.json({ success: false, message: 'Forbidden' }, 403);
    }

    // ต่ออายุอีก 30 วัน: ถ้างวดเก่ายังไม่หมดอายุ ให้นับต่อจากงวดเดิม ถ้าหมดแล้วให้นับจากตอนนี้
    const now = Date.now();
    const currentExp = new Date(existing[0].expiresAt).getTime();
    const baseTime = currentExp > now ? currentExp : now;
    const newExpiresAt = new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString();

    const updated = await db
      .update(services)
      .set({
        expiresAt: newExpiresAt,
        status: 'active',
        updatedAt: sql`NOW()`,
      })
      .where(eq(services.id, serviceId))
      .returning();

    const s = updated[0];
    const { isExpired, daysLeft, hoursLeft } = computeExpirationStats(s.expiresAt);

    return c.json({
      success: true,
      message: 'ต่ออายุการรับงานเพิ่มอีก 30 วันเรียบร้อยแล้ว',
      expiresAt: s.expiresAt,
      daysLeft,
      hoursLeft,
      service: {
        ...s,
        price: s.price ? Number(s.price) : null,
        isExpired,
        daysLeft,
        hoursLeft,
      },
    });
  } catch (err) {
    console.error('Renew service error:', err);
    return c.json({ success: false, message: 'Failed to renew service' }, 500);
  }
});

/**
 * 8. POST /api/services/:id/toggle-status - สลับสถานะ (เช่น พักรับงานชั่วคราว / เปิดรับงานต่อ)
 */
serviceRouter.post('/:id/toggle-status', requireAuth, async (c) => {
  try {
    const serviceId = parseInt(c.req.param('id'), 10);
    if (isNaN(serviceId)) {
      return c.json({ success: false, message: 'Invalid service ID' }, 400);
    }

    const user = c.get('user');
    const db = getDrizzle(c);

    const existing = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);

    if (existing.length === 0) {
      return c.json({ success: false, message: 'Service not found' }, 404);
    }

    if (existing[0].userId !== user.id) {
      return c.json({ success: false, message: 'Forbidden' }, 403);
    }

    const newStatus = existing[0].status === 'active' ? 'paused' : 'active';

    const updated = await db
      .update(services)
      .set({
        status: newStatus,
        updatedAt: sql`NOW()`,
      })
      .where(eq(services.id, serviceId))
      .returning();

    return c.json({
      success: true,
      message: newStatus === 'active' ? 'เปิดรับงานแล้ว' : 'พักรับงานชั่วคราวแล้ว',
      status: newStatus,
      service: updated[0],
    });
  } catch (err) {
    console.error('Toggle service status error:', err);
    return c.json({ success: false, message: 'Failed to toggle status' }, 500);
  }
});

/**
 * 9. POST /api/services/:id/like - กด Like / เลิก Like โพสต์รับงาน
 */
serviceRouter.post('/:id/like', requireAuth, async (c) => {
  try {
    const serviceId = parseInt(c.req.param('id'), 10);
    if (isNaN(serviceId)) {
      return c.json({ success: false, message: 'Invalid service ID' }, 400);
    }

    const user = c.get('user');
    const db = getDrizzle(c);
    const rawSql = getDb(c);

    const existing = await db
      .select({ id: serviceLikes.id })
      .from(serviceLikes)
      .where(and(eq(serviceLikes.serviceId, serviceId), eq(serviceLikes.userId, user.id)))
      .limit(1);

    let isLiked = false;
    if (existing.length > 0) {
      await db.delete(serviceLikes).where(eq(serviceLikes.id, existing[0].id));
      await db
        .update(services)
        .set({
          likesCount: sql`GREATEST(0, ${services.likesCount} - 1)`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(services.id, serviceId));
      isLiked = false;
    } else {
      await db.insert(serviceLikes).values({
        serviceId,
        userId: user.id,
      });
      await db
        .update(services)
        .set({
          likesCount: sql`${services.likesCount} + 1`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(services.id, serviceId));
      isLiked = true;

      // แจ้งเตือนเจ้าของงาน
      const ownerRes = await db
        .select({ userId: services.userId, title: services.title })
        .from(services)
        .where(eq(services.id, serviceId))
        .limit(1);

      if (ownerRes.length > 0 && ownerRes[0].userId !== user.id) {
        createNotification(rawSql, {
          userId: ownerRes[0].userId,
          actorId: user.id,
          type: 'like',
          entityId: serviceId,
          entityType: 'service',
          message: `${user.displayName || user.username} ถูกใจโพสต์รับงานของคุณ: "${ownerRes[0].title}"`,
        }).catch(() => {});
      }
    }

    const updated = await db
      .select({ likesCount: services.likesCount })
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);

    return c.json({
      success: true,
      isLiked,
      likesCount: updated[0]?.likesCount || 0,
    });
  } catch (err) {
    console.error('Like service error:', err);
    return c.json({ success: false, message: 'Failed to like service' }, 500);
  }
});

export default serviceRouter;
