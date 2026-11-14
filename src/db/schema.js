import { pgTable, foreignKey, unique, serial, timestamp, integer, varchar, numeric, jsonb, text, boolean, bigint, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roles = pgTable("roles", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 50 }).notNull(),
	description: text(),
	permissions: jsonb().default([]),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("UQ_648e3f5447f725579d7d4ffdfb7").on(table.name),
]);

export const role = roles;

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	username: varchar({ length: 100 }).notNull(),
	email: varchar({ length: 150 }).notNull(),
	password: varchar({ length: 255 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	displayName: varchar({ length: 150 }),
	avatarUrl: varchar({ length: 500 }),
	isVerified: boolean().default(false).notNull(),
	isBanned: boolean().default(false).notNull(),
	roleId: integer("role_id"),
	bio: text(),
	location: varchar({ length: 255 }),
	banner: varchar({ length: 500 }),
	artstation: varchar({ length: 255 }),
	twitter: varchar({ length: 255 }),
	discord: varchar({ length: 255 }),
	phone: varchar({ length: 50 }),
	website: varchar({ length: 255 }),
	balance: numeric({ precision: 12, scale: 2 }).default('0.00'),
	preferences: jsonb().default({}),
	twoFactorEnabled: boolean().default(false),
	betterAuthId: varchar("better_auth_id", { length: 255 }),
	tierId: integer("tier_id").default(1),
	currentMonthSales: numeric("current_month_sales", { precision: 12, scale: 2 }).default('0.00'),
	socialLinks: jsonb("social_links").default({}),
	note: varchar({ length: 100 }),
	noteUpdatedAt: timestamp("note_updated_at", { mode: 'string' }),
	subCover: text("sub_cover"),
	subCoverType: varchar("sub_cover_type", { length: 50 }).default('image'),
}, (table) => [
	foreignKey({
		columns: [table.roleId],
		foreignColumns: [roles.id],
		name: "FK_a2cecd1a3531c0b041e29ba46e1"
	}),
	unique("UQ_fe0bb3f6520ee0469504521e710").on(table.username),
	unique("UQ_97672ac88f789774dd47f7c8be3").on(table.email),
]);

export const sessions = pgTable("sessions", {
	id: varchar({ length: 64 }).primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	token: varchar({ length: 255 }).notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	ipAddress: varchar({ length: 100 }),
	userAgent: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_sessions_expires_at").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_sessions_token").using("btree", table.token.asc().nullsLast().op("text_ops")),
	index("idx_sessions_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "sessions_user_id_fkey"
	}).onDelete("cascade"),
	unique("sessions_token_key").on(table.token),
]);

export const accounts = pgTable("accounts", {
	id: varchar({ length: 64 }).primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	accountId: text().notNull(),
	providerId: text().notNull(),
	accessToken: text(),
	refreshToken: text(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }),
	password: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_accounts_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "accounts_user_id_fkey"
	}).onDelete("cascade"),
]);

export const verification = pgTable("verification", {
	id: varchar({ length: 64 }).primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_verification_identifier").using("btree", table.identifier.asc().nullsLast()),
]);

export const verifications = verification;
export const authVerifications = verification;

export const follows = pgTable("follows", {
	id: serial().primaryKey().notNull(),
	followerId: integer("follower_id").notNull(),
	followingId: integer("following_id").notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_follows_follower").using("btree", table.followerId.asc().nullsLast().op("int4_ops")),
	index("idx_follows_following").using("btree", table.followingId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.followerId],
		foreignColumns: [users.id],
		name: "follows_follower_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.followingId],
		foreignColumns: [users.id],
		name: "follows_following_id_fkey"
	}).onDelete("cascade"),
	unique("follows_follower_id_following_id_key").on(table.followerId, table.followingId),
	check("follows_check", sql`follower_id <> following_id`),
]);

export const media = pgTable("media", {
	id: serial().primaryKey().notNull(),
	fileKey: varchar({ length: 500 }).notNull(),
	url: varchar({ length: 500 }).notNull(),
	type: varchar({ length: 20 }).default('image').notNull(),
	mimeType: varchar({ length: 100 }),
	originalName: varchar({ length: 255 }),
	size: bigint({ mode: "number" }),
	width: integer(),
	height: integer(),
	entityType: varchar({ length: 50 }),
	entityId: integer(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	uploadedBy: integer("uploaded_by"),
}, (table) => [
	foreignKey({
		columns: [table.uploadedBy],
		foreignColumns: [users.id],
		name: "FK_8468de6d91985f53a1a3324741c"
	}),
]);

export const posts = pgTable("posts", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	caption: text(),
	mediaUrls: jsonb("media_urls").default([]),
	serviceId: integer("service_id"),
	serviceTitle: varchar("service_title", { length: 255 }),
	collaborators: jsonb().default([]),
	tags: jsonb().default([]),
	clientName: varchar("client_name", { length: 255 }),
	likesCount: integer("likes_count").default(0),
	viewsCount: integer("views_count").default(0),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	sharesCount: integer("shares_count").default(0),
	commentsCount: integer("comments_count").default(0),
}, (table) => [
	index("idx_posts_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_posts_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "posts_user_id_fkey"
	}).onDelete("cascade"),
]);

export const postLikes = pgTable("post_likes", {
	id: serial().primaryKey().notNull(),
	postId: integer("post_id").notNull(),
	userId: integer("user_id").notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_post_likes_post_id").using("btree", table.postId.asc().nullsLast().op("int4_ops")),
	index("idx_post_likes_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.postId],
		foreignColumns: [posts.id],
		name: "post_likes_post_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "post_likes_user_id_fkey"
	}).onDelete("cascade"),
	unique("post_likes_post_id_user_id_key").on(table.postId, table.userId),
]);

