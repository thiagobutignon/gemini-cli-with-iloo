# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Gemini CLI**, a command-line AI workflow tool that connects to Google's Gemini API and provides an interactive terminal experience with extensive tool integration. The CLI allows users to query and edit codebases, generate applications, automate tasks, and leverage various built-in tools.

## Architecture

The project follows a **monorepo structure** with two main packages:

- **`packages/cli/`**: Frontend terminal interface responsible for user interactions, UI rendering, themes, history management, and display logic
- **`packages/core/`**: Backend that handles Gemini API communication, prompt construction, tool orchestration, and session management
- **Tools system**: Located in `packages/core/src/tools/` - modular capabilities for file system operations, shell commands, web fetching, MCP servers, etc.

## Development Commands

### Essential Commands
- `npm run build` - Build the entire project
- `npm run build:packages` - Build only core and CLI packages
- `npm run build:sandbox` - Build the sandbox container
- `npm run start` - Start the Gemini CLI in development mode
- `npm run debug` - Start in debug mode with inspector

### Testing & Quality
- `npm run test` - Run all tests across workspaces
- `npm run test:ci` - Run tests with CI-specific settings
- `npm run test:e2e` - Run end-to-end tests
- `npm run test:integration:all` - Run integration tests with all sandbox modes
- `npm run lint` - Run ESLint across the codebase
- `npm run lint:fix` - Auto-fix linting issues
- `npm run typecheck` - Type check all packages
- `npm run format` - Format code with Prettier
- `npm run preflight` - Complete CI pipeline (clean, install, format, lint, build, typecheck, test)

### Development Utilities
- `npm run clean` - Remove generated files and build artifacts
- `npm run bundle` - Generate bundled CLI distribution
- `make help` - View available Makefile commands
- `make create-alias` - Create shell alias for local development

## Key Technologies

- **Node.js 18+** with ES modules
- **TypeScript** with strict configuration
- **React** for terminal UI components (using Ink-like patterns)
- **Vitest** for testing
- **ESBuild** for bundling
- **ESLint** and **Prettier** for code quality

## Testing Strategy

The project uses **Vitest** as the test runner with:
- Unit tests co-located with source files (`.test.ts` suffix)
- Integration tests in `integration-tests/` directory
- Snapshot testing for UI components
- Separate test configurations for different sandbox modes (none, docker, podman)

## Important File Locations

- **Entry point**: `packages/cli/index.ts` → `packages/cli/src/gemini.tsx`
- **Core API**: `packages/core/src/core/geminiChat.ts`
- **Tool definitions**: `packages/core/src/tools/`
- **UI components**: `packages/cli/src/ui/components/`
- **Configuration**: `packages/cli/src/config/` and `packages/core/src/config/`
- **Build scripts**: `scripts/` directory

## Development Notes

- The project uses **workspaces** - always run commands from the root unless working on a specific package
- **Sandbox support** for secure code execution with Docker/Podman integration
- **Tool confirmation system** - destructive operations require user approval
- **Comprehensive telemetry** and logging throughout the system
- **Theme system** with multiple built-in color schemes
- **Memory management** for handling large codebases within token limits