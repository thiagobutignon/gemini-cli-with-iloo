/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolRegistry } from '../tools/tool-registry.js';
import { Config } from '../config/config.js';
import { PromptContext } from '../prompts/improved-prompt-system.js';

/**
 * Represents an AI response to be validated
 */
export interface AIResponse {
  content: string;
  toolCalls: ToolCall[];
  reasoning?: ReasoningStep[];
  confidence?: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Represents a tool call in an AI response
 */
export interface ToolCall {
  name: string;
  parameters: Record<string, unknown>;
  id?: string;
  reasoning?: string;
}

/**
 * Represents a reasoning step in an AI response
 */
export interface ReasoningStep {
  type: 'observation' | 'analysis' | 'hypothesis' | 'verification' | 'decision' | 'action' | 'conclusion';
  content: string;
  evidence: string[];
  confidence: number;
}

/**
 * Result of response validation
 */
export interface ValidationResult {
  isValid: boolean;
  score: number; // 0-1 scale
  issues: ValidationIssue[];
  suggestions: string[];
  correctedResponse?: AIResponse;
  allowExecution: boolean;
}

/**
 * Represents a validation issue
 */
export interface ValidationIssue {
  type: ValidationIssueType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  location: string; // tool_call_0, reasoning_step_2, content, etc.
  suggestedFix?: string;
  evidence?: string[];
}

/**
 * Types of validation issues
 */
export type ValidationIssueType =
  | 'tool_not_available'
  | 'invalid_parameters'
  | 'constraint_violation'
  | 'logical_inconsistency'
  | 'insufficient_evidence'
  | 'hallucination_detected'
  | 'circular_reasoning'
  | 'unsafe_operation'
  | 'missing_reasoning'
  | 'low_confidence'
  | 'factual_error'
  | 'parameter_mismatch';

/**
 * Validation constraints
 */
export interface ValidationConstraints {
  minimumConfidence: number;
  allowedTools: string[];
  forbiddenOperations: string[];
  requireReasoning: boolean;
  requireEvidence: boolean;
  safetyChecks: boolean;
  factChecking: boolean;
  maxToolCalls: number;
  timeoutMs: number;
}

/**
 * Validation rule interface
 */
export interface ValidationRule {
  name: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  validate(response: AIResponse, context: PromptContext, constraints: ValidationConstraints): Promise<ValidationIssue[]>;
}

/**
 * Response validator that checks AI responses for accuracy, safety, and compliance
 */
export class ResponseValidator {
  private toolRegistry: ToolRegistry;
  private config: Config;
  private validationRules: ValidationRule[] = [];
  private factCheckCache: Map<string, boolean> = new Map();

  constructor(toolRegistry: ToolRegistry, config: Config) {
    this.toolRegistry = toolRegistry;
    this.config = config;
    this.initializeValidationRules();
  }

  /**
   * Validates an AI response comprehensively
   */
  async validateResponse(
    response: AIResponse,
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const suggestions: string[] = [];

    // Run all validation rules
    for (const rule of this.validationRules) {
      try {
        const ruleIssues = await rule.validate(response, context, constraints);
        issues.push(...ruleIssues);
      } catch (error) {
        issues.push({
          type: 'factual_error',
          severity: 'medium',
          message: `Validation rule '${rule.name}' failed: ${error}`,
          location: 'validator',
          evidence: [String(error)]
        });
      }
    }

    // Generate suggestions based on issues
    suggestions.push(...this.generateSuggestions(issues));

    // Calculate overall validation score
    const score = this.calculateValidationScore(issues, response);

    // Determine if execution should be allowed
    const allowExecution = this.shouldAllowExecution(issues, score, constraints);

    // Generate corrected response if possible
    const correctedResponse = await this.generateCorrectedResponse(response, issues, context);

    return {
      isValid: issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0,
      score,
      issues,
      suggestions,
      correctedResponse,
      allowExecution
    };
  }

