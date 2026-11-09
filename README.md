<div align="center">

  <br />
  <img src="./frontend/public/capy-logo.svg" width="128" height="128" alt="CapyLLM Logo" style="border-radius: 28px;" />
  <br />
  <br />

  <h1>CapyLLM</h1>

  <h3><em>Let the capy handle the routing.</em></h3>

  <p>
    The ultra-fast, lightweight AI Gateway and inference pool proxy.<br />
    Self-contained, sub-millisecond latency, unified token & spend budgets, and automatic failover.<br />
    Zero external database dependencies. Native TypeScript on Bun.
  </p>

  <p>
    <a href="#why-capyllm-vs-litellm-proxy">Why CapyLLM?</a> •
    <a href="#architecture--core-pillars">Architecture</a> •
    <a href="#key-features">Features</a> •
    <a href="#quickstart">Quickstart</a> •
    <a href="#client-integration">Client Integration</a> •
    <a href="#italiano">Italiano</a> •
    <a href="#license">License</a>
  </p>

  <br />

</div>

---

## Why CapyLLM? (vs. LiteLLM Proxy)

Most AI gateways (such as LiteLLM Proxy) began as Python SDK wrappers and later evolved into proxy servers. While functional, running a Python ASGI runtime for high-throughput API routing often introduces heavy resource overhead, operational fragility, and unnecessary infrastructure requirements.

CapyLLM was designed from the ground up to solve these exact pain points:

| Feature | LiteLLM Proxy | CapyLLM |
| :--- | :--- | :--- |
| **Runtime & Language** | Python (FastAPI, Uvicorn, Pydantic) | **TypeScript on native Bun** |
| **Idle Memory Footprint** | ~400 MB to 1 GB+ (heavy cloud SDK dependencies) | **~35 MB to 60 MB** |
| **Proxy Latency Overhead** | 15 ms to 45 ms per request | **Sub-millisecond (< 1 ms)** |
| **Database Requirements** | External PostgreSQL + Redis for virtual keys & state | **Embedded SQLite WAL** (single file, zero setup) |
| **Parameter Handling** | Hardcoded Python monkey-patching per SDK (fragile) | **Transparent passthrough + models.dev catalog** |
| **Provider Support** | Hardcoded provider adapters | **235+ providers** auto-cataloged via models.dev |
| **User Interface** | Generic template with decorative emoji clutter | **Ergonomic CapyLLM Design System**, bilingual (IT/EN) |
| **Payload Inspection** | Truncated logs or third-party telemetry sinks | **Side-by-side / stacked raw JSON inspection** |
| **Key & Budget Control** | Fragmented rate limit rules across YAML and tables | **Unified budget engine** (Tokens & USD, 4 cadences) |
| **Authentication** | Passwords, static API tokens, or Enterprise SAML | **FIDO2 / WebAuthn Passkeys** (Touch ID, Face ID) |

---

## Architecture & Core Pillars

CapyLLM operates on a clean, three-tier architecture that guarantees both credit safety and seamless provider abstraction.

```
                  CLIENT APPLICATIONS & AGENTS
          (Cursor, LibreChat, OpenAI SDK, Custom Bots)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   CAPYKEYS (VIRTUAL KEYS)                   │
│  - Issued per application or environment                    │
│  - Rate limits (RPM) and allowed model filters              │
│  - Autonomous spend caps (Tokens or USD)                    │
│  - Vanilla OpenAI compatibility toggle (pure JSON)          │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      INFERENCE POOLS                        │
│  - Prioritized routing: P0 (Primary) -> P1 (Fallback)       │
│  - Automatic round-robin load distribution                  │
│  - Instant failover on HTTP 429, 502, or timeout            │
│  - Dynamic reasoning policies (low, medium, high, none)     │
│  - Autonomous pool-level budgets & cross-model resilience   │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    UPSTREAM AI PROVIDERS                    │
│  (OpenAI, Anthropic, Gemini, Groq, OpenRouter, Inception,   │
│   Mistral, DeepSeek, Together, Ollama, 235+ on models.dev)  │
│  - AES-256-GCM encryption at rest                           │
│  - Zero-token model discovery & rate monitoring             │
└─────────────────────────────────────────────────────────────┘
```

### The 3 Core Pillars

