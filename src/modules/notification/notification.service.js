/**
 * Helper สำหรับสร้าง Notification อย่างปลอดภัย
 * ไม่ทำให้ Action หลักล้มเหลวหากเกิดข้อผิดพลาด
 */
export async function createNotification(sql, {
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

    // หากเป็น Like หรือ Follow ให้ตรวจสอบว่ามีแจ้งเตือนที่ยังไม่ได้อ่านอยู่แล้วหรือไม่ เพื่อไม่ให้สแปม
    if (type === 'like' || type === 'follow' || type === 'showcase_like') {
      const existing = await sql`
        SELECT id FROM notifications 
        WHERE user_id = ${userId} 
          AND actor_id = ${actorId} 
          AND type = ${type} 
          AND COALESCE(entity_id, 0) = ${entityId || 0}
          AND is_read = false
        LIMIT 1
      `;

      if (existing.length > 0) {
        // อัปเดตเวลาล่าสุด
        await sql`
          UPDATE notifications 
          SET "createdAt" = NOW() 
          WHERE id = ${existing[0].id}
        `;
        return existing[0];
      }
    }

    const inserted = await sql`
      INSERT INTO notifications (
        user_id,
        actor_id,
        type,
        entity_id,
        entity_type,
        message,
        is_read,
        "createdAt"
      ) VALUES (
        ${userId},
        ${actorId},
        ${type},
        ${entityId},
        ${entityType},
        ${message},
        false,
        NOW()
      )
      RETURNING *
    `;

    return inserted[0];
  } catch (err) {
    console.error('Error creating notification:', err);
    return null;
  }
}

