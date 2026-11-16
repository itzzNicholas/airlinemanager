# ✈️ AirlineManager

Gestionale **gratuito, open source e decentralizzato** per creare e far crescere la tua compagnia aerea.
Lingue: 🇮🇹 italiano (default) · 🇬🇧 English · 🇷🇺 Русский.

*Free, open-source, decentralized airline management sim. UI in Italian (default), English and Russian.*

## Cosa c'è dentro

| Area | Funzioni |
|---|---|
| **Flotta** | 37 aerei famosi (Cessna, Pilatus, ATR, Embraer, Airbus, Boeing, Sukhoi, Tupolev, Ilyushin, Concorde…) con **foto da Wikipedia**, **gradi da F ad A+** (più grande = più costi), consegna a tempo (saltabile a pagamento), manutenzione, condizioni, vendita |
| **Passeggeri / Cargo** | Ogni aereo può essere configurato **passeggeri o cargo** (conversione a pagamento, 48 h di lavori) |
| **Rotte** | Rotte personalizzate fra ~100 aeroporti del mondo (Europa, Asia, Americhe, Africa, Oceania), prezzo biglietto regolabile, domanda, rivali, slot |
| **Carburante** | Prezzo del jet fuel **derivato dal Brent reale** (Yahoo Finance), grafico storico, **previsione a 14 giorni con fascia d'incertezza** e **consiglio “compra / aspetta”** |
| **Basi, hangar, depositi** | Basi in più aeroporti (−10 % tariffe), hangar (manutenzione più rapida/economica), **depositi di carburante** per fare scorta quando il prezzo è basso; acquisto automatico configurabile |
| **Meteo reale** | Condizioni attuali degli aeroporti (Open-Meteo): il maltempo causa ritardi, consumi extra e cancellazioni |
| **Mappa 3D live** | Globo 3D (globe.gl) con rotte, aeroporti, anelli di maltempo e gli aerei in volo in tempo reale |
| **Personale** | Piloti con brevetti F–A (addestramento a tempo, saltabile a pagamento), assistenti di volo, meccanici, personale di terra, corsi (servizio, sicurezza, eco, efficienza) |
| **Missioni speciali** | **550 modelli di missione** (11 tipi × 50 clienti: VIP, sanitario, stampa, sport, charter, turismo, cargo, umanitario, deperibili, posta, ricambi) generati in base alla grandezza della compagnia, con scadenza e aeroporti dinamici |
| **Economia** | Ricavi, costi (carburante, tariffe, manutenzione, servizio, stipendi, assicurazioni), conto economico, movimenti. Soldi aggiungibili o illimitati dalle impostazioni (→ classifica *sandbox*) |
| **Rivali** | 8 compagnie IA che competono sulle tue rotte |
| **Decentralizzazione** | Ogni container = **un'istanza indipendente** con nome, ID casuale, chiavi Ed25519 e propri account. Classifiche e mercato dell'usato condivisi fra istanze collegate, ban per istanza, export/import account |

## Avvio rapido

### Docker (app + PostgreSQL)

```bash
cp .env.example .env      # modifica INSTANCE_NAME, PUBLIC_URL, ADMIN_TOKEN
docker compose up -d --build
```

Apri <http://localhost:3000>.

### Senza Docker (sviluppo)

```bash
npm install
npm start                 # senza DATABASE_URL usa un file locale data/db.json
```

Con PostgreSQL: `DATABASE_URL=postgres://utente:pass@host:5432/db npm start` (le tabelle si creano da sole).

### Railway

