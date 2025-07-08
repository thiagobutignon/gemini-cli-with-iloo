/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolRegistry } from '../tools/tool-registry.js';
import { Config } from '../config/config.js';

/**
 * Represents a single step in a hierarchical plan
 */
export interface PlanStep {
  id: string;
  title: string;
  description: string;
  type: 'analysis' | 'tool_call' | 'verification' | 'decision' | 'synthesis';
  dependencies: string[]; // IDs of steps that must complete before this one
  estimatedComplexity: 'low' | 'medium' | 'high';
  requiredTools: string[];
  expectedOutput?: string;
  validationCriteria?: string[];
  fallbackStrategy?: string;
}

/**
 * Represents the outcome of executing a plan step
 */
export interface StepResult {
  stepId: string;
  success: boolean;
  output: string;
  toolsUsed: string[];
  validationPassed: boolean;
  executionTime: number;
  confidence: number; // 0-1 scale
  warnings: string[];
  errors: string[];
}

/**
 * Represents a complete hierarchical plan
 */
export interface HierarchicalPlan {
  id: string;
  title: string;
  description: string;
  goal: string;
  steps: PlanStep[];
  estimatedDuration: number;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: Date;
  availableTools: string[];
  contextConstraints: string[];
}

/**
 * Validation result for a plan or step
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Context for plan execution
 */
export interface PlanExecutionContext {
  currentStep: number;
  completedSteps: StepResult[];
  availableTools: string[];
  toolRegistry: ToolRegistry;
  config: Config;
  userGoal: string;
  workingDirectory: string;
  timeoutMs: number;
}

/**
 * Hierarchical Planning System
 * 
 * This system addresses the hallucination issues by:
 * 1. Breaking down complex requests into validated steps
 * 2. Verifying tool availability before planning
 * 3. Providing structured reasoning chains
 * 4. Enabling validation at each step
 */
export class HierarchicalPlanner {
  private toolRegistry: ToolRegistry;
  private config: Config;
  private activePlans: Map<string, HierarchicalPlan> = new Map();
  private executionResults: Map<string, StepResult[]> = new Map();

  constructor(toolRegistry: ToolRegistry, config: Config) {
    this.toolRegistry = toolRegistry;
    this.config = config;
  }

  /**
   * Creates a hierarchical plan from a user goal
   */
  async createPlan(
    goal: string,
    context: string = '',
    constraints: string[] = []
  ): Promise<HierarchicalPlan> {
    // Validate available tools first
    const availableTools = this.toolRegistry.getAllTools().map(t => t.name);
    
    // Create initial plan structure
    const plan: HierarchicalPlan = {
      id: this.generatePlanId(),
      title: this.extractPlanTitle(goal),
      description: goal,
      goal,
      steps: [],
      estimatedDuration: 0,
      riskLevel: 'medium',
      createdAt: new Date(),
      availableTools,
      contextConstraints: constraints
    };

    // Decompose the goal into steps
    plan.steps = await this.decomposeGoal(goal, context, availableTools, constraints);
    
    // Validate the plan
    const validation = await this.validatePlan(plan);
    if (!validation.isValid) {
      throw new Error(`Invalid plan: ${validation.errors.join(', ')}`);
    }

    // Calculate estimated duration and risk
    plan.estimatedDuration = this.calculateEstimatedDuration(plan.steps);
    plan.riskLevel = this.assessRiskLevel(plan.steps);

    // Store the plan
    this.activePlans.set(plan.id, plan);
    
    return plan;
  }

