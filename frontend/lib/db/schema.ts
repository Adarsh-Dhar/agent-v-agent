import { pgTable, text, boolean, timestamp, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Better Auth Tables
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  emailVerified: boolean('emailVerified').default(false),
  name: text('name'),
  image: text('image'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expiresAt').notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

// App Tables
export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').default('active'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

export const matches = pgTable('matches', {
  id: text('id').primaryKey(),
  code: text('code').unique().notNull(),
  secret_code: text('secret_code').unique().notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  max_players: integer('max_players').default(4),
  status: text('status').default('active'),
  creator_id: text('creator_id').notNull(),
  game_id: text('game_id'),
  purse: integer('purse').default(1000),
  initial_purse: integer('initial_purse').default(1000),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

export const match_players = pgTable('match_players', {
  id: text('id').primaryKey(),
  match_id: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  player_id: text('player_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  player_name: text('player_name').notNull(),
  purse: integer('purse').default(1000),
  pnl: integer('pnl').default(0),
  agent_id: text('agent_id'),
  agent_name: text('agent_name'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

export const games = pgTable('games', {
  id: text('id').primaryKey(),
  team_a: text('team_a').notNull(),
  team_b: text('team_b').notNull(),
  sport: text('sport').notNull(),
  status: text('status').default('pending'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

// Relations
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  agents: many(agents),
  matches: many(matches),
  match_players: many(match_players),
}))

export const agentsRelations = relations(agents, ({ one }) => ({
  user: one(user, { fields: [agents.userId], references: [user.id] }),
}))

export const matchesRelations = relations(matches, ({ one, many }) => ({
  user: one(user, { fields: [matches.userId], references: [user.id] }),
  match_players: many(match_players),
}))

export const match_playersRelations = relations(match_players, ({ one }) => ({
  match: one(matches, { fields: [match_players.match_id], references: [matches.id] }),
  user: one(user, { fields: [match_players.player_id], references: [user.id] }),
}))
