# Deployment Guide — QR Code Generator

A beginner-friendly walkthrough of how Docker, GitHub Actions CI/CD, and EC2 work together to automatically build, test, and deploy this app.

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [Prerequisites](#2-prerequisites)
3. [How Docker Works in This Project](#3-how-docker-works-in-this-project)
4. [How the CI/CD Pipeline Works](#4-how-the-cicd-pipeline-works)
5. [Setting Up GitHub Secrets](#5-setting-up-github-secrets)
6. [Setting Up Your EC2 Server](#6-setting-up-your-ec2-server)
7. [Setting Up the .env File on EC2](#7-setting-up-the-env-file-on-ec2)
8. [Making Your First Deploy](#8-making-your-first-deploy)
9. [What Happens on Every Push After That](#9-what-happens-on-every-push-after-that)
10. [Troubleshooting Common Errors](#10-troubleshooting-common-errors)

---

## 1. The Big Picture

When you push code to GitHub, the following happens automatically — no manual steps needed:

```
You push code to GitHub
        │
        ▼
GitHub Actions runs Job 1: Build & Test
  ├── Builds a Docker image of your app
  ├── Pushes the image to GitHub Container Registry (GHCR)
  ├── Runs database migrations against Neon
  └── Runs the test suite
        │
        │ (only if tests pass AND branch is "main")
        ▼
GitHub Actions runs Job 2: Deploy to EC2
  ├── SSHs into your EC2 server
  ├── Downloads the pre-built Docker image
  ├── Runs any new database migrations
  └── Starts the app
```

---

## 2. Prerequisites

Before this works, you need:

| What | Where to get it |
|------|----------------|
| A GitHub account with the repo pushed | [github.com](https://github.com) |
| An AWS EC2 instance (Ubuntu) | [AWS Console](https://console.aws.amazon.com) |
| A Neon PostgreSQL database | [neon.tech](https://neon.tech) |
| An OpenAI API key | [platform.openai.com](https://platform.openai.com/api-keys) |
| Your EC2 `.pem` key file | Downloaded when you created the EC2 instance |

### Verify you can SSH into EC2

Before the pipeline can deploy, make sure you can connect to EC2 manually:

```bash
# Replace YourKey.pem with your actual key file name
# Replace YOUR_EC2_IP with the public IP from the AWS console
ssh -i "YourKey.pem" ubuntu@YOUR_EC2_IP
```

If it connects and shows a prompt like `ubuntu@ip-...:~$` you're good.  
If it says "Permission denied" or "Connection refused", check that port 22 is open in your EC2 Security Group.

---

## 3. How Docker Works in This Project

### What is Docker?

Docker packages your app and everything it needs to run (Node.js, npm packages, config) into a single **image** — like a zip file of your whole app environment. You can run that image anywhere and it behaves exactly the same.

### The Dockerfile (two-stage build)

The `Dockerfile` in this project is split into two stages so the final image is small and only contains what's needed to run the app.

**Stage 1 — Builder** (compiles the app):
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies first (cached if package.json didn't change)
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Copy source code THEN generate the Prisma client (requires the full source)
COPY . .
RUN npx prisma generate

# Build Next.js
RUN npm run build
```

**Stage 2 — Runner** (runs the compiled app):
```dockerfile
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Only copy the compiled output — no source code, no dev dependencies
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/src/tests ./src/tests
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "server.js"]
```

**Why two stages?** The builder needs hundreds of MB of dev tools. The runner image is stripped down — typically 3–5× smaller — which means faster downloads and a smaller attack surface.

### The docker-compose.yml

`docker-compose.yml` is what you actually run on the server. It tells Docker how to start the container with the right settings:

```yaml
services:
  app:
    # Use the pre-built image from GitHub Container Registry
    image: ghcr.io/redscall599/qrcode:latest

    # Restart the container if it crashes or the server reboots
    restart: unless-stopped

    ports:
      # server:container — visit http://your-ip:3000 to reach the app
      - "3000:3000"

    # Read secrets from the .env file on the server (never hardcoded here)
    env_file:
      - .env

    healthcheck:
      # Check if the app responds every 10 seconds
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/ > /dev/null 2>&1 || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 15s   # Give Next.js time to boot before the first check

    volumes:
      # Save uploaded images outside the container so they survive restarts
      - uploads_data:/app/public/uploads

volumes:
  uploads_data:
```

### GitHub Container Registry (GHCR)

GHCR is GitHub's free Docker image hosting. After CI builds the image it's stored at:

```
ghcr.io/redscall599/qrcode:latest
```

Your EC2 server pulls this ready-made image instead of building from source — much faster on a small server.

To make this image publicly pullable without authentication:
1. Go to your GitHub profile → **Packages**
2. Click the `qrcode` package
3. **Package settings → Change visibility → Public**

---

## 4. How the CI/CD Pipeline Works

The full pipeline lives in `.github/workflows/ci.yml`.

### Job 1: Build & Test

Triggered on every push to `main` or `develop`, and on every Pull Request to `main`.

```yaml
build-and-test:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write   # needed to push to GHCR

  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

| Step | Code example | What it does |
|------|-------------|-------------|
| Checkout | `uses: actions/checkout@v4` | Downloads your repo onto the runner machine |
| Docker Buildx | `uses: docker/setup-buildx-action@v3` | Enables layer caching for faster builds |
| GHCR Login | `uses: docker/login-action@v3` | Authenticates so images can be pushed |
| Build & Push | `uses: docker/build-push-action@v5` | Builds Dockerfile and uploads to GHCR |
| Write .env | `echo "DATABASE_URL=${{ secrets.DATABASE_URL }}" > .env` | Creates a secrets file for the containers |
| Start | `docker compose up -d` | Starts the app container in the background |
| Wait | `sleep 15` | Gives the container time to be ready before running migrations |
| Migrate | `docker compose exec -T app npx prisma migrate deploy --config prisma.config.ts` | Applies any new DB migrations inside the running container |
| Test | `docker compose exec -T app npm test` | Runs the test suite inside the container |
| Tear down | `docker compose down -v` | Stops everything and cleans up |

**Build and push step in full:**
```yaml
- name: Build and push image to GHCR
  uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: ghcr.io/redscall599/qrcode:latest
    # Cache unchanged layers so rebuilds only process what changed
    cache-from: type=registry,ref=ghcr.io/redscall599/qrcode:buildcache
    cache-to: type=registry,ref=ghcr.io/redscall599/qrcode:buildcache,mode=max
```

### Job 2: Deploy to EC2

Only runs when Job 1 passes **and** the push is to `main`:

```yaml
deploy:
  needs: build-and-test   # wait for Job 1 to pass
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

This job uses **`appleboy/ssh-action`** — a GitHub Action that connects to your EC2 server over SSH and runs all the commands in the `script:` block remotely, exactly like you typed them in a terminal on the server.

```yaml
- name: Deploy to EC2
  uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.EC2_HOST }}        # your EC2 IP address
    username: ${{ secrets.EC2_USER }}    # "ubuntu"
    key: ${{ secrets.EC2_KEY }}          # contents of your .pem file
    command_timeout: 30m                 # give it up to 30 min before failing
    script: |
      set -e  # stop immediately if any command fails

      # Install Docker if not present (first deploy only)
      if ! command -v docker &> /dev/null; then
        curl -fsSL https://get.docker.com | sh
        sudo usermod -aG docker $USER
        newgrp docker
      fi

      # Clone the repo if the folder doesn't exist yet (first deploy only)
      if [ ! -d ${{ secrets.EC2_PROJECT_PATH }} ]; then
        git clone https://github.com/RedScall599/QRCODE.git ${{ secrets.EC2_PROJECT_PATH }}
      fi

      # Pull the latest docker-compose.yml and config files from GitHub
      cd ${{ secrets.EC2_PROJECT_PATH }} && git pull origin main

      # Download the pre-built image from GHCR (built by Job 1)
      docker pull ghcr.io/redscall599/qrcode:latest

      # Stop the currently running version of the app
      docker compose down

      # Write secrets to .env (GitHub secrets → file on EC2)
      echo "DATABASE_URL=${{ secrets.DATABASE_URL }}" > .env
      echo "OPENAI_API_KEY=${{ secrets.OPENAI_API_KEY }}" >> .env

      # Run a temporary container just to apply any new DB migrations
      docker compose run --rm --no-deps app \
        npx prisma migrate deploy --config prisma.config.ts

      # Start the app with the new image
      docker compose up -d

      # Wait up to 60s for the app healthcheck to pass
      timeout 60 sh -c \
        'until [ "$(docker inspect -f "{{.State.Health.Status}}" $(docker compose ps -q app))" = "healthy" ]; do
          sleep 3
        done' || echo "Health check timed out — container may still be starting"

      # Remove unused old images to free disk space
      docker image prune -f
```

**Key things to understand:**
- `appleboy/ssh-action` is what actually SSHs into your EC2 — GitHub Actions runs this remotely on your server, not on the GitHub machine
- `set -e` means if any line fails, the whole script stops immediately
- `docker compose run --rm --no-deps app` spins up a throwaway container just to run migrations, then removes it — it does NOT start the full app yet
- `docker compose up -d` is what actually starts the live app after migrations succeed

---

## 5. Setting Up GitHub Secrets

Secrets are encrypted values stored in GitHub — they are **never** visible in logs or code.

**To add a secret:**
1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

Add these secrets:

| Secret Name | Example value | Where to find it |
|-------------|--------------|-----------------|
| `DATABASE_URL` | `postgresql://user:pass@ep-...neon.tech/db?sslmode=require` | Neon dashboard → your project → Connection string |
| `OPENAI_API_KEY` | `sk-proj-abc123...` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `EC2_HOST` | `34.230.24.49` | AWS Console → EC2 → Instances → Public IPv4 |
| `EC2_USER` | `ubuntu` | Default for all Ubuntu EC2 instances |
| `EC2_KEY` | *(full .pem file contents)* | See below |
| `EC2_PROJECT_PATH` | `/home/ubuntu/QRCODE` | Where the app will live on EC2 |

**How to get the EC2_KEY value:**

Open your `.pem` file in Notepad (Windows) or any text editor. Copy the **entire contents** including the header and footer lines:

```
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890abcdefghijklmnop...
(many more lines)
...xyz==
-----END RSA PRIVATE KEY-----
```

Paste that whole block as the value for the `EC2_KEY` secret.

---

## 6. Setting Up Your EC2 Server

### Open the required ports in AWS

Your EC2 security group must allow incoming traffic on two ports:

1. Go to **AWS Console → EC2 → Security Groups**
2. Find the security group attached to your instance
3. Click **Inbound rules → Edit inbound rules**
4. Add these rules if they don't exist:

| Type | Port | Source | Purpose |
|------|------|--------|---------|
| SSH | 22 | 0.0.0.0/0 | Lets you (and GitHub Actions) SSH in |
| Custom TCP | 3000 | 0.0.0.0/0 | Makes the app accessible in a browser |

5. Click **Save rules**

### Verify the ports are open

From your local machine:
```bash
# Check SSH works (you should get a login prompt)
ssh -i "YourKey.pem" ubuntu@YOUR_EC2_IP

# After deploying, check the app responds
curl http://YOUR_EC2_IP:3000
```

### Docker is installed automatically

The CI pipeline installs Docker on EC2 the first time it runs. You don't need to do anything manually. If you want to install it yourself beforehand:

```bash
# SSH into EC2 first, then run:
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
newgrp docker

# Verify it works:
docker --version
docker compose version
```

---

## 7. Setting Up the .env File on EC2

The CI pipeline writes the `.env` file automatically on every deploy. You don't need to create it yourself.

The pipeline writes it like this (using your GitHub secrets):
```bash
echo "DATABASE_URL=${{ secrets.DATABASE_URL }}" > .env
echo "OPENAI_API_KEY=${{ secrets.OPENAI_API_KEY }}" >> .env
```

To verify it exists after a deploy, SSH in and check:
```bash
ssh -i "YourKey.pem" ubuntu@YOUR_EC2_IP
cat /home/ubuntu/QRCODE/.env
```

Expected output:
```
DATABASE_URL=postgresql://QR_CODE_ROLE:...@ep-holy-violet-...neon.tech/QR_CODE_DB?sslmode=require
OPENAI_API_KEY=sk-proj-...
```

> **Security note:** The `.env` file is in `.gitignore` and is never committed to git. It only lives on the EC2 server and is written fresh on every deploy from your GitHub secrets.

---

## 8. Making Your First Deploy

### Step 1 — Make sure all secrets are set

Go to **GitHub repo → Settings → Secrets and variables → Actions** and confirm all 6 secrets exist:
- `DATABASE_URL`
- `OPENAI_API_KEY`
- `EC2_HOST`
- `EC2_USER`
- `EC2_KEY`
- `EC2_PROJECT_PATH`

### Step 2 — Make sure port 3000 is open on EC2

See [Section 6](#6-setting-up-your-ec2-server).

### Step 3 — Push to main

```bash
git add .
git commit -m "initial deploy"
git push origin main
```

### Step 4 — Watch the pipeline run

1. Go to your GitHub repo
2. Click the **Actions** tab
3. Click the running workflow named **CI/CD**
4. You'll see two jobs: `Build & Test` then `Deploy to EC2`
5. Click any job to expand it and see the live logs for each step

### Step 5 — Visit your app

Once both jobs show a green ✅:

```
http://YOUR_EC2_IP:3000
```

Replace `YOUR_EC2_IP` with the value from your `EC2_HOST` secret (e.g. `http://34.230.24.49:3000`).

---

## 9. What Happens on Every Push After That

Just push your code — everything is automatic:

```bash
# Make your changes, then:
git add .
git commit -m "describe your change"
git push origin main
```

GitHub Actions will:
1. Build a new Docker image with your changes (cached layers = fast)
2. Run migrations if your schema changed
3. Run tests — if any fail, the pipeline stops and the live app is untouched
4. Pull the new image on EC2 and restart the app

To check the live app logs on EC2 at any time:
```bash
ssh -i "YourKey.pem" ubuntu@YOUR_EC2_IP
cd /home/ubuntu/QRCODE
docker compose logs -f        # live logs (Ctrl+C to stop)
docker compose ps             # see if containers are running
docker compose restart        # restart if something looks stuck
```

---

## 10. Troubleshooting Common Errors

### ❌ "permission denied" on docker.sock

**Cause:** Docker Buildx creates its own context and regular `docker compose` commands can't reach the daemon.

**Fix:** Already handled in the pipeline with:
```yaml
- name: Use default Docker context
  run: docker context use default
```
If you see this locally, run:
```bash
docker context use default
```

---

### ❌ "Can't reach database server at db:5432"

**Cause:** The app is trying to connect to a local container named `db` which doesn't exist (we use Neon, not a local Postgres).

**Fix:** Make sure `DATABASE_URL` in your GitHub secret points to the Neon connection string, not `db:5432`:
```
# WRONG
DATABASE_URL=postgresql://user:pass@db:5432/qrcode

# CORRECT
DATABASE_URL=postgresql://QR_CODE_ROLE:pass@ep-holy-violet-...neon.tech/QR_CODE_DB?sslmode=require
```

---

### ❌ "P3005: The database schema is not empty"

**Cause:** The database already has tables but Prisma has no migration history — so it refuses to run.

**Fix:** Baseline the database (run this once locally):
```bash
# 1. Create the migrations folder and generate the initial SQL
mkdir -p prisma/migrations/0_init
npx prisma migrate diff \
  --from-empty \
  --to-schema prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql

# 2. Tell Prisma this migration is already applied (don't run it again)
npx prisma migrate resolve --applied 0_init

# 3. Commit the migration file
git add prisma/migrations
git commit -m "prisma: baseline migration for existing database"
git push
```

---

### ❌ Deploy times out

**Cause:** `docker pull` on a small EC2 can be slow the first time (downloading ~200MB).

**The pipeline already sets a 30-minute timeout:**
```yaml
command_timeout: 30m
```

If it still times out, check the pipeline logs in **GitHub → Actions** to see which step it's stuck on. If it's `docker pull`, your EC2 may have slow internet — try a different AWS region for your instance.

---

### ❌ "Context access might be invalid: SECRET_NAME"

**Cause:** The GitHub Actions YAML editor shows this warning when it can't verify a secret name at edit time.

**Fix:** This is just a lint warning in the editor — it does **not** mean the secret is missing. As long as the secret is saved in **Settings → Secrets**, it will work at runtime. You can safely ignore this warning.

---

### ❌ App is live but shows an error page

**Cause:** The container is running but the app crashed inside it.

**Fix:** SSH in and read the logs:
```bash
ssh -i "YourKey.pem" ubuntu@YOUR_EC2_IP
cd /home/ubuntu/QRCODE

# See all recent logs
docker compose logs

# Follow logs in real time (Ctrl+C to stop)
docker compose logs -f app

# Check container health status
docker compose ps

# Restart the app container
docker compose restart app
```

---

### ❌ Old QR code images are missing after a deploy

**Cause:** Uploaded images are stored in `/app/public/uploads` inside the container. If the container was recreated without a volume, those files are lost.

**Fix:** The `docker-compose.yml` already has a named volume to prevent this:
```yaml
volumes:
  - uploads_data:/app/public/uploads
```

Make sure you never run `docker compose down -v` in production — the `-v` flag deletes volumes. Use `docker compose down` (without `-v`) instead.

```bash
# SAFE — stops containers, keeps volumes (uploaded files survive)
docker compose down

# DANGEROUS in production — deletes all volumes including uploaded files
docker compose down -v   # ← only use this to wipe everything intentionally
```

---

## 1. The Big Picture

When you push code to GitHub, the following happens automatically — no manual steps needed:

```
You push code to GitHub
        │
        ▼
GitHub Actions runs Job 1: Build & Test
  ├── Builds a Docker image of your app
  ├── Pushes the image to GitHub Container Registry (GHCR)
  ├── Runs database migrations against Neon
  └── Runs the test suite
        │
        │ (only if tests pass AND branch is "main")
        ▼
GitHub Actions runs Job 2: Deploy to EC2
  ├── SSHs into your EC2 server
  ├── Downloads the pre-built Docker image
  ├── Runs any new database migrations
  └── Starts the app
```

---

## 2. Prerequisites

Before this works, you need:

| What | Where to get it |
|------|----------------|
| A GitHub account with the repo pushed | [github.com](https://github.com) |
| An AWS EC2 instance (Ubuntu) | [AWS Console](https://console.aws.amazon.com) |
| A Neon PostgreSQL database | [neon.tech](https://neon.tech) |
| An OpenAI API key | [platform.openai.com](https://platform.openai.com/api-keys) |
| Your EC2 `.pem` key file | Downloaded when you created the EC2 instance |

---

## 3. How Docker Works in This Project

### What is Docker?

Docker packages your app and everything it needs to run (Node.js, npm packages, config) into a single **image** — like a zip file of your whole app environment. You can run that image anywhere and it behaves exactly the same.

### The Dockerfile

The `Dockerfile` in this project uses a **two-stage build**:

#### Stage 1: Builder
```
node:20-alpine image
       │
       ├── Copy package.json + package-lock.json
       ├── Run npm ci (install all dependencies)
       ├── Copy prisma/schema.prisma
       ├── Run npx prisma generate (creates the Prisma client)
       ├── Copy the rest of the source code
       └── Run npm run build (compiles the Next.js app)
```

This stage produces the compiled app output in `.next/standalone`.

#### Stage 2: Runner
```
node:20-alpine image (fresh, clean)
       │
       ├── Copy only the compiled output from Stage 1
       ├── Copy static files (.next/static)
       ├── Copy public folder
       ├── Copy Prisma schema + generated client
       └── Expose port 3000
```

**Why two stages?** The builder stage installs dev tools and all source files. The runner stage copies only what's needed to *run* the app — making the final image much smaller and more secure.

### The docker-compose.yml

`docker-compose.yml` tells Docker how to run your app container:

- **image**: Which Docker image to use (the one built by CI and stored on GHCR)
- **ports**: Maps port 3000 on the server to port 3000 in the container
- **env_file**: Reads secrets from a `.env` file on the server
- **healthcheck**: Checks if the app is responding every 10 seconds
- **volumes**: Saves uploaded images to disk so they survive restarts

### GitHub Container Registry (GHCR)

GHCR is GitHub's built-in Docker image storage. After CI builds the image, it uploads it to `ghcr.io/redscall599/qrcode:latest`. Your EC2 server then downloads that pre-built image — it doesn't have to build anything itself.

> **Why not build on EC2?** EC2 free/small instances have limited CPU and RAM. Building a Next.js app there can take 10+ minutes or run out of memory. GitHub Actions runners are fast machines — it's much quicker to build there and ship the result.

---

## 4. How the CI/CD Pipeline Works

The pipeline is defined in `.github/workflows/ci.yml`. GitHub reads this file and runs it automatically.

### Job 1: Build & Test

This runs on **every push** to `main` or `develop`, and on every Pull Request targeting `main`.

| Step | What it does |
|------|-------------|
| Checkout code | Downloads your repo onto the GitHub runner machine |
| Set up Docker Buildx | Installs an advanced Docker builder with caching support |
| Log in to GHCR | Authenticates so the runner can push images to GitHub's registry |
| Build and push image | Builds your Dockerfile and uploads the image to GHCR |
| Pull image for testing | Downloads the image back so docker compose can use it |
| Write .env for CI | Creates a `.env` file using your GitHub secrets |
| Start services | Runs `docker compose up -d` to start the app container |
| Wait for database | Pauses 15 seconds to let the database initialize |
| Run migrations | Runs `prisma migrate deploy` inside the container |
| Run tests | Runs `npm test` inside the container |
| Tear down | Stops and removes all containers after testing |

### Job 2: Deploy to EC2

This only runs when:
- Job 1 passed ✅
- The push was to the `main` branch (not `develop`, not a PR)

It SSHs into your EC2 server and runs these commands remotely:

| Command | What it does |
|---------|-------------|
| Install Docker (if missing) | One-time setup on a fresh EC2 server |
| `git clone` (if missing) | First-time only: clones the repo onto EC2 |
| `git pull origin main` | Updates docker-compose.yml and other config files |
| `docker pull` | Downloads the pre-built image from GHCR |
| `docker compose down` | Stops the old version of the app |
| Write `.env` | Writes secrets to the `.env` file on EC2 |
| `docker compose run --rm ... prisma migrate deploy` | Runs any new database migrations |
| `docker compose up -d` | Starts the new version of the app |
| `docker image prune -f` | Removes old unused images to free disk space |

---

## 5. Setting Up GitHub Secrets

Secrets are encrypted values stored in GitHub — they are never visible in logs or code.

**To add a secret:**
1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

Add these secrets:

| Secret Name | Value | Where to find it |
|-------------|-------|-----------------|
| `DATABASE_URL` | Your Neon connection string | Neon dashboard → your project → Connection string |
| `OPENAI_API_KEY` | Your OpenAI API key | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `EC2_HOST` | Your EC2 public IP address | AWS Console → EC2 → Instances → Public IPv4 |
| `EC2_USER` | `ubuntu` | This is the default for Ubuntu EC2 servers |
| `EC2_KEY` | Full contents of your `.pem` file | Open the `.pem` file in Notepad and copy everything |
| `EC2_PROJECT_PATH` | `/home/ubuntu/QRCODE` | The folder where the app lives on EC2 |

> **For EC2_KEY:** Open your `.pem` file in a text editor. Copy **everything** including the lines:
> ```
> -----BEGIN RSA PRIVATE KEY-----
> ...all the characters in between...
> -----END RSA PRIVATE KEY-----
> ```

---

## 6. Setting Up Your EC2 Server

Your EC2 server needs to be able to receive SSH connections and run Docker.

### Open port 3000 in AWS

1. Go to **AWS Console → EC2 → Security Groups**
2. Find the security group attached to your instance
3. Click **Inbound rules → Edit inbound rules**
4. Add a rule: **Type = Custom TCP, Port = 3000, Source = 0.0.0.0/0**
5. Save

### Docker is installed automatically

The CI pipeline installs Docker on EC2 automatically the first time it runs (via `curl -fsSL https://get.docker.com | sh`). You don't need to do this manually.

---

## 7. Setting Up the .env File on EC2

The CI pipeline writes the `.env` file automatically on every deploy using your GitHub secrets. You don't need to create it manually.

However, if you ever need to SSH in and check it:

```bash
ssh -i "YourKey.pem" ubuntu@YOUR_EC2_IP
cat /home/ubuntu/QRCODE/.env
```

It should contain:
```
DATABASE_URL=postgresql://...your neon string...
OPENAI_API_KEY=sk-...your key...
```

---

## 8. Making Your First Deploy

1. Make sure all **GitHub Secrets** are set (see [Section 5](#5-setting-up-github-secrets))
2. Make sure **port 3000 is open** on EC2 (see [Section 6](#6-setting-up-your-ec2-server))
3. Push to the `main` branch:

```bash
git add .
git commit -m "initial deploy"
git push origin main
```

4. Go to your GitHub repo → **Actions** tab
5. Watch the **CI/CD** workflow run
6. Once both jobs show a green ✅, visit `http://YOUR_EC2_IP:3000` in your browser

The app should be live!

---

## 9. What Happens on Every Push After That

Just push your code — everything is automatic:

```bash
git add .
git commit -m "your change"
git push origin main
```

GitHub Actions will:
1. Build a new Docker image with your changes
2. Run your tests — if they fail, deployment stops and your live app is unaffected
3. Deploy the new image to EC2 with zero manual steps

---

## 10. Troubleshooting Common Errors

### ❌ "permission denied" on docker.sock
**Cause:** Buildx created a different Docker context and docker compose can't reach the daemon.  
**Fix:** Already handled in the pipeline with `docker context use default`.

### ❌ "Can't reach database server at db:5432"
**Cause:** The app container is trying to connect to a local postgres container named `db`, but there isn't one.  
**Fix:** Make sure `DATABASE_URL` points to your Neon connection string (not `db:5432`). Check your GitHub secret.

### ❌ "P3005: The database schema is not empty"
**Cause:** You're running `migrate deploy` on an existing database that has never been baselined.  
**Fix:**
```bash
mkdir -p prisma/migrations/0_init
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
npx prisma migrate resolve --applied 0_init
git add prisma/migrations
git commit -m "baseline migration"
git push
```

### ❌ Deploy times out
**Cause:** On first deploy, Docker has to download a large image on EC2 which can take a while.  
**Fix:** The pipeline has a 30-minute timeout (`command_timeout: 30m`) which should be enough. If it keeps timing out, try a larger EC2 instance type.

### ❌ "Context access might be invalid: SECRET_NAME"
**Cause:** The GitHub Actions editor shows this warning when it can't verify a secret exists.  
**Fix:** This is just a lint warning — if the secret is saved in GitHub Settings it will work at runtime. Ignore it.

### ❌ App is live but shows an error page
**Cause:** The container is running but something crashed inside it.  
**Fix:** SSH into EC2 and check the logs:
```bash
ssh -i "YourKey.pem" ubuntu@YOUR_EC2_IP
cd /home/ubuntu/QRCODE
docker compose logs -f
```
