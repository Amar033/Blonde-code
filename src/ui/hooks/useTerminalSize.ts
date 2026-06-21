// Thin wrapper kept for backwards compat — delegates to OpenTUI's hook.
// Consumers that already use this hook don't need updating.
export { useTerminalDimensions as useTerminalSize } from '@opentui/react';
