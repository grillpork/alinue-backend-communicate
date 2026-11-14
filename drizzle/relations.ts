import { relations } from "drizzle-orm/relations";
import { users, wishlists, products, transactions, orders, wallets, orderItems, reviews, mainCategories, subCategories, kycVerifications, media, employees, withdrawals, payoutMethods, roles, creatorTiers, sessions, follows, accounts, payments, reports, reportReasons, bids, posts, postLikes, conversations, conversationParticipants, messages, searchLogs, showcases, showcaseLikes, postComments, notifications, postShares, stories, storyViews, storyLikes } from "./schema";

export const wishlistsRelations = relations(wishlists, ({one}) => ({
	user: one(users, {
		fields: [wishlists.userId],
		references: [users.id]
	}),
	product: one(products, {
		fields: [wishlists.productId],
		references: [products.id]
	}),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	wishlists: many(wishlists),
	transactions: many(transactions),
	orders: many(orders),
	reviews: many(reviews),
	products: many(products),
	kycVerifications_userId: many(kycVerifications, {
		relationName: "kycVerifications_userId_users_id"
	}),
	kycVerifications_reviewedBy: many(kycVerifications, {
		relationName: "kycVerifications_reviewedBy_users_id"
	}),
	media: many(media),
	employees: many(employees),
	withdrawals: many(withdrawals),
	payoutMethods: many(payoutMethods),
	role: one(roles, {
		fields: [users.roleId],
		references: [roles.id]
	}),
	creatorTier: one(creatorTiers, {
		fields: [users.tierId],
		references: [creatorTiers.id]
	}),
	sessions: many(sessions),
	follows_followerId: many(follows, {
		relationName: "follows_followerId_users_id"
	}),
	follows_followingId: many(follows, {
		relationName: "follows_followingId_users_id"
	}),
	accounts: many(accounts),
	reports_reporterId: many(reports, {
		relationName: "reports_reporterId_users_id"
	}),
	reports_reviewedBy: many(reports, {
		relationName: "reports_reviewedBy_users_id"
	}),
	bids: many(bids),
	wallets: many(wallets),
	posts: many(posts),
	postLikes: many(postLikes),
	conversations: many(conversations),
	conversationParticipants: many(conversationParticipants),
	messages: many(messages),
	searchLogs: many(searchLogs),
	showcases: many(showcases),
	showcaseLikes: many(showcaseLikes),
	postComments: many(postComments),
	notifications_userId: many(notifications, {
		relationName: "notifications_userId_users_id"
	}),
	notifications_actorId: many(notifications, {
		relationName: "notifications_actorId_users_id"
	}),
	postShares: many(postShares),
	stories: many(stories),
	storyViews: many(storyViews),
	storyLikes: many(storyLikes),
}));

export const productsRelations = relations(products, ({one, many}) => ({
	wishlists: many(wishlists),
	orderItems: many(orderItems),
	reviews: many(reviews),
	user: one(users, {
		fields: [products.creatorId],
		references: [users.id]
	}),
	mainCategory: one(mainCategories, {
		fields: [products.mainCategoryId],
		references: [mainCategories.id]
	}),
	subCategory: one(subCategories, {
		fields: [products.subCategoryId],
		references: [subCategories.id]
	}),
	bids: many(bids),
	posts: many(posts),
}));

export const transactionsRelations = relations(transactions, ({one}) => ({
	user: one(users, {
		fields: [transactions.userId],
		references: [users.id]
	}),
	order: one(orders, {
		fields: [transactions.orderId],
		references: [orders.id]
	}),
	wallet: one(wallets, {
		fields: [transactions.walletId],
		references: [wallets.id]
	}),
}));

export const ordersRelations = relations(orders, ({one, many}) => ({
	transactions: many(transactions),
	orderItems: many(orderItems),
	user: one(users, {
		fields: [orders.buyerId],
		references: [users.id]
	}),
	reviews: many(reviews),
	payments: many(payments),
}));

export const walletsRelations = relations(wallets, ({one, many}) => ({
	transactions: many(transactions),
	user: one(users, {
		fields: [wallets.userId],
		references: [users.id]
	}),
}));

export const orderItemsRelations = relations(orderItems, ({one}) => ({
	order: one(orders, {
		fields: [orderItems.orderId],
		references: [orders.id]
	}),
	product: one(products, {
		fields: [orderItems.productId],
		references: [products.id]
	}),
}));

export const reviewsRelations = relations(reviews, ({one}) => ({
	user: one(users, {
		fields: [reviews.reviewerId],
		references: [users.id]
	}),
	product: one(products, {
		fields: [reviews.productId],
		references: [products.id]
	}),
	order: one(orders, {
		fields: [reviews.orderId],
		references: [orders.id]
	}),
}));

export const mainCategoriesRelations = relations(mainCategories, ({many}) => ({
	products: many(products),
	subCategories: many(subCategories),
}));

export const subCategoriesRelations = relations(subCategories, ({one, many}) => ({
	products: many(products),
	mainCategory: one(mainCategories, {
		fields: [subCategories.mainCategoryId],
		references: [mainCategories.id]
	}),
}));

export const kycVerificationsRelations = relations(kycVerifications, ({one}) => ({
	user_userId: one(users, {
		fields: [kycVerifications.userId],
		references: [users.id],
		relationName: "kycVerifications_userId_users_id"
	}),
	user_reviewedBy: one(users, {
		fields: [kycVerifications.reviewedBy],
		references: [users.id],
		relationName: "kycVerifications_reviewedBy_users_id"
	}),
}));

export const mediaRelations = relations(media, ({one}) => ({
	user: one(users, {
		fields: [media.uploadedBy],
		references: [users.id]
	}),
}));

