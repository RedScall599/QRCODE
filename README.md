# QR Code Generator

A full-stack web app for generating QR codes from URLs, text, and images — with an AI assistant, user authentication, and QR history.

## Features

- **QR Code Generation** — Generate QR codes from URLs, plain text, or uploaded images
- **Image QR Codes** — Upload an image (JPEG, PNG, GIF, WebP) and get a QR code that displays it when scanned
- **Customization** — Choose QR size, foreground/background color, error correction level, and add a label
- **AI Assistant** — Built-in chat powered by GPT-4o mini that answers questions about how the app works
- **User Accounts** — Sign up, sign in, and sign out with session-based authentication
- **QR History** — Logged-in users can view and re-download all QR codes they've previously generated
- **Download** — Save any generated QR code as a PNG file

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), React, Tailwind CSS |
| Backend | Next.js API Routes |
| Database | PostgreSQL via [Neon](https://neon.tech) |
| ORM | Prisma |
| AI | OpenAI GPT-4o mini (streaming) |
| Auth | Session tokens stored in the database (bcryptjs passwords) |
| Deployment | Docker, AWS EC2, GitHub Actions CI/CD |
| Image Registry | GitHub Container Registry (GHCR) |

## Getting Started (Local Dev)

### 1. Clone the repo

```bash
git clone https://github.com/RedScall599/QRCODE.git
cd QRCODE
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the root of the project:

```env
DATABASE_URL=postgresql://your-neon-connection-string
OPENAI_API_KEY=sk-...
```

### 4. Set up the database

```bash
npx prisma migrate deploy
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

This project is deployed automatically to AWS EC2 using GitHub Actions. Every push to `main`:

1. Builds a Docker image and pushes it to GHCR
2. Runs database migrations against Neon
3. Runs the test suite
4. SSHs into EC2 and deploys the new image

See [DEPLOYMENT.md](DEPLOYMENT.md) for a full beginner-friendly walkthrough of how the Docker and CI/CD setup works.
