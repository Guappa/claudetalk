<!-- What this changes and why. Link the issue if there is one. -->

- [ ] Commits follow Conventional Commits (`type(scope): summary`), one logical change each: they land on `main` as written, since only rebase merge is allowed
- [ ] The seven checks pass locally: `npm run lint && npm run typecheck && npm test && npm run check:boot && npm run knip && npm run dupes && npm run check:private`
- [ ] `README.md` and `docs/` are updated in the same commit if this changes what they describe
- [ ] Nothing in it names a real path, a Discord id or a token; examples are invented
- [ ] Changes under `src/claude/`: `npm run test:integration` was run (it uses your Claude plan, so CI cannot)
