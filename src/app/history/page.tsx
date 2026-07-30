import { Workspace } from "../Workspace";
import { routeMetadata } from "../route-metadata";

export const metadata = routeMetadata({
  title: "Review history",
  description:
    "Every review keeps its claims, findings, reviewer decisions and queried datasets, ready to reopen or export later.",
  path: "/history",
  image: "https://files.catbox.moe/03sagb.png",
  fallbackImage: "/og/history.png",
  imageAlt: "OpenMLR review history - every review and decision stays on the record.",
});

/** The history tab at its own address, so a reload or a shared link lands here
 *  rather than bouncing back to the compose screen. */
export default function Page() {
  return <Workspace key="history" initialView="history" />;
}
