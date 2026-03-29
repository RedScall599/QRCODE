# Architecture Overview

Visual diagrams of how each piece of the project works.

---

## 1. How the App Works

A user opens the browser and everything flows through Next.js:

```mermaid
flowchart TD
    Browser["🌐 Browser"]

    Browser -->|"HTTP request"| Next["Next.js App\n(port 3000)"]

    Next -->|"page loads"| AuthPage["/auth\nSign in / Sign up page"]
    Next -->|"page loads"| HomePage["/ Home page\nQR code generator"]

    AuthPage -->|"POST /api/auth/signup"| SignupRoute["signup route\nhash password → create user → create session"]
    AuthPage -->|"POST /api/auth/signin"| SigninRoute["signin route\nverify password → create session"]
    HomePage  -->|"GET /api/auth/me"| MeRoute["me route\nread session cookie → return user"]
    HomePage  -->|"POST /api/qrcodes"| QRRoute["qrcodes route\nsave / list / delete QR codes"]

    SignupRoute --> Prisma["Prisma ORM"]
    SigninRoute --> Prisma
    MeRoute    --> Prisma
    QRRoute    --> Prisma

    Prisma -->|"SQL over SSL"| Neon[("☁️ Neon PostgreSQL\nCloud database\n(User, Session, QRCode tables)")]

    SignupRoute -->|"set session cookie"| Browser
    SigninRoute -->|"set session cookie"| Browser
```

---

## 2. How Docker Works

Docker packages your app into a portable image using two stages:

```mermaid
flowchart TD
    subgraph Dockerfile["Dockerfile — two-stage build"]
        direction TB
        subgraph Builder["Stage 1: Builder  (node:20-alpine)"]
            B1["COPY package.json + prisma/"]
            B2["RUN npm ci\n(installs all dependencies)"]
            B3["COPY . .\n(copy source code)"]
            B4["RUN npx prisma generate\n(creates Prisma client)"]
            B5["RUN npm run build\n(compiles Next.js → .next/standalone)"]
            B1 --> B2 --> B3 --> B4 --> B5
        end

        subgraph Runner["Stage 2: Runner  (node:20-alpine)"]
            R1["COPY --from=builder .next/standalone"]
            R2["COPY --from=builder .next/static"]
            R3["COPY --from=builder public/"]
            R4["COPY --from=builder prisma/ + src/generated/"]
            R5["EXPOSE 3000\nCMD node server.js"]
            R1 --> R2 --> R3 --> R4 --> R5
        end

        Builder -->|"only compiled output\nno source / no devDependencies"| Runner
    end

    Runner -->|"docker push"| GHCR["📦 GitHub Container Registry\nghcr.io/redscall599/qrcode:latest"]

    GHCR -->|"docker pull"| Container["🐳 Running Container\nNode 20 · production · port 3000"]
```

**Why two stages?** The builder stage needs hundreds of MB of dev tools that are useless at runtime. The runner stage copies only the compiled output — making the final image 3–5× smaller.

---

## 3. How EC2 Works

EC2 is just a Linux server running Docker. Your app lives inside a container:

```mermaid
flowchart TD
    You["👤 User's Browser\nhttp://34.230.24.49:3000"]

    You -->|"TCP port 3000"| SG["AWS Security Group\n(firewall — allows port 22 + 3000)"]

    SG --> EC2

    subgraph EC2["🖥️ EC2 Ubuntu Server  (34.230.24.49)"]
        DockerEngine["Docker Engine"]

        subgraph Container["🐳 App Container  (node:20-alpine)"]
            App["Next.js server.js\nlistening on :3000"]
        end

        EnvFile[".env file on disk\nDATABASE_URL\nOPENAI_API_KEY\nSECURE_COOKIES=false"]
        Volume["uploads_data volume\n/app/public/uploads\n(survives container restarts)"]

        DockerEngine --> Container
        EnvFile -->|"env_file:"| Container
        Container <-->|"mounted"| Volume
    end

    Container -->|"DATABASE_URL\n(SSL connection)"| Neon[("☁️ Neon PostgreSQL")]
    GHCR["📦 GHCR\nghcr.io/redscall599/qrcode:latest"] -->|"docker pull"| DockerEngine
```

---

## 4. How the CI/CD Pipeline Works

Every `git push` to `main` triggers two automatic jobs in GitHub Actions:

```mermaid
flowchart TD
    Push["git push → main branch"]

    Push --> GHA["⚙️ GitHub Actions triggered\n(.github/workflows/ci.yml)"]

    GHA --> Job1

    subgraph Job1["Job 1: build-and-test  (runs on GitHub's servers)"]
        direction TB
        J1A["actions/checkout@v4\n(download repo)"]
        J1B["docker/setup-buildx-action\n(enable layer caching)"]
        J1C["docker/login-action\n(login to GHCR)"]
        J1D["docker/build-push-action\n(build Dockerfile → push image to GHCR)"]
        J1E["docker compose pull app\n(pull image for testing)"]
        J1F["echo secrets > .env\n(write DATABASE_URL etc.)"]
        J1G["docker compose up -d\n(start container)"]
        J1H["sleep 15\n(wait for app to boot)"]
        J1I["docker compose exec app\nnpx prisma migrate deploy\n(apply DB migrations)"]
        J1J["docker compose exec app\nnpm test\n(run test suite)"]
        J1K["docker compose down -v\n(tear down)"]

        J1A --> J1B --> J1C --> J1D --> J1E --> J1F --> J1G --> J1H --> J1I --> J1J --> J1K
    end

    Job1 -->|"✅ tests passed"| Job2

    subgraph Job2["Job 2: deploy  (runs commands ON your EC2 over SSH)"]
        direction TB
        J2A["appleboy/ssh-action\nSSH into 34.230.24.49"]
        J2B["git pull origin main\n(update docker-compose.yml etc.)"]
        J2C["docker pull ghcr.io/redscall599/qrcode:latest\n(download new image)"]
        J2D["docker compose down\n(stop old version)"]
        J2E["echo secrets > .env\n(write env file on EC2)"]
        J2F["docker compose run --rm app\nnpx prisma migrate deploy\n(apply migrations)"]
        J2G["docker compose up -d\n(start new version)"]
        J2H["wait for healthcheck ✅\nthen docker image prune -f"]

        J2A --> J2B --> J2C --> J2D --> J2E --> J2F --> J2G --> J2H
    end

    Job2 --> Live["🌐 App live at\nhttp://34.230.24.49:3000"]
```

---

## All Together

```mermaid
flowchart LR
    Dev["👨‍💻 You\n(VS Code)"]
    Dev -->|"git push"| GitHub["GitHub\n(code + secrets)"]
    GitHub -->|"GitHub Actions\nbuild & test"| GHCR["📦 GHCR\n(Docker image)"]
    GitHub -->|"GitHub Actions\nSSH deploy"| EC2["🖥️ EC2\n(running container)"]
    GHCR -->|"docker pull"| EC2
    EC2 -->|"DATABASE_URL"| Neon["☁️ Neon\n(PostgreSQL)"]
    Users["🌐 Users"] -->|"port 3000"| EC2
```
