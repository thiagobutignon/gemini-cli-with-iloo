/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolRegistry } from '../tools/tool-registry.js';
import { Config } from '../config/config.js';

/**
 * Represents a single reasoning step in a chain
 */
export interface ReasoningStep {
  id: string;
  type: 'observation' | 'hypothesis' | 'verification' | 'conclusion' | 'action';
  content: string;
  confidence: number; // 0-1 scale
  evidence: string[];
  assumptions: string[];
  alternatives: string[];
  validationStatus: 'pending' | 'validated' | 'rejected';
  timestamp: Date;
}

/**
 * Represents a complete reasoning chain
 */
export interface ReasoningChain {
  id: string;
  goal: string;
  steps: ReasoningStep[];
  currentStep: number;
  overallConfidence: number;
  status: 'active' | 'completed' | 'failed' | 'paused';
  createdAt: Date;
  updatedAt: Date;
  context: ReasoningContext;
}

/**
 * Context information for reasoning
 */
export interface ReasoningContext {
  availableTools: string[];
  workingDirectory: string;
  previousChains: string[];
  constraints: string[];
  timeoutMs: number;
  maxSteps: number;
  validationRequired: boolean;
}

/**
 * Result of reasoning validation
 */
export interface ReasoningValidation {
  isValid: boolean;
  confidence: number;
  issues: ReasoningIssue[];
  suggestions: string[];
}

/**
 * Represents an issue in reasoning
 */
export interface ReasoningIssue {
  type: 'logical_inconsistency' | 'missing_evidence' | 'weak_assumption' | 'circular_reasoning' | 'tool_availability' | 'constraint_violation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  stepId: string;
  description: string;
  suggestedFix: string;
}

/**
 * Decision point in reasoning
 */
export interface DecisionPoint {
  id: string;
  question: string;
  options: DecisionOption[];
  selectedOption?: string;
  rationale: string;
  confidence: number;
  timestamp: Date;
}

/**
 * Option for a decision
 */
export interface DecisionOption {
  id: string;
  description: string;
  pros: string[];
  cons: string[];
  riskLevel: 'low' | 'medium' | 'high';
  feasibilityScore: number; // 0-1 scale
  requiredTools: string[];
}

/**
 * Reasoning Engine for structured decision making and validation
 * 
 * This addresses hallucination by:
 * 1. Forcing explicit reasoning steps
 * 2. Validating logical consistency
 * 3. Checking evidence and assumptions
 * 4. Providing confidence scores
 * 5. Detecting circular reasoning
 */
export class ReasoningEngine {
  private toolRegistry: ToolRegistry;
  private config: Config;
  private activeChains: Map<string, ReasoningChain> = new Map();
  private validationRules: ValidationRule[] = [];

  constructor(toolRegistry: ToolRegistry, config: Config) {
    this.toolRegistry = toolRegistry;
    this.config = config;
    this.initializeValidationRules();
  }

  /**
   * Starts a new reasoning chain
   */
  async startReasoning(
    goal: string,
    context: ReasoningContext
  ): Promise<ReasoningChain> {
    const chain: ReasoningChain = {
      id: this.generateChainId(),
      goal,
      steps: [],
      currentStep: 0,
      overallConfidence: 0,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      context
    };

    // Start with initial observation
    const initialStep: ReasoningStep = {
      id: 'step-0',
      type: 'observation',
      content: `Starting reasoning for goal: ${goal}`,
      confidence: 0.9,
      evidence: [`Goal: ${goal}`],
      assumptions: [],
      alternatives: [],
      validationStatus: 'validated',
      timestamp: new Date()
    };

    chain.steps.push(initialStep);
    this.activeChains.set(chain.id, chain);

    return chain;
  }

