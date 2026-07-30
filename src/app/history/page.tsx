import { Workspace } from "../Workspace";
import { routeMetadata } from "../route-metadata";

export const metadata = routeMetadata({
  title: "Review history",
  description:
    "Every review kept on the record — its claims, findings, reviewer decisions and the datasets it queried. Reopen any run, or export it as an evidence dossier.",
  path: "/history",
});

/** The history tab at its own address, so a reload or a shared link lands here
 *  rather than bouncing back to the compose screen. */
export default function Page() {
  return <Workspace key="history" initialView="history" />;
}
