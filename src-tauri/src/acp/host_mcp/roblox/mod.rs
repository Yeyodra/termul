//! Roblox Studio context for the host MCP layer.
//!
//! Text only: the instruction block that tells the agent the open place is the
//! target of the request. No tools, no proxy, no router here.

pub mod instructions;

#[cfg(test)]
#[path = "instructions_tests.rs"]
mod tests;
