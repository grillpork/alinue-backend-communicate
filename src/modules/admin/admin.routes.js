import { Hono } from 'hono';
import { getDrizzle, getDb } from '../../config/db.js';
import { optionalAuth } from '../../middleware/auth.js';
import {
  ensureModerationLogsTable,
  reviewModerationAppeal,
} from '../../utils/moderation.js';
import { moderationAppeals, moderationLogs, users } from '../../db/schema.js';
import { eq, and, or, ilike, sql, desc, count } from 'drizzle-orm';

const adminRouter = new Hono();

/**
 * 1. GET /moderation/stats
 * ดึงภาพรวมสถิติ Content Moderation & Appeals ทั้งหมด
 */
adminRouter.get('/moderation/stats', optionalAuth, async (c) => {
  try {
    const rawSql = getDb(c);
    await ensureModerationLogsTable(rawSql);
    const db = getDrizzle(c);

    const appealsStat = await db
      .select({
        pending_appeals: sql`COUNT(*) FILTER (WHERE ${moderationAppeals.status} = 'pending')`,
        approved_appeals: sql`COUNT(*) FILTER (WHERE ${moderationAppeals.status} = 'approved')`,
        rejected_appeals: sql`COUNT(*) FILTER (WHERE ${moderationAppeals.status} = 'rejected')`,
        total_appeals: sql`COUNT(*)`,
      })
      .from(moderationAppeals);

    const logsStat = await db
      .select({
        total_logs: sql`COUNT(*)`,
        total_blocked: sql`COUNT(*) FILTER (WHERE ${moderationLogs.isSafe} = false)`,
        blocked_24h: sql`COUNT(*) FILTER (WHERE ${moderationLogs.isSafe} = false AND ${moderationLogs.createdAt} >= NOW() - INTERVAL '24 hours')`,
        nudity_count: sql`COUNT(*) FILTER (WHERE ${moderationLogs.reasons}::text ILIKE '%Nudity%')`,
        weapon_count: sql`COUNT(*) FILTER (WHERE ${moderationLogs.reasons}::text ILIKE '%Weapon%')`,
        gore_count: sql`COUNT(*) FILTER (WHERE ${moderationLogs.reasons}::text ILIKE '%Gore%' OR ${moderationLogs.reasons}::text ILIKE '%Violence%')`,
      })
      .from(moderationLogs);

    const pendingAppeals = parseInt(appealsStat[0]?.pending_appeals || '0', 10);
    const approvedAppeals = parseInt(appealsStat[0]?.approved_appeals || '0', 10);
    const rejectedAppeals = parseInt(appealsStat[0]?.rejected_appeals || '0', 10);
    const totalAppeals = parseInt(appealsStat[0]?.total_appeals || '0', 10);

    const totalLogs = parseInt(logsStat[0]?.total_logs || '0', 10);
    const totalBlocked = parseInt(logsStat[0]?.total_blocked || '0', 10);
    const blocked24h = parseInt(logsStat[0]?.blocked_24h || '0', 10);
    const nudityCount = parseInt(logsStat[0]?.nudity_count || '0', 10);
    const weaponCount = parseInt(logsStat[0]?.weapon_count || '0', 10);
    const goreCount = parseInt(logsStat[0]?.gore_count || '0', 10);

    return c.json({
      success: true,
      stats: {
        pendingAppeals,
        approvedAppeals,
        rejectedAppeals,
        totalAppeals,
        totalLogs,
        totalBlocked,
        blocked24h,
        breakdown: {
          nudity: nudityCount,
          weapon: weaponCount,
          gore: goreCount,
        },
      },
    });
  } catch (err) {
    console.error('Moderation stats error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to get moderation stats' },
      500
    );
  }
});

/**
 * 2. GET /moderation/appeals
 * ดึงรายการคิวคำอุทธรณ์สำหรับ Human Moderator (รอตรวจสอบ, อนุมัติแล้ว, ปฏิเสธแล้ว)
 */
