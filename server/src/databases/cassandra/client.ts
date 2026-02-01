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
  console.log('Skipping Cassandra table creation (managed manually).');
}
