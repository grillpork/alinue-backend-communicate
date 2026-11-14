-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "wishlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	CONSTRAINT "UQ_9c64a981c56ba677ac17f5fba6f" UNIQUE("product_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"paymentIntentId" varchar(255),
	"paymentMethod" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'thb' NOT NULL,
	"metadata" jsonb,
	"paidAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"user_id" integer NOT NULL,
	"order_id" integer,
	"wallet_id" integer,
	"type" varchar(30) DEFAULT 'sale_earning',
	"balanceAfter" numeric(12, 2) DEFAULT '0.00',
	"referenceType" varchar(50),
	"referenceId" integer,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"priceAtPurchase" numeric(10, 2) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"licenseType" varchar(50) DEFAULT 'personal',
	"licenseKey" varchar(100),
	"tierName" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"totalAmount" numeric(10, 2) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"buyer_id" integer NOT NULL,
	"subtotalAmount" numeric(10, 2) DEFAULT '0.00',
	"vatAmount" numeric(10, 2) DEFAULT '0.00'
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"imageUrls" jsonb DEFAULT '[]'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"reviewer_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"order_id" integer
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"slug" varchar(220) NOT NULL,
	"description" text,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"thumbnailUrl" varchar(500),
	"imageUrls" jsonb DEFAULT '[]'::jsonb,
	"isPublished" boolean DEFAULT false NOT NULL,
	"downloadCount" integer DEFAULT 0 NOT NULL,
	"viewCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"creator_id" integer NOT NULL,
	"priceType" varchar(10) DEFAULT 'fixed' NOT NULL,
	"minPrice" numeric(10, 2),
	"licenses" jsonb DEFAULT '[{"id":"personal","name":"Personal License","checked":true}]'::jsonb,
	"deliverableFiles" jsonb DEFAULT '[]'::jsonb,
	"main_category_id" integer,
	"sub_category_id" integer,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"isExclusive" boolean DEFAULT false,
	"saleType" varchar(30) DEFAULT 'non-exclusive',
	"startBid" numeric(10, 2),
	"auctionDurationHours" integer DEFAULT 24,
	"milestones" jsonb DEFAULT '[]'::jsonb,
	"autoBuyTiers" jsonb DEFAULT '[]'::jsonb,
	"copyType" varchar(20) DEFAULT 'multiple',
	"auctionEndTime" timestamp with time zone,
	"scheduledOpenAt" timestamp with time zone,
	"scheduledCloseAt" timestamp with time zone,
	CONSTRAINT "UQ_464f927ae360106b783ed0b4106" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "kyc_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"nationality" varchar(50) DEFAULT 'thai',
	"idType" varchar(50) DEFAULT 'national_id',
	"title" varchar(20) DEFAULT 'mr',
	"firstName" varchar(100) NOT NULL,
	"lastName" varchar(100) NOT NULL,
	"idNumber" varchar(50) NOT NULL,
	"birthDate" varchar(50),
	"laserCode" varchar(50),
	"address" text,
	"idCardUrl" varchar(500),
	"selfieUrl" varchar(500),
	"status" varchar(20) DEFAULT 'pending',
	"rejectedReason" text,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "UQ_648e3f5447f725579d7d4ffdfb7" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"fileKey" varchar(500) NOT NULL,
	"url" varchar(500) NOT NULL,
	"type" varchar(20) DEFAULT 'image' NOT NULL,
	"mimeType" varchar(100),
	"originalName" varchar(255),
	"size" bigint,
	"width" integer,
	"height" integer,
	"entityType" varchar(50),
	"entityId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"uploaded_by" integer
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"position" varchar(50) NOT NULL,
	"department" varchar(100),
	"salary" numeric(10, 2),
	"joinedAt" date,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "REL_2d83c53c3e553a48dadb9722e3" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" serial PRIMARY KEY NOT NULL,
	"withdrawRequestId" varchar(50) NOT NULL,
	"user_id" integer NOT NULL,
	"payout_method_id" integer,
	"amount" numeric(12, 2) NOT NULL,
	"type" varchar(20) DEFAULT 'cash',
	"status" varchar(20) DEFAULT 'pending',
	"rejectedReason" text,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "withdrawals_withdrawRequestId_key" UNIQUE("withdrawRequestId")
);
--> statement-breakpoint
CREATE TABLE "payout_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(30) DEFAULT 'bank',
	"bankId" varchar(50) NOT NULL,
	"bankName" varchar(150) NOT NULL,
	"accountNumber" varchar(50) NOT NULL,
	"accountHolder" varchar(150) NOT NULL,
	"passbookUrl" varchar(500),
	"isDefault" boolean DEFAULT false,
	"isVerified" boolean DEFAULT true,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	"promptpayNumber" varchar(30)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(100) NOT NULL,
	"email" varchar(150) NOT NULL,
	"password" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"displayName" varchar(150),
	"avatarUrl" varchar(500),
	"isVerified" boolean DEFAULT false NOT NULL,
	"isBanned" boolean DEFAULT false NOT NULL,
	"role_id" integer,
	"bio" text,
	"location" varchar(255),
	"banner" varchar(500),
	"artstation" varchar(255),
	"twitter" varchar(255),
	"discord" varchar(255),
	"phone" varchar(50),
	"website" varchar(255),
	"balance" numeric(12, 2) DEFAULT '0.00',
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"twoFactorEnabled" boolean DEFAULT false,
	"better_auth_id" varchar(255),
	"tier_id" integer DEFAULT 1,
	"current_month_sales" numeric(12, 2) DEFAULT '0.00',
	"social_links" jsonb DEFAULT '{}'::jsonb,
	"note" varchar(100),
	"note_updated_at" timestamp,
	"sub_cover" text,
	"sub_cover_type" varchar(50) DEFAULT 'image',
	CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE("username"),
	CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "main_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "UQ_9c82ec8e7aeebffb32f79b57591" UNIQUE("name"),
	CONSTRAINT "UQ_927937f1cdcf5cde08565652664" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sub_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"main_category_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" varchar(255) NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"ipAddress" varchar(100),
	"userAgent" text,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sessions_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"id" serial PRIMARY KEY NOT NULL,
	"follower_id" integer NOT NULL,
	"following_id" integer NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	CONSTRAINT "follows_follower_id_following_id_key" UNIQUE("follower_id","following_id"),
	CONSTRAINT "follows_check" CHECK (follower_id <> following_id)
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"expiresAt" timestamp with time zone,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "creator_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"badge_color" varchar(30) DEFAULT 'amber',
	"min_monthly_sales" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"commission_fee_percent" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"perks" jsonb DEFAULT '[]'::jsonb,
	"createdAt" timestamp DEFAULT now(),
	CONSTRAINT "creator_tiers_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"payment_method" varchar(30) NOT NULL,
	"gateway_provider" varchar(30) DEFAULT 'promptpay_qr',
	"gateway_tx_id" varchar(255),
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'thb',
	"status" varchar(20) DEFAULT 'pending',
	"qr_code_url" text,
	"paid_at" timestamp,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"usage_count" integer DEFAULT 0,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "tags_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_id" integer,
	"target_type" varchar(50) NOT NULL,
	"target_id" integer NOT NULL,
	"reason_id" integer,
	"reason_title" varchar(255),
	"details" text,
	"status" varchar(20) DEFAULT 'pending',
	"admin_notes" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "report_reasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" varchar(50) DEFAULT 'all' NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"order_index" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"cash_balance" numeric(12, 2) DEFAULT '0.00',
	"pending_balance" numeric(12, 2) DEFAULT '0.00',
	"total_earned" numeric(12, 2) DEFAULT '0.00',
	"total_withdrawn" numeric(12, 2) DEFAULT '0.00',
	"currency" varchar(10) DEFAULT 'thb',
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "wallets_user_id_key" UNIQUE("user_id"),
	CONSTRAINT "wallets_cash_balance_check" CHECK (cash_balance >= (0)::numeric),
	CONSTRAINT "wallets_pending_balance_check" CHECK (pending_balance >= (0)::numeric)
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"caption" text,
	"media_urls" jsonb DEFAULT '[]'::jsonb,
	"service_id" integer,
	"service_title" varchar(255),
	"collaborators" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"client_name" varchar(255),
	"likes_count" integer DEFAULT 0,
	"views_count" integer DEFAULT 0,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now(),
	"shares_count" integer DEFAULT 0,
	"comments_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "post_likes" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	CONSTRAINT "post_likes_post_id_user_id_key" UNIQUE("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(20) DEFAULT 'direct',
	"title" varchar(255),
	"avatar" varchar(500),
	"created_by" integer,
	"last_message_text" text,
	"last_message_at" timestamp with time zone DEFAULT now(),
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(20) DEFAULT 'member',
	"last_read_at" timestamp with time zone DEFAULT now(),
	"unread_count" integer DEFAULT 0,
	"is_muted" boolean DEFAULT false,
	"joined_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "conversation_participants_conversation_id_user_id_key" UNIQUE("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"sender_id" integer,
	"message_type" varchar(20) DEFAULT 'text',
	"content" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"is_deleted" boolean DEFAULT false,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "search_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"query" varchar(255) NOT NULL,
	"user_id" integer,
	"search_type" varchar(50) DEFAULT 'all',
	"result_count" integer DEFAULT 0,
	"ip_address" varchar(100),
	"createdAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "showcases" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media_type" varchar(50) DEFAULT 'image',
	"cover_url" varchar(1000),
	"tags" jsonb DEFAULT '[]'::jsonb,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"views_count" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "showcase_likes" (
	"id" serial PRIMARY KEY NOT NULL,
	"showcase_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	CONSTRAINT "showcase_likes_showcase_id_user_id_key" UNIQUE("showcase_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now(),
	"portfolio_attachment" jsonb
);
--> statement-breakpoint
CREATE TABLE "moderation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"ip_address" varchar(100),
	"file_key" varchar(255),
	"image_url" text,
	"reasons" jsonb,
	"scores" jsonb,
	"is_safe" boolean DEFAULT false,
	"action_taken" varchar(50) DEFAULT 'rejected',
	"createdAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "moderation_appeals" (
	"id" serial PRIMARY KEY NOT NULL,
	"log_id" integer,
	"user_id" integer,
	"ip_address" varchar(100),
	"image_url" text,
	"file_key" varchar(255),
	"reasons" jsonb,
	"appeal_reason" text NOT NULL,
	"status" varchar(30) DEFAULT 'pending',
	"reviewer_id" integer,
	"reviewer_note" text,
	"reviewed_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"actor_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"entity_id" integer,
	"entity_type" varchar(50),
	"message" text,
	"is_read" boolean DEFAULT false,
	"createdAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "post_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"user_id" integer,
	"platform" varchar(50) DEFAULT 'link',
	"createdAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"media_url" text NOT NULL,
	"media_type" varchar(20) DEFAULT 'image',
	"caption" text,
	"views_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone DEFAULT (now() + '24:00:00'::interval)
);
--> statement-breakpoint
CREATE TABLE "story_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"story_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "story_views_story_id_user_id_key" UNIQUE("story_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "story_likes" (
	"id" serial PRIMARY KEY NOT NULL,
	"story_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "story_likes_story_id_user_id_key" UNIQUE("story_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "FK_b5e6331a1a7d61c25d7a25cab8f" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "FK_2662acbb3868b1f0077fda61dd2" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "FK_e9acc6efa76de013e8c1553ed2b" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "FK_3cb0558ed36997f1d9ecc1118e7" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "FK_5e90e93d0e036c3fadbaefa4d0a" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "FK_92e950a2513a79bb3fab273c92e" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "FK_9482e9567d8dcc2bc615981ef44" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "FK_db887c3b31abbbd920e303a0179" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "FK_c4c3b08a0a1e609972a2c6d676d" FOREIGN KEY ("main_category_id") REFERENCES "public"."main_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "FK_3fffb0be83ac483af3a55f41170" FOREIGN KEY ("sub_category_id") REFERENCES "public"."sub_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "FK_8468de6d91985f53a1a3324741c" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "FK_2d83c53c3e553a48dadb9722e38" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_payout_method_id_fkey" FOREIGN KEY ("payout_method_id") REFERENCES "public"."payout_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "FK_a2cecd1a3531c0b041e29ba46e1" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "public"."creator_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_categories" ADD CONSTRAINT "FK_983e9e4557905013353e9118a52" FOREIGN KEY ("main_category_id") REFERENCES "public"."main_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "public"."report_reasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_logs" ADD CONSTRAINT "search_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcases" ADD CONSTRAINT "showcases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_likes" ADD CONSTRAINT "showcase_likes_showcase_id_fkey" FOREIGN KEY ("showcase_id") REFERENCES "public"."showcases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_likes" ADD CONSTRAINT "showcase_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_shares" ADD CONSTRAINT "post_shares_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_shares" ADD CONSTRAINT "post_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_likes" ADD CONSTRAINT "story_likes_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_likes" ADD CONSTRAINT "story_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sessions_expires_at" ON "sessions" USING btree ("expiresAt" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_token" ON "sessions" USING btree ("token" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_follows_follower" ON "follows" USING btree ("follower_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_follows_following" ON "follows" USING btree ("following_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_auth_verifications_identifier" ON "auth_verifications" USING btree ("identifier" text_ops);--> statement-breakpoint
CREATE INDEX "idx_accounts_user_id" ON "accounts" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_tags_name" ON "tags" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX "idx_tags_usage_count" ON "tags" USING btree ("usage_count" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_reports_status" ON "reports" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_reports_target" ON "reports" USING btree ("target_type" int4_ops,"target_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_report_reasons_target" ON "report_reasons" USING btree ("target_type" text_ops,"is_active" text_ops);--> statement-breakpoint
CREATE INDEX "idx_posts_created_at" ON "posts" USING btree ("createdAt" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_posts_user_id" ON "posts" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_post_likes_post_id" ON "post_likes" USING btree ("post_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_post_likes_user_id" ON "post_likes" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_conversations_last_msg" ON "conversations" USING btree ("last_message_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_conversations_type" ON "conversations" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_conv_part_conv" ON "conversation_participants" USING btree ("conversation_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_conv_part_user" ON "conversation_participants" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_messages_conv_created" ON "messages" USING btree ("conversation_id" int4_ops,"createdAt" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_messages_sender" ON "messages" USING btree ("sender_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_search_logs_created_at" ON "search_logs" USING btree ("createdAt" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_search_logs_query" ON "search_logs" USING btree ("query" text_ops);--> statement-breakpoint
CREATE INDEX "idx_search_logs_user_id" ON "search_logs" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_showcases_created_at" ON "showcases" USING btree ("createdAt" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_showcases_user_id" ON "showcases" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_showcase_likes_showcase_id" ON "showcase_likes" USING btree ("showcase_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_showcase_likes_user_id" ON "showcase_likes" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_post_comments_created_at" ON "post_comments" USING btree ("createdAt" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_post_comments_post_id" ON "post_comments" USING btree ("post_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_post_comments_user_id" ON "post_comments" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_created_at" ON "notifications" USING btree ("createdAt" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_is_read" ON "notifications" USING btree ("user_id" int4_ops,"is_read" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_user_id" ON "notifications" USING btree ("user_id" int4_ops);
*/