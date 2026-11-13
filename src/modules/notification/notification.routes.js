import { Hono } from 'hono';
import { getDb } from '../../config/db';
import { requireAuth } from '../../middleware/auth';

const notificationRouter = new Hono();

/**
 * 1. GET /api/notifications - ดึงรายการแจ้งเตือนของผู้ใช้
 * Query: filter = all | follows | replies | likes | showcase, page = 1, limit = 20
 */
notificationRouter.get('/', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const sql = getDb(c);

    const filter = c.req.query('filter') || 'all';
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    // เงื่อนไข Filter
    let filterCondition = sql``;
    if (filter === 'follows') {
      filterCondition = sql`AND n.type = 'follow'`;
    } else if (filter === 'replies') {
      filterCondition = sql`AND n.type IN ('comment', 'mention')`;
    } else if (filter === 'likes') {
      filterCondition = sql`AND n.type IN ('like', 'showcase_like')`;
    } else if (filter === 'showcase') {
      filterCondition = sql`AND n.entity_type = 'showcase'`;
    }

    // ดึงข้อมูลแจ้งเตือนพร้อม Actor, Post, และ Showcase
    const notifications = await sql`
      SELECT 
        n.id,
        n.user_id,
        n.actor_id,
        n.type,
        n.entity_id,
        n.entity_type,
        n.message,
        n.is_read,
        n."createdAt",
        u.username as actor_username,
        u."displayName" as actor_name,
        u."avatarUrl" as actor_avatar,
        p.caption as post_caption,
        p.media_urls as post_media,
        s.title as showcase_title,
        s.cover_url as showcase_cover,
        s.media_urls as showcase_media,
        EXISTS(
          SELECT 1 FROM follows f 
          WHERE f.follower_id = ${user.id} AND f.following_id = n.actor_id
        ) as is_actor_following
      FROM notifications n
      JOIN users u ON n.actor_id = u.id
      LEFT JOIN posts p ON (n.entity_type = 'post' AND n.entity_id = p.id)
      LEFT JOIN showcases s ON (n.entity_type = 'showcase' AND n.entity_id = s.id)
      WHERE n.user_id = ${user.id}
      ${filterCondition}
      ORDER BY n."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // นับจำนวน Unread ทั้งหมด
    const unreadRes = await sql`
      SELECT COUNT(*)::int as count 
      FROM notifications 
      WHERE user_id = ${user.id} AND is_read = false
    `;
    const unreadCount = unreadRes[0]?.count || 0;

    // นับจำนวนทั้งหมดตาม filter
    const totalRes = await sql`
      SELECT COUNT(*)::int as count 
      FROM notifications n
      WHERE n.user_id = ${user.id}
      ${filterCondition}
    `;
    const totalCount = totalRes[0]?.count || 0;

    const formatted = notifications.map((n) => {
      // ดึง Thumbnail รูปภาพของโพสต์ (ถ้ามี)
      let postThumbnail = null;
      if (Array.isArray(n.post_media) && n.post_media.length > 0) {
        postThumbnail = typeof n.post_media[0] === 'string' ? n.post_media[0] : n.post_media[0]?.url;
      }

      // ดึง Thumbnail รูปภาพของ Showcase (ถ้ามี)
      let showcaseThumbnail = n.showcase_cover;
      if (!showcaseThumbnail && Array.isArray(n.showcase_media) && n.showcase_media.length > 0) {
        showcaseThumbnail = typeof n.showcase_media[0] === 'string' ? n.showcase_media[0] : n.showcase_media[0]?.url;
      }

      return {
        id: n.id,
        type: n.type,
        isRead: Boolean(n.is_read),
        createdAt: n.createdAt,
        message: n.message,
        entityId: n.entity_id,
        entityType: n.entity_type,
        actor: {
          id: n.actor_id,
          name: n.actor_name || n.actor_username || 'User',
          username: n.actor_username,
          avatar: n.actor_avatar || null,
          isFollowing: Boolean(n.is_actor_following),
        },
        post: n.post_caption !== undefined && n.entity_type === 'post' ? {
          id: n.entity_id,
          caption: n.post_caption,
          thumbnail: postThumbnail,
        } : null,
        showcase: n.showcase_title !== undefined && n.entity_type === 'showcase' ? {
          id: n.entity_id,
          title: n.showcase_title,
          coverUrl: showcaseThumbnail,
        } : null,
      };
    });

    return c.json({
      success: true,
      notifications: formatted,
      unreadCount,
      pagination: {
        page,
        limit,
        total: totalCount,
        hasMore: offset + limit < totalCount,
      },
    });
  } catch (err) {
    console.error('Get notifications error:', err);
    return c.json({ success: false, message: 'Failed to fetch notifications' }, 500);
  }
});

/**
 * 2. GET /api/notifications/unread-count - ดึงจำนวนแจ้งเตือนที่ยังไม่ได้อ่าน
 */
notificationRouter.get('/unread-count', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const sql = getDb(c);

    const res = await sql`
      SELECT COUNT(*)::int as count 
      FROM notifications 
      WHERE user_id = ${user.id} AND is_read = false
    `;

    return c.json({
      success: true,
      unreadCount: res[0]?.count || 0,
    });
  } catch (err) {
    console.error('Get unread count error:', err);
    return c.json({ success: false, message: 'Failed to get unread count' }, 500);
  }
});

/**
 * 3. PATCH /api/notifications/read-all - ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
 */
notificationRouter.patch('/read-all', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const sql = getDb(c);

    await sql`
      UPDATE notifications 
      SET is_read = true 
      WHERE user_id = ${user.id} AND is_read = false
    `;

    return c.json({
      success: true,
      message: 'All notifications marked as read',
    });
  } catch (err) {
    console.error('Mark all read error:', err);
    return c.json({ success: false, message: 'Failed to mark all as read' }, 500);
  }
});

/**
 * 4. PATCH /api/notifications/:id/read - ทำเครื่องหมายว่าอ่านแล้วเฉพาะรายการนี้
 */
notificationRouter.patch('/:id/read', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const notifId = parseInt(c.req.param('id'), 10);
    const sql = getDb(c);

    await sql`
      UPDATE notifications 
      SET is_read = true 
      WHERE id = ${notifId} AND user_id = ${user.id}
    `;

    return c.json({
      success: true,
      message: 'Notification marked as read',
    });
  } catch (err) {
    console.error('Mark notification read error:', err);
    return c.json({ success: false, message: 'Failed to mark as read' }, 500);
  }
});

/**
 * 5. DELETE /api/notifications/:id - ลบการแจ้งเตือน
 */
notificationRouter.delete('/:id', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const notifId = parseInt(c.req.param('id'), 10);
    const sql = getDb(c);

    await sql`
      DELETE FROM notifications 
      WHERE id = ${notifId} AND user_id = ${user.id}
    `;

    return c.json({
      success: true,
      message: 'Notification deleted',
    });
  } catch (err) {
    console.error('Delete notification error:', err);
    return c.json({ success: false, message: 'Failed to delete notification' }, 500);
  }
});

export default notificationRouter;
