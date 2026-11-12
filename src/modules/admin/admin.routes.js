import { Hono } from 'hono';
import { getDb } from '../../config/db';
import { optionalAuth } from '../../middleware/auth';
import {
  ensureModerationLogsTable,
  reviewModerationAppeal,
} from '../../utils/moderation';

const adminRouter = new Hono();

/**
 * 1. GET /moderation/stats
 * ดึงภาพรวมสถิติ Content Moderation & Appeals ทั้งหมด
 */
adminRouter.get('/moderation/stats', optionalAuth, async (c) => {
  try {
    const sql = getDb(c);
    await ensureModerationLogsTable(sql);

    const appealsStat = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending_appeals,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_appeals,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_appeals,
        COUNT(*) as total_appeals
      FROM moderation_appeals
    `;

    const logsStat = await sql`
      SELECT
        COUNT(*) as total_logs,
        COUNT(*) FILTER (WHERE is_safe = false) as total_blocked,
        COUNT(*) FILTER (WHERE is_safe = false AND "createdAt" >= NOW() - INTERVAL '24 hours') as blocked_24h,
        COUNT(*) FILTER (WHERE reasons::text ILIKE '%Nudity%') as nudity_count,
        COUNT(*) FILTER (WHERE reasons::text ILIKE '%Weapon%') as weapon_count,
        COUNT(*) FILTER (WHERE reasons::text ILIKE '%Gore%' OR reasons::text ILIKE '%Violence%') as gore_count
      FROM moderation_logs
    `;

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
    const sql = getDb(c);
    await ensureModerationLogsTable(sql);

    const status = c.req.query('status') || 'pending';
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const appeals = await sql`
      SELECT 
        a.id,
        a.log_id,
        a.user_id,
        a.ip_address,
        a.image_url,
        a.file_key,
        a.reasons,
        a.appeal_reason,
        a.status,
        a.reviewer_id,
        a.reviewer_note,
        a.reviewed_at,
        a."createdAt",
        a."updatedAt",
        u.username,
        u."displayName",
        u."avatarUrl",
        u.email,
        r.username as reviewer_username,
        r."displayName" as reviewer_name
      FROM moderation_appeals a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN users r ON a.reviewer_id = r.id
      WHERE 
        ${status === 'all' ? sql`1=1` : sql`a.status = ${status}`}
      ORDER BY 
        CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END,
        a."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totalCountRes = await sql`
      SELECT COUNT(*)::int as count 
      FROM moderation_appeals
      WHERE ${status === 'all' ? sql`1=1` : sql`status = ${status}`}
    `;
    const total = totalCountRes[0]?.count || 0;

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
        logId: a.log_id,
        userId: a.user_id,
        ipAddress: a.ip_address,
        imageUrl: a.image_url,
        fileKey: a.file_key,
        reasons,
        appealReason: a.appeal_reason,
        status: a.status,
        reviewerId: a.reviewer_id,
        reviewerNote: a.reviewer_note,
        reviewedAt: a.reviewed_at,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        user: {
          id: a.user_id,
          username: a.username || 'guest',
          name: a.displayName || a.username || 'ผู้ใช้ทั่วไป',
          avatarUrl: a.avatarUrl || null,
          email: a.email || null,
        },
        reviewer: a.reviewer_id
          ? {
              id: a.reviewer_id,
              username: a.reviewer_username,
              name: a.reviewer_name || a.reviewer_username,
            }
          : null,
      };
    });

    return c.json({
      success: true,
      data: formatted,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + appeals.length < total,
      },
    });
  } catch (err) {
    console.error('Get moderation appeals error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to fetch appeals' },
      500
    );
  }
});

/**
 * 3. POST /moderation/appeals/:id/review
 * แอดมินตัดสินผลการอุทธรณ์ (Approve ปลดบล็อก / Reject ยืนยันว่าผิดกฎ)
 */
adminRouter.post('/moderation/appeals/:id/review', optionalAuth, async (c) => {
  try {
    const appealId = parseInt(c.req.param('id'), 10);
    if (isNaN(appealId)) {
      return c.json({ success: false, message: 'Invalid appeal ID' }, 400);
    }

    const reviewer = c.get('user');
    const sql = getDb(c);
    const body = await c.req.json();
    const { action, reviewerNote } = body;

    if (!['approve', 'reject'].includes(action)) {
      return c.json(
        { success: false, message: "action must be 'approve' or 'reject'" },
        400
      );
    }

    const appeal = await reviewModerationAppeal(sql, {
      appealId,
      reviewerId: reviewer?.id || null,
      action,
      reviewerNote: reviewerNote || null,
    });

    return c.json({
      success: true,
      message:
        action === 'approve'
          ? 'อนุมัติคำร้องอุทธรณ์เรียบร้อยแล้ว (ปลดบล็อกสถานะความปลอดภัยให้ผู้ใช้)'
          : 'ปฏิเสธคำร้องอุทธรณ์เรียบร้อยแล้ว (ยืนยันว่ารูปภาพละเมิดมาตรฐานชุมชน)',
      appeal,
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
    const sql = getDb(c);
    await ensureModerationLogsTable(sql);

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '30', 10)));
    const offset = (page - 1) * limit;
    const category = c.req.query('category')?.toLowerCase();
    const action = c.req.query('action');
    const search = c.req.query('search')?.trim();

    let logs = await sql`
      SELECT 
        l.id,
        l.user_id,
        l.ip_address,
        l.file_key,
        l.image_url,
        l.reasons,
        l.scores,
        l.is_safe,
        l.action_taken,
        l."createdAt",
        u.username,
        u."displayName",
        u."avatarUrl"
      FROM moderation_logs l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE 1=1
        ${category ? sql`AND l.reasons::text ILIKE ${'%' + category + '%'}` : sql``}
        ${action ? sql`AND l.action_taken = ${action}` : sql``}
        ${
          search
            ? sql`AND (
                l.ip_address ILIKE ${'%' + search + '%'}
                OR l.image_url ILIKE ${'%' + search + '%'}
                OR u.username ILIKE ${'%' + search + '%'}
                OR u."displayName" ILIKE ${'%' + search + '%'}
              )`
            : sql``
        }
      ORDER BY l."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totalCountRes = await sql`
      SELECT COUNT(*)::int as count 
      FROM moderation_logs l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE 1=1
        ${category ? sql`AND l.reasons::text ILIKE ${'%' + category + '%'}` : sql``}
        ${action ? sql`AND l.action_taken = ${action}` : sql``}
        ${
          search
            ? sql`AND (
                l.ip_address ILIKE ${'%' + search + '%'}
                OR l.image_url ILIKE ${'%' + search + '%'}
                OR u.username ILIKE ${'%' + search + '%'}
                OR u."displayName" ILIKE ${'%' + search + '%'}
              )`
            : sql``
        }
    `;
    const total = totalCountRes[0]?.count || 0;

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
      if (typeof l.scores === 'object' && l.scores !== null) scores = l.scores;
      else if (typeof l.scores === 'string') {
        try {
          scores = JSON.parse(l.scores);
        } catch {}
      }

      return {
        id: l.id,
        userId: l.user_id,
        ipAddress: l.ip_address,
        fileKey: l.file_key,
        imageUrl: l.image_url,
        reasons,
        scores,
        isSafe: l.is_safe,
        actionTaken: l.action_taken,
        createdAt: l.createdAt,
        user: l.user_id
          ? {
              id: l.user_id,
              username: l.username || 'user',
              name: l.displayName || l.username || 'User',
              avatarUrl: l.avatarUrl || null,
            }
          : {
              id: null,
              username: 'guest',
              name: 'ผู้เยี่ยมชม (Guest)',
              avatarUrl: null,
            },
      };
    });

    return c.json({
      success: true,
      data: formatted,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + logs.length < total,
      },
    });
  } catch (err) {
    console.error('Get moderation logs error:', err);
    return c.json(
      { success: false, message: err.message || 'Failed to fetch moderation logs' },
      500
    );
  }
});

export default adminRouter;
