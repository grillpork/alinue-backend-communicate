import { Hono } from 'hono';
import { getDrizzle, getDb } from '../../config/db.js';
import { showcases, showcaseLikes, users, searchLogs } from '../../db/schema.js';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import {
  checkImageUrl,
  deleteFromR2,
  checkUserTimeoutStatus,
  recordModerationViolation,
  getClientIp,
} from '../../utils/moderation.js';
import { createNotification } from '../notification/notification.service.js';
import { eq, and, or, ilike, sql, desc } from 'drizzle-orm';

const showcaseRouter = new Hono();

/**
 * 1. GET /api/showcases - ดึงรายการผลงาน Showcase ทั้งหมด
 */
showcaseRouter.get('/', optionalAuth, async (c) => {
  try {
    const db = getDrizzle(c);
    const currentUser = c.get('user');

    const search = c.req.query('search')?.trim() || '';
    const username = c.req.query('username')?.trim().toLowerCase() || '';
    const userIdParam = c.req.query('user_id');
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
          showcases: [],
          pagination: { page, limit, hasMore: false },
        });
      }
    }

    const conditions = [eq(showcases.isPublished, true)];
    if (targetUserId) {
      conditions.push(eq(showcases.userId, targetUserId));
    }
    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          ilike(showcases.title, searchPattern),
          ilike(showcases.description, searchPattern),
          ilike(users.displayName, searchPattern),
          ilike(users.username, searchPattern)
        )
      );
    }

    const items = await db
      .select({
        id: showcases.id,
        userId: showcases.userId,
        title: showcases.title,
        description: showcases.description,
        mediaUrls: showcases.mediaUrls,
        mediaType: showcases.mediaType,
        coverUrl: showcases.coverUrl,
        tags: showcases.tags,
        likesCount: showcases.likesCount,
        viewsCount: showcases.viewsCount,
        createdAt: showcases.createdAt,
        updatedAt: showcases.updatedAt,
        authorUsername: users.username,
        authorName: users.displayName,
        authorAvatar: users.avatarUrl,
        isLiked: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM showcase_likes sl WHERE sl.showcase_id = ${showcases.id} AND sl.user_id = ${currentUser.id})`
          : sql`false`,
      })
      .from(showcases)
      .leftJoin(users, eq(showcases.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(showcases.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;

    const formatted = resultItems.map((s) => ({
      id: s.id,
      userId: s.userId,
      title: s.title,
      description: s.description || '',
      mediaUrls: Array.isArray(s.mediaUrls) ? s.mediaUrls : [],
      mediaType: s.mediaType || 'image',
      coverUrl: s.coverUrl || (Array.isArray(s.mediaUrls) && s.mediaUrls[0]) || null,
      tags: Array.isArray(s.tags) ? s.tags : [],
      likesCount: s.likesCount || 0,
      viewsCount: s.viewsCount || 0,
      isLiked: Boolean(s.isLiked),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      author: {
        id: s.userId,
        name: s.authorName || s.authorUsername || 'Anonymous',
        username: s.authorUsername || 'user',
        avatar: s.authorAvatar || null,
      },
    }));

    // บันทึกประวัติการค้นหาถ้ามีการค้นหา showcase
    if (search && search.trim()) {
      try {
        const ipAddress = getClientIp(c);
        db.insert(searchLogs)
          .values({
            query: search.trim(),
            userId: currentUser?.id || null,
            searchType: 'showcases',
            resultCount: formatted.length,
            ipAddress,
          })
          .catch(() => {});
      } catch {}
    }

    return c.json({
      success: true,
      showcases: formatted,
      pagination: {
        page,
        limit,
        hasMore,
      },
    });
  } catch (err) {
    console.error('Get showcases error:', err);
    return c.json({
      success: false,
      message: 'Failed to fetch showcases',
      error: err?.message,
      cause: String(err?.cause?.message || err?.cause || err?.sourceError || ''),
    }, 500);
  }
});

/**
 * 2. GET /api/showcases/:id - ดึงรายละเอียดผลงานเดี่ยว
 */
showcaseRouter.get('/:id', optionalAuth, async (c) => {
  try {
    const showcaseId = parseInt(c.req.param('id'), 10);
    if (isNaN(showcaseId)) {
      return c.json({ success: false, message: 'Invalid showcase ID' }, 400);
    }

    const db = getDrizzle(c);
    const currentUser = c.get('user');

    // เพิ่ม views count
    await db
      .update(showcases)
      .set({ viewsCount: sql`${showcases.viewsCount} + 1` })
      .where(eq(showcases.id, showcaseId));

    const rows = await db
      .select({
        id: showcases.id,
        userId: showcases.userId,
        title: showcases.title,
        description: showcases.description,
        mediaUrls: showcases.mediaUrls,
        mediaType: showcases.mediaType,
        coverUrl: showcases.coverUrl,
        tags: showcases.tags,
        likesCount: showcases.likesCount,
        viewsCount: showcases.viewsCount,
        createdAt: showcases.createdAt,
        updatedAt: showcases.updatedAt,
        authorUsername: users.username,
        authorName: users.displayName,
        authorAvatar: users.avatarUrl,
        isLiked: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM showcase_likes sl WHERE sl.showcase_id = ${showcases.id} AND sl.user_id = ${currentUser.id})`
          : sql`false`,
      })
      .from(showcases)
      .leftJoin(users, eq(showcases.userId, users.id))
      .where(eq(showcases.id, showcaseId))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ success: false, message: 'Showcase not found' }, 404);
    }

    const s = rows[0];
    return c.json({
      success: true,
      showcase: {
        id: s.id,
        userId: s.userId,
        title: s.title,
        description: s.description || '',
        mediaUrls: Array.isArray(s.mediaUrls) ? s.mediaUrls : [],
        mediaType: s.mediaType || 'image',
        coverUrl: s.coverUrl || (Array.isArray(s.mediaUrls) && s.mediaUrls[0]) || null,
        tags: Array.isArray(s.tags) ? s.tags : [],
        likesCount: s.likesCount || 0,
        viewsCount: s.viewsCount || 0,
        isLiked: Boolean(s.isLiked),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        author: {
          id: s.userId,
          name: s.authorName || s.authorUsername || 'Anonymous',
          username: s.authorUsername || 'user',
          avatar: s.authorAvatar || null,
        },
      },
    });
  } catch (err) {
    console.error('Get showcase error:', err);
    return c.json({ success: false, message: 'Failed to fetch showcase' }, 500);
  }
});

