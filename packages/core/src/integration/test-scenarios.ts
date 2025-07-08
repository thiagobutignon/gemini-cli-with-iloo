/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EnhancedAgentSystem } from './enhanced-agent-system.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { Config } from '../config/config.js';

/**
 * Test scenario definition
 */
export interface TestScenario {
  id: string;
  name: string;
  description: string;
  userGoal: string;
  expectedOutcome: string;
  expectedTools: string[];
  expectedReasoningSteps: number;
  expectedPlanSteps: number;
  minimumConfidence: number;
  testValidation: boolean;
}

/**
 * Test result
 */
export interface TestResult {
  scenario: TestScenario;
  sessionId: string;
  success: boolean;
  actualTools: string[];
  actualReasoningSteps: number;
  actualPlanSteps: number;
  averageConfidence: number;
  hallucinationCount: number;
  validationIssues: number;
  executionTime: number;
  errors: string[];
  warnings: string[];
  recommendations: string[];
}

/**
 * Test runner for enhanced agent system
 */
export class EnhancedAgentTestRunner {
  private enhancedSystem: EnhancedAgentSystem;
  private scenarios: TestScenario[] = [];

  constructor(toolRegistry: ToolRegistry, config: Config) {
    this.enhancedSystem = new EnhancedAgentSystem(toolRegistry, config);
    this.initializeTestScenarios();
  }

  /**
   * Runs all test scenarios
   */
  async runAllTests(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    console.log(`Running ${this.scenarios.length} test scenarios...`);
    
    for (const scenario of this.scenarios) {
      console.log(`\nTesting: ${scenario.name}`);
      
      try {
        const result = await this.runTestScenario(scenario);
        results.push(result);
        
        console.log(`  ${result.success ? '✓ PASSED' : '✗ FAILED'}`);
        if (!result.success) {
          console.log(`    Errors: ${result.errors.join(', ')}`);
        }
      } catch (error) {
        console.error(`  ✗ FAILED WITH EXCEPTION: ${error}`);
        results.push({
          scenario,
          sessionId: '',
          success: false,
          actualTools: [],
          actualReasoningSteps: 0,
          actualPlanSteps: 0,
          averageConfidence: 0,
          hallucinationCount: 0,
          validationIssues: 0,
          executionTime: 0,
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [],
          recommendations: []
        });
      }
    }
    
    return results;
  }

  /**
   * Runs a specific test scenario
   */
  async runTestScenario(scenario: TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    // Start session
    const session = await this.enhancedSystem.startSession(scenario.userGoal, {
      enablePlanning: true,
      enableReasoning: true,
      enableValidation: scenario.testValidation,
      minimumConfidence: scenario.minimumConfidence,
      safetyChecks: true,
      factChecking: true
    });

    // Process the initial message
    const response = await this.enhancedSystem.processMessage(
      session.id,
      scenario.userGoal
    );

    // Collect metrics
    const actualTools = session.metrics.toolsUsed;
    const actualReasoningSteps = session.reasoningChain?.steps.length || 0;
    const actualPlanSteps = session.plan?.steps.length || 0;
    const averageConfidence = session.metrics.averageConfidence;
    const hallucinationCount = session.metrics.hallucinationCount;
    const validationIssues = session.metrics.validationIssueCount;
    const executionTime = Date.now() - startTime;

    // Validate results
    let success = true;

    // Check tool usage
    for (const expectedTool of scenario.expectedTools) {
      if (!actualTools.includes(expectedTool)) {
        errors.push(`Expected tool '${expectedTool}' was not used`);
        success = false;
      }
    }

    // Check reasoning steps
    if (actualReasoningSteps < scenario.expectedReasoningSteps) {
      warnings.push(`Expected ${scenario.expectedReasoningSteps} reasoning steps, got ${actualReasoningSteps}`);
    }

    // Check plan steps
    if (actualPlanSteps < scenario.expectedPlanSteps) {
      warnings.push(`Expected ${scenario.expectedPlanSteps} plan steps, got ${actualPlanSteps}`);
    }

    // Check confidence
    if (averageConfidence < scenario.minimumConfidence) {
      errors.push(`Confidence ${averageConfidence.toFixed(2)} below minimum ${scenario.minimumConfidence}`);
      success = false;
    }

    // Check for hallucinations
    if (hallucinationCount > 0) {
      errors.push(`Found ${hallucinationCount} hallucinations`);
      success = false;
    }

    // Check validation issues
    if (scenario.testValidation && validationIssues > 2) {
      warnings.push(`High number of validation issues: ${validationIssues}`);
    }

    // Generate recommendations
    if (!success) {
      recommendations.push('Review system configuration');
      recommendations.push('Check tool availability');
    }

    if (warnings.length > 0) {
      recommendations.push('Review expected vs actual metrics');
    }

    // Complete session
    await this.enhancedSystem.completeSession(session.id);

    return {
      scenario,
      sessionId: session.id,
      success,
      actualTools,
      actualReasoningSteps,
      actualPlanSteps,
      averageConfidence,
      hallucinationCount,
      validationIssues,
      executionTime,
      errors,
      warnings,
      recommendations
    };
  }

