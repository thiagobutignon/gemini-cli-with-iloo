/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolRegistry } from '../tools/tool-registry.js';
import { Config } from '../config/config.js';
import { HierarchicalPlanner, HierarchicalPlan, PlanExecutionContext } from '../planning/hierarchical-planner.js';
import { ReasoningEngine, ReasoningChain, ReasoningContext } from '../reasoning/reasoning-engine.js';
import { ImprovedPromptSystem, PromptContext } from '../prompts/improved-prompt-system.js';
import { ResponseValidator, AIResponse, ValidationConstraints, ValidationResult } from '../validation/response-validator.js';
import { ToolAvailabilityVerifier, SystemVerificationReport } from '../tools/tool-availability-verifier.js';

/**
 * Enhanced Agent Session
 */
export interface EnhancedAgentSession {
  id: string;
  userGoal: string;
  context: PromptContext;
  plan?: HierarchicalPlan;
  reasoningChain?: ReasoningChain;
  toolVerificationReport?: SystemVerificationReport;
  responses: SessionResponse[];
  status: 'initializing' | 'planning' | 'executing' | 'validating' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  metrics: SessionMetrics;
}

/**
 * Session response with validation
 */
export interface SessionResponse {
  id: string;
  aiResponse: AIResponse;
  validationResult: ValidationResult;
  planStepId?: string;
  reasoningStepId?: string;
  timestamp: Date;
  executionTime: number;
  successful: boolean;
}

/**
 * Session metrics
 */
export interface SessionMetrics {
  totalResponses: number;
  successfulResponses: number;
  failedResponses: number;
  averageConfidence: number;
  averageResponseTime: number;
  toolsUsed: string[];
  hallucinationCount: number;
  validationIssueCount: number;
  planStepsCompleted: number;
  reasoningStepsCompleted: number;
}

/**
 * Enhanced execution options
 */
export interface EnhancedExecutionOptions {
  enablePlanning: boolean;
  enableReasoning: boolean;
  enableValidation: boolean;
  enableToolVerification: boolean;
  minimumConfidence: number;
  maxRetries: number;
  timeoutMs: number;
  safetyChecks: boolean;
  factChecking: boolean;
  allowUnsafeOperations: boolean;
  validationConstraints: Partial<ValidationConstraints>;
}

/**
 * Enhanced Agent System that integrates all improvements
 */
export class EnhancedAgentSystem {
  private toolRegistry: ToolRegistry;
  private config: Config;
  private hierarchicalPlanner: HierarchicalPlanner;
  private reasoningEngine: ReasoningEngine;
  private promptSystem: ImprovedPromptSystem;
  private responseValidator: ResponseValidator;
  private toolVerifier: ToolAvailabilityVerifier;
  
  private activeSessions: Map<string, EnhancedAgentSession> = new Map();
  private sessionHistory: EnhancedAgentSession[] = [];

  constructor(
    toolRegistry: ToolRegistry,
    config: Config
  ) {
    this.toolRegistry = toolRegistry;
    this.config = config;
    
    // Initialize all subsystems
    this.hierarchicalPlanner = new HierarchicalPlanner(toolRegistry, config);
    this.reasoningEngine = new ReasoningEngine(toolRegistry, config);
    this.promptSystem = new ImprovedPromptSystem(toolRegistry, config, this.reasoningEngine, this.hierarchicalPlanner);
    this.responseValidator = new ResponseValidator(toolRegistry, config);
    this.toolVerifier = new ToolAvailabilityVerifier(toolRegistry, config);
  }

