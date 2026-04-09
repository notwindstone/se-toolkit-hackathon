<div align="center">
<img width="128" height="128" src="./assets/yesod_pfp.jpg" alt="Yesod as an anime character">

<h1>Yesod</h1>

An AI-driven monitoring service for multiple Virtual Dedicated Servers (VDS) with a Telegram bot and a web dashboard.
</div>

## Demo

Screenshots will be here...

## Product context

### End users

Me, homelab enthusiasts, developers, and users who host services on Virtual Machines (VM)

### Problem

Managing several VDS at once is time-consuming. Besides, when one service fails, you cannot easily know it unless people notify you. Additionally, the failure of a service requires one to investigate the problem and fix it, yet they often cannot do it in time.

Of course, projects like [Prometheus](https://prometheus.io/) exist, which fulfill the gap of monitoring services. However, such projects cannot handle fixing simple issues; they are only useful for detecting the problems.

### Solution

This project will monitor the health of services via scheduled checks. It will be able to manage multiple VMs at once. Moreover, it will try to SSH into the failing VM and fix the problems via a LLM.

## Features

- A scheduled job that checks whether the server and its services are responding.
- A Telegram bot that will notify the user in case if any service is down.
- That Telegram bot will also be able to show simple metrics and data (e.g., uptime).
- A web dashboard that graphically represents the data.
- An LLM model that can SSH into the VM by using a publickey and investigate the problem.

## Usage

## Deployment

> [!WARNING]
> Although I briefly overviewed the code, the entire project was vibe-coded
