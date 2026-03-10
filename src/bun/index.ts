import { BrowserWindow } from "electrobun";
import { createDatabase } from "../db/client.js";
import { GHDDatabase } from "../db/queries.js";
import { FetchGitHubClient } from "../github/client.js";
import { resolveGitHubToken, resolveGitHubUsername } from "../github/token.js";
import { ActivityPoller } from "../poller/activity.js";
import { NotificationPoller } from "../poller/notifications.js";

// Initialize the database
const rawDb = createDatabase();
const db = new GHDDatabase(rawDb);

// Start pollers asynchronously (don't block window creation)
void (async () => {
  try {
    const token = await resolveGitHubToken();
    const github = new FetchGitHubClient(token);
    const username = await resolveGitHubUsername(token);

    const notificationPoller = new NotificationPoller(db, github);
    const activityPoller = new ActivityPoller(db, github, username);

    notificationPoller.start();
    activityPoller.start();

    console.log(`[ghd] Pollers started for user: ${username}`);
  } catch (err) {
    console.error("[ghd] Failed to start pollers:", err);
  }
})();

new BrowserWindow({
  title: "GHD — GitHub Notification Dashboard",
  url: "views://mainview/index.html",
  frame: { width: 900, height: 700, x: 100, y: 100 },
  titleBarStyle: "hiddenInset",
});
