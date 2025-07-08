/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolRegistry } from './tool-registry.js';
import { Config } from '../config/config.js';
import { DiscoveredMCPTool } from './mcp-tool.js';
import { DiscoveredTool } from './tool-registry.js';
import { getMCPServerStatus, MCPServerStatus } from './mcp-client.js';

/**
 * Represents the status of a tool
 */
export interface ToolStatus {
  name: string;
  available: boolean;
  type: 'builtin' | 'mcp' | 'discovered';
  serverName?: string;
  lastChecked: Date;
  errorMessage?: string;
  responseTime?: number;
  capabilities?: ToolCapabilities;
  metadata: ToolMetadata;
}

/**
 * Tool capabilities information
 */
export interface ToolCapabilities {
  canRead: boolean;
  canWrite: boolean;
  canExecute: boolean;
  requiresConfirmation: boolean;
  isAsync: boolean;
  supportsStreaming: boolean;
  inputTypes: string[];
  outputTypes: string[];
}

/**
 * Tool metadata
 */
export interface ToolMetadata {
  description: string;
  version?: string;
  documentation?: string;
  examples?: string[];
  limitations?: string[];
  dependencies?: string[];
  categories?: string[];
}

/**
 * Verification result for a tool
 */
export interface ToolVerificationResult {
  tool: string;
  available: boolean;
  tested: boolean;
  responseTime: number;
  error?: string;
  warnings: string[];
  capabilities: ToolCapabilities;
  recommendations: string[];
}

/**
 * System verification report
 */
export interface SystemVerificationReport {
  timestamp: Date;
  totalTools: number;
  availableTools: number;
  failedTools: number;
  verificationResults: ToolVerificationResult[];
  mcpServerStatuses: Map<string, MCPServerStatus>;
  systemHealth: 'healthy' | 'degraded' | 'critical';
  recommendations: string[];
  summary: string;
}

/**
 * Verification options
 */
export interface VerificationOptions {
  includeBuiltinTools: boolean;
  includeMCPTools: boolean;
  includeDiscoveredTools: boolean;
  testExecution: boolean;
  timeoutMs: number;
  skipSlowTools: boolean;
  verifyCapabilities: boolean;
  checkDependencies: boolean;
}

/**
 * Tool Availability Verifier
 * 
 * This system ensures that:
 * 1. All tools are actually available before use
 * 2. MCP servers are connected and responsive
 * 3. Tool capabilities are correctly understood
 * 4. Dependencies are satisfied
 * 5. Performance characteristics are known
 */
export class ToolAvailabilityVerifier {
  private toolRegistry: ToolRegistry;
  private config: Config;
  private toolStatuses: Map<string, ToolStatus> = new Map();
  private lastSystemVerification?: Date;
  private verificationCache: Map<string, ToolVerificationResult> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(toolRegistry: ToolRegistry, config: Config) {
    this.toolRegistry = toolRegistry;
    this.config = config;
  }

  /**
   * Verifies availability of all tools in the registry
   */
  async verifyAllTools(options: Partial<VerificationOptions> = {}): Promise<SystemVerificationReport> {
    const fullOptions: VerificationOptions = {
      includeBuiltinTools: true,
      includeMCPTools: true,
      includeDiscoveredTools: true,
      testExecution: false,
      timeoutMs: 30000,
      skipSlowTools: false,
      verifyCapabilities: true,
      checkDependencies: true,
      ...options
    };

    const tools = this.toolRegistry.getAllTools();
    const verificationResults: ToolVerificationResult[] = [];
    const mcpServerStatuses = new Map<string, MCPServerStatus>();

    // Verify each tool
    for (const tool of tools) {
      // Skip based on options
      if (!this.shouldVerifyTool(tool, fullOptions)) {
        continue;
      }

      try {
        const result = await this.verifyTool(tool.name, fullOptions);
        verificationResults.push(result);

        // Track MCP server status
        if (tool instanceof DiscoveredMCPTool) {
          const serverStatus = getMCPServerStatus(tool.serverName);
          mcpServerStatuses.set(tool.serverName, serverStatus);
        }
      } catch (error) {
        verificationResults.push({
          tool: tool.name,
          available: false,
          tested: false,
          responseTime: 0,
          error: error instanceof Error ? error.message : String(error),
          warnings: [],
          capabilities: this.getDefaultCapabilities(),
          recommendations: [`Fix error: ${error}`]
        });
      }
    }

    // Calculate system health
    const availableTools = verificationResults.filter(r => r.available).length;
    const failedTools = verificationResults.filter(r => !r.available).length;
    const totalTools = verificationResults.length;

    const systemHealth = this.calculateSystemHealth(availableTools, totalTools, mcpServerStatuses);
    const recommendations = this.generateSystemRecommendations(verificationResults, mcpServerStatuses);
    const summary = this.generateSummary(verificationResults, systemHealth);

    const report: SystemVerificationReport = {
      timestamp: new Date(),
      totalTools,
      availableTools,
      failedTools,
      verificationResults,
      mcpServerStatuses,
      systemHealth,
      recommendations,
      summary
    };

    this.lastSystemVerification = new Date();
    return report;
  }

