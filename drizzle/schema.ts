import { pgTable, foreignKey, unique, serial, timestamp, integer, varchar, numeric, jsonb, text, smallint, boolean, bigint, date, index, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const wishlists = pgTable("wishlists", {
	id: serial().primaryKey().notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	userId: integer("user_id").notNull(),
	productId: integer("product_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "FK_b5e6331a1a7d61c25d7a25cab8f"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "FK_2662acbb3868b1f0077fda61dd2"
		}).onDelete("cascade"),
	unique("UQ_9c64a981c56ba677ac17f5fba6f").on(table.productId, table.userId),
]);

export const transactions = pgTable("transactions", {
	id: serial().primaryKey().notNull(),
	paymentIntentId: varchar({ length: 255 }),
	paymentMethod: varchar({ length: 30 }).notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: varchar({ length: 10 }).default('thb').notNull(),
	metadata: jsonb(),
	paidAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	userId: integer("user_id").notNull(),
	orderId: integer("order_id"),
	walletId: integer("wallet_id"),
	type: varchar({ length: 30 }).default('sale_earning'),
	balanceAfter: numeric({ precision: 12, scale:  2 }).default('0.00'),
	referenceType: varchar({ length: 50 }),
	referenceId: integer(),
	description: text(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "FK_e9acc6efa76de013e8c1553ed2b"
		}),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "FK_3cb0558ed36997f1d9ecc1118e7"
		}),
	foreignKey({
			columns: [table.walletId],
			foreignColumns: [wallets.id],
			name: "transactions_wallet_id_fkey"
		}).onDelete("cascade"),
]);

export const orderItems = pgTable("order_items", {
	id: serial().primaryKey().notNull(),
	priceAtPurchase: numeric({ precision: 10, scale:  2 }).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	orderId: integer("order_id").notNull(),
	productId: integer("product_id").notNull(),
	licenseType: varchar({ length: 50 }).default('personal'),
	licenseKey: varchar({ length: 100 }),
	tierName: varchar({ length: 50 }),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "FK_145532db85752b29c57d2b7b1f1"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "FK_9263386c35b6b242540f9493b00"
		}),
]);

export const orders = pgTable("orders", {
	id: serial().primaryKey().notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	totalAmount: numeric({ precision: 10, scale:  2 }).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	buyerId: integer("buyer_id").notNull(),
	subtotalAmount: numeric({ precision: 10, scale:  2 }).default('0.00'),
	vatAmount: numeric({ precision: 10, scale:  2 }).default('0.00'),
}, (table) => [
	foreignKey({
			columns: [table.buyerId],
			foreignColumns: [users.id],
			name: "FK_5e90e93d0e036c3fadbaefa4d0a"
		}),
]);

export const reviews = pgTable("reviews", {
	id: serial().primaryKey().notNull(),
	rating: smallint().notNull(),
	comment: text(),
	imageUrls: jsonb().default([]),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	reviewerId: integer("reviewer_id").notNull(),
	productId: integer("product_id").notNull(),
	likes: integer().default(0).notNull(),
	replies: integer().default(0).notNull(),
	tags: jsonb().default([]),
	orderId: integer("order_id"),
}, (table) => [
	foreignKey({
			columns: [table.reviewerId],
			foreignColumns: [users.id],
			name: "FK_92e950a2513a79bb3fab273c92e"
		}),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "FK_9482e9567d8dcc2bc615981ef44"
		}),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "reviews_order_id_fkey"
		}).onDelete("set null"),
]);

