# Contributing Guide

Thank you for your interest in contributing to Epic Insight Engine.

## Getting Started

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/epic-insight-engine.git
   cd epic-insight-engine
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Code Style

### TypeScript

- Use TypeScript for all new code
- Prefer explicit types over `any`
- Use interfaces for object shapes

### React

- Use functional components with hooks
- Follow React best practices
- Use proper component composition

### CSS/Tailwind

- Use Tailwind CSS utility classes
- Follow the existing design system
- Use shadcn/ui components when available

### File Organization

```
src/
├── components/     # Reusable components
│   ├── ui/        # Base UI components
│   └── feature/   # Feature-specific components
├── pages/         # Route pages
├── hooks/          # Custom hooks
├── lib/           # Utilities
└── integrations/  # Third-party integrations
```

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add island search functionality
fix: resolve authentication redirect issue
docs: update API documentation
refactor: simplify data processing logic
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | Formatting |
| `refactor` | Code restructuring |
| `test` | Tests |
| `chore` | Maintenance |

## Pull Request Process

### Before Submitting

1. **Run tests**:
   ```bash
   npm run test
   ```

2. **Run linting**:
   ```bash
   npm run lint
   ```

3. **Type check**:
   ```bash
   npx tsc --noEmit
   ```

4. **Build the project**:
   ```bash
   npm run build
   ```

### PR Requirements

- Clear description of changes
- Link to any related issues
- Screenshots for UI changes
- Updated documentation if needed

### Review Process

1. All submissions require review
2. Address feedback promptly
3. Keep changes focused and atomic

## Component Guidelines

### Creating New Components

1. Use existing shadcn/ui components when possible
2. Follow the project's component structure
3. Include proper TypeScript types
4. Add accessibility attributes

### Example Component

```tsx
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  title: string;
}

export function MyComponent({ className, title }: Props) {
  return (
    <div className={cn("default-styles", className)}>
      {title}
    </div>
  );
}
```

## Testing Guidelines

### Unit Tests

- Test utility functions
- Test custom hooks
- Test data processing logic

### Component Tests

- Test rendering
- Test user interactions
- Test edge cases

### Example Test

```tsx
import { describe, it, expect } from 'vitest';
import { myFunction } from './myModule';

describe('myFunction', () => {
  it('should return correct value', () => {
    expect(myFunction('input')).toBe('expected');
  });
});
```

## Documentation

### Updating Documentation

- Update README if adding new features
- Add JSDoc comments to functions
- Update this guide for process changes

### Documentation Structure

```
docs/
├── SETUP.md        # Setup guide
├── USAGE.md        # User guide
├── ARCHITECTURE.md # Technical architecture
├── DATABASE.md     # Database schema
└── CONTRIBUTING.md # This file
```

## Reporting Issues

### Bug Reports

Include:
- Clear title
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Environment details

### Feature Requests

Include:
- Clear description
- Use case
- Potential solutions
- Priority level

## Questions?

For questions about contributing:
- Open an issue for discussion
- Contact the maintainers

## Recognition

Contributors will be acknowledged in the project documentation.

---

*Last updated: 2024*

