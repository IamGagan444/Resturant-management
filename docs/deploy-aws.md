# Deploying to AWS (test setup on one server)

One EC2 server in Mumbai runs everything with Docker Compose. Caddy gets HTTPS certificates automatically.

```
restro.gaganpallai.in          guest app (QR codes point here)
console.restro.gaganpallai.in  staff console
api.restro.gaganpallai.in      API + live updates
        │  (all three resolve to the server's Elastic IP)
EC2 (Ubuntu, ap-south-1)
└─ docker compose: caddy · api · customer · postgres · redis · nightly backup
```

Your portfolio on `gaganpallai.in` is untouched: only three new DNS records are added.
Moving to a new domain later is a change in `deploy/.env`, three DNS records and reprinted QR codes.

**Cost:** new AWS accounts get credits ($100, up to $200) for 6 months on the Free plan. This setup uses about **$20–25 a month** of them:
- the server: a t4g.small or t3.small;
- its disk: 30 GB;
- the Elastic IP: AWS charges for public IPv4 addresses.

After the credits, the same server costs roughly the same in real money. Set the budget alert in step 1 first.

---

## 1. AWS account safety (5 minutes, do this first)

1. Billing → **Budgets** → create a monthly cost budget of **$10**, with email alerts at 50%, 80% and 100%.
2. Turn on MFA for the root user. Day to day, use an IAM user with admin rights, not root.

## 2. Server

1. EC2 → region **Asia Pacific (Mumbai)** → **Launch instance**:
   - **Image:** Ubuntu Server 24.04 LTS (pick 64-bit **Arm** to use t4g).
   - **Type:** `t4g.small` (2 GB RAM). `t3.small` if you choose x86.
   - **Key pair:** create one and keep the `.pem` file safe.
   - **Storage:** 30 GB gp3.
   - **Security group** (inbound):

     | Type | Port | Source |
     | --- | --- | --- |
     | SSH | 22 | **My IP** only |
     | HTTP | 80 | Anywhere |
     | HTTPS | 443 | Anywhere |
     | Custom UDP | 443 | Anywhere (HTTP/3, optional) |

2. EC2 → **Elastic IPs** → Allocate → **Associate** it with the instance. This address never changes.

## 3. DNS (where `gaganpallai.in` is managed)

The DNS is managed at your registrar, or at Vercel if your portfolio's nameservers point there. Add three **A** records pointing to the Elastic IP:

| Name | Type | Value |
| --- | --- | --- |
| `restro` | A | `<Elastic IP>` |
| `console.restro` | A | `<Elastic IP>` |
| `api.restro` | A | `<Elastic IP>` |

Check from your PC with `nslookup api.restro.gaganpallai.in`. **DNS must resolve before the first start**, or Caddy can't get certificates.

## 4. Prepare the server

```bash
ssh -i your-key.pem ubuntu@<Elastic IP>

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit       # log in again so the group applies

# 2 GB swap: building the Next.js apps needs more than 2 GB RAM briefly
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. Code and settings

The repository must be on GitHub (private is fine).

```bash
git clone https://github.com/<you>/<repo>.git rms && cd rms
cp deploy/.env.example deploy/.env
nano deploy/.env
```

Fill in `deploy/.env`:
- **Hosts:** already set to `restro.gaganpallai.in` and its two subdomains.
- **`ACME_EMAIL`:** your email, for certificate expiry notices.
- **Secrets:** run `openssl rand -base64 48` once for each of `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `ENCRYPTION_KEY`. For `POSTGRES_PASSWORD` use `openssl rand -hex 32` instead: it goes inside `DATABASE_URL`, where `/`, `+` and `=` break the address.
  - **Do not reuse** the values from your PC's `.env`.
  - **Keep `ENCRYPTION_KEY` safe:** it decrypts each hotel's Razorpay secrets.
- **`ADMIN_EMAIL` / `ADMIN_PASSWORD`:** your super admin login. The password must be at least 12 characters.
- **Menu photos (`STORAGE_DRIVER=s3`):** copy the `S3_*` values from your PC's `.env`. Check that the region in `S3_PUBLIC_URL` matches the bucket's region (yours is `ap-south-2`, Hyderabad), or photo links will break.

