import { Workspace } from "./Workspace";

/** The workspace at its default address. A specific saved review lives at
 *  /review/[id] (see app/review/[id]/page.tsx) so it survives a refresh. */
export default function Page() {
  // Keyed so navigating here from /review/[id] remounts the shell fresh (a clean
  // compose screen) rather than reconciling and keeping the prior review loaded —
  // both routes render <Workspace> at the same position, so without a distinct
  // key React reuses the instance and its state.
  return <Workspace key="home" />;
}