  /**
   * Validates tool calls specifically
   */
  async validateToolCalls(
    toolCalls: ToolCall[],
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const availableTools = this.toolRegistry.getAllTools();
    const availableToolNames = availableTools.map(t => t.name);

    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const location = `tool_call_${i}`;

      // Check tool availability
      if (!availableToolNames.includes(toolCall.name)) {
        issues.push({
          type: 'tool_not_available',
          severity: 'critical',
          message: `Tool '${toolCall.name}' is not available`,
          location,
          suggestedFix: `Use available tools: ${availableToolNames.join(', ')}`,
          evidence: [`Available tools: ${availableToolNames.join(', ')}`]
        });
        continue;
      }

      // Check if tool is in allowed list
      if (constraints.allowedTools.length > 0 && !constraints.allowedTools.includes(toolCall.name)) {
        issues.push({
          type: 'constraint_violation',
          severity: 'high',
          message: `Tool '${toolCall.name}' is not in allowed tools list`,
          location,
          suggestedFix: `Use allowed tools: ${constraints.allowedTools.join(', ')}`,
          evidence: [`Allowed tools: ${constraints.allowedTools.join(', ')}`]
        });
        continue;
      }

      // Validate tool parameters
      const tool = availableTools.find(t => t.name === toolCall.name);
      if (tool) {
        const paramValidation = await this.validateToolParameters(tool, toolCall.parameters);
        if (paramValidation.length > 0) {
          issues.push(...paramValidation.map(issue => ({ ...issue, location })));
        }
      }

      // Check for unsafe operations
      if (await this.isUnsafeOperation(toolCall, context)) {
        issues.push({
          type: 'unsafe_operation',
          severity: 'high',
          message: `Tool call '${toolCall.name}' may be unsafe`,
          location,
          suggestedFix: 'Use safer alternatives or add safety checks',
          evidence: [`Tool: ${toolCall.name}`, `Parameters: ${JSON.stringify(toolCall.parameters)}`]
        });
      }
    }

    // Check tool call count
    if (toolCalls.length > constraints.maxToolCalls) {
      issues.push({
        type: 'constraint_violation',
        severity: 'medium',
        message: `Too many tool calls (${toolCalls.length} > ${constraints.maxToolCalls})`,
        location: 'tool_calls',
        suggestedFix: 'Reduce number of tool calls or break into multiple interactions',
        evidence: [`Tool call count: ${toolCalls.length}`, `Limit: ${constraints.maxToolCalls}`]
      });
    }

    return issues;
  }

  /**
   * Validates reasoning chain
   */
  async validateReasoning(
    reasoning: ReasoningStep[],
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    if (constraints.requireReasoning && reasoning.length === 0) {
      issues.push({
        type: 'missing_reasoning',
        severity: 'high',
        message: 'Reasoning is required but not provided',
        location: 'reasoning',
        suggestedFix: 'Add explicit reasoning steps',
        evidence: ['No reasoning steps found']
      });
      return issues;
    }

    for (let i = 0; i < reasoning.length; i++) {
      const step = reasoning[i];
      const location = `reasoning_step_${i}`;

      // Check confidence levels
      if (step.confidence < constraints.minimumConfidence) {
        issues.push({
          type: 'low_confidence',
          severity: 'medium',
          message: `Low confidence in reasoning step (${step.confidence.toFixed(2)} < ${constraints.minimumConfidence})`,
          location,
          suggestedFix: 'Provide more evidence or acknowledge uncertainty',
          evidence: [`Confidence: ${step.confidence.toFixed(2)}`, `Required: ${constraints.minimumConfidence}`]
        });
      }

      // Check for evidence when required
      if (constraints.requireEvidence && step.evidence.length === 0) {
        issues.push({
          type: 'insufficient_evidence',
          severity: 'medium',
          message: 'Reasoning step lacks supporting evidence',
          location,
          suggestedFix: 'Add evidence from tool outputs or observations',
          evidence: ['No evidence provided for reasoning step']
        });
      }

      // Check for circular reasoning
      if (i > 0 && this.isCircularReasoning(step, reasoning.slice(0, i))) {
        issues.push({
          type: 'circular_reasoning',
          severity: 'high',
          message: 'Circular reasoning detected',
          location,
          suggestedFix: 'Provide new evidence or different approach',
          evidence: [`Similar to previous steps`]
        });
      }

      // Check logical flow
      if (i > 0 && !this.isLogicalProgression(reasoning[i-1], step)) {
        issues.push({
          type: 'logical_inconsistency',
          severity: 'medium',
          message: 'Illogical progression in reasoning',
          location,
          suggestedFix: 'Ensure reasoning follows logical sequence',
          evidence: [`Previous step: ${reasoning[i-1].type}`, `Current step: ${step.type}`]
        });
      }
    }

    return issues;
  }

