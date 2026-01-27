Neo4j API

Endpoints
- POST /api/auth/register -> register
- POST /api/auth/login -> login
- POST /api/exams/subjects -> createSubject
- POST /api/exams/exams -> createExam
- POST /api/exams/tasks -> createTask
- GET /api/exams -> getAvailableExams
- GET /api/exams/subjects -> getProfessorSubjects
- GET /api/exams/:examId -> getExamById
- GET /api/exams/:examId/tasks -> getExamTasks
- GET /status/neo4j -> status check

Functions
- register, login
- createSubject, createExam, createTask
- getAvailableExams, getProfessorSubjects, getExamById, getExamTasks
