import { Hono } from 'hono';
import { getDrizzle } from '../../config/db.js';
import { users, follows, posts, postLikes, showcases, searchLogs } from '../../db/schema.js';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { createNotification } from '../notification/notification.service.js';
import { eq, ne, and, or, ilike, sql, desc, count } from 'drizzle-orm';

const userRouter = new Hono();

/**
 * 1. GET /api/users/suggested - ดึงรายชื่อครีเอเตอร์แนะนำสำหรับ Widget 'Suggested Creators'
 */
userRouter.get('/suggested', optionalAuth, async (c) => {
  try {
    const db = getDrizzle(c);
    const currentUser = c.get('user');

    const userList = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        location: users.location,
        isFollowing: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${currentUser.id} AND f.following_id = ${users.id})`
          : sql`false`,
      })
      .from(users)
      .where(ne(users.id, currentUser?.id || 0))
      .orderBy(desc(users.id))
      .limit(5);

    const formatted = userList.map((u) => ({
      id: u.id,
      name: u.displayName || u.username,
      username: u.username,
      avatar: u.avatarUrl || null,
      role: u.bio || 'Product Designer',
      location: u.location,
      isFollowing: Boolean(u.isFollowing),
    }));

    return c.json({
      success: true,
      creators: formatted,
    });
  } catch (err) {
    console.error('Get suggested creators error:', err);
    return c.json({ success: false, message: 'Server error', error: err?.message }, 500);
  }
});

/**
 * 2. GET /api/users/search - ค้นหาครีเอเตอร์ / ดีไซเนอร์ตามชื่อหรือ Username
 */
userRouter.get('/search', optionalAuth, async (c) => {
  try {
    const q = (c.req.query('q') || '').trim();
    if (!q) {
      return c.json({ success: true, users: [] });
    }
    const db = getDrizzle(c);
    const currentUser = c.get('user');
    const searchPattern = `%${q}%`;

    const userList = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        isFollowing: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${currentUser.id} AND f.following_id = ${users.id})`
          : sql`false`,
      })
      .from(users)
      .where(
        or(
          ilike(users.username, searchPattern),
          ilike(users.displayName, searchPattern),
          ilike(users.bio, searchPattern)
        )
      )
      .limit(8);

    const formatted = userList.map((u) => ({
      id: u.id,
      name: u.displayName || u.username,
      username: u.username,
      avatar: u.avatarUrl || '',
      bio: u.bio || '',
      isFollowing: Boolean(u.isFollowing),
    }));

    // บันทึกประวัติการค้นหาลง search_logs
    try {
      const ipAddress =
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        '127.0.0.1';
      db.insert(searchLogs)
        .values({
          query: q,
          userId: currentUser?.id || null,
          searchType: 'users',
          resultCount: formatted.length,
          ipAddress,
        })
        .catch((e) => console.error('Error logging user search:', e));
    } catch {}

    return c.json({ success: true, users: formatted });
  } catch (err) {
    console.error('Search users error:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

/**
 * 2.1 GET /api/users/search/history - ดึงประวัติการค้นหาล่าสุดของผู้ใช้ที่ล็อกอิน
 */
userRouter.get('/search/history', requireAuth, async (c) => {
  try {
    const currentUser = c.get('user');
    const db = getDrizzle(c);

    const history = await db
      .select({
        id: searchLogs.id,
        query: searchLogs.query,
        searchType: searchLogs.searchType,
        resultCount: searchLogs.resultCount,
        createdAt: searchLogs.createdAt,
      })
      .from(searchLogs)
      .where(eq(searchLogs.userId, currentUser.id))
      .orderBy(desc(searchLogs.createdAt))
      .limit(15);

    return c.json({ success: true, history });
  } catch (err) {
    console.error('Get search history error:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

/**
 * 2.2 DELETE /api/users/search/history - ล้างประวัติการค้นหาของผู้ใช้
 */
userRouter.delete('/search/history', requireAuth, async (c) => {
  try {
    const currentUser = c.get('user');
    const db = getDrizzle(c);

    await db.delete(searchLogs).where(eq(searchLogs.userId, currentUser.id));

    return c.json({ success: true, message: 'Search history cleared' });
  } catch (err) {
    console.error('Clear search history error:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

/**
 * 2.3 GET /api/users/search/trending - ดึงคำค้นหายอดนิยม
 */
userRouter.get('/search/trending', optionalAuth, async (c) => {
  try {
    const db = getDrizzle(c);

    const trending = await db
      .select({
        query: searchLogs.query,
        count: count(searchLogs.id),
      })
      .from(searchLogs)
      .groupBy(searchLogs.query)
      .orderBy(desc(count(searchLogs.id)))
      .limit(10);

    return c.json({ success: true, trending: trending.map((t) => t.query) });
  } catch (err) {
    console.error('Get trending search error:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

/**
 * 3. GET /api/users/profile/:username - ดึงข้อมูลโปรไฟล์สาธารณะตาม Username
 */
userRouter.get('/profile/:username', optionalAuth, async (c) => {
  try {
    const username = c.req.param('username').trim().toLowerCase();
    const db = getDrizzle(c);
    const currentUser = c.get('user');

    const userList = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        location: users.location,
        banner: users.banner,
        website: users.website,
        note: users.note,
        socialLinks: users.socialLinks,
        isVerified: users.isVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(ilike(users.username, username))
      .limit(1);

    if (userList.length === 0) {
      return c.json({ success: false, message: 'User not found' }, 404);
    }

    const u = userList[0];

    // สถิติต่าง ๆ: posts, followers, following, viewing (views รวม), likes (likes รวม)
    const [
      postsCountRes,
      followersCountRes,
      followingCountRes,
      viewsCountRes,
      likesCountRes,
      isFollowingRes,
    ] = await Promise.all([
      db.select({ count: count() }).from(posts).where(eq(posts.userId, u.id)),
      db.select({ count: count() }).from(follows).where(eq(follows.followingId, u.id)),
      db.select({ count: count() }).from(follows).where(eq(follows.followerId, u.id)),
      db.select({ count: sql`COALESCE(SUM(${showcases.viewsCount}), 0)::int` }).from(showcases).where(eq(showcases.userId, u.id)),
      db.select({
        count: sql`(
          COALESCE((SELECT COUNT(*) FROM post_likes pl JOIN posts p ON pl.post_id = p.id WHERE p.user_id = ${u.id}), 0) +
          COALESCE((SELECT SUM(likes_count) FROM showcases WHERE user_id = ${u.id}), 0)
        )::int`,
      }),
      currentUser?.id
        ? db.select({ isFollowing: sql`EXISTS(SELECT 1 FROM follows WHERE follower_id = ${currentUser.id} AND following_id = ${u.id})` })
        : Promise.resolve([{ isFollowing: false }]),
    ]);

    return c.json({
      success: true,
      profile: {
        id: u.id,
        name: u.displayName || u.username,
        username: u.username,
        email: u.email,
        avatar: u.avatarUrl || null,
        banner:
          u.banner ||
          '/empty/no-image.png',
        note: u.note || '',
        isVerified: Boolean(u.isVerified ?? true),
        bio: u.bio || '',
        location: u.location || '',
        website: u.website || '',
        socialLinks: u.socialLinks || {},
        joinedDate: u.createdAt,
        stats: {
          posts: Number(postsCountRes[0]?.count || 0),
          followers: Number(followersCountRes[0]?.count || 0),
          following: Number(followingCountRes[0]?.count || 0),
          viewing: Number(viewsCountRes[0]?.count || 0),
          likes: Number(likesCountRes[0]?.count || 0),
        },
        isFollowing: Boolean(isFollowingRes[0]?.isFollowing ?? isFollowingRes[0]?.is_following),
        isSelf: currentUser?.id === u.id,
      },
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

/**
 * 4. PATCH /api/users/profile - อัปเดตโปรไฟล์ของตัวเอง
 */
userRouter.patch('/profile', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const db = getDrizzle(c);
    const body = await c.req.json();

    const {
      displayName,
      bio,
      avatarUrl,
      avatar,
      banner,
      location,
      website,
      note,
      username,
      socialLinks,
    } = body;

    const finalAvatar = avatarUrl || avatar;

    // ถ้ามีการเปลี่ยน username ให้ตรวจสอบความซ้ำซ้อน
    let finalUsername = undefined;
    if (username && typeof username === 'string') {
      const cleanUsername = username.trim().toLowerCase().replace(/^@/, '');
      if (cleanUsername.length < 3) {
        return c.json(
          { success: false, message: 'Username must be at least 3 characters' },
          400
        );
      }

      if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
        return c.json(
          {
            success: false,
            message: 'Username can only contain letters, numbers, and underscores',
          },
          400
        );
      }

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(and(ilike(users.username, cleanUsername), ne(users.id, user.id)))
        .limit(1);

      if (existing.length > 0) {
        return c.json(
          { success: false, message: 'Username is already taken by another creator' },
          400
        );
      }
      finalUsername = cleanUsername;
    }

    const updateData = { updatedAt: sql`NOW()` };
    if (finalUsername !== undefined) updateData.username = finalUsername;
    if (displayName !== undefined) updateData.displayName = displayName;
    if (bio !== undefined) updateData.bio = bio;
    if (finalAvatar !== undefined) updateData.avatarUrl = finalAvatar;
    if (banner !== undefined) updateData.banner = banner;
    if (location !== undefined) updateData.location = location;
    if (website !== undefined) updateData.website = website;
    if (note !== undefined) updateData.note = note;
    if (socialLinks !== undefined) updateData.socialLinks = socialLinks;

    const updated = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, user.id))
      .returning({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        location: users.location,
        banner: users.banner,
        website: users.website,
        note: users.note,
        socialLinks: users.socialLinks,
        updatedAt: users.updatedAt,
      });

    return c.json({
      success: true,
      message: 'Profile updated successfully',
      user: updated[0],
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return c.json({ success: false, message: 'Failed to update profile' }, 500);
  }
});

/**
 * 5. POST /api/users/:id/follow - สลับสถานะ Follow / Unfollow
 */
userRouter.post('/:id/follow', requireAuth, async (c) => {
  try {
    const rawId = c.req.param('id');
    const user = c.get('user');
    const db = getDrizzle(c);

    let targetId = parseInt(rawId, 10);
    if (isNaN(targetId)) {
      const uRes = await db
        .select({ id: users.id })
        .from(users)
        .where(ilike(users.username, rawId.trim()))
        .limit(1);
      if (uRes.length > 0) {
        targetId = uRes[0].id;
      }
    }

    if (isNaN(targetId) || targetId === user.id) {
      return c.json(
        { success: false, message: 'Cannot follow yourself or invalid user' },
        400
      );
    }

    // ตรวจสอบว่า target user มีอยู่จริง
    const targetUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);

    if (targetUser.length === 0) {
      return c.json({ success: false, message: 'User not found' }, 404);
    }

    // ตรวจสอบว่าติดตามอยู่แล้วหรือไม่
    const existing = await db
      .select({ id: follows.id })
      .from(follows)
      .where(and(eq(follows.followerId, user.id), eq(follows.followingId, targetId)))
      .limit(1);

    let isFollowing = false;
    if (existing.length > 0) {
      // Unfollow
      await db
        .delete(follows)
        .where(and(eq(follows.followerId, user.id), eq(follows.followingId, targetId)));
      isFollowing = false;
    } else {
      // Follow
      await db
        .insert(follows)
        .values({
          followerId: user.id,
          followingId: targetId,
        });
      isFollowing = true;

      // สร้างการแจ้งเตือน Follow
      await createNotification(db, {
        userId: targetId,
        actorId: user.id,
        type: 'follow',
      });
    }

    const countRes = await db
      .select({ count: count() })
      .from(follows)
      .where(eq(follows.followingId, targetId));

    return c.json({
      success: true,
      isFollowing,
      followersCount: Number(countRes[0]?.count || 0),
    });
  } catch (err) {
    console.error('Follow error:', err);
    return c.json({ success: false, message: 'Failed to update follow' }, 500);
  }
});

/**
 * 6. GET /api/users/:id/posts - ดึงโพสต์ทั้งหมดของผู้ใช้นี้
 */
userRouter.get('/:id/posts', optionalAuth, async (c) => {
  try {
    const rawParam = c.req.param('id');
    const db = getDrizzle(c);
    const currentUser = c.get('user');

    let userId = parseInt(rawParam, 10);
    if (isNaN(userId)) {
      const uRes = await db
        .select({ id: users.id })
        .from(users)
        .where(ilike(users.username, rawParam.trim()))
        .limit(1);

      if (uRes.length === 0) {
        return c.json({ success: true, posts: [] });
      }
      userId = uRes[0].id;
    }

    const postList = await db
      .select({
        id: posts.id,
        userId: posts.userId,
        caption: posts.caption,
        mediaUrls: posts.mediaUrls,
        serviceId: posts.serviceId,
        serviceTitle: posts.serviceTitle,
        collaborators: posts.collaborators,
        tags: posts.tags,
        clientName: posts.clientName,
        likesCount: posts.likesCount,
        viewsCount: posts.viewsCount,
        sharesCount: posts.sharesCount,
        commentsCount: posts.commentsCount,
        createdAt: posts.createdAt,
        updatedAt: posts.updatedAt,
        authorUsername: users.username,
        authorName: users.displayName,
        authorAvatar: users.avatarUrl,
        isLiked: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = ${posts.id} AND pl.user_id = ${currentUser.id})`
          : sql`false`,
        isFollowingAuthor: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${currentUser.id} AND f.following_id = ${posts.userId})`
          : sql`false`,
      })
      .from(posts)
      .leftJoin(users, eq(posts.userId, users.id))
      .where(eq(posts.userId, userId))
      .orderBy(desc(posts.createdAt));

    const formatted = postList.map((p) => {
      let images = [];
      if (Array.isArray(p.mediaUrls)) {
        images = p.mediaUrls;
      } else if (typeof p.mediaUrls === 'string') {
        try {
          images = JSON.parse(p.mediaUrls);
        } catch {
          images = [p.mediaUrls];
        }
      }

      return {
        id: p.id,
        content: p.caption,
        caption: p.caption,
        images,
        media_urls: images,
        tags: Array.isArray(p.tags) ? p.tags : [],
        likesCount: p.likesCount || 0,
        commentsCount: p.commentsCount || 0,
        sharesCount: p.sharesCount || 0,
        isLiked: Boolean(p.isLiked),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        author: {
          id: p.userId,
          name: p.authorName || p.authorUsername,
          username: p.authorUsername,
          avatar: p.authorAvatar,
          isFollowing: Boolean(p.isFollowingAuthor),
        },
      };
    });

    return c.json({
      success: true,
      posts: formatted,
    });
  } catch (err) {
    console.error('Get user posts error:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

/**
 * 8. GET /api/users/:id/likes - ดึงโพสต์ที่ผู้ใช้นี้กด Like
 */
userRouter.get('/:id/likes', optionalAuth, async (c) => {
  try {
    const rawParam = c.req.param('id');
    const db = getDrizzle(c);
    const currentUser = c.get('user');

    let targetUserId = parseInt(rawParam, 10);
    if (isNaN(targetUserId)) {
      const uRes = await db
        .select({ id: users.id })
        .from(users)
        .where(ilike(users.username, rawParam.trim()))
        .limit(1);

      if (uRes.length === 0) {
        return c.json({ success: true, posts: [] });
      }
      targetUserId = uRes[0].id;
    }

    const likedPostList = await db
      .select({
        id: posts.id,
        userId: posts.userId,
        caption: posts.caption,
        mediaUrls: posts.mediaUrls,
        serviceId: posts.serviceId,
        serviceTitle: posts.serviceTitle,
        collaborators: posts.collaborators,
        tags: posts.tags,
        clientName: posts.clientName,
        likesCount: posts.likesCount,
        viewsCount: posts.viewsCount,
        sharesCount: posts.sharesCount,
        commentsCount: posts.commentsCount,
        createdAt: posts.createdAt,
        updatedAt: posts.updatedAt,
        authorUsername: users.username,
        authorName: users.displayName,
        authorAvatar: users.avatarUrl,
        isLiked: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = ${posts.id} AND pl.user_id = ${currentUser.id})`
          : sql`true`,
        isFollowingAuthor: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${currentUser.id} AND f.following_id = ${posts.userId})`
          : sql`false`,
      })
      .from(postLikes)
      .innerJoin(posts, eq(postLikes.postId, posts.id))
      .leftJoin(users, eq(posts.userId, users.id))
      .where(eq(postLikes.userId, targetUserId))
      .orderBy(desc(postLikes.createdAt));

    const formatted = likedPostList.map((p) => {
      let images = [];
      if (Array.isArray(p.mediaUrls)) {
        images = p.mediaUrls;
      } else if (typeof p.mediaUrls === 'string') {
        try {
          images = JSON.parse(p.mediaUrls);
        } catch {
          images = [p.mediaUrls];
        }
      }

      return {
        id: p.id,
        content: p.caption,
        caption: p.caption,
        images,
        media_urls: images,
        tags: Array.isArray(p.tags) ? p.tags : [],
        likesCount: p.likesCount || 0,
        commentsCount: p.commentsCount || 0,
        sharesCount: p.sharesCount || 0,
        isLiked: Boolean(p.isLiked),
        createdAt: p.createdAt,
        author: {
          id: p.userId,
          name: p.authorName || p.authorUsername,
          username: p.authorUsername,
          avatar: p.authorAvatar,
          isFollowing: Boolean(p.isFollowingAuthor),
        },
      };
    });

    return c.json({
      success: true,
      posts: formatted,
    });
  } catch (err) {
    console.error('Get liked posts error:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

export default userRouter;