  /**
   * Validates factual claims in response content
   */
  async validateFactualClaims(
    content: string,
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    if (!constraints.factChecking) {
      return issues;
    }

    // Extract factual claims
    const claims = this.extractFactualClaims(content);

    for (const claim of claims) {
      const cacheKey = `${claim}_${context.workingDirectory}`;
      
      let isFactual: boolean;
      if (this.factCheckCache.has(cacheKey)) {
        isFactual = this.factCheckCache.get(cacheKey)!;
      } else {
        isFactual = await this.verifyFactualClaim(claim, context);
        this.factCheckCache.set(cacheKey, isFactual);
      }

      if (!isFactual) {
        issues.push({
          type: 'factual_error',
          severity: 'high',
          message: `Potentially incorrect factual claim: "${claim}"`,
          location: 'content',
          suggestedFix: 'Verify claim with available tools or acknowledge uncertainty',
          evidence: [`Claim: ${claim}`, `Verification: failed`]
        });
      }
    }

    return issues;
  }

  /**
   * Initialize validation rules
   */
  private initializeValidationRules(): void {
    this.validationRules = [
      new ToolAvailabilityRule(),
      new ParameterValidationRule(),
      new SafetyCheckRule(),
      new ReasoningValidationRule(),
      new ConfidenceValidationRule(),
      new ConstraintComplianceRule(),
      new HallucinationDetectionRule(),
      new LogicalConsistencyRule()
    ];
  }

  /**
   * Validates tool parameters against tool schema
   */
  private async validateToolParameters(
    tool: any,
    parameters: Record<string, unknown>
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Basic parameter validation
    if (!tool.schema || !tool.schema.parameters) {
      return issues;
    }

    const schema = tool.schema.parameters;
    const required = schema.required || [];

    // Check required parameters
    for (const param of required) {
      if (!(param in parameters)) {
        issues.push({
          type: 'invalid_parameters',
          severity: 'critical',
          message: `Missing required parameter: ${param}`,
          location: 'parameters',
          suggestedFix: `Add required parameter: ${param}`,
          evidence: [`Required parameters: ${required.join(', ')}`]
        });
      }
    }

    // Check parameter types (basic validation)
    if (schema.properties) {
      for (const [paramName, paramValue] of Object.entries(parameters)) {
        const paramSchema = schema.properties[paramName];
        if (paramSchema && paramSchema.type) {
          const actualType = typeof paramValue;
          const expectedType = paramSchema.type;
          
          if (!this.isValidParameterType(actualType, expectedType, paramValue)) {
            issues.push({
              type: 'parameter_mismatch',
              severity: 'high',
              message: `Parameter '${paramName}' type mismatch: expected ${expectedType}, got ${actualType}`,
              location: 'parameters',
              suggestedFix: `Correct parameter type for ${paramName}`,
              evidence: [`Expected: ${expectedType}`, `Actual: ${actualType}`]
            });
          }
        }
      }
    }

    return issues;
  }

  /**
   * Checks if a tool operation is unsafe
   */
  private async isUnsafeOperation(toolCall: ToolCall, context: PromptContext): Promise<boolean> {
    // Shell commands that could be dangerous
    if (toolCall.name === 'shell') {
      const command = toolCall.parameters.command as string;
      const dangerousCommands = ['rm -rf', 'sudo', 'chmod 777', 'mkfs', 'dd if=', 'kill -9'];
      
      return dangerousCommands.some(dangerous => 
        command?.toLowerCase().includes(dangerous.toLowerCase())
      );
    }

    // File operations that could be dangerous
    if (toolCall.name === 'write_file' || toolCall.name === 'edit') {
      const filePath = toolCall.parameters.file_path as string;
      const dangerousPaths = ['/etc/', '/usr/bin/', '/boot/', '/sys/', '/proc/'];
      
      return dangerousPaths.some(dangerous => 
        filePath?.toLowerCase().startsWith(dangerous.toLowerCase())
      );
    }

    return false;
  }

