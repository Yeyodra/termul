/**
 * The ACP config id of the host-managed Claude agent.
 *
 * Kept out of `claude-account-switch` (which owns the switching behaviour)
 * because that module imports the acp store, and a component that only needs
 * this string must not drag the whole store into its boot chain.
 */

export const CLAUDE_AGENT_CONFIG_ID = 'acp-registry:claude-acp'
