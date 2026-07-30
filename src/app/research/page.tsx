import { Workspace } from "../Workspace";
import { routeMetadata } from "../route-metadata";

export const metadata = routeMetadata({
  title: "Deep research",
  description:
    "Long-form MLR checks for surveillance, device and indication questions, grounded in licensed datasets and safe to leave running.",
  path: "/research",
  image: "https://files.catbox.moe/9flk1d.png",
  fallbackImage: "/og/research.png",
  imageAlt: "OpenMLR deep research - long-form checks against licensed datasets.",
});

/** The research tab at its own address, so a reload or a shared link lands here
 *  rather than bouncing back to the compose screen. */
export default function Page() {
  return <Workspace key="research" initialView="research" />;
}
