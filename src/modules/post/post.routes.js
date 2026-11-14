import { Hono } from 'hono';
import { getDrizzle, getDb } from '../../config/db.js';
import { posts, postLikes, postComments, postShares, users, showcases, searchLogs } from '../../db/schema.js';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import {
  checkImageUrl,
  deleteFromR2,
  checkUserTimeoutStatus,
  recordModerationViolation,
  getClientIp,
} from '../../utils/moderation.js';
import { createNotification } from '../notification/notification.service.js';
import { eq, and, or, ilike, sql, desc, asc, count } from 'drizzle-orm';

const postRouter = new Hono();

/**
 * 1. GET /api/posts - ดึงรายการ Feed Posts ทั้งหมด
 * รองรับ Query: page, limit, tag, userId, search
 */
postRouter.get('/', optionalAuth, async (c) => {
  try {
    const db = getDrizzle(c);
    const currentUser = c.get('user');

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
    const offset = (page - 1) * limit;
    const tag = c.req.query('tag');
    const userId = c.req.query('userId');
    const search = c.req.query('search');

    const conditions = [];
    if (tag) conditions.push(sql`${posts.tags} ? ${tag}`);
    if (userId) conditions.push(eq(posts.userId, parseInt(userId, 10)));
    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          ilike(posts.caption, searchPattern),
          ilike(users.displayName, searchPattern),
          ilike(users.username, searchPattern)
        )
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const postList = await db
      .select({
        id: posts.id,
        userId: posts.userId,
        caption: posts.caption,
        mediaUrls: posts.mediaUrls,
        tags: posts.tags,
        collaborators: posts.collaborators,
        likesCount: posts.likesCount,
        commentsCount: posts.commentsCount,
        sharesCount: posts.sharesCount,
        viewsCount: posts.viewsCount,
        createdAt: posts.createdAt,
        updatedAt: posts.updatedAt,
        authorUsername: users.username,
        authorName: users.displayName,
        authorAvatar: users.avatarUrl,
        authorBio: users.bio,
        isLiked: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = ${posts.id} AND pl.user_id = ${currentUser.id})`
          : sql`false`,
        isFollowingAuthor: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${currentUser.id} AND f.following_id = ${posts.userId})`
          : sql`false`,
      })
      .from(posts)
      .leftJoin(users, eq(posts.userId, users.id))
      .where(whereClause)
      .orderBy(desc(posts.createdAt))
      .limit(limit)
      .offset(offset);

    // จัดรูปแบบให้เข้ากับ Frontend
    const formattedPosts = postList.map((p) => {
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
        collaborators: Array.isArray(p.collaborators) ? p.collaborators : [],
        likesCount: p.likesCount || 0,
        commentsCount: p.commentsCount || 0,
        sharesCount: p.sharesCount || 0,
        viewsCount: p.viewsCount || 0,
        isLiked: Boolean(p.isLiked),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        author: {
          id: p.userId,
          name: p.authorName || p.authorUsername || 'Anonymous',
          username: p.authorUsername || 'user',
          avatar: p.authorAvatar || null,
          bio: p.authorBio || '',
          isFollowing: Boolean(p.isFollowingAuthor),
        },
      };
    });

    // บันทึกประวัติการค้นหาถ้ามีการค้นหาโพสต์
    if (search && search.trim()) {
      try {
        const ipAddress = getClientIp(c);
        db.insert(searchLogs)
          .values({
            query: search.trim(),
            userId: currentUser?.id || null,
            searchType: 'posts',
            resultCount: formattedPosts.length,
            ipAddress,
          })
          .catch(() => {});
      } catch {}
    }

    return c.json({
      success: true,
      posts: formattedPosts,
      pagination: {
        page,
        limit,
        hasMore: formattedPosts.length === limit,
      },
    });
  } catch (err) {
    console.error('Get posts error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to fetch posts' },
      500
    );
  }
});

/**
 * 2. POST /api/posts - สร้างโพสต์ใหม่
 */
