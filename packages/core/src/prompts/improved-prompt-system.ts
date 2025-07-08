/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolRegistry } from '../tools/tool-registry.js';
import { Config } from '../config/config.js';
import { ReasoningEngine, ReasoningContext } from '../reasoning/reasoning-engine.js';
import { HierarchicalPlanner, PlanExecutionContext } from '../planning/hierarchical-planner.js';

/**
 * Context for prompt generation
 */
export interface PromptContext {
  conversationType: 'code_assistance' | 'analysis' | 'planning' | 'general' | 'debugging' | 'mcp_tool_usage';
  userGoal: string;
  workingDirectory: string;
  availableTools: string[];
  projectType?: string;
  constraints: string[];
  previousInteractions: string[];
  confidenceThreshold: number;
  requiresPlanning: boolean;
  requiresReasoning: boolean;
}

/**
 * Prompt template for different scenarios
 */
export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  toolContextTemplate: string;
  validationPrompt: string;
  applicableContexts: PromptContext['conversationType'][];
}

/**
 * Improved prompt system that addresses hallucination issues
 */
export class ImprovedPromptSystem {
  private toolRegistry: ToolRegistry;
  private config: Config;
  private reasoningEngine: ReasoningEngine;
  private hierarchicalPlanner: HierarchicalPlanner;
  private templates: Map<string, PromptTemplate> = new Map();

  constructor(
    toolRegistry: ToolRegistry,
    config: Config,
    reasoningEngine: ReasoningEngine,
    hierarchicalPlanner: HierarchicalPlanner
  ) {
    this.toolRegistry = toolRegistry;
    this.config = config;
    this.reasoningEngine = reasoningEngine;
    this.hierarchicalPlanner = hierarchicalPlanner;
    this.initializeTemplates();
  }

  /**
   * Generates a context-aware system prompt
   */
  generateSystemPrompt(context: PromptContext): string {
    const template = this.selectBestTemplate(context);
    const availableTools = this.getVerifiedAvailableTools();
    const toolContext = this.generateToolContext(availableTools, context);
    const reasoningInstructions = this.generateReasoningInstructions(context);
    const validationInstructions = this.generateValidationInstructions(context);

    return `${template.systemPrompt}

${toolContext}

${reasoningInstructions}

${validationInstructions}

## Current Context
- Working Directory: ${context.workingDirectory}
- User Goal: ${context.userGoal}
- Conversation Type: ${context.conversationType}
- Available Tools: ${availableTools.length} tools verified
- Constraints: ${context.constraints.join(', ') || 'None'}
- Confidence Threshold: ${context.confidenceThreshold}

## Critical Instructions
1. **Tool Verification**: ONLY use tools from the verified available tools list
2. **Reasoning Chain**: If requiresReasoning=true, provide explicit reasoning steps
3. **Planning**: If requiresPlanning=true, break down complex tasks into steps
4. **Validation**: Validate all claims against available evidence
5. **Confidence**: Provide confidence scores for major decisions
6. **Error Handling**: Gracefully handle missing tools or failed operations
`;
  }

  /**
   * Generates user prompt with proper context injection
   */
  generateUserPrompt(userInput: string, context: PromptContext): string {
    const template = this.selectBestTemplate(context);
    
    let prompt = template.userPromptTemplate
      .replace('{USER_INPUT}', userInput)
      .replace('{WORKING_DIRECTORY}', context.workingDirectory)
      .replace('{AVAILABLE_TOOLS}', context.availableTools.join(', '));

    // Add reasoning prompt if required
    if (context.requiresReasoning) {
      prompt += `

## Reasoning Required
Please provide explicit reasoning for your approach:
1. **Observation**: What do you observe about the current situation?
2. **Hypothesis**: What do you think needs to be done?
3. **Verification**: How will you verify your approach?
4. **Action**: What specific steps will you take?
5. **Validation**: How will you validate the results?
`;
    }

    // Add planning prompt if required
    if (context.requiresPlanning) {
      prompt += `

## Planning Required
Please break down this task into a hierarchical plan:
1. **Goal Analysis**: What is the ultimate goal?
2. **Step Decomposition**: What are the main steps?
3. **Tool Requirements**: What tools are needed for each step?
4. **Dependencies**: What are the step dependencies?
5. **Risk Assessment**: What are potential issues?
`;
    }

    return prompt;
  }