  /**
   * Adds a reasoning step to a chain
   */
  async addReasoningStep(
    chainId: string,
    stepType: ReasoningStep['type'],
    content: string,
    evidence: string[] = [],
    assumptions: string[] = [],
    alternatives: string[] = []
  ): Promise<ReasoningStep> {
    const chain = this.activeChains.get(chainId);
    if (!chain) {
      throw new Error(`Reasoning chain ${chainId} not found`);
    }

    const step: ReasoningStep = {
      id: `step-${chain.steps.length}`,
      type: stepType,
      content,
      confidence: 0,
      evidence,
      assumptions,
      alternatives,
      validationStatus: 'pending',
      timestamp: new Date()
    };

    // Calculate confidence based on evidence and assumptions
    step.confidence = this.calculateStepConfidence(step, chain);

    // Validate the step
    const validation = await this.validateReasoningStep(step, chain);
    if (validation.isValid) {
      step.validationStatus = 'validated';
    } else {
      step.validationStatus = 'rejected';
      // Store validation issues for debugging
      step.evidence.push(`Validation issues: ${validation.issues.map(i => i.description).join(', ')}`);
    }

    chain.steps.push(step);
    chain.currentStep = chain.steps.length - 1;
    chain.updatedAt = new Date();

    // Update overall confidence
    chain.overallConfidence = this.calculateOverallConfidence(chain);

    return step;
  }

  /**
   * Validates a reasoning step
   */
  private async validateReasoningStep(
    step: ReasoningStep,
    chain: ReasoningChain
  ): Promise<ReasoningValidation> {
    const issues: ReasoningIssue[] = [];
    const suggestions: string[] = [];

    // Apply validation rules
    for (const rule of this.validationRules) {
      const ruleResult = await rule.validate(step, chain, this.toolRegistry);
      if (!ruleResult.isValid) {
        issues.push(...ruleResult.issues);
        suggestions.push(...ruleResult.suggestions);
      }
    }

    // Check for tool availability
    if (step.type === 'action') {
      const toolsInContent = this.extractToolsFromContent(step.content);
      const availableTools = this.toolRegistry.getAllTools().map(t => t.name);
      
      for (const tool of toolsInContent) {
        if (!availableTools.includes(tool)) {
          issues.push({
            type: 'tool_availability',
            severity: 'high',
            stepId: step.id,
            description: `Tool '${tool}' is not available`,
            suggestedFix: `Use available tools: ${availableTools.join(', ')}`
          });
        }
      }
    }

    // Check for circular reasoning
    if (this.hasCircularReasoning(step, chain)) {
      issues.push({
        type: 'circular_reasoning',
        severity: 'high',
        stepId: step.id,
        description: 'Circular reasoning detected',
        suggestedFix: 'Provide new evidence or approach'
      });
    }

    const criticalIssues = issues.filter(i => i.severity === 'critical');
    const highIssues = issues.filter(i => i.severity === 'high');

    return {
      isValid: criticalIssues.length === 0 && highIssues.length === 0,
      confidence: this.calculateValidationConfidence(issues),
      issues,
      suggestions
    };
  }

  /**
   * Creates a decision point in reasoning
   */
  async createDecisionPoint(
    chainId: string,
    question: string,
    options: DecisionOption[]
  ): Promise<DecisionPoint> {
    const chain = this.activeChains.get(chainId);
    if (!chain) {
      throw new Error(`Reasoning chain ${chainId} not found`);
    }

    // Validate options
    for (const option of options) {
      option.feasibilityScore = await this.calculateFeasibilityScore(option, chain);
    }

    // Sort options by feasibility
    options.sort((a, b) => b.feasibilityScore - a.feasibilityScore);

    const decisionPoint: DecisionPoint = {
      id: `decision-${Date.now()}`,
      question,
      options,
      rationale: '',
      confidence: 0,
      timestamp: new Date()
    };

    // Add decision step to chain
    await this.addReasoningStep(
      chainId,
      'action',
      `Decision point: ${question}`,
      [`${options.length} options evaluated`],
      ['Best option will be selected based on feasibility'],
      options.map(o => o.description)
    );

    return decisionPoint;
  }

