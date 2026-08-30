# 🗺️ Roadmap

Features and improvements currently on the radar for Mobile Automator.

---

> **Current focus:** the [`production-ready`](https://github.com/sh3lan93/mobile-automator/milestone/4)
> milestone — the work between today's source-only install and a first published
> npm release. Gate issue:
> [#168](https://github.com/sh3lan93/mobile-automator/issues/168).

### Testing Features
- [x] Tag-based test filtering and execution
- [x] Retry logic for flaky tests — per-step `retry_policy` in the schema; `mauto result add-step --attempts` records a `flakiness` observation
- [ ] Test suite organization (folders, groups)
- [ ] Screenshot comparison improvements

### Developer Experience
- [x] Better error messages — every verb emits the uniform `{ok,data,error,hint,schema_version}` envelope with an actionable `hint`, and commander parse failures are routed through it too
- [x] Device-visibility check (`mauto devices`); deeper setup health checks still open
- [ ] Faster scenario generation
- [ ] Test scenario templates

### Integrations
- [x] CI/CD example for GitHub Actions — see the [FAQ](docs/faq.md); a CircleCI example is still open
- [ ] JIRA integration for bug reporting
- [ ] Slack notifications for test results

> Note: a TestRail integration was prototyped and then removed; it is not on the
> current roadmap.

---

## 🔮 Future Exploration

### Advanced Testing
- [ ] Visual regression testing with AI
- [ ] Performance testing (app startup, screen load times)
- [ ] Network condition simulation
- [ ] Accessibility testing

### AI Enhancements
- [ ] Self-healing tests (auto-fix when UI changes)
- [ ] Smart test selection (run only relevant tests)
- [ ] Test scenario suggestions

### Team Features
- [ ] Shared test scenario library
- [ ] Test result analytics dashboard
- [ ] Parallel test execution

---

## 💡 Ideas Under Consideration

- IDE plugins (VSCode, Android Studio, Xcode)
- Test scenario marketplace
- Cloud device integration
- Additional agent-host adapters for `mauto init`

---

## 🤝 Contributing

Have a feature request? [Open an issue](https://github.com/sh3lan93/mobile-automator/issues) or submit a PR!

**Note:** This roadmap is subject to change based on community feedback and project priorities.

---

*Last updated: August 2026 (v0.23.7)*
