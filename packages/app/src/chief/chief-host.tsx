import { useEffect, useRef } from "react";
import { useCommandCenterContributions } from "@/command-center/provider";
import { registerCommandItems } from "./chief-runtime";

/**
 * Nazmul mod (chief): hands the Command Center's live item list to the Chief runtime, so an agent
 * can list and run the same items the user sees. Renders nothing. Mounted once, under
 * CommandCenterProvider.
 */
export function ChiefHost() {
  const { contributions } = useCommandCenterContributions();
  const latest = useRef(contributions);
  useEffect(() => {
    latest.current = contributions;
  }, [contributions]);
  useEffect(() => registerCommandItems(() => latest.current), []);
  return null;
}
