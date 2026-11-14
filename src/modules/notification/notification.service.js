import { notifications } from '../../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { getDrizzle } from '../../config/db.js';

/**
 * Helper สำหรับสร้าง Notification อย่างปลอดภัย
 * ไม่ทำให้ Action หลักล้มเหลวหากเกิดข้อผิดพลาด
 */
export async function createNotification(dbOrSql, {
  userId,
  actorId,
  type,
  entityId = null,
  entityType = null,
  message = null,
}) {
  try {
    // ไม่แจ้งเตือนตัวเอง
    if (!userId || !actorId || userId === actorId) {
      return null;
    }

    const db = dbOrSql?.insert ? dbOrSql : (dbOrSql?.db || dbOrSql);

    // หากเป็น Like หรือ Follow ให้ตรวจสอบว่ามีแจ้งเตือนที่ยังไม่ได้อ่านอยู่แล้วหรือไม่ เพื่อไม่ให้สแปม
    if (type === 'like' || type === 'follow' || type === 'showcase_like') {
      const existing = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.actorId, actorId),
            eq(notifications.type, type),
            entityId ? eq(notifications.entityId, entityId) : sql`(${notifications.entityId} IS NULL OR ${notifications.entityId} = 0)`,
            eq(notifications.isRead, false)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // อัปเดตเวลาล่าสุด
        await db
          .update(notifications)
          .set({ createdAt: sql`NOW()` })
          .where(eq(notifications.id, existing[0].id));
        return existing[0];
      }
    }

    const inserted = await db
      .insert(notifications)
      .values({
        userId,
        actorId,
        type,
        entityId,
        entityType,
        message,
        isRead: false,
      })
      .returning();

    return inserted[0];
  } catch (err) {
    console.error('Error creating notification:', err);
    return null;
  }
}
