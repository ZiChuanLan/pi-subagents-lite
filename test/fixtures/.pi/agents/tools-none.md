---
description: "tools:none => zero tools; extensions may load but contribute no tools."
extensions: "./ext-alpha.mjs, ./ext-beta.mjs"
tools: none
expect_tools_present: ""
expect_tools_absent: "read, bash, edit, write, grep, find, ls, alpha_read, alpha_write, beta_tool"
---
e2e template: `tools: none` is a closed empty allowlist. Extension handlers may still
load when `extensions:` lists them, but no extension tools surface without `ext:`.
