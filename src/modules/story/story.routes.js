import { Hono } from 'hono';
import { getDb } from '../../config/db';
import { requireAuth, optionalAuth } from '../../middleware/auth';

const storyRouter = new Hono();

// Helper: Ensure stories tables exist
let tablesInitialized = false;
async function ensureTables(sql) {
  if (tablesInitialized) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS stories (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_url TEXT NOT NULL,
        media_type VARCHAR(20) DEFAULT 'image',
        caption TEXT,
        views_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours')
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS story_views (
        id SERIAL PRIMARY KEY,
        story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(story_id, user_id)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS story_likes (
        id SERIAL PRIMARY KEY,
        story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(story_id, user_id)
      )
    `;
    tablesInitialized = true;
  } catch (err) {
    console.error('Failed to ensure story tables:', err);
  }
}

/**
 * 1. GET /api/stories - ดึง Stories ที่ยังไม่หมดอายุ (Active ภายใน 24 ชม.) จัดกลุ่มตาม User
 */
storyRouter.get('/', optionalAuth, async (c) => {
  try {
    const sql = getDb(c);
    await ensureTables(sql);
    const currentUser = c.get('user');

    // ดึง stories ย้อนหลัง 24 ชั่วโมง
    const rows = await sql`
      SELECT 
        s.id,
        s.user_id,
        s.media_url,
        s.media_type,
        s.caption,
        s.views_count,
        s.created_at,
        u.username as author_username,
        u."displayName" as author_name,
        u."avatarUrl" as author_avatar,
        u."isVerified" as author_verified,
        ${
          currentUser?.id
            ? sql`EXISTS(SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.user_id = ${currentUser.id}) as is_viewed`
            : sql`false as is_viewed`
        },
        ${
          currentUser?.id
            ? sql`EXISTS(SELECT 1 FROM story_likes sl WHERE sl.story_id = s.id AND sl.user_id = ${currentUser.id}) as is_liked`
            : sql`false as is_liked`
        },
        (SELECT COUNT(*)::int FROM story_likes sl2 WHERE sl2.story_id = s.id) as likes_count
      FROM stories s
      JOIN users u ON s.user_id = u.id
      WHERE s.created_at > (NOW() - INTERVAL '24 hours')
      ORDER BY s.created_at ASC
    `;

    // จัดกลุ่มตาม user_id
    const groupsMap = new Map();

    for (const row of rows) {
      const uid = row.user_id;
      if (!groupsMap.has(uid)) {
        groupsMap.set(uid, {
          user: {
            id: uid,
            username: row.author_username,
            name: row.author_name || row.author_username,
            avatar: row.author_avatar || null,
            isVerified: Boolean(row.author_verified),
          },
          stories: [],
          hasUnviewed: false,
          latestStory: null,
        });
      }

      const group = groupsMap.get(uid);
      const isViewed = Boolean(row.is_viewed);
      if (!isViewed) {
        group.hasUnviewed = true;
      }

      const storyItem = {
        id: row.id,
        userId: row.user_id,
        mediaUrl: row.media_url,
        mediaType: row.media_type || 'image',
        caption: row.caption || '',
        viewsCount: row.views_count || 0,
        likesCount: row.likes_count || 0,
        isLiked: Boolean(row.is_liked),
        isViewed,
        createdAt: row.created_at,
      };

      group.stories.push(storyItem);
      group.latestStory = storyItem;
    }

    // จัดเรียง: User ปัจจุบันอยู่แรกสุด ถ้ามี, ตามด้วย unviewed แล้ว viewed
    const storyGroups = Array.from(groupsMap.values()).sort((a, b) => {
      if (currentUser?.id) {
        if (a.user.id === currentUser.id) return -1;
        if (b.user.id === currentUser.id) return 1;
      }
      if (a.hasUnviewed && !b.hasUnviewed) return -1;
      if (!a.hasUnviewed && b.hasUnviewed) return 1;
      return new Date(b.latestStory?.createdAt || 0) - new Date(a.latestStory?.createdAt || 0);
    });

    return c.json({
      success: true,
      storyGroups,
    });
  } catch (err) {
    console.error('Get stories error:', err);
    return c.json({ success: false, message: 'Failed to fetch stories' }, 500);
  }
});

/**
 * 2. POST /api/stories - สร้าง Story ใหม่ (มีอายุ 24 ชม.)
 */
storyRouter.post('/', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const sql = getDb(c);
    await ensureTables(sql);

    const body = await c.req.json();
    const mediaUrl = body.mediaUrl || body.media_url;
    const mediaType = body.mediaType || body.media_type || 'image';
    const caption = (body.caption || '').trim().slice(0, 300);

    if (!mediaUrl) {
      return c.json({ success: false, message: 'Media URL is required' }, 400);
    }

    const inserted = await sql`
      INSERT INTO stories (user_id, media_url, media_type, caption)
      VALUES (${user.id}, ${mediaUrl}, ${mediaType}, ${caption || null})
      RETURNING *
    `;

    return c.json({
      success: true,
      story: inserted[0],
      message: 'สร้าง Story สำเร็จ',
    }, 201);
  } catch (err) {
    console.error('Create story error:', err);
    return c.json({ success: false, message: 'Failed to create story' }, 500);
  }
});

/**
 * 3. POST /api/stories/:id/view - บันทึกการรับชม Story
 */
storyRouter.post('/:id/view', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const sql = getDb(c);
    await ensureTables(sql);

    const storyId = parseInt(c.req.param('id'), 10);
    if (isNaN(storyId)) {
      return c.json({ success: false, message: 'Invalid story ID' }, 400);
    }

    // บันทึก view (ถ้ายังไม่เคยดู)
    await sql`
      INSERT INTO story_views (story_id, user_id)
      VALUES (${storyId}, ${user.id})
      ON CONFLICT (story_id, user_id) DO NOTHING
    `;

    // เพิ่ม views_count บน story
    await sql`
      UPDATE stories SET views_count = views_count + 1 WHERE id = ${storyId}
    `;

    return c.json({ success: true, message: 'Story viewed' });
  } catch (err) {
    console.error('View story error:', err);
    return c.json({ success: false, message: 'Failed to record story view' }, 500);
  }
});

/**
 * 4. POST /api/stories/:id/like - สลับสถานะ Like บน Story
 */
storyRouter.post('/:id/like', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const sql = getDb(c);
    await ensureTables(sql);

    const storyId = parseInt(c.req.param('id'), 10);
    if (isNaN(storyId)) {
      return c.json({ success: false, message: 'Invalid story ID' }, 400);
    }

    const existing = await sql`
      SELECT 1 FROM story_likes WHERE story_id = ${storyId} AND user_id = ${user.id}
    `;

    let isLiked = false;
    if (existing.length > 0) {
      await sql`
        DELETE FROM story_likes WHERE story_id = ${storyId} AND user_id = ${user.id}
      `;
      isLiked = false;
    } else {
      await sql`
        INSERT INTO story_likes (story_id, user_id) VALUES (${storyId}, ${user.id})
      `;
      isLiked = true;
    }

    const countRes = await sql`
      SELECT COUNT(*)::int as count FROM story_likes WHERE story_id = ${storyId}
    `;

    return c.json({
      success: true,
      isLiked,
      likesCount: countRes[0]?.count || 0,
    });
  } catch (err) {
    console.error('Like story error:', err);
    return c.json({ success: false, message: 'Failed to toggle story like' }, 500);
  }
});

/**
 * 5. DELETE /api/stories/:id - ลบ Story (เฉพาะเจ้าของ)
 */
storyRouter.delete('/:id', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const sql = getDb(c);
    await ensureTables(sql);

    const storyId = parseInt(c.req.param('id'), 10);
    if (isNaN(storyId)) {
      return c.json({ success: false, message: 'Invalid story ID' }, 400);
    }

    const deleted = await sql`
      DELETE FROM stories WHERE id = ${storyId} AND user_id = ${user.id}
      RETURNING id
    `;

    if (deleted.length === 0) {
      return c.json({ success: false, message: 'Story not found or unauthorized' }, 404);
    }

    return c.json({ success: true, message: 'ลบ Story สำเร็จ' });
  } catch (err) {
    console.error('Delete story error:', err);
    return c.json({ success: false, message: 'Failed to delete story' }, 500);
  }
});

export default storyRouter;