  /**
   * Generates test report
   */
  generateTestReport(results: TestResult[]): string {
    const totalTests = results.length;
    const passedTests = results.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;
    const passRate = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(1) : '0';

    let report = `# Enhanced Agent System Test Report

## Summary
- **Total Tests**: ${totalTests}
- **Passed**: ${passedTests}
- **Failed**: ${failedTests}
- **Pass Rate**: ${passRate}%

## Performance Metrics
- **Average Confidence**: ${this.calculateAverageConfidence(results).toFixed(2)}
- **Total Hallucinations**: ${this.calculateTotalHallucinations(results)}
- **Average Execution Time**: ${this.calculateAverageExecutionTime(results).toFixed(0)}ms
- **Most Used Tools**: ${this.getMostUsedTools(results).join(', ')}

## Test Results

`;

    for (const result of results) {
      report += `### ${result.scenario.name} ${result.success ? '✓' : '✗'}

**Description**: ${result.scenario.description}
**Goal**: ${result.scenario.userGoal}

**Metrics**:
- Tools Used: ${result.actualTools.join(', ') || 'None'}
- Reasoning Steps: ${result.actualReasoningSteps}
- Plan Steps: ${result.actualPlanSteps}
- Confidence: ${result.averageConfidence.toFixed(2)}
- Execution Time: ${result.executionTime}ms

`;

      if (result.errors.length > 0) {
        report += `**Errors**:
${result.errors.map(e => `- ${e}`).join('\n')}

`;
      }

      if (result.warnings.length > 0) {
        report += `**Warnings**:
${result.warnings.map(w => `- ${w}`).join('\n')}

`;
      }

      if (result.recommendations.length > 0) {
        report += `**Recommendations**:
${result.recommendations.map(r => `- ${r}`).join('\n')}

`;
      }
    }

    // Add system recommendations
    const systemRecommendations = this.generateSystemRecommendations(results);
    if (systemRecommendations.length > 0) {
      report += `## System Recommendations

${systemRecommendations.map(r => `- ${r}`).join('\n')}
`;
    }

    return report;
  }