export const products = pgTable("products", {
	id: serial().primaryKey().notNull(),
	title: varchar({ length: 200 }).notNull(),
	slug: varchar({ length: 220 }).notNull(),
	description: text(),
	price: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	thumbnailUrl: varchar({ length: 500 }),
	imageUrls: jsonb().default([]),
	isPublished: boolean().default(false).notNull(),
	downloadCount: integer().default(0).notNull(),
	viewCount: integer().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	creatorId: integer("creator_id").notNull(),
	priceType: varchar({ length: 10 }).default('fixed').notNull(),
	minPrice: numeric({ precision: 10, scale:  2 }),
	licenses: jsonb().default([{"id":"personal","name":"Personal License","checked":true}]),
	deliverableFiles: jsonb().default([]),
	mainCategoryId: integer("main_category_id"),
	subCategoryId: integer("sub_category_id"),
	tags: jsonb().default([]),
	isExclusive: boolean().default(false),
	saleType: varchar({ length: 30 }).default('non-exclusive'),
	startBid: numeric({ precision: 10, scale:  2 }),
	auctionDurationHours: integer().default(24),
	milestones: jsonb().default([]),
	autoBuyTiers: jsonb().default([]),
	copyType: varchar({ length: 20 }).default('multiple'),
	auctionEndTime: timestamp({ withTimezone: true, mode: 'string' }),
	scheduledOpenAt: timestamp({ withTimezone: true, mode: 'string' }),
	scheduledCloseAt: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.creatorId],
			foreignColumns: [users.id],
			name: "FK_db887c3b31abbbd920e303a0179"
		}),
	foreignKey({
			columns: [table.mainCategoryId],
			foreignColumns: [mainCategories.id],
			name: "FK_c4c3b08a0a1e609972a2c6d676d"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.subCategoryId],
			foreignColumns: [subCategories.id],
			name: "FK_3fffb0be83ac483af3a55f41170"
		}).onDelete("set null"),
	unique("UQ_464f927ae360106b783ed0b4106").on(table.slug),
]);

export const kycVerifications = pgTable("kyc_verifications", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	nationality: varchar({ length: 50 }).default('thai'),
	idType: varchar({ length: 50 }).default('national_id'),
	title: varchar({ length: 20 }).default('mr'),
	firstName: varchar({ length: 100 }).notNull(),
	lastName: varchar({ length: 100 }).notNull(),
	idNumber: varchar({ length: 50 }).notNull(),
	birthDate: varchar({ length: 50 }),
	laserCode: varchar({ length: 50 }),
	address: text(),
	idCardUrl: varchar({ length: 500 }),
	selfieUrl: varchar({ length: 500 }),
	status: varchar({ length: 20 }).default('pending'),
	rejectedReason: text(),
	reviewedBy: integer(),
	reviewedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "kyc_verifications_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "kyc_verifications_reviewedBy_fkey"
		}).onDelete("set null"),
]);

export const roles = pgTable("roles", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 50 }).notNull(),
	description: text(),
	permissions: jsonb().default([]),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("UQ_648e3f5447f725579d7d4ffdfb7").on(table.name),
]);

export const media = pgTable("media", {
	id: serial().primaryKey().notNull(),
	fileKey: varchar({ length: 500 }).notNull(),
	url: varchar({ length: 500 }).notNull(),
	type: varchar({ length: 20 }).default('image').notNull(),
	mimeType: varchar({ length: 100 }),
	originalName: varchar({ length: 255 }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
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

export const employees = pgTable("employees", {
	id: serial().primaryKey().notNull(),
	position: varchar({ length: 50 }).notNull(),
	department: varchar({ length: 100 }),
	salary: numeric({ precision: 10, scale:  2 }),
	joinedAt: date(),
	status: varchar({ length: 20 }).default('active').notNull(),
	notes: text(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "FK_2d83c53c3e553a48dadb9722e38"
		}),
	unique("REL_2d83c53c3e553a48dadb9722e3").on(table.userId),
]);

export const withdrawals = pgTable("withdrawals", {
	id: serial().primaryKey().notNull(),
	withdrawRequestId: varchar({ length: 50 }).notNull(),
	userId: integer("user_id").notNull(),
	payoutMethodId: integer("payout_method_id"),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	type: varchar({ length: 20 }).default('cash'),
	status: varchar({ length: 20 }).default('pending'),
	rejectedReason: text(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "withdrawals_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.payoutMethodId],
			foreignColumns: [payoutMethods.id],
			name: "withdrawals_payout_method_id_fkey"
		}).onDelete("set null"),
	unique("withdrawals_withdrawRequestId_key").on(table.withdrawRequestId),
]);

export const payoutMethods = pgTable("payout_methods", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	type: varchar({ length: 30 }).default('bank'),
	bankId: varchar({ length: 50 }).notNull(),
	bankName: varchar({ length: 150 }).notNull(),
	accountNumber: varchar({ length: 50 }).notNull(),
	accountHolder: varchar({ length: 150 }).notNull(),
	passbookUrl: varchar({ length: 500 }),
	isDefault: boolean().default(false),
	isVerified: boolean().default(true),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow(),
	promptpayNumber: varchar({ length: 30 }),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "payout_methods_user_id_fkey"
		}).onDelete("cascade"),
]);

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
	balance: numeric({ precision: 12, scale:  2 }).default('0.00'),
	preferences: jsonb().default({}),
	twoFactorEnabled: boolean().default(false),
	betterAuthId: varchar("better_auth_id", { length: 255 }),
	tierId: integer("tier_id").default(1),
	currentMonthSales: numeric("current_month_sales", { precision: 12, scale:  2 }).default('0.00'),
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
	foreignKey({
			columns: [table.tierId],
			foreignColumns: [creatorTiers.id],
			name: "users_tier_id_fkey"
		}),
	unique("UQ_fe0bb3f6520ee0469504521e710").on(table.username),
	unique("UQ_97672ac88f789774dd47f7c8be3").on(table.email),
]);

