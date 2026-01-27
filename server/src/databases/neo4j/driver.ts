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
