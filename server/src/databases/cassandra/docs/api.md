Cassandra API

Endpoints
- POST /api/logs/execution -> createExecutionLog
- GET /api/logs/execution/:examId -> getMyExecutionLogs
- GET /api/logs/execution/:examId/:studentId -> getStudentExecutionLogs
- POST /api/logs/security -> createSecurityEvent
- GET /api/logs/security/:examId -> getExamSecurityEvents
- GET /api/logs/security/:examId/:studentId -> getStudentSecurityEvents
- GET /api/logs/security/:examId/:studentId/count -> getViolationCount
- GET /status/cassandra -> status check

Functions
- logExecution, getExecutionLogs, getExecutionLogsForTask
- logSecurityEvent, getSecurityEvents, getSecurityEventsForStudent, countSecurityEvents
- logUserActivity