export const mainCategories = pgTable("main_categories", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	slug: varchar({ length: 120 }).notNull(),
	description: text(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("UQ_9c82ec8e7aeebffb32f79b57591").on(table.name),
	unique("UQ_927937f1cdcf5cde08565652664").on(table.slug),
]);

export const subCategories = pgTable("sub_categories", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	slug: varchar({ length: 120 }).notNull(),
	description: text(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	mainCategoryId: integer("main_category_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.mainCategoryId],
			foreignColumns: [mainCategories.id],
			name: "FK_983e9e4557905013353e9118a52"
		}).onDelete("cascade"),
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

export const authVerifications = pgTable("auth_verifications", {
	id: varchar({ length: 64 }).primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_auth_verifications_identifier").using("btree", table.identifier.asc().nullsLast().op("text_ops")),
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

export const creatorTiers = pgTable("creator_tiers", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 50 }).notNull(),
	badgeColor: varchar("badge_color", { length: 30 }).default('amber'),
	minMonthlySales: numeric("min_monthly_sales", { precision: 12, scale:  2 }).default('0.00').notNull(),
	commissionFeePercent: numeric("commission_fee_percent", { precision: 5, scale:  2 }).default('5.00').notNull(),
	perks: jsonb().default([]),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	unique("creator_tiers_name_key").on(table.name),
]);

export const payments = pgTable("payments", {
	id: serial().primaryKey().notNull(),
	orderId: integer("order_id").notNull(),
	paymentMethod: varchar("payment_method", { length: 30 }).notNull(),
	gatewayProvider: varchar("gateway_provider", { length: 30 }).default('promptpay_qr'),
	gatewayTxId: varchar("gateway_tx_id", { length: 255 }),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: varchar({ length: 10 }).default('thb'),
	status: varchar({ length: 20 }).default('pending'),
	qrCodeUrl: text("qr_code_url"),
	paidAt: timestamp("paid_at", { mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "payments_order_id_fkey"
		}).onDelete("cascade"),
]);

export const tags = pgTable("tags", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	usageCount: integer("usage_count").default(0),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_tags_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
	index("idx_tags_usage_count").using("btree", table.usageCount.desc().nullsFirst().op("int4_ops")),
	unique("tags_name_key").on(table.name),
]);

export const reports = pgTable("reports", {
	id: serial().primaryKey().notNull(),
	reporterId: integer("reporter_id"),
	targetType: varchar("target_type", { length: 50 }).notNull(),
	targetId: integer("target_id").notNull(),
	reasonId: integer("reason_id"),
	reasonTitle: varchar("reason_title", { length: 255 }),
	details: text(),
	status: varchar({ length: 20 }).default('pending'),
	adminNotes: text("admin_notes"),
	reviewedBy: integer("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_reports_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_reports_target").using("btree", table.targetType.asc().nullsLast().op("int4_ops"), table.targetId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.reporterId],
			foreignColumns: [users.id],
			name: "reports_reporter_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.reasonId],
			foreignColumns: [reportReasons.id],
			name: "reports_reason_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "reports_reviewed_by_fkey"
		}).onDelete("set null"),
]);

export const reportReasons = pgTable("report_reasons", {
	id: serial().primaryKey().notNull(),
	targetType: varchar("target_type", { length: 50 }).default('all').notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	orderIndex: integer("order_index").default(0),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_report_reasons_target").using("btree", table.targetType.asc().nullsLast().op("text_ops"), table.isActive.asc().nullsLast().op("text_ops")),
]);

export const bids = pgTable("bids", {
	id: serial().primaryKey().notNull(),
	productId: integer("product_id").notNull(),
	userId: integer("user_id").notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "bids_product_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "bids_user_id_fkey"
		}).onDelete("cascade"),
]);

