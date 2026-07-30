import { Workspace } from "../Workspace";
import { routeMetadata } from "../route-metadata";

export const metadata = routeMetadata({
  title: "Evidence dossier",
  description:
    "Approved labelling, the trial record and the peer-reviewed literature for one molecule, assembled into a cited document a reviewer can read, quote and hand on — or export as DOCX.",
  path: "/dossier",
});

/** The dossier tab at its own address, so a reload or a shared link lands here
 *  rather than bouncing back to the compose screen. */
export default function Page() {
  return <Workspace key="dossier" initialView="dossier" />;
}
