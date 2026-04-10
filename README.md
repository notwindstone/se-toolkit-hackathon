<div align="center">
<img width="128" height="128" src="./assets/yesod_pfp.jpg" alt="Yesod as an anime character">

<h1>Yesod</h1>

An AI-driven monitoring service for multiple Virtual Dedicated Servers (VDS) with a Telegram bot and a web dashboard.
</div>

## Demo

Screenshots will be here...

## Product context

### End users

Me, homelab enthusiasts, developers, and regular users who host services on Virtual Machines (VM)

### Problem

Managing several VDS at once is time-consuming. Besides, when one service fails, you cannot easily know it unless people notify you. Additionally, the failure of a service requires one to investigate the problem and fix it, yet they often cannot do it in time.

Of course, projects like [Prometheus](https://prometheus.io/) exist, which fulfill the gap of monitoring services. However, such projects cannot handle fixing simple issues; they are only useful for detecting the problems.

### Solution

This project will monitor the health of services via scheduled checks. It will be able to manage multiple VMs at once. Moreover, it will try to SSH into the failing VM and fix the problems via a LLM.

## Features

- A scheduled job that checks whether the server and its services are responding.
- A Telegram bot that will notify the user in case if any service is down.
- An incident investigator that SSH-es into the VM, gathers diagnostics, and asks AI for a root-cause summary.
- That Telegram bot will also be able to show simple metrics and data (e.g., uptime).
- A web dashboard that graphically represents the data.

## Usage

- Send a message with the command `/start` in the [Telegram Bot](https://t.me/firefox_chan_bot#)
- Visit the [Web Dashboard](http://10.93.26.8:4173/)

## Deployment

> For Ubuntu 24.04

Clone the repository

```bash
git clone https://github.com/notwindstone/se-toolkit-hackathon
cd se-toolkit-hackathon
```

Create `.env.secret` with the contents from `.env.example`, and then fill the values:

```env
# Telegram
TELEGRAM_BOT_TOKEN=your_token_here
ADMIN_CHAT_ID=your_telegram_user_id_here

# Qwen API
QWEN_API_KEY=for_investigating_the_vm_problems
QWEN_API_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus

# AI investigator over SSH
INVESTIGATOR_ENABLED=true
INVESTIGATOR_SSH_USER=ubuntu
INVESTIGATOR_SSH_HOST=10.0.0.12
INVESTIGATOR_SSH_PORT=22
INVESTIGATOR_SSH_KEY_PATH=/root/.ssh/id_rsa
INVESTIGATOR_COOLDOWN_SECONDS=900
INVESTIGATOR_COMMAND_TIMEOUT_MS=20000

# Server
PORT=3000

# Database
DATABASE_PATH=./chesed.db
```

Build and run

```bash
docker compose --env-file .env.secret up --build -d
```

Now, access these services via your telegram bot, the web dashboard (port 4173 of the host IP), or an API (port 3000 of the host IP).

> [!WARNING]
> Although I briefly overviewed the code, the entire project was vibe-coded