`deploy/.env` is ignored by git. Never commit it.

## 6. Start

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

The first build takes about 10–15 minutes on a small server. After that:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env ps     # every service Up, migrate Exited (0)
curl https://api.restro.gaganpallai.in/health                                 # {"ok":true}
```

Then:
1. Open `https://console.restro.gaganpallai.in/login/` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. In **Platform**, create a hotel. The owner signs in, sets up the menu, tables and staff, and prints the QR sheet. The QR codes point to `https://restro.gaganpallai.in/...`.

**On every start, migrations run automatically** and the super admin and plans are created if missing. The demo "Spice Garden" seed is never run in production.

## 7. Updating

```bash
cd ~/rms && git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

Database migrations run before the API starts. Screens reconnect by themselves, and staff taps made during the restart wait in each device's queue.

## 8. Payments while testing

- **No mock payments:** the server refuses to start with `PAYMENTS_MOCK` in production.
- **Testing UPI:** create a Razorpay account and use its **Test Mode** keys. Each hotel's owner enters them under Manage → Settings.
- **Webhook URL** to set in the Razorpay dashboard: `https://api.restro.gaganpallai.in/v1/webhooks/razorpay/<hotelId>`
- **Without keys**, cash and card at the counter work, and UPI buttons stay hidden.

## 9. Backups

- **Automatic:** a nightly dump at 03:00 IST, plus one at every start. The newest 7 are kept in the `backups` volume on the server.
- **Off the server:** a server-only backup dies with the server, so also send copies to S3:
  1. Create a **private** bucket, e.g. `rms-db-backups-gagan`. Keep *Block all public access* ON. This must not be the photo bucket.
  2. Add a lifecycle rule: delete objects after 30 days.
  3. Create an IAM user `rms-backup` with only this policy:
     ```json
     { "Version": "2012-10-17", "Statement": [{ "Effect": "Allow", "Action": ["s3:PutObject"], "Resource": "arn:aws:s3:::rms-db-backups-gagan/db/*" }] }
     ```
  4. Put `BACKUP_S3_BUCKET` and the user's keys in `deploy/.env`, then run the update command from step 7.
- **Check backups:** `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs backup`
- **Restore** (this replaces the current data, so stop the app first):
  ```bash
  C="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env"
  $C stop api customer
  $C exec backup sh -c 'ls -1t /backups'                       # pick a file
  $C exec backup sh -c 'dropdb rms && createdb rms && gunzip -c /backups/<file> | psql -q -d rms'
  $C up -d
  ```

## 10. Menu photo bucket: tighten public access

Photos are uploaded under `menu/<hotelId>/`. Limit public reads to that folder, so nothing else that ever lands in the bucket becomes public. In the bucket policy, change the resource to:
`"Resource": "arn:aws:s3:::<bucket>/menu/*"`

Uploads are resized to WebP (at most 1200 px) and cached by browsers for a year. `STORAGE_DRIVER=local` (a Docker volume on the server) remains available as a fallback.

## 11. Useful commands

```bash
C="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env"
$C logs -f api            # API logs (also: web, customer, migrate, backup)
$C restart api
$C ps
docker system df          # disk used by images; clean old ones with: docker image prune
```

## Troubleshooting

- **No HTTPS / certificate errors.** Check that all three names resolve to the Elastic IP and that ports 80 and 443 are open, then run `$C logs web`. Let's Encrypt limits repeated failed attempts, so fix DNS before retrying.
- **Build killed or out of memory.** Check that swap is on with `free -h`.
- **Staff can't stay signed in.** All three hosts must be under the same parent domain (they are: `*.gaganpallai.in`) and served over HTTPS. The cookies are `Secure` and `SameSite=Lax`.

## Later, when real restaurants use it

- **Database:** move Postgres to **RDS**, with automatic backups and patching. Change `DATABASE_URL` and remove the `postgres` service.
- **Domain:** buy the product domain, change the three hosts in `deploy/.env`, add the DNS records, and reprint the QR codes.
- **Server size:** a bigger instance, or move the image builds to GitHub Actions so the server only pulls ready images.
