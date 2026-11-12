import { Hono } from 'hono';
import { getDb } from '../../config/db';
import { optionalAuth, requireAuth } from '../../middleware/auth';

const userRouter = new Hono();

/**
 * 1. GET /api/users/suggested - ดึงรายชื่อครีเอเตอร์แนะนำสำหรับ Widget 'Suggested Creators'
 */
userRouter.get('/suggested', optionalAuth, async (c) => {
  try {
    const sql = getDb(c);
    const currentUser = c.get('user');

    const users = await sql`
      SELECT 
        u.id,
        u.username,
        u."displayName",
        u."avatarUrl",
        u.bio,
        u.location,
        ${
          currentUser?.id
            ? sql`EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${currentUser.id} AND f.following_id = u.id) as is_following`
            : sql`false as is_following`
        }
      FROM users u
      WHERE u.id != ${currentUser?.id || 0}
      ORDER BY u.id DESC
      LIMIT 5
    `;

    const formatted = users.map((u) => ({
      id: u.id,
      name: u.displayName || u.username,
      username: u.username,
      avatar:
        u.avatarUrl ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
      role: u.bio || 'Product Designer',
      location: u.location,
      isFollowing: Boolean(u.is_following),
    }));

    return c.json({
      success: true,
      creators: formatted,
    });
  } catch (err) {
    console.error('Get suggested creators error:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

/**
 * 2. GET /api/users/profile/:username - ดึงข้อมูลโปรไฟล์สาธารณะตาม Username
 */
userRouter.get('/profile/:username', optionalAuth, async (c) => {
  try {
    const username = c.req.param('username').trim().toLowerCase();
    const sql = getDb(c);
    const currentUser = c.get('user');

    const users = await sql`
      SELECT 
        id,
        username,
        "displayName",
        "avatarUrl",
        bio,
        location,
        banner,
        website,
        note,
        "isVerified",
        "createdAt"
      FROM users 
      WHERE LOWER(username) = ${username}
      LIMIT 1
    `;

    if (users.length === 0) {
      return c.json({ success: false, message: 'User not found' }, 404);
    }

    const u = users[0];

    // สถิติต่าง ๆ: posts, followers, following, viewing (views รวม), likes (likes รวม)
    const [
      postsCountRes,
      followersCountRes,
      followingCountRes,
      viewsCountRes,
      likesCountRes,
      isFollowingRes,
    ] = await Promise.all([
      sql`SELECT COUNT(*)::int as count FROM posts WHERE user_id = ${u.id}`,
      sql`SELECT COUNT(*)::int as count FROM follows WHERE following_id = ${u.id}`,
      sql`SELECT COUNT(*)::int as count FROM follows WHERE follower_id = ${u.id}`,
      sql`SELECT COALESCE(SUM(views_count), 0)::int as count FROM showcases WHERE user_id = ${u.id}`,
      sql`
        SELECT (
          COALESCE((SELECT COUNT(*) FROM post_likes pl JOIN posts p ON pl.post_id = p.id WHERE p.user_id = ${u.id}), 0) +
          COALESCE((SELECT SUM(likes_count) FROM showcases WHERE user_id = ${u.id}), 0)
        )::int as count
      `,
      currentUser?.id
        ? sql`SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = ${currentUser.id} AND following_id = ${u.id}) as is_following`
        : Promise.resolve([{ is_following: false }]),
    ]);

    return c.json({
      success: true,
      profile: {
        id: u.id,
        name: u.displayName || u.username,
        username: u.username,
        email: u.email,
        avatar:
          u.avatarUrl ||
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
        banner:
          u.banner ||
          'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
        note: u.note || '',
        isVerified: Boolean(u.isVerified ?? true),
        bio: u.bio || '',
        location: u.location || '',
        website: u.website || '',
        joinedDate: u.createdAt,
        stats: {
          posts: postsCountRes[0]?.count || 0,
          followers: followersCountRes[0]?.count || 0,
          following: followingCountRes[0]?.count || 0,
          viewing: viewsCountRes[0]?.count || 0,
          likes: likesCountRes[0]?.count || 0,
        },
        isFollowing: Boolean(isFollowingRes[0]?.is_following),
        isSelf: currentUser?.id === u.id,
      },
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

/**
 * 3. PATCH /api/users/profile - อัปเดตโปรไฟล์ของตัวเอง
 */
userRouter.patch('/profile', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const sql = getDb(c);
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

      const existing = await sql`
        SELECT id FROM users 
        WHERE LOWER(username) = ${cleanUsername} AND id != ${user.id} 
        LIMIT 1
      `;
      if (existing.length > 0) {
        return c.json(
          { success: false, message: 'Username is already taken by another creator' },
          400
        );
      }
      finalUsername = cleanUsername;
    }

    const updated = await sql`
      UPDATE users 
      SET 
        username = COALESCE(${finalUsername}, username),
        "displayName" = COALESCE(${displayName}, "displayName"),
        bio = COALESCE(${bio}, bio),
        "avatarUrl" = COALESCE(${finalAvatar}, "avatarUrl"),
        banner = COALESCE(${banner}, banner),
        location = COALESCE(${location}, location),
        website = COALESCE(${website}, website),
        note = COALESCE(${note}, note),
        "updatedAt" = NOW()
      WHERE id = ${user.id}
      RETURNING id, username, "displayName", "avatarUrl", bio, location, banner, website, note, "updatedAt"
    `;

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
 * 4. POST /api/users/:id/follow - สลับสถานะ Follow / Unfollow
 */
userRouter.post('/:id/follow', requireAuth, async (c) => {
  try {
    const targetId = parseInt(c.req.param('id'), 10);
    const user = c.get('user');

    if (isNaN(targetId) || targetId === user.id) {
      return c.json(
        { success: false, message: 'Cannot follow yourself or invalid user' },
        400
      );
    }

    const sql = getDb(c);

    // ตรวจสอบว่า target user มีอยู่จริง
    const targetUser = await sql`SELECT id FROM users WHERE id = ${targetId} LIMIT 1`;
    if (targetUser.length === 0) {
      return c.json({ success: false, message: 'User not found' }, 404);
    }

    // ตรวจสอบว่าติดตามอยู่แล้วหรือไม่
    const existing = await sql`
      SELECT id FROM follows 
      WHERE follower_id = ${user.id} AND following_id = ${targetId}
      LIMIT 1
    `;

    let isFollowing = false;
    if (existing.length > 0) {
      // Unfollow
      await sql`
        DELETE FROM follows 
        WHERE follower_id = ${user.id} AND following_id = ${targetId}
      `;
      isFollowing = false;
    } else {
      // Follow
      await sql`
        INSERT INTO follows (follower_id, following_id, "createdAt") 
        VALUES (${user.id}, ${targetId}, NOW())
      `;
      isFollowing = true;
    }

    const countRes = await sql`
      SELECT COUNT(*)::int as count FROM follows WHERE following_id = ${targetId}
    `;

    return c.json({
      success: true,
      isFollowing,
      followersCount: countRes[0]?.count || 0,
    });
  } catch (err) {
    console.error('Follow error:', err);
    return c.json({ success: false, message: 'Failed to update follow' }, 500);
  }
});

/**
 * 5. GET /api/users/:id/posts - ดึงโพสต์ทั้งหมดของผู้ใช้นี้
 */
userRouter.get('/:id/posts', optionalAuth, async (c) => {
  try {
    const rawParam = c.req.param('id');
    const sql = getDb(c);
    const currentUser = c.get('user');

    let userId = parseInt(rawParam, 10);
    if (isNaN(userId)) {
      const uRes = await sql`
        SELECT id FROM users WHERE LOWER(username) = ${rawParam.toLowerCase()} LIMIT 1
      `;
      if (uRes.length === 0) {
        return c.json({ success: true, posts: [] });
      }
      userId = uRes[0].id;
    }

    const posts = await sql`
      SELECT 
        p.*,
        u.username as author_username,
        u."displayName" as author_name,
        u."avatarUrl" as author_avatar,
        ${
          currentUser?.id
            ? sql`EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ${currentUser.id}) as is_liked`
            : sql`false as is_liked`
        }
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ${userId}
      ORDER BY p."createdAt" DESC
    `;

    const formatted = posts.map((p) => {
      let images = [];
      if (Array.isArray(p.media_urls)) {
        images = p.media_urls;
      } else if (typeof p.media_urls === 'string') {
        try {
          images = JSON.parse(p.media_urls);
        } catch {
          images = [p.media_urls];
        }
      }

      return {
        id: p.id,
        content: p.caption,
        caption: p.caption,
        images,
        media_urls: images,
        tags: Array.isArray(p.tags) ? p.tags : [],
        likesCount: p.likes_count || 0,
        commentsCount: p.comments_count || 0,
        sharesCount: p.shares_count || 0,
        isLiked: Boolean(p.is_liked),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        author: {
          id: p.user_id,
          name: p.author_name || p.author_username,
          username: p.author_username,
          avatar: p.author_avatar,
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

export default userRouter;

