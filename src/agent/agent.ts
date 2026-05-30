// Agent registry and configuration for Blonde
// Inspired by OpenCode's agent system

import { z } from "zod";

// Agent configuration schema
export const AgentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  prompt: z.string().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  hidden: z.boolean().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// Default agent configurations
const defaultAgents: Record<string, AgentConfig> = {
  build: {
    name: "build",
    description: "The default agent. Executes tools based on configured permissions.",
    mode: "primary",
    temperature: 0.3,
    topP: 0.9,
    prompt: `You are a coding agent. Your goal is to accomplish the user's task using the available tools.
You should think step by step and use the tools to explore, read, write, and modify files as needed.
When you have enough information to answer the user, provide your final answer.
If you need more information, ask clarifying questions.
Always verify your work and avoid unnecessary tool calls.`,
  },
  plan: {
    name: "plan",
    description: "Plan mode. Disallows all edit tools.",
    mode: "primary",
    temperature: 0.7,
    topP: 0.9,
    prompt: `You are a planning agent. Your goal is to create a high-level plan to accomplish the user's task.
You should break down the task into clear, actionable steps.
Do not attempt to execute the plan or use edit tools.
Focus only on planning and reasoning about what needs to be done.`,
  },
  general: {
    name: "general",
    description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
    mode: "subagent",
    temperature: 0.5,
    topP: 0.9,
    prompt: `You are a general-purpose agent. You can perform research, answer questions, and execute multi-step tasks.
You have access to various tools for exploration, analysis, and information gathering.
When executing tasks, break them down into smaller steps and use tools efficiently.
For complex tasks, consider spawning subagents to work in parallel.`,
  },
  explore: {
    name: "explore",
    description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
    mode: "subagent",
    temperature: 0.3,
    topP: 0.9,
    prompt: `You are an exploration agent. Your goal is to help the user understand the codebase by finding files, searching for patterns, and answering questions about the structure and content.
You excel at:
- Finding files by name patterns (glob)
- Searching for content within files (grep)
- Listing directory contents
- Reading files to understand their purpose
- Fetching web content when needed
- Searching the web for information
Always start with the least invasive operations and build up your understanding systematically.
Provide clear, concise answers based on your findings.`,
  },
  compaction: {
    name: "compaction",
    description: "Compacts conversation history to save tokens",
    mode: "primary",
    hidden: true,
    temperature: 0.3,
    topP: 0.9,
    prompt: `You are a compaction agent. Your goal is to summarize the conversation history while preserving important information.
Create a concise summary that captures:
- The user's original request
- Important decisions made
- Key findings from tool usage
- Current state of the task
Keep the summary as short as possible while retaining essential context for continuing the task.`,
  },
  title: {
    name: "title",
    description: "Generates titles for conversations",
    mode: "primary",
    hidden: true,
    temperature: 0.5,
    topP: 0.9,
    prompt: `You are a title generation agent. Your goal is to create a concise, descriptive title for the conversation based on the user's request and the work accomplished.
The title should be:
- Short (under 60 characters)
- Descriptive of the task
- Free of special characters or formatting
Return only the title text, nothing else.`,
  },
  summary: {
    name: "summary",
    description: "Summarizes completed work",
    mode: "primary",
    hidden: true,
    temperature: 0.3,
    topP: 0.9,
    prompt: `You are a summary agent. Your goal is to summarize what was accomplished during the task.
Focus on:
- What was requested
- What was done to fulfill the request
- Any important findings or decisions
- The final outcome or result
Keep the summary informative but concise.`,
  },
};

// Agent registry state
let agentRegistry: Record<string, AgentConfig> = { ...defaultAgents };

// Initialize the agent registry
export function initializeAgentRegistry() {
  agentRegistry = { ...defaultAgents };
  // In the future, we could load from config files or environment
}

// Get an agent by name
export async function getAgent(name: string): Promise<AgentConfig | undefined> {
  return agentRegistry[name];
}

// List all agents
export async function listAgents(): Promise<AgentConfig[]> {
  return Object.values(agentRegistry);
}

// Get the default agent name
export async function getDefaultAgent(): Promise<string> {
  // For now, return "build" as default
  // In the future, we could check config or environment
  return "build";
}

// Set an agent configuration (for custom agents)
export function setAgent(name: string, config: AgentConfig): void {
  agentRegistry[name] = { ...defaultAgents[name], ...config };
}

// Generate a new agent configuration based on description
// This is a simplified version - in the future we could use an LLM to generate this
export async function generateAgent(description: string): Promise<AgentConfig> {
  // For now, return a basic agent configuration
  // In the future, we would use the LLM to generate this based on the description
  const agentName = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    name: agentName,
    description,
    mode: "subagent",
    temperature: 0.5,
    topP: 0.9,
    prompt: `You are a ${agentName} agent. ${description}

Use the available tools to accomplish your goals. Think step by step and verify your work.`,
  };
}