## Summary of Changes
<!-- Provide a brief description of what this PR introduces or fixes. -->

### Type of Change
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] Refactor / Performance optimization
- [ ] Documentation update
- [ ] Breaking change (fix or feature that alters existing API contracts)

---

## Pre-Merge Quality Checklist
Before requesting review or merging, ensure all the following pass:

- [ ] **Tests pass locally**: Ran `pytest backend/tests` and all test cases pass.
- [ ] **Frontend builds cleanly**: Ran `npm run build` in `frontend/` without errors or warnings.
- [ ] **No binary / cache files committed**: Confirmed `node_modules`, `venv`, `*.db`, and `__pycache__` are excluded.
- [ ] **Backward compatible**: Existing API routes (`/api/exams`, `/api/sessions`, etc.) continue to behave consistently.
- [ ] **Security**: No secrets, tokens, or private credentials are included in the code.

---

## How to Test This Feature
<!-- Explain the exact steps for evaluators/collaborators to test this change. -->
1. Run `./run_local.sh`
2. Navigate to `http://localhost:5173`
3. ...
