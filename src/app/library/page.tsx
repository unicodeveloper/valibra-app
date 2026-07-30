import { Workspace } from "../Workspace";
import { routeMetadata } from "../route-metadata";

export const metadata = routeMetadata({
  title: "Claims library",
  description:
    "Accepted claims are saved with the evidence that cleared them, so reused lines bring their substantiation with them.",
  path: "/library",
  image: "https://files.catbox.moe/bruxc1.png",
  fallbackImage: "/og/library.png",
  imageAlt: "OpenMLR claims library - accepted claims and their evidence are reused.",
});

/** The library tab at its own address, so a reload or a shared link lands here
 *  rather than bouncing back to the compose screen. */
export default function Page() {
  return <Workspace key="library" initialView="library" />;
}
