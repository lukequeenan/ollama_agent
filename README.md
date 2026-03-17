# Sample VS Code Extension

A sample VS Code extension built with TypeScript, demonstrating core extension patterns.

## Features

- **Hello World Command** - A simple command registered in the Command Palette
- **Status Bar Item** - Displays a greeting message in the status bar (click to trigger command)
- **Configuration Support** - Customize the greeting message via settings

## Development

### Prerequisites

- Node.js 22+
- VS Code
- Docker (for dev container)

### Getting Started

1. Open the project folder in VS Code
2. When prompted, reopen in the dev container
3. Inside the container, dependencies will auto-install via `postCreateCommand`
4. Press `F5` to launch the extension in a debug Extension Host window

### Available Scripts

- `npm run esbuild` - Build extension with source maps for development
- `npm run esbuild-watch` - Watch mode build during development
- `npm run compile` - Compile TypeScript to JavaScript (outputs to `out/`)
- `npm run watch` - Watch TypeScript compilation
- `npm run lint` - Run ESLint on source files
- `npm test` - Run unit tests
- `npm run package` - Bundle extension for production

### Project Structure

```
src/
  extension.ts     - Main extension entry point
  commands.ts      - Command handler implementations
test/
  extension.test.ts - Unit tests
.devcontainer/
  devcontainer.json - Dev container configuration (Node.js 22, ESLint)
.vscode/
  launch.json      - Debug configuration (F5)
  tasks.json       - Build tasks
  extensions.json  - Recommended VS Code extensions
```

### Debug Configuration

Press `F5` to start debugging. This will:
1. Build the extension using the default build task
2. Launch an Extension Host window with your extension loaded
3. Attach the debugger so you can set breakpoints

### Configuration

The extension reads from `sample-extension.greeting` setting. Add to `.vscode/settings.json`:

```json
{
  "sample-extension.greeting": "Your custom greeting"
}
```

## Architecture

- **Extension Host**: Runs in a separate VS Code process (separate from your editor)
- **TypeScript**: Compiled to JavaScript in `out/` for development, bundled to `dist/` for production
- **Esbuild**: Used for fast bundling of the production extension
- **ESLint**: Configured for TypeScript code quality

## Publishing

To publish to VS Code Marketplace:

1. Update `version` in `package.json`
2. Install vsce: `npm install -g vsce`
3. Package: `vsce package`
4. Publish: `vsce publish`

See [VS Code Extension Publishing Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for details.