  /**
   * Selects the best option for a decision point
   */
  async makeDecision(
    chainId: string,
    decisionPoint: DecisionPoint,
    rationale?: string
  ): Promise<DecisionOption> {
    const selectedOption = decisionPoint.options[0]; // Best option by feasibility
    
    decisionPoint.selectedOption = selectedOption.id;
    decisionPoint.rationale = rationale || `Selected based on highest feasibility score (${selectedOption.feasibilityScore.toFixed(2)})`;
    decisionPoint.confidence = selectedOption.feasibilityScore;

    // Add conclusion step
    await this.addReasoningStep(
      chainId,
      'conclusion',
      `Decision made: ${selectedOption.description}`,
      [`Feasibility score: ${selectedOption.feasibilityScore.toFixed(2)}`, `Rationale: ${decisionPoint.rationale}`],
      [`Option is feasible with available tools`],
      []
    );

    return selectedOption;
  }

  /**
   * Completes a reasoning chain
   */
  async completeReasoning(
    chainId: string,
    finalConclusion: string
  ): Promise<ReasoningChain> {
    const chain = this.activeChains.get(chainId);
    if (!chain) {
      throw new Error(`Reasoning chain ${chainId} not found`);
    }

    // Add final conclusion step
    await this.addReasoningStep(
      chainId,
      'conclusion',
      finalConclusion,
      [`Chain completed with ${chain.steps.length} steps`],
      [`All critical steps validated`],
      []
    );

    chain.status = 'completed';
    chain.updatedAt = new Date();

    return chain;
  }

  /**
   * Validates entire reasoning chain
   */
  async validateChain(chainId: string): Promise<ReasoningValidation> {
    const chain = this.activeChains.get(chainId);
    if (!chain) {
      throw new Error(`Reasoning chain ${chainId} not found`);
    }

    const allIssues: ReasoningIssue[] = [];
    const allSuggestions: string[] = [];

    // Validate each step
    for (const step of chain.steps) {
      const stepValidation = await this.validateReasoningStep(step, chain);
      allIssues.push(...stepValidation.issues);
      allSuggestions.push(...stepValidation.suggestions);
    }

    // Check chain-level issues
    if (chain.steps.length < 3) {
      allIssues.push({
        type: 'logical_inconsistency',
        severity: 'medium',
        stepId: 'chain',
        description: 'Reasoning chain is too short',
        suggestedFix: 'Add more detailed reasoning steps'
      });
    }

    // Check for proper conclusion
    const hasConclusion = chain.steps.some(s => s.type === 'conclusion');
    if (!hasConclusion) {
      allIssues.push({
        type: 'logical_inconsistency',
        severity: 'high',
        stepId: 'chain',
        description: 'No conclusion step found',
        suggestedFix: 'Add a conclusion step'
      });
    }

    return {
      isValid: allIssues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0,
      confidence: chain.overallConfidence,
      issues: allIssues,
      suggestions: [...new Set(allSuggestions)]
    };
  }

  /**
   * Helper methods
   */
  private initializeValidationRules(): void {
    this.validationRules = [
      new EvidenceValidationRule(),
      new AssumptionValidationRule(),
      new LogicalConsistencyRule(),
      new ConstraintValidationRule()
    ];
  }

  private generateChainId(): string {
    return 'reasoning_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  private calculateStepConfidence(step: ReasoningStep, chain: ReasoningChain): number {
    let confidence = 0.5; // Base confidence

    // Evidence quality
    if (step.evidence.length > 0) {
      confidence += Math.min(step.evidence.length * 0.1, 0.3);
    }

    // Assumption quality (fewer assumptions = higher confidence)
    if (step.assumptions.length === 0) {
      confidence += 0.1;
    } else {
      confidence -= Math.min(step.assumptions.length * 0.05, 0.2);
    }

    // Step type confidence
    switch (step.type) {
      case 'observation':
        confidence += 0.1;
        break;
      case 'verification':
        confidence += 0.2;
        break;
      case 'conclusion':
        confidence += 0.1;
        break;
      default:
        break;
    }

    // Chain consistency
    if (chain.steps.length > 1) {
      const previousStep = chain.steps[chain.steps.length - 2];
      if (this.isLogicallyConsistent(previousStep, step)) {
        confidence += 0.1;
      }
    }

    return Math.min(confidence, 1.0);
  }