export const employeesRelations = relations(employees, ({one}) => ({
	user: one(users, {
		fields: [employees.userId],
		references: [users.id]
	}),
}));

export const withdrawalsRelations = relations(withdrawals, ({one}) => ({
	user: one(users, {
		fields: [withdrawals.userId],
		references: [users.id]
	}),
	payoutMethod: one(payoutMethods, {
		fields: [withdrawals.payoutMethodId],
		references: [payoutMethods.id]
	}),
}));

export const payoutMethodsRelations = relations(payoutMethods, ({one, many}) => ({
	withdrawals: many(withdrawals),
	user: one(users, {
		fields: [payoutMethods.userId],
		references: [users.id]
	}),
}));

export const rolesRelations = relations(roles, ({many}) => ({
	users: many(users),
}));

export const creatorTiersRelations = relations(creatorTiers, ({many}) => ({
	users: many(users),
}));

export const sessionsRelations = relations(sessions, ({one}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
}));

export const followsRelations = relations(follows, ({one}) => ({
	user_followerId: one(users, {
		fields: [follows.followerId],
		references: [users.id],
		relationName: "follows_followerId_users_id"
	}),
	user_followingId: one(users, {
		fields: [follows.followingId],
		references: [users.id],
		relationName: "follows_followingId_users_id"
	}),
}));

export const accountsRelations = relations(accounts, ({one}) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id]
	}),
}));

export const paymentsRelations = relations(payments, ({one}) => ({
	order: one(orders, {
		fields: [payments.orderId],
		references: [orders.id]
	}),
}));

export const reportsRelations = relations(reports, ({one}) => ({
	user_reporterId: one(users, {
		fields: [reports.reporterId],
		references: [users.id],
		relationName: "reports_reporterId_users_id"
	}),
	reportReason: one(reportReasons, {
		fields: [reports.reasonId],
		references: [reportReasons.id]
	}),
	user_reviewedBy: one(users, {
		fields: [reports.reviewedBy],
		references: [users.id],
		relationName: "reports_reviewedBy_users_id"
	}),
}));

export const reportReasonsRelations = relations(reportReasons, ({many}) => ({
	reports: many(reports),
}));

export const bidsRelations = relations(bids, ({one}) => ({
	product: one(products, {
		fields: [bids.productId],
		references: [products.id]
	}),
	user: one(users, {
		fields: [bids.userId],
		references: [users.id]
	}),
}));

export const postsRelations = relations(posts, ({one, many}) => ({
	user: one(users, {
		fields: [posts.userId],
		references: [users.id]
	}),
	product: one(products, {
		fields: [posts.serviceId],
		references: [products.id]
	}),
	postLikes: many(postLikes),
	postComments: many(postComments),
	postShares: many(postShares),
}));

export const postLikesRelations = relations(postLikes, ({one}) => ({
	post: one(posts, {
		fields: [postLikes.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postLikes.userId],
		references: [users.id]
	}),
}));

export const conversationsRelations = relations(conversations, ({one, many}) => ({
	user: one(users, {
		fields: [conversations.createdBy],
		references: [users.id]
	}),
	conversationParticipants: many(conversationParticipants),
	messages: many(messages),
}));

export const conversationParticipantsRelations = relations(conversationParticipants, ({one}) => ({
	conversation: one(conversations, {
		fields: [conversationParticipants.conversationId],
		references: [conversations.id]
	}),
	user: one(users, {
		fields: [conversationParticipants.userId],
		references: [users.id]
	}),
}));

export const messagesRelations = relations(messages, ({one}) => ({
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id]
	}),
	user: one(users, {
		fields: [messages.senderId],
		references: [users.id]
	}),
}));

export const searchLogsRelations = relations(searchLogs, ({one}) => ({
	user: one(users, {
		fields: [searchLogs.userId],
		references: [users.id]
	}),
}));

export const showcasesRelations = relations(showcases, ({one, many}) => ({
	user: one(users, {
		fields: [showcases.userId],
		references: [users.id]
	}),
	showcaseLikes: many(showcaseLikes),
}));

export const showcaseLikesRelations = relations(showcaseLikes, ({one}) => ({
	showcase: one(showcases, {
		fields: [showcaseLikes.showcaseId],
		references: [showcases.id]
	}),
	user: one(users, {
		fields: [showcaseLikes.userId],
		references: [users.id]
	}),
}));

export const postCommentsRelations = relations(postComments, ({one}) => ({
	post: one(posts, {
		fields: [postComments.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postComments.userId],
		references: [users.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	user_userId: one(users, {
		fields: [notifications.userId],
		references: [users.id],
		relationName: "notifications_userId_users_id"
	}),
	user_actorId: one(users, {
		fields: [notifications.actorId],
		references: [users.id],
		relationName: "notifications_actorId_users_id"
	}),
}));

export const postSharesRelations = relations(postShares, ({one}) => ({
	post: one(posts, {
		fields: [postShares.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postShares.userId],
		references: [users.id]
	}),
}));

export const storiesRelations = relations(stories, ({one, many}) => ({
	user: one(users, {
		fields: [stories.userId],
		references: [users.id]
	}),
	storyViews: many(storyViews),
	storyLikes: many(storyLikes),
}));

export const storyViewsRelations = relations(storyViews, ({one}) => ({
	story: one(stories, {
		fields: [storyViews.storyId],
		references: [stories.id]
	}),
	user: one(users, {
		fields: [storyViews.userId],
		references: [users.id]
	}),
}));

export const storyLikesRelations = relations(storyLikes, ({one}) => ({
	story: one(stories, {
		fields: [storyLikes.storyId],
		references: [stories.id]
	}),
	user: one(users, {
		fields: [storyLikes.userId],
		references: [users.id]
	}),
}));