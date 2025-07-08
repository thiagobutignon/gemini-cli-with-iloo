/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GenerateContentResponse, GenerateContentConfig } from '@google/genai';
import { EnhancedSystemComponents } from './enhanced-system-factory.js';
import { PromptContext } from '../prompts/improved-prompt-system.js';
import { AIResponse, ValidationConstraints } from '../validation/response-validator.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { Config } from '../config/config.js';

/**
 * Integration hooks for enhanced system features
 * These functions can be called from existing Gemini CLI code
 */
export class IntegrationHooks {
  /**
   * Hook for enhancing system prompts
   * Call this from prompts.ts getCoreSystemPrompt()
   */
  static async enhanceSystemPrompt(
    basePrompt: string,
    userMemory: string | undefined,
    enhancedComponents: EnhancedSystemComponents,
    workingDirectory: string = process.cwd()
  ): Promise<string> {
    try {
      // If no enhanced components, return base prompt
      if (!enhancedComponents.promptSystem && !enhancedComponents.toolVerifier) {
        return basePrompt;
      }

      // Add tool availability context
      let enhancedPrompt = basePrompt;
      
      if (enhancedComponents.toolVerifier) {
        const toolContext = await enhancedComponents.toolVerifier.generateToolAvailabilityContext();
        enhancedPrompt += `\n\n${toolContext}`;
      }

      // Use enhanced prompt system if available
      if (enhancedComponents.promptSystem) {
        const promptContext: PromptContext = {
          conversationType: 'general',
          userGoal: 'CLI assistance',
          workingDirectory,
          availableTools: enhancedComponents.toolVerifier 
            ? await enhancedComponents.toolVerifier.getVerifiedAvailableTools()
            : [],
          constraints: [],
          previousInteractions: [],
          confidenceThreshold: 0.7,
          requiresPlanning: false,
          requiresReasoning: false
        };

        return enhancedComponents.promptSystem.generateSystemPrompt(promptContext);
      }

      return enhancedPrompt;

    } catch (error) {
      console.warn('⚠️ Enhanced prompt generation failed, using base prompt:', error);
      return basePrompt;
    }
  }

  /**
   * Hook for validating AI responses
   * Call this from turn.ts before executing tool calls
   */
  static async validateResponse(
    response: GenerateContentResponse,
    enhancedComponents: EnhancedSystemComponents,
    workingDirectory: string = process.cwd()
  ): Promise<{ shouldProceed: boolean; correctedResponse?: GenerateContentResponse; issues: string[] }> {
    try {
      // If no response validator, allow all responses
      if (!enhancedComponents.responseValidator) {
        return { shouldProceed: true, issues: [] };
      }

      // Convert Gemini response to validation format
      const aiResponse: AIResponse = {
        content: this.extractResponseText(response),
        toolCalls: this.extractToolCalls(response),
        timestamp: new Date(),
        confidence: 0.8 // Default confidence
      };

      // Create validation constraints
      const constraints: ValidationConstraints = {
        minimumConfidence: 0.6,
        allowedTools: enhancedComponents.toolVerifier 
          ? await enhancedComponents.toolVerifier.getVerifiedAvailableTools()
          : [],
        forbiddenOperations: ['rm -rf', 'sudo rm'],
        requireReasoning: false,
        requireEvidence: false,
        safetyChecks: true,
        factChecking: false,
        maxToolCalls: 10,
        timeoutMs: 30000
      };

      // Create prompt context
      const promptContext: PromptContext = {
        conversationType: 'general',
        userGoal: 'CLI assistance',
        workingDirectory,
        availableTools: constraints.allowedTools,
        constraints: [],
        previousInteractions: [],
        confidenceThreshold: 0.7,
        requiresPlanning: false,
        requiresReasoning: false
      };

      // Validate response
      const validationResult = await enhancedComponents.responseValidator.validateResponse(
        aiResponse,
        promptContext,
        constraints
      );

      const issues = validationResult.issues.map(issue => 
        `${issue.severity.toUpperCase()}: ${issue.message}`
      );

      return {
        shouldProceed: validationResult.allowExecution,
        correctedResponse: validationResult.correctedResponse 
          ? this.convertToGeminiResponse(validationResult.correctedResponse)
          : undefined,
        issues
      };

    } catch (error) {
      console.warn('⚠️ Response validation failed, allowing response:', error);
      return { shouldProceed: true, issues: [`Validation error: ${error}`] };
    }
  }

