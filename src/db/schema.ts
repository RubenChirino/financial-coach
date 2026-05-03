import { relations, sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Ciphertext column: stores AES-256-GCM encrypted values as a base64 string.
 * Encryption/decryption happens at the application layer via lib/crypto.ts.
 * The column itself stores an opaque string — never plaintext.
 */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => value,
  fromDriver: (value) => value,
});

const timestamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pinHash: text("pin_hash").notNull(),
  pinSalt: text("pin_salt").notNull(),
  encryptionSalt: text("encryption_salt").notNull(),
  language: text("language", { enum: ["es", "en"] })
    .notNull()
    .default("es"),
  currency: text("currency").notNull().default("EUR"),
  llmProvider: text("llm_provider", { enum: ["ollama", "anthropic", "openai", "google"] })
    .notNull()
    .default("ollama"),
  llmModel: text("llm_model").notNull().default("qwen2.5:14b-instruct-q4_K_M"),
  cloudLlmConsentAt: integer("cloud_llm_consent_at", { mode: "timestamp_ms" }),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

/**
 * Persistent session store. Tokens are hashed at rest (SHA-256 of the raw
 * cookie value) so DB theft alone doesn't yield a valid cookie. The
 * encryption key derived from the PIN is wrapped with an APP_SECRET-derived
 * key and stored as `wrapped_key` — unwrapping needs APP_SECRET.
 *
 * This replaces an earlier in-process Map that was wiped on every dev-server
 * HMR / restart, causing "enter correct PIN → redirected back to /lock" loops.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tokenHash: text("token_hash").notNull().unique(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wrappedKey: text("wrapped_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("sessions_last_activity_idx").on(t.lastActivityAt)],
);

export const providerCredentials = sqliteTable(
  "provider_credentials",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    encryptedKey: encryptedText("encrypted_key").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [uniqueIndex("provider_credentials_user_provider_uniq").on(t.userId, t.provider)],
);

export const institutions = sqliteTable("institutions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gocardlessId: text("gocardless_id").notNull().unique(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  country: text("country").notNull(),
  addedAt: timestamp("added_at"),
});

export const requisitions = sqliteTable(
  "requisitions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutions.id, { onDelete: "cascade" }),
    /**
     * Bank data provider that owns this connection. Lets the app host multiple
     * providers side-by-side (real GoCardless Bank Account Data, Demo seeder
     * for previews, TrueLayer sandbox, …) on the same accounts/transactions
     * tables. Rows written before this column existed default to "gocardless".
     */
    provider: text("provider", { enum: ["gocardless", "demo", "truelayer"] })
      .notNull()
      .default("gocardless"),
    gocardlessRequisitionId: encryptedText("gocardless_requisition_id").notNull(),
    status: text("status", {
      enum: ["created", "linked", "expired", "suspended", "revoked"],
    })
      .notNull()
      .default("created"),
    reference: text("reference").notNull(),
    link: text("link"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("requisitions_institution_idx").on(t.institutionId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requisitionId: integer("requisition_id")
      .notNull()
      .references(() => requisitions.id, { onDelete: "cascade" }),
    gocardlessAccountId: encryptedText("gocardless_account_id").notNull(),
    ibanLast4: text("iban_last4"),
    name: text("name").notNull(),
    ownerName: text("owner_name"),
    balanceCents: integer("balance_cents", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("EUR"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("accounts_requisition_idx").on(t.requisitionId)],
);

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  nameEs: text("name_es").notNull(),
  nameEn: text("name_en").notNull(),
  icon: text("icon").notNull(),
  color: text("color").notNull(),
  parentId: integer("parent_id"),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(true),
  budgetMonthlyCents: integer("budget_monthly_cents", { mode: "number" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at"),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    gocardlessTransactionId: text("gocardless_transaction_id").notNull().unique(),
    bookingDate: integer("booking_date", { mode: "timestamp_ms" }).notNull(),
    valueDate: integer("value_date", { mode: "timestamp_ms" }),
    amountCents: integer("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    merchantName: text("merchant_name"),
    rawDescription: text("raw_description").notNull(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    subcategory: text("subcategory"),
    confidence: integer("confidence", { mode: "number" }),
    isRecurring: integer("is_recurring", { mode: "boolean" }).notNull().default(false),
    needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [
    index("transactions_account_date_idx").on(t.accountId, t.bookingDate),
    index("transactions_category_idx").on(t.categoryId),
    index("transactions_needs_review_idx").on(t.needsReview),
  ],
);

export const categoryRules = sqliteTable(
  "category_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchPattern: text("match_pattern").notNull(),
    matchType: text("match_type", {
      enum: ["contains", "regex", "merchant_exact"],
    }).notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(100),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("category_rules_priority_idx").on(t.priority)],
);

export const recurringSubscriptions = sqliteTable("recurring_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  merchantName: text("merchant_name").notNull(),
  averageAmountCents: integer("average_amount_cents", { mode: "number" }).notNull(),
  frequencyDays: integer("frequency_days").notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: timestamp("created_at"),
});

/**
 * Savings goals. Progress is tracked manually — the user bumps `saved_cents`
 * themselves (or from the advisor suggestion). No auto-link to accounts yet;
 * that can be wired in a later phase.
 */
export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  emoji: text("emoji").notNull().default("🎯"),
  targetCents: integer("target_cents", { mode: "number" }).notNull(),
  savedCents: integer("saved_cents", { mode: "number" }).notNull().default(0),
  /** Optional soft deadline shown as a countdown. */
  deadline: integer("deadline", { mode: "timestamp_ms" }),
  /** Optional link to a category — e.g. "reduce Dining spend toward this goal". */
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

/**
 * Persisted insights generated by the rule engine (Phase 7h).
 *
 * The rule engine writes one row per unique (kind + optional entityId) per
 * refresh cycle. Rows are idempotent — re-running the engine does NOT insert
 * duplicates. Users can dismiss individual insights; dismissed rows are kept
 * for 30 days then pruned.
 */
export const insights = sqliteTable(
  "insights",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", {
      enum: [
        "overspend",
        "needs_review",
        "unusual_tx",
        "recurring_increase",
        "low_balance",
        "on_track",
        "goal_near",
      ],
    }).notNull(),
    /** Dismissal timestamp; null = not yet dismissed. */
    dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }),
    /** Optional reference: category id, account id, goal id, etc. */
    entityId: integer("entity_id"),
    /** Short headline (pre-rendered in the user's stored language). */
    title: text("title").notNull(),
    /** One-paragraph body. */
    body: text("body").notNull(),
    actionLabel: text("action_label").notNull(),
    actionHref: text("action_href").notNull(),
    severity: text("severity", { enum: ["info", "warning", "positive"] })
      .notNull()
      .default("info"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("insights_kind_entity_idx").on(t.kind, t.entityId),
    index("insights_dismissed_idx").on(t.dismissedAt),
  ],
);

