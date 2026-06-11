import { showHUD } from "@raycast/api";
import { requestStop } from "./session";

export default async function main() {
  const result = requestStop();
  await showHUD(result === "not-running" ? "Nothing is running" : "⏹ Stopped");
}