  private calculateOverallConfidence(chain: ReasoningChain): number {
    if (chain.steps.length === 0) return 0;

    const validSteps = chain.steps.filter(s => s.validationStatus === 'validated');
    const avgConfidence = validSteps.reduce((sum, step) => sum + step.confidence, 0) / validSteps.length;
    
    // Penalty for rejected steps
    const rejectedSteps = chain.steps.filter(s => s.validationStatus === 'rejected');
    const rejectionPenalty = rejectedSteps.length * 0.1;

    return Math.max(avgConfidence - rejectionPenalty, 0);
  }

  private extractToolsFromContent(content: string): string[] {
    const toolPattern = /\b(read_file|write_file|edit|ls|grep|shell|web_fetch|web_search|glob|mcp_\w+)\b/g;
    const matches = content.match(toolPattern);
    return matches || [];
  }

  private hasCircularReasoning(step: ReasoningStep, chain: ReasoningChain): boolean {
    const currentContent = step.content.toLowerCase();
    
    // Check if this step's content is too similar to previous steps
    for (let i = 0; i < chain.steps.length - 1; i++) {
      const prevStep = chain.steps[i];
      const prevContent = prevStep.content.toLowerCase();
      
      if (this.calculateSimilarity(currentContent, prevContent) > 0.8) {
        return true;
      }
    }
    
    return false;
  }

  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = text1.split(/\s+/);
    const words2 = text2.split(/\s+/);
    
    const intersection = words1.filter(word => words2.includes(word));
    const union = [...new Set([...words1, ...words2])];
    
    return intersection.length / union.length;
  }

  private calculateValidationConfidence(issues: ReasoningIssue[]): number {
    let confidence = 1.0;
    
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          confidence -= 0.4;
          break;
        case 'high':
          confidence -= 0.2;
          break;
        case 'medium':
          confidence -= 0.1;
          break;
        case 'low':
          confidence -= 0.05;
          break;
      }
    }
    
    return Math.max(confidence, 0);
  }

  private async calculateFeasibilityScore(
    option: DecisionOption,
    chain: ReasoningChain
  ): Promise<number> {
    let score = 0.5; // Base score

    // Tool availability check
    const availableTools = this.toolRegistry.getAllTools().map(t => t.name);
    const toolsAvailable = option.requiredTools.every(tool => availableTools.includes(tool));
    
    if (toolsAvailable) {
      score += 0.3;
    } else {
      score -= 0.2;
    }

    // Risk assessment
    switch (option.riskLevel) {
      case 'low':
        score += 0.2;
        break;
      case 'medium':
        score += 0.0;
        break;
      case 'high':
        score -= 0.1;
        break;
    }

    // Pros vs cons
    const prosCount = option.pros.length;
    const consCount = option.cons.length;
    
    if (prosCount > consCount) {
      score += 0.1;
    } else if (consCount > prosCount) {
      score -= 0.1;
    }

    return Math.min(Math.max(score, 0), 1.0);
  }

  private isLogicallyConsistent(prevStep: ReasoningStep, currentStep: ReasoningStep): boolean {
    // Simple consistency check - more sophisticated logic can be added
    if (prevStep.type === 'hypothesis' && currentStep.type === 'verification') {
      return true;
    }
    
    if (prevStep.type === 'observation' && currentStep.type === 'hypothesis') {
      return true;
    }
    
    if (prevStep.type === 'verification' && currentStep.type === 'conclusion') {
      return true;
    }
    
    return false;
  }

  /**
   * Public API methods
   */
  getReasoningChain(chainId: string): ReasoningChain | undefined {
    return this.activeChains.get(chainId);
  }

  getAllActiveChains(): ReasoningChain[] {
    return Array.from(this.activeChains.values()).filter(c => c.status === 'active');
  }

  deleteChain(chainId: string): boolean {
    return this.activeChains.delete(chainId);
  }

  pauseChain(chainId: string): boolean {
    const chain = this.activeChains.get(chainId);
    if (chain) {
      chain.status = 'paused';
      return true;
    }
    return false;
  }

  resumeChain(chainId: string): boolean {
    const chain = this.activeChains.get(chainId);
    if (chain && chain.status === 'paused') {
      chain.status = 'active';
      return true;
    }
    return false;
  }
}

