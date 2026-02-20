# Assessly

## Kako pokrenuti projekat (bez Judge0)

Ovaj projekat se pokrece **bez Judge0**. Opcija pokretanja sa Judge0 je namerno uklonjena iz ovog README-a.

### Uputstvo za profesorku
1. Sa platforme CS preuzeti zip `ENV_SCB`.
2. Raspakovati sadrzaj zip-a u root projekta.
3. Proveriti da postoji `server/.env`.
4. Proveriti da je Cassandra secure bundle (`*.zip`) dostupan na putanji definisanoj kroz `CASSANDRA_BUNDLE_PATH` u `server/.env`.
5. Pokrenuti projekat komandom:

```powershell
.\assessly_start.ps1
```

### Preduslovi
- Docker Desktop (WSL2 backend ukljucen)
- PowerShell 5+ ili PowerShell 7+
- `server/.env` mora postojati
- validan Cassandra secure bundle na putanji iz `CASSANDRA_BUNDLE_PATH`

### Ako PowerShell blokira skriptu

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

### Posle starta otvoriti
- Client: http://localhost:5173
- Server: http://localhost:3000

### Napomena za cloud baze
Moguce je da su baze zbog nekoriscenja otisle u hibernate mode. U tom slucaju prvi start moze trajati duze ili privremeno da vrati gresku dok se baze ne probude. Ako se to desi, sacekati kratko i ponovo pokrenuti:

```powershell
.\assessly_start.ps1
```

### Sta skripta radi
- proverava da postoje `server/.env` i `docker-compose.yml`
- cita i validira `CASSANDRA_BUNDLE_PATH` iz `server/.env`
- pokrece samo `server` i `client` servise (bez Judge0)

### Gasenje

```powershell
docker compose down
```
