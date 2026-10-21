# Keys and accounts: what to open and what to paste

Nothing here is needed to try the app on your own computer. You only need these when you put it on the internet or switch on the AI features. Every link below opens the page where you create the key. Paste each value in the place named under **Where it goes**, never into a chat or a file in the repository.

> Rule of thumb: a key is like a password. Do not send it to anyone, do not commit it, and if you think it leaked, make a new one on the same page and delete the old one.

## A. To put the app online (required)

| # | What | Open this | Where it goes |
|---|------|-----------|---------------|
| 1 | **Database** (free Neon account): create a project, then copy the *pooled* connection string and the *direct* one | https://console.neon.tech | Vercel setting `DATABASE_URL` = pooled string; `DIRECT_DATABASE_URL` = direct string |
| 2 | **Hosting** (free Vercel account): import the GitHub repository `InfoSage05/trinetra-ops` | https://vercel.com/new | Project settings → Environment Variables (all the names in this file) |
| 3 | **`SESSION_SECRET`**: 64 random letters and digits that sign logins | Make it on your computer: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Vercel setting `SESSION_SECRET` (use a different one from your local `.env`) |
| 4 | **`CRON_SECRET`**: protects the background e-invoice job | Same command as above | Vercel setting `CRON_SECRET` |
| 5 | **Backups**: two GitHub secrets so the nightly backup can run | https://github.com/InfoSage05/trinetra-ops/settings/secrets/actions | `BACKUP_DATABASE_URL` = Neon *direct* string; `BACKUP_PASSPHRASE` = a long phrase you also write down on paper |
| 6 | **First owner login**: after the first deploy, run `npm run db:seed` once with `SEED_OWNER_NAME`, `SEED_OWNER_PHONE` and `SEED_OWNER_PASSWORD` set | (your own details) | Your computer's `.env`, with `DATABASE_URL` pointing at Neon |

Step-by-step for these is in `docs/deployment.md`.

## B. To switch on the AI assistant (optional)

The app works fully without this. With it, **Smart entry** and **New order** understand sentences like "rose candle 5 carton, birthday 3 carton" better. The AI only ever *proposes*; a person always presses Approve.

It uses open-source models through any "OpenAI-compatible" host. Pick **one** host, create a key there, and set three values:

| Host | Create the key | `LLM_BASE_URL` | Example `LLM_MODEL` |
|------|----------------|----------------|----------------------|
| **Groq** (fast, has a free tier; recommended) | https://console.groq.com/keys | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter (many models, some free) | https://openrouter.ai/keys | `https://openrouter.ai/api/v1` | pick one marked "free" at https://openrouter.ai/models |
| Together AI | https://api.together.ai/settings/api-keys | `https://api.together.xyz/v1` | see https://docs.together.ai/docs/serverless-models |
| Hugging Face | https://huggingface.co/settings/tokens | `https://router.huggingface.co/v1` | see https://huggingface.co/models?inference_provider=all&pipeline_tag=text-generation |

Model names change over time. If the app says the AI service returned an error (404), open the host's model list (for Groq: https://console.groq.com/docs/models), copy a current model name, and update `LLM_MODEL`.

Set these in Vercel (and in your local `.env` if you want to try it on your computer):

```
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=<the key you created>
LLM_MODEL=llama-3.3-70b-versatile
```

### Voice (optional, needs the host above to offer speech-to-text)

Groq offers Whisper with the **same key**. Set:

```
STT_BASE_URL=https://api.groq.com/openai/v1
STT_API_KEY=<same key>
STT_MODEL=whisper-large-v3-turbo
```

When these are set, a **Speak** button appears next to the text box on Smart entry and New order. The recording is sent to that host to be turned into text, and the text lands in the box for you to read and correct before anything is saved. Without them the button is simply not shown.

## C. Nice to have

| What | Open this | Notes |
|------|-----------|-------|
| **Uptime alerts**: tells you if the site is down | https://dashboard.uptimerobot.com | Add a monitor for `https://<your-site>/api/health` |

## D. Later, only when your CA says so

| What | Open this | Notes |
|------|-----------|-------|
| **E-invoicing (IRP) sandbox** | https://einv-apisandbox.nic.in/ | Not needed now: `IRP_PROVIDER=mock` is the default. Real e-invoicing needs your CA's confirmation, a GSP/IRP account and credentials; ask before switching it on. |

## Quick checklist

- [ ] Neon project created, both connection strings saved
- [ ] Vercel project created, variables 1-4 added
- [ ] GitHub secrets for backups added, passphrase written on paper
- [ ] First owner created with `npm run db:seed`
- [ ] (optional) Groq key created and `LLM_*` / `STT_*` added
- [ ] (optional) UptimeRobot monitor added
