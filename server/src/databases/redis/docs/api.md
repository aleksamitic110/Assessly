Redis API

Endpoints
- GET /status/redis -> status check

Socket events (client -> server)
- join_exam
- violation
- start_exam

Socket events (server -> client)
- timer_sync
- student_status_update
- violation_alert
- exam_started