postRouter.post('/', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const rawSql = getDb(c);
    const db = getDrizzle(c);
    const ipAddress = getClientIp(c);

    // Tier 3: ตรวจสอบสถานะ Timeout / Rate Limit ก่อนสร้างโพสต์
    const timeoutStatus = await checkUserTimeoutStatus(rawSql, {
      userId: user.id,
      ipAddress,
    });
    if (timeoutStatus.isTimedOut) {
      return c.json(
        {
          success: false,
          isTimedOut: true,
          remainingMinutes: timeoutStatus.remainingMinutes,
          message: timeoutStatus.message,
        },
        429
      );
    }

    const body = await c.req.json();

    const textContent = (body.content || body.caption || '').trim();
    const imagesList = Array.isArray(body.images)
      ? body.images
      : Array.isArray(body.media_urls)
        ? body.media_urls
        : [];

    if (!textContent && imagesList.length === 0) {
      return c.json(
        { success: false, message: 'Post must contain text content or images' },
        400
      );
    }

    // ตรวจสอบว่าต้องไม่ใช่ GIF หรือ Video และผ่าน Sightengine (อนาจาร, อาวุธ, ความรุนแรง/เลือด)
    for (const imgUrl of imagesList) {
      const urlStr = (typeof imgUrl === 'string' ? imgUrl : imgUrl?.url || '').toLowerCase();
      if (
        urlStr.includes('.gif') ||
        urlStr.includes('.mp4') ||
        urlStr.includes('.webm') ||
        urlStr.includes('.mov')
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

      if (urlStr && urlStr.startsWith('http')) {
        const check = await checkImageUrl(urlStr, c.env);
        if (!check.isSafe) {
          // Tier 2: ลบภาพอันตรายออกจาก R2 ทันที
          await deleteFromR2(c, imgUrl);

          // Tier 3: บันทึก Audit Log
          await recordModerationViolation(rawSql, {
            userId: user.id,
            ipAddress,
            fileKey: null,
            imageUrl: urlStr,
            reasons: check.reasons,
            scores: check.scores,
            actionTaken: 'rejected_and_deleted',
          });

          // Tier 3: ตรวจสอบว่าติดฟิลเตอร์เกิน 3 ครั้งใน 10 นาทีหรือยัง
          const updatedTimeout = await checkUserTimeoutStatus(rawSql, {
            userId: user.id,
            ipAddress,
          });

          if (updatedTimeout.isTimedOut) {
            return c.json(
              {
                success: false,
                isTimedOut: true,
                remainingMinutes: updatedTimeout.remainingMinutes,
                message: updatedTimeout.message,
                reasons: check.reasons,
              },
              429
            );
          }

          return c.json(
            {
              success: false,
              message: `ไม่สามารถโพสต์ได้เนื่องจากรูปภาพไม่เหมาะสม: ${check.reasons.join(', ')}`,
              reasons: check.reasons,
              scores: check.scores,
            },
            400
          );
        }
      }
    }

    // สกัด hashtags อัตโนมัติจากข้อความ ถ้าไม่ได้ส่ง tags มา
    let tags = body.tags;
    if (!tags || !Array.isArray(tags)) {
      const matched = textContent.match(/#[a-zA-Z0-9_\u0E00-\u0E7F]+/g) || [];
      tags = matched.map((t) => t.replace('#', ''));
    }

    const collaborators = Array.isArray(body.collaborators)
      ? body.collaborators
      : [];

    const inserted = await db
      .insert(posts)
      .values({
        userId: user.id,
        caption: textContent,
        mediaUrls: imagesList,
        tags,
        collaborators,
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        viewsCount: 0,
      })
      .returning();

    const newPost = inserted[0];

    // ดึงข้อมูล Author
    const authors = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const author = authors[0] || {};

    const formatted = {
      id: newPost.id,
      content: newPost.caption,
      caption: newPost.caption,
      images: imagesList,
      media_urls: imagesList,
      tags,
      collaborators,
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      isLiked: false,
      createdAt: newPost.createdAt,
      updatedAt: newPost.updatedAt,
      author: {
        id: user.id,
        name: author.displayName || author.username || user.username,
        username: author.username || user.username,
        avatar: author.avatarUrl || null,
        bio: author.bio || '',
      },
    };

    return c.json(
      {
        success: true,
        message: 'Post created successfully',
        post: formatted,
      },
      201
    );
  } catch (err) {
    console.error('Create post error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to create post' },
      500
    );
  }
});

