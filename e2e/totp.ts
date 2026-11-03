import type { Browser, BrowserContext, Page } from "@playwright/test";
import { DEMO_TOTP_SECRET, totpCode, totpStep } from "@rms/db/dev-totp";

let lastStep = -1;

/**
 * A code the server hasn't seen yet. Codes are single use per 30 s step, so if this run already used the
 * current one, wait for the next step (tests sign the owner in several times).
 */
export async function freshCode(secret = DEMO_TOTP_SECRET): Promise<string> {
  while (totpStep() <= lastStep) await new Promise((r) => setTimeout(r, 1000));
  lastStep = totpStep();
  return totpCode(secret, lastStep);
}

/** Email + password, then the authenticator code: the real console sign-in. */
export async function consoleSignIn(page: Page, consoleUrl: string, email: string, password: string, secret = DEMO_TOTP_SECRET) {
  await page.goto(`${consoleUrl}/login/`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Code from your authenticator app").fill(await freshCode(secret));
  await page.getByRole("button", { name: "Verify" }).click();
}

type SessionState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const sessions = new Map<string, SessionState>();

/**
 * A browser context signed in as this account. The first call signs in for real (password + code); later calls
 * reuse that browser session (its cookies), as a person keeps one signed-in browser — instead of waiting for a
 * fresh 30 s authenticator code every time.
 */
export async function signedInContext(browser: Browser, consoleUrl: string, email: string, password: string, home: string): Promise<BrowserContext> {
  const saved = sessions.get(email);
  if (saved) return browser.newContext({ storageState: saved });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await consoleSignIn(page, consoleUrl, email, password);
  await page.waitForURL((u) => u.pathname.startsWith(home));
  sessions.set(email, await ctx.storageState());
  await page.close();
  return ctx;
}
