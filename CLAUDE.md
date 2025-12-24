# Project Instructions for Claude

## Testing Requirements

**IMPORTANT: Every code change MUST include corresponding tests.**

When adding or modifying code:
1. Write unit tests for new functions/methods
2. Update existing tests if behavior changes
3. Run tests before committing: `cd backend && pytest tests/ -v`
4. Minimum test coverage target: 80%

### Test Location
- Backend tests: `backend/tests/`
- Test naming: `test_<module_name>.py`
- Use fixtures from `conftest.py`

### Test Structure
```python
import pytest
from httpx import AsyncClient

class TestFeatureName:
    """Tests for feature description."""

    async def test_happy_path(self, client: AsyncClient, auth_headers):
        """Test normal operation."""
        response = await client.get("/api/endpoint", headers=auth_headers)
        assert response.status_code == 200

    async def test_edge_case(self, client: AsyncClient):
        """Test edge case."""
        # ...

    async def test_error_handling(self, client: AsyncClient):
        """Test error scenarios."""
        # ...
```

## Code Style

- Use type hints for all functions
- Add docstrings for public functions
- Follow existing patterns in the codebase

## Before Committing

1. Run tests: `pytest tests/ -v`
2. Check types (if applicable)
3. Ensure no hardcoded secrets
