import cassandra from 'cassandra-driver';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const bundlePath = path.resolve(process.env.CASSANDRA_BUNDLE_PATH || './secure-connect.zip');

export const cassandraClient = new cassandra.Client({
  cloud: {
    secureConnectBundle: bundlePath
  },
  credentials: {
    username: process.env.CASSANDRA_CLIENT_ID!,
    password: process.env.CASSANDRA_CLIENT_SECRET!
  },
  keyspace: process.env.CASSANDRA_KEYSPACE
});

// Initialize tables
export async function initCassandraTables(): Promise<void> {
  try {
    // Create exam_comments table if not exists
    console.log('Attempting to create exam_comments table...');
    await cassandraClient.execute(`
      CREATE TABLE IF NOT EXISTS exam_comments (
        exam_id uuid,
        student_id uuid,
        comment_id timeuuid,
        line int,
        message text,
        author_id uuid,
        author_name text,
        created_at timestamp,
        PRIMARY KEY ((exam_id, student_id), comment_id)
      )
    `);
    console.log('Cassandra exam_comments table ready');

    // Create security_events table if not exists
    await cassandraClient.execute(`
      CREATE TABLE IF NOT EXISTS security_events (
        exam_id uuid,
        timestamp timestamp,
        student_id uuid,
        event_type text,
        details text,
        PRIMARY KEY (exam_id, timestamp)
      ) WITH CLUSTERING ORDER BY (timestamp DESC)
    `);
    console.log('Cassandra security_events table ready');
  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      console.log('Cassandra tables already exist');
    } else {
      console.error('Error initializing Cassandra tables:', error.message);
      console.log('Please create tables manually in Astra DB CQL Console if needed.');
    }
  }
}