  /**
   * Generates tool context with verification
   */
  private generateToolContext(availableTools: string[], context: PromptContext): string {
    const tools = this.toolRegistry.getAllTools();
    const verifiedTools = tools.filter(tool => availableTools.includes(tool.name));

    let toolContext = `## Verified Available Tools (${verifiedTools.length} tools)

IMPORTANT: Only use tools from this verified list. Do not assume any tool exists beyond these.

### File System Tools
`;

    const fileSystemTools = verifiedTools.filter(t => 
      ['read_file', 'write_file', 'edit', 'ls', 'glob', 'grep'].includes(t.name)
    );

    fileSystemTools.forEach(tool => {
      toolContext += `- **${tool.name}**: ${tool.description}\n`;
    });

    toolContext += `\n### Shell & System Tools
`;

    const shellTools = verifiedTools.filter(t => 
      ['shell'].includes(t.name)
    );

    shellTools.forEach(tool => {
      toolContext += `- **${tool.name}**: ${tool.description}\n`;
    });

    toolContext += `\n### Web & Network Tools
`;

    const webTools = verifiedTools.filter(t => 
      ['web_fetch', 'web_search'].includes(t.name)
    );

    webTools.forEach(tool => {
      toolContext += `- **${tool.name}**: ${tool.description}\n`;
    });

    toolContext += `\n### Memory & State Tools
`;

    const memoryTools = verifiedTools.filter(t => 
      t.name.includes('memory') || t.name.includes('state')
    );

    memoryTools.forEach(tool => {
      toolContext += `- **${tool.name}**: ${tool.description}\n`;
    });

    // Add MCP tools if any
    const mcpTools = verifiedTools.filter(t => 
      !['read_file', 'write_file', 'edit', 'ls', 'glob', 'grep', 'shell', 'web_fetch', 'web_search'].includes(t.name) &&
      !t.name.includes('memory')
    );

    if (mcpTools.length > 0) {
      toolContext += `\n### MCP (Model Context Protocol) Tools
`;
      mcpTools.forEach(tool => {
        toolContext += `- **${tool.name}**: ${tool.description}\n`;
      });
    }

    toolContext += `\n### Tool Usage Guidelines
1. **Always verify tool availability** before attempting to use any tool
2. **Use appropriate tools for the task** - don't use shell for simple file operations
3. **Handle tool failures gracefully** - provide alternatives if a tool fails
4. **Respect tool limitations** - understand what each tool can and cannot do
5. **Validate tool outputs** - check that tool results make sense
`;

    return toolContext;
  }

  /**
   * Generates reasoning instructions based on context
   */
  private generateReasoningInstructions(context: PromptContext): string {
    if (!context.requiresReasoning) {
      return '';
    }

    return `## Reasoning Framework

You MUST follow structured reasoning for this interaction:

### 1. Explicit Reasoning Chain
- **Observation**: State what you observe about the current situation
- **Analysis**: Analyze the problem and identify key factors
- **Hypothesis**: Form hypotheses about solutions
- **Verification**: Plan how to test/verify your approach
- **Decision**: Make explicit decisions with rationale
- **Action**: Take concrete steps
- **Validation**: Check results against expectations

### 2. Confidence Assessment
- Provide confidence scores (0-1) for major decisions
- Explain factors contributing to confidence levels
- Acknowledge uncertainties and assumptions

### 3. Evidence-Based Claims
- Support all claims with verifiable evidence
- Cite tool outputs, file contents, or system responses
- Distinguish between facts, assumptions, and hypotheses

### 4. Alternative Consideration
- Consider multiple approaches when applicable
- Explain why you chose one approach over alternatives
- Identify potential failure modes and fallback strategies
`;
  }

