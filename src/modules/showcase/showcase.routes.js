import { Hono } from 'hono';
import { getDb } from '../../config/db';
import { requireAuth, optionalAuth } from '../../middleware/auth';
import { checkImageUrl } from '../../utils/moderation';

const showcaseRouter = new Hono();

/**
 * 1. GET /api/showcases - ดึงรายการผลงาน Showcase ทั้งหมด
 * รองรับ Query Params:
 * - search: ค้นหาจากชื่อผลงาน (title), คำอธิบาย (description), หรือชื่อครีเอเตอร์
 * - username: ดึงเฉพาะผลงานของ user คนนี้
 * - user_id: ดึงเฉพาะผลงานของ user_id นี้
 * - page: หน้าปัจจุบัน (default: 1)
 * - limit: จำนวนต่อหน้า (default: 20)
 */
showcaseRouter.get('/', optionalAuth, async (c) => {
  try {
    const sql = getDb(c);
    const currentUser = c.get('user');

    const search = c.req.query('search')?.trim() || '';
    const username = c.req.query('username')?.trim().toLowerCase() || '';
    const userIdParam = c.req.query('user_id');
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    let targetUserId = userIdParam ? parseInt(userIdParam, 10) : null;
    if (!targetUserId && username) {
      const uRes = await sql`
        SELECT id FROM users WHERE LOWER(username) = ${username} LIMIT 1
      `;
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

    const showcases = await sql`
      SELECT 
        s.*,
        u.username as author_username,
        u."displayName" as author_name,
        u."avatarUrl" as author_avatar,
        ${
          currentUser?.id
            ? sql`EXISTS(SELECT 1 FROM showcase_likes sl WHERE sl.showcase_id = s.id AND sl.user_id = ${currentUser.id}) as is_liked`
            : sql`false as is_liked`
        }
      FROM showcases s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.is_published = true
        ${targetUserId ? sql`AND s.user_id = ${targetUserId}` : sql``}
        ${
          search
            ? sql`AND (s.title ILIKE ${'%' + search + '%'} OR s.description ILIKE ${'%' + search + '%'} OR u."displayName" ILIKE ${'%' + search + '%'} OR u.username ILIKE ${'%' + search + '%'})`
            : sql``
        }
      ORDER BY s."createdAt" DESC
      LIMIT ${limit + 1} OFFSET ${offset}
    `;

    const hasMore = showcases.length > limit;
    const items = hasMore ? showcases.slice(0, limit) : showcases;

    const formatted = items.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description || '',
      mediaUrls: Array.isArray(s.media_urls) ? s.media_urls : [],
      mediaType: s.media_type || 'image',
      coverUrl: s.cover_url || (Array.isArray(s.media_urls) && s.media_urls[0]) || null,
      tags: Array.isArray(s.tags) ? s.tags : [],
      likesCount: s.likes_count || 0,
      viewsCount: s.views_count || 0,
      isLiked: Boolean(s.is_liked),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      author: {
        id: s.user_id,
        name: s.author_name || s.author_username || 'Anonymous',
        username: s.author_username || 'user',
        avatar: s.author_avatar || null,
      },
    }));

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
    return c.json({ success: false, message: 'Failed to fetch showcases' }, 500);
  }
});

/**
 * 2. GET /api/showcases/:id - ดูรายละเอียด Showcase ชิ้นเดียว
 */
