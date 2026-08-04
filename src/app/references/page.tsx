import { Workspace } from "../Workspace";
import { routeMetadata } from "../route-metadata";

export const metadata = routeMetadata({
  title: "Reference packs",
  description:
    "Upload the approved sources your copy was written from, and every claim is checked against your own documents before the licensed literature.",
  path: "/references",
  // No dedicated card for this tab yet, so both point at the generic one rather
  // than at an image that does not exist.
  image: "/og/openmlr.png",
  fallbackImage: "/og/openmlr.png",
  imageAlt: "OpenMLR reference packs - check claims against your own approved sources.",
});

/** The references tab at its own address, so a reload or a shared link lands here
 *  rather than bouncing back to the compose screen. */
export default function Page() {
  return <Workspace key="references" initialView="references" />;
}
