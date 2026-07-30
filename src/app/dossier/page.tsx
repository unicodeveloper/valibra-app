import { Workspace } from "../Workspace";
import { routeMetadata } from "../route-metadata";

export const metadata = routeMetadata({
  title: "Evidence dossier",
  description:
    "Labelling, trials and literature for one molecule assembled into a cited dossier a reviewer can read, quote or export.",
  path: "/dossier",
  image: "https://files.catbox.moe/fxobm8.png",
  fallbackImage: "/og/dossier.png",
  imageAlt: "OpenMLR evidence dossier - cited labelling, trials and literature for one drug.",
});

/** The dossier tab at its own address, so a reload or a shared link lands here
 *  rather than bouncing back to the compose screen. */
export default function Page() {
  return <Workspace key="dossier" initialView="dossier" />;
}
