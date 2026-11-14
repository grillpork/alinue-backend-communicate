import { Hono } from 'hono';
import { getDrizzle } from '../../config/db.js';
import { notifications, users, posts, showcases } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { eq, and, inArray, desc, count, sql } from 'drizzle-orm';

const notificationRouter = new Hono();

/**
 * 1. GET /api/notifications - ดึงรายการแจ้งเตือนของผู้ใช้
 * Query: filter = all | follows | replies | likes | showcase, page = 1, limit = 20
 */
notificationRouter.get('/', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const db = getDrizzle(c);

    const filter = c.req.query('filter') || 'all';
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    // เงื่อนไข Filter
    const conditions = [eq(notifications.userId, user.id)];
    if (filter === 'follows') {
      conditions.push(eq(notifications.type, 'follow'));
    } else if (filter === 'replies') {
      conditions.push(inArray(notifications.type, ['comment', 'mention']));
    } else if (filter === 'likes') {
      conditions.push(inArray(notifications.type, ['like', 'showcase_like']));
    } else if (filter === 'showcase') {
      conditions.push(eq(notifications.entityType, 'showcase'));
    }

    const whereClause = and(...conditions);

    // ดึงข้อมูลแจ้งเตือนพร้อม Actor, Post, และ Showcase
    const notifList = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        actorId: notifications.actorId,
        type: notifications.type,
        entityId: notifications.entityId,
        entityType: notifications.entityType,
        message: notifications.message,
        isRead: notifications.isRead,
        createdAt: notifications.createdAt,
        actorUsername: users.username,
        actorName: users.displayName,
        actorAvatar: users.avatarUrl,
        postCaption: posts.caption,
        postMedia: posts.mediaUrls,
        showcaseTitle: showcases.title,
        showcaseCover: showcases.coverUrl,
        showcaseMedia: showcases.mediaUrls,
        isActorFollowing: sql`EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${user.id} AND f.following_id = ${notifications.actorId})`,
      })
      .from(notifications)
      .innerJoin(users, eq(notifications.actorId, users.id))
      .leftJoin(posts, and(eq(notifications.entityType, 'post'), eq(notifications.entityId, posts.id)))
      .leftJoin(showcases, and(eq(notifications.entityType, 'showcase'), eq(notifications.entityId, showcases.id)))
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    // นับจำนวน Unread ทั้งหมด
    const unreadRes = await db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));
    const unreadCount = Number(unreadRes[0]?.count || 0);

    // นับจำนวนทั้งหมดตาม filter
    const totalRes = await db
      .select({ count: count() })
      .from(notifications)
      .where(whereClause);
    const totalCount = Number(totalRes[0]?.count || 0);

    const formatted = notifList.map((n) => {
      // ดึง Thumbnail รูปภาพของโพสต์ (ถ้ามี)
      let postThumbnail = null;
      if (Array.isArray(n.postMedia) && n.postMedia.length > 0) {
        postThumbnail = typeof n.postMedia[0] === 'string' ? n.postMedia[0] : n.postMedia[0]?.url;
      }

      // ดึง Thumbnail รูปภาพของ Showcase (ถ้ามี)
      let showcaseThumbnail = n.showcaseCover;
      if (!showcaseThumbnail && Array.isArray(n.showcaseMedia) && n.showcaseMedia.length > 0) {
        showcaseThumbnail = typeof n.showcaseMedia[0] === 'string' ? n.showcaseMedia[0] : n.showcaseMedia[0]?.url;
      }

      return {
        id: n.id,
        type: n.type,
        isRead: Boolean(n.isRead),
        createdAt: n.createdAt,
        message: n.message,
        entityId: n.entityId,
        entityType: n.entityType,
        actor: {
          id: n.actorId,
          name: n.actorName || n.actorUsername || 'User',
          username: n.actorUsername,
          avatar: n.actorAvatar || null,
          isFollowing: Boolean(n.isActorFollowing),
        },
        post: n.postCaption !== undefined && n.entityType === 'post' ? {
          id: n.entityId,
          caption: n.postCaption,
          thumbnail: postThumbnail,
        } : null,
        showcase: n.showcaseTitle !== undefined && n.entityType === 'showcase' ? {
          id: n.entityId,
          title: n.showcaseTitle,
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
    const db = getDrizzle(c);

    const res = await db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));

    return c.json({
      success: true,
      unreadCount: Number(res[0]?.count || 0),
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
    const db = getDrizzle(c);

    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));

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
    const db = getDrizzle(c);

    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, notifId), eq(notifications.userId, user.id)));

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
    const db = getDrizzle(c);

    await db
      .delete(notifications)
      .where(and(eq(notifications.id, notifId), eq(notifications.userId, user.id)));

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
