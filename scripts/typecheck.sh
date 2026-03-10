#!/bin/bash
# Runs tsc --noEmit and filters out errors originating from node_modules.
# Electrobun ships raw .ts files that aren't compatible with our strict tsconfig.

output=$(tsc --noEmit 2>&1)

# Extract only lines that are error locations (contain "error TS") and NOT in node_modules
our_errors=$(echo "$output" | grep 'error TS' | grep -v 'node_modules/')

if [ -z "$our_errors" ]; then
  exit 0
else
  echo "$our_errors"
  exit 1
fi