/**
 * Validation rule interface
 */
interface ValidationRule {
  validate(
    step: ReasoningStep,
    chain: ReasoningChain,
    toolRegistry: ToolRegistry
  ): Promise<ReasoningValidation>;
}

/**
 * Evidence validation rule
 */
class EvidenceValidationRule implements ValidationRule {
  async validate(
    step: ReasoningStep,
    chain: ReasoningChain,
    toolRegistry: ToolRegistry
  ): Promise<ReasoningValidation> {
    const issues: ReasoningIssue[] = [];
    const suggestions: string[] = [];

    if (step.type === 'conclusion' && step.evidence.length === 0) {
      issues.push({
        type: 'missing_evidence',
        severity: 'high',
        stepId: step.id,
        description: 'Conclusion lacks supporting evidence',
        suggestedFix: 'Add evidence from previous steps'
      });
    }

    return {
      isValid: issues.length === 0,
      confidence: 1.0,
      issues,
      suggestions
    };
  }
}

/**
 * Assumption validation rule
 */
class AssumptionValidationRule implements ValidationRule {
  async validate(
    step: ReasoningStep,
    chain: ReasoningChain,
    toolRegistry: ToolRegistry
  ): Promise<ReasoningValidation> {
    const issues: ReasoningIssue[] = [];
    const suggestions: string[] = [];

    if (step.assumptions.length > 3) {
      issues.push({
        type: 'weak_assumption',
        severity: 'medium',
        stepId: step.id,
        description: 'Too many assumptions',
        suggestedFix: 'Reduce assumptions or provide more evidence'
      });
    }

    return {
      isValid: issues.length === 0,
      confidence: 1.0,
      issues,
      suggestions
    };
  }
}

/**
 * Logical consistency rule
 */
class LogicalConsistencyRule implements ValidationRule {
  async validate(
    step: ReasoningStep,
    chain: ReasoningChain,
    toolRegistry: ToolRegistry
  ): Promise<ReasoningValidation> {
    const issues: ReasoningIssue[] = [];
    const suggestions: string[] = [];

    // Check for logical flow
    if (chain.steps.length > 1) {
      const prevStep = chain.steps[chain.steps.length - 2];
      
      if (prevStep.type === 'conclusion' && step.type === 'hypothesis') {
        issues.push({
          type: 'logical_inconsistency',
          severity: 'medium',
          stepId: step.id,
          description: 'New hypothesis after conclusion',
          suggestedFix: 'Consider if new hypothesis is necessary'
        });
      }
    }

    return {
      isValid: issues.length === 0,
      confidence: 1.0,
      issues,
      suggestions
    };
  }
}

/**
 * Constraint validation rule
 */
class ConstraintValidationRule implements ValidationRule {
  async validate(
    step: ReasoningStep,
    chain: ReasoningChain,
    toolRegistry: ToolRegistry
  ): Promise<ReasoningValidation> {
    const issues: ReasoningIssue[] = [];
    const suggestions: string[] = [];

    // Check against context constraints
    for (const constraint of chain.context.constraints) {
      if (step.content.toLowerCase().includes(constraint.toLowerCase())) {
        issues.push({
          type: 'constraint_violation',
          severity: 'high',
          stepId: step.id,
          description: `Violates constraint: ${constraint}`,
          suggestedFix: 'Modify approach to respect constraints'
        });
      }
    }

    return {
      isValid: issues.length === 0,
      confidence: 1.0,
      issues,
      suggestions
    };
  }
}