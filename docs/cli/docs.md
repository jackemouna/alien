---
summary: "CLI reference for `alien docs` (search the live docs index)"
read_when:
  - You want to search the live Alien docs from the terminal
title: "Docs"
---

# `alien docs`

Search the live docs index.

Arguments:

- `[query...]`: search terms to send to the live docs index

Examples:

```bash
alien docs
alien docs browser existing-session
alien docs sandbox allowHostControl
alien docs gateway token secretref
```

Notes:

- With no query, `alien docs` opens the live docs search entrypoint.
- Multi-word queries are passed through as one search request.

## Related

- [CLI reference](/cli)