1. **Upstream Providers**: Your secret master keys for AI providers (OpenAI, Anthropic, Groq, Inception Labs, OpenRouter, Gemini, Ollama, etc.). Stored encrypted using AES-256-GCM in SQLite and never exposed to client applications.
2. **Inference Pools**: Intelligent routing groups. Configure priority routes (Priority 0 for primary round-robin, Priority 1 for immediate automatic fallback). Pools support wildcard model matching (`gpt-4o`, `*-mini`, `*`), reasoning effort policies, and autonomous pool budget caps.
3. **CapyKeys (Virtual Keys)**: Client keys generated for your individual applications. Each CapyKey tracks its own usage, enforces RPM rate limits, restricts allowed models, and caps consumption.

> **The Hard-Cap Golden Rule**: Whichever quota limit is reached first terminates the request path. If an app key is capped at 500k tokens and its pool is capped at 2M, the app stops at 500k; if the pool runs out of tokens, all connected apps stop, preventing unexpected billing charges.

---

## Key Features

### 1. Unified Budget & Periodic Reset Engine
Set precise usage limits across Upstream Keys, CapyKeys, and Pools using a unified control:
- **Units**: Token count or USD currency ($).
- **Cadences**: Daily, Weekly, Monthly, or One-Shot (lifetime cap).
- **Configurable Server Reset Hour**: Define the exact hour (00:00 to 23:00) when daily, weekly, and monthly counters reset, aligned to the server's local wall-clock time.

### 2. Zero-Friction Model Resolution (models.dev)
Clients can request models using either namespaced names (`openai/gpt-5.6-terra`) or direct names (`gpt-5.6-terra`). CapyLLM resolves the requested model to the target provider dynamically without fragile string hacking or breaking client SDK expectations.

### 3. Dynamic Router Transparency (e.g. OpenRouter Free)
When targeting dynamic routers such as `openrouter/free`, CapyLLM extracts the concrete model executed upstream (e.g. `meta-llama/llama-3.3-70b-instruct:free`), computes precise cost attribution, and records the resolved model in logs and real-time SSE streams.

### 4. Non-Destructive Parameter Normalization
Rather than mutating parameters destructively, CapyLLM handles reasoning dialects (`reasoning_effort` vs `budget_tokens`) and sampling parameters (`temperature`, `top_p`) cleanly based on the upstream model capabilities cataloged by `models.dev`. Non-reasoning models strip reasoning parameters gracefully, while unsupported parameters pass through standard error paths for diagnostic transparency.

### 5. Detailed Call Inspection & Raw JSON Payloads
Click any row in the real-time request log to inspect:
- Client request vs. Upstream response in clean, vertically stacked JSON viewers with one-click copy.
- Model resolution path and parameter adaptation audit trail.
- Failover history with exact HTTP status codes and sanitized messages.
- Performance metrics: Total tokens, Prompt/Completion tokens, Reasoning tokens, TTFT (Time to First Token), and Generation Speed (tokens/sec).

### 6. Provider Reliability Benchmarks
The admin dashboard computes live reliability statistics across all upstream providers:
- Success rate percentage.
- Generation speed (tokens per second).
- Average latency and TTFT.
- Cumulative 429 rate limit triggers and request counts.

### 7. Passwordless WebAuthn / Passkeys
Secure the administration panel using modern biometric authentication (Touch ID, Face ID, YubiKey) via FIDO2 / WebAuthn resident keys. No passwords stored or transmitted.

---

## Quickstart

### Prerequisites
Install [Bun](https://bun.sh/) (version 1.2 or higher):
```bash
curl -fsSL https://bun.sh/install | bash
```

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/giacomoberti/capyllm.git
cd capyllm
bun install
bun run --cwd frontend install
```

### Build Frontend
```bash
bun run build:frontend
```

### Run Server
```bash
CAPY_MASTER_KEY="your-secret-master-encryption-key-min-32-chars" PORT=3000 bun src/index.ts
```
The CapyLLM dashboard will be available at `http://localhost:3000`.

### Create Admin User
Generate a 24-hour setup invite link to register your first biometric passkey:
```bash
bun run cli add-user admin@yourdomain.com --admin
```
Open the printed link in your browser to bind your Touch ID, Face ID, or security key.

---

## Docker Deployment

CapyLLM provides an optimized multi-stage Alpine Docker build with healthcheck monitoring and persistent volume support for SQLite.

### Using Docker Compose
```yaml
version: '3.8'

services:
  capyllm:
    image: capyllm:latest
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - CAPY_MASTER_KEY=change-this-to-a-secure-32-character-secret
      - CAPY_DB_PATH=/data/capyllm.db
    volumes:
      - capyllm-data:/data

volumes:
  capyllm-data:
```

Launch the container:
```bash
docker compose up -d
```

---

## Updating CapyLLM

CapyLLM features automatic zero-downtime database migrations on startup. Your SQLite WAL database (`/data/capyllm.db`) is safely preserved across versions with zero manual intervention.

### Bare Metal / Bun
```bash
git pull origin main
bun install
bun run build:frontend
bun run start
```

### Docker
```bash
docker compose pull
docker compose up -d
```

---

## Client Integration

CapyLLM exposes a 100% OpenAI-compatible endpoint at `/v1`. Simply point your existing clients, SDKs, or tools to your CapyLLM host.

### Python (OpenAI SDK v1)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="capy_live_ab12cd_your_virtual_key"
)