  /**
   * Generates validation instructions
   */
  private generateValidationInstructions(context: PromptContext): string {
    return `## Validation & Quality Assurance

### Pre-Action Validation
1. **Tool Availability**: Verify all required tools exist before planning
2. **Parameter Validation**: Check that tool parameters are valid
3. **Constraint Checking**: Ensure approach respects all constraints
4. **Dependency Verification**: Confirm all dependencies are satisfied

### Post-Action Validation
1. **Result Verification**: Check that tool outputs match expectations
2. **Goal Achievement**: Validate that actions move toward the stated goal
3. **Side Effect Analysis**: Consider unintended consequences
4. **Error Detection**: Identify and report any issues or failures

### Confidence & Uncertainty Management
- Minimum confidence threshold: ${context.confidenceThreshold}
- Flag low-confidence decisions for user review
- Clearly communicate assumptions and uncertainties
- Provide alternative approaches when confidence is low

### Hallucination Prevention
1. **Fact Checking**: Only claim what can be verified through tools
2. **Tool Result Accuracy**: Report tool outputs exactly as received
3. **Assumption Transparency**: Clearly label assumptions vs facts
4. **Evidence Chain**: Maintain clear chain from evidence to conclusions
`;
  }

  /**
   * Selects the best template for the given context
   */
  private selectBestTemplate(context: PromptContext): PromptTemplate {
    const applicableTemplates = Array.from(this.templates.values())
      .filter(template => template.applicableContexts.includes(context.conversationType));

    if (applicableTemplates.length === 0) {
      return this.templates.get('general')!;
    }

    // Select most specific template
    return applicableTemplates[0];
  }

  /**
   * Gets verified available tools
   */
  private getVerifiedAvailableTools(): string[] {
    return this.toolRegistry.getAllTools().map(tool => tool.name);
  }