  /**
   * Extracts factual claims from content
   */
  private extractFactualClaims(content: string): string[] {
    const claims: string[] = [];
    
    // Simple pattern matching for factual statements
    const patterns = [
      /The file ([^.]+) contains/g,
      /There are (\d+) files/g,
      /The directory ([^.]+) exists/g,
      /The function ([^.]+) returns/g,
      /The variable ([^.]+) is set to/g
    ];

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        claims.push(...matches);
      }
    }

    return claims;
  }

  /**
   * Verifies a factual claim using available tools
   */
  private async verifyFactualClaim(claim: string, context: PromptContext): Promise<boolean> {
    // Simple verification - in a real implementation, this would use tools
    // to verify claims about files, directories, code, etc.
    
    // For now, assume claims about existence can be verified
    if (claim.includes('file') && claim.includes('exists')) {
      // Would use read_file or ls tool to verify
      return true; // Placeholder
    }
    
    if (claim.includes('directory') && claim.includes('contains')) {
      // Would use ls tool to verify
      return true; // Placeholder
    }
    
    // Default to accepting claims that can't be easily verified
    return true;
  }

  /**
   * Checks for circular reasoning
   */
  private isCircularReasoning(current: ReasoningStep, previous: ReasoningStep[]): boolean {
    const currentContent = current.content.toLowerCase();
    
    for (const prev of previous) {
      const prevContent = prev.content.toLowerCase();
      const similarity = this.calculateTextSimilarity(currentContent, prevContent);
      
      if (similarity > 0.8) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Checks for logical progression in reasoning
   */
  private isLogicalProgression(previous: ReasoningStep, current: ReasoningStep): boolean {
    const validProgressions = new Map([
      ['observation', ['analysis', 'hypothesis']],
      ['analysis', ['hypothesis', 'verification', 'decision']],
      ['hypothesis', ['verification', 'action']],
      ['verification', ['decision', 'conclusion']],
      ['decision', ['action']],
      ['action', ['verification', 'conclusion']]
    ]);

    const validNext = validProgressions.get(previous.type) || [];
    return validNext.includes(current.type);
  }

  /**
   * Calculates text similarity
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = text1.split(/\s+/);
    const words2 = text2.split(/\s+/);
    
    const intersection = words1.filter(word => words2.includes(word));
    const union = [...new Set([...words1, ...words2])];
    
    return intersection.length / union.length;
  }

  /**
   * Validates parameter type
   */
  private isValidParameterType(actualType: string, expectedType: string, value: unknown): boolean {
    switch (expectedType) {
      case 'string':
        return actualType === 'string';
      case 'number':
        return actualType === 'number' && !isNaN(value as number);
      case 'boolean':
        return actualType === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return actualType === 'object' && value !== null && !Array.isArray(value);
      default:
        return true; // Unknown types pass
    }
  }

  /**
   * Generates suggestions based on issues
   */
  private generateSuggestions(issues: ValidationIssue[]): string[] {
    const suggestions: string[] = [];
    
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    const highIssues = issues.filter(i => i.severity === 'high');
    
    if (criticalIssues.length > 0) {
      suggestions.push('Address critical issues before proceeding');
      suggestions.push('Verify tool availability and parameter correctness');
    }
    
    if (highIssues.length > 0) {
      suggestions.push('Review high-severity issues for safety and accuracy');
      suggestions.push('Consider alternative approaches for flagged operations');
    }
    
    const toolIssues = issues.filter(i => i.type === 'tool_not_available');
    if (toolIssues.length > 0) {
      suggestions.push('Use only verified available tools');
      suggestions.push('Check tool registry before attempting tool calls');
    }
    
    const reasoningIssues = issues.filter(i => i.type === 'missing_reasoning');
    if (reasoningIssues.length > 0) {
      suggestions.push('Provide explicit reasoning for complex decisions');
      suggestions.push('Include evidence to support conclusions');
    }
    
    return [...new Set(suggestions)];
  }

  /**
   * Calculates validation score
   */
  private calculateValidationScore(issues: ValidationIssue[], response: AIResponse): number {
    let score = 1.0;
    
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          score -= 0.4;
          break;
        case 'high':
          score -= 0.2;
          break;
        case 'medium':
          score -= 0.1;
          break;
        case 'low':
          score -= 0.05;
          break;
      }
    }
    
    // Bonus for having reasoning
    if (response.reasoning && response.reasoning.length > 0) {
      score += 0.1;
    }
    
    // Bonus for high confidence
    if (response.confidence && response.confidence > 0.8) {
      score += 0.05;
    }
    
    return Math.max(score, 0);
  }

  /**
   * Determines if execution should be allowed
   */
  private shouldAllowExecution(
    issues: ValidationIssue[],
    score: number,
    constraints: ValidationConstraints
  ): boolean {
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    const unsafeIssues = issues.filter(i => i.type === 'unsafe_operation');
    
    // Never allow if there are critical issues
    if (criticalIssues.length > 0) {
      return false;
    }
    
    // Never allow unsafe operations when safety checks are enabled
    if (constraints.safetyChecks && unsafeIssues.length > 0) {
      return false;
    }
    
    // Require minimum score
    return score >= 0.6;
  }

  /**
   * Generates a corrected response
   */
  private async generateCorrectedResponse(
    original: AIResponse,
    issues: ValidationIssue[],
    context: PromptContext
  ): Promise<AIResponse | undefined> {
    // Simple correction: remove invalid tool calls
    const validToolCalls = original.toolCalls.filter(toolCall => {
      const toolIssues = issues.filter(i => 
        i.location.includes('tool_call') && 
        (i.type === 'tool_not_available' || i.type === 'unsafe_operation')
      );
      
      return !toolIssues.some(issue => issue.message.includes(toolCall.name));
    });
    
    if (validToolCalls.length !== original.toolCalls.length) {
      return {
        ...original,
        toolCalls: validToolCalls,
        content: original.content + '\n\n[Note: Some tool calls were removed due to validation issues]'
      };
    }
    
    return undefined;
  }

  /**
   * Public API methods
   */
  addValidationRule(rule: ValidationRule): void {
    this.validationRules.push(rule);
  }

  removeValidationRule(ruleName: string): boolean {
    const index = this.validationRules.findIndex(r => r.name === ruleName);
    if (index !== -1) {
      this.validationRules.splice(index, 1);
      return true;
    }
    return false;
  }

  clearFactCheckCache(): void {
    this.factCheckCache.clear();
  }

  getValidationRules(): ValidationRule[] {
    return [...this.validationRules];
  }
}

