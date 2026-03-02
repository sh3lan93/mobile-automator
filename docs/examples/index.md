# Examples

Real-world test scenario examples for Android and iOS platforms. These comprehensive examples demonstrate best practices for mobile test automation using Mobile Automator's v2 scenario format and showcase how to structure test scenarios for common mobile app workflows and user interactions.

## Available Examples

- **[Android Examples](android.md)** — Android app test scenarios with detailed implementations
- **[iOS Examples](ios.md)** — iOS app test scenarios with detailed implementations

## Example Scenarios

Our examples cover a wide range of mobile testing scenarios that you'll encounter in real-world applications. Each scenario demonstrates best practices for structuring test steps, writing effective assertions, and handling platform-specific behaviors. Explore complete test scenario examples covering:

### Core User Journeys
- **Authentication flows** — Login, signup, password reset, and logout scenarios
- **App navigation** — Screen transitions, back button handling, and navigation stacks
- **Data entry** — Form filling, input validation, and error handling

### Advanced Interactions
- **List management** — Scrolling, filtering, searching, and pagination
- **Shopping cart** — Adding items, modifying quantities, and checkout flows
- **User profiles** — Viewing profile information, editing settings, and image uploads
- **Settings configuration** — Toggling features, changing preferences, and saving state
- **Permission handling** — Requesting, granting, and denying app permissions

## Why These Examples Matter

Mobile testing involves unique challenges compared to web testing. Mobile apps must handle diverse device sizes, orientations, network conditions, and user interactions. Our examples show you how to write tests that account for these variables. By studying these scenarios, you'll learn how to write clear, maintainable test scenarios using the v2 JSON schema, structure steps logically to match actual user behavior patterns, create assertions that verify functionality without being brittle, handle asynchronous operations like network requests and animations, and account for platform-specific behavior differences.

## How to Use These Examples

The most effective way to learn Mobile Automator is by studying and adapting these examples:

1. **Review the scenario JSON** — Examine the structure of each scenario to understand how steps and assertions are organized
2. **Understand the test logic** — Study how each test scenario maps to real user interactions in your app
3. **Adapt for your app** — Modify the examples to match your specific app's screens, workflows, and content
4. **Generate similar tests** — Use `/mobile-automator:generate` to create new tests based on the patterns you've learned
5. **Execute and iterate** — Run tests using `/mobile-automator:execute` and review the results to refine your test coverage

## Platform-Specific Considerations

Mobile Automator supports both Android and iOS, but each platform has unique characteristics. **Android** scenarios often involve managing different device manufacturers, screen sizes, Android versions, and navigation patterns. The Android examples include handling system gestures, permission dialogs, and orientation changes. **iOS** scenarios need to account for device families (iPhone, iPad), iOS versions, Safe Area layouts, and platform conventions. The iOS examples demonstrate best practices for iPhone and iPad-specific interactions.

## Next Steps

- [Android Examples](android.md) — Get started with Android test scenarios
- [iOS Examples](ios.md) — Get started with iOS test scenarios