  /**
   * Starts a new enhanced agent session
   */
  async startSession(
    userGoal: string,
    options: Partial<EnhancedExecutionOptions> = {}
  ): Promise<EnhancedAgentSession> {
    const sessionId = this.generateSessionId();
    
    // Default options
    const fullOptions: EnhancedExecutionOptions = {
      enablePlanning: true,
      enableReasoning: true,
      enableValidation: true,
      enableToolVerification: true,
      minimumConfidence: 0.7,
      maxRetries: 3,
      timeoutMs: 300000, // 5 minutes
      safetyChecks: true,
      factChecking: true,
      allowUnsafeOperations: false,
      validationConstraints: {},
      ...options
    };

    // Verify tool availability first
    let toolVerificationReport: SystemVerificationReport | undefined;
    if (fullOptions.enableToolVerification) {
      toolVerificationReport = await this.toolVerifier.verifyAllTools({
        testExecution: false,
        timeoutMs: 30000
      });
      
      if (toolVerificationReport.systemHealth === 'critical') {
        throw new Error(`System health is critical: ${toolVerificationReport.summary}`);
      }
    }

    // Create prompt context
    const context: PromptContext = {
      conversationType: this.determineConversationType(userGoal),
      userGoal,
      workingDirectory: process.cwd(),
      availableTools: toolVerificationReport 
        ? toolVerificationReport.verificationResults
            .filter(r => r.available)
            .map(r => r.tool)
        : this.toolRegistry.getAllTools().map(t => t.name),
      constraints: [],
      previousInteractions: [],
      confidenceThreshold: fullOptions.minimumConfidence,
      requiresPlanning: fullOptions.enablePlanning && this.requiresPlanning(userGoal),
      requiresReasoning: fullOptions.enableReasoning && this.requiresReasoning(userGoal)
    };

    // Create session
    const session: EnhancedAgentSession = {
      id: sessionId,
      userGoal,
      context,
      toolVerificationReport,
      responses: [],
      status: 'initializing',
      createdAt: new Date(),
      updatedAt: new Date(),
      metrics: this.initializeMetrics()
    };

    // Store session
    this.activeSessions.set(sessionId, session);

    // Start planning if enabled
    if (fullOptions.enablePlanning && context.requiresPlanning) {
      session.status = 'planning';
      session.plan = await this.hierarchicalPlanner.createPlan(
        userGoal,
        context.workingDirectory,
        context.constraints
      );
    }

    // Start reasoning if enabled
    if (fullOptions.enableReasoning && context.requiresReasoning) {
      const reasoningContext = this.promptSystem.createReasoningContext(context);
      session.reasoningChain = await this.reasoningEngine.startReasoning(
        userGoal,
        reasoningContext
      );
    }

    session.status = 'executing';
    session.updatedAt = new Date();

    return session;
  }

  /**
   * Processes a user message in an enhanced session
   */
  async processMessage(
    sessionId: string,
    userMessage: string,
    options: Partial<EnhancedExecutionOptions> = {}
  ): Promise<SessionResponse> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const fullOptions: EnhancedExecutionOptions = {
      enablePlanning: true,
      enableReasoning: true,
      enableValidation: true,
      enableToolVerification: true,
      minimumConfidence: 0.7,
      maxRetries: 3,
      timeoutMs: 300000,
      safetyChecks: true,
      factChecking: true,
      allowUnsafeOperations: false,
      validationConstraints: {
        minimumConfidence: 0.7,
        allowedTools: session.context.availableTools,
        forbiddenOperations: [],
        requireReasoning: session.context.requiresReasoning,
        requireEvidence: true,
        safetyChecks: true,
        factChecking: true,
        maxToolCalls: 10,
        timeoutMs: 300000
      },
      ...options
    };

