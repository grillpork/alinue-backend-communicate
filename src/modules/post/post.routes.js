import { Hono } from 'hono';
import { getDb } from '../../config/db';
import { optionalAuth, requireAuth } from '../../middleware/auth';

const postRouter = new Hono();

/**
 * 1. GET /api/posts - ดึงรายการ Feed Posts ทั้งหมด
 * รองรับ Query: page, limit, tag, userId, search
 */
postRouter.get('/', optionalAuth, async (c) => {
  try {
    const sql = getDb(c);
    const currentUser = c.get('user');

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
    const offset = (page - 1) * limit;
    const tag = c.req.query('tag');
    const userId = c.req.query('userId');
    const search = c.req.query('search');

    // ดึงโพสต์พร้อมข้อมูลผู้เขียนและสถานะ isLiked
    let posts;
    if (currentUser?.id) {
      posts = await sql`
        SELECT 
          p.id,
          p.user_id,
          p.caption,
          p.media_urls,
          p.tags,
          p.collaborators,
          p.likes_count,
          p.comments_count,
          p.shares_count,
          p.views_count,
          p."createdAt",
          p."updatedAt",
          u.username as author_username,
          u."displayName" as author_name,
          u."avatarUrl" as author_avatar,
          u.bio as author_bio,
          EXISTS(
            SELECT 1 FROM post_likes pl 
            WHERE pl.post_id = p.id AND pl.user_id = ${currentUser.id}
          ) as is_liked
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE 1=1
        ${tag ? sql`AND p.tags ? ${tag}` : sql``}
        ${userId ? sql`AND p.user_id = ${parseInt(userId, 10)}` : sql``}
        ${search ? sql`AND (p.caption ILIKE ${'%' + search + '%'} OR u."displayName" ILIKE ${'%' + search + '%'} OR u.username ILIKE ${'%' + search + '%'})` : sql``}
        ORDER BY p."createdAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      posts = await sql`
        SELECT 
          p.id,
          p.user_id,
          p.caption,
          p.media_urls,
          p.tags,
          p.collaborators,
          p.likes_count,
          p.comments_count,
          p.shares_count,
          p.views_count,
          p."createdAt",
          p."updatedAt",
          u.username as author_username,
          u."displayName" as author_name,
          u."avatarUrl" as author_avatar,
          u.bio as author_bio,
          false as is_liked
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE 1=1
        ${tag ? sql`AND p.tags ? ${tag}` : sql``}
        ${userId ? sql`AND p.user_id = ${parseInt(userId, 10)}` : sql``}
        ${search ? sql`AND (p.caption ILIKE ${'%' + search + '%'} OR u."displayName" ILIKE ${'%' + search + '%'} OR u.username ILIKE ${'%' + search + '%'})` : sql``}
        ORDER BY p."createdAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    // จัดรูปแบบให้เข้ากับ Frontend
    const formattedPosts = posts.map((p) => {
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
        content: p.caption || '',
        caption: p.caption || '',
        images,
        media_urls: images,
        tags: Array.isArray(p.tags) ? p.tags : [],
        collaborators: p.collaborators || [],
        likesCount: p.likes_count || 0,
        commentsCount: p.comments_count || 0,
        sharesCount: p.shares_count || 0,
        viewsCount: p.views_count || 0,
        isLiked: Boolean(p.is_liked),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        author: {
          id: p.user_id,
          name: p.author_name || p.author_username || 'Anonymous',
          username: p.author_username || 'user',
          avatar:
            p.author_avatar ||
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
          bio: p.author_bio || '',
        },
      };
    });

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
    const sql = getDb(c);
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

    // สกัด hashtags อัตโนมัติจากข้อความ ถ้าไม่ได้ส่ง tags มา
    let tags = body.tags;
    if (!tags || !Array.isArray(tags)) {
      const matched = textContent.match(/#[a-zA-Z0-9_\u0E00-\u0E7F]+/g) || [];
      tags = matched.map((t) => t.replace('#', ''));
    }

    const collaborators = Array.isArray(body.collaborators)
      ? body.collaborators
      : [];

    const inserted = await sql`
      INSERT INTO posts (
        user_id,
        caption,
        media_urls,
        tags,
        collaborators,
        likes_count,
        comments_count,
        shares_count,
        views_count,
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${user.id},
        ${textContent},
        ${JSON.stringify(imagesList)}::jsonb,
        ${JSON.stringify(tags)}::jsonb,
        ${JSON.stringify(collaborators)}::jsonb,
        0,
        0,
        0,
        0,
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    const newPost = inserted[0];

    // ดึงข้อมูล Author
    const authors = await sql`
      SELECT id, username, "displayName", "avatarUrl", bio
      FROM users 
      WHERE id = ${user.id}
      LIMIT 1
    `;
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
        avatar:
          author.avatarUrl ||
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
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

    const sql = getDb(c);
    const currentUser = c.get('user');

    const posts = await sql`
      SELECT 
        p.*,
        u.username as author_username,
        u."displayName" as author_name,
        u."avatarUrl" as author_avatar,
        u.bio as author_bio,
        ${
          currentUser?.id
            ? sql`EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ${currentUser.id}) as is_liked`
            : sql`false as is_liked`
        }
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ${postId}
      LIMIT 1
    `;

    if (posts.length === 0) {
      return c.json({ success: false, message: 'Post not found' }, 404);
    }

    const p = posts[0];
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

    return c.json({
      success: true,
      post: {
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
          bio: p.author_bio,
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
    const sql = getDb(c);

    const posts = await sql`
      SELECT id, user_id FROM posts WHERE id = ${postId} LIMIT 1
    `;

    if (posts.length === 0) {
      return c.json({ success: false, message: 'Post not found' }, 404);
    }

    if (posts[0].user_id !== user.id) {
      return c.json(
        { success: false, message: 'You are not authorized to delete this post' },
        403
      );
    }

    // ลบความชอบและความคิดเห็นที่เกี่ยวข้อง
    await sql`DELETE FROM post_likes WHERE post_id = ${postId}`;
    await sql`DELETE FROM post_comments WHERE post_id = ${postId}`;
    await sql`DELETE FROM post_shares WHERE post_id = ${postId}`.catch(() => {});
    await sql`DELETE FROM posts WHERE id = ${postId}`;

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
    const sql = getDb(c);

    // ตรวจสอบว่าเคยไลก์แล้วหรือยัง
    const existing = await sql`
      SELECT id FROM post_likes 
      WHERE post_id = ${postId} AND user_id = ${user.id}
      LIMIT 1
    `;

    let isLiked = false;
    if (existing.length > 0) {
      // Unlike
      await sql`
        DELETE FROM post_likes 
        WHERE post_id = ${postId} AND user_id = ${user.id}
      `;
      await sql`
        UPDATE posts 
        SET likes_count = GREATEST(0, likes_count - 1), "updatedAt" = NOW() 
        WHERE id = ${postId}
      `;
      isLiked = false;
    } else {
      // Like
      await sql`
        INSERT INTO post_likes (post_id, user_id, "createdAt") 
        VALUES (${postId}, ${user.id}, NOW())
      `;
      await sql`
        UPDATE posts 
        SET likes_count = likes_count + 1, "updatedAt" = NOW() 
        WHERE id = ${postId}
      `;
      isLiked = true;
    }

    // ดึงจำนวนไลก์ล่าสุด
    const updated = await sql`
      SELECT likes_count FROM posts WHERE id = ${postId} LIMIT 1
    `;
    const likesCount = updated[0]?.likes_count ?? 0;

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
    const sql = getDb(c);
    const body = await c.req.json().catch(() => ({}));
    const platform = body.platform || 'link';

    if (isNaN(postId)) {
      return c.json({ success: false, message: 'Invalid post ID' }, 400);
    }

    // 1. สร้างตาราง post_shares ถ้ายังไม่มี (สำหรับเก็บ Log การแชร์)
    try {
      await sql`
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
      await sql`
        INSERT INTO post_shares (post_id, user_id, platform, "createdAt")
        VALUES (${postId}, ${user?.id || null}, ${platform}, NOW())
      `;
    } catch (insertErr) {
      console.warn('Insert post_shares warning:', insertErr.message);
    }

    // 3. เพิ่มจำนวน shares_count ในตาราง posts
    const updated = await sql`
      UPDATE posts 
      SET shares_count = COALESCE(shares_count, 0) + 1, "updatedAt" = NOW() 
      WHERE id = ${postId}
      RETURNING shares_count
    `;

    if (updated.length === 0) {
      return c.json({ success: false, message: 'Post not found' }, 404);
    }

    const sharesCount = updated[0]?.shares_count ?? 0;

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
 * 6. GET /api/posts/:id/comments - ดึงความคิดเห็นของโพสต์
 */
postRouter.get('/:id/comments', async (c) => {
  try {
    const postId = parseInt(c.req.param('id'), 10);
    const sql = getDb(c);

    const comments = await sql`
      SELECT 
        c.id,
        c.content,
        c.portfolio_attachment,
        c."createdAt",
        u.id as user_id,
        u.username,
        u."displayName",
        u."avatarUrl"
      FROM post_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ${postId}
      ORDER BY c."createdAt" ASC
    `;

    const formatted = comments.map((cm) => ({
      id: cm.id,
      content: cm.content,
      portfolioAttachment: cm.portfolio_attachment,
      createdAt: cm.createdAt,
      user: {
        id: cm.user_id,
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
 * 7. POST /api/posts/:id/comments - เพิ่มความคิดเห็นใหม่
 */
postRouter.post('/:id/comments', requireAuth, async (c) => {
  try {
    const postId = parseInt(c.req.param('id'), 10);
    const user = c.get('user');
    const sql = getDb(c);
    const { content, attachPortfolio } = await c.req.json();

    if (!content || !content.trim()) {
      return c.json(
        { success: false, message: 'Comment content is required' },
        400
      );
    }

    let portfolioAttachment = null;
    if (attachPortfolio) {
      const authorUsers = await sql`
        SELECT id, username, "displayName", "avatarUrl", bio
        FROM users WHERE id = ${user.id} LIMIT 1
      `;
      const authorUser = authorUsers[0] || {};
      const authorShowcases = await sql`
        SELECT id, title, cover_url, media_urls
        FROM showcases
        WHERE user_id = ${user.id} AND is_published = true
        ORDER BY "createdAt" DESC
        LIMIT 4
      `;
      const totalShowcasesResult = await sql`
        SELECT COUNT(*)::int as count
        FROM showcases
        WHERE user_id = ${user.id} AND is_published = true
      `;
      const totalCount = totalShowcasesResult[0]?.count || authorShowcases.length;

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
          coverUrl: sc.cover_url || (sc.media_urls?.[0] || ''),
        })),
      };
    }

    const inserted = await sql`
      INSERT INTO post_comments (
        post_id,
        user_id,
        content,
        portfolio_attachment,
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${postId},
        ${user.id},
        ${content.trim()},
        ${portfolioAttachment ? JSON.stringify(portfolioAttachment) : null},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    // เพิ่ม comment count ในโพสต์
    await sql`
      UPDATE posts 
      SET comments_count = comments_count + 1, "updatedAt" = NOW() 
      WHERE id = ${postId}
    `;

    // ดึงข้อมูล Author
    const authors = await sql`
      SELECT username, "displayName", "avatarUrl" 
      FROM users WHERE id = ${user.id} LIMIT 1
    `;
    const author = authors[0] || {};

    const comment = inserted[0];
    return c.json(
      {
        success: true,
        comment: {
          id: comment.id,
          content: comment.content,
          portfolioAttachment: comment.portfolio_attachment,
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
 * 8. DELETE /api/posts/:postId/comments/:commentId - ลบความคิดเห็น
 */
postRouter.delete('/:postId/comments/:commentId', requireAuth, async (c) => {
  try {
    const postId = parseInt(c.req.param('postId'), 10);
    const commentId = parseInt(c.req.param('commentId'), 10);
    const user = c.get('user');
    const sql = getDb(c);

    const deleted = await sql`
      DELETE FROM post_comments 
      WHERE id = ${commentId} AND (user_id = ${user.id} OR EXISTS(SELECT 1 FROM posts WHERE id = ${postId} AND user_id = ${user.id}))
      RETURNING id
    `;

    if (deleted.length === 0) {
      return c.json({ success: false, message: 'Comment not found or unauthorized' }, 404);
    }

    await sql`
      UPDATE posts 
      SET comments_count = GREATEST(0, comments_count - 1), "updatedAt" = NOW() 
      WHERE id = ${postId}
    `;

    return c.json({ success: true, message: 'Comment deleted successfully' });
  } catch (err) {
    console.error('Delete comment error:', err);
    return c.json({ success: false, message: 'Failed to delete comment' }, 500);
  }
});

export default postRouter;

