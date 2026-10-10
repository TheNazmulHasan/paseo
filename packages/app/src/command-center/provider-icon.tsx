import { withUnistyles } from "react-native-unistyles";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { useProviderIcon } from "@/components/provider-icons";
import type { CommandCenterIcon, CommandCenterIconProps } from "./contributions";

const commandCenterProviderIcons = new Map<AgentProvider, CommandCenterIcon>();

function ProviderGlyph({
  provider,
  size,
  color,
}: {
  provider: AgentProvider;
  size: number;
  color: string;
}) {
  const Icon = useProviderIcon(provider);
  return <Icon size={size} color={color} />;
}

const ThemedProviderGlyph = withUnistyles(ProviderGlyph, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export function getCommandCenterProviderIcon(provider: AgentProvider): CommandCenterIcon {
  const cached = commandCenterProviderIcons.get(provider);
  if (cached) return cached;

  function CommandCenterProviderIcon({ size }: CommandCenterIconProps) {
    return <ThemedProviderGlyph provider={provider} size={size} />;
  }
  commandCenterProviderIcons.set(provider, CommandCenterProviderIcon);
  return CommandCenterProviderIcon;
}
