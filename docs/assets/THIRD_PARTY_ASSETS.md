# Third-Party Assets

All runtime assets must have a documented source, version, license, and purpose before they enter an acceptance build.

## Inter Variable — Latin weight subset

| Field          | Value                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| Package        | `@fontsource-variable/inter@5.2.8`                                                 |
| Upstream       | [The Inter Project](https://github.com/rsms/inter)                                 |
| Distributor    | [Fontsource](https://fontsource.org/fonts/inter)                                   |
| Font version   | v20                                                                                |
| License        | [SIL Open Font License 1.1](https://openfontlicense.org)                           |
| Included asset | `inter-latin-wght-normal.woff2`                                                    |
| Purpose        | Deterministic Phase 0 Playground text rendering across local and CI Linux browsers |

The package-provided `LICENSE` file is included in the installed dependency. The Kyxos source does not modify or rename the font. Only the normal Latin weight-variable WOFF2 subset is emitted into the Playground bundle.