  /**
   * Initialize test scenarios
   */
  private initializeTestScenarios(): void {
    this.scenarios = [
      {
        id: 'file_analysis',
        name: 'File Analysis',
        description: 'Analyze project structure and package dependencies',
        userGoal: 'Analyze the project structure and tell me about the main dependencies',
        expectedOutcome: 'Analysis of package.json and directory structure',
        expectedTools: ['ls', 'read_file'],
        expectedReasoningSteps: 3,
        expectedPlanSteps: 3,
        minimumConfidence: 0.7,
        testValidation: true
      },
      {
        id: 'code_search',
        name: 'Code Search',
        description: 'Search for specific patterns in code files',
        userGoal: 'Find all TypeScript files that contain error handling',
        expectedOutcome: 'List of files with error handling patterns',
        expectedTools: ['grep', 'glob'],
        expectedReasoningSteps: 2,
        expectedPlanSteps: 2,
        minimumConfidence: 0.6,
        testValidation: true
      },
      {
        id: 'complex_planning',
        name: 'Complex Planning',
        description: 'Create a plan for implementing a new feature',
        userGoal: 'Plan how to implement a new authentication system for this project',
        expectedOutcome: 'Detailed implementation plan with steps',
        expectedTools: ['read_file', 'ls', 'grep'],
        expectedReasoningSteps: 5,
        expectedPlanSteps: 6,
        minimumConfidence: 0.8,
        testValidation: true
      },
      {
        id: 'tool_validation',
        name: 'Tool Validation',
        description: 'Test response when requesting unavailable tools',
        userGoal: 'Use the nonexistent_tool to analyze the project',
        expectedOutcome: 'Validation should catch unavailable tool',
        expectedTools: [], // Should not use any tools due to validation
        expectedReasoningSteps: 1,
        expectedPlanSteps: 1,
        minimumConfidence: 0.5,
        testValidation: true
      },
      {
        id: 'confidence_test',
        name: 'Confidence Validation',
        description: 'Test low confidence scenario handling',
        userGoal: 'Predict the exact future of this codebase in 10 years',
        expectedOutcome: 'Should acknowledge uncertainty',
        expectedTools: ['read_file'],
        expectedReasoningSteps: 2,
        expectedPlanSteps: 1,
        minimumConfidence: 0.3, // Intentionally low for this scenario
        testValidation: true
      },
      {
        id: 'mcp_tool_usage',
        name: 'MCP Tool Usage',
        description: 'Test MCP tool integration and usage',
        userGoal: 'Use MCP tools to perform advanced code analysis',
        expectedOutcome: 'Should attempt to use available MCP tools',
        expectedTools: [], // MCP tools would be dynamically discovered
        expectedReasoningSteps: 3,
        expectedPlanSteps: 2,
        minimumConfidence: 0.7,
        testValidation: true
      }
    ];
  }

  /**
   * Calculate average confidence across all results
   */
  private calculateAverageConfidence(results: TestResult[]): number {
    if (results.length === 0) return 0;
    const total = results.reduce((sum, r) => sum + r.averageConfidence, 0);
    return total / results.length;
  }

  /**
   * Calculate total hallucinations
   */
  private calculateTotalHallucinations(results: TestResult[]): number {
    return results.reduce((sum, r) => sum + r.hallucinationCount, 0);
  }

  /**
   * Calculate average execution time
   */
  private calculateAverageExecutionTime(results: TestResult[]): number {
    if (results.length === 0) return 0;
    const total = results.reduce((sum, r) => sum + r.executionTime, 0);
    return total / results.length;
  }

  /**
   * Get most used tools
   */
  private getMostUsedTools(results: TestResult[]): string[] {
    const toolCounts = new Map<string, number>();
    
    for (const result of results) {
      for (const tool of result.actualTools) {
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
      }
    }
    
    return Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool]) => tool);
  }

  /**
   * Generate system recommendations
   */
  private generateSystemRecommendations(results: TestResult[]): string[] {
    const recommendations: string[] = [];
    
    const failedTests = results.filter(r => !r.success);
    if (failedTests.length > results.length * 0.2) {
      recommendations.push('High failure rate detected - review system configuration');
    }
    
    const lowConfidenceTests = results.filter(r => r.averageConfidence < 0.6);
    if (lowConfidenceTests.length > 0) {
      recommendations.push('Some tests show low confidence - improve reasoning and evidence');
    }
    
    const hallucinationTests = results.filter(r => r.hallucinationCount > 0);
    if (hallucinationTests.length > 0) {
      recommendations.push('Hallucinations detected - strengthen validation rules');
    }
    
    const slowTests = results.filter(r => r.executionTime > 10000);
    if (slowTests.length > 0) {
      recommendations.push('Some tests are slow - optimize tool verification and response validation');
    }
    
    return recommendations;
  }

  /**
   * Public API
   */
  getTestScenarios(): TestScenario[] {
    return [...this.scenarios];
  }

  addTestScenario(scenario: TestScenario): void {
    this.scenarios.push(scenario);
  }

  async getSystemDiagnostics(): Promise<any> {
    return this.enhancedSystem.runDiagnostics();
  }
}