adminRouter.get('/moderation/appeals', optionalAuth, async (c) => {
  try {
    const rawSql = getDb(c);
    await ensureModerationLogsTable(rawSql);
    const db = getDrizzle(c);

    const status = c.req.query('status') || 'pending';
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const statusCondition = status === 'all' ? undefined : eq(moderationAppeals.status, status);

    const appeals = await db
      .select({
        id: moderationAppeals.id,
        logId: moderationAppeals.logId,
        userId: moderationAppeals.userId,
        ipAddress: moderationAppeals.ipAddress,
        imageUrl: moderationAppeals.imageUrl,
        fileKey: moderationAppeals.fileKey,
        reasons: moderationAppeals.reasons,
        appealReason: moderationAppeals.appealReason,
        status: moderationAppeals.status,
        reviewerId: moderationAppeals.reviewerId,
        reviewerNote: moderationAppeals.reviewerNote,
        reviewedAt: moderationAppeals.reviewedAt,
        createdAt: moderationAppeals.createdAt,
        updatedAt: moderationAppeals.updatedAt,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        email: users.email,
        reviewerUsername: sql`r.username`,
        reviewerName: sql`r."displayName"`,
      })
      .from(moderationAppeals)
      .leftJoin(users, eq(moderationAppeals.userId, users.id))
      .leftJoin(sql`users r`, sql`r.id = ${moderationAppeals.reviewerId}`)
      .where(statusCondition)
      .orderBy(
        sql`CASE WHEN ${moderationAppeals.status} = 'pending' THEN 0 ELSE 1 END`,
        desc(moderationAppeals.createdAt)
      )
      .limit(limit)
      .offset(offset);

    const totalCountRes = await db
      .select({ count: count() })
      .from(moderationAppeals)
      .where(statusCondition);
    const total = Number(totalCountRes[0]?.count || 0);

    const formatted = appeals.map((a) => {
      let reasons = [];
      if (Array.isArray(a.reasons)) reasons = a.reasons;
      else if (typeof a.reasons === 'string') {
        try {
          reasons = JSON.parse(a.reasons);
        } catch {
          reasons = [a.reasons];
        }
      }

      return {
        id: a.id,
        logId: a.logId,
        userId: a.userId,
        ipAddress: a.ipAddress,
        imageUrl: a.imageUrl,
        fileKey: a.fileKey,
        reasons,
        appealReason: a.appealReason,
        status: a.status,
        reviewerId: a.reviewerId,
        reviewerNote: a.reviewerNote,
        reviewedAt: a.reviewedAt,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        user: a.userId
          ? {
              id: a.userId,
              username: a.username,
              displayName: a.displayName || a.username,
              avatarUrl: a.avatarUrl,
              email: a.email,
            }
          : null,
        reviewer: a.reviewerId
          ? {
              id: a.reviewerId,
              username: a.reviewerUsername,
              displayName: a.reviewerName || a.reviewerUsername,
            }
          : null,
      };
    });

    return c.json({
      success: true,
      appeals: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    console.error('Moderation appeals error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to get appeals' },
      500
    );
  }
});

/**
 * 3. POST /moderation/appeals/:id/review
 * ดำเนินการอนุมัติ (approve) หรือปฏิเสธ (reject) คำอุทธรณ์
 */
adminRouter.post('/moderation/appeals/:id/review', optionalAuth, async (c) => {
  try {
    const rawSql = getDb(c);
    await ensureModerationLogsTable(rawSql);

    const appealId = parseInt(c.req.param('id'), 10);
    if (!appealId) {
      return c.json({ success: false, message: 'Invalid appeal ID' }, 400);
    }

    const body = await c.req.json();
    const { action, note } = body;

    if (!['approve', 'reject'].includes(action)) {
      return c.json(
        { success: false, message: 'Action must be either "approve" or "reject"' },
        400
      );
    }

    const reviewer = c.get('user');
    const reviewerId = reviewer?.id || null;

    const result = await reviewModerationAppeal(rawSql, {
      appealId,
      action,
      reviewerId,
      reviewerNote: note || '',
      r2Config: {
        accountId: c.env.R2_ACCOUNT_ID,
        accessKeyId: c.env.R2_ACCESS_KEY_ID,
        secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
        bucketName: c.env.R2_BUCKET_NAME || 'cats-coworker',
        publicUrl: c.env.R2_PUBLIC_URL || 'https://pub-6d43351c06b34d6c91ecef3d7be6d4c3.r2.dev',
      },
    });

    if (!result.success) {
      return c.json({ success: false, message: result.message }, 400);
    }

    return c.json({
      success: true,
      message: result.message,
      appeal: result.appeal,
    });
  } catch (err) {
    console.error('Review appeal error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to review appeal' },
      500
    );
  }
});

