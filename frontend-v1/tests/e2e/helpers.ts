import {
  expect,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

export const threadName = (prefix: string) => `${prefix}-${Date.now()}`;

export const clearBrowserState = async (page: Page) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();
};

export const signInWithDevToken = async (page: Page, returnTo = "/") => {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByRole("button", { name: "Sign in with dev token" }).click();
  await page.waitForURL(new RegExp(`${returnTo === "/" ? "/$" : returnTo}$`));
};

export const openAccountMenu = async (page: Page) => {
  const trigger = page.getByTestId("account-menu-trigger");
  const content = page.getByTestId("account-menu-content");

  for (let attempt = 0; attempt < 3; attempt++) {
    if (await content.isVisible().catch(() => false)) {
      return;
    }

    await trigger.click({ force: true });

    if (await content.isVisible().catch(() => false)) {
      return;
    }
  }

  await expect(content).toBeVisible();
};

export const logoutFromAccountMenu = async (page: Page) => {
  await openAccountMenu(page);
  const menu = page.getByTestId("account-menu-content");
  const logoutButton = menu.getByRole("button", { name: "Logout" });
  const loginLink = menu.getByRole("link", { name: "Login" });

  if (await logoutButton.isVisible().catch(() => false)) {
    await logoutButton.click({ force: true });
    return;
  }

  await expect(loginLink).toBeVisible();
};

export const sendMessage = async (page: Page, text: string) => {
  await page.getByRole("textbox", { name: "Message input" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
};

export const waitForRunToSettle = async (page: Page, timeout = 45_000) => {
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
    timeout,
  });
  await expect(
    page.getByRole("button", { name: "Stop generating" }),
  ).toHaveCount(0, {
    timeout,
  });
};

export const assistantMessages = (page: Page) =>
  page.locator('[data-role="assistant"]');

export const waitForAssistantMessage = async (page: Page, timeout = 30_000) => {
  await expect(assistantMessages(page).last()).toBeVisible({ timeout });
};

export const waitForAssistantText = async (page: Page, timeout = 30_000) => {
  const lastAssistant = assistantMessages(page).last();
  await expect(lastAssistant).toBeVisible({ timeout });
  await expect
    .poll(async () => (await lastAssistant.textContent())?.trim() ?? "", {
      timeout,
    })
    .not.toBe("");
};

export const activeThreadRow = (page: Page) =>
  page.locator('[data-testid="thread-item"][data-active="true"]').first();

export const threadRowByName = (page: Page, name: string) =>
  page
    .locator('[data-testid="thread-item"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();

export const threadPrimaryButtonByName = (page: Page, name: string) =>
  threadRowByName(page, name)
    .locator("button[aria-current], button.min-w-0")
    .first();

export const renameActiveThread = async (page: Page, nextName: string) => {
  const row = activeThreadRow(page);
  await row.getByRole("button", { name: /^Rename / }).click();

  const input = row.getByPlaceholder("Thread name");
  await expect(input).toBeVisible();
  await input.fill(nextName);

  await row.getByRole("button", { name: "Save rename" }).click();
};

export const deleteThreadByName = async (page: Page, name: string) => {
  await threadRowByName(page, name).getByTestId("thread-delete-action").click();
};

export const trackRequests = (page: Page, pattern: RegExp) => {
  const hits: string[] = [];
  const listener = (request: Request) => {
    if (pattern.test(request.url())) {
      hits.push(request.url());
    }
  };

  page.on("request", listener);

  return {
    hits,
    stop: () => page.off("request", listener),
  };
};

export const expectThreadRowVisible = async (page: Page, name: string) => {
  await expect(threadRowByName(page, name)).toBeVisible();
};

export const expectThreadSyncStatus = async (
  page: Page,
  name: string,
  status: "Linked" | "Syncing" | "Sync error",
) => {
  await expect(
    threadRowByName(page, name).getByTestId("thread-sync-status"),
  ).toHaveText(status);
};

export const waitForThreadHistoryToDisappear = async (row: Locator) => {
  await expect(row.getByTestId("thread-history-status")).toHaveCount(0, {
    timeout: 15_000,
  });
};
