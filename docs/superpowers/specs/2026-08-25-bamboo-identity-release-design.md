# Bamboo Identity And Release Naming Design

**Date:** 2026-08-25

## Goal

Complete the project rename from Zotero Markdown to Bamboo before the plugin is
widely released. Bamboo becomes the sole plugin identity, runtime namespace,
repository name, documented API namespace, and release artifact prefix.

This is an intentional clean break. The project does not need compatibility
aliases or preference migration because the old identity has not been broadly
published.

## Canonical Identity

The canonical project identifiers are:

| Purpose | Value |
| --- | --- |
| Package name | `bamboo` |
| Display name | `Bamboo 竹子` |
| Add-on ID | `bamboo@l0o0.github.io` |
| Add-on reference / chrome namespace | `bamboo` |
| Zotero runtime instance | `Bamboo` |
| Preference prefix | `extensions.zotero.bamboo` |
| Public API root | `Zotero.Bamboo` |
| GitHub repository | `https://github.com/l0o0/bamboo` |
| XPI filename | `bamboo-v{version}.xpi` |

`Zotero.ZoteroMarkdown` will not remain as an alias. Existing preferences under
`extensions.zotero.zoteromarkdown` will not be migrated.

## Scope

### Configuration And Runtime

- Update `package.json` identity, repository, issue, and homepage metadata.
- Set `addonInstance` to `Bamboo` and remove the legacy alias logic.
- Keep `addonRef` as `bamboo` so scripts, locale bundles, icons, workers, and
  iframe resources continue to build under the Bamboo chrome namespace.
- Set the scaffold XPI name to `bamboo-v${package.version}`.
- Ensure shutdown removes only `Zotero.Bamboo`.

### Documentation

- Update the English and Chinese README repository links.
- Document `Zotero.Bamboo.api.markdown` and
  `Zotero.Bamboo.api.version` as the public API.
- Update current architecture documentation where the old product name or old
  `chrome://zoteromarkdown` resource path is presented as current behavior.
- Historical review and planning documents may retain old prose when they
  describe the implementation at that time. Incorrect executable paths or
  current instructions must be updated.

### GitHub And Release Output

- Update package metadata and the local `origin` remote to `l0o0/bamboo`.
- Keep GitHub workflow permissions and release behavior unchanged.
- Resolve the package version in the release workflow and name both the XPI
  file and uploaded Actions artifact `bamboo-v{version}.xpi`.
- Ensure generated update metadata points to the renamed GitHub repository and
  versioned XPI filename.

## Deliberately Retained Markdown Identifiers

The following identifiers describe the Markdown feature rather than the
product brand and remain unchanged:

- `.zotero-markdown-*` CSS classes.
- Markdown-specific DOM IDs such as `zotero-markdown-open-settings`.
- The `zotero-markdown-editor` iframe message source.
- Markdown module and documentation directory names.
- Temporary filenames that are internal to Markdown attachment creation.

Keeping these identifiers avoids a large mechanical refactor with no user
benefit and leaves room for Bamboo to add non-Markdown features later.

## Verification

Automated checks will assert:

- The canonical identifiers in `package.json` and scaffold configuration.
- README API examples use `Zotero.Bamboo` and repository links use
  `l0o0/bamboo`.
- The release workflow produces and uploads `bamboo-v{version}.xpi`.
- No active runtime code references `Zotero.ZoteroMarkdown`.
- Markdown CSS, DOM, and editor protocol identifiers remain valid.

The implementation is complete when linting, unit tests, type checking, and a
production build pass and `.scaffold/build/bamboo-v{version}.xpi` exists.