showcaseRouter.get('/:id', optionalAuth, async (c) => {
  try {
    const showcaseId = parseInt(c.req.param('id'), 10);
    if (isNaN(showcaseId)) {
      return c.json({ success: false, message: 'Invalid showcase ID' }, 400);
    }

    const sql = getDb(c);
    const currentUser = c.get('user');

    // เพิ่ม views count
    await sql`UPDATE showcases SET views_count = views_count + 1 WHERE id = ${showcaseId}`;

    const rows = await sql`
      SELECT 
        s.*,
        u.username as author_username,
        u."displayName" as author_name,
        u."avatarUrl" as author_avatar,
        ${
          currentUser?.id
            ? sql`EXISTS(SELECT 1 FROM showcase_likes sl WHERE sl.showcase_id = s.id AND sl.user_id = ${currentUser.id}) as is_liked`
            : sql`false as is_liked`
        }
      FROM showcases s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.id = ${showcaseId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return c.json({ success: false, message: 'Showcase not found' }, 404);
    }

    const s = rows[0];
    return c.json({
      success: true,
      showcase: {
        id: s.id,
        title: s.title,
        description: s.description || '',
        mediaUrls: Array.isArray(s.media_urls) ? s.media_urls : [],
        mediaType: s.media_type || 'image',
        coverUrl: s.cover_url || (Array.isArray(s.media_urls) && s.media_urls[0]) || null,
        tags: Array.isArray(s.tags) ? s.tags : [],
        likesCount: s.likes_count || 0,
        viewsCount: s.views_count || 0,
        isLiked: Boolean(s.is_liked),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        author: {
          id: s.user_id,
          name: s.author_name || s.author_username || 'Anonymous',
          username: s.author_username || 'user',
          avatar: s.author_avatar || null,
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
 * Body: { title, description, mediaUrls, mediaType, coverUrl, tags }
 */
showcaseRouter.post('/', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const title = body.title?.trim();
    const description = body.description?.trim() || null;
    
    // รองรับทั้ง camelCase และ snake_case (mediaUrls / media_urls)
    const rawMediaUrls = body.mediaUrls || body.media_urls || [];
    const mediaType = body.mediaType || body.media_type;
    const coverUrl = body.coverUrl || body.cover_url;
    const rawTags = body.tags || [];

    if (!title) {
      return c.json({ success: false, message: 'Title is required for showcase' }, 400);
    }

    let finalMediaUrls = Array.isArray(rawMediaUrls)
      ? rawMediaUrls
      : typeof rawMediaUrls === 'string'
      ? [rawMediaUrls]
      : [];

    if (finalMediaUrls.length === 0 && coverUrl) {
      finalMediaUrls = [coverUrl];
    }

    if (finalMediaUrls.length === 0) {
      return c.json(
        { success: false, message: 'กรุณาอัปโหลดรูปภาพผลงานอย่างน้อย 1 รูป' },
        400
      );
    }

    // ตรวจสอบว่าต้องไม่ใช่ GIF หรือ Video
    for (const imgUrl of finalMediaUrls) {
      if (typeof imgUrl === 'string') {
        const lower = imgUrl.toLowerCase();
        if (
          lower.includes('.gif') ||
          lower.includes('.mp4') ||
          lower.includes('.webm') ||
          lower.includes('.mov')
        ) {
          return c.json(
            {
              success: false,
              message:
                'ระบบรองรับเฉพาะรูปภาพนิ่ง (JPG, PNG, WebP) เท่านั้น ไม่อนุญาต GIF หรือวิดีโอ',
            },
            400
          );
        }

        // ตรวจสอบความปลอดภัยของภาพผ่าน Sightengine (อนาจาร, อาวุธ, ความรุนแรง/เลือด)
        if (lower.startsWith('http')) {
          const check = await checkImageUrl(imgUrl, c.env);
          if (!check.isSafe) {
            return c.json(
              {
                success: false,
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

    const sql = getDb(c);
    const inserted = await sql`
      INSERT INTO showcases (
        user_id,
        title,
        description,
        media_urls,
        media_type,
        cover_url,
        tags,
        likes_count,
        views_count,
        is_published,
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${user.id},
        ${title},
        ${description},
        ${JSON.stringify(finalMediaUrls)}::jsonb,
        ${finalMediaType},
        ${finalCoverUrl},
        ${JSON.stringify(finalTags)}::jsonb,
        0,
        0,
        true,
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    const s = inserted[0];

    return c.json(
      {
        success: true,
        message: 'Showcase created successfully',
        showcase: {
          id: s.id,
          title: s.title,
          description: s.description || '',
          mediaUrls: finalMediaUrls,
          mediaType: s.media_type,
          coverUrl: s.cover_url,
          tags: finalTags,
          likesCount: 0,
          viewsCount: 0,
          isLiked: false,
          createdAt: s.createdAt,
          author: {
            id: user.id,
            name: user.displayName || user.username,
            username: user.username,
            avatar: user.avatarUrl || null,
          },
        },
      },
      201
    );
  } catch (err) {
    console.error('Create showcase error:', err);
    return c.json({ success: false, message: err.message || 'Failed to create showcase' }, 500);
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
    const sql = getDb(c);

    // ตรวจสอบว่าเคยกด Like หรือยัง
    const existing = await sql`
      SELECT id FROM showcase_likes 
      WHERE showcase_id = ${showcaseId} AND user_id = ${user.id}
      LIMIT 1
    `;

    let isLiked = false;
    if (existing.length > 0) {
      // ยกเลิก Like
      await sql`DELETE FROM showcase_likes WHERE id = ${existing[0].id}`;
      await sql`
        UPDATE showcases 
        SET likes_count = GREATEST(0, likes_count - 1), "updatedAt" = NOW() 
        WHERE id = ${showcaseId}
      `;
      isLiked = false;
    } else {
      // กด Like
      await sql`
        INSERT INTO showcase_likes (showcase_id, user_id, "createdAt")
        VALUES (${showcaseId}, ${user.id}, NOW())
      `;
      await sql`
        UPDATE showcases 
        SET likes_count = likes_count + 1, "updatedAt" = NOW() 
        WHERE id = ${showcaseId}
      `;
      isLiked = true;
    }

    // ดึงจำนวน Like ล่าสุด
    const current = await sql`
      SELECT likes_count FROM showcases WHERE id = ${showcaseId} LIMIT 1
    `;

    return c.json({
      success: true,
      liked: isLiked,
      likesCount: current[0]?.likes_count || 0,
    });
  } catch (err) {
    console.error('Toggle showcase like error:', err);
    return c.json({ success: false, message: 'Failed to toggle like' }, 500);
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
    const sql = getDb(c);

    // ตรวจสอบว่าเป็นเจ้าของผลงานหรือไม่
    const existing = await sql`
      SELECT user_id FROM showcases WHERE id = ${showcaseId} LIMIT 1
    `;

    if (existing.length === 0) {
      return c.json({ success: false, message: 'Showcase not found' }, 404);
    }

    if (existing[0].user_id !== user.id) {
      return c.json({ success: false, message: 'Forbidden: You do not own this showcase' }, 403);
    }

    await sql`DELETE FROM showcases WHERE id = ${showcaseId}`;

    return c.json({ success: true, message: 'Showcase deleted successfully' });
  } catch (err) {
    console.error('Delete showcase error:', err);
    return c.json({ success: false, message: 'Failed to delete showcase' }, 500);
  }
});

export default showcaseRouter;