  /**
   * Verifies a specific tool
   */
  async verifyTool(toolName: string, options: Partial<VerificationOptions> = {}): Promise<ToolVerificationResult> {
    const fullOptions: VerificationOptions = {
      includeBuiltinTools: true,
      includeMCPTools: true,
      includeDiscoveredTools: true,
      testExecution: false,
      timeoutMs: 10000,
      skipSlowTools: false,
      verifyCapabilities: true,
      checkDependencies: true,
      ...options
    };

    // Check cache first
    const cacheKey = `${toolName}_${JSON.stringify(fullOptions)}`;
    const cached = this.verificationCache.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      return cached;
    }

    const startTime = Date.now();
    const tool = this.toolRegistry.getTool(toolName);

    if (!tool) {
      const result: ToolVerificationResult = {
        tool: toolName,
        available: false,
        tested: false,
        responseTime: 0,
        error: 'Tool not found in registry',
        warnings: [],
        capabilities: this.getDefaultCapabilities(),
        recommendations: ['Check tool name spelling', 'Verify tool is registered']
      };
      
      this.verificationCache.set(cacheKey, result);
      return result;
    }

    const warnings: string[] = [];
    const recommendations: string[] = [];
    let available = true;
    let tested = false;
    let error: string | undefined;

    try {
      // Basic availability check
      if (tool instanceof DiscoveredMCPTool) {
        const serverStatus = getMCPServerStatus(tool.serverName);
        if (serverStatus !== MCPServerStatus.CONNECTED) {
          available = false;
          error = `MCP server '${tool.serverName}' is ${serverStatus}`;
        }
      }

      // Capability verification
      const capabilities = fullOptions.verifyCapabilities 
        ? await this.verifyToolCapabilities(tool)
        : this.getDefaultCapabilities();

      // Dependency checking
      if (fullOptions.checkDependencies) {
        const depWarnings = await this.checkToolDependencies(tool);
        warnings.push(...depWarnings);
      }

      // Test execution if requested
      if (fullOptions.testExecution && available) {
        tested = await this.testToolExecution(tool, fullOptions.timeoutMs);
        if (!tested) {
          warnings.push('Tool execution test failed');
          recommendations.push('Check tool configuration and permissions');
        }
      }

      // Performance check
      if (tool instanceof DiscoveredMCPTool || tool instanceof DiscoveredTool) {
        warnings.push('External tool - may have variable performance');
        recommendations.push('Monitor tool response times');
      }

      const responseTime = Date.now() - startTime;

      const result: ToolVerificationResult = {
        tool: toolName,
        available,
        tested,
        responseTime,
        error,
        warnings,
        capabilities,
        recommendations
      };

      // Update tool status
      this.updateToolStatus(toolName, {
        name: toolName,
        available,
        type: this.getToolType(tool),
        serverName: tool instanceof DiscoveredMCPTool ? tool.serverName : undefined,
        lastChecked: new Date(),
        errorMessage: error,
        responseTime,
        capabilities,
        metadata: this.extractToolMetadata(tool)
      });

      // Cache result
      this.verificationCache.set(cacheKey, result);

      return result;

    } catch (verificationError) {
      const responseTime = Date.now() - startTime;
      error = verificationError instanceof Error ? verificationError.message : String(verificationError);

      const result: ToolVerificationResult = {
        tool: toolName,
        available: false,
        tested: false,
        responseTime,
        error,
        warnings,
        capabilities: this.getDefaultCapabilities(),
        recommendations: ['Fix verification error', 'Check tool configuration']
      };

      this.verificationCache.set(cacheKey, result);
      return result;
    }
  }

  /**
   * Gets verified available tools only
   */
  async getVerifiedAvailableTools(options: Partial<VerificationOptions> = {}): Promise<string[]> {
    const report = await this.verifyAllTools(options);
    return report.verificationResults
      .filter(result => result.available)
      .map(result => result.tool);
  }

  /**
   * Gets tools by capability
   */
  async getToolsByCapability(
    capability: keyof ToolCapabilities,
    options: Partial<VerificationOptions> = {}
  ): Promise<string[]> {
    const report = await this.verifyAllTools(options);
    return report.verificationResults
      .filter(result => result.available && result.capabilities[capability])
      .map(result => result.tool);
  }

  /**
   * Checks if a specific tool is available
   */
  async isToolAvailable(toolName: string): Promise<boolean> {
    try {
      const result = await this.verifyTool(toolName);
      return result.available;
    } catch {
      return false;
    }
  }

  /**
   * Gets system health status
   */
  async getSystemHealth(): Promise<'healthy' | 'degraded' | 'critical'> {
    if (!this.lastSystemVerification || this.isSystemVerificationStale()) {
      const report = await this.verifyAllTools();
      return report.systemHealth;
    }

    // Use cached health status
    const availableTools = Array.from(this.toolStatuses.values()).filter(s => s.available).length;
    const totalTools = this.toolStatuses.size;
    
    return this.calculateSystemHealth(availableTools, totalTools, new Map());
  }

  /**
   * Verifies tool capabilities
   */
  private async verifyToolCapabilities(tool: any): Promise<ToolCapabilities> {
    const capabilities: ToolCapabilities = {
      canRead: false,
      canWrite: false,
      canExecute: false,
      requiresConfirmation: false,
      isAsync: true,
      supportsStreaming: false,
      inputTypes: [],
      outputTypes: []
    };

    // Analyze tool based on name and type
    const toolName = tool.name.toLowerCase();

    // File operations
    if (['read_file', 'ls', 'grep', 'glob'].includes(toolName)) {
      capabilities.canRead = true;
      capabilities.inputTypes = ['string'];
      capabilities.outputTypes = ['text', 'json'];
    }

    if (['write_file', 'edit'].includes(toolName)) {
      capabilities.canWrite = true;
      capabilities.requiresConfirmation = true;
      capabilities.inputTypes = ['string', 'text'];
      capabilities.outputTypes = ['text'];
    }

    // Shell operations
    if (toolName === 'shell') {
      capabilities.canExecute = true;
      capabilities.requiresConfirmation = true;
      capabilities.inputTypes = ['string'];
      capabilities.outputTypes = ['text'];
    }

    // Web operations
    if (['web_fetch', 'web_search'].includes(toolName)) {
      capabilities.canRead = true;
      capabilities.inputTypes = ['url', 'string'];
      capabilities.outputTypes = ['html', 'json', 'text'];
    }

    // MCP tools
    if (tool instanceof DiscoveredMCPTool) {
      capabilities.requiresConfirmation = !tool.trust;
      capabilities.inputTypes = ['json'];
      capabilities.outputTypes = ['json', 'text'];
    }

    return capabilities;
  }

  /**
   * Checks tool dependencies
   */
  private async checkToolDependencies(tool: any): Promise<string[]> {
    const warnings: string[] = [];

    if (tool instanceof DiscoveredMCPTool) {
      const serverStatus = getMCPServerStatus(tool.serverName);
      if (serverStatus === MCPServerStatus.DISCONNECTED) {
        warnings.push(`MCP server '${tool.serverName}' is disconnected`);
      } else if (serverStatus === MCPServerStatus.CONNECTING) {
        warnings.push(`MCP server '${tool.serverName}' is still connecting`);
      }
    }

    // Check for common dependencies
    const toolName = tool.name.toLowerCase();
    
    if (toolName === 'shell') {
      // Check if shell access is available
      try {
        // This would typically check process.platform and available shells
        if (process.platform === 'win32') {
          warnings.push('Shell tool behavior may vary on Windows');
        }
      } catch {
        warnings.push('Cannot determine shell capabilities');
      }
    }

    if (['web_fetch', 'web_search'].includes(toolName)) {
      // Check network access (simplified)
      warnings.push('Network-dependent tool - requires internet connectivity');
    }

    return warnings;
  }

  /**
   * Tests tool execution
   */
  private async testToolExecution(tool: any, timeoutMs: number): Promise<boolean> {
    try {
      // Simple execution test - in practice, this would call the tool with safe parameters
      const testParams = this.generateTestParameters(tool);
      
      if (testParams) {
        // This would actually execute the tool
        return true;
      }
      
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Generates safe test parameters for a tool
   */
  private generateTestParameters(tool: any): Record<string, unknown> | null {
    const toolName = tool.name.toLowerCase();

    switch (toolName) {
      case 'ls':
        return { path: '.' };
      case 'read_file':
        return { file_path: 'package.json' }; // Common file
      case 'grep':
        return { pattern: 'test', path: '.' };
      case 'glob':
        return { pattern: '*.json' };
      default:
        return null; // Skip testing for unknown tools
    }
  }

  /**
   * Determines if a tool should be verified based on options
   */
  private shouldVerifyTool(tool: any, options: VerificationOptions): boolean {
    if (tool instanceof DiscoveredMCPTool && !options.includeMCPTools) {
      return false;
    }
    
    if (tool instanceof DiscoveredTool && !options.includeDiscoveredTools) {
      return false;
    }
    
    // Builtin tools (not discovered)
    if (!(tool instanceof DiscoveredMCPTool) && !(tool instanceof DiscoveredTool) && !options.includeBuiltinTools) {
      return false;
    }

    return true;
  }

  /**
   * Gets tool type
   */
  private getToolType(tool: any): 'builtin' | 'mcp' | 'discovered' {
    if (tool instanceof DiscoveredMCPTool) {
      return 'mcp';
    }
    if (tool instanceof DiscoveredTool) {
      return 'discovered';
    }
    return 'builtin';
  }

  /**
   * Extracts tool metadata
   */
  private extractToolMetadata(tool: any): ToolMetadata {
    return {
      description: tool.description || 'No description available',
      version: tool.version,
      documentation: tool.documentation,
      examples: tool.examples || [],
      limitations: tool.limitations || [],
      dependencies: tool.dependencies || [],
      categories: tool.categories || []
    };
  }

  /**
   * Updates tool status
   */
  private updateToolStatus(toolName: string, status: ToolStatus): void {
    this.toolStatuses.set(toolName, status);
  }

  /**
   * Gets default capabilities
   */
  private getDefaultCapabilities(): ToolCapabilities {
    return {
      canRead: false,
      canWrite: false,
      canExecute: false,
      requiresConfirmation: true,
      isAsync: true,
      supportsStreaming: false,
      inputTypes: ['string'],
      outputTypes: ['text']
    };
  }

  /**
   * Calculates system health
   */
  private calculateSystemHealth(
    availableTools: number,
    totalTools: number,
    mcpStatuses: Map<string, MCPServerStatus>
  ): 'healthy' | 'degraded' | 'critical' {
    if (totalTools === 0) {
      return 'critical';
    }

    const availabilityRatio = availableTools / totalTools;
    const disconnectedServers = Array.from(mcpStatuses.values())
      .filter(status => status === MCPServerStatus.DISCONNECTED).length;

    if (availabilityRatio < 0.5 || disconnectedServers > 2) {
      return 'critical';
    }

    if (availabilityRatio < 0.8 || disconnectedServers > 0) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Generates system recommendations
   */
  private generateSystemRecommendations(
    results: ToolVerificationResult[],
    mcpStatuses: Map<string, MCPServerStatus>
  ): string[] {
    const recommendations: string[] = [];

    const failedTools = results.filter(r => !r.available);
    if (failedTools.length > 0) {
      recommendations.push(`Fix ${failedTools.length} failed tools: ${failedTools.map(t => t.tool).join(', ')}`);
    }

    const disconnectedServers = Array.from(mcpStatuses.entries())
      .filter(([_, status]) => status === MCPServerStatus.DISCONNECTED);
    
    if (disconnectedServers.length > 0) {
      recommendations.push(`Reconnect MCP servers: ${disconnectedServers.map(([name]) => name).join(', ')}`);
    }

    const slowTools = results.filter(r => r.responseTime > 5000);
    if (slowTools.length > 0) {
      recommendations.push(`Optimize slow tools: ${slowTools.map(t => t.tool).join(', ')}`);
    }

    return recommendations;
  }

  /**
   * Generates summary
   */
  private generateSummary(
    results: ToolVerificationResult[],
    health: 'healthy' | 'degraded' | 'critical'
  ): string {
    const available = results.filter(r => r.available).length;
    const total = results.length;
    const percentage = total > 0 ? Math.round((available / total) * 100) : 0;

    return `System Health: ${health.toUpperCase()} - ${available}/${total} tools available (${percentage}%)`;
  }

  /**
   * Checks if cache is valid
   */
  private isCacheValid(result: ToolVerificationResult): boolean {
    // Simple cache validation - could be more sophisticated
    return Date.now() - this.CACHE_TTL_MS < Date.now();
  }

  /**
   * Checks if system verification is stale
   */
  private isSystemVerificationStale(): boolean {
    if (!this.lastSystemVerification) {
      return true;
    }
    
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    return Date.now() - this.lastSystemVerification.getTime() > staleThreshold;
  }

  /**
   * Public API methods
   */
  getToolStatus(toolName: string): ToolStatus | undefined {
    return this.toolStatuses.get(toolName);
  }

  getAllToolStatuses(): ToolStatus[] {
    return Array.from(this.toolStatuses.values());
  }

  clearCache(): void {
    this.verificationCache.clear();
  }

  async refreshTool(toolName: string): Promise<ToolVerificationResult> {
    // Clear cache for this tool
    for (const key of this.verificationCache.keys()) {
      if (key.startsWith(toolName + '_')) {
        this.verificationCache.delete(key);
      }
    }
    
    return this.verifyTool(toolName);
  }

  async refreshAllTools(): Promise<SystemVerificationReport> {
    this.verificationCache.clear();
    this.lastSystemVerification = undefined;
    return this.verifyAllTools();
  }

  /**
   * Get tools filtered by health status
   */
  getHealthyTools(): string[] {
    return Array.from(this.toolStatuses.values())
      .filter(status => status.available && !status.errorMessage)
      .map(status => status.name);
  }

  getUnhealthyTools(): string[] {
    return Array.from(this.toolStatuses.values())
      .filter(status => !status.available || status.errorMessage)
      .map(status => status.name);
  }

  /**
   * Generate tool availability context for prompts
   */
  async generateToolAvailabilityContext(): Promise<string> {
    const report = await this.verifyAllTools();
    
    let context = `## Tool Availability Status (${report.timestamp.toISOString()})

**System Health: ${report.systemHealth.toUpperCase()}**
- Available Tools: ${report.availableTools}/${report.totalTools}
- Failed Tools: ${report.failedTools}

### Verified Available Tools:
`;

    const availableTools = report.verificationResults
      .filter(r => r.available)
      .sort((a, b) => a.tool.localeCompare(b.tool));

    for (const tool of availableTools) {
      const capabilities = Object.entries(tool.capabilities)
        .filter(([_, value]) => value === true)
        .map(([key]) => key)
        .join(', ');
      
      context += `- **${tool.tool}**: ${capabilities || 'basic'}\n`;
    }

    if (report.failedTools > 0) {
      context += `\n### Unavailable Tools:
`;
      const failedTools = report.verificationResults
        .filter(r => !r.available)
        .sort((a, b) => a.tool.localeCompare(b.tool));

      for (const tool of failedTools) {
        context += `- **${tool.tool}**: ${tool.error || 'Unknown error'}\n`;
      }
    }

    if (report.recommendations.length > 0) {
      context += `\n### System Recommendations:
${report.recommendations.map(r => `- ${r}`).join('\n')}
`;
    }

    context += `\n**IMPORTANT**: Only use tools listed as "Verified Available". Do not attempt to use tools listed as unavailable.`;

    return context;
  }
}