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
        comment_id uuid,
        line int,
        message text,
        author_id uuid,
        author_name text,
        created_at timestamp,
        PRIMARY KEY ((exam_id, student_id), comment_id)
      )
    `);
    console.log('Cassandra exam_comments table ready');
  } catch (error: any) {
    // Table might already exist or we don't have permission to create it
    if (error.message?.includes('already exists')) {
      console.log('Cassandra exam_comments table already exists');
    } else {
      console.error('Error initializing Cassandra tables:', error.message);
      console.log('Please create the table manually in Astra DB CQL Console:');
      console.log(`
CREATE TABLE IF NOT EXISTS exam_comments (
  exam_id uuid,
  student_id uuid,
  comment_id uuid,
  line int,
  message text,
  author_id uuid,
  author_name text,
  created_at timestamp,
  PRIMARY KEY ((exam_id, student_id), comment_id)
);
      `);
    }
  }
}
