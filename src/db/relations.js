import { relations } from "drizzle-orm/relations";
import {
	roles,
	users,
	sessions,
	accounts,
	follows,
	media,
	posts,
	postLikes,
	postComments,
	postShares,
	showcases,
	showcaseLikes,
	notifications,
	searchLogs,
	services,
	serviceLikes
} from "./schema.js";

export const rolesRelations = relations(roles, ({ many }) => ({
	users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
	role: one(roles, {
		fields: [users.roleId],
		references: [roles.id]
	}),
	sessions: many(sessions),
	accounts: many(accounts),
	follows_followerId: many(follows, {
		relationName: "follows_followerId_users_id"
	}),
	follows_followingId: many(follows, {
		relationName: "follows_followingId_users_id"
	}),
	media: many(media),
	posts: many(posts),
	postLikes: many(postLikes),
	postComments: many(postComments),
	postShares: many(postShares),
	showcases: many(showcases),
	showcaseLikes: many(showcaseLikes),
	services: many(services),
	serviceLikes: many(serviceLikes),
	notifications_userId: many(notifications, {
		relationName: "notifications_userId_users_id"
	}),
	notifications_actorId: many(notifications, {
		relationName: "notifications_actorId_users_id"
	}),
	searchLogs: many(searchLogs),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id]
	}),
}));

export const followsRelations = relations(follows, ({ one }) => ({
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

export const mediaRelations = relations(media, ({ one }) => ({
	user: one(users, {
		fields: [media.uploadedBy],
		references: [users.id]
	}),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
	user: one(users, {
		fields: [posts.userId],
		references: [users.id]
	}),
	postLikes: many(postLikes),
	postComments: many(postComments),
	postShares: many(postShares),
}));

export const postLikesRelations = relations(postLikes, ({ one }) => ({
	post: one(posts, {
		fields: [postLikes.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postLikes.userId],
		references: [users.id]
	}),
}));

export const postCommentsRelations = relations(postComments, ({ one }) => ({
	post: one(posts, {
		fields: [postComments.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postComments.userId],
		references: [users.id]
	}),
}));

export const postSharesRelations = relations(postShares, ({ one }) => ({
	post: one(posts, {
		fields: [postShares.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postShares.userId],
		references: [users.id]
	}),
}));

export const showcasesRelations = relations(showcases, ({ one, many }) => ({
	user: one(users, {
		fields: [showcases.userId],
		references: [users.id]
	}),
	showcaseLikes: many(showcaseLikes),
}));

export const showcaseLikesRelations = relations(showcaseLikes, ({ one }) => ({
	showcase: one(showcases, {
		fields: [showcaseLikes.showcaseId],
		references: [showcases.id]
	}),
	user: one(users, {
		fields: [showcaseLikes.userId],
		references: [users.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
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

export const searchLogsRelations = relations(searchLogs, ({ one }) => ({
	user: one(users, {
		fields: [searchLogs.userId],
		references: [users.id]
	}),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
	user: one(users, {
		fields: [services.userId],
		references: [users.id]
	}),
	serviceLikes: many(serviceLikes),
}));

export const serviceLikesRelations = relations(serviceLikes, ({ one }) => ({
	service: one(services, {
		fields: [serviceLikes.serviceId],
		references: [services.id]
	}),
	user: one(users, {
		fields: [serviceLikes.userId],
		references: [users.id]
	}),
}));


