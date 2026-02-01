# Assessly
Faculty project - Advanced Databases

## Quick start (Docker, Windows + WSL2)

### Prerequisites
- Git
- Docker Desktop (WSL2 backend enabled)

### Steps
1) Clone the repo:
```powershell
git clone <repo-url>
cd Assessly
```

2) Place the provided `.env` file:
- Put the file I send you into `server/.env` (overwrite if needed).

3) Start everything from the project root:
```powershell
docker compose up -d --build
```

### Open the app
- Client: http://localhost:5173
- Server: http://localhost:3000
- Judge0 API: http://localhost:2358

### Stop containers
```powershell
docker compose down
```

## Notes
- First build can take a few minutes (image pulls + node install).
- Judge0 runs inside the same `docker-compose.yml`, so one command starts the whole stack.
- If you update `.env`, rebuild the server:
```powershell
docker compose up -d --build server
```

## Troubleshooting
- **Judge0 returns errors**: make sure Docker Desktop is using WSL2, then restart:
```powershell
docker compose down
docker compose up -d --build
```
- **Ports already in use**: stop other services using 3000 / 5173 / 2358.