export const wallets = pgTable("wallets", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	cashBalance: numeric("cash_balance", { precision: 12, scale:  2 }).default('0.00'),
	pendingBalance: numeric("pending_balance", { precision: 12, scale:  2 }).default('0.00'),
	totalEarned: numeric("total_earned", { precision: 12, scale:  2 }).default('0.00'),
	totalWithdrawn: numeric("total_withdrawn", { precision: 12, scale:  2 }).default('0.00'),
	currency: varchar({ length: 10 }).default('thb'),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "wallets_user_id_fkey"
		}).onDelete("cascade"),
	unique("wallets_user_id_key").on(table.userId),
	check("wallets_cash_balance_check", sql`cash_balance >= (0)::numeric`),
	check("wallets_pending_balance_check", sql`pending_balance >= (0)::numeric`),
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
	foreignKey({
			columns: [table.serviceId],
			foreignColumns: [products.id],
			name: "posts_service_id_fkey"
		}).onDelete("set null"),
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

export const conversations = pgTable("conversations", {
	id: serial().primaryKey().notNull(),
	type: varchar({ length: 20 }).default('direct'),
	title: varchar({ length: 255 }),
	avatar: varchar({ length: 500 }),
	createdBy: integer("created_by"),
	lastMessageText: text("last_message_text"),
	lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_conversations_last_msg").using("btree", table.lastMessageAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_conversations_type").using("btree", table.type.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "conversations_created_by_fkey"
		}).onDelete("set null"),
]);

export const conversationParticipants = pgTable("conversation_participants", {
	id: serial().primaryKey().notNull(),
	conversationId: integer("conversation_id").notNull(),
	userId: integer("user_id").notNull(),
	role: varchar({ length: 20 }).default('member'),
	lastReadAt: timestamp("last_read_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	unreadCount: integer("unread_count").default(0),
	isMuted: boolean("is_muted").default(false),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_conv_part_conv").using("btree", table.conversationId.asc().nullsLast().op("int4_ops")),
	index("idx_conv_part_user").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "conversation_participants_conversation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "conversation_participants_user_id_fkey"
		}).onDelete("cascade"),
	unique("conversation_participants_conversation_id_user_id_key").on(table.conversationId, table.userId),
]);

export const messages = pgTable("messages", {
	id: serial().primaryKey().notNull(),
	conversationId: integer("conversation_id").notNull(),
	senderId: integer("sender_id"),
	messageType: varchar("message_type", { length: 20 }).default('text'),
	content: text().notNull(),
	attachments: jsonb().default([]),
	isDeleted: boolean("is_deleted").default(false),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_messages_conv_created").using("btree", table.conversationId.asc().nullsLast().op("int4_ops"), table.createdAt.asc().nullsLast().op("int4_ops")),
	index("idx_messages_sender").using("btree", table.senderId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "messages_conversation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [users.id],
			name: "messages_sender_id_fkey"
		}).onDelete("set null"),
]);

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
	index("idx_notifications_is_read").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.isRead.asc().nullsLast().op("int4_ops")),
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

export const stories = pgTable("stories", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	mediaUrl: text("media_url").notNull(),
	mediaType: varchar("media_type", { length: 20 }).default('image'),
	caption: text(),
	viewsCount: integer("views_count").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).default(sql`(now() + '24:00:00'::interval)`),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "stories_user_id_fkey"
		}).onDelete("cascade"),
]);

export const storyViews = pgTable("story_views", {
	id: serial().primaryKey().notNull(),
	storyId: integer("story_id").notNull(),
	userId: integer("user_id").notNull(),
	viewedAt: timestamp("viewed_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.storyId],
			foreignColumns: [stories.id],
			name: "story_views_story_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "story_views_user_id_fkey"
		}).onDelete("cascade"),
	unique("story_views_story_id_user_id_key").on(table.storyId, table.userId),
]);

export const storyLikes = pgTable("story_likes", {
	id: serial().primaryKey().notNull(),
	storyId: integer("story_id").notNull(),
	userId: integer("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.storyId],
			foreignColumns: [stories.id],
			name: "story_likes_story_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "story_likes_user_id_fkey"
		}).onDelete("cascade"),
	unique("story_likes_story_id_user_id_key").on(table.storyId, table.userId),
]);