/**
 * 4. GET /moderation/logs
 * ดูประวัติบันทึกการตรวจสอบความปลอดภัยทั้งหมด (Moderation Logs & Audit)
 */
adminRouter.get('/moderation/logs', optionalAuth, async (c) => {
  try {
    const rawSql = getDb(c);
    await ensureModerationLogsTable(rawSql);
    const db = getDrizzle(c);

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '30', 10)));
    const offset = (page - 1) * limit;
    const category = c.req.query('category')?.toLowerCase();
    const action = c.req.query('action');
    const search = c.req.query('search')?.trim();

    const conditions = [];
    if (category) {
      conditions.push(sql`${moderationLogs.reasons}::text ILIKE ${'%' + category + '%'}`);
    }
    if (action) {
      conditions.push(eq(moderationLogs.actionTaken, action));
    }
    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          ilike(moderationLogs.ipAddress, searchPattern),
          ilike(moderationLogs.imageUrl, searchPattern),
          ilike(users.username, searchPattern),
          ilike(users.displayName, searchPattern)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logs = await db
      .select({
        id: moderationLogs.id,
        userId: moderationLogs.userId,
        ipAddress: moderationLogs.ipAddress,
        fileKey: moderationLogs.fileKey,
        imageUrl: moderationLogs.imageUrl,
        reasons: moderationLogs.reasons,
        scores: moderationLogs.scores,
        isSafe: moderationLogs.isSafe,
        actionTaken: moderationLogs.actionTaken,
        createdAt: moderationLogs.createdAt,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(moderationLogs)
      .leftJoin(users, eq(moderationLogs.userId, users.id))
      .where(whereClause)
      .orderBy(desc(moderationLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const totalCountRes = await db
      .select({ count: count() })
      .from(moderationLogs)
      .leftJoin(users, eq(moderationLogs.userId, users.id))
      .where(whereClause);
    const total = Number(totalCountRes[0]?.count || 0);

    const formatted = logs.map((l) => {
      let reasons = [];
      if (Array.isArray(l.reasons)) reasons = l.reasons;
      else if (typeof l.reasons === 'string') {
        try {
          reasons = JSON.parse(l.reasons);
        } catch {
          reasons = [l.reasons];
        }
      }

      let scores = {};
      if (l.scores && typeof l.scores === 'object') scores = l.scores;
      else if (typeof l.scores === 'string') {
        try {
          scores = JSON.parse(l.scores);
        } catch {}
      }

      return {
        id: l.id,
        userId: l.userId,
        ipAddress: l.ipAddress,
        fileKey: l.fileKey,
        imageUrl: l.imageUrl,
        reasons,
        scores,
        isSafe: l.isSafe,
        actionTaken: l.actionTaken,
        createdAt: l.createdAt,
        user: l.userId
          ? {
              id: l.userId,
              username: l.username,
              displayName: l.displayName || l.username,
              avatarUrl: l.avatarUrl,
            }
          : null,
      };
    });

    return c.json({
      success: true,
      logs: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    console.error('Moderation logs error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to get moderation logs' },
      500
    );
  }
});

export default adminRouter;
