# Resend Inbound Webhook → Twenty CRM Bridge

Receives Resend's `email.received` webhook and updates campaign1Person records in Twenty.

## What it does

1. Resend receives an inbound email on any `javier@beenex.*` address
2. Resend sends a webhook POST to this worker
3. Worker looks up the sender email in Twenty's campaign1Person records
4. If matched (PILOT cohort, not already terminal), classifies the reply:
   - **POSITIVE** → stage = REPLIED
   - **NEGATIVE** → stage = REPLIED  
   - **OOO** → stage = PAUSED_OOO
   - **BOUNCE** → stage = BOUNCED
5. Updates the campaign1Person record (sequenceStage + nextAction=NONE)
6. Stage Advancer workflow (③) fires automatically on the stage change

## Deploy to Cloudflare Workers

```bash
cd scripts/resend-webhook

# Install wrangler if needed
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Set secrets
wrangler secret put TWENTY_API_TOKEN
# paste your Twenty API token when prompted

wrangler secret put RESEND_WEBHOOK_SECRET
# paste your Resend webhook signing secret when prompted

# Deploy
wrangler deploy
```

After deploy, you'll get a URL like: `https://resend-inbound-webhook.<your-subdomain>.workers.dev`

## Configure Resend Inbound Webhook

1. Go to [Resend Dashboard → Webhooks](https://resend.com/webhooks)
2. Click "Add Webhook"
3. URL: paste your Cloudflare Worker URL
4. Events: select `email.received`
5. Save

## Configure Resend Inbound Domain

For each beenex.* domain:
1. Go to [Resend Dashboard → Domains](https://resend.com/domains)
2. Each domain needs MX records pointing to Resend for inbound:
   ```
   MX  feedback-smtp.us-east-1.amazonses.com  10
   ```
   (Resend will show the exact MX records when you enable inbound)

## Test

Send an email to `javier@beenex.cloud` from an email that matches a campaign1Person record. The worker should:
1. Receive the webhook from Resend
2. Look up the sender in Twenty
3. Update the record's sequenceStage
