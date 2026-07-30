import { Workspace } from "../Workspace";
import { routeMetadata } from "../route-metadata";

export const metadata = routeMetadata({
  title: "Claims library",
  description:
    "Claims a reviewer has already accepted, kept with the evidence that cleared them — so the next asset reusing a line reuses its substantiation instead of paying for the search again.",
  path: "/library",
});

/** The library tab at its own address, so a reload or a shared link lands here
 *  rather than bouncing back to the compose screen. */
export default function Page() {
  return <Workspace key="library" initialView="library" />;
}