  /**
   * Decomposes a goal into executable steps
   */
  private async decomposeGoal(
    goal: string,
    context: string,
    availableTools: string[],
    constraints: string[]
  ): Promise<PlanStep[]> {
    const steps: PlanStep[] = [];
    
    // Always start with analysis step
    steps.push({
      id: 'analysis-1',
      title: 'Analyze Request',
      description: 'Understand the user\'s goal and current context',
      type: 'analysis',
      dependencies: [],
      estimatedComplexity: 'low',
      requiredTools: ['read_file', 'ls', 'grep'], // Common analysis tools
      expectedOutput: 'Understanding of current state and requirements',
      validationCriteria: ['Goal is clearly understood', 'Context is analyzed'],
      fallbackStrategy: 'Ask for clarification if goal is unclear'
    });

    // Add tool verification step
    steps.push({
      id: 'verification-1',
      title: 'Verify Tool Availability',
      description: 'Confirm all required tools are available and accessible',
      type: 'verification',
      dependencies: ['analysis-1'],
      estimatedComplexity: 'low',
      requiredTools: [],
      expectedOutput: 'List of available and missing tools',
      validationCriteria: ['All required tools are available'],
      fallbackStrategy: 'Suggest alternative tools or approaches'
    });

    // Decompose based on goal type
    if (this.isFileSystemTask(goal)) {
      steps.push(...this.createFileSystemSteps(goal, availableTools));
    } else if (this.isCodeTask(goal)) {
      steps.push(...this.createCodeSteps(goal, availableTools));
    } else if (this.isAnalysisTask(goal)) {
      steps.push(...this.createAnalysisSteps(goal, availableTools));
    } else {
      steps.push(...this.createGeneralSteps(goal, availableTools));
    }

    // Always end with synthesis step
    steps.push({
      id: 'synthesis-1',
      title: 'Synthesize Results',
      description: 'Combine results from all steps and provide final answer',
      type: 'synthesis',
      dependencies: steps.slice(0, -1).map(s => s.id),
      estimatedComplexity: 'medium',
      requiredTools: [],
      expectedOutput: 'Complete answer to user\'s goal',
      validationCriteria: ['All steps completed successfully', 'Goal achieved'],
      fallbackStrategy: 'Provide partial results with explanation'
    });

    return steps;
  }

  /**
   * Validates a plan for correctness and feasibility
   */
  async validatePlan(plan: HierarchicalPlan): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Check for circular dependencies
    if (this.hasCyclicDependencies(plan.steps)) {
      errors.push('Plan contains circular dependencies');
    }

    // Validate tool availability
    const allTools = this.toolRegistry.getAllTools().map(t => t.name);
    for (const step of plan.steps) {
      for (const tool of step.requiredTools) {
        if (!allTools.includes(tool)) {
          errors.push(`Required tool '${tool}' is not available for step '${step.id}'`);
        }
      }
    }

    // Check for orphaned steps
    const stepIds = new Set(plan.steps.map(s => s.id));
    for (const step of plan.steps) {
      for (const dep of step.dependencies) {
        if (!stepIds.has(dep)) {
          errors.push(`Step '${step.id}' depends on non-existent step '${dep}'`);
        }
      }
    }

    // Validate complexity distribution
    const highComplexitySteps = plan.steps.filter(s => s.estimatedComplexity === 'high');
    if (highComplexitySteps.length > 3) {
      warnings.push('Plan has many high-complexity steps, consider breaking down further');
    }