/**
 * 3. GET /api/posts/:id - ดึงโพสต์เดียวตาม ID
 */
postRouter.get('/:id', optionalAuth, async (c) => {
  try {
    const postId = parseInt(c.req.param('id'), 10);
    if (isNaN(postId)) {
      return c.json({ success: false, message: 'Invalid post ID' }, 400);
    }

    const db = getDrizzle(c);
    const currentUser = c.get('user');

    const postRows = await db
      .select({
        id: posts.id,
        userId: posts.userId,
        caption: posts.caption,
        mediaUrls: posts.mediaUrls,
        tags: posts.tags,
        collaborators: posts.collaborators,
        likesCount: posts.likesCount,
        commentsCount: posts.commentsCount,
        sharesCount: posts.sharesCount,
        viewsCount: posts.viewsCount,
        createdAt: posts.createdAt,
        updatedAt: posts.updatedAt,
        authorUsername: users.username,
        authorName: users.displayName,
        authorAvatar: users.avatarUrl,
        authorBio: users.bio,
        isLiked: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = ${posts.id} AND pl.user_id = ${currentUser.id})`
          : sql`false`,
        isFollowingAuthor: currentUser?.id
          ? sql`EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${currentUser.id} AND f.following_id = ${posts.userId})`
          : sql`false`,
      })
      .from(posts)
      .leftJoin(users, eq(posts.userId, users.id))
      .where(eq(posts.id, postId))
      .limit(1);

    if (postRows.length === 0) {
      return c.json({ success: false, message: 'Post not found' }, 404);
    }

    const p = postRows[0];
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

    return c.json({
      success: true,
      post: {
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
          bio: p.authorBio,
          isFollowing: Boolean(p.isFollowingAuthor),
        },
      },
    });
  } catch (err) {
    console.error('Get single post error:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

/**
 * 4. DELETE /api/posts/:id - ลบโพสต์
 */
postRouter.delete('/:id', requireAuth, async (c) => {
  try {
    const postId = parseInt(c.req.param('id'), 10);
    const user = c.get('user');
    const db = getDrizzle(c);

    const postRows = await db
      .select({ id: posts.id, userId: posts.userId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (postRows.length === 0) {
      return c.json({ success: false, message: 'Post not found' }, 404);
    }

    if (postRows[0].userId !== user.id) {
      return c.json(
        { success: false, message: 'You are not authorized to delete this post' },
        403
      );
    }

    // ลบความชอบและความคิดเห็นที่เกี่ยวข้อง
    await db.delete(postLikes).where(eq(postLikes.postId, postId));
    await db.delete(postComments).where(eq(postComments.postId, postId));
    await db.delete(postShares).where(eq(postShares.postId, postId)).catch(() => {});
    await db.delete(posts).where(eq(posts.id, postId));

    return c.json({ success: true, message: 'Post deleted successfully' });
  } catch (err) {
    console.error('Delete post error:', err);
    return c.json({ success: false, message: 'Failed to delete post' }, 500);
  }
});

/**
 * 5. POST /api/posts/:id/like - สลับสถานะ Like / Unlike
 */
postRouter.post('/:id/like', requireAuth, async (c) => {
  try {
    const postId = parseInt(c.req.param('id'), 10);
    const user = c.get('user');
    const db = getDrizzle(c);

    // ตรวจสอบว่าเคยไลก์แล้วหรือยัง
    const existing = await db
      .select({ id: postLikes.id })
      .from(postLikes)
      .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, user.id)))
      .limit(1);

    let isLiked = false;
    if (existing.length > 0) {
      // Unlike
      await db
        .delete(postLikes)
        .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, user.id)));
      await db
        .update(posts)
        .set({
          likesCount: sql`GREATEST(0, ${posts.likesCount} - 1)`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(posts.id, postId));
      isLiked = false;
    } else {
      // Like
      await db.insert(postLikes).values({
        postId,
        userId: user.id,
      });
      await db
        .update(posts)
        .set({
          likesCount: sql`${posts.likesCount} + 1`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(posts.id, postId));
      isLiked = true;

      // สร้างการแจ้งเตือน
      const postOwnerRes = await db
        .select({ userId: posts.userId, caption: posts.caption })
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1);

      if (postOwnerRes.length > 0) {
        await createNotification(db, {
          userId: postOwnerRes[0].userId,
          actorId: user.id,
          type: 'like',
          entityId: postId,
          entityType: 'post',
          message: postOwnerRes[0].caption ? postOwnerRes[0].caption.slice(0, 80) : null,
        });
      }
    }

    // ดึงจำนวนไลก์ล่าสุด
    const updated = await db
      .select({ likesCount: posts.likesCount })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    const likesCount = updated[0]?.likesCount ?? 0;

    return c.json({
      success: true,
      isLiked,
      likesCount,
    });
  } catch (err) {
    console.error('Toggle like error:', err);
    return c.json({ success: false, message: 'Failed to update like' }, 500);
  }
});

/**
 * 6. POST /api/posts/:id/share - แชร์โพสต์และบันทึกสถิติจำนวนแชร์ (shares_count)
 */
postRouter.post('/:id/share', optionalAuth, async (c) => {
  try {
    const postId = parseInt(c.req.param('id'), 10);
    const user = c.get('user');
    const rawSql = getDb(c);
    const db = getDrizzle(c);
    const body = await c.req.json().catch(() => ({}));
    const platform = body.platform || 'link';

    if (isNaN(postId)) {
      return c.json({ success: false, message: 'Invalid post ID' }, 400);
    }

    // 1. สร้างตาราง post_shares ถ้ายังไม่มี (สำหรับเก็บ Log การแชร์)
    try {
      await rawSql`
        CREATE TABLE IF NOT EXISTS post_shares (
          id SERIAL PRIMARY KEY,
          post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          platform VARCHAR(50) DEFAULT 'link',
          "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `;
    } catch (tblErr) {
      // ignore
    }

    // 2. บันทึก log การแชร์
    try {
      await db.insert(postShares).values({
        postId,
        userId: user?.id || null,
        platform,
      });
    } catch (insertErr) {
      console.warn('Insert post_shares warning:', insertErr.message);
    }

    // 3. เพิ่มจำนวน shares_count ในตาราง posts
    const updated = await db
      .update(posts)
      .set({
        sharesCount: sql`COALESCE(${posts.sharesCount}, 0) + 1`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(posts.id, postId))
      .returning({ sharesCount: posts.sharesCount });

    if (updated.length === 0) {
      return c.json({ success: false, message: 'Post not found' }, 404);
    }

    const sharesCount = updated[0]?.sharesCount ?? 0;

    return c.json({
      success: true,
      message: 'Post shared successfully',
      sharesCount,
    });
  } catch (err) {
    console.error('Share post error:', err);
    return c.json({ success: false, message: 'Failed to record share' }, 500);
  }
});

/**
 * 7. GET /api/posts/:id/comments - ดึงความคิดเห็นของโพสต์
 */
postRouter.get('/:id/comments', async (c) => {
  try {
    const postId = parseInt(c.req.param('id'), 10);
    const db = getDrizzle(c);

    const commentList = await db
      .select({
        id: postComments.id,
        content: postComments.content,
        portfolioAttachment: postComments.portfolioAttachment,
        createdAt: postComments.createdAt,
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(postComments)
      .leftJoin(users, eq(postComments.userId, users.id))
      .where(eq(postComments.postId, postId))
      .orderBy(asc(postComments.createdAt));

    const formatted = commentList.map((cm) => ({
      id: cm.id,
      content: cm.content,
      portfolioAttachment: cm.portfolioAttachment,
      createdAt: cm.createdAt,
      user: {
        id: cm.userId,
        name: cm.displayName || cm.username,
        username: cm.username,
        avatar: cm.avatarUrl,
      },
    }));

    return c.json({
      success: true,
      comments: formatted,
    });
  } catch (err) {
    console.error('Get comments error:', err);
    return c.json({ success: false, message: 'Failed to fetch comments' }, 500);
  }
});

/**
 * 8. POST /api/posts/:id/comments - เพิ่มความคิดเห็นใหม่
 */
postRouter.post('/:id/comments', requireAuth, async (c) => {
  try {
    const postId = parseInt(c.req.param('id'), 10);
    const user = c.get('user');
    const db = getDrizzle(c);
    const { content, attachPortfolio } = await c.req.json();

    if (!content || !content.trim()) {
      return c.json(
        { success: false, message: 'Comment content is required' },
        400
      );
    }

    let portfolioAttachment = null;
    if (attachPortfolio) {
      const authorUsers = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          bio: users.bio,
        })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      const authorUser = authorUsers[0] || {};

      const authorShowcases = await db
        .select({
          id: showcases.id,
          title: showcases.title,
          coverUrl: showcases.coverUrl,
          mediaUrls: showcases.mediaUrls,
        })
        .from(showcases)
        .where(and(eq(showcases.userId, user.id), eq(showcases.isPublished, true)))
        .orderBy(desc(showcases.createdAt))
        .limit(4);

      const totalShowcasesResult = await db
        .select({ count: count() })
        .from(showcases)
        .where(and(eq(showcases.userId, user.id), eq(showcases.isPublished, true)));
      const totalCount = Number(totalShowcasesResult[0]?.count || authorShowcases.length);

      portfolioAttachment = {
        userId: authorUser.id,
        username: authorUser.username,
        name: authorUser.displayName || authorUser.username,
        avatar: authorUser.avatarUrl,
        bio: authorUser.bio,
        totalShowcases: totalCount,
        showcases: authorShowcases.map((sc) => ({
          id: sc.id,
          title: sc.title,
          coverUrl: sc.coverUrl || (Array.isArray(sc.mediaUrls) ? sc.mediaUrls[0] : ''),
        })),
      };
    }

    const inserted = await db
      .insert(postComments)
      .values({
        postId,
        userId: user.id,
        content: content.trim(),
        portfolioAttachment,
      })
      .returning();

    // เพิ่ม comment count ในโพสต์
    await db
      .update(posts)
      .set({
        commentsCount: sql`${posts.commentsCount} + 1`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(posts.id, postId));

    // สร้างการแจ้งเตือนสำหรับเจ้าของโพสต์
    const postOwnerRes = await db
      .select({ userId: posts.userId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (postOwnerRes.length > 0) {
      await createNotification(db, {
        userId: postOwnerRes[0].userId,
        actorId: user.id,
        type: 'comment',
        entityId: postId,
        entityType: 'post',
        message: content.trim().slice(0, 100),
      });
    }

    // ดึงข้อมูล Author
    const authors = await db
      .select({
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const author = authors[0] || {};

    const comment = inserted[0];
    return c.json(
      {
        success: true,
        comment: {
          id: comment.id,
          content: comment.content,
          portfolioAttachment: comment.portfolioAttachment,
          createdAt: comment.createdAt,
          user: {
            id: user.id,
            name: author.displayName || user.username,
            username: author.username || user.username,
            avatar: author.avatarUrl,
          },
        },
      },
      201
    );
  } catch (err) {
    console.error('Add comment error:', err);
    return c.json({ success: false, message: 'Failed to add comment' }, 500);
  }
});

/**
 * 9. DELETE /api/posts/:postId/comments/:commentId - ลบความคิดเห็น
 */
postRouter.delete('/:postId/comments/:commentId', requireAuth, async (c) => {
  try {
    const postId = parseInt(c.req.param('postId'), 10);
    const commentId = parseInt(c.req.param('commentId'), 10);
    const user = c.get('user');
    const db = getDrizzle(c);

    const deleted = await db
      .delete(postComments)
      .where(
        and(
          eq(postComments.id, commentId),
          or(
            eq(postComments.userId, user.id),
            sql`EXISTS(SELECT 1 FROM posts WHERE id = ${postId} AND user_id = ${user.id})`
          )
        )
      )
      .returning({ id: postComments.id });

    if (deleted.length === 0) {
      return c.json({ success: false, message: 'Comment not found or unauthorized' }, 404);
    }

    await db
      .update(posts)
      .set({
        commentsCount: sql`GREATEST(0, ${posts.commentsCount} - 1)`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(posts.id, postId));

    return c.json({ success: true, message: 'Comment deleted successfully' });
  } catch (err) {
    console.error('Delete comment error:', err);
    return c.json({ success: false, message: 'Failed to delete comment' }, 500);
  }
});

export default postRouter;
