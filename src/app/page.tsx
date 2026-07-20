import { Workspace } from "./Workspace";

/** The workspace at its default address. A specific saved review lives at
 *  /review/[id] (see app/review/[id]/page.tsx) so it survives a refresh. */
export default function Page() {
  return <Workspace />;
}