  /**
   * Initializes prompt templates
   */
  private initializeTemplates(): void {
    // General purpose template
    this.templates.set('general', {
      id: 'general',
      name: 'General Assistant',
      description: 'General purpose AI assistant with tool access',
      systemPrompt: `You are a capable AI assistant with access to various tools. You help users accomplish their goals efficiently and accurately.

## Core Principles
1. **Accuracy**: Only claim what you can verify
2. **Efficiency**: Use the most appropriate tools for each task
3. **Transparency**: Explain your reasoning and limitations
4. **Safety**: Respect constraints and handle errors gracefully`,
      userPromptTemplate: `User Goal: {USER_INPUT}
Working Directory: {WORKING_DIRECTORY}
Available Tools: {AVAILABLE_TOOLS}`,
      toolContextTemplate: '',
      validationPrompt: '',
      applicableContexts: ['general']
    });

    // Code assistance template
    this.templates.set('code_assistance', {
      id: 'code_assistance',
      name: 'Code Assistant',
      description: 'Specialized assistant for code-related tasks',
      systemPrompt: `You are an expert code assistant specializing in TypeScript, Node.js, and Clean Architecture. You help with code analysis, debugging, refactoring, and development tasks.

## Expertise Areas
1. **Clean Architecture**: Domain, Data, Infra, Presentation, Main layers
2. **TypeScript/Node.js**: Modern ES modules, async/await, type safety
3. **Testing**: Jest, TDD methodology, unit and integration tests
4. **Code Quality**: ESLint, Prettier, SOLID principles
5. **Project Analysis**: Dependency analysis, architecture validation

## Code Analysis Approach
1. **Structure Analysis**: Examine project structure and patterns
2. **Dependency Review**: Check imports and module relationships
3. **Quality Assessment**: Evaluate code quality and maintainability
4. **Test Coverage**: Analyze test completeness and quality
5. **Improvement Suggestions**: Provide actionable recommendations`,
      userPromptTemplate: `Code Task: {USER_INPUT}
Project Directory: {WORKING_DIRECTORY}
Development Tools: {AVAILABLE_TOOLS}

Please analyze the codebase and provide expert assistance.`,
      toolContextTemplate: '',
      validationPrompt: '',
      applicableContexts: ['code_assistance', 'debugging']
    });

    // Analysis template
    this.templates.set('analysis', {
      id: 'analysis',
      name: 'Analysis Specialist',
      description: 'Deep analysis and investigation assistant',
      systemPrompt: `You are an analysis specialist who excels at understanding complex systems, identifying patterns, and providing comprehensive insights.

## Analysis Methodology
1. **Systematic Investigation**: Use structured approaches to gather information
2. **Multi-Perspective Analysis**: Consider technical, business, and user perspectives
3. **Pattern Recognition**: Identify recurring themes and relationships
4. **Evidence-Based Conclusions**: Support findings with concrete evidence
5. **Actionable Insights**: Provide practical recommendations

## Investigation Process
1. **Scope Definition**: Clearly define what needs to be analyzed
2. **Data Gathering**: Systematically collect relevant information
3. **Pattern Analysis**: Look for trends, anomalies, and relationships
4. **Synthesis**: Combine findings into coherent insights
5. **Recommendations**: Provide actionable next steps`,
      userPromptTemplate: `Analysis Request: {USER_INPUT}
Target Directory: {WORKING_DIRECTORY}
Analysis Tools: {AVAILABLE_TOOLS}

Please conduct a thorough analysis and provide comprehensive insights.`,
      toolContextTemplate: '',
      validationPrompt: '',
      applicableContexts: ['analysis']
    });

    // Planning template
    this.templates.set('planning', {
      id: 'planning',
      name: 'Planning Specialist',
      description: 'Strategic planning and task decomposition',
      systemPrompt: `You are a planning specialist who excels at breaking down complex goals into manageable, executable plans.

## Planning Methodology
1. **Goal Clarification**: Ensure clear understanding of objectives
2. **Decomposition**: Break complex tasks into manageable steps
3. **Dependency Mapping**: Identify step dependencies and prerequisites
4. **Resource Planning**: Determine required tools and resources
5. **Risk Assessment**: Identify potential issues and mitigation strategies
6. **Timeline Estimation**: Provide realistic time estimates

## Plan Structure
- **Phases**: High-level groupings of related tasks
- **Steps**: Specific, actionable tasks within each phase
- **Dependencies**: Prerequisites for each step
- **Tools**: Required tools for each step
- **Validation**: Success criteria for each step`,
      userPromptTemplate: `Planning Request: {USER_INPUT}
Project Context: {WORKING_DIRECTORY}
Available Resources: {AVAILABLE_TOOLS}

Please create a comprehensive, executable plan.`,
      toolContextTemplate: '',
      validationPrompt: '',
      applicableContexts: ['planning']
    });

    // MCP tool usage template
    this.templates.set('mcp_tools', {
      id: 'mcp_tools',
      name: 'MCP Tool Specialist',
      description: 'Specialized in using Model Context Protocol tools',
      systemPrompt: `You are an expert in Model Context Protocol (MCP) tools, capable of leveraging advanced analysis and development capabilities.

## MCP Tool Expertise
1. **Tool Discovery**: Understand available MCP tools and their capabilities
2. **Appropriate Usage**: Select the right tool for each task
3. **Parameter Optimization**: Use tools with optimal parameters
4. **Result Interpretation**: Properly interpret and act on tool outputs
5. **Tool Chaining**: Combine multiple tools for complex workflows

## MCP Tool Categories
- **Analysis Tools**: Deep code and system analysis
- **Planning Tools**: Strategic planning and reasoning
- **Development Tools**: Code generation and refactoring
- **Quality Tools**: Testing, metrics, and validation
- **Integration Tools**: System integration and workflows

## Best Practices
1. **Verify Tool Availability**: Always confirm tool exists before use
2. **Validate Parameters**: Ensure parameters match tool requirements
3. **Handle Failures**: Gracefully handle tool errors or unavailability
4. **Interpret Results**: Properly understand and communicate tool outputs
5. **Chain Effectively**: Use multiple tools in logical sequences`,
      userPromptTemplate: `MCP Task: {USER_INPUT}
Working Context: {WORKING_DIRECTORY}
MCP Tools Available: {AVAILABLE_TOOLS}

Please leverage MCP tools to accomplish this task effectively.`,
      toolContextTemplate: '',
      validationPrompt: '',
      applicableContexts: ['mcp_tool_usage']
    });
  }