response = client.chat.completions.create(
    model="gpt-5.6-terra",
    messages=[{"role": "user", "content": "Explain inference pools in one sentence."}],
)

print(response.choices[0].message.content)

# Optional telemetry metadata (when include_metadata is enabled):
meta = getattr(response, "capy_meta", None)
if meta:
    print(f"Provider: {meta.get('upstream_provider')} | Latency: {meta.get('latency_ms')}ms")
```

### Node.js / TypeScript (OpenAI SDK)
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'capy_live_ab12cd_your_virtual_key',
});

const stream = await openai.chat.completions.create({
  model: 'gpt-5.6-terra',
  messages: [{ role: 'user', content: 'Explain zero-latency routing.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
process.stdout.write('\n');
```

### cURL
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer capy_live_ab12cd_your_virtual_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.6-terra",
    "messages": [{"role": "user", "content": "Hello CapyLLM!"}]
  }'
```

---

## Italiano

### Cos'è CapyLLM?
> *Let the capy handle the routing.*

**CapyLLM** è un gateway proxy universale per l'inferenza AI progettato per sviluppatori e team che cercano prestazioni elevate, consumi di memoria minimi e una gestione trasparente dei costi.

A differenza delle soluzioni monolitiche scritte in Python che richiedono infrastrutture pesanti (container da 1GB, PostgreSQL, Redis), CapyLLM è un'applicazione nativa in **TypeScript su Bun** con database **SQLite WAL integrato**: un singolo binario, zero configurazione esterna, e overhead di routing sub-millisecondo.

### Vantaggi Principali
- **Pool di Inferenza con Ripiego Automatico**: definisci rotte primarie (P0) e rotte di ripiego (P1) per gestire errori 429 e disservizi dei fornitori senza interruzioni per l'utente finale.
- **Limiti Unificati e Orario di Reset**: imposta tetti di spesa precisi (in Token o in USD) con cadenza giornaliera, settimanale, mensile o una tantum, sincronizzati all'orario esatto del fuso orario del server.
- **Risoluzione Modelli Senza Prefissi Fornitore**: chiama indistintamente `gpt-5.6-terra` o `openai/gpt-5.6-terra`; CapyLLM instrada la chiamata al provider corretto.
- **Ispezione Completa dei Payload**: visualizza i JSON grezzi inviati dal client e ricevuti dal fornitore, le latenze TTFT e la velocità di generazione effettiva (token al secondo).
- **Autenticazione con Passkey**: accesso biometrico tramite Touch ID, Face ID o chiavi YubiKey senza password.

### Aggiornamento
CapyLLM applica automaticamente le migrazioni dello schema all'avvio:
- **Con Bun**: `git pull origin main && bun install && bun run build:frontend && bun run start`
- **Con Docker**: `docker compose pull && docker compose up -d`

---

## Test Suite

CapyLLM include una suite completa di 119 test unitari e di integrazione eseguiti in meno di 1 secondo su database in-memory:

```bash
bun test
```

---

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/) 1.3+
- **HTTP Server & Routing**: [Hono](https://hono.dev/) v4
- **Database**: SQLite WAL (`bun:sqlite`) con [Drizzle ORM](https://orm.drizzle.team/)
- **Frontend**: React 19, Vite 8, Tailwind CSS v4, Lucide Icons
- **Security**: AES-256-GCM, SimpleWebAuthn (FIDO2 / WebAuthn)
- **Model Intelligence**: Catalog discovery integrato tramite [models.dev](https://models.dev/)

---

## License

Distributed under the **MIT License**. See [LICENSE](./LICENSE) for details.  
Copyright (c) 2026 Giacomo Berti.