  /**
   * Hook for creating reasoning chains
   * Call this from turn.ts for complex requests
   */
  static async startReasoning(
    userGoal: string,
    enhancedComponents: EnhancedSystemComponents,
    workingDirectory: string = process.cwd()
  ): Promise<string | undefined> {
    try {
      if (!enhancedComponents.reasoningEngine) {
        return undefined;
      }

      // Create reasoning context
      const reasoningContext = {
        availableTools: enhancedComponents.toolVerifier 
          ? await enhancedComponents.toolVerifier.getVerifiedAvailableTools()
          : [],
        workingDirectory,
        previousChains: [],
        constraints: [],
        timeoutMs: 30000,
        maxSteps: 10,
        validationRequired: true
      };

      // Start reasoning chain
      const chain = await enhancedComponents.reasoningEngine.startReasoning(
        userGoal,
        reasoningContext
      );

      return chain.id;

    } catch (error) {
      console.warn('⚠️ Reasoning chain creation failed:', error);
      return undefined;
    }
  }

  /**
   * Hook for creating hierarchical plans
   * Call this from turn.ts for complex multi-step requests
   */
  static async createPlan(
    userGoal: string,
    enhancedComponents: EnhancedSystemComponents,
    workingDirectory: string = process.cwd()
  ): Promise<string | undefined> {
    try {
      if (!enhancedComponents.hierarchicalPlanner) {
        return undefined;
      }

      // Check if goal requires planning
      if (!this.requiresPlanning(userGoal)) {
        return undefined;
      }

      // Create plan
      const plan = await enhancedComponents.hierarchicalPlanner.createPlan(
        userGoal,
        workingDirectory,
        []
      );

      return plan.id;

    } catch (error) {
      console.warn('⚠️ Plan creation failed:', error);
      return undefined;
    }
  }

  /**
   * Hook for verifying tools before execution
   * Call this from tool-registry.ts when getting tools
   */
  static async getVerifiedTools(
    toolRegistry: ToolRegistry,
    enhancedComponents: EnhancedSystemComponents
  ): Promise<string[]> {
    try {
      if (!enhancedComponents.toolVerifier) {
        return toolRegistry.getAllTools().map(t => t.name);
      }

      return await enhancedComponents.toolVerifier.getVerifiedAvailableTools();

    } catch (error) {
      console.warn('⚠️ Tool verification failed, using all tools:', error);
      return toolRegistry.getAllTools().map(t => t.name);
    }
  }

  /**
   * Helper: Extract text from Gemini response
   */
  private static extractResponseText(response: GenerateContentResponse): string {
    try {
      const candidate = response.candidates?.[0];
      const content = candidate?.content;
      const parts = content?.parts;
      
      if (!parts || parts.length === 0) {
        return '';
      }

      return parts
        .filter(part => part.text)
        .map(part => part.text)
        .join('');

    } catch (error) {
      return '';
    }
  }

  /**
   * Helper: Extract tool calls from Gemini response
   */
  private static extractToolCalls(response: GenerateContentResponse): any[] {
    try {
      const candidate = response.candidates?.[0];
      const content = candidate?.content;
      const parts = content?.parts;
      
      if (!parts || parts.length === 0) {
        return [];
      }

      const toolCalls: any[] = [];
      
      for (const part of parts) {
        if (part.functionCall) {
          toolCalls.push({
            name: part.functionCall.name,
            parameters: part.functionCall.args || {},
            reasoning: 'Extracted from Gemini response'
          });
        }
      }

      return toolCalls;

    } catch (error) {
      return [];
    }
  }

  /**
   * Helper: Convert validated response back to Gemini format
   */
  private static convertToGeminiResponse(aiResponse: AIResponse): GenerateContentResponse {
    // This would need to be implemented based on the specific validation corrections
    // For now, return a basic structure
    return {
      candidates: [{
        content: {
          parts: [{ text: aiResponse.content }],
          role: 'model'
        },
        finishReason: 'STOP'
      }]
    };
  }

  /**
   * Helper: Check if goal requires planning
   */
  private static requiresPlanning(goal: string): boolean {
    const planningKeywords = [
      'implement', 'create', 'build', 'develop', 'plan', 'strategy',
      'multi-step', 'complex', 'architecture', 'system', 'workflow'
    ];
    
    const lowerGoal = goal.toLowerCase();
    return planningKeywords.some(keyword => lowerGoal.includes(keyword));
  }

  /**
   * Log enhanced system status
   */
  static logEnhancedSystemStatus(enhancedComponents: EnhancedSystemComponents): void {
    const features = [];
    
    if (enhancedComponents.toolVerifier) features.push('Tool Verification');
    if (enhancedComponents.responseValidator) features.push('Response Validation');
    if (enhancedComponents.reasoningEngine) features.push('Reasoning Engine');
    if (enhancedComponents.hierarchicalPlanner) features.push('Hierarchical Planning');
    if (enhancedComponents.promptSystem) features.push('Enhanced Prompts');

    if (features.length > 0) {
      console.log(`🚀 Enhanced features active: ${features.join(', ')}`);
    } else {
      console.log('ℹ️ Running in basic mode (no enhanced features)');
    }
  }
}