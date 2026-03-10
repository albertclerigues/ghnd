# Up-to-date documentation 

Propose updating this CLAUDE.md with any information that will make any future queries, research, planning and/or implementation faster to perform.

# Testing strategy

After every code change, always run:

1. Formatter
2. Linter (strictest mode)
3. Type checker (strictest mode)
4. Unit and integration tests

Fix any remaining issues that the linter cannot auto-resolve. 

Any new functionality or code change must be covered by unit and integration tests.

When fixing a bug or issue, consider adding unit or integration tests that would have prevented the issue in the first place.
