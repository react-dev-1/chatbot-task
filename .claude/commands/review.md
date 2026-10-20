Review the file `$ARGUMENTS` against the project rules and report all issues found.

## Steps

1. **Read the rules.** Read `AGENTS.md` so every finding is grounded in a documented rule.

2. **Read the target file.** Read `$ARGUMENTS` in full before drawing any conclusions.

3. **Run lint.**
   ```bash
   npm run lint -- --no-eslintrc --rule '{}' $ARGUMENTS 2>&1 || true
   ```
   If ESLint is configured project-wide, just run:
   ```bash
   npm run lint
   ```
   Note any errors or warnings that touch `$ARGUMENTS`.

4. **Run tests.**
   ```bash
   npm test
   ```
   Note any failures. If a test file exists specifically for `$ARGUMENTS` (e.g. `$ARGUMENTS` is `src/routes/chat.js`, look for `src/routes/chat.test.js`), call it out explicitly if it is missing.

5. **Check the file against every AGENTS.md rule.** Go through each section in order:
   - **Code style:** 2-space indent, single quotes, no default exports, no semicolons, thin route handlers
   - **Testing rules:** a matching test file must exist; it must cover success, validation errors, and at least one edge case
   - **Do not:** no hard-coded URLs, no secrets in source

6. **Report findings.** Output a markdown list grouped by severity:

   ### Errors (must fix before merge)
   - <finding> — rule: <AGENTS.md section>

   ### Warnings (should fix)
   - <finding> — rule: <AGENTS.md section>

   ### Passed
   - <what looked good>

   If `$ARGUMENTS` is empty, apply the review to the whole project.
