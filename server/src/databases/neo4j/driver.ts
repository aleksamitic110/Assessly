import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.NEO4J_URI;
const user = process.env.NEO4J_USERNAME;
const password = process.env.NEO4J_PASSWORD;

if (!uri || !user || !password) {
  throw new Error('Neo4j config missing in .env');
}

export const neo4jDriver = neo4j.driver(
  uri,
  neo4j.auth.basic(user, password)
);

/**
 * Creates Neo4j indexes if they don't already exist.
 * Called once at server startup from initializeDatabases().
 */
export async function initNeo4jSchema(): Promise<void> {
  const session = neo4jDriver.session();
  try {
    // Fulltext index on User.email for prefix/contains search
    await session.run(`
      CREATE FULLTEXT INDEX userEmailFulltext IF NOT EXISTS
      FOR (u:User) ON EACH [u.email]
    `);
    console.log('Neo4j schema indexes ensured');
  } catch (err: any) {
    // Some Neo4j editions/versions may not support FULLTEXT — fall back silently
    console.warn('Neo4j fulltext index creation skipped:', err.message);
  } finally {
    await session.close();
  }
}
