import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
export const simulations = sqliteTable('simulations', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  state: text('state').notNull(),
});
