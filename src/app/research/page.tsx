import { Workspace } from "../Workspace";
import { routeMetadata } from "../route-metadata";

export const metadata = routeMetadata({
  title: "Deep research",
  description:
    "The MLR checks that need real research — post-market surveillance, device and indication questions — run as long-form research against licensed datasets, and keep running after the tab is closed.",
  path: "/research",
});

/** The research tab at its own address, so a reload or a shared link lands here
 *  rather than bouncing back to the compose screen. */
export default function Page() {
  return <Workspace key="research" initialView="research" />;
}
