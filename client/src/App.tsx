import { useState, useEffect } from 'react'
import './App.css'

interface Status {
  status: 'ok' | 'error';
  message: string;
}

function App() {
  const [redisStatus, setRedisStatus] = useState<Status | null>(null);
  const [neo4jStatus, setNeo4jStatus] = useState<Status | null>(null);
  const [cassandraStatus, setCassandraStatus] = useState<Status | null>(null);

  useEffect(() => {
    const fetchStatus = async (db: string, setter: (status: Status) => void) => {
      try {
        const response = await fetch(`http://localhost:3000/status/${db}`);
        const data = await response.json();
        setter(data);
      } catch (error) {
        setter({ status: 'error', message: 'Failed to fetch' });
      }
    };

    fetchStatus('redis', setRedisStatus);
    fetchStatus('neo4j', setNeo4jStatus);
    fetchStatus('cassandra', setCassandraStatus);
  }, []);

  const StatusIndicator = ({ name, status }: { name: string; status: Status | null }) => {
    if (!status) return <div>{name}: Loading...</div>;
    const color = status.status === 'ok' ? 'green' : 'red';
    return (
      <div style={{ color }}>
        {name}: {status.status.toUpperCase()} - {status.message}
      </div>
    );
  };

  return (
    <div className="app">
      <h1>Assessly Database Status Dashboard</h1>
      <div className="status-list">
        <StatusIndicator name="Redis" status={redisStatus} />
        <StatusIndicator name="Neo4j" status={neo4jStatus} />
        <StatusIndicator name="Cassandra" status={cassandraStatus} />
      </div>
      <p>Check the console for any errors.</p>
    </div>
  )
}

export default App