    const startTime = Date.now();
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt < fullOptions.maxRetries) {
      attempt++;

      try {
        // Generate system prompt
        const systemPrompt = this.promptSystem.generateSystemPrompt(session.context);
        
        // Generate user prompt
        const userPrompt = this.promptSystem.generateUserPrompt(userMessage, session.context);

        // For this demo, simulate AI response generation
        const aiResponse = await this.simulateAIResponse(userMessage, session, systemPrompt, userPrompt);

        // Validate response if enabled
        let validationResult: ValidationResult = {
          isValid: true,
          score: 1.0,
          issues: [],
          suggestions: [],
          allowExecution: true
        };

        if (fullOptions.enableValidation) {
          validationResult = await this.responseValidator.validateResponse(
            aiResponse,
            session.context,
            fullOptions.validationConstraints as ValidationConstraints
          );

          // If validation failed critically, retry
          if (!validationResult.allowExecution && attempt < fullOptions.maxRetries) {
            console.warn(`Validation failed on attempt ${attempt}, retrying...`);
            continue;
          }
        }

        // Update reasoning chain if enabled
        if (session.reasoningChain && fullOptions.enableReasoning) {
          await this.reasoningEngine.addReasoningStep(
            session.reasoningChain.id,
            'action',
            `Generated response: ${aiResponse.content.substring(0, 100)}...`,
            [`Validation score: ${validationResult.score.toFixed(2)}`],
            [`Response is ${validationResult.isValid ? 'valid' : 'invalid'}`]
          );
        }

        // Create session response
        const sessionResponse: SessionResponse = {
          id: this.generateResponseId(),
          aiResponse,
          validationResult,
          planStepId: session.plan?.steps[0]?.id, // Simplified - would track current step
          reasoningStepId: session.reasoningChain?.steps[session.reasoningChain.steps.length - 1]?.id,
          timestamp: new Date(),
          executionTime: Date.now() - startTime,
          successful: validationResult.allowExecution
        };

        // Update session
        session.responses.push(sessionResponse);
        session.updatedAt = new Date();
        this.updateSessionMetrics(session, sessionResponse);

        return sessionResponse;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`Attempt ${attempt} failed:`, lastError.message);
        
        if (attempt >= fullOptions.maxRetries) {
          break;
        }
      }
    }

    // All attempts failed
    const failedResponse: SessionResponse = {
      id: this.generateResponseId(),
      aiResponse: {
        content: `Failed to generate valid response after ${fullOptions.maxRetries} attempts: ${lastError?.message}`,
        toolCalls: [],
        timestamp: new Date()
      },
      validationResult: {
        isValid: false,
        score: 0,
        issues: [{
          type: 'factual_error',
          severity: 'critical',
          message: lastError?.message || 'Unknown error',
          location: 'system'
        }],
        suggestions: ['Check system configuration', 'Review input parameters'],
        allowExecution: false
      },
      timestamp: new Date(),
      executionTime: Date.now() - startTime,
      successful: false
    };

    session.responses.push(failedResponse);
    session.status = 'failed';
    session.updatedAt = new Date();
    this.updateSessionMetrics(session, failedResponse);

    return failedResponse;
  }

  /**
   * Simulates AI response generation for testing
   */
  private async simulateAIResponse(
    userMessage: string,
    session: EnhancedAgentSession,
    systemPrompt: string,
    userPrompt: string
  ): Promise<AIResponse> {
    // This is a simulation - in real implementation, this would call the actual AI model
    
    const toolCalls = this.generateSimulatedToolCalls(userMessage, session.context.availableTools);
    const reasoning = session.context.requiresReasoning ? this.generateSimulatedReasoning(userMessage) : undefined;
    
    return {
      content: this.generateSimulatedContent(userMessage, toolCalls),
      toolCalls,
      reasoning,
      confidence: Math.random() * 0.4 + 0.6, // Random confidence between 0.6-1.0
      timestamp: new Date(),
      metadata: {
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        simulation: true
      }
    };
  }

  /**
   * Generates simulated tool calls
   */
  private generateSimulatedToolCalls(userMessage: string, availableTools: string[]): any[] {
    const toolCalls = [];
    
    // Simulate common tool usage patterns
    if (userMessage.toLowerCase().includes('file') || userMessage.toLowerCase().includes('read')) {
      if (availableTools.includes('ls')) {
        toolCalls.push({
          name: 'ls',
          parameters: { path: '.' },
          reasoning: 'List directory contents to understand structure'
        });
      }
      
      if (availableTools.includes('read_file')) {
        toolCalls.push({
          name: 'read_file',
          parameters: { file_path: 'package.json' },
          reasoning: 'Read package.json to understand project structure'
        });
      }
    }
    
    if (userMessage.toLowerCase().includes('search') || userMessage.toLowerCase().includes('find')) {
      if (availableTools.includes('grep')) {
        toolCalls.push({
          name: 'grep',
          parameters: { pattern: 'test', path: '.' },
          reasoning: 'Search for relevant patterns in files'
        });
      }
    }
    
    return toolCalls;
  }

  /**
   * Generates simulated reasoning steps
   */
  private generateSimulatedReasoning(userMessage: string): any[] {
    return [
      {
        type: 'observation',
        content: `User requested: ${userMessage}`,
        evidence: [`User input: ${userMessage}`],
        confidence: 0.9
      },
      {
        type: 'analysis',
        content: 'Analyzing the request to determine appropriate tools and approach',
        evidence: ['Request analyzed for tool requirements'],
        confidence: 0.8
      },
      {
        type: 'decision',
        content: 'Decided to use file system tools to gather information',
        evidence: ['File operations detected in request'],
        confidence: 0.85
      }
    ];
  }

  /**
   * Generates simulated content
   */
  private generateSimulatedContent(userMessage: string, toolCalls: any[]): string {
    let content = `I'll help you with: ${userMessage}\n\n`;
    
    if (toolCalls.length > 0) {
      content += `I'll use the following tools to assist you:\n`;
      toolCalls.forEach((call, index) => {
        content += `${index + 1}. ${call.name}: ${call.reasoning}\n`;
      });
      content += '\n';
    }
    
    content += 'Let me gather the necessary information and provide you with a comprehensive response.';
    
    return content;
  }

  /**
   * Determines conversation type from user goal
   */
  private determineConversationType(userGoal: string): PromptContext['conversationType'] {
    const goal = userGoal.toLowerCase();
    
    if (goal.includes('code') || goal.includes('function') || goal.includes('debug')) {
      return 'code_assistance';
    }
    
    if (goal.includes('analyze') || goal.includes('review') || goal.includes('examine')) {
      return 'analysis';
    }
    
    if (goal.includes('plan') || goal.includes('strategy') || goal.includes('organize')) {
      return 'planning';
    }
    
    if (goal.includes('mcp') || goal.includes('tool')) {
      return 'mcp_tool_usage';
    }
    
    if (goal.includes('error') || goal.includes('fix') || goal.includes('issue')) {
      return 'debugging';
    }
    
    return 'general';
  }

  /**
   * Determines if planning is required
   */
  private requiresPlanning(userGoal: string): boolean {
    const planningKeywords = ['plan', 'strategy', 'organize', 'implement', 'build', 'create', 'develop'];
    return planningKeywords.some(keyword => userGoal.toLowerCase().includes(keyword));
  }

  /**
   * Determines if reasoning is required
   */
  private requiresReasoning(userGoal: string): boolean {
    const reasoningKeywords = ['analyze', 'explain', 'why', 'how', 'compare', 'decide', 'recommend'];
    return reasoningKeywords.some(keyword => userGoal.toLowerCase().includes(keyword));
  }

  /**
   * Initializes session metrics
   */
  private initializeMetrics(): SessionMetrics {
    return {
      totalResponses: 0,
      successfulResponses: 0,
      failedResponses: 0,
      averageConfidence: 0,
      averageResponseTime: 0,
      toolsUsed: [],
      hallucinationCount: 0,
      validationIssueCount: 0,
      planStepsCompleted: 0,
      reasoningStepsCompleted: 0
    };
  }

  /**
   * Updates session metrics
   */
  private updateSessionMetrics(session: EnhancedAgentSession, response: SessionResponse): void {
    const metrics = session.metrics;
    
    metrics.totalResponses++;
    
    if (response.successful) {
      metrics.successfulResponses++;
    } else {
      metrics.failedResponses++;
    }
    
    // Update confidence average
    if (response.aiResponse.confidence) {
      const totalConfidence = metrics.averageConfidence * (metrics.totalResponses - 1) + response.aiResponse.confidence;
      metrics.averageConfidence = totalConfidence / metrics.totalResponses;
    }
    
    // Update response time average
    const totalTime = metrics.averageResponseTime * (metrics.totalResponses - 1) + response.executionTime;
    metrics.averageResponseTime = totalTime / metrics.totalResponses;
    
    // Update tools used
    for (const toolCall of response.aiResponse.toolCalls) {
      if (!metrics.toolsUsed.includes(toolCall.name)) {
        metrics.toolsUsed.push(toolCall.name);
      }
    }
    
    // Count hallucinations
    const hallucinationIssues = response.validationResult.issues.filter(
      issue => issue.type === 'hallucination_detected'
    );
    metrics.hallucinationCount += hallucinationIssues.length;
    
    // Count validation issues
    metrics.validationIssueCount += response.validationResult.issues.length;
  }

  /**
   * Generates session ID
   */
  private generateSessionId(): string {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Generates response ID
   */
  private generateResponseId(): string {
    return 'response_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Public API methods
   */
  
  /**
   * Gets session by ID
   */
  getSession(sessionId: string): EnhancedAgentSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Lists all active sessions
   */
  getActiveSessions(): EnhancedAgentSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Completes a session
   */
  async completeSession(sessionId: string): Promise<EnhancedAgentSession> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.status = 'completed';
    session.updatedAt = new Date();

    // Move to history
    this.sessionHistory.push(session);
    this.activeSessions.delete(sessionId);

    return session;
  }

  /**
   * Gets session history
   */
  getSessionHistory(): EnhancedAgentSession[] {
    return [...this.sessionHistory];
  }

  /**
   * Gets system health
   */
  async getSystemHealth(): Promise<{
    overall: 'healthy' | 'degraded' | 'critical';
    toolHealth: 'healthy' | 'degraded' | 'critical';
    activeSessions: number;
    averageConfidence: number;
    hallucinationRate: number;
  }> {
    const toolHealth = await this.toolVerifier.getSystemHealth();
    const activeSessions = this.activeSessions.size;
    
    // Calculate average confidence across all sessions
    const allSessions = [...this.activeSessions.values(), ...this.sessionHistory];
    const totalConfidence = allSessions.reduce((sum, session) => sum + session.metrics.averageConfidence, 0);
    const averageConfidence = allSessions.length > 0 ? totalConfidence / allSessions.length : 0;
    
    // Calculate hallucination rate
    const totalResponses = allSessions.reduce((sum, session) => sum + session.metrics.totalResponses, 0);
    const totalHallucinations = allSessions.reduce((sum, session) => sum + session.metrics.hallucinationCount, 0);
    const hallucinationRate = totalResponses > 0 ? totalHallucinations / totalResponses : 0;
    
    // Determine overall health
    let overall: 'healthy' | 'degraded' | 'critical' = 'healthy';
    
    if (toolHealth === 'critical' || hallucinationRate > 0.1 || averageConfidence < 0.5) {
      overall = 'critical';
    } else if (toolHealth === 'degraded' || hallucinationRate > 0.05 || averageConfidence < 0.7) {
      overall = 'degraded';
    }
    
    return {
      overall,
      toolHealth,
      activeSessions,
      averageConfidence,
      hallucinationRate
    };
  }

  /**
   * Runs system diagnostics
   */
  async runDiagnostics(): Promise<{
    toolVerification: SystemVerificationReport;
    systemHealth: any;
    recommendations: string[];
  }> {
    const toolVerification = await this.toolVerifier.verifyAllTools({
      testExecution: true,
      timeoutMs: 60000
    });
    
    const systemHealth = await this.getSystemHealth();
    
    const recommendations: string[] = [];
    
    if (toolVerification.systemHealth !== 'healthy') {
      recommendations.push('Address tool availability issues');
      recommendations.push(...toolVerification.recommendations);
    }
    
    if (systemHealth.hallucinationRate > 0.05) {
      recommendations.push('Investigate and reduce hallucination rate');
      recommendations.push('Review validation constraints');
    }
    
    if (systemHealth.averageConfidence < 0.7) {
      recommendations.push('Improve confidence levels through better reasoning');
      recommendations.push('Enhance evidence collection in responses');
    }
    
    return {
      toolVerification,
      systemHealth,
      recommendations
    };
  }
}