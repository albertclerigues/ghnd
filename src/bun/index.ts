import { BrowserWindow } from "electrobun";
import { createDatabase } from "../db/client.js";

createDatabase();

new BrowserWindow({
  title: "GHD — GitHub Notification Dashboard",
  url: "views://mainview/index.html",
  frame: { width: 900, height: 700, x: 100, y: 100 },
  titleBarStyle: "hiddenInset",
});