export const postComments = pgTable("post_comments", {
	id: serial().primaryKey().notNull(),
	postId: integer("post_id").notNull(),
	userId: integer("user_id").notNull(),
	content: text().notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	portfolioAttachment: jsonb("portfolio_attachment"),
}, (table) => [
	index("idx_post_comments_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_post_comments_post_id").using("btree", table.postId.asc().nullsLast().op("int4_ops")),
	index("idx_post_comments_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.postId],
		foreignColumns: [posts.id],
		name: "post_comments_post_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "post_comments_user_id_fkey"
	}).onDelete("cascade"),
]);

export const postShares = pgTable("post_shares", {
	id: serial().primaryKey().notNull(),
	postId: integer("post_id").notNull(),
	userId: integer("user_id"),
	platform: varchar({ length: 50 }).default('link'),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
		columns: [table.postId],
		foreignColumns: [posts.id],
		name: "post_shares_post_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "post_shares_user_id_fkey"
	}).onDelete("set null"),
]);

export const showcases = pgTable("showcases", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	mediaUrls: jsonb("media_urls").default([]).notNull(),
	mediaType: varchar("media_type", { length: 50 }).default('image'),
	coverUrl: varchar("cover_url", { length: 1000 }),
	tags: jsonb().default([]),
	likesCount: integer("likes_count").default(0).notNull(),
	viewsCount: integer("views_count").default(0).notNull(),
	isPublished: boolean("is_published").default(true).notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_showcases_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_showcases_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "showcases_user_id_fkey"
	}).onDelete("cascade"),
]);

export const showcaseLikes = pgTable("showcase_likes", {
	id: serial().primaryKey().notNull(),
	showcaseId: integer("showcase_id").notNull(),
	userId: integer("user_id").notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_showcase_likes_showcase_id").using("btree", table.showcaseId.asc().nullsLast().op("int4_ops")),
	index("idx_showcase_likes_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.showcaseId],
		foreignColumns: [showcases.id],
		name: "showcase_likes_showcase_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "showcase_likes_user_id_fkey"
	}).onDelete("cascade"),
	unique("showcase_likes_showcase_id_user_id_key").on(table.showcaseId, table.userId),
]);

export const notifications = pgTable("notifications", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	actorId: integer("actor_id").notNull(),
	type: varchar({ length: 50 }).notNull(),
	entityId: integer("entity_id"),
	entityType: varchar("entity_type", { length: 50 }),
	message: text(),
	isRead: boolean("is_read").default(false),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_notifications_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_notifications_is_read").using("btree", table.userId.asc().nullsLast(), table.isRead.asc().nullsLast()),
	index("idx_notifications_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "notifications_user_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.actorId],
		foreignColumns: [users.id],
		name: "notifications_actor_id_fkey"
	}).onDelete("cascade"),
]);

export const moderationLogs = pgTable("moderation_logs", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id"),
	ipAddress: varchar("ip_address", { length: 100 }),
	fileKey: varchar("file_key", { length: 255 }),
	imageUrl: text("image_url"),
	reasons: jsonb(),
	scores: jsonb(),
	isSafe: boolean("is_safe").default(false),
	actionTaken: varchar("action_taken", { length: 50 }).default('rejected'),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
});

export const moderationAppeals = pgTable("moderation_appeals", {
	id: serial().primaryKey().notNull(),
	logId: integer("log_id"),
	userId: integer("user_id"),
	ipAddress: varchar("ip_address", { length: 100 }),
	imageUrl: text("image_url"),
	fileKey: varchar("file_key", { length: 255 }),
	reasons: jsonb(),
	appealReason: text("appeal_reason").notNull(),
	status: varchar({ length: 30 }).default('pending'),
	reviewerId: integer("reviewer_id"),
	reviewerNote: text("reviewer_note"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
});

export const searchLogs = pgTable("search_logs", {
	id: serial().primaryKey().notNull(),
	query: varchar({ length: 255 }).notNull(),
	userId: integer("user_id"),
	searchType: varchar("search_type", { length: 50 }).default('all'),
	resultCount: integer("result_count").default(0),
	ipAddress: varchar("ip_address", { length: 100 }),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_search_logs_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_search_logs_query").using("btree", table.query.asc().nullsLast().op("text_ops")),
	index("idx_search_logs_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "search_logs_user_id_fkey"
	}).onDelete("set null"),
]);

export const searchLog = searchLogs;

export const services = pgTable("services", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	images: jsonb().default([]).notNull(),
	coverUrl: varchar("cover_url", { length: 1000 }),
	tags: jsonb().default([]),
	price: numeric({ precision: 12, scale: 2 }),
	priceText: varchar("price_text", { length: 100 }),
	status: varchar({ length: 50 }).default('active').notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	likesCount: integer("likes_count").default(0).notNull(),
	viewsCount: integer("views_count").default(0).notNull(),
	isPublished: boolean("is_published").default(true).notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_services_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	index("idx_services_expires_at").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_services_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_services_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "services_user_id_fkey"
	}).onDelete("cascade"),
]);

export const service = services;

export const serviceLikes = pgTable("service_likes", {
	id: serial().primaryKey().notNull(),
	serviceId: integer("service_id").notNull(),
	userId: integer("user_id").notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_service_likes_service_id").using("btree", table.serviceId.asc().nullsLast().op("int4_ops")),
	index("idx_service_likes_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
		columns: [table.serviceId],
		foreignColumns: [services.id],
		name: "service_likes_service_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "service_likes_user_id_fkey"
	}).onDelete("cascade"),
	unique("service_likes_service_id_user_id_key").on(table.serviceId, table.userId),
]);

export const serviceLike = serviceLikes;


