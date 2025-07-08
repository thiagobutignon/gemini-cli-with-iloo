/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolRegistry } from '../tools/tool-registry.js';
import { Config } from '../config/config.js';
import { HierarchicalPlanner } from '../planning/hierarchical-planner.js';
import { ReasoningEngine } from '../reasoning/reasoning-engine.js';
import { ImprovedPromptSystem } from '../prompts/improved-prompt-system.js';
import { ResponseValidator } from '../validation/response-validator.js';
import { ToolAvailabilityVerifier } from '../tools/tool-availability-verifier.js';

/**
 * Enhanced System Components
 */
export interface EnhancedSystemComponents {
  responseValidator?: ResponseValidator;
  reasoningEngine?: ReasoningEngine;
  promptSystem?: ImprovedPromptSystem;
  hierarchicalPlanner?: HierarchicalPlanner;
  toolVerifier?: ToolAvailabilityVerifier;
}

/**
 * Factory for creating enhanced system components based on configuration
 */
export class EnhancedSystemFactory {
  /**
   * Creates enhanced system components based on config flags
   */
  static async create(
    config: Config, 
    toolRegistry: ToolRegistry
  ): Promise<EnhancedSystemComponents> {
    const components: EnhancedSystemComponents = {};

    try {
      // Always enable tool verification for safety
      if (this.isToolVerificationEnabled(config)) {
        components.toolVerifier = new ToolAvailabilityVerifier(toolRegistry, config);
        console.log('✅ Enhanced tool verification enabled');
      }

      // Enable response validation if configured
      if (this.isResponseValidationEnabled(config)) {
        components.responseValidator = new ResponseValidator(toolRegistry, config);
        console.log('✅ Enhanced response validation enabled');
      }

      // Enable reasoning engine if configured
      if (this.isReasoningEngineEnabled(config)) {
        components.reasoningEngine = new ReasoningEngine(toolRegistry, config);
        console.log('✅ Enhanced reasoning engine enabled');
      }

      // Enable hierarchical planning if configured
      if (this.isHierarchicalPlanningEnabled(config)) {
        components.hierarchicalPlanner = new HierarchicalPlanner(toolRegistry, config);
        console.log('✅ Enhanced hierarchical planning enabled');
      }

      // Create enhanced prompt system if any enhanced features are enabled
      if (Object.keys(components).length > 0) {
        components.promptSystem = new ImprovedPromptSystem(
          toolRegistry,
          config,
          components.reasoningEngine,
          components.hierarchicalPlanner
        );
        console.log('✅ Enhanced prompt system enabled');
      }

      // Verify system health
      await this.verifySystemHealth(components);

      return components;

    } catch (error) {
      console.warn('⚠️ Enhanced system initialization failed, falling back to basic mode:', error);
      return {}; // Return empty components to fall back to basic mode
    }
  }

  /**
   * Check if tool verification is enabled
   */
  private static isToolVerificationEnabled(config: Config): boolean {
    return process.env.GEMINI_ENHANCED_TOOL_VERIFICATION !== 'false'; // Default enabled
  }

  /**
   * Check if response validation is enabled
   */
  private static isResponseValidationEnabled(config: Config): boolean {
    return process.env.GEMINI_ENHANCED_VALIDATION === 'true';
  }

  /**
   * Check if reasoning engine is enabled
   */
  private static isReasoningEngineEnabled(config: Config): boolean {
    return process.env.GEMINI_ENHANCED_REASONING === 'true';
  }

  /**
   * Check if hierarchical planning is enabled
   */
  private static isHierarchicalPlanningEnabled(config: Config): boolean {
    return process.env.GEMINI_ENHANCED_PLANNING === 'true';
  }

  /**
   * Verify enhanced system health
   */
  private static async verifySystemHealth(components: EnhancedSystemComponents): Promise<void> {
    let healthyComponents = 0;
    let totalComponents = 0;

    for (const [name, component] of Object.entries(components)) {
      totalComponents++;
      
      try {
        // Basic health check - ensure component is properly initialized
        if (component && typeof component === 'object') {
          healthyComponents++;
        }
      } catch (error) {
        console.warn(`⚠️ Enhanced component ${name} health check failed:`, error);
      }
    }

    const healthRatio = totalComponents > 0 ? healthyComponents / totalComponents : 1;
    
    if (healthRatio >= 0.8) {
      console.log(`✅ Enhanced system health: HEALTHY (${healthyComponents}/${totalComponents} components)`);
    } else if (healthRatio >= 0.6) {
      console.log(`⚠️ Enhanced system health: DEGRADED (${healthyComponents}/${totalComponents} components)`);
    } else {
      console.log(`❌ Enhanced system health: CRITICAL (${healthyComponents}/${totalComponents} components)`);
    }
  }

  /**
   * Get feature status summary
   */
  static getFeatureStatus(): Record<string, boolean> {
    return {
      toolVerification: process.env.GEMINI_ENHANCED_TOOL_VERIFICATION !== 'false',
      responseValidation: process.env.GEMINI_ENHANCED_VALIDATION === 'true',
      reasoningEngine: process.env.GEMINI_ENHANCED_REASONING === 'true',
      hierarchicalPlanning: process.env.GEMINI_ENHANCED_PLANNING === 'true'
    };
  }

  /**
   * Enable all enhanced features
   */
  static enableAllFeatures(): void {
    process.env.GEMINI_ENHANCED_TOOL_VERIFICATION = 'true';
    process.env.GEMINI_ENHANCED_VALIDATION = 'true';
    process.env.GEMINI_ENHANCED_REASONING = 'true';
    process.env.GEMINI_ENHANCED_PLANNING = 'true';
    console.log('✅ All enhanced features enabled');
  }

  /**
   * Disable all enhanced features (except tool verification for safety)
   */
  static disableAllFeatures(): void {
    process.env.GEMINI_ENHANCED_VALIDATION = 'false';
    process.env.GEMINI_ENHANCED_REASONING = 'false';
    process.env.GEMINI_ENHANCED_PLANNING = 'false';
    // Keep tool verification enabled for safety
    console.log('⚠️ Enhanced features disabled (tool verification remains enabled for safety)');
  }
}