/**
 * Investor profile — answers to the questionnaire on /opportunities. The AI
 * Coach reads this as context to personalize the framing of educational
 * planning content (NOT to recommend specific instruments — see the system
 * prompt). At most one row per user; we upsert by `userId`.
 *
 * Storing free-text fields would invite the user to paste sensitive details;
 * we constrain everything to enums to keep the surface narrow.
 */
export const investorProfiles = sqliteTable("investor_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  ageRange: text("age_range", {
    enum: ["under_25", "25_34", "35_44", "45_54", "55_64", "65_plus"],
  }).notNull(),
  /** Years until the user expects to need this money. */
  horizon: text("horizon", {
    enum: ["under_1y", "1_3y", "3_7y", "7_15y", "over_15y"],
  }).notNull(),
  /** Self-rated reaction to a 20% drawdown. */
  riskTolerance: text("risk_tolerance", {
    enum: ["sell_all", "sell_some", "hold", "buy_more"],
  }).notNull(),
  /** Months of expenses currently held in liquid emergency funds. */
  emergencyFundMonths: text("emergency_fund_months", {
    enum: ["none", "under_3", "3_6", "over_6"],
  }).notNull(),
  dependents: text("dependents", { enum: ["none", "1_2", "3_plus"] }).notNull(),
  primaryGoal: text("primary_goal", {
    enum: ["emergency_fund", "house", "retirement", "education", "freedom", "other"],
  }).notNull(),
  /** User's own free-text note shown back to them, never sent to LLM. */
  note: text("note"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type Insight = typeof insights.$inferSelect;

export const goalsRelations = relations(goals, ({ one }) => ({
  category: one(categories, { fields: [goals.categoryId], references: [categories.id] }),
}));

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;

export const advisorConversations = sqliteTable("advisor_conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default(""),
  summary: text("summary").notNull().default(""),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const advisorMessages = sqliteTable(
  "advisor_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => advisorConversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    providerUsed: text("provider_used"),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("advisor_messages_conversation_idx").on(t.conversationId)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

export const institutionsRelations = relations(institutions, ({ many }) => ({
  requisitions: many(requisitions),
}));

export const requisitionsRelations = relations(requisitions, ({ one, many }) => ({
  institution: one(institutions, {
    fields: [requisitions.institutionId],
    references: [institutions.id],
  }),
  accounts: many(accounts),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  requisition: one(requisitions, {
    fields: [accounts.requisitionId],
    references: [requisitions.id],
  }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
}));

export const categoriesRelations = relations(categories, ({ many, one }) => ({
  transactions: many(transactions),
  rules: many(categoryRules),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
}));

export const advisorConversationsRelations = relations(advisorConversations, ({ many }) => ({
  messages: many(advisorMessages),
}));

export const advisorMessagesRelations = relations(advisorMessages, ({ one }) => ({
  conversation: one(advisorConversations, {
    fields: [advisorMessages.conversationId],
    references: [advisorConversations.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type AdvisorConversation = typeof advisorConversations.$inferSelect;
export type AdvisorMessage = typeof advisorMessages.$inferSelect;