/**
 * Validation rule implementations
 */

class ToolAvailabilityRule implements ValidationRule {
  name = 'ToolAvailability';
  description = 'Checks if all requested tools are available';
  severity = 'critical' as const;

  async validate(
    response: AIResponse,
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    for (const toolCall of response.toolCalls) {
      if (!context.availableTools.includes(toolCall.name)) {
        issues.push({
          type: 'tool_not_available',
          severity: 'critical',
          message: `Tool '${toolCall.name}' is not available`,
          location: 'tool_calls',
          suggestedFix: `Use available tools: ${context.availableTools.join(', ')}`,
          evidence: [`Available tools: ${context.availableTools.join(', ')}`]
        });
      }
    }
    
    return issues;
  }
}

class ParameterValidationRule implements ValidationRule {
  name = 'ParameterValidation';
  description = 'Validates tool call parameters';
  severity = 'high' as const;

  async validate(
    response: AIResponse,
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    for (const toolCall of response.toolCalls) {
      if (!toolCall.parameters || Object.keys(toolCall.parameters).length === 0) {
        issues.push({
          type: 'invalid_parameters',
          severity: 'high',
          message: `Tool '${toolCall.name}' called without parameters`,
          location: 'tool_calls',
          suggestedFix: 'Provide required parameters for tool call'
        });
      }
    }
    
    return issues;
  }
}

class SafetyCheckRule implements ValidationRule {
  name = 'SafetyCheck';
  description = 'Checks for potentially unsafe operations';
  severity = 'high' as const;

  async validate(
    response: AIResponse,
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    if (!constraints.safetyChecks) {
      return issues;
    }
    
    for (const toolCall of response.toolCalls) {
      if (toolCall.name === 'shell') {
        const command = toolCall.parameters.command as string;
        if (command && command.includes('rm -rf')) {
          issues.push({
            type: 'unsafe_operation',
            severity: 'high',
            message: 'Potentially dangerous shell command detected',
            location: 'tool_calls',
            suggestedFix: 'Use safer file operations or add confirmation',
            evidence: [`Command: ${command}`]
          });
        }
      }
    }
    
    return issues;
  }
}