1. Crea un nuovo progetto da questo repository (viene usato il `Dockerfile`; `railway.json` imposta l'healthcheck su `/health`).
2. Aggiungi il plugin **PostgreSQL**: Railway espone `DATABASE_URL` al servizio (referenziala come `${{Postgres.DATABASE_URL}}`).
3. In *Variables* imposta `INSTANCE_NAME`, `ADMIN_TOKEN` (stringa lunga e segreta) e, se vuoi, `PUBLIC_URL`.
4. *Settings → Networking → Generate Domain*. Fatto: l'URL viene rilevato automaticamente (`RAILWAY_PUBLIC_DOMAIN`).

### Variabili d'ambiente

| Variabile | Descrizione |
|---|---|
| `DATABASE_URL` | Connessione PostgreSQL. Se assente → file JSON locale (solo sviluppo) |
| `PORT` | Porta HTTP (default 3000) |
| `INSTANCE_NAME` | Nome pubblico dell'istanza |
| `PUBLIC_URL` | URL pubblico (deducibile da `RAILWAY_PUBLIC_DOMAIN` o dalla prima richiesta) |
| `ADMIN_TOKEN` | Abilita ban/aggiunta istanze dalla pagina *Rete istanze* |
| `BANNED_INSTANCES` | ID o URL di istanze da escludere (virgola) |
| `FED_PEERS` | Istanze extra oltre al registro (virgola) |
| `FED_REGISTRY_URL` | Registro da scaricare (default: `servers.json` di questo repo su GitHub; vuoto = solo file locale) |
| `ALLOW_PRIVATE_PEERS=1` | Permette peer su localhost/IP privati (solo test) |

## 🌐 Decentralizzazione

Ogni istanza è autonoma: ha i propri **account**, il proprio **database** e un'identità:

* **ID lungo e casuale** (33 byte in base64url, 44 caratteri) generato al primo avvio;
* **chiave Ed25519** per firmare le richieste fra istanze;
* **nome** e **URL pubblico** (non l'IP): l'API federata vive su `<URL>/api/fed/*`.

### Come aggiungere la tua istanza alla rete
1. Pubblica il container con un URL https raggiungibile e imposta `INSTANCE_NAME` / `PUBLIC_URL`.
2. Apri una **pull request** che aggiunge una voce a [`servers.json`](servers.json):
   ```json
   { "name": "La Mia Istanza", "url": "https://airline.example.com", "note": "" }
   ```
   La CI (`scripts/validate-servers.js`) verifica formato e raggiungibilità di `/api/fed/info`.
3. Dopo il merge, tutte le istanze scaricano il registro e ti collegano automaticamente (ogni peer viene verificato leggendo `GET /api/fed/info`: ID, nome, chiave pubblica).

### Ban fra istanze
Dalla pagina **Rete istanze**, inserendo `ADMIN_TOKEN`, puoi **bannare** (e sbannare) qualsiasi istanza: i suoi giocatori spariscono dalle classifiche, i suoi annunci dal mercato e i suoi account non si possono importare. Oppure usa `BANNED_INSTANCES`.

### Classifiche (giornaliere / settimanali / mensili)
* Punteggio = **utile operativo** nel periodo *reale* (giorno / settimana / mese UTC), **normalizzato sulla velocità di gioco** (×360 = 1), così nessuno è avvantaggiato dal time-lapse.
* **Classifica standard**: solo chi non ha usato trucchi. **Classifica sandbox**: chi ha aggiunto denaro, usato il denaro illimitato o riattivato un account esportato.
* Vista *tutte le istanze* o *solo questa istanza*.

### Mercato aerei usati
* Metti in vendita un aereo a prezzo personalizzato, ma **controllato**: da **−30 % a +2 %** del *valore equo* (prezzo nuovo × usura per **ore di volo** × condizioni, mai oltre il +2 % del nuovo).
* Gli annunci sono visibili a tutte le istanze collegate. L'acquisto remoto è una richiesta **firmata Ed25519** (`POST /api/fed/claim`): l'istanza venditore marca l'annuncio come venduto in modo atomico, accredita il venditore (−3 % commissione) e restituisce l'aereo al compratore.

### Export / import account
*Rete istanze → Sposta il tuo account* scarica un file **firmato dall'istanza** (`airlinemanager-account`). Dalla schermata di accesso di un'altra istanza → **Importa**: la firma viene verificata con la chiave pubblica dell'istanza d'origine (che deve essere nel registro e non bannata) e rifiutata se il file è stato modificato. L'account originale viene **congelato**; riattivarlo lo sposta nella classifica sandbox.

### API federata (pubblica)
| Endpoint | Descrizione |
|---|---|
| `GET /api/fed/info` | `{app, v, id, name, url, pubkey, players}` |
| `GET /api/fed/leaderboard?period=day\|week\|month&board=standard\|sandbox` | Classifica locale |
| `GET /api/fed/market` | Annunci attivi |
| `POST /api/fed/claim` | Acquisto firmato di un annuncio |

> **Modello di fiducia**: le istanze si fidano dei dati ricevute dalle altre (come in ogni gioco federato); un'istanza ostile può mentire nelle classifiche, per questo esiste il ban. Le richieste fra istanze sono firmate, gli URL dei peer privati/localhost sono bloccati (anti-SSRF) e le risposte sono validate e limitate.

## Come funziona il gioco (in breve)

* **Tempo**: 1 secondo reale = N minuti di gioco (×60 … ×1800, pausa). Il gioco si ferma quando non ci sei (opzione *progresso offline*).
* **Domanda** di una rotta ∝ dimensione degli aeroporti, ridotta da distanza, prezzo alto, reputazione bassa e rivali. Troppi posti su una rotta piccola = aerei vuoti.
* **Pilota** richiesto: 2 per aereo con brevetto ≥ grado dell'aereo (F, E, D, C, B, A). **Assistenti di volo**: 1 ogni 30 posti.
* **Carburante**: ogni volo consuma dal deposito dell'aeroporto di partenza al *costo medio* d'acquisto; senza scorta si paga lo spot maggiorato.
* **Meteo**: gravità 0–3 → ritardi, +consumi, cancellazioni.

Fonti dati esterne (tutte senza chiave API): Yahoo Finance (Brent), Open-Meteo (meteo), Wikipedia/Wikimedia (foto), jsDelivr (globe.gl e texture). Se non raggiungibili, il gioco usa un fallback simulato.

## Sviluppo

```bash
npm test      # simulazione di fumo dell'economia, missioni, mercato, basi
```

Struttura: `server/` (Express + motore di simulazione `sim.js`, `fed.js`, `store.js`), `public/` (SPA senza build: `js/app.js`, `i18n.js`, `charts.js`, `globe.js`).

Licenza MIT.