  /**
   * Creates a reasoning context from prompt context
   */
  createReasoningContext(promptContext: PromptContext): ReasoningContext {
    return {
      availableTools: promptContext.availableTools,
      workingDirectory: promptContext.workingDirectory,
      previousChains: promptContext.previousInteractions,
      constraints: promptContext.constraints,
      timeoutMs: 300000, // 5 minutes
      maxSteps: 20,
      validationRequired: true
    };
  }

  /**
   * Creates a plan execution context from prompt context
   */
  createPlanExecutionContext(promptContext: PromptContext): PlanExecutionContext {
    return {
      currentStep: 0,
      completedSteps: [],
      availableTools: promptContext.availableTools,
      toolRegistry: this.toolRegistry,
      config: this.config,
      userGoal: promptContext.userGoal,
      workingDirectory: promptContext.workingDirectory,
      timeoutMs: 600000 // 10 minutes
    };
  }

  /**
   * Validates a generated prompt for quality
   */
  validatePrompt(prompt: string, context: PromptContext): {
    isValid: boolean;
    issues: string[];
    suggestions: string[];
  } {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check prompt length
    if (prompt.length < 100) {
      issues.push('Prompt is too short to be effective');
    }

    if (prompt.length > 10000) {
      issues.push('Prompt is too long and may cause confusion');
      suggestions.push('Consider breaking down into smaller, focused prompts');
    }

    // Check for tool references
    const toolReferences = this.extractToolReferences(prompt);
    const availableTools = this.getVerifiedAvailableTools();
    
    for (const tool of toolReferences) {
      if (!availableTools.includes(tool)) {
        issues.push(`Prompt references unavailable tool: ${tool}`);
        suggestions.push(`Remove reference to ${tool} or provide alternative`);
      }
    }

    // Check for reasoning instructions when required
    if (context.requiresReasoning && !prompt.includes('reasoning')) {
      issues.push('Reasoning is required but not mentioned in prompt');
      suggestions.push('Add explicit reasoning instructions');
    }

    // Check for planning instructions when required
    if (context.requiresPlanning && !prompt.includes('plan')) {
      issues.push('Planning is required but not mentioned in prompt');
      suggestions.push('Add explicit planning instructions');
    }

    return {
      isValid: issues.length === 0,
      issues,
      suggestions
    };
  }

  /**
   * Extracts tool references from prompt text
   */
  private extractToolReferences(prompt: string): string[] {
    const toolPattern = /\b(read_file|write_file|edit|ls|grep|shell|web_fetch|web_search|glob|mcp_\w+)\b/g;
    const matches = prompt.match(toolPattern);
    return matches || [];
  }

  /**
   * Public API methods
   */
  getTemplate(templateId: string): PromptTemplate | undefined {
    return this.templates.get(templateId);
  }

  getAllTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  addCustomTemplate(template: PromptTemplate): void {
    this.templates.set(template.id, template);
  }

  removeTemplate(templateId: string): boolean {
    return this.templates.delete(templateId);
  }
}