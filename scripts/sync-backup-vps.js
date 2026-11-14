import 'dotenv/config';
import postgres from 'postgres';

const neonUrl = process.env.DATABASE_URL;
const vpsUrl = process.env.BACKUP_DATABASE_URL;

if (!neonUrl || !vpsUrl) {
  console.error('❌ Error: DATABASE_URL (Neon) and BACKUP_DATABASE_URL (VPS) must be configured in .env');
  process.exit(1);
}

const sqlNeon = postgres(neonUrl);
const sqlVps = postgres(vpsUrl);

const tableOrder = [
  'roles',
  'creator_tiers',
  'main_categories',
  'sub_categories',
  'tags',
  'report_reasons',
  'users',
  'accounts',
  'sessions',
  'follows',
  'wallets',
  'products',
  'media',
  'posts',
  'post_likes',
  'post_comments',
  'post_shares',
  'showcases',
  'showcase_likes',
  'services',
  'service_likes',
  'stories',
  'story_views',
  'story_likes',
  'orders',
  'order_items',
  'payments',
  'transactions',
  'withdrawals',
  'payout_methods',
  'reviews',
  'wishlists',
  'conversations',
  'conversation_participants',
  'messages',
  'notifications',
  'moderation_logs',
  'moderation_appeals',
  'reports',
  'bids',
];

async function main() {
  console.log('🔄 เริ่มต้นซิงค์ข้อมูลสำรองจาก Neon ไปยัง VPS PostgreSQL...');
  const start = Date.now();

  let totalSynced = 0;

  for (const tableName of tableOrder) {
    try {
      const rows = await sqlNeon.unsafe(`SELECT * FROM "${tableName}"`);
      if (rows.length === 0) continue;

      process.stdout.write(`  - ${tableName} (${rows.length} แถว)... `);

      for (const row of rows) {
        const keys = Object.keys(row);
        const values = Object.values(row);

        const columnsSql = keys.map((k) => `"${k}"`).join(', ');
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

        const conflictTarget = keys.includes('id') ? 'id' : null;

        let query = `INSERT INTO "${tableName}" (${columnsSql}) VALUES (${placeholders})`;
        if (conflictTarget) {
          query += ` ON CONFLICT ("${conflictTarget}") DO NOTHING`;
        } else {
          query += ` ON CONFLICT DO NOTHING`;
        }

        await sqlVps.unsafe(query, values);
      }
      totalSynced += rows.length;
      console.log('✅');
    } catch (err) {
      console.log(`❌ (${err.message})`);
    }
  }

  const duration = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\n🎉 สำรองข้อมูลเรียบร้อยแล้ว! ซิงค์ทั้งหมด ${totalSynced} แถว ใช้เวลา ${duration} วินาที`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