/**
 * 3. POST /api/showcases - สร้าง Showcase ผลงานใหม่
 */
showcaseRouter.post('/', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const rawSql = getDb(c);
    const db = getDrizzle(c);
    const ipAddress = getClientIp(c);

    // Tier 3: ตรวจสอบสถานะ Timeout / Rate Limit ก่อนสร้าง Showcase
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
      mediaUrls = [],
      mediaType = 'image',
      coverUrl = null,
      tags: rawTags = [],
    } = body;

    if (!title || !title.trim()) {
      return c.json({ success: false, message: 'Title is required' }, 400);
    }

    const finalMediaUrls = Array.isArray(mediaUrls)
      ? mediaUrls.filter((url) => typeof url === 'string' && url.trim().length > 0)
      : [];

    if (finalMediaUrls.length === 0 && !coverUrl) {
      return c.json({ success: false, message: 'At least one media URL or cover is required' }, 400);
    }

    // ตรวจสอบความปลอดภัยของรูปภาพทั้งหมดก่อนบันทึก
    const urlsToCheck = Array.from(new Set([...finalMediaUrls, coverUrl].filter(Boolean)));
    const r2Config = {
      accountId: c.env.R2_ACCOUNT_ID,
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      bucketName: c.env.R2_BUCKET_NAME || 'cats-coworker',
      publicUrl: c.env.R2_PUBLIC_URL || 'https://pub-6d43351c06b34d6c91ecef3d7be6d4c3.r2.dev',
    };

    for (const imgUrl of urlsToCheck) {
      const isOurR2Image = imgUrl.includes(r2Config.publicUrl) || imgUrl.includes('.r2.dev');
      if (isOurR2Image) {
        const check = await checkImageUrl(imgUrl, c.env);
        if (!check.isSafe) {
          // ลบไฟล์ที่ไม่ปลอดภัยออกจาก R2 ทันที
          const fileKey = imgUrl.replace(`${r2Config.publicUrl}/`, '').replace(/^https?:\/\/[^/]+\//, '');
          if (fileKey) {
            await deleteFromR2(fileKey, r2Config);
          }

          // บันทึกประวัติการละเมิด
          const viol = await recordModerationViolation(rawSql, {
            userId: user.id,
            ipAddress,
            fileKey,
            imageUrl: imgUrl,
            reasons: check.reasons,
            scores: check.scores,
          });

          if (viol?.action === 'timeout') {
            return c.json(
              {
                success: false,
                isTimedOut: true,
                action: 'timeout',
                message: viol.message,
                reasons: check.reasons,
                scores: check.scores,
                retryAfterSeconds: viol.retryAfterSeconds,
                timeoutExpiresAt: viol.timeoutExpiresAt,
              },
              429
            );
          } else {
            return c.json(
              {
                success: false,
                isBlocked: true,
                action: 'blocked',
                logId: viol?.logRecord?.id || null,
                imageUrl: imgUrl,
                message: `ไม่สามารถบันทึกผลงานได้เนื่องจากรูปภาพไม่เหมาะสม: ${check.reasons.join(', ')}`,
                reasons: check.reasons,
                scores: check.scores,
              },
              400
            );
          }
        }
      }
    }

    const finalMediaType = 'image';
    const finalCoverUrl = coverUrl || finalMediaUrls[0] || null;
    const finalTags = Array.isArray(rawTags) ? rawTags : [];

    const inserted = await db
      .insert(showcases)
      .values({
        userId: user.id,
        title,
        description,
        mediaUrls: finalMediaUrls,
        mediaType: finalMediaType,
        coverUrl: finalCoverUrl,
        tags: finalTags,
        likesCount: 0,
        viewsCount: 0,
        isPublished: true,
      })
      .returning();

    const s = inserted[0];

    return c.json(
      {
        success: true,
        showcase: {
          id: s.id,
          title: s.title,
          description: s.description || '',
          mediaUrls: Array.isArray(s.mediaUrls) ? s.mediaUrls : [],
          mediaType: s.mediaType || 'image',
          coverUrl: s.coverUrl,
          tags: Array.isArray(s.tags) ? s.tags : [],
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
    console.error('Create showcase error:', err);
    return c.json({ success: false, message: 'Failed to create showcase' }, 500);
  }
});

/**
 * 4. POST /api/showcases/:id/like - กด Like หรือ ยกเลิก Like ผลงาน
 */
showcaseRouter.post('/:id/like', requireAuth, async (c) => {
  try {
    const showcaseId = parseInt(c.req.param('id'), 10);
    if (isNaN(showcaseId)) {
      return c.json({ success: false, message: 'Invalid showcase ID' }, 400);
    }

    const user = c.get('user');
    const db = getDrizzle(c);

    // ตรวจสอบว่าเคยกด Like หรือยัง
    const existing = await db
      .select({ id: showcaseLikes.id })
      .from(showcaseLikes)
      .where(and(eq(showcaseLikes.showcaseId, showcaseId), eq(showcaseLikes.userId, user.id)))
      .limit(1);

    let isLiked = false;
    if (existing.length > 0) {
      // ยกเลิก Like
      await db.delete(showcaseLikes).where(eq(showcaseLikes.id, existing[0].id));
      await db
        .update(showcases)
        .set({
          likesCount: sql`GREATEST(0, ${showcases.likesCount} - 1)`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(showcases.id, showcaseId));
      isLiked = false;
    } else {
      // กด Like
      await db.insert(showcaseLikes).values({
        showcaseId,
        userId: user.id,
      });
      await db
        .update(showcases)
        .set({
          likesCount: sql`${showcases.likesCount} + 1`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(showcases.id, showcaseId));
      isLiked = true;

      // สร้างการแจ้งเตือน Like Showcase
      const scOwnerRes = await db
        .select({ userId: showcases.userId, title: showcases.title })
        .from(showcases)
        .where(eq(showcases.id, showcaseId))
        .limit(1);

      if (scOwnerRes.length > 0) {
        await createNotification(db, {
          userId: scOwnerRes[0].userId,
          actorId: user.id,
          type: 'showcase_like',
          entityId: showcaseId,
          entityType: 'showcase',
          message: scOwnerRes[0].title || null,
        });
      }
    }

    // ดึงจำนวน Like ล่าสุด
    const current = await db
      .select({ likesCount: showcases.likesCount })
      .from(showcases)
      .where(eq(showcases.id, showcaseId))
      .limit(1);

    return c.json({
      success: true,
      liked: isLiked,
      likesCount: current[0]?.likesCount || 0,
    });
  } catch (err) {
    console.error('Toggle showcase like error:', err);
    return c.json({ success: false, message: 'Failed to toggle like' }, 500);
  }
});

/**
 * 4.1 PUT /api/showcases/:id - แก้ไขผลงาน Showcase
 */
showcaseRouter.put('/:id', requireAuth, async (c) => {
  try {
    const showcaseId = parseInt(c.req.param('id'), 10);
    if (isNaN(showcaseId)) {
      return c.json({ success: false, message: 'Invalid showcase ID' }, 400);
    }

    const user = c.get('user');
    const db = getDrizzle(c);

    // ตรวจสอบว่าเป็นเจ้าของผลงานหรือไม่
    const existing = await db
      .select()
      .from(showcases)
      .where(eq(showcases.id, showcaseId))
      .limit(1);

    if (existing.length === 0) {
      return c.json({ success: false, message: 'Showcase not found' }, 404);
    }

    if (existing[0].userId !== user.id) {
      return c.json({ success: false, message: 'Forbidden: You do not own this showcase' }, 403);
    }

    const body = await c.req.json();
    const {
      title,
      description,
      mediaUrls,
      media_urls,
      mediaType,
      media_type,
      coverUrl,
      cover_url,
      tags,
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
    const finalMediaUrls = mediaUrls || media_urls;
    if (finalMediaUrls !== undefined && Array.isArray(finalMediaUrls)) {
      updateData.mediaUrls = finalMediaUrls;
    }
    const finalMediaType = mediaType || media_type;
    if (finalMediaType !== undefined) {
      updateData.mediaType = finalMediaType;
    }
    const finalCoverUrl = coverUrl !== undefined ? coverUrl : cover_url;
    if (finalCoverUrl !== undefined) {
      updateData.coverUrl = finalCoverUrl;
    }
    if (tags !== undefined && Array.isArray(tags)) {
      updateData.tags = tags.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean);
    }

    const updated = await db
      .update(showcases)
      .set(updateData)
      .where(eq(showcases.id, showcaseId))
      .returning();

    const s = updated[0];

    return c.json({
      success: true,
      message: 'Showcase updated successfully',
      showcase: {
        id: s.id,
        userId: s.userId,
        title: s.title,
        description: s.description || '',
        mediaUrls: Array.isArray(s.mediaUrls) ? s.mediaUrls : [],
        mediaType: s.mediaType || 'image',
        coverUrl: s.coverUrl,
        tags: Array.isArray(s.tags) ? s.tags : [],
        likesCount: s.likesCount || 0,
        viewsCount: s.viewsCount || 0,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      },
    });
  } catch (err) {
    console.error('Update showcase error:', err);
    return c.json({ success: false, message: 'Failed to update showcase' }, 500);
  }
});

/**
 * 5. DELETE /api/showcases/:id - ลบผลงาน Showcase
 */
showcaseRouter.delete('/:id', requireAuth, async (c) => {
  try {
    const showcaseId = parseInt(c.req.param('id'), 10);
    if (isNaN(showcaseId)) {
      return c.json({ success: false, message: 'Invalid showcase ID' }, 400);
    }

    const user = c.get('user');
    const db = getDrizzle(c);

    // ตรวจสอบว่าเป็นเจ้าของผลงานหรือไม่
    const existing = await db
      .select({ userId: showcases.userId })
      .from(showcases)
      .where(eq(showcases.id, showcaseId))
      .limit(1);

    if (existing.length === 0) {
      return c.json({ success: false, message: 'Showcase not found' }, 404);
    }

    if (existing[0].userId !== user.id) {
      return c.json({ success: false, message: 'Forbidden: You do not own this showcase' }, 403);
    }

    await db.delete(showcases).where(eq(showcases.id, showcaseId));

    return c.json({ success: true, message: 'Showcase deleted successfully' });
  } catch (err) {
    console.error('Delete showcase error:', err);
    return c.json({ success: false, message: 'Failed to delete showcase' }, 500);
  }
});

export default showcaseRouter;