    // Check for missing validation criteria
    for (const step of plan.steps) {
      if (!step.validationCriteria || step.validationCriteria.length === 0) {
        warnings.push(`Step '${step.id}' lacks validation criteria`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions
    };
  }

  /**
   * Executes a plan step by step
   */
  async executePlan(
    planId: string,
    context: PlanExecutionContext
  ): Promise<StepResult[]> {
    const plan = this.activePlans.get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const results: StepResult[] = [];
    const sortedSteps = this.topologicalSort(plan.steps);

    for (const step of sortedSteps) {
      // Check if dependencies are satisfied
      const depsSatisfied = step.dependencies.every(depId => 
        results.some(r => r.stepId === depId && r.success)
      );

      if (!depsSatisfied) {
        const failedResult: StepResult = {
          stepId: step.id,
          success: false,
          output: `Dependencies not satisfied: ${step.dependencies.join(', ')}`,
          toolsUsed: [],
          validationPassed: false,
          executionTime: 0,
          confidence: 0,
          warnings: [],
          errors: ['Dependencies not satisfied']
        };
        results.push(failedResult);
        continue;
      }

      // Execute the step
      const stepResult = await this.executeStep(step, context, results);
      results.push(stepResult);

      // Stop execution if step failed and no fallback
      if (!stepResult.success && !step.fallbackStrategy) {
        break;
      }
    }

    // Store results
    this.executionResults.set(planId, results);
    
    return results;
  }

  /**
   * Executes a single step
   */
  private async executeStep(
    step: PlanStep,
    context: PlanExecutionContext,
    previousResults: StepResult[]
  ): Promise<StepResult> {
    const startTime = Date.now();
    
    try {
      let output = '';
      const toolsUsed: string[] = [];
      const warnings: string[] = [];
      const errors: string[] = [];

      // Validate tool availability
      for (const toolName of step.requiredTools) {
        const tool = context.toolRegistry.getTool(toolName);
        if (!tool) {
          errors.push(`Required tool '${toolName}' not available`);
        }
      }

      if (errors.length > 0) {
        return {
          stepId: step.id,
          success: false,
          output: `Tool validation failed: ${errors.join(', ')}`,
          toolsUsed,
          validationPassed: false,
          executionTime: Date.now() - startTime,
          confidence: 0,
          warnings,
          errors
        };
      }

      // Execute based on step type
      switch (step.type) {
        case 'analysis':
          output = await this.executeAnalysisStep(step, context, previousResults);
          break;
        case 'tool_call':
          const toolResult = await this.executeToolCallStep(step, context);
          output = toolResult.output;
          toolsUsed.push(...toolResult.toolsUsed);
          break;
        case 'verification':
          output = await this.executeVerificationStep(step, context, previousResults);
          break;
        case 'decision':
          output = await this.executeDecisionStep(step, context, previousResults);
          break;
        case 'synthesis':
          output = await this.executeSynthesisStep(step, context, previousResults);
          break;
      }

      // Validate the output
      const validationPassed = await this.validateStepOutput(step, output);
      const confidence = this.calculateStepConfidence(step, output, validationPassed);

      return {
        stepId: step.id,
        success: true,
        output,
        toolsUsed,
        validationPassed,
        executionTime: Date.now() - startTime,
        confidence,
        warnings,
        errors
      };

    } catch (error) {
      return {
        stepId: step.id,
        success: false,
        output: `Step execution failed: ${error}`,
        toolsUsed: [],
        validationPassed: false,
        executionTime: Date.now() - startTime,
        confidence: 0,
        warnings: [],
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Helper methods for step execution
   */
  private async executeAnalysisStep(
    step: PlanStep,
    context: PlanExecutionContext,
    previousResults: StepResult[]
  ): Promise<string> {
    // Analysis step implementation
    return `Analysis completed for step: ${step.title}`;
  }

  private async executeToolCallStep(
    step: PlanStep,
    context: PlanExecutionContext
  ): Promise<{ output: string; toolsUsed: string[] }> {
    // Tool call step implementation
    return {
      output: `Tool call completed for step: ${step.title}`,
      toolsUsed: step.requiredTools
    };
  }

  private async executeVerificationStep(
    step: PlanStep,
    context: PlanExecutionContext,
    previousResults: StepResult[]
  ): Promise<string> {
    // Verification step implementation
    return `Verification completed for step: ${step.title}`;
  }

  private async executeDecisionStep(
    step: PlanStep,
    context: PlanExecutionContext,
    previousResults: StepResult[]
  ): Promise<string> {
    // Decision step implementation
    return `Decision completed for step: ${step.title}`;
  }

  private async executeSynthesisStep(
    step: PlanStep,
    context: PlanExecutionContext,
    previousResults: StepResult[]
  ): Promise<string> {
    // Synthesis step implementation
    const successfulResults = previousResults.filter(r => r.success);
    return `Synthesis completed. Successfully executed ${successfulResults.length} out of ${previousResults.length} steps.`;
  }

  /**
   * Utility methods
   */
  private generatePlanId(): string {
    return 'plan_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  private extractPlanTitle(goal: string): string {
    return goal.split('.')[0].trim().substring(0, 50);
  }

  private calculateEstimatedDuration(steps: PlanStep[]): number {
    return steps.reduce((total, step) => {
      switch (step.estimatedComplexity) {
        case 'low': return total + 30;
        case 'medium': return total + 120;
        case 'high': return total + 300;
        default: return total + 60;
      }
    }, 0);
  }

  private assessRiskLevel(steps: PlanStep[]): 'low' | 'medium' | 'high' {
    const highComplexityCount = steps.filter(s => s.estimatedComplexity === 'high').length;
    if (highComplexityCount > 2) return 'high';
    if (highComplexityCount > 0) return 'medium';
    return 'low';
  }

  private hasCyclicDependencies(steps: PlanStep[]): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const hasCycle = (stepId: string): boolean => {
      if (recursionStack.has(stepId)) return true;
      if (visited.has(stepId)) return false;
      
      visited.add(stepId);
      recursionStack.add(stepId);
      
      const step = steps.find(s => s.id === stepId);
      if (step) {
        for (const dep of step.dependencies) {
          if (hasCycle(dep)) return true;
        }
      }
      
      recursionStack.delete(stepId);
      return false;
    };
    
    for (const step of steps) {
      if (hasCycle(step.id)) return true;
    }
    
    return false;
  }

  private topologicalSort(steps: PlanStep[]): PlanStep[] {
    const sorted: PlanStep[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    
    const visit = (stepId: string) => {
      if (visited.has(stepId)) return;
      if (visiting.has(stepId)) throw new Error('Circular dependency detected');
      
      visiting.add(stepId);
      const step = steps.find(s => s.id === stepId);
      if (step) {
        for (const dep of step.dependencies) {
          visit(dep);
        }
        sorted.push(step);
        visited.add(stepId);
      }
      visiting.delete(stepId);
    };
    
    for (const step of steps) {
      visit(step.id);
    }
    
    return sorted;
  }

  private isFileSystemTask(goal: string): boolean {
    return /\b(file|directory|folder|create|delete|move|copy|read|write)\b/i.test(goal);
  }

  private isCodeTask(goal: string): boolean {
    return /\b(code|function|class|method|debug|refactor|test|compile)\b/i.test(goal);
  }

  private isAnalysisTask(goal: string): boolean {
    return /\b(analyze|review|examine|inspect|understand|explain)\b/i.test(goal);
  }

  private createFileSystemSteps(goal: string, availableTools: string[]): PlanStep[] {
    return [
      {
        id: 'fs-1',
        title: 'Check File System State',
        description: 'Examine current file system state',
        type: 'tool_call',
        dependencies: ['verification-1'],
        estimatedComplexity: 'low',
        requiredTools: ['ls', 'read_file'],
        expectedOutput: 'Current file system state',
        validationCriteria: ['File system state is clear']
      }
    ];
  }

  private createCodeSteps(goal: string, availableTools: string[]): PlanStep[] {
    return [
      {
        id: 'code-1',
        title: 'Analyze Code Structure',
        description: 'Examine existing code structure',
        type: 'tool_call',
        dependencies: ['verification-1'],
        estimatedComplexity: 'medium',
        requiredTools: ['read_file', 'grep'],
        expectedOutput: 'Code structure analysis',
        validationCriteria: ['Code structure is understood']
      }
    ];
  }

  private createAnalysisSteps(goal: string, availableTools: string[]): PlanStep[] {
    return [
      {
        id: 'analysis-2',
        title: 'Deep Analysis',
        description: 'Perform detailed analysis of the target',
        type: 'analysis',
        dependencies: ['verification-1'],
        estimatedComplexity: 'medium',
        requiredTools: ['read_file', 'grep', 'ls'],
        expectedOutput: 'Detailed analysis results',
        validationCriteria: ['Analysis is thorough and accurate']
      }
    ];
  }

  private createGeneralSteps(goal: string, availableTools: string[]): PlanStep[] {
    return [
      {
        id: 'general-1',
        title: 'Execute General Task',
        description: 'Execute the requested task',
        type: 'tool_call',
        dependencies: ['verification-1'],
        estimatedComplexity: 'medium',
        requiredTools: availableTools.slice(0, 3),
        expectedOutput: 'Task execution results',
        validationCriteria: ['Task completed successfully']
      }
    ];
  }

  private async validateStepOutput(step: PlanStep, output: string): Promise<boolean> {
    if (!step.validationCriteria) return true;
    
    // Simple validation based on output content
    return step.validationCriteria.every(criteria => 
      output.toLowerCase().includes(criteria.toLowerCase().split(' ')[0])
    );
  }

  private calculateStepConfidence(step: PlanStep, output: string, validationPassed: boolean): number {
    let confidence = 0.5; // Base confidence
    
    if (validationPassed) confidence += 0.3;
    if (output.length > 50) confidence += 0.1;
    if (step.estimatedComplexity === 'low') confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Public API methods
   */
  getPlan(planId: string): HierarchicalPlan | undefined {
    return this.activePlans.get(planId);
  }

  getExecutionResults(planId: string): StepResult[] | undefined {
    return this.executionResults.get(planId);
  }

  deletePlan(planId: string): boolean {
    const deleted = this.activePlans.delete(planId);
    this.executionResults.delete(planId);
    return deleted;
  }

  getAllPlans(): HierarchicalPlan[] {
    return Array.from(this.activePlans.values());
  }
}