class ReasoningValidationRule implements ValidationRule {
  name = 'ReasoningValidation';
  description = 'Validates reasoning chain quality';
  severity = 'medium' as const;

  async validate(
    response: AIResponse,
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    if (constraints.requireReasoning && (!response.reasoning || response.reasoning.length === 0)) {
      issues.push({
        type: 'missing_reasoning',
        severity: 'high',
        message: 'Reasoning is required but not provided',
        location: 'reasoning',
        suggestedFix: 'Add explicit reasoning steps'
      });
    }
    
    return issues;
  }
}

class ConfidenceValidationRule implements ValidationRule {
  name = 'ConfidenceValidation';
  description = 'Validates confidence levels';
  severity = 'medium' as const;

  async validate(
    response: AIResponse,
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    if (response.confidence && response.confidence < constraints.minimumConfidence) {
      issues.push({
        type: 'low_confidence',
        severity: 'medium',
        message: `Response confidence (${response.confidence.toFixed(2)}) below threshold (${constraints.minimumConfidence})`,
        location: 'response',
        suggestedFix: 'Provide more evidence or acknowledge uncertainty',
        evidence: [`Confidence: ${response.confidence}`, `Threshold: ${constraints.minimumConfidence}`]
      });
    }
    
    return issues;
  }
}

class ConstraintComplianceRule implements ValidationRule {
  name = 'ConstraintCompliance';
  description = 'Checks compliance with specified constraints';
  severity = 'high' as const;

  async validate(
    response: AIResponse,
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    // Check forbidden operations
    for (const forbidden of constraints.forbiddenOperations) {
      if (response.content.toLowerCase().includes(forbidden.toLowerCase())) {
        issues.push({
          type: 'constraint_violation',
          severity: 'high',
          message: `Response contains forbidden operation: ${forbidden}`,
          location: 'content',
          suggestedFix: 'Remove or replace forbidden operation',
          evidence: [`Forbidden: ${forbidden}`]
        });
      }
    }
    
    return issues;
  }
}

class HallucinationDetectionRule implements ValidationRule {
  name = 'HallucinationDetection';
  description = 'Detects potential hallucinations';
  severity = 'high' as const;

  async validate(
    response: AIResponse,
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    // Check for tool calls to non-existent tools
    for (const toolCall of response.toolCalls) {
      if (!context.availableTools.includes(toolCall.name)) {
        issues.push({
          type: 'hallucination_detected',
          severity: 'high',
          message: `Hallucinated tool call: ${toolCall.name}`,
          location: 'tool_calls',
          suggestedFix: 'Use only verified available tools',
          evidence: [`Non-existent tool: ${toolCall.name}`]
        });
      }
    }
    
    return issues;
  }
}

class LogicalConsistencyRule implements ValidationRule {
  name = 'LogicalConsistency';
  description = 'Checks for logical consistency in reasoning';
  severity = 'medium' as const;

  async validate(
    response: AIResponse,
    context: PromptContext,
    constraints: ValidationConstraints
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    if (!response.reasoning) {
      return issues;
    }
    
    // Check for contradictory statements
    for (let i = 0; i < response.reasoning.length - 1; i++) {
      const current = response.reasoning[i];
      const next = response.reasoning[i + 1];
      
      if (this.areContradictory(current, next)) {
        issues.push({
          type: 'logical_inconsistency',
          severity: 'medium',
          message: 'Contradictory reasoning steps detected',
          location: `reasoning_step_${i}`,
          suggestedFix: 'Resolve contradiction in reasoning',
          evidence: [`Step ${i}: ${current.content}`, `Step ${i+1}: ${next.content}`]
        });
      }
    }
    
    return issues;
  }

  private areContradictory(step1: ReasoningStep, step2: ReasoningStep): boolean {
    // Simple contradiction detection - could be more sophisticated
    const content1 = step1.content.toLowerCase();
    const content2 = step2.content.toLowerCase();
    
    const contradictoryPairs = [
      ['exists', 'does not exist'],
      ['true', 'false'],
      ['valid', 'invalid'],
      ['possible', 'impossible']
    ];
    
    for (const [positive, negative] of contradictoryPairs) {
      if (content1.includes(positive) && content2.includes(negative)) {
        return true;
      }
      if (content1.includes(negative) && content2.includes(positive)) {
        return true;
      }
    }
    
    return false;
  